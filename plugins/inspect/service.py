"""Inspect: the example DroneOS plugin (see docs/plugins.md).

Job: circle a point with the camera on it (PX4's own orbit), take a photo every few seconds,
then go home. Cloud-only: no onboard part, it uses the fleet API's orbit command. If this
service dies mid-job the drone just keeps orbiting until someone sends it home (that's what
an onboard part would fix; patrol has one).

Endpoints
  called by the fleet API:   POST /jobs, GET /jobs/{id} (still running it?), POST /jobs/{id}/stopped
  for operators (proxied):   GET /reports[?drone=], GET /reports/{id}, GET /reports/{id}/photos/{n}.jpg
  its UI module:             GET /ui/job.js

Run: uvicorn service:app --host 127.0.0.1 --port 8092
Env: INSPECT_CONFIG (json {"api", "token"}), INSPECT_REPORTS (dir), CAMERA_URL
"""

import json
import logging
import os
import threading
import time
import urllib.request
from pathlib import Path

from fastapi import Body, FastAPI, Header, HTTPException
from fastapi.responses import FileResponse

from droneos.client import Client, DroneError

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(name)s %(levelname)s %(message)s")
log = logging.getLogger("inspect")
HERE = Path(__file__).parent


def now():
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())


def camera_snapshot(base):
    def fetch(drone):
        with urllib.request.urlopen(f"{base}/snapshot?topic=/{drone}/camera&width=640&height=480&quality=75", timeout=6) as r:
            data = r.read()
        if not data.startswith(b"\xff\xd8"):
            raise ValueError("not a JPEG")
        return data
    return fetch


