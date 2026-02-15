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
POLL_INTERVAL = 2  # seconds between polls

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
        self.paused = False  # Start active — toggle button controls pause/resume
        self.running = False
        self.session_mode = "isolated"  # "main" or "isolated" — isolated enables concurrent dispatch
        self.model = "anthropic/claude-sonnet-4-5"  # Model for dispatch sessions
        self.seen_incidents = set()
        self.reserved_drones = set()  # Drones claimed by in-progress dispatches
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

    async def unassign_drone_from_other_incidents(self, drone_name: str, current_incident_id: str):
        """When a drone is rerouted, mark its old incident(s) as unassigned."""
        try:
            incidents = await self.get_active_incidents()
            for inc in incidents:
                if (inc.get("assigned_to") == drone_name
                        and inc["id"] != current_incident_id
                        and inc["status"] in ("dispatched", "on_scene")):
                    self.log(f"Incident #{inc['id']} unassigned — {drone_name} rerouted to #{current_incident_id}")
                    await self.update_incident(inc["id"], "unassigned")
        except Exception as e:
            self.log(f"Error unassigning drone: {e}")

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
        """Query all drones via drone_control.py and return a rich fleet status string.
        
        Derives status using the same logic as the frontend FleetDashboard:
        Ready / Armed / Takeoff / In Flight / Landing / Returning / Offline
        
        Cross-references with active incidents to show mission context.
        """
        import subprocess
        
        # First get active incidents for cross-referencing
        incident_by_drone = {}
        try:
            import urllib.request
            with urllib.request.urlopen("http://localhost:8081/api/incidents/active", timeout=3) as resp:
                incidents = json.loads(resp.read())
                for inc in incidents:
                    if inc.get("assigned_to") and inc["status"] in ("dispatched", "on_scene", "returning"):
                        incident_by_drone[inc["assigned_to"]] = inc
        except Exception:
            pass
        
        try:
            result = subprocess.run(
                ["python3", "-u", "-c", """
import sys, json, math
sys.path.insert(0, '/root/ws_droneOS')
import drone_control as dc

drones = []
for i in range(1, 6):
    name = f'drone{i}'
    try:
        dc.set_drone_name(name)
        s = dc.get_state()
        if s.get('nav_state') and s['nav_state'] != 'UNKNOWN':
            drones.append({
                'name': name,
                'arming_state': s.get('arming_state', 'UNKNOWN'),
                'nav_state': s.get('nav_state', 'UNKNOWN'),
                'x': s.get('local_x', 0),
                'y': s.get('local_y', 0),
                'z': s.get('local_z', 0),
                'battery': s.get('battery_remaining', 0),
            })
    except:
        pass

print(json.dumps(drones))
"""],
                capture_output=True, text=True, timeout=15
            )
            if result.returncode != 0 or not result.stdout.strip():
                return "  Fleet state unavailable"
            
            drones = json.loads(result.stdout.strip())
            if not drones:
                return "  No drones responding"
            
            lines = []
            for d in drones:
                name = d['name']
                armed = d['arming_state'] == 'ARMED'
                nav = (d.get('nav_state') or '').upper()
                alt = -d['z']
                airborne = alt > 1.0
                bat_pct = d['battery'] * 100
                
                # Derive status — same logic as frontend FleetDashboard
                if 'LAND' in nav:
                    status = 'LANDING'
                elif 'RTL' in nav or 'RETURN' in nav:
                    status = 'RETURNING'
                elif 'TAKEOFF' in nav:
                    status = 'TAKEOFF'
                elif armed and airborne:
                    status = 'IN FLIGHT'
                elif armed:
                    status = 'ARMED'
                else:
                    status = 'READY'
                
                # Mark reserved drones
                if name in self.reserved_drones:
                    status = 'RESERVED (dispatch in progress)'
                
                # Cross-reference with incident assignment
                mission_ctx = ""
                inc = incident_by_drone.get(name)
                if inc:
                    loc = inc.get('location', {})
                    mission_ctx = f" | mission: INC-{inc['id']} ({inc['status']}) at {loc.get('name', '?')} ({loc.get('x', '?')},{loc.get('y', '?')})"
                
                # Distance from home (0,0)
                dist_home = (d['x']**2 + d['y']**2) ** 0.5
                
                lines.append(
                    f"  {name}: {status} at ({d['x']:.0f}, {d['y']:.0f}) alt={alt:.0f}m "
                    f"bat={bat_pct:.0f}% dist_home={dist_home:.0f}m{mission_ctx}"
                )
            
            return "\n".join(lines)
        except Exception as e:
            return f"  Fleet state error: {e}"

    async def process_incident(self, incident: dict):
        """Send an incident to the AI for decision-making."""
        inc_id = incident["id"]

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

        target_x = incident['location']['x']
        target_y = incident['location']['y']
        
        message = (
            f"DISPATCH ALERT — NEW INCIDENT\n"
            f"  ID: {inc_id}\n"
            f"  Type: {incident['type']} (Priority {incident['priority']})\n"
            f"  Description: {incident['description']}\n"
            f"  Location: {incident['location']['name']} (x={target_x}, y={target_y})\n"
            f"\n"
            f"OTHER ACTIVE INCIDENTS:\n"
            f"{active_ctx}\n"
            f"\n"
            f"You are an autonomous drone dispatcher.\n"
            f"\n"
            f"PROCEDURE:\n"
            f"1. Check current drone states using drone_control.py:\n"
            f"   cd /root/ws_droneOS && python3 -c \"import drone_control; drone_control.set_drone_name('drone1'); print(drone_control.get_state())\"\n"
            f"   Repeat for drone2, drone3, etc.\n"
            f"2. Pick the CLOSEST available drone (DISARMED or RETURNING = available; ARMED/IN FLIGHT on other incidents = busy)\n"
            f"3. Dispatch it (TWO STEPS — climb first, then fly):\n"
            f"   Step A — climb to 50m altitude at current position:\n"
            f"   python3 -c \"import drone_control as dc; dc.set_drone_name('droneX'); s=dc.get_state(); dc.set_offboard(); dc.arm(); dc.set_position(s['local_x'], s['local_y'], -50)\"\n"
            f"   Step B — wait until altitude is above 45m (z < -45), then fly to target:\n"
            f"   python3 -c \"import drone_control as dc; dc.set_drone_name('droneX'); dc.set_position({target_x}, {target_y}, -50)\"\n"
            f"4. After dispatching step B, include DISPATCHED:droneX in your response\n"
            f"5. MONITOR THE DRONE — poll its position every 5 seconds until it arrives:\n"
            f"   python3 -c \"import drone_control as dc; dc.set_drone_name('droneX'); s=dc.get_state(); print(f'pos=({{s[\"local_x\"]:.1f}}, {{s[\"local_y\"]:.1f}}, {{s[\"local_z\"]:.1f}})')\"\n"
            f"   Target is ({target_x}, {target_y}). When drone is within 10m of target (check x/y distance), include ON_SCENE:droneX in your response.\n"
            f"   Report arrival: \"droneX arrived at [location name]\"\n"
            f"\n"
            f"NOTES:\n"
            f"- RETURNING drones can be rerouted: set_offboard() cancels RTL\n"
            f"- Skip drones with battery < 30%\n"
            f"- Z=-50 = 50m altitude (NED coords: Z is DOWN)\n"
            f"- Don't land or RTL after dispatch — auto-RTL triggers after 30s on scene\n"
            f"- If no drones available, reply NO_AVAILABLE_DRONES\n"
            f"\n"
            f"STATUS TAGS (include in your response):\n"
            f"  DISPATCHED:droneX — after successfully arming and sending position command\n"
            f"  ON_SCENE:droneX — when drone arrives within 10m of target\n"
            f"  NO_AVAILABLE_DRONES — if all drones busy or unavailable\n"
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
                self.reserved_drones.add(drone_name)
                await self.update_incident(inc_id, "dispatched", drone_name)
                await self.unassign_drone_from_other_incidents(drone_name, inc_id)

            # Apply ON_SCENE when we first see it — ensure DISPATCHED is set first
            if onscene_match and "on_scene" not in applied_statuses:
                if "dispatched" not in applied_statuses:
                    applied_statuses.add("dispatched")
                    self.reserved_drones.add(drone_name)
                    await self.update_incident(inc_id, "dispatched", drone_name)
                    await self.unassign_drone_from_other_incidents(drone_name, inc_id)
                applied_statuses.add("on_scene")
                await self.update_incident(inc_id, "on_scene", drone_name)

        response = await self.send_to_ai(message, on_text=on_streaming_text)

        if response:
            # Log the AI's response
            import re
            clean_response = re.sub(r'(?i)(DISPATCHED|ON_SCENE|NO_AVAILABLE_DRONES)\s*:\s*\w*', '', response).strip()
            if clean_response:
                self.log(clean_response)
            
            # Final pass in case streaming missed status tags
            text_lower = response.lower()
            dispatched_match = re.search(r'dispatched\s*:\s*(drone\d+)', text_lower)
            onscene_match = re.search(r'on_scene\s*:\s*(drone\d+)', text_lower)
            
            drone_name = current_drone[0]
            if not drone_name and dispatched_match:
                drone_name = dispatched_match.group(1)
            if not drone_name and onscene_match:
                drone_name = onscene_match.group(1)
            
            if drone_name and "dispatched" not in applied_statuses:
                self.reserved_drones.add(drone_name)
                await self.update_incident(inc_id, "dispatched", drone_name)
                await self.unassign_drone_from_other_incidents(drone_name, inc_id)
            if drone_name and onscene_match and "on_scene" not in applied_statuses:
                if "dispatched" not in applied_statuses:
                    applied_statuses.add("dispatched")
                    self.reserved_drones.add(drone_name)
                    await self.update_incident(inc_id, "dispatched", drone_name)
                    await self.unassign_drone_from_other_incidents(drone_name, inc_id)
                await self.update_incident(inc_id, "on_scene", drone_name)
            if not drone_name:
                self.log(f"No drone assigned for {inc_id}")
        else:
            self.log(f"No AI response for {inc_id}")
        
        # Release reservation when dispatch completes (drone is tracked by incident now)
        if current_drone[0] and current_drone[0] in self.reserved_drones:
            self.reserved_drones.discard(current_drone[0])

    async def poll_loop(self):
        """Main loop: poll for new incidents and send to AI."""
        self.running = True
        self.active_tasks: set[asyncio.Task] = set()

        self.log("AI DISPATCH ONLINE")

        while self.running:
            if not self.paused:
                incidents = await self.get_active_incidents()
                new_incidents = [
                    inc for inc in incidents
                    if inc["id"] not in self.seen_incidents and inc["status"] == "new"
                ]
                if new_incidents:
                    print(f"[bridge] Found {len(new_incidents)} new incident(s): {[i['id'] for i in new_incidents]}")

                for inc in new_incidents:
                    self.seen_incidents.add(inc["id"])
                    task = asyncio.create_task(self.process_incident(inc))
                    self.active_tasks.add(task)
                    task.add_done_callback(self.active_tasks.discard)
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
        bridge.log("AI DISPATCH PAUSED")
        return cors(web.json_response({"paused": True}))

    async def post_resume(request):
        bridge.paused = False
        bridge.log("AI DISPATCH RESUMED")
        return cors(web.json_response({"paused": False}))

    async def post_toggle(request):
        bridge.paused = not bridge.paused
        state = "PAUSED" if bridge.paused else "RESUMED"
        bridge.log(f"AI DISPATCH {state}")
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
