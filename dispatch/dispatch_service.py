#!/usr/bin/env python3
"""
Dispatch Service — a minimal 911 CAD (Computer-Aided Dispatch) system.

Generates simulated emergency incidents and exposes them via:
  1. REST API (for AI agent / consumers to poll)
  2. rosbridge (publishes to /dispatch/incidents for the frontend)

This service does NOT know about drones or AI. It just manages incidents.
Consumers decide what to do with them.
"""

import asyncio
import json
import random
import time
import uuid
from datetime import datetime, timezone

import roslibpy

from incident_types import INCIDENT_TYPES
from locations import LANDMARKS, ROADS, INTERSECTIONS

# --- Config ---
ROSBRIDGE_HOST = "localhost"
ROSBRIDGE_PORT = 9090
INCIDENT_INTERVAL_MIN = 120  # seconds between incidents (min)
INCIDENT_INTERVAL_MAX = 180  # seconds between incidents (max)
MAX_ACTIVE_INCIDENTS = 4     # cap to keep things manageable


class Incident:
    """A single 911 incident."""
    _counter = 0  # Class variable for sequential IDs

    def __init__(self, incident_type: dict, location: dict, description: str):
        Incident._counter += 1
        self.id = f"{Incident._counter:03d}"  # Simple: 001, 002, 003
        self.type = incident_type["type"]
        self.priority = incident_type["priority"]
        self.description = description
        self.location = location  # {"name": str, "x": float, "y": float}
        self.status = "new"  # new → dispatched → on_scene → resolved
        self.created_at = datetime.now(timezone.utc).isoformat()
        self.updated_at = self.created_at
        self.assigned_to = None  # consumer sets this

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "type": self.type,
            "priority": self.priority,
            "description": self.description,
            "location": self.location,
            "status": self.status,
            "created_at": self.created_at,
            "updated_at": self.updated_at,
            "assigned_to": self.assigned_to,
        }

    # Status progression order — can only move forward
    STATUS_ORDER = {"new": 0, "dispatched": 1, "on_scene": 2, "returning": 3, "resolved": 4}

    def update_status(self, status: str, assigned_to: str = None):
        current_rank = self.STATUS_ORDER.get(self.status, -1)
        new_rank = self.STATUS_ORDER.get(status, -1)
        if new_rank > current_rank:
            self.status = status
        self.updated_at = datetime.now(timezone.utc).isoformat()
        if assigned_to:
            self.assigned_to = assigned_to