class Inspection(threading.Thread):
    """One job: climb, orbit, photos, home, end the job."""

    def __init__(self, client, root, fetch_photo, job, args, sleep=time.sleep):
        super().__init__(daemon=True, name=f"inspect-{job['id']}")
        self.c, self.fetch_photo = client, fetch_photo
        self.stopped = threading.Event()
        self._lock = threading.Lock()
        # Real runs wake up as soon as the job is stopped; tests pass their own sleep.
        self.sleep = (lambda s: self.stopped.wait(s)) if sleep is time.sleep else sleep
        self.job, self.drone = job, job["drone"]
        self.args = {"radius": 20.0, "speed": 3.0, "altitude": 50.0, "minutes": 2.0, "photo_every": 10.0, **args}
        self.dir = Path(root) / job["id"]
        self.dir.mkdir(parents=True, exist_ok=True)
        self.report = {"id": job["id"], "drone": self.drone, "operator": job.get("operator"), "started": now(),
                       "ended": None, "status": "running", "args": self.args, "photos": [], "events": []}
        self.save()

    def save(self):
        with self._lock:   # the worker and the HTTP thread (stop) both write
            tmp = self.dir / "report.json.tmp"
            tmp.write_text(json.dumps(self.report, indent=1))
            tmp.replace(self.dir / "report.json")

    def event(self, what):
        self.report["events"].append({"time": now(), "what": what})
        self.save()

    def drone_state(self):
        return self.c.request("GET", f"/api/v1/drones/{self.drone}", timeout=5)

    def cmd(self, name, body=None):
        return self.c.request("POST", f"/api/v1/drones/{self.drone}/{name}", body or {})

    def run(self):
        a = self.args
        result, reason = "completed", ""
        try:
            s = self.drone_state()
            if not s["armed"] or (s["position"]["altitude"] or 0) < a["altitude"] - 5:
                self.event(self.cmd("takeoff", {"altitude": a["altitude"]})["message"])
                for _ in range(90):           # trees reach ~40 m: be up there before moving sideways
                    if self.stopped.is_set() or (self.drone_state()["position"]["altitude"] or 0) >= a["altitude"] - 2:
                        break
                    self.sleep(1)
            if not self.stopped.is_set():
                self.event(self.cmd("orbit", {"north": a["north"], "east": a["east"], "radius": a["radius"],
                                              "speed": a["speed"], "altitude": a["altitude"]})["message"])
            shots = max(1, int(60 * a["minutes"] // a["photo_every"]))
            self.sleep(min(15.0, 60 * a["minutes"]))   # let it get onto the circle first
            n = 0
            while not self.stopped.is_set() and n < shots:
                n += 1
                try:
                    (self.dir / f"{n}.jpg").write_bytes(self.fetch_photo(self.drone))
                    s = self.drone_state()
                    self.report["photos"].append({"n": n, "time": now(), "north": s["position"]["north"],
                                                  "east": s["position"]["east"], "altitude": s["position"]["altitude"]})
                    self.save()
                except Exception as e:
                    self.event(f"photo {n} failed: {e}")
                self.sleep(a["photo_every"])
            if self.stopped.is_set():
                result, reason = "stopped", self.report.get("stop_reason", "stopped")
            else:
                self.cmd("return_home")
                self.event("done: returning home")
                reason = f"{len(self.report['photos'])} photos around N{a['north']:g} E{a['east']:g}; returning home"
        except DroneError as e:
            result, reason = "failed", str(e)
            self.event(f"failed: {e}")
        self.report.update(status=result, ended=now(), summary=reason)
        self.save()
        if result != "stopped":    # a stopped job was already ended by the fleet API
            try:
                self.c.request("DELETE", f"/api/v1/drones/{self.drone}/job",
                               {"id": self.job["id"], "result": result, "reason": reason, "links": {"report": self.job["id"]}})
            except DroneError as e:
                log.warning("ending job %s: %s", self.job["id"], e)


def create_app(client=None, reports_dir=None, fetch_photo=None, sleep=time.sleep):
    if client is None:
        cfg = json.loads(Path(os.environ.get("INSPECT_CONFIG", "~/.config/droneos/inspect_plugin.json")).expanduser().read_text())
        client = Client(cfg.get("api", "http://127.0.0.1:8090"), cfg["token"])
    root = Path(reports_dir or os.environ.get("INSPECT_REPORTS", "~/.local/state/droneos/inspections")).expanduser()
    root.mkdir(parents=True, exist_ok=True)
    fetch_photo = fetch_photo or camera_snapshot(os.environ.get("CAMERA_URL", "http://127.0.0.1:8080"))
    running = {}   # job id -> Inspection

    app = FastAPI(title="DroneOS inspect plugin (example)")
    app.state.running = running

    @app.post("/jobs")
    def start(job: dict = Body(...), args: dict = Body(default={}), x_droneos_caller: str = Header(default="")):
        if x_droneos_caller != "fleet-api":
            raise HTTPException(403, "jobs are started through the fleet API")
        try:
            args = {k: float(v) for k, v in args.items()}
            assert "north" in args and "east" in args
            assert 5 <= args.get("radius", 20) <= 100 and 1 <= args.get("speed", 3) <= 8
            assert 45 <= args.get("altitude", 50) <= 120 and 0.2 <= args.get("minutes", 2) <= 30
            assert 3 <= args.get("photo_every", 10) <= 120
        except (TypeError, ValueError, AssertionError):
            raise HTTPException(422, "need north, east (m from home); radius 5-100 m, speed 1-8 m/s, "
                                     "altitude 45-120 m, minutes 0.2-30, photo_every 3-120 s")
        insp = Inspection(client, root, fetch_photo, job, args, sleep)
        running[job["id"]] = insp
        insp.start()
        return {"text": f"circle N{args['north']:g} E{args['east']:g}, r {args.get('radius', 20):g} m, "
                        f"{args.get('minutes', 2):g} min", "links": {"report": job["id"]}}

    @app.get("/jobs/{jid}")
    def job_alive(jid: str):
        """The fleet API checks running jobs here: 200 while we run it, 404 if we don't know it."""
        insp = running.get(jid)
        if insp is None:
            raise HTTPException(404, f"no job {jid}")
        return {"id": jid, "running": insp.is_alive(), "photos": len(insp.report["photos"])}

    @app.post("/jobs/{jid}/stopped")
    def stopped(jid: str, reason: str = Body("", embed=True), x_droneos_caller: str = Header(default="")):
        if x_droneos_caller != "fleet-api":
            raise HTTPException(403, "fleet API only")
        insp = running.get(jid)
        if insp:
            insp.report["stop_reason"] = reason
            insp.event(f"stopped: {reason}")
            insp.stopped.set()
        return {"ok": bool(insp)}

    def load(rid):
        p = root / Path(rid).name / "report.json"
        return json.loads(p.read_text()) if p.is_file() else None

    @app.get("/reports")
    def reports(drone: str | None = None, limit: int = 10):
        out = [r for r in (load(d.name) for d in root.iterdir() if d.is_dir()) if r and (drone is None or r["drone"] == drone)]
        out.sort(key=lambda r: r["started"], reverse=True)
        return out[:limit]

    @app.get("/reports/{rid}")
    def report(rid: str):
        r = load(rid)
        if r is None:
            raise HTTPException(404, "no such report")
        return r

    @app.get("/reports/{rid}/photos/{n}.jpg")
    def photo(rid: str, n: int):
        p = root / Path(rid).name / f"{n}.jpg"
        if not p.is_file():
            raise HTTPException(404, "no such photo")
        return FileResponse(p, media_type="image/jpeg")

    @app.get("/ui/job.js")
    def ui():
        return FileResponse(HERE / "ui" / "job.js", media_type="text/javascript")

    @app.get("/health")
    def health():
        return {"ok": True, "running": len([i for i in running.values() if i.is_alive()])}

    return app


if os.environ.get("INSPECT_NO_AUTOSTART") != "1":
    app = create_app()
