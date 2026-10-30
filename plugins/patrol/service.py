"""DroneOS patrol plugin: the cloud part of the Patrol job.

- Keeps each drone's patrol route (shared: the operator drags it on the map, the AI sets it).
- Starts a patrol job when the fleet API asks (POST /jobs): sends the route to the drone's
  onboard PATROL mode through the fleet API, then records a report (photo at every point).
- Ends the job in the fleet API when the drone has landed, with the result.

It flies only through the fleet API, as operator "patrol". Browsers and the CLI reach it through
the fleet API's /api/v1/plugins/patrol/... proxy, which sets X-DroneOS-Operator. Listens on
localhost only.

Run: uvicorn service:app --host 127.0.0.1 --port 8091
Env: PATROL_CONFIG (json {"api", "token"}), PATROL_REPORTS (dir), PATROL_ROUTES (json file), CAMERA_URL
"""

import asyncio
import json
import logging
import os
import threading
import time
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import Body, FastAPI, Header, HTTPException, Query
from fastapi.responses import FileResponse

import recorder as recmod
from droneos.client import Client, DroneError

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(name)s %(levelname)s %(message)s")
log = logging.getLogger("patrol")


class ApiFleet:
    """The two reads the recorder needs, over the fleet API."""

    def __init__(self, client):
        self.c = client

    def snapshot(self, drone):
        try:
            v = self.c.request("GET", f"/api/v1/drones/{drone}?raw=1", timeout=5)
        except DroneError:
            return None
        return v.get("raw") or {}, bool(v.get("online")), float(v.get("home_z") or 0.0)

    def mission_status(self, drone):
        return self.c.request("GET", f"/api/v1/drones/{drone}/patrol?raw=1", timeout=5)

MAX_POINTS = 50
RESULT = {"completed": "completed", "aborted": "stopped", "failed": "failed"}


class RouteStore:
    """One shared patrol route per drone: [[north, east], ...] meters from home. Kept on disk."""

    def __init__(self, path=None):
        self.path = Path(path).expanduser() if path else None
        self._lock = threading.Lock()
        self._routes = {}
        if self.path and self.path.exists():
            try:
                self._routes = json.loads(self.path.read_text())
            except (OSError, ValueError) as e:
                log.warning("ignoring unreadable routes %s: %s", self.path, e)

    def get(self, drone):
        with self._lock:
            r = self._routes.get(drone)
            return dict(r) if r else {"points": [], "operator": None, "updated": None}

    def all(self):
        with self._lock:
            return {k: dict(v) for k, v in self._routes.items()}

    def set(self, drone, points, operator):
        with self._lock:
            self._routes[drone] = {"points": [[round(float(n), 1), round(float(e), 1)] for n, e in points],
                                   "operator": operator, "updated": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())}
            if self.path:
                self.path.parent.mkdir(parents=True, exist_ok=True)
                tmp = self.path.with_suffix(".tmp")
                tmp.write_text(json.dumps(self._routes))
                tmp.replace(self.path)
            return dict(self._routes[drone])


def parse_route(points):
    if not isinstance(points, list) or len(points) > MAX_POINTS:
        raise ValueError(f"points must be a list of at most {MAX_POINTS} [north, east] pairs")
    out = []
    for p in points:
        if not isinstance(p, (list, tuple)) or len(p) != 2:
            raise ValueError("each point must be [north, east] in meters")
        n, e = float(p[0]), float(p[1])
        if n != n or e != e or abs(n) > 10000 or abs(e) > 10000:
            raise ValueError("point out of range")
        out.append((n, e))
    return out


