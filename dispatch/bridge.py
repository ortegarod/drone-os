#!/usr/bin/env python3
"""
Dispatch Bridge — connects the CAD system to the AI agent (OpenClaw).

Polls for new incidents → sends to AI via gateway → updates status.
Has pause/resume control via REST API on :8082.
"""

import asyncio
import json
import os
import time
import aiohttp
from aiohttp import web

# --- Config ---
DISPATCH_API = "http://localhost:8081"
POLL_INTERVAL = 5  # seconds between polls

# --- Gateway config ---
GATEWAY_WS = os.environ.get("OPENCLAW_GATEWAY_WS_URL", "ws://127.0.0.1:18789")

def _load_gateway_token():
    try:
        cfg_path = os.path.expanduser("~/.openclaw/openclaw.json")
        with open(cfg_path, "r") as f:
            cfg = json.load(f)
        t = (((cfg.get("gateway") or {}).get("auth") or {}).get("token"))
        if isinstance(t, str) and t.strip():
            return t.strip()
    except Exception:
        pass
    return os.environ.get("OPENCLAW_GATEWAY_TOKEN", "").strip() or None


class DispatchBridge:
    def __init__(self):
        self.paused = True  # Start paused — no tokens wasted
        self.running = False
        self.seen_incidents = set()
        self.activity_log = []

    def log(self, msg: str):
        entry = {"time": time.time(), "message": msg}
        self.activity_log.append(entry)
        if len(self.activity_log) > 50:
            self.activity_log = self.activity_log[-50:]
        print(f"[bridge] {msg}")

    async def send_to_ai(self, message: str) -> str | None:
        """Send a message to AI via OpenClaw gateway WebSocket (full protocol)."""
        import websockets

        token = _load_gateway_token()
        auth_obj = {"token": token} if token else None

        try:
            async with websockets.connect(GATEWAY_WS, max_size=8 * 1024 * 1024) as ws:
                # 1) Connect
                connect_id = f"connect-{int(time.time() * 1000)}"
                await ws.send(json.dumps({
                    "type": "req",
                    "id": connect_id,
                    "method": "connect",
                    "params": {
                        "minProtocol": 3,
                        "maxProtocol": 3,
                        "client": {
                            "id": "cli",
                            "displayName": "Dispatch Bridge",
                            "version": "dev",
                            "platform": "backend",
                            "mode": "cli",
                        },
                        "auth": auth_obj,
                    },
                }))

                # Wait for connect response
                deadline = time.time() + 8
                while time.time() < deadline:
                    raw = await asyncio.wait_for(ws.recv(), timeout=8)
                    frame = json.loads(raw)
                    if frame.get("type") == "res" and frame.get("id") == connect_id:
                        if not frame.get("ok"):
                            self.log(f"Gateway connect failed: {frame}")
                            return None
                        break

                # 2) Send agent request (uses main session)
                run_id_str = f"agent-{int(time.time() * 1000)}"
                await ws.send(json.dumps({
                    "type": "req",
                    "id": run_id_str,
                    "method": "agent",
                    "params": {
                        "message": message,
                        "sessionKey": "main",
                        "deliver": False,
                        "idempotencyKey": f"dispatch-{int(time.time() * 1000)}",
                    },
                }))

                # Wait for accepted + get runId
                run_id = None
                deadline = time.time() + 10
                while time.time() < deadline:
                    raw = await asyncio.wait_for(ws.recv(), timeout=10)
                    frame = json.loads(raw)
                    if frame.get("type") == "res" and frame.get("id") == run_id_str:
                        if not frame.get("ok"):
                            self.log(f"Agent request failed: {frame}")
                            return None
                        run_id = (frame.get("payload") or {}).get("runId")
                        break

                if not run_id:
                    self.log("No runId from gateway")
                    return None

                # 3) Wait for lifecycle end
                deadline = time.time() + 120
                while time.time() < deadline:
                    raw = await asyncio.wait_for(ws.recv(), timeout=120)
                    evt = json.loads(raw)
                    if evt.get("type") != "event" or evt.get("event") != "agent":
                        continue
                    p = evt.get("payload") or {}
                    if p.get("runId") != run_id or p.get("stream") != "lifecycle":
                        continue
                    data = p.get("data") or {}
                    if isinstance(data, dict) and data.get("phase") == "error":
                        self.log(f"AI run error: {data}")
                        return None
                    if isinstance(data, dict) and data.get("phase") == "end":
                        break

                # 4) Fetch last assistant reply
                hist_id = f"hist-{int(time.time() * 1000)}"
                await ws.send(json.dumps({
                    "type": "req",
                    "id": hist_id,
                    "method": "chat.history",
                    "params": {"sessionKey": "main", "limit": 5},
                }))

                deadline = time.time() + 10
                while time.time() < deadline:
                    raw = await asyncio.wait_for(ws.recv(), timeout=10)
                    frame = json.loads(raw)
                    if frame.get("type") == "res" and frame.get("id") == hist_id:
                        if frame.get("ok"):
                            messages = (frame.get("payload") or {}).get("messages", [])
                            for m in reversed(messages):
                                if m.get("role") == "assistant":
                                    content = m.get("content")
                                    if isinstance(content, str):
                                        return content
                                    if isinstance(content, list):
                                        texts = [p["text"] for p in content if isinstance(p, dict) and p.get("type") == "text"]
                                        return "".join(texts)
                        break

                return None

        except Exception as e:
            self.log(f"Gateway error: {e}")
            return None

    async def update_incident(self, incident_id: str, status: str, assigned_to: str = None):
        """Update incident status in the dispatch service."""
        try:
            data = {"status": status}
            if assigned_to:
                data["assigned_to"] = assigned_to
            async with aiohttp.ClientSession() as s:
                async with s.patch(
                    f"{DISPATCH_API}/api/incidents/{incident_id}",
                    json=data,
                ) as resp:
                    return resp.status == 200
        except Exception as e:
            self.log(f"Error updating incident {incident_id}: {e}")
            return False

    async def get_active_incidents(self) -> list:
        try:
            async with aiohttp.ClientSession() as s:
                async with s.get(f"{DISPATCH_API}/api/incidents/active") as resp:
                    if resp.status == 200:
                        return await resp.json()
            return []
        except Exception:
            return []

    async def process_incident(self, incident: dict):
        """Send an incident to the AI for decision-making."""
        inc_id = incident["id"]
        self.log(f"🚨 Sending {inc_id} to AI: P{incident['priority']} {incident['type']}")

        message = (
            f"DISPATCH ALERT — NEW INCIDENT:\n"
            f"  ID: {inc_id}\n"
            f"  Type: {incident['type']} (Priority {incident['priority']})\n"
            f"  Description: {incident['description']}\n"
            f"  Location: {incident['location']['name']} "
            f"(x={incident['location']['x']}, y={incident['location']['y']})\n"
            f"\n"
            f"You are the AI dispatcher. Dispatch a drone to this incident:\n"
            f"1. Pick an available drone (drone1 or drone2)\n"
            f"2. Fly it to the location using drone_control.py: set_offboard, arm, set_position(x, y, -15, 0)\n"
            f"3. After dispatching, include DISPATCHED:<drone_name> in your response\n"
            f"4. Monitor the drone's arrival, then after ~30s on scene, land it and return\n"
        )

        response = await self.send_to_ai(message)

        if response:
            self.log(f"🧠 AI responded for {inc_id}: {response[:150]}")
            # Check if AI dispatched a drone
            resp_upper = response.upper()
            if "DISPATCHED:" in resp_upper:
                drone = resp_upper.split("DISPATCHED:")[1].strip().split()[0].strip(".,!;")
                await self.update_incident(inc_id, "dispatched", drone.lower())
                self.log(f"🛸 Updated {inc_id} → dispatched to {drone.lower()}")
            else:
                # AI responded but didn't include the dispatch tag — still mark it
                await self.update_incident(inc_id, "dispatched", "ai-pending")
                self.log(f"⚠️ AI responded but no DISPATCHED tag — marked as ai-pending")
        else:
            self.log(f"❌ No AI response for {inc_id}")

    async def poll_loop(self):
        """Main loop: poll for new incidents and send to AI."""
        self.running = True
        self.log("Bridge started (PAUSED — toggle via /api/bridge/toggle)")

        while self.running:
            if not self.paused:
                incidents = await self.get_active_incidents()
                new_incidents = [
                    inc for inc in incidents
                    if inc["id"] not in self.seen_incidents and inc["status"] == "new"
                ]

                for inc in new_incidents:
                    self.seen_incidents.add(inc["id"])
                    # Process one at a time to avoid flooding
                    await self.process_incident(inc)

            await asyncio.sleep(POLL_INTERVAL)

    def stop(self):
        self.running = False