class DispatchService:
    """Manages the incident queue and publishes state."""

    def __init__(self):
        self.incidents: dict[str, Incident] = {}
        self.ros_client = None
        self.incident_topic = None
        self._running = False
        self._paused = True  # Start paused by default
        self._mode = "manual"  # "auto" or "manual" — manual requires trigger button

    def generate_incident(self) -> Incident:
        """Generate a random 911 incident."""
        itype = random.choice(INCIDENT_TYPES)
        location = random.choice(LANDMARKS)

        # Fill in template placeholders
        template = random.choice(itype["templates"])
        description = template.format(
            location=location["name"],
            age=random.randint(18, 85),
            gender=random.choice(["male", "female"]),
            road=random.choice(ROADS),
            intersection=random.choice(INTERSECTIONS),
        )

        return Incident(itype, location, description)

    def get_active_incidents(self) -> list[dict]:
        """Return all non-resolved incidents."""
        return [
            inc.to_dict()
            for inc in self.incidents.values()
            if inc.status != "resolved"
        ]

    def get_all_incidents(self) -> list[dict]:
        """Return all incidents."""
        return [inc.to_dict() for inc in self.incidents.values()]

    def update_incident(self, incident_id: str, status: str, assigned_to: str = None) -> bool:
        """Update an incident's status. Called by consumers (AI agent)."""
        if incident_id not in self.incidents:
            return False
        self.incidents[incident_id].update_status(status, assigned_to)
        self._publish_state()
        return True

    def _publish_state(self):
        """Publish current incident state to rosbridge."""
        if not self.incident_topic or not self.ros_client or not self.ros_client.is_connected:
            return
        msg = roslibpy.Message({
            "data": json.dumps(self.get_all_incidents())
        })
        self.incident_topic.publish(msg)

    async def _connect_rosbridge(self):
        """Connect to rosbridge and set up topics."""
        try:
            self.ros_client = roslibpy.Ros(host=ROSBRIDGE_HOST, port=ROSBRIDGE_PORT)
            self.ros_client.run()
            self.incident_topic = roslibpy.Topic(
                self.ros_client,
                "/dispatch/incidents",
                "std_msgs/msg/String",
            )
            print(f"[dispatch] Connected to rosbridge at {ROSBRIDGE_HOST}:{ROSBRIDGE_PORT}")
        except Exception as e:
            print(f"[dispatch] Failed to connect to rosbridge: {e}")
            print("[dispatch] Running without rosbridge (API-only mode)")

    async def _incident_loop(self):
        """Main loop: generate incidents on a timer (auto mode only)."""
        while self._running:
            if not self._paused and self._mode == "auto":
                active_count = len([i for i in self.incidents.values() if i.status != "resolved"])

                if active_count < MAX_ACTIVE_INCIDENTS:
                    incident = self.generate_incident()
                    self.incidents[incident.id] = incident
                    print(f"[dispatch] NEW INCIDENT: {incident.id} — P{incident.priority} {incident.type}: {incident.description}")
                    self._publish_state()

            delay = random.randint(INCIDENT_INTERVAL_MIN, INCIDENT_INTERVAL_MAX)
            await asyncio.sleep(delay)

    async def _monitor_returning_drones(self):
        """Poll drones assigned to 'returning' incidents. Mark resolved when landed."""
        import subprocess
        while self._running:
            for inc in list(self.incidents.values()):
                if inc.status != "returning" or not inc.assigned_to:
                    continue
                drone_name = inc.assigned_to
                try:
                    result = subprocess.run(
                        ["python3", "-u", "-c", f"""
import sys
sys.path.insert(0, '/root/ws_droneOS')
import drone_control as dc
dc.set_drone_name('{drone_name}')
s = dc.get_state()
armed = s.get('arming_state', 'UNKNOWN')
alt = -(s.get('local_z', 0))
print(f'{{armed}} {{alt:.1f}}')
"""],
                        capture_output=True, text=True, timeout=10
                    )
                    if result.returncode == 0 and result.stdout.strip():
                        parts = result.stdout.strip().split()
                        armed_state = parts[0]
                        altitude = float(parts[1])
                        if armed_state == "DISARMED" and altitude < 2.0:
                            self.update_incident(inc.id, "resolved", drone_name)
                            print(f"[dispatch] RESOLVED: {inc.id} → resolved ({drone_name} landed)")
                except Exception as e:
                    print(f"[dispatch] Monitor error for {inc.id}: {e}")
            await asyncio.sleep(5)

    async def run(self):
        """Start the dispatch service."""
        print("[dispatch] Starting dispatch service (PAUSED by default)...")
        await self._connect_rosbridge()
        self._running = True
        # Run both loops concurrently
        await asyncio.gather(
            self._incident_loop(),
            self._monitor_returning_drones()
        )

    def pause(self):
        """Pause incident generation."""
        self._paused = True
        print("[dispatch] PAUSED — no new incidents will be generated")

    def resume(self):
        """Resume incident generation."""
        self._paused = False
        print("[dispatch] RESUMED — generating incidents")

    def clear_incidents(self):
        """Clear all incidents and reset state."""
        self.incidents.clear()
        print("[dispatch] CLEARED — all incidents removed")
        self._publish_state()

    def trigger_incident(self) -> dict:
        """Manually trigger a new incident (bypasses pause state and timer)."""
        incident = self.generate_incident()
        self.incidents[incident.id] = incident
        print(f"[dispatch] TRIGGERED: {incident.id} — P{incident.priority} {incident.type}: {incident.description}")
        self._publish_state()
        return incident.to_dict()

    def set_mode(self, mode: str) -> bool:
        """Set dispatch mode: 'auto' or 'manual'."""
        if mode not in ("auto", "manual"):
            return False
        self._mode = mode
        print(f"[dispatch] Mode → {mode}")
        return True

    def get_status(self) -> dict:
        """Return current service status."""
        return {
            "paused": self._paused,
            "running": self._running,
            "mode": self._mode,
            "total_incidents": len(self.incidents),
            "active_incidents": len([i for i in self.incidents.values() if i.status != "resolved"]),
        }

    def stop(self):
        """Stop the dispatch service."""
        self._running = False
        if self.ros_client:
            self.ros_client.terminate()
        print("[dispatch] Stopped.")


# --- REST API (lightweight, using aiohttp) ---
from aiohttp import web


