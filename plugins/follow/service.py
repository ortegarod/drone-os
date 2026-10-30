"""Follow: keep a person in view from above. See docs/plugins.md.

Job: climb to a safe height, fly to a stand-off point looking at where the person is said to
be, drop to the follow height, lock on to the nearest confirmed person there, then keep them in
the middle of the camera like a camera operator would: always turn to face them, but only move
when they get too far (beyond `distance` + `slack`: the detector loses people past ~35 m) or
too close (under half of `distance`); then go to `distance` (default = the height, so with the
45-degree camera they sit mid-frame; the wide camera keeps them in frame much closer than that). Moving tilts the drone
and blurs where the person is; standing still keeps the fix sharp. Loses them for longer than
`lost_seconds`: the job ends and the drone goes home. Same after `minutes`.

Where the person is comes from the fleet API's view of the drone (detections: objects with a
ground spot, confirmed = seen in 3+ frames there), polled at 2 Hz, the rate the fleet API
relays them. Cloud-side control: fine for someone walking; a real drone would run this loop
onboard.

Endpoints: POST /jobs, GET /jobs/{id}, POST /jobs/{id}/stopped (fleet API);
GET /reports[?drone=], /reports/{id}, /reports/{id}/photos/{n}.jpg (operators); GET /ui/job.js.
Run: uvicorn service:app --host 127.0.0.1 --port 8094
Env: FOLLOW_CONFIG (json {"api", "token"}), FOLLOW_REPORTS (dir), CAMERA_URL
"""

import json
import logging
import math
import os
import threading
import time
import urllib.request
from pathlib import Path

from fastapi import Body, FastAPI, Header, HTTPException
from fastapi.responses import FileResponse

from droneos.client import Client, DroneError

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(name)s %(levelname)s %(message)s")
log = logging.getLogger("follow")
HERE = Path(__file__).parent
GEOFENCE_M = 280.0   # PX4 keeps drones within 300 m of home; stay a bit inside
LOST_AFTER = 3.0     # s without a fix before it counts as losing them (the detector misses frames)


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


def parse_args(raw):
    a = {"altitude": 30.0, "transit_altitude": 50.0, "minutes": 5.0, "lost_seconds": 30.0, "speed": 6.0, "slack": 5.0, **raw}
    out = {k: float(a[k]) for k in ("north", "east", "altitude", "transit_altitude", "minutes", "lost_seconds", "speed", "slack")}
    out["distance"] = float(a.get("distance") or out["altitude"])
    assert math.hypot(out["north"], out["east"]) <= GEOFENCE_M
    assert 20 <= out["altitude"] <= 60 and 45 <= out["transit_altitude"] <= 120
    assert 10 <= out["distance"] <= 80 and 0.5 <= out["minutes"] <= 30
    assert 5 <= out["lost_seconds"] <= 120 and 2 <= out["speed"] <= 10 and 2 <= out["slack"] <= 30
    return out


def bearing(n0, e0, n1, e1):
    return math.degrees(math.atan2(e1 - e0, n1 - n0)) % 360


def angle_diff(a, b):
    return abs((a - b + 180) % 360 - 180)