# --- Control API on :8082 ---
def create_control_api(bridge: DispatchBridge) -> web.Application:

    def cors(resp):
        resp.headers["Access-Control-Allow-Origin"] = "*"
        resp.headers["Access-Control-Allow-Methods"] = "GET, POST, OPTIONS"
        resp.headers["Access-Control-Allow-Headers"] = "Content-Type"
        return resp

    async def get_status(request):
        return cors(web.json_response({
            "paused": bridge.paused,
            "running": bridge.running,
            "seen_count": len(bridge.seen_incidents),
            "activity_log": bridge.activity_log[-20:],
        }))

    async def post_pause(request):
        bridge.paused = True
        bridge.log("⏸️ Bridge PAUSED")
        return cors(web.json_response({"paused": True}))

    async def post_resume(request):
        bridge.paused = False
        bridge.log("▶️ Bridge RESUMED")
        return cors(web.json_response({"paused": False}))

    async def post_toggle(request):
        bridge.paused = not bridge.paused
        state = "PAUSED" if bridge.paused else "RESUMED"
        bridge.log(f"{'⏸️' if bridge.paused else '▶️'} Bridge {state}")
        return cors(web.json_response({"paused": bridge.paused}))

    async def handle_options(request):
        return cors(web.json_response({}))

    app = web.Application()
    app.router.add_get("/api/bridge/status", get_status)
    app.router.add_post("/api/bridge/pause", post_pause)
    app.router.add_post("/api/bridge/resume", post_resume)
    app.router.add_post("/api/bridge/toggle", post_toggle)
    app.router.add_options("/api/bridge/{path:.*}", handle_options)
    return app


async def main():
    bridge = DispatchBridge()

    app = create_control_api(bridge)
    runner = web.AppRunner(app)
    await runner.setup()
    site = web.TCPSite(runner, "0.0.0.0", 8082)
    await site.start()
    print("[bridge] Control API running on :8082")

    try:
        await bridge.poll_loop()
    except KeyboardInterrupt:
        bridge.stop()
        await runner.cleanup()


if __name__ == "__main__":
    asyncio.run(main())