def create_app(client=None, fleet=None, reports_dir=None, routes_path=None, fetch_photo=None, background=True):
    if client is None:
        cfg = json.loads(Path(os.environ.get("PATROL_CONFIG", "~/.config/droneos/patrol_plugin.json")).expanduser().read_text())
        client = Client(cfg.get("api", "http://127.0.0.1:8090"), cfg["token"])
    fleet = fleet or ApiFleet(client)
    routes = RouteStore(routes_path or os.environ.get("PATROL_ROUTES", "~/.local/state/droneos/patrol_routes.json"))

    def end_job(rep):
        """A report ended: end its job in the fleet API with the result."""
        job = rep.get("job")
        if not job:
            return
        try:
            client.request("DELETE", f"/api/v1/drones/{rep['drone']}/job",
                           {"id": job, "result": RESULT.get(rep["status"], "failed"), "reason": rep.get("summary", ""),
                            "links": {"report": rep["id"]}})
        except DroneError as e:
            if e.status != 404:  # 404: already ended (e.g. stopped by an operator)
                log.warning("ending job %s failed: %s", job, e)

    rec = recmod.PatrolRecorder(fleet, reports_dir or os.environ.get("PATROL_REPORTS", "~/.local/state/droneos/patrols"),
                                fetch_photo or recmod.http_snapshot(os.environ.get("CAMERA_URL", "http://127.0.0.1:8080")),
                                on_finish=end_job)
    stop = threading.Event()

    def on_event(e):
        """Fleet API event: PX4's own 'mode finished' events go into the drone's running report."""
        if e.get("operator") == "px4" and e.get("drone") and rec.active_for(e["drone"]):
            rec.note(e["drone"], e.get("message") or e.get("command"))

    def listen():
        """Follow the fleet API event stream (reconnects on its own)."""
        import websockets
        url = client.api.replace("http", "ws", 1) + "/api/v1/events?token=" + client._token

        async def run():
            while not stop.is_set():
                try:
                    async with websockets.connect(url, open_timeout=10, ping_interval=20) as ws:
                        log.info("listening to fleet API events")
                        async for msg in ws:
                            on_event(json.loads(msg))
                except Exception as ex:
                    log.warning("event stream: %s; reconnecting in 3 s", ex)
                    await asyncio.sleep(3)
        asyncio.run(run())

    def loop():
        while not stop.wait(recmod.POLL_S):
            try:
                rec.tick()
            except Exception:
                log.exception("patrol tick failed")

    @asynccontextmanager
    async def lifespan(app):
        if background:
            threading.Thread(target=loop, name="patrol-loop", daemon=True).start()
            threading.Thread(target=listen, name="patrol-events", daemon=True).start()
        yield
        stop.set()

    app = FastAPI(title="DroneOS patrol plugin", version="1.0", lifespan=lifespan)
    app.state.recorder, app.state.routes, app.state.on_event = rec, routes, on_event

    def who(x_droneos_operator: str | None):
        if not x_droneos_operator:
            raise HTTPException(401, "call through the fleet API (/api/v1/plugins/patrol/...)")
        return x_droneos_operator

    # -- called by the fleet API ----------------------------------------------

    @app.post("/jobs")
    def start_job(job: dict = Body(...), args: dict = Body(default={}), x_droneos_caller: str = Header(default="")):
        if x_droneos_caller != "fleet-api":
            raise HTTPException(403, "jobs are started through the fleet API")
        drone = job["drone"]
        try:
            route = parse_route(args["route"]) if args.get("route") else [tuple(p) for p in routes.get(drone)["points"]]
        except (TypeError, ValueError) as e:
            raise HTTPException(422, str(e))
        if len(route) < 2:
            raise HTTPException(422, f"{drone} has no route: draw one on the map (2+ points) or pass one")
        alt, loops = float(args.get("altitude", 30.0)), int(args.get("loops", 1))
        body = {"route": [list(p) for p in route], "altitude": alt, "loops": loops}
        for k in ("speed", "hold", "radius"):
            if args.get(k) is not None:
                body[k] = args[k]
        try:
            # Takes off first if needed and waits for the altitude: can take a minute.
            msg = client.request("POST", f"/api/v1/drones/{drone}/patrol", body, timeout=150)["message"]
        except DroneError as e:
            raise HTTPException(e.status if e.status in (409, 422) else 502, f"drone refused the patrol: {e}")
        routes.set(drone, route, job.get("operator") or "patrol")
        rid = rec.start(drone, job.get("operator") or "patrol", route, alt, loops, args.get("speed"), job=job["id"])
        return {"text": f"{len(route)} points x {loops} at {alt:g} m", "message": msg, "links": {"report": rid}}

    @app.get("/jobs/{jid}")
    def job_alive(jid: str):
        """The fleet API checks running jobs here: 200 while we know the job, 404 if not."""
        for r in rec.list(limit=50):
            full = rec.get(r["id"])
            if full and full.get("job") == jid:
                return {"id": jid, "running": full.get("status") == "running", "report": r["id"]}
        raise HTTPException(404, f"no job {jid}")

    @app.post("/jobs/{jid}/stopped")
    def job_stopped(jid: str, reason: str = Body("", embed=True), x_droneos_caller: str = Header(default="")):
        if x_droneos_caller != "fleet-api":
            raise HTTPException(403, "fleet API only")
        for r in rec.list(limit=50):
            if r["status"] == "running":
                full = rec.get(r["id"])
                if full and full.get("job") == jid:
                    rec.note(full["drone"], f"job stopped: {reason}")
        return {"ok": True}

    # -- operators (through the fleet API proxy) --------------------------------

    @app.get("/routes")
    def all_routes(x_droneos_operator: str | None = Header(default=None)):
        who(x_droneos_operator)
        return routes.all()

    @app.get("/drones/{drone}/route")
    def get_route(drone: str, x_droneos_operator: str | None = Header(default=None)):
        who(x_droneos_operator)
        return routes.get(drone)

    @app.put("/drones/{drone}/route")
    def put_route(drone: str, points: list = Body(..., embed=True), x_droneos_operator: str | None = Header(default=None)):
        op = who(x_droneos_operator)
        try:
            pts = parse_route(points)
        except (TypeError, ValueError) as e:
            raise HTTPException(422, str(e))
        return routes.set(drone, pts, op)

    def onboard(drone, cmd):
        try:
            job = client.request("GET", f"/api/v1/drones/{drone}/job", timeout=5)
        except DroneError as e:
            raise HTTPException(502, str(e))
        if not job or job.get("plugin") != "patrol":
            raise HTTPException(409, f"{drone} is not on a patrol job")
        try:
            return client.request("POST", f"/api/v1/drones/{drone}/{cmd}", {})
        except DroneError as e:
            raise HTTPException(e.status if e.status in (409, 422) else 502, str(e))

    @app.post("/drones/{drone}/pause")
    def pause(drone: str, x_droneos_operator: str | None = Header(default=None)):
        op = who(x_droneos_operator)
        r = onboard(drone, "patrol_pause")
        rec.note(drone, f"paused by {op}")
        return r

    @app.post("/drones/{drone}/resume")
    def resume(drone: str, x_droneos_operator: str | None = Header(default=None)):
        op = who(x_droneos_operator)
        r = onboard(drone, "patrol_resume")
        rec.note(drone, f"resumed by {op}")
        return r

    @app.get("/reports")
    def list_reports(drone: str | None = None, limit: int = Query(20, ge=1, le=200), x_droneos_operator: str | None = Header(default=None)):
        who(x_droneos_operator)
        return rec.list(drone, limit)

    @app.get("/reports/{rid}")
    def get_report(rid: str, x_droneos_operator: str | None = Header(default=None)):
        who(x_droneos_operator)
        rep = rec.get(rid)
        if rep is None:
            raise HTTPException(404, f"no patrol report {rid}")
        return rep

    @app.get("/reports/{rid}/photos/{n}.jpg")
    def get_photo(rid: str, n: int, x_droneos_operator: str | None = Header(default=None)):
        who(x_droneos_operator)
        path = rec.photo_path(rid, n)
        if path is None:
            raise HTTPException(404, "no such photo")
        return FileResponse(path, media_type="image/jpeg")

    @app.get("/ui/job.js")
    def ui():
        return FileResponse(Path(__file__).parent / "ui" / "job.js", media_type="text/javascript")

    @app.get("/health")
    def health():
        return {"ok": True}

    return app


if os.environ.get("PATROL_NO_AUTOSTART") != "1":
    app = create_app()