class Target:
    """Where the person is and how they move: picks, each frame, the confirmed person nearest to
    where they should be by now; the spot is smoothed (each fix is off by a metre or two) and so
    is the velocity used to predict ahead."""

    def __init__(self, n, e, t):
        self.n, self.e, self.vn, self.ve, self.t = n, e, 0.0, 0.0, t
        self.seen = t
        self.bystanders = []   # [north, east, last seen]: other people seen while we had them

    def predict(self, t):
        dt = min(3.0, max(0.0, t - self.t))
        return self.n + self.vn * dt, self.e + self.ve * dt

    def note_bystanders(self, people, best, t):
        """Everyone else confirmed this frame, away from them: a bystander (remembered 2 min)."""
        for p in people:
            if p is not best and (len(p) < 3 or p[2]) and math.hypot(p[0] - best[0], p[1] - best[1]) > 4:
                hit = next((b for b in self.bystanders if math.hypot(p[0] - b[0], p[1] - b[1]) < 3.0), None)
                if hit:
                    hit[2] = t
                else:
                    self.bystanders.append([p[0], p[1], t])

    MAX_WALK = 2.0   # m/s: nobody we follow covers ground faster (a fix further than that is someone else)

    def update(self, people, t, gate=4.0, raw_gate=3.0):
        """people: [(north, east, confirmed), ...] this frame. A confirmed person may be up to
        `gate` m (+ a bit per second since the last fix) from where they should be; an unconfirmed
        one only `raw_gate` m (once locked on, a fresh box right where they should be is them; it
        fills the detector's gaps). Either way no further from the last fix than walking allows,
        so a gap doesn't hand the drone to someone standing nearby. Returns True if one is them."""
        pn, pe = self.predict(t)
        lost_for = t - self.seen
        reach = 3.0 + self.MAX_WALK * lost_for
        self.bystanders = [b for b in self.bystanders if t - b[2] < 120]

        def bystander(p):
            return any(math.hypot(p[0] - b[0], p[1] - b[1]) < 3.0 for b in self.bystanders)

        def ok(p):
            # never someone standing where a bystander stood, unless they themselves are right there
            # (walking past them): a gap at a corner next to them must not hand the drone over
            if bystander(p) and not bystander((self.n, self.e)):
                return False
            d = math.hypot(p[0] - pn, p[1] - pe)
            if len(p) < 3 or p[2]:
                # the longer they've been out of sight, the further from the prediction they may be
                # (they turn corners)
                g = min(reach, gate + 1.5 * lost_for)
            else:
                g = raw_gate
            return d <= g and math.hypot(p[0] - self.n, p[1] - self.e) <= reach
        cands = [p for p in people if ok(p)]
        best = min(cands, key=lambda p: math.hypot(p[0] - pn, p[1] - pe), default=None)
        if best is None:
            return False
        self.note_bystanders(people, best, t)
        dt = t - self.t
        n = pn + 0.5 * (best[0] - pn)    # halfway between the prediction and the new fix
        e = pe + 0.5 * (best[1] - pe)
        if dt > 0.2:
            vn, ve = (n - self.n) / dt, (e - self.e) / dt
            if math.hypot(vn, ve) < 3.0:   # nobody walks faster: a jump is noise, not speed
                self.vn += 0.3 * (vn - self.vn)
                self.ve += 0.3 * (ve - self.ve)
        self.n, self.e, self.t, self.seen = n, e, t, t
        return True


MAX_TILT = 6.0   # degrees: a drone tilted more than this is manoeuvring; its fixes are worth less


def people_in(view, confirmed_only=True):
    """People with a ground spot in the drone view's latest detections, as (north, east, confirmed);
    only confirmed ones unless asked. None (not "nobody") while the drone is tilted hard: its fixes
    then aren't trusted, and that isn't losing them."""
    att = (view or {}).get("attitude") or {}
    if max(abs(att.get("roll") or 0.0), abs(att.get("pitch") or 0.0)) > MAX_TILT:
        return None
    d = (view or {}).get("detections") or {}
    out = []
    for o in d.get("objects") or []:
        g = o.get("ground")
        c = o.get("confirmed", True)
        if o.get("label") == "person" and g and (c or not confirmed_only):
            out.append((g["north"], g["east"], bool(c)))
    return out


