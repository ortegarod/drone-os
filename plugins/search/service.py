"""Search: fly to look points, scan around each one, and report every person or vehicle the
drone's object detector confirms (with a photo and where it is). See docs/plugins.md.

Job: transit at a safe height (trees in the sim reach ~40 m), drop straight down to the look
height over each point, turn through a few headings (the camera looks 45 degrees down, forward),
climb back, next point; then home. What it finds comes from the fleet API's detection events
(WS /api/v1/events, command "detected"), the same stream any plugin can use; at the end it
checks GET /api/v1/drones/{name}/sightings for anything the socket missed.

Cloud-only, like Inspect: if this service dies mid-job, the fleet API's liveness check sends the
drone home.

Endpoints
  called by the fleet API:   POST /jobs, GET /jobs/{id} (still running it?), POST /jobs/{id}/stopped
  for operators (proxied):   GET /reports[?drone=], GET /reports/{id}, GET /reports/{id}/photos/{n}.jpg
  its UI module:             GET /ui/job.js

Run: uvicorn service:app --host 127.0.0.1 --port 8093
Env: SEARCH_CONFIG (json {"api", "token"}), SEARCH_REPORTS (dir), CAMERA_URL
"""

import json
import logging
import math
import os
import threading
import time
import urllib.parse
import urllib.request
from pathlib import Path

from fastapi import Body, FastAPI, Header, HTTPException
from fastapi.responses import FileResponse

from droneos.client import Client, DroneError

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(name)s %(levelname)s %(message)s")
log = logging.getLogger("search")
HERE = Path(__file__).parent
GEOFENCE_M = 290.0   # PX4 keeps drones within 300 m of home


def now():
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())


def camera_snapshot(base):
    def fetch(drone):
        with urllib.request.urlopen(f"{base}/snapshot?topic=/{drone}/camera&width=640&height=480&quality=75", timeout=12) as r:   # HD frames: ~2 s per snapshot
            data = r.read()
        if not data.startswith(b"\xff\xd8"):
            raise ValueError("not a JPEG")
        return data
    return fetch


def parse_points(v):
    """[[n, e], ...] or "N,E N,E ..." (what `droneos start droneX search points=...` sends)."""
    if isinstance(v, str):
        v = [p.split(",") for p in v.replace(";", " ").split()]
    pts = [[float(n), float(e)] for n, e in v]
    if not 1 <= len(pts) <= 10:
        raise ValueError("1-10 points")
    if any(math.hypot(n, e) > GEOFENCE_M for n, e in pts):
        raise ValueError(f"every point within {GEOFENCE_M:g} m of home")
    return pts


def parse_args(raw):
    a = {"look_altitude": 30.0, "altitude": 50.0, "looks": 4, "look_seconds": 6.0, "speed": 5.0, **raw}
    out = {"points": parse_points(a["points"])}
    for k in ("look_altitude", "altitude", "look_seconds", "speed"):
        out[k] = float(a[k])
    out["looks"] = int(float(a["looks"]))
    assert 20 <= out["look_altitude"] <= 45 and 45 <= out["altitude"] <= 120
    assert out["look_altitude"] < out["altitude"]
    assert 1 <= out["looks"] <= 8 and 3 <= out["look_seconds"] <= 30 and 1 <= out["speed"] <= 10
    return out


class EventListener(threading.Thread):
    """The fleet API's event stream for one drone; calls on_sighting for each "detected" event.
    Reconnects until stopped."""

    def __init__(self, api, token, drone, on_sighting, connect=None):
        super().__init__(daemon=True, name=f"search-events-{drone}")
        q = urllib.parse.urlencode({"token": token, "drone": drone})
        self.url = api.replace("https://", "wss://").replace("http://", "ws://") + "/api/v1/events?" + q
        self.on_sighting, self.stop = on_sighting, threading.Event()
        self.connected = threading.Event()
        if connect is None:
            from websockets.sync.client import connect
        self._connect = connect

    def run(self):
        while not self.stop.is_set():
            try:
                with self._connect(self.url, open_timeout=5) as ws:
                    self.connected.set()
                    while not self.stop.is_set():
                        try:
                            msg = ws.recv(timeout=1)
                        except TimeoutError:
                            continue
                        e = json.loads(msg)
                        if e.get("command") == "detected" and e.get("sighting"):
                            self.on_sighting(e["sighting"])
            except Exception as e:   # socket dropped or fleet API restarting: try again
                self.connected.clear()
                if not self.stop.is_set():
                    log.warning("event stream: %s; reconnecting", e)
                    self.stop.wait(2)


