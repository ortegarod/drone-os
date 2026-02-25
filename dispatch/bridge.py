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

# --- Config (all overridable via env vars) ---
DISPATCH_API = os.environ.get("DISPATCH_API_URL", "http://localhost:8081")
POLL_INTERVAL = int(os.environ.get("DISPATCH_POLL_INTERVAL", "2"))
BRIDGE_PORT = int(os.environ.get("DISPATCH_BRIDGE_PORT", "8082"))
DISPATCH_MODEL = os.environ.get("DISPATCH_MODEL", "anthropic/claude-sonnet-4-6")

# --- Repo root (derived from script location) ---
REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

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
        self.model = DISPATCH_MODEL
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
        """Send a message to AI via OpenClaw HTTP Chat Completions API.
        
        Uses streaming to process status tags in real-time via on_text callback.
        """
        token = _load_gateway_token()
        gateway_http = GATEWAY_WS.replace("ws://", "http://").replace("wss://", "https://")
        url = f"{gateway_http}/v1/chat/completions"

        headers = {"Content-Type": "application/json"}
        if token:
            headers["Authorization"] = f"Bearer {token}"

        body = {
            "model": "openclaw",
            "messages": [{"role": "user", "content": message}],
            "stream": bool(on_text),
        }

        try:
            async with aiohttp.ClientSession() as session:
                async with session.post(url, json=body, headers=headers, timeout=aiohttp.ClientTimeout(total=300)) as resp:
                    if resp.status != 200:
                        error_text = await resp.text()
                        self.log(f"HTTP API error {resp.status}: {error_text[:200]}")
                        return None

                    if on_text:
                        # Streaming mode — parse SSE chunks
                        accumulated = []
                        async for line in resp.content:
                            line = line.decode("utf-8").strip()
                            if not line.startswith("data: "):
                                continue
                            data_str = line[6:]
                            if data_str == "[DONE]":
                                break
                            try:
                                chunk = json.loads(data_str)
                                delta = (chunk.get("choices", [{}])[0].get("delta", {}).get("content", ""))
                                if delta:
                                    accumulated.append(delta)
                                    try:
                                        await on_text("".join(accumulated))
                                    except Exception as e:
                                        self.log(f"on_text callback error: {e}")
                            except json.JSONDecodeError:
                                continue
                        return "".join(accumulated) if accumulated else None
                    else:
                        # Non-streaming mode
                        result = await resp.json()
                        choices = result.get("choices", [])
                        if choices:
                            return choices[0].get("message", {}).get("content", "")
                        return None

        except Exception as e:
            self.log(f"Gateway HTTP error: {e}")
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

    def get_fleet_state_sync(self, target_x=0, target_y=0) -> str:
        """Query all drones via droneos CLI. Returns fleet status sorted by distance to target."""
        import subprocess
        import math

        # Get active incidents for cross-referencing
        incident_by_drone = {}
        try:
            import urllib.request
            with urllib.request.urlopen(f"{DISPATCH_API}/api/incidents/active", timeout=3) as resp:
                incidents = json.loads(resp.read())
                for inc in incidents:
                    if inc.get("assigned_to") and inc["status"] in ("dispatched", "on_scene", "returning"):
                        incident_by_drone[inc["assigned_to"]] = inc
        except Exception:
            pass

        drones = []
        for i in range(1, 6):
            name = f"drone{i}"
            try:
                result = subprocess.run(
                    ["droneos", "--drone", name, "--get-state"],
                    capture_output=True, text=True, timeout=10
                )
                if result.returncode != 0:
                    continue
                s = json.loads(result.stdout)
                if not s.get("nav_state") or s["nav_state"] == "UNKNOWN":
                    continue

                armed = s.get("arming_state") == "ARMED"
                nav = (s.get("nav_state") or "").upper()
                x, y, z = s.get("local_x", 0), s.get("local_y", 0), s.get("local_z", 0)
                alt = -z
                bat_pct = s.get("battery_remaining", 0) * 100
                dist_target = math.sqrt((x - target_x)**2 + (y - target_y)**2)

                if "LAND" in nav:
                    status, avail = "LANDING", "no"
                elif "RTL" in nav or "RETURN" in nav:
                    status, avail = "RETURNING", "yes (reroutable)"
                elif "TAKEOFF" in nav:
                    status, avail = "TAKEOFF", "no"
                elif armed and alt > 1.0:
                    status, avail = "IN FLIGHT", "no"
                elif armed:
                    status, avail = "ARMED", "no"
                else:
                    status, avail = "READY", "yes"

                if name in self.reserved_drones:
                    status, avail = "RESERVED (dispatch in progress)", "no"
                if bat_pct < 30:
                    avail = "no (low battery)"

                mission_ctx = ""
                inc = incident_by_drone.get(name)
                if inc:
                    loc = inc.get("location", {})
                    mission_ctx = f" | mission: INC-{inc['id']} ({inc['status']}) at {loc.get('name', '?')} ({loc.get('x', '?')},{loc.get('y', '?')})"

                recommend = ""
                if avail.startswith("yes"):
                    recommend = " ★ AVAILABLE"

                drones.append((dist_target, name,
                    f"  {name}: {status} | pos=({x:.0f}, {y:.0f}) alt={alt:.0f}m | bat={bat_pct:.0f}% | dist_to_target={dist_target:.0f}m | available={avail}{mission_ctx}{recommend}"
                ))
            except Exception:
                pass

        drones.sort(key=lambda d: d[0])

        if not drones:
            return "  No drones responding"

        lines = [d[2] for d in drones]

        available = [(dist, name) for dist, name, _ in drones if "AVAILABLE" in _]
        if available:
            best = available[0]
            lines.append(f"\n  → RECOMMENDED: {best[1]} ({best[0]:.0f}m from target)")

        return "\n".join(lines)

    async def process_incident(self, incident: dict):
        """Send incident to fleet commander for decision + delegation to pilot sub-agent."""
        inc_id = incident["id"]

        # Gather context — pass target coords for distance calculation + sorting
        target_x = incident['location']['x']
        target_y = incident['location']['y']
        fleet_status = await asyncio.to_thread(self.get_fleet_state_sync, target_x, target_y)
        all_incidents = await self.get_active_incidents()

        incident_lines = []
        for inc in all_incidents:
            if inc["id"] == inc_id:
                continue
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
            f"  Location: {incident['location']['name']} (x={target_x}, y={target_y})\n"
            f"\n"
            f"FLEET STATUS (live):\n{fleet_status}\n"
            f"\n"
            f"OTHER ACTIVE INCIDENTS:\n{active_ctx}\n"
            f"\n"
            f"=== INSTRUCTIONS ===\n"
            f"You are the fleet commander. Act FAST — no unnecessary tool calls.\n"
            f"\n"
            f"Fleet status above is LIVE and sorted by distance to target. The RECOMMENDED drone is the best choice.\n"
            f"Trust the data — do NOT re-query fleet status.\n"
            f"\n"
            f"STEP 1: Pick the RECOMMENDED drone (or override if you have a good reason — e.g. P1 reroute).\n"
            f"\n"
            f"STEP 2: Run this ONE exec call (replace DRONE_NAME):\n"
            f"  /usr/local/bin/droneos --drone DRONE_NAME --set-offboard && /usr/local/bin/droneos --drone DRONE_NAME --arm && /usr/local/bin/droneos --drone DRONE_NAME --set-position {target_x} {target_y} -50\n"
            f"  Do NOT poll, monitor, or wait. The dispatch service handles arrival and RTL.\n"
            f"\n"
            f"STEP 3: Include DISPATCHED:droneX in your response.\n"
            f"  If no drones available: NO_AVAILABLE_DRONES\n"
            f"\n"
            f"ONE turn only: pick → exec → DISPATCHED.\n"
        )

        # Track status updates
        applied_statuses = set()
        current_drone = [None]

        async def on_streaming_text(accumulated_text: str):
            """Parse status tags from fleet commander response in real-time."""
            import re
            text_lower = accumulated_text.lower()

            dispatched_match = re.search(r'dispatched\s*:\s*(drone\d+)', text_lower)
            if dispatched_match:
                current_drone[0] = dispatched_match.group(1)

            drone_name = current_drone[0]
            if not drone_name:
                return

            if dispatched_match and "dispatched" not in applied_statuses:
                applied_statuses.add("dispatched")
                self.reserved_drones.add(drone_name)
                await self.update_incident(inc_id, "dispatched", drone_name)
                await self.unassign_drone_from_other_incidents(drone_name, inc_id)

        response = await self.send_to_ai(message, on_text=on_streaming_text)

        if response:
            import re
            clean_response = re.sub(r'(?i)(DISPATCHED|ON_SCENE|NO_AVAILABLE_DRONES)\s*:\s*\w*', '', response).strip()
            if clean_response:
                self.log(clean_response)

            # Final pass for missed tags
            text_lower = response.lower()
            dispatched_match = re.search(r'dispatched\s*:\s*(drone\d+)', text_lower)

            drone_name = current_drone[0]
            if not drone_name and dispatched_match:
                drone_name = dispatched_match.group(1)

            if drone_name and "dispatched" not in applied_statuses:
                self.reserved_drones.add(drone_name)
                await self.update_incident(inc_id, "dispatched", drone_name)
                await self.unassign_drone_from_other_incidents(drone_name, inc_id)
            if not drone_name:
                self.log(f"No drone assigned for {inc_id}")
        else:
            self.log(f"No AI response for {inc_id}")

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
                    def _on_done(t, iid=inc["id"]):
                        self.active_tasks.discard(t)
                        if t.exception():
                            print(f"[bridge] TASK ERROR for {iid}: {t.exception()}")
                    task.add_done_callback(_on_done)
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