def create_api(dispatch: DispatchService) -> web.Application:
    """Create a simple REST API for the dispatch service."""

    def cors_response(data, status=200):
        resp = web.json_response(data, status=status)
        resp.headers["Access-Control-Allow-Origin"] = "*"
        resp.headers["Access-Control-Allow-Methods"] = "GET, PATCH, OPTIONS"
        resp.headers["Access-Control-Allow-Headers"] = "Content-Type"
        return resp

    async def get_incidents(request):
        return cors_response(dispatch.get_all_incidents())

    async def get_active_incidents(request):
        return cors_response(dispatch.get_active_incidents())

    async def update_incident(request):
        data = await request.json()
        incident_id = request.match_info["id"]
        success = dispatch.update_incident(
            incident_id,
            data.get("status", ""),
            data.get("assigned_to"),
        )
        if success:
            return cors_response({"ok": True})
        return cors_response({"ok": False, "error": "not found"}, status=404)

    async def get_status(request):
        return cors_response(dispatch.get_status())

    async def pause_dispatch(request):
        dispatch.pause()
        return cors_response(dispatch.get_status())

    async def resume_dispatch(request):
        dispatch.resume()
        return cors_response(dispatch.get_status())

    async def clear_incidents(request):
        dispatch.clear_incidents()
        return cors_response(dispatch.get_status())

    async def trigger_incident(request):
        incident = dispatch.trigger_incident()
        return cors_response(incident)

    async def get_mode(request):
        return cors_response({"mode": dispatch._mode})

    async def set_mode(request):
        data = await request.json()
        mode = data.get("mode", "")
        if dispatch.set_mode(mode):
            return cors_response(dispatch.get_status())
        return cors_response({"error": "mode must be 'auto' or 'manual'"}, status=400)

    async def resolve_incident(request):
        """Resolve an incident by issuing RTL to the assigned drone."""
        incident_id = request.match_info["incident_id"]
        
        if incident_id not in dispatch.incidents:
            return cors_response({"ok": False, "error": "incident not found"}, status=404)
        
        incident = dispatch.incidents[incident_id]
        
        if incident.status not in ("dispatched", "on_scene"):
            return cors_response({"ok": False, "error": "incident must be dispatched or on_scene to resolve"}, status=400)
        
        if not incident.assigned_to:
            return cors_response({"ok": False, "error": "no drone assigned"}, status=400)
        
        drone_name = incident.assigned_to
        
        # Update status to returning
        dispatch.update_incident(incident_id, "returning", drone_name)
        
        # Issue RTL command
        import subprocess
        try:
            result = subprocess.run(
                ["python3", "/root/ws_droneOS/drone_control.py", "--drone", drone_name, "--rtl"],
                capture_output=True,
                text=True,
                timeout=10
            )
            if result.returncode == 0:
                return cors_response({"ok": True, "drone": drone_name, "status": "returning"})
            else:
                return cors_response({
                    "ok": False,
                    "error": f"RTL command failed: {result.stderr}"
                }, status=500)
        except subprocess.TimeoutExpired:
            return cors_response({"ok": False, "error": "RTL command timeout"}, status=500)
        except Exception as e:
            return cors_response({"ok": False, "error": str(e)}, status=500)

    async def handle_options(request):
        return cors_response({})

    app = web.Application()
    app.router.add_get("/api/incidents", get_incidents)
    app.router.add_get("/api/incidents/active", get_active_incidents)
    app.router.add_patch("/api/incidents/{id}", update_incident)
    app.router.add_get("/api/dispatch/status", get_status)
    app.router.add_post("/api/dispatch/pause", pause_dispatch)
    app.router.add_post("/api/dispatch/resume", resume_dispatch)
    app.router.add_post("/api/dispatch/clear", clear_incidents)
    app.router.add_post("/api/dispatch/trigger", trigger_incident)
    app.router.add_post("/api/dispatch/resolve/{incident_id}", resolve_incident)
    app.router.add_get("/api/dispatch/mode", get_mode)
    app.router.add_post("/api/dispatch/mode", set_mode)
    app.router.add_options("/api/incidents/{id}", handle_options)
    app.router.add_options("/api/dispatch/pause", handle_options)
    app.router.add_options("/api/dispatch/resume", handle_options)
    app.router.add_options("/api/dispatch/clear", handle_options)
    app.router.add_options("/api/dispatch/trigger", handle_options)
    app.router.add_options("/api/dispatch/resolve/{incident_id}", handle_options)
    app.router.add_options("/api/dispatch/mode", handle_options)
    return app


async def main():
    dispatch = DispatchService()

    # Start REST API
    app = create_api(dispatch)
    runner = web.AppRunner(app)
    await runner.setup()
    site = web.TCPSite(runner, "0.0.0.0", 8081)
    await site.start()
    print("[dispatch] REST API running on :8081")

    # Start dispatch loop
    try:
        await dispatch.run()
    except KeyboardInterrupt:
        dispatch.stop()
        await runner.cleanup()


if __name__ == "__main__":
    asyncio.run(main())