class Follow(threading.Thread):
    def __init__(self, client, root, fetch_photo, job, args, sleep=time.sleep, clock=time.monotonic):
        super().__init__(daemon=True, name=f"follow-{job['id']}")
        self.c, self.fetch_photo = client, fetch_photo
        self.stopped = threading.Event()
        self._lock = threading.Lock()
        self.sleep = (lambda s: self.stopped.wait(s)) if sleep is time.sleep else sleep
        self.clock = clock
        self.job, self.drone, self.args = job, job["drone"], args
        self.dir = Path(root) / job["id"]
        self.dir.mkdir(parents=True, exist_ok=True)
        self.report = {"id": job["id"], "drone": self.drone, "operator": job.get("operator"), "started": now(),
                       "ended": None, "status": "running", "args": args, "path": [], "photos": [],
                       "followed_s": 0.0, "lost_count": 0, "walked_m": 0.0, "events": []}
        self.save()

    def save(self):
        with self._lock:
            tmp = self.dir / "report.json.tmp"
            tmp.write_text(json.dumps(self.report, indent=1))
            tmp.replace(self.dir / "report.json")

    def event(self, what):
        self.report["events"].append({"time": now(), "what": what})
        self.save()

    def state(self):
        return self.c.request("GET", f"/api/v1/drones/{self.drone}", timeout=5)

    def cmd(self, name, body=None):
        return self.c.request("POST", f"/api/v1/drones/{self.drone}/{name}", body or {})

    def status(self, text):
        if text != getattr(self, "_status", None):
            self._status = text
            try:
                self.c.request("PATCH", f"/api/v1/drones/{self.drone}/job", {"text": text}, timeout=5)
            except DroneError:
                pass

    def wait_until(self, pred, timeout):
        t0 = self.clock()
        while not self.stopped.is_set() and self.clock() - t0 < timeout:
            try:
                if pred(self.state()):
                    return True
            except DroneError:
                pass
            self.sleep(1)
        return False

    def photo(self, target):
        n = len(self.report["photos"]) + 1
        try:
            (self.dir / f"{n}.jpg").write_bytes(self.fetch_photo(self.drone))
            self.report["photos"].append({"n": n, "time": now(), "north": round(target.n, 1), "east": round(target.e, 1)})
        except Exception as e:
            self.event(f"photo failed: {e}")

    def run(self):
        a = self.args
        result, reason = "completed", ""
        try:
            s = self.state()
            p = s["position"]
            if not s["armed"] or (p["altitude"] or 0) < a["transit_altitude"] - 5:
                self.status(f"climbing to {a['transit_altitude']:g} m")
                self.event(self.cmd("takeoff", {"altitude": a["transit_altitude"]})["message"])
                self.wait_until(lambda s: (s["position"]["altitude"] or 0) >= a["transit_altitude"] - 2, 120)
                s = self.state()
                p = s["position"]
            # stand-off point: `distance` short of the person, on the line from here
            n0, e0 = p["north"] or 0.0, p["east"] or 0.0
            hd = bearing(n0, e0, a["north"], a["east"])
            sn = a["north"] - a["distance"] * math.cos(math.radians(hd))
            se = a["east"] - a["distance"] * math.sin(math.radians(hd))
            if math.hypot(sn, se) > GEOFENCE_M:
                raise DroneError("stand-off point outside the geofence", 422)
            if not self.stopped.is_set():
                self.status("flying to the person")
                self.cmd("goto", {"north": round(sn, 1), "east": round(se, 1), "altitude": a["transit_altitude"],
                                  "heading": round(hd, 1), "speed": a["speed"]})
                self.wait_until(lambda s: math.hypot((s["position"]["north"] or 0) - sn, (s["position"]["east"] or 0) - se) < 3,
                                math.hypot(sn - n0, se - e0) / a["speed"] * 2 + 60)
            if not self.stopped.is_set():
                self.cmd("goto", {"north": round(sn, 1), "east": round(se, 1), "altitude": a["altitude"], "heading": round(hd, 1)})
                self.wait_until(lambda s: abs((s["position"]["altitude"] or 0) - a["altitude"]) < 1.5, 60)
            # lock on: a confirmed person within 15 m of where they were said to be
            target = None
            t_end = self.clock() + 30
            self.status("looking for the person")
            while not self.stopped.is_set() and self.clock() < t_end and target is None:
                ppl = people_in(self.state()) or []
                near = [q for q in ppl if math.hypot(q[0] - a["north"], q[1] - a["east"]) <= 15]
                if near:
                    q = min(near, key=lambda q: math.hypot(q[0] - a["north"], q[1] - a["east"]))
                    target = Target(q[0], q[1], self.clock())
                    target.note_bystanders(ppl, q, target.t)   # the others in view at lock-on
                else:
                    self.sleep(0.5)
            if target is None and not self.stopped.is_set():
                raise DroneError(f"no person seen within 15 m of N{a['north']:g} E{a['east']:g}", 404)
            if target:
                self.event(f"locked on: person at N{target.n:.1f} E{target.e:.1f}")
                result, reason = self.follow(target)
            if self.stopped.is_set():
                result, reason = "stopped", self.report.get("stop_reason", "stopped")
            else:
                self.cmd("return_home")
                self.event(reason + "; returning home")
        except DroneError as e:
            result, reason = "failed", str(e)
            self.event(f"failed: {e}")
            if not self.stopped.is_set():
                try:
                    self.cmd("return_home")
                except DroneError:
                    pass
        if result != "stopped" and reason and not reason.endswith("returning home"):
            reason += "; returning home"
        self.report.update(status=result, ended=now(), summary=reason)
        self.save()
        if result != "stopped":
            try:
                self.c.request("DELETE", f"/api/v1/drones/{self.drone}/job",
                               {"id": self.job["id"], "result": result, "reason": reason, "links": {"report": self.job["id"]}})
            except DroneError as e:
                log.warning("ending job %s: %s", self.job["id"], e)

    def follow(self, target):
        a = self.args
        t0 = self.clock()
        t_stop = t0 + 60 * a["minutes"]
        last_sent, last_cmd, last_path, last_photo = None, 0.0, 0.0, -1e9
        lost_since, lost_counted = None, False
        prev = (target.n, target.e, t0)
        while not self.stopped.is_set():
            t = self.clock()
            if t >= t_stop:
                return "completed", self.summary(f"followed for {a['minutes']:g} min")
            try:
                s = self.state()
            except DroneError:
                self.sleep(0.5)
                continue
            p = s["position"]
            dn, de = p["north"] or 0.0, p["east"] or 0.0
            ppl = people_in(s, confirmed_only=False)
            if ppl is not None and target.update(ppl, t):
                if lost_since is not None and t - lost_since >= LOST_AFTER:
                    self.event(f"found again after {t - lost_since:.0f} s")
                lost_since = None
                if t - prev[2] >= 2:   # distance walked from 2 s steps (each fix jitters)
                    self.report["walked_m"] += math.hypot(target.n - prev[0], target.e - prev[1])
                    prev = (target.n, target.e, t)
                self.report["followed_s"] = round(t - t0, 1)
            elif ppl is not None or lost_since is not None:
                if lost_since is None:
                    lost_since = target.seen
                if t - lost_since >= LOST_AFTER and not lost_counted:
                    lost_counted = True
                    self.report["lost_count"] += 1
                if t - lost_since > a["lost_seconds"]:
                    return "completed", self.summary(f"lost the person for {a['lost_seconds']:g} s")
            if lost_since is None:
                lost_counted = False
            out_of_sight = lost_since is not None and t - lost_since >= LOST_AFTER
            if t - last_path >= 2:
                last_path = t
                self.report["path"].append([round(target.n, 1), round(target.e, 1)])
                self.report["path"] = self.report["path"][-600:]
                self.save()
            if lost_since is None and t - last_photo >= 15:
                last_photo = t
                self.photo(target)
            rng_now = math.hypot(target.n - dn, target.e - de)
            if out_of_sight:
                self.status(f"lost sight of the person ({t - lost_since:.0f} s), holding")
            else:
                self.status(f"following · {rng_now:.0f} m away")
            # Camera operator: always face them; move only when they're out of distance +- slack,
            # then go to `distance` short of where they'll be in a second, on the line from here.
            if not out_of_sight and t - last_cmd >= 1.0:
                pn, pe = target.predict(t + 1.0)
                hd = bearing(dn, de, pn, pe)
                rng = math.hypot(pn - dn, pe - de)
                wn, we = (last_sent[0], last_sent[1]) if last_sent else (dn, de)
                if rng > a["distance"] + a["slack"] or (rng > 1 and rng < a["distance"] / 2):
                    wn = pn - a["distance"] * (pn - dn) / rng
                    we = pe - a["distance"] * (pe - de) / rng
                    if math.hypot(wn, we) > GEOFENCE_M:   # they walked off the fence: watch from the edge
                        k = GEOFENCE_M / math.hypot(wn, we)
                        wn, we = wn * k, we * k
                    self.report["moves"] = self.report.get("moves", 0) + 1
                if last_sent is None or math.hypot(wn - last_sent[0], we - last_sent[1]) > 0.5 \
                        or angle_diff(hd, last_sent[2]) > 6:
                    self.cmd("goto", {"north": round(wn, 1), "east": round(we, 1), "altitude": a["altitude"],
                                      "heading": round(hd, 1), "speed": a["speed"]})
                    last_sent, last_cmd = (wn, we, hd), t
            self.sleep(0.5)
        return "stopped", ""

    def summary(self, why):
        r = self.report
        return f"{why}: followed {r['followed_s'] / 60:.1f} min, person walked {r['walked_m']:.0f} m, lost {r['lost_count']}x"


