#!/usr/bin/env python3
"""
Dispatch Bridge — connects the CAD system to the AI agent (OpenClaw).

Polls for new incidents → sends to AI via gateway WebSocket → updates status.
Has pause/resume control via REST API on :8082.
"""

import asyncio
import json
import time
import aiohttp
from aiohttp import web

# --- Config ---
DISPATCH_API = "http://localhost:8081"
OPENCLAW_WS = "ws://localhost:18789"
POLL_INTERVAL = 5  # seconds between polls
AI_TIMEOUT = 120   # seconds to wait for AI response

class DispatchBridge:
    def __init__(self):
        self.paused = True  # Start paused by default — no tokens wasted
        self.running = False
        self.seen_incidents = set()  # Track which incidents we've already sent to AI
        self.ws = None
        self.session = None
        self.activity_log = []  # Recent activity for frontend

    def log(self, msg: str):
        entry = {"time": time.time(), "message": msg}
        self.activity_log.append(entry)
        # Keep last 50 entries
        if len(self.activity_log) > 50:
            self.activity_log = self.activity_log[-50:]
        print(f"[bridge] {msg}")

    async def connect_gateway(self):
        """Connect to OpenClaw gateway WebSocket."""
        try:
            if not self.session:
                self.session = aiohttp.ClientSession()
            self.ws = await self.session.ws_connect(OPENCLAW_WS)
            self.log("Connected to OpenClaw gateway")
            return True
        except Exception as e:
            self.log(f"Failed to connect to gateway: {e}")
            return False

    async def send_to_ai(self, message: str) -> str | None:
        """Send a message to the AI and wait for response."""
        if not self.ws or self.ws.closed:
            if not await self.connect_gateway():
                return None

        try:
            payload = {
                "method": "chat.send",
                "params": {"message": message},
                "id": f"dispatch-{int(time.time())}",
            }
            await self.ws.send_json(payload)

            # Wait for response
            async for msg in self.ws:
                if msg.type == aiohttp.WSMsgType.TEXT:
                    data = json.loads(msg.data)
                    if "result" in data:
                        return data["result"].get("response", "")
                elif msg.type in (aiohttp.WSMsgType.ERROR, aiohttp.WSMsgType.CLOSED):
                    self.log("WebSocket closed/error during AI response")
                    return None
        except asyncio.TimeoutError:
            self.log("AI response timed out")
            return None
        except Exception as e:
            self.log(f"Error communicating with AI: {e}")
            return None

    async def inject_to_ai(self, message: str):
        """Inject a message into AI transcript without triggering a response."""
        if not self.ws or self.ws.closed:
            if not await self.connect_gateway():
                return

        try:
            payload = {
                "method": "chat.inject",
                "params": {"message": message},
                "id": f"inject-{int(time.time())}",
            }
            await self.ws.send_json(payload)
        except Exception as e:
            self.log(f"Error injecting to AI: {e}")

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
        """Get active incidents from dispatch service."""
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

        # Get fleet status for context
        fleet_info = "drone1: AVAILABLE, drone2: AVAILABLE"  # TODO: get real fleet state

        message = (
            f"DISPATCH ALERT — NEW INCIDENT:\n"
            f"  ID: {inc_id}\n"
            f"  Type: {incident['type']} (Priority {incident['priority']})\n"
            f"  Description: {incident['description']}\n"
            f"  Location: {incident['location']['name']} "
            f"(x={incident['location']['x']}, y={incident['location']['y']})\n"
            f"\n"
            f"Fleet status: {fleet_info}\n"
            f"\n"
            f"Decide which drone to dispatch. Use drone_control.py to fly it there.\n"
            f"When done, say DISPATCHED:<drone_name> so I can update the incident status."
        )

        response = await self.send_to_ai(message)

        if response:
            self.log(f"🧠 AI response for {inc_id}: {response[:200]}")

            # Check if AI dispatched a drone
            if "DISPATCHED:" in response.upper():
                drone = response.upper().split("DISPATCHED:")[1].strip().split()[0]
                await self.update_incident(inc_id, "dispatched", drone.lower())
                self.log(f"🛸 {inc_id} dispatched to {drone}")
        else:
            self.log(f"⚠️ No AI response for {inc_id}")

    async def poll_loop(self):
        """Main loop: poll for new incidents and send to AI."""
        self.running = True
        self.log("Bridge started (PAUSED — toggle via API)")

        while self.running:
            if not self.paused:
                incidents = await self.get_active_incidents()
                new_incidents = [
                    inc for inc in incidents
                    if inc["id"] not in self.seen_incidents and inc["status"] == "new"
                ]

                for inc in new_incidents:
                    self.seen_incidents.add(inc["id"])
                    await self.process_incident(inc)

            await asyncio.sleep(POLL_INTERVAL)

    def stop(self):
        self.running = False
        if self.ws:
            asyncio.create_task(self.ws.close())
        if self.session:
            asyncio.create_task(self.session.close())


# --- Control API on :8082 ---
def create_control_api(bridge: DispatchBridge) -> web.Application:
    """REST API to control the bridge (pause/resume/status)."""

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
    # CORS preflight
    app.router.add_options("/api/bridge/{path:.*}", handle_options)
    return app


async def main():
    bridge = DispatchBridge()

    # Start control API
    app = create_control_api(bridge)
    runner = web.AppRunner(app)
    await runner.setup()
    site = web.TCPSite(runner, "0.0.0.0", 8082)
    await site.start()
    print("[bridge] Control API running on :8082")

    # Start poll loop
    try:
        await bridge.poll_loop()
    except KeyboardInterrupt:
        bridge.stop()
        await runner.cleanup()


if __name__ == "__main__":
    asyncio.run(main())
