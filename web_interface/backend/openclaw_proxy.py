"""OpenClaw Proxy API

Minimal FastAPI service that lets the DroneOS web UI talk to OpenClaw *without*
exposing the OpenClaw gateway token to the browser.

It connects to the OpenClaw Gateway via WebSocket on localhost and exposes a
simple HTTP endpoint:

POST /api/openclaw/chat { message, session_key? } -> { ok, text, sessionKey }

Based on OpenClaw gateway WS protocol v3:
  - Ed25519 device identity (keypair generated + persisted on first run)
  - Challenge-response nonce signing
  - Operator role with read/write scopes
"""

import asyncio
import base64
import hashlib
import json
import os
import time
from typing import Any, Dict, Optional

import websockets
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
from cryptography.hazmat.primitives.serialization import (
    Encoding,
    NoEncryption,
    PrivateFormat,
    PublicFormat,
)
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel


# ---------------------------------------------------------------------------
# Device identity helpers (mirrors OpenClaw's device-identity.ts)
# ---------------------------------------------------------------------------

DEVICE_IDENTITY_PATH = os.environ.get(
    "DEVICE_IDENTITY_PATH",
    os.path.expanduser("~/.openclaw/identity/droneos-proxy.json"),
)


def _b64url_encode(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode()


def _generate_identity() -> dict:
    """Generate a new Ed25519 keypair and derive deviceId."""
    private_key = Ed25519PrivateKey.generate()
    public_key = private_key.public_key()
    public_pem = public_key.public_bytes(Encoding.PEM, PublicFormat.SubjectPublicKeyInfo).decode()
    private_pem = private_key.private_bytes(Encoding.PEM, PrivateFormat.PKCS8, NoEncryption()).decode()
    raw_public = public_key.public_bytes(Encoding.Raw, PublicFormat.Raw)
    device_id = hashlib.sha256(raw_public).hexdigest()
    return {
        "version": 1,
        "deviceId": device_id,
        "publicKeyPem": public_pem,
        "privateKeyPem": private_pem,
    }


def _load_or_create_identity(path: str = DEVICE_IDENTITY_PATH) -> dict:
    """Load existing identity or create and persist a new one."""
    try:
        if os.path.exists(path):
            with open(path, "r") as f:
                data = json.load(f)
            if data.get("version") == 1 and data.get("deviceId") and data.get("privateKeyPem"):
                return data
    except Exception:
        pass
    identity = _generate_identity()
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w") as f:
        json.dump(identity, f, indent=2)
    os.chmod(path, 0o600)
    return identity


def _sign_payload(private_key_pem: str, payload: str) -> str:
    """Sign a UTF-8 payload with Ed25519 and return base64url signature."""
    from cryptography.hazmat.primitives.serialization import load_pem_private_key
    key = load_pem_private_key(private_key_pem.encode(), password=None)
    signature = key.sign(payload.encode())
    return _b64url_encode(signature)


def _public_key_raw_b64url(public_key_pem: str) -> str:
    """Extract raw 32-byte Ed25519 public key and return as base64url."""
    from cryptography.hazmat.primitives.serialization import load_pem_public_key
    pub = load_pem_public_key(public_key_pem.encode())
    raw = pub.public_bytes(Encoding.Raw, PublicFormat.Raw)
    return _b64url_encode(raw)


def _build_device_auth_payload(
    device_id: str,
    client_id: str,
    client_mode: str,
    role: str,
    scopes: list,
    signed_at_ms: int,
    token: str,
    nonce: str,
) -> str:
    """Build the v2 device auth payload string (matches OpenClaw's buildDeviceAuthPayload)."""
    parts = [
        "v2",
        device_id,
        client_id,
        client_mode,
        role,
        ",".join(scopes),
        str(signed_at_ms),
        token or "",
        nonce or "",
    ]
    return "|".join(parts)


# ---------------------------------------------------------------------------
# Lazy-load identity once at module level
# ---------------------------------------------------------------------------
_identity: Optional[dict] = None


def _get_identity() -> dict:
    global _identity
    if _identity is None:
        _identity = _load_or_create_identity()
    return _identity


# ---------------------------------------------------------------------------
# Config / models
# ---------------------------------------------------------------------------

class OpenClawCommand(BaseModel):
    message: str
    session_key: Optional[str] = None


def _load_gateway_token() -> Optional[str]:
    try:
        cfg_path = os.path.expanduser("~/.openclaw/openclaw.json")
        with open(cfg_path, "r", encoding="utf-8") as f:
            cfg = json.load(f)
        t = (((cfg.get("gateway") or {}).get("auth") or {}).get("token"))
        if isinstance(t, str) and t.strip():
            return t.strip()
    except Exception:
        pass
    tok = os.environ.get("OPENCLAW_GATEWAY_TOKEN")
    return tok.strip() if isinstance(tok, str) and tok.strip() else None


# ---------------------------------------------------------------------------
# Core chat function
# ---------------------------------------------------------------------------

async def openclaw_chat(message: str, session_key: Optional[str] = None) -> Dict[str, Any]:
    if not session_key:
        session_key = "hook:webui"
    gateway_ws_url = os.environ.get("OPENCLAW_GATEWAY_WS_URL", "ws://127.0.0.1:18789")
    token = _load_gateway_token()
    auth_obj = {"token": token} if token else None
    identity = _get_identity()
    role = "operator"
    scopes = ["operator.read", "operator.write"]
    client_id = "cli"
    client_mode = "cli"

    async with websockets.connect(gateway_ws_url, max_size=8 * 1024 * 1024) as ws:
        # 1) Wait for the connect.challenge event
        nonce = None
        challenge_deadline = time.time() + 5
        while time.time() < challenge_deadline:
            raw = await asyncio.wait_for(ws.recv(), timeout=5)
            evt = json.loads(raw)
            if evt.get("type") == "event" and evt.get("event") == "connect.challenge":
                nonce = (evt.get("payload") or {}).get("nonce", "")
                break

        # 2) Build device identity with signed challenge
        signed_at_ms = int(time.time() * 1000)
        payload_str = _build_device_auth_payload(
            device_id=identity["deviceId"],
            client_id=client_id,
            client_mode=client_mode,
            role=role,
            scopes=scopes,
            signed_at_ms=signed_at_ms,
            token=token or "",
            nonce=nonce or "",
        )
        signature = _sign_payload(identity["privateKeyPem"], payload_str)

        device_obj = {
            "id": identity["deviceId"],
            "publicKey": _public_key_raw_b64url(identity["publicKeyPem"]),
            "signature": signature,
            "signedAt": signed_at_ms,
            "nonce": nonce or "",
        }

        # 3) Send connect request
        connect_id = f"connect-{int(time.time() * 1000)}"
        await ws.send(
            json.dumps(
                {
                    "type": "req",
                    "id": connect_id,
                    "method": "connect",
                    "params": {
                        "minProtocol": 3,
                        "maxProtocol": 3,
                        "client": {
                            "id": client_id,
                            "displayName": "DroneOS OpenClaw Proxy",
                            "version": "dev",
                            "platform": "linux",
                            "mode": client_mode,
                        },
                        "role": role,
                        "scopes": scopes,
                        "auth": auth_obj,
                        "device": device_obj,
                    },
                }
            )
        )

        # Wait for connect response
        connect_deadline = time.time() + 8
        msg = None
        while time.time() < connect_deadline:
            raw = await asyncio.wait_for(ws.recv(), timeout=8)
            candidate = json.loads(raw)
            if candidate.get("type") == "res" and candidate.get("id") == connect_id:
                msg = candidate
                break

        if not msg or not msg.get("ok"):
            err = (msg.get("error") or {}).get("message") if isinstance(msg, dict) else None
            raise Exception(err or "OpenClaw connect failed")

        # Store device token if issued (for future use)
        auth_info = (msg.get("payload") or {}).get("auth")
        if auth_info and auth_info.get("deviceToken"):
            # Could persist this for reconnects; for now just log it
            pass

        main_session_key = session_key
        sk = (((msg.get("payload") or {}).get("snapshot") or {}).get("sessionDefaults") or {}).get(
            "mainSessionKey"
        )
        if sk and not main_session_key:
            main_session_key = sk
        if not main_session_key:
            main_session_key = "main"

        # 4) agent request
        run_req_id = f"agent-{int(time.time() * 1000)}"
        await ws.send(
            json.dumps(
                {
                    "type": "req",
                    "id": run_req_id,
                    "method": "agent",
                    "params": {
                        "message": message,
                        "sessionKey": main_session_key,
                        "deliver": False,
                        "idempotencyKey": f"webui-{int(time.time() * 1000)}",
                    },
                }
            )
        )

        # Wait for agent ack
        deadline = time.time() + 10
        run_id = None
        while time.time() < deadline:
            raw = await asyncio.wait_for(ws.recv(), timeout=10)
            frame = json.loads(raw)
            if frame.get("type") != "res" or frame.get("id") != run_req_id:
                continue
            if not frame.get("ok"):
                err = (frame.get("error") or {}).get("message")
                raise Exception(err or "OpenClaw agent request failed")
            payload = frame.get("payload") or {}
            run_id = payload.get("runId")
            break

        if not run_id:
            raise Exception("OpenClaw agent ack missing runId")

        # Wait for agent lifecycle end
        end_deadline = time.time() + 90
        while time.time() < end_deadline:
            raw = await asyncio.wait_for(ws.recv(), timeout=90)
            evt = json.loads(raw)
            if evt.get("type") != "event" or evt.get("event") != "agent":
                continue
            p = evt.get("payload") or {}
            if p.get("runId") != run_id:
                continue
            if p.get("stream") != "lifecycle":
                continue
            data = p.get("data") or {}
            if isinstance(data, dict) and data.get("phase") == "error":
                raise Exception(str(data.get("error") or "OpenClaw run error"))
            if isinstance(data, dict) and data.get("phase") == "end":
                break

        # 5) Fetch last assistant reply
        hist_id = f"chat.history-{int(time.time() * 1000)}"
        await ws.send(
            json.dumps(
                {
                    "type": "req",
                    "id": hist_id,
                    "method": "chat.history",
                    "params": {"sessionKey": main_session_key, "limit": 10},
                }
            )
        )

        hist_deadline = time.time() + 10
        hist_res = None
        while time.time() < hist_deadline:
            raw = await asyncio.wait_for(ws.recv(), timeout=10)
            frame = json.loads(raw)
            if frame.get("type") == "res" and frame.get("id") == hist_id:
                hist_res = frame
                break

        text = ""
        if hist_res and hist_res.get("ok"):
            items = ((hist_res.get("payload") or {}).get("messages") or [])

            def content_to_text(content: Any) -> str:
                if isinstance(content, str):
                    return content
                if isinstance(content, list):
                    parts: list[str] = []
                    for p in content:
                        if isinstance(p, dict) and p.get("type") == "text" and isinstance(p.get("text"), str):
                            parts.append(p["text"])
                    if parts:
                        return "".join(parts)
                return json.dumps(content, ensure_ascii=False)

            for m in reversed(items):
                if m.get("role") == "assistant":
                    text = content_to_text(m.get("content"))
                    break

        return {"ok": True, "sessionKey": main_session_key, "text": text}


# ---------------------------------------------------------------------------
# FastAPI app
# ---------------------------------------------------------------------------

app = FastAPI(title="OpenClaw Proxy", version="0.2")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/api/openclaw/status")
async def status():
    try:
        model = None
        agent_name = None
        session_key = "main"
        try:
            cfg_path = os.path.expanduser("~/.openclaw/openclaw.json")
            with open(cfg_path, "r", encoding="utf-8") as f:
                cfg = json.load(f)
            model = ((cfg.get("agents") or {}).get("defaults") or {}).get("model", {}).get("primary")
        except Exception:
            pass
        try:
            ws = ((cfg.get("agents") or {}).get("defaults") or {}).get("workspace", os.path.expanduser("~/.openclaw/workspace"))
            id_path = os.path.join(ws, "IDENTITY.md")
            with open(id_path, "r", encoding="utf-8") as f:
                for line in f:
                    if line.startswith("- **Name:**"):
                        agent_name = line.split("**Name:**")[1].strip().split("\n")[0].strip()
                        break
        except Exception:
            pass
        return {"ok": True, "model": model, "agent": agent_name, "session": session_key}
    except Exception as e:
        return {"ok": False, "error": str(e)}


@app.post("/api/openclaw/chat")
async def chat(cmd: OpenClawCommand):
    try:
        return await openclaw_chat(cmd.message, session_key=cmd.session_key)
    except Exception as e:
        return {"ok": False, "error": str(e)}


if __name__ == "__main__":
    import uvicorn

    host = os.environ.get("OPENCLAW_PROXY_BIND", "0.0.0.0")
    port = int(os.environ.get("OPENCLAW_PROXY_PORT", "3031"))
    uvicorn.run(app, host=host, port=port, log_level="info")