def create_app(client=None, reports_dir=None, fetch_photo=None, sleep=time.sleep, clock=time.monotonic):
    if client is None:
        cfg = json.loads(Path(os.environ.get("FOLLOW_CONFIG", "~/.config/droneos/follow_plugin.json")).expanduser().read_text())
        client = Client(cfg.get("api", "http://127.0.0.1:8090"), cfg["token"])
    root = Path(reports_dir or os.environ.get("FOLLOW_REPORTS", "~/.local/state/droneos/follows")).expanduser()
    root.mkdir(parents=True, exist_ok=True)
    fetch_photo = fetch_photo or camera_snapshot(os.environ.get("CAMERA_URL", "http://127.0.0.1:8080"))
    running = {}
    app = FastAPI(title="DroneOS follow plugin")
    app.state.running = running

    @app.post("/jobs")
    def start(job: dict = Body(...), args: dict = Body(default={}), x_droneos_caller: str = Header(default="")):
        if x_droneos_caller != "fleet-api":
            raise HTTPException(403, "jobs are started through the fleet API")
        try:
            a = parse_args(args)
        except (KeyError, TypeError, ValueError, AssertionError):
            raise HTTPException(422, "need north, east (where the person is, m from home, within 280 m); altitude 20-60 m, "
                                     "transit_altitude 45-120 m, distance 10-80 m (default = altitude), minutes 0.5-30, "
                                     "lost_seconds 5-120, speed 2-10 m/s")
        f = Follow(client, root, fetch_photo, job, a, sleep, clock)
        running[job["id"]] = f
        f.start()
        return {"text": f"person near N{a['north']:g} E{a['east']:g}, from {a['altitude']:g} m", "links": {"report": job["id"]}}

    @app.get("/jobs/{jid}")
    def job_alive(jid: str):
        f = running.get(jid)
        if f is None:
            raise HTTPException(404, f"no job {jid}")
        return {"id": jid, "running": f.is_alive()}

    @app.post("/jobs/{jid}/stopped")
    def stopped(jid: str, reason: str = Body("", embed=True), x_droneos_caller: str = Header(default="")):
        if x_droneos_caller != "fleet-api":
            raise HTTPException(403, "fleet API only")
        f = running.get(jid)
        if f:
            f.report["stop_reason"] = reason
            f.event(f"stopped: {reason}")
            f.stopped.set()
        return {"ok": bool(f)}

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
        return {"ok": True, "running": len([f for f in running.values() if f.is_alive()])}

    return app


if os.environ.get("FOLLOW_NO_AUTOSTART") != "1":
    app = create_app()
