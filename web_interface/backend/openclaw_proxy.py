"""OpenClaw Proxy API

Minimal FastAPI service that lets the DroneOS web UI talk to OpenClaw *without*
exposing the OpenClaw gateway token to the browser.

It connects to the OpenClaw Gateway via WebSocket on localhost and exposes a
simple HTTP endpoint:

POST /api/openclaw/chat { message, session_key? } -> { ok, text, sessionKey }

Based on OpenClaw gateway WS methods: connect + chat.send + chat events.
"""

import asyncio
import json
import os
import time
from typing import Any, Dict, Optional

import websockets
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel


class OpenClawCommand(BaseModel):
    message: str
    session_key: Optional[str] = None


def _load_gateway_token() -> Optional[str]:
    # Prefer reading the local OpenClaw config (authoritative for this host).
    try:
        cfg_path = os.path.expanduser("~/.openclaw/openclaw.json")
        with open(cfg_path, "r", encoding="utf-8") as f:
            cfg = json.load(f)
        t = (((cfg.get("gateway") or {}).get("auth") or {}).get("token"))
        if isinstance(t, str) and t.strip():
            return t.strip()
    except Exception:
        pass

    # Fallback: explicit env override.
    tok = os.environ.get("OPENCLAW_GATEWAY_TOKEN")
    return tok.strip() if isinstance(tok, str) and tok.strip() else None


async def openclaw_chat(message: str, session_key: Optional[str] = None) -> Dict[str, Any]:
    # Use an isolated session by default so the web UI doesn't pollute the main chat transcript.
    if not session_key:
        session_key = "hook:webui"
    gateway_ws_url = os.environ.get("OPENCLAW_GATEWAY_WS_URL", "ws://127.0.0.1:18789")
    token = _load_gateway_token()
    auth_obj = {"token": token} if token else None

    async with websockets.connect(gateway_ws_url, max_size=8 * 1024 * 1024) as ws:
        # 1) connect
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
                            "id": "cli",
                            "displayName": "DroneOS OpenClaw Proxy",
                            "version": "dev",
                            "platform": "backend",
                            "mode": "cli",
                        },
                        "auth": auth_obj,
                    },
                }
            )
        )

        # The gateway may emit a pre-connect challenge event first.
        connect_deadline = time.time() + 8
        msg = None
        while time.time() < connect_deadline:
            raw = await asyncio.wait_for(ws.recv(), timeout=8)
            candidate = json.loads(raw)
            if candidate.get("type") == "res" and candidate.get("id") == connect_id:
                msg = candidate
                break
            # Ignore pre-connect events like connect.challenge

        if not msg or not msg.get("ok"):
            err = (msg.get("error") or {}).get("message") if isinstance(msg, dict) else None
            raise Exception(err or "OpenClaw connect failed")

        main_session_key = session_key
        sk = (((msg.get("payload") or {}).get("snapshot") or {}).get("sessionDefaults") or {}).get(
            "mainSessionKey"
        )
        if sk and not main_session_key:
            main_session_key = sk
        if not main_session_key:
            main_session_key = "main"

        # 2) agent (runs the agent loop; delivers a 2-phase response on the same id)
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

        # Wait for the initial accepted response to get runId.
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

        # Best-effort: many deployments don't stream assistant text over `agent` events.
        # We'll wait for lifecycle end, then fetch the latest assistant message from chat.history.
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

        # Fetch last assistant reply from the session transcript.
        # (chat.history returns recent messages; we pick the newest assistant content.)
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
                # OpenAI-style content arrays: [{type:'text', text:'...'}, ...]
                if isinstance(content, list):
                    parts: list[str] = []
                    for p in content:
                        if isinstance(p, dict) and p.get("type") == "text" and isinstance(p.get("text"), str):
                            parts.append(p["text"])
                    if parts:
                        return "".join(parts)
                # Fallback
                return json.dumps(content, ensure_ascii=False)

            # walk newest->oldest
            for m in reversed(items):
                if m.get("role") == "assistant":
                    text = content_to_text(m.get("content"))
                    break

        return {"ok": True, "sessionKey": main_session_key, "text": text}


app = FastAPI(title="OpenClaw Proxy", version="0.1")
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
        # Read agent name from workspace identity
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
