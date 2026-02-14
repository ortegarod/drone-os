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
        self.session_mode = "isolated"  # "main" or "isolated" — isolated enables concurrent dispatch
        self.model = "anthropic/claude-sonnet-4-5"  # Model for dispatch sessions
        self.seen_incidents = set()
        self.activity_log = []

    def log(self, msg: str):
        entry = {"time": time.time(), "message": msg}
        self.activity_log.append(entry)
        if len(self.activity_log) > 50:
            self.activity_log = self.activity_log[-50:]
        print(f"[bridge] {msg}")

    async def send_to_ai(self, message: str, on_text=None) -> str | None:
        """Send a message to AI via OpenClaw gateway WebSocket (full protocol).
        
        on_text: optional async callback(text_chunk) called when assistant text streams in.
        """
        import websockets

        token = _load_gateway_token()
        auth_obj = {"token": token} if token else None

        try:
            async with websockets.connect(GATEWAY_WS, max_size=8 * 1024 * 1024) as ws:
                # 0) Wait for connect.challenge from gateway
                raw = await asyncio.wait_for(ws.recv(), timeout=5)
                challenge = json.loads(raw)
                if challenge.get("event") != "connect.challenge":
                    self.log(f"Expected challenge, got: {challenge}")
                    return None

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
                            "version": "1.0.0",
                            "platform": "linux",
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

                # 2) Send agent request
                run_id_str = f"agent-{int(time.time() * 1000)}"
                params = {
                    "message": message,
                    "idempotencyKey": f"dispatch-{int(time.time() * 1000)}",
                }
                if self.session_mode == "isolated":
                    params["sessionKey"] = f"dispatch-{int(time.time())}"
                    params["deliver"] = False  # Don't announce isolated dispatch sessions
                else:
                    params["sessionKey"] = "main"
                    params["deliver"] = False

                await ws.send(json.dumps({
                    "type": "req",
                    "id": run_id_str,
                    "method": "agent",
                    "params": params,
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

                # 3) Wait for lifecycle end, process streamed text in real-time
                accumulated_text = []
                deadline = time.time() + 300
                while time.time() < deadline:
                    raw = await asyncio.wait_for(ws.recv(), timeout=300)
                    evt = json.loads(raw)
                    if evt.get("type") != "event" or evt.get("event") != "agent":
                        continue
                    p = evt.get("payload") or {}
                    if p.get("runId") != run_id:
                        continue
                    
                    stream = p.get("stream")
                    data = p.get("data") or {}
                    
                    # Process assistant text stream in real-time
                    if stream == "assistant" and isinstance(data, dict):
                        text = data.get("text", "")
                        if text and on_text:
                            accumulated_text.append(text)
                            try:
                                await on_text("".join(accumulated_text))
                            except Exception as e:
                                self.log(f"on_text callback error: {e}")
                    
                    # Check for lifecycle end
                    if stream == "lifecycle" and isinstance(data, dict):
                        if data.get("phase") == "error":
                            self.log(f"AI run error: {data}")
                            return None
                        if data.get("phase") == "end":
                            break

                # 4) Fetch last assistant reply (full text)
                hist_id = f"hist-{int(time.time() * 1000)}"
                await ws.send(json.dumps({
                    "type": "req",
                    "id": hist_id,
                    "method": "chat.history",
                    "params": {"sessionKey": params["sessionKey"], "limit": 5},
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

    def get_fleet_state_sync(self) -> str:
        """Query all drones via drone_control.py and return a fleet status string."""
        import subprocess
        try:
            result = subprocess.run(
                ["python3", "-u", "-c", """
import sys
sys.path.insert(0, '/root/ws_droneOS')
import drone_control as dc
import math

drones = []
# Discover drones by trying drone1-drone5
for i in range(1, 6):
    name = f'drone{i}'
    try:
        dc.set_drone_name(name)
        s = dc.get_state()
        if s.get('nav_state') and s['nav_state'] != 'UNKNOWN':
            armed = s.get('arming_state', 'UNKNOWN')
            nav = s.get('nav_state', 'UNKNOWN')
            x = s.get('local_x', 0)
            y = s.get('local_y', 0)
            z = s.get('local_z', 0)
            alt = -z
            bat = s.get('battery_remaining', 0)
            airborne = alt > 1.5
            if armed == 'ARMED' and airborne:
                status = 'AIRBORNE'
            elif armed == 'ARMED':
                status = 'ARMED'
            else:
                status = 'AVAILABLE'
            drones.append(f'  {name}: {status} at ({x:.0f}, {y:.0f}) alt={alt:.0f}m bat={bat*100:.0f}%')
    except:
        pass

if drones:
    print('\\n'.join(drones))
else:
    print('  No drones responding')
"""],
                capture_output=True, text=True, timeout=15
            )
            return result.stdout.strip() if result.stdout.strip() else "  Fleet state unavailable"
        except Exception as e:
            return f"  Fleet state error: {e}"

    async def process_incident(self, incident: dict):
        """Send an incident to the AI for decision-making."""
        inc_id = incident["id"]
        self.log(f"INCIDENT {inc_id} — P{incident['priority']} {incident['type'].upper().replace('_', ' ')} — DISPATCHING")

        # Gather context: fleet state + active incidents
        fleet_state = await asyncio.get_event_loop().run_in_executor(None, self.get_fleet_state_sync)
        all_incidents = await self.get_active_incidents()
        
        incident_lines = []
        for inc in all_incidents:
            if inc["id"] == inc_id:
                continue  # skip the new one, it's shown separately
            status = inc.get("status", "unknown")
            assigned = inc.get("assigned_to", "")
            loc = inc.get("location", {})
            assign_str = f" — {assigned}" if assigned else ""
            incident_lines.append(
                f"  {inc['id']}: {inc['type']} P{inc['priority']} at {loc.get('name', '?')} "
                f"({loc.get('x', '?')}, {loc.get('y', '?')}) [{status}{assign_str}]"
            )
        
        active_ctx = "\n".join(incident_lines) if incident_lines else "  None"

        message = (
            f"DISPATCH ALERT — NEW INCIDENT\n"
            f"  ID: {inc_id}\n"
            f"  Type: {incident['type']} (Priority {incident['priority']})\n"
            f"  Description: {incident['description']}\n"
            f"  Location: {incident['location']['name']} "
            f"(x={incident['location']['x']}, y={incident['location']['y']})\n"
            f"\n"
            f"FLEET STATUS:\n"
            f"{fleet_state}\n"
            f"\n"
            f"OTHER ACTIVE INCIDENTS:\n"
            f"{active_ctx}\n"
            f"\n"
            f"Assess and dispatch the best available drone. "
            f"You MUST use the exec tool to run each command — do NOT just write commands as text.\n"
            f"\n"
            f"COMMAND REFERENCE (run each with exec tool):\n"
            f"  cd /root/ws_droneOS && python3 drone_control.py --drone DRONENAME --COMMAND\n"
            f"  Commands: --arm, --set-offboard, --set-position X Y Z [YAW]\n"
            f"\n"
            f"FLIGHT PROCEDURE:\n"
            f"  1. Pick the best available drone\n"
            f"  2. exec: cd /root/ws_droneOS && python3 drone_control.py --drone droneX --set-offboard\n"
            f"  3. exec: cd /root/ws_droneOS && python3 drone_control.py --drone droneX --arm\n"
            f"  4. exec: cd /root/ws_droneOS && python3 drone_control.py --drone droneX --set-position CURRENT_X CURRENT_Y -50 0  (climb VERTICALLY — use drone's current X,Y from fleet status)\n"
            f"  5. exec: cd /root/ws_droneOS && python3 drone_control.py --drone droneX --set-position TARGET_X TARGET_Y -50 0  (fly to target)\n"
            f"  6. Poll drone position every 5 seconds using exec: cd /root/ws_droneOS && python3 drone_control.py --drone droneX\n"
            f"     Check altitude > 40m AND position within ~30m of target (compare x,y)\n"
            f"  7. When near target, report ON_SCENE\n"
            f"\n"
            f"CRITICAL INSTRUCTIONS:\n"
            f"- You MUST call the exec tool for each command. Writing bash code blocks does NOTHING.\n"
            f"- Use z=-50 (50 meters altitude) to clear all obstacles (trees, buildings)\n"
            f"- Do NOT issue RTL — the operator will resolve the incident manually\n"
            f"- Do NOT land the drone — it should hover on scene until operator resolves\n"
            f"- Maintain 5m minimum separation from other airborne drones.\n"
            f"\n"
            f"STATUS TAGS (include in your response):\n"
            f"  DISPATCHED:droneX — report this after arming the drone\n"
            f"  ON_SCENE:droneX — report this when drone altitude > 40m and within 30m of target\n"
            f"\n"
            f"Do NOT report RESOLVED — the operator will handle that when they click the Resolve button.\n"
        )

        # Track which statuses we've already applied for this incident
        applied_statuses = set()
        current_drone = [None]  # mutable container for closure

        async def on_streaming_text(accumulated_text: str):
            """Called as AI text streams in — parse status tags in real-time."""
            import re
            text_lower = accumulated_text.lower()

            # Extract drone name
            dispatched_match = re.search(r'dispatched\s*:\s*(drone\d+)', text_lower)
            onscene_match = re.search(r'on_scene\s*:\s*(drone\d+)', text_lower)

            if dispatched_match:
                current_drone[0] = dispatched_match.group(1)
            elif onscene_match:
                current_drone[0] = onscene_match.group(1)

            drone_name = current_drone[0]
            if not drone_name:
                return

            # Apply DISPATCHED when we first see it
            if dispatched_match and "dispatched" not in applied_statuses:
                applied_statuses.add("dispatched")
                await self.update_incident(inc_id, "dispatched", drone_name)
                self.log(f"STATUS {inc_id} → dispatched to {drone_name}")

            # Apply ON_SCENE when we first see it (after DISPATCHED)
            if onscene_match and "on_scene" not in applied_statuses:
                applied_statuses.add("on_scene")
                await self.update_incident(inc_id, "on_scene", drone_name)
                self.log(f"STATUS {inc_id} → on_scene ({drone_name})")

        response = await self.send_to_ai(message, on_text=on_streaming_text)

        if response:
            self.log(f"AI COMPLETED for {inc_id}: {response[:200]}")
            # Final pass in case streaming missed anything
            import re
            text_lower = response.lower()
            dispatched_match = re.search(r'dispatched\s*:\s*(drone\d+)', text_lower)
            onscene_match = re.search(r'on_scene\s*:\s*(drone\d+)', text_lower)
            
            drone_name = current_drone[0]
            if not drone_name and dispatched_match:
                drone_name = dispatched_match.group(1)
            if not drone_name and onscene_match:
                drone_name = onscene_match.group(1)
            
            if drone_name and "dispatched" not in applied_statuses:
                await self.update_incident(inc_id, "dispatched", drone_name)
                self.log(f"STATUS {inc_id} → dispatched to {drone_name}")
            if drone_name and onscene_match and "on_scene" not in applied_statuses:
                await self.update_incident(inc_id, "on_scene", drone_name)
                self.log(f"STATUS {inc_id} → on_scene ({drone_name})")
            if not drone_name:
                self.log(f"WARNING: AI responded but couldn't extract drone name")
        else:
            self.log(f"ERROR: No AI response for {inc_id}")

    async def poll_loop(self):
        """Main loop: poll for new incidents and send to AI."""
        self.running = True
        self.active_tasks: set[asyncio.Task] = set()
        self.log("BRIDGE ONLINE — PAUSED")

        while self.running:
            if not self.paused:
                incidents = await self.get_active_incidents()
                new_incidents = [
                    inc for inc in incidents
                    if inc["id"] not in self.seen_incidents and inc["status"] == "new"
                ]

                for inc in new_incidents:
                    # Only mark as seen AFTER processing, so dropped incidents get retried
                    await self.process_incident(inc)
                    self.seen_incidents.add(inc["id"])
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
            "session_mode": bridge.session_mode,
            "model": bridge.model,
            "seen_count": len(bridge.seen_incidents),
            "activity_log": bridge.activity_log[-20:],
        }))

    async def post_pause(request):
        bridge.paused = True
        bridge.log("BRIDGE PAUSED")
        return cors(web.json_response({"paused": True}))

    async def post_resume(request):
        bridge.paused = False
        bridge.log("BRIDGE RESUMED")
        return cors(web.json_response({"paused": False}))

    async def post_toggle(request):
        bridge.paused = not bridge.paused
        state = "PAUSED" if bridge.paused else "RESUMED"
        bridge.log(f"BRIDGE {state}")
        # Also toggle dispatch service
        try:
            import aiohttp as _aiohttp
            async with _aiohttp.ClientSession() as s:
                endpoint = "pause" if bridge.paused else "resume"
                await s.post(f"http://127.0.0.1:8081/api/dispatch/{endpoint}")
        except Exception:
            pass
        return cors(web.json_response({"paused": bridge.paused}))

    async def get_session_mode(request):
        return cors(web.json_response({"session_mode": bridge.session_mode}))

    async def post_session_mode(request):
        data = await request.json()
        mode = data.get("mode", "main")
        if mode not in ("main", "isolated"):
            return cors(web.json_response({"error": "mode must be 'main' or 'isolated'"}, status=400))
        bridge.session_mode = mode
        bridge.log(f"SESSION MODE → {mode}")
        return cors(web.json_response({"session_mode": bridge.session_mode}))

    async def get_model(request):
        return cors(web.json_response({"model": bridge.model}))

    async def post_model(request):
        data = await request.json()
        model = data.get("model", "")
        if not model:
            return cors(web.json_response({"error": "model is required"}, status=400))
        bridge.model = model
        bridge.log(f"MODEL → {model}")
        return cors(web.json_response({"model": bridge.model}))

    async def handle_options(request):
        return cors(web.json_response({}))

    app = web.Application()
    app.router.add_get("/api/bridge/status", get_status)
    app.router.add_post("/api/bridge/pause", post_pause)
    app.router.add_post("/api/bridge/resume", post_resume)
    app.router.add_post("/api/bridge/toggle", post_toggle)
    app.router.add_get("/api/bridge/session-mode", get_session_mode)
    app.router.add_post("/api/bridge/session-mode", post_session_mode)
    app.router.add_get("/api/bridge/model", get_model)
    app.router.add_post("/api/bridge/model", post_model)
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