class Search(threading.Thread):
    """One job: up, each look point (down, turn, up), home, end the job."""

    def __init__(self, client, root, fetch_photo, job, args, sleep=time.sleep, listen=None):
        super().__init__(daemon=True, name=f"search-{job['id']}")
        self.c, self.fetch_photo = client, fetch_photo
        self.stopped = threading.Event()
        self._lock = threading.Lock()
        self.sleep = (lambda s: self.stopped.wait(s)) if sleep is time.sleep else sleep
        self.listen = listen   # (drone, on_sighting) -> listener with .start(), .stop; None = the real socket
        self.job, self.drone, self.args = job, job["drone"], args
        self.dir = Path(root) / job["id"]
        self.dir.mkdir(parents=True, exist_ok=True)
        self.at = None   # which point it's at (1-based), for the report
        self.report = {"id": job["id"], "drone": self.drone, "operator": job.get("operator"), "started": now(),
                       "ended": None, "status": "running", "args": args, "points": args["points"],
                       "visited": 0, "found": [], "events": []}
        self.save()

    def save(self):
        with self._lock:
            tmp = self.dir / "report.json.tmp"
            tmp.write_text(json.dumps(self.report, indent=1))
            tmp.replace(self.dir / "report.json")

    def event(self, what):
        with self._lock:
            self.report["events"].append({"time": now(), "what": what})
        self.save()

    def state(self):
        return self.c.request("GET", f"/api/v1/drones/{self.drone}", timeout=5)

    def cmd(self, name, body=None):
        return self.c.request("POST", f"/api/v1/drones/{self.drone}/{name}", body or {})

    def status(self, text):
        try:   # what the fleet list / job tab show for this job
            self.c.request("PATCH", f"/api/v1/drones/{self.drone}/job", {"text": text}, timeout=5)
        except DroneError:
            pass

    def wait_until(self, pred, timeout):
        t0 = time.monotonic()
        while not self.stopped.is_set() and time.monotonic() - t0 < timeout:
            try:
                if pred(self.state()):
                    return True
            except DroneError:
                pass
            self.sleep(1)
        return False

    # -- what it finds ---------------------------------------------------------------
    def on_sighting(self, s, photo=True):
        with self._lock:
            if any(f["id"] == s["id"] for f in self.report["found"]):
                return
            n = len(self.report["found"]) + 1
            f = {"n": n, "id": s["id"], "label": s["label"], "score": s["score"], "north": s["north"],
                 "east": s["east"], "lat": s.get("lat"), "lon": s.get("lon"), "box": s.get("box") or [],
                 "time": now(), "point": self.at, "photo": False}
            self.report["found"].append(f)
        if photo:
            try:   # the frame right after it was confirmed: it's still in view
                (self.dir / f"{n}.jpg").write_bytes(self.fetch_photo(self.drone))
                f["photo"] = True
            except Exception as e:
                f["photo_error"] = str(e)[:120]
        self.save()
        log.info("%s: %s at N%s E%s", self.drone, s["label"], s["north"], s["east"])

    def summary(self):
        kinds = {}
        for f in self.report["found"]:
            kinds[f["label"]] = kinds.get(f["label"], 0) + 1
        what = ", ".join(f"{k} {v}" for k, v in sorted(kinds.items())) if kinds else "nothing"
        return f"found {what} at {self.report['visited']}/{len(self.args['points'])} points"

    # -- flying ------------------------------------------------------------------------
    def run(self):
        a = self.args
        result, reason = "completed", ""
        t0 = time.time()
        if self.listen:
            listener = self.listen(self.drone, self.on_sighting)
        else:
            listener = EventListener(self.c.api, self.c._token, self.drone, self.on_sighting)
        listener.start()
        try:
            s = self.state()
            if not s["armed"] or (s["position"]["altitude"] or 0) < a["altitude"] - 5:
                self.status("climbing to " + f"{a['altitude']:g} m")
                self.event(self.cmd("takeoff", {"altitude": a["altitude"]})["message"])
                self.wait_until(lambda s: (s["position"]["altitude"] or 0) >= a["altitude"] - 2, 120)
            here = (s["position"]["north"] or 0.0, s["position"]["east"] or 0.0)
            for i, (n, e) in enumerate(a["points"], 1):
                if self.stopped.is_set():
                    break
                self.at = i
                total = len(a["points"])
                self.status(f"flying to point {i}/{total}")
                self.cmd("goto", {"north": n, "east": e, "altitude": a["altitude"], "speed": a["speed"]})
                far = math.hypot(n - here[0], e - here[1])
                if not self.wait_until(lambda s: math.hypot((s["position"]["north"] or 0) - n, (s["position"]["east"] or 0) - e) < 3,
                                       far / a["speed"] * 2 + 60):
                    if self.stopped.is_set():
                        break
                    self.event(f"point {i}: didn't get within 3 m, looking from here")
                # face the way it came in, then turn: "looks" headings evenly around
                h0 = math.degrees(math.atan2(e - here[1], n - here[0])) % 360 if far > 3 else 0.0
                here = (n, e)
                for k in range(a["looks"]):
                    if self.stopped.is_set():
                        break
                    hd = (h0 + k * 360.0 / a["looks"]) % 360
                    self.status(f"point {i}/{total}: looking {k + 1}/{a['looks']}")
                    body = {"north": n, "east": e, "altitude": a["look_altitude"], "heading": round(hd, 1)}
                    self.cmd("goto", body)
                    self.wait_until(lambda s: abs((s["position"]["altitude"] or 0) - a["look_altitude"]) < 1.5
                                    and _angle(s["position"]["heading"], hd) < 12, 40)
                    self.sleep(a["look_seconds"])
                if self.stopped.is_set():
                    break
                self.report["visited"] = i
                self.save()
                self.cmd("goto", {"north": n, "east": e, "altitude": a["altitude"]})   # straight up before moving on
                self.wait_until(lambda s: (s["position"]["altitude"] or 0) >= a["altitude"] - 2, 60)
            if self.stopped.is_set():
                result, reason = "stopped", self.report.get("stop_reason", "stopped")
            else:
                self.cmd("return_home")
                self.event("done: returning home")
        except DroneError as e:
            result, reason = "failed", str(e)
            self.event(f"failed: {e}")
        finally:
            listener.stop.set()
        try:   # anything the socket missed (reconnects): the fleet API keeps the drone's sightings
            for s in self.c.request("GET", f"/api/v1/drones/{self.drone}/sightings?since={t0:.0f}", timeout=5):
                if s["first_seen"] >= t0:
                    self.on_sighting(s, photo=False)
        except DroneError:
            pass
        if result == "completed":
            reason = self.summary() + "; returning home"
        self.report.update(status=result, ended=now(), summary=reason if result != "completed" else self.summary())
        self.save()
        if result != "stopped":
            try:
                self.c.request("DELETE", f"/api/v1/drones/{self.drone}/job",
                               {"id": self.job["id"], "result": result, "reason": reason, "links": {"report": self.job["id"]}})
            except DroneError as e:
                log.warning("ending job %s: %s", self.job["id"], e)


