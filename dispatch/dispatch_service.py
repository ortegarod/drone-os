#!/usr/bin/env python3
"""
Dispatch Service — a minimal 911 CAD (Computer-Aided Dispatch) system.

Generates simulated emergency incidents and exposes them via a REST API
(the command center UI and the AI bridge poll it).

It only touches drones through the fleet API (droneos SDK): it watches the
assigned drone's position to mark incidents on scene, and sends it home when
the incident resolves.

It is also the Dispatch plugin (plugins/dispatch/droneos-plugin.json): sending a drone
to an incident is a job, started through the fleet API (POST /api/v1/drones/{name}/job
{"plugin": "dispatch", "args": {"incident_id": "001"}}). The fleet API hands the drone's
control to operator "dispatch" and calls POST /jobs here; we fly it there (climb to 50 m,
then go), and end the job when the incident is resolved and the drone is sent home.
"""

import asyncio
import json
import os
import random
import threading
import time
import uuid
from datetime import datetime, timezone

from droneos import Client, Drone, DroneError

from incident_types import INCIDENT_TYPES
from locations import LANDMARKS, ROADS, INTERSECTIONS

# --- Config ---
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
        self.job = None          # fleet API job id when sent as a Dispatch job

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
            "job": self.job,
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
        self.fleet = Client()  # fleet API; config from DRONEOS_API/DRONEOS_TOKEN or ~/.config/droneos/client.json
        self._running = False
        self._paused = False  # Start active — toggle button controls pause/resume
        self._mode = "manual"  # "auto" or "manual" — manual requires trigger button

    def generate_incident(self) -> Incident:
        """Generate a random 911 incident, avoiding recently used locations."""
        itype = random.choice(INCIDENT_TYPES)
        
        # Avoid locations used by active incidents
        active_locations = {inc.location.get("name") for inc in self.incidents.values() if inc.status != "resolved"}
        available = [loc for loc in LANDMARKS if loc["name"] not in active_locations]
        if not available:
            available = LANDMARKS
        location = random.choice(available)

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
        """Hook for pushing incident updates; consumers poll the REST API instead."""
        return

    # -- drones (through the fleet API) -------------------------------------

    def _drone_position(self, drone_name):
        """(north, east) of a drone in meters from home, or None."""
        try:
            d = self.fleet.request("GET", f"/api/v1/drones/{drone_name}")
        except DroneError:
            return None
        if not d.get("online"):
            return None
        return d["position"]["north"], d["position"]["east"]

    # -- Dispatch jobs (the fleet API starts them) ----------------------------

    def start_job(self, job: dict, args: dict) -> dict:
        """Fleet API asks us to run a Dispatch job: send job['drone'] to args['incident_id']."""
        inc = self.incidents.get(str(args.get("incident_id", "")))
        if inc is None:
            raise ValueError(f"no incident {args.get('incident_id')}")
        if inc.status == "resolved":
            raise ValueError(f"incident {inc.id} is already resolved")
        if inc.job:
            raise ValueError(f"incident {inc.id} already has a drone ({inc.assigned_to})")
        drone, alt = job["drone"], float(args.get("altitude", 50.0))
        inc.job = job["id"]
        inc.status, inc.assigned_to = "new", drone   # forward from here
        self.update_incident(inc.id, "dispatched", drone)
        threading.Thread(target=self._fly_to, args=(inc, job, alt), daemon=True).start()
        where = inc.location.get("name", "")
        return {"text": f"P{inc.priority} {inc.type.replace('_', ' ')} at {where}", "links": {"incident": inc.id}}

    def _fly_to(self, inc, job, alt):
        d = Drone(job["drone"], self.fleet)
        try:
            s = d.state()
            if not s["armed"] or (s["position"]["altitude"] or 0) < alt - 5:
                d.takeoff(alt)   # trees reach ~40 m: climb first (waits until there)
            d.goto(inc.location.get("x", 0), inc.location.get("y", 0), wait=False)
            print(f"[dispatch] JOB {job['id']}: {job['drone']} on its way to {inc.id}")
        except DroneError as e:
            print(f"[dispatch] JOB {job['id']} failed: {e}")
            self._reopen(inc, f"{job['drone']} could not fly there: {e}")
            self.end_job(job["drone"], job["id"], "failed", str(e))

    def end_job(self, drone, job_id, result, reason):
        try:
            self.fleet.request("DELETE", f"/api/v1/drones/{drone}/job", {"id": job_id, "result": result, "reason": reason})
        except DroneError as e:
            print(f"[dispatch] ending job {job_id}: {e}")   # already ended (stopped by an operator)

    def _reopen(self, inc, why):
        """The drone was taken off the incident: it needs a drone again."""
        if inc.status != "resolved":
            inc.status, inc.assigned_to = "new", None
            inc.updated_at = datetime.now(timezone.utc).isoformat()
        inc.job = None
        print(f"[dispatch] REOPENED {inc.id}: {why}")
        self._publish_state()

    def job_stopped(self, job_id, reason):
        for inc in self.incidents.values():
            if inc.job == job_id:
                self._reopen(inc, f"job stopped: {reason}")
                return True
        return False

    def resolve(self, inc, why):
        """Incident done: resolve it, send the drone home, end its job."""
        drone, job = inc.assigned_to, inc.job
        self.update_incident(inc.id, "resolved", drone)
        if drone:
            self.send_home(drone)
        if job:
            inc.job = None
            self.end_job(drone, job, "completed", f"incident {inc.id} resolved ({why}); returning home")

    def send_home(self, drone_name):
        """Return-home is a safety command: the API accepts it whoever holds the drone."""
        try:
            self.fleet.request("POST", f"/api/v1/drones/{drone_name}/return_home", {})
            return True
        except DroneError as e:
            print(f"[dispatch] return_home failed for {drone_name}: {e}")
            return False

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

    async def _monitor_on_scene(self):
        """Auto-resolve incidents when the assigned drone arrives at the target.
        
        Watches the assigned drone through the fleet API. When it is within 15 m of
        the target, marks on_scene. After 30 s, sends it home and resolves.
        """
        import math
        
        arrival_times: dict[str, float] = {}
        
        while self._running:
            for inc in list(self.incidents.values()):
                if inc.status == "resolved" or not inc.assigned_to:
                    continue
                
                drone_name = inc.assigned_to
                target_x = inc.location.get("x", 0)
                target_y = inc.location.get("y", 0)
                
                pos = await asyncio.to_thread(self._drone_position, drone_name)
                if pos is None:
                    continue
                dist = math.hypot(pos[0] - target_x, pos[1] - target_y)
                
                if dist < 15:
                    if inc.id not in arrival_times:
                        arrival_times[inc.id] = time.time()
                        if inc.status == "dispatched":
                            self.update_incident(inc.id, "on_scene", drone_name)
                            print(f"[dispatch] ON_SCENE: {inc.id} ({drone_name}) — {dist:.0f}m from target. Auto-RTL in 30s")
                    
                    elapsed = time.time() - arrival_times[inc.id]
                    if elapsed >= 30:
                        print(f"[dispatch] AUTO-RESOLVE: {inc.id} ({drone_name}, {elapsed:.0f}s on scene) — sending RTL")
                        arrival_times.pop(inc.id, None)
                        await asyncio.to_thread(self.resolve, inc, f"{elapsed:.0f} s on scene")
                else:
                    if inc.id in arrival_times:
                        arrival_times.pop(inc.id, None)
            
            await asyncio.sleep(5)

    async def run(self):
        """Start the dispatch service."""
        print("[dispatch] Starting dispatch service (PAUSED by default)...")
        self._running = True
        await asyncio.gather(
            self._incident_loop(),
            self._monitor_on_scene(),
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
        print("[dispatch] Stopped.")


# --- REST API (lightweight, using aiohttp) ---
from aiohttp import web


def create_api(dispatch: DispatchService) -> web.Application:
    """Create a simple REST API for the dispatch service."""

    # Localhost only: operators reach it through the fleet API (/api/v1/plugins/dispatch/...).
    def reply(data, status=200):
        return web.json_response(data, status=status)

    async def get_incidents(request):
        return reply(dispatch.get_all_incidents())

    async def get_active_incidents(request):
        return reply(dispatch.get_active_incidents())

    async def update_incident(request):
        data = await request.json()
        incident_id = request.match_info["id"]
        success = dispatch.update_incident(
            incident_id,
            data.get("status", ""),
            data.get("assigned_to"),
        )
        if success:
            return reply({"ok": True})
        return reply({"ok": False, "error": "not found"}, status=404)

    async def get_status(request):
        return reply(dispatch.get_status())

    async def pause_dispatch(request):
        dispatch.pause()
        return reply(dispatch.get_status())

    async def resume_dispatch(request):
        dispatch.resume()
        return reply(dispatch.get_status())

    async def clear_incidents(request):
        dispatch.clear_incidents()
        return reply(dispatch.get_status())

    async def trigger_incident(request):
        incident = dispatch.trigger_incident()
        return reply(incident)

    async def get_mode(request):
        return reply({"mode": dispatch._mode})

    async def set_mode(request):
        data = await request.json()
        mode = data.get("mode", "")
        if dispatch.set_mode(mode):
            return reply(dispatch.get_status())
        return reply({"error": "mode must be 'auto' or 'manual'"}, status=400)

    async def resolve_incident(request):
        """Resolve an incident immediately and send the drone home (RTL).
        
        The incident is marked resolved right away — it's done.
        The drone gets RTL'd, but can still be rerouted by the AI
        if a new incident comes in while it's returning.
        """
        incident_id = request.match_info["incident_id"]
        
        if incident_id not in dispatch.incidents:
            return reply({"ok": False, "error": "incident not found"}, status=404)
        
        incident = dispatch.incidents[incident_id]
        
        if incident.status in ("resolved",):
            return reply({"ok": False, "error": "incident already resolved"}, status=400)
        
        drone_name = incident.assigned_to
        # Resolved now; the drone goes home (it can be rerouted later) and its job ends.
        await asyncio.to_thread(dispatch.resolve, incident, "by an operator")
        print(f"[dispatch] RESOLVED: {incident_id} (operator)")
        
        return reply({"ok": True, "drone": drone_name, "status": "resolved"})

    # -- plugin endpoints, called by the fleet API only ------------------------

    def from_fleet_api(request):
        return request.headers.get("X-DroneOS-Caller") == "fleet-api"

    async def post_job(request):
        if not from_fleet_api(request):
            return reply({"detail": "jobs are started through the fleet API"}, status=403)
        data = await request.json()
        try:
            out = await asyncio.to_thread(dispatch.start_job, data["job"], data.get("args") or {})
        except (KeyError, ValueError) as e:
            return reply({"detail": str(e)}, status=422)
        return reply(out)

    async def get_job(request):
        """The fleet API checks running jobs here: 200 while an incident has this job, 404 if not."""
        jid = request.match_info["jid"]
        inc = next((i for i in dispatch.incidents.values() if i.job == jid), None)
        if inc is None:
            return reply({"detail": f"no job {jid}"}, status=404)
        return reply({"id": jid, "running": True, "incident": inc.id})

    async def post_job_stopped(request):
        if not from_fleet_api(request):
            return reply({"detail": "fleet API only"}, status=403)
        data = await request.json()
        return reply({"ok": dispatch.job_stopped(request.match_info["jid"], data.get("reason", ""))})

    app = web.Application()
    async def get_ui(request):
        return web.FileResponse(os.path.join(os.path.dirname(os.path.abspath(__file__)), "ui", "job.js"),
                                headers={"Content-Type": "text/javascript"})

    app.router.add_get("/ui/job.js", get_ui)
    app.router.add_post("/jobs", post_job)
    app.router.add_get("/jobs/{jid}", get_job)
    app.router.add_post("/jobs/{jid}/stopped", post_job_stopped)
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
    return app


async def main():
    dispatch = DispatchService()

    # Start REST API
    app = create_api(dispatch)
    runner = web.AppRunner(app)
    await runner.setup()
    # Localhost only: the web UI reaches it through the frontend server's proxy.
    site = web.TCPSite(runner, os.environ.get("DISPATCH_BIND", "127.0.0.1"), 8081)
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