def _angle(a, b):
    if a is None:
        return 180.0
    return abs((float(a) - b + 180) % 360 - 180)


def create_app(client=None, reports_dir=None, fetch_photo=None, sleep=time.sleep, listen=None):
    if client is None:
        cfg = json.loads(Path(os.environ.get("SEARCH_CONFIG", "~/.config/droneos/search_plugin.json")).expanduser().read_text())
        client = Client(cfg.get("api", "http://127.0.0.1:8090"), cfg["token"])
    root = Path(reports_dir or os.environ.get("SEARCH_REPORTS", "~/.local/state/droneos/searches")).expanduser()
    root.mkdir(parents=True, exist_ok=True)
    fetch_photo = fetch_photo or camera_snapshot(os.environ.get("CAMERA_URL", "http://127.0.0.1:8080"))
    running = {}

    app = FastAPI(title="DroneOS search plugin")
    app.state.running = running

    @app.post("/jobs")
    def start(job: dict = Body(...), args: dict = Body(default={}), x_droneos_caller: str = Header(default="")):
        if x_droneos_caller != "fleet-api":
            raise HTTPException(403, "jobs are started through the fleet API")
        try:
            a = parse_args(args)
        except (KeyError, TypeError, ValueError, AssertionError) as e:
            raise HTTPException(422, "need points (1-10, [[north, east], ...] or \"N,E N,E\", within 290 m of home); "
                                     "look_altitude 20-45 m, altitude 45-120 m (above look_altitude), looks 1-8, "
                                     f"look_seconds 3-30, speed 1-10 m/s ({e or 'bad value'})")
        s = Search(client, root, fetch_photo, job, a, sleep, listen)
        running[job["id"]] = s
        s.start()
        n = len(a["points"])
        return {"text": f"{n} point{'s' if n > 1 else ''}, looking from {a['look_altitude']:g} m",
                "links": {"report": job["id"]}}

    @app.get("/jobs/{jid}")
    def job_alive(jid: str):
        s = running.get(jid)
        if s is None:
            raise HTTPException(404, f"no job {jid}")
        return {"id": jid, "running": s.is_alive(), "found": len(s.report["found"])}

    @app.post("/jobs/{jid}/stopped")
    def stopped(jid: str, reason: str = Body("", embed=True), x_droneos_caller: str = Header(default="")):
        if x_droneos_caller != "fleet-api":
            raise HTTPException(403, "fleet API only")
        s = running.get(jid)
        if s:
            s.report["stop_reason"] = reason
            s.event(f"stopped: {reason}")
            s.stopped.set()
        return {"ok": bool(s)}

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
        return {"ok": True, "running": len([s for s in running.values() if s.is_alive()])}

    return app


if os.environ.get("SEARCH_NO_AUTOSTART") != "1":
    app = create_app()
