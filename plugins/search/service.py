"""Search: fly to look points, scan around each one, and report every person or vehicle the
drone's object detector confirms (with a photo and where it is). See docs/plugins.md.

Job: transit at a safe height (trees in the sim reach ~40 m), drop straight down to the look
height over each point, turn through a few headings (the camera looks 45 degrees down, forward),
climb back, next point; then home. What it finds comes from the fleet API's detection events
(job.on_sighting) and, after each look, job.sightings(): that also has objects the drone saw in
the 10 min before the job (the fleet API doesn't announce those again) and any the socket missed.

Cloud-only, like Inspect: if this service dies mid-job, the fleet API's liveness check sends the
drone home.

Run: uvicorn service:app --host 127.0.0.1 --port 8093
Env: SEARCH_CONFIG (json {"api", "token"}), SEARCH_REPORTS (dir), CAMERA_URL
"""

import logging
import math
import threading
import time

from droneos.plugin import Plugin, arg

log = logging.getLogger("search")
GEOFENCE_M = 290.0   # PX4 keeps drones within 300 m of home

plugin = Plugin("search")


def look_points(v):
    """[[n, e], ...] or "N,E N,E ..." (what `droneos start droneX search points=...` sends)."""
    if isinstance(v, str):
        v = [p.split(",") for p in v.replace(";", " ").split()]
    pts = [[float(n), float(e)] for n, e in v]
    if not 1 <= len(pts) <= 10:
        raise ValueError("must be 1-10 points")
    if any(math.hypot(n, e) > GEOFENCE_M for n, e in pts):
        raise ValueError(f"must all be within {GEOFENCE_M:g} m of home")
    return pts


def started(a):
    n = len(a["points"])
    return f"{n} point{'s' if n > 1 else ''}, looking from {a['look_altitude']:g} m"


def check(a):
    if a["look_altitude"] >= a["altitude"]:
        raise ValueError("look_altitude must be below altitude")


def _angle(a, b):
    return 180.0 if a is None else abs((float(a) - b + 180) % 360 - 180)


@plugin.job(text=started, check=check)
def search(job, points: look_points,
           look_altitude: float = arg(30.0, min=20, max=45),
           altitude: float = arg(50.0, min=45, max=120),
           looks: int = arg(4, min=1, max=8),
           look_seconds: float = arg(6.0, min=3, max=30),
           speed: float = arg(5.0, min=1, max=10)):
    found, at, lock = job.report.setdefault("found", []), [None], threading.Lock()
    job.report.update(points=points, visited=0)

    def sighted(s, photo=True):
        with lock:
            f = next((f for f in found if f["id"] == s["id"]), None)
            if f and (f["photo"] or not photo):
                return
            if f is None:
                f = {"n": len(found) + 1, "id": s["id"], "label": s["label"], "score": s["score"], "north": s["north"],
                     "east": s["east"], "lat": s.get("lat"), "lon": s.get("lon"), "box": s.get("box") or [],
                     "point": at[0], "photo": None}
                found.append(f)
                log.info("%s: %s at N%s E%s", job.drone.name, s["label"], s["north"], s["east"])
        if photo:   # it's in view right now (just confirmed, or seen during this look)
            p = job.photo(found=f["n"])
            if p:
                f.update(photo=p["n"], point=at[0], box=s.get("box") or f["box"])
        job.save()

    def catch_up(seen_since=None):   # a photo of the ones seen during this look: it still faces them
        for s in job.sightings():
            sighted(s, photo=seen_since is not None and s["last_seen"] >= seen_since)

    def pos(s):
        p = s["position"]
        return p["north"] or 0.0, p["east"] or 0.0, p["altitude"] or 0.0

    job.on_sighting(sighted)
    try:
        job.status(f"climbing to {altitude:g} m")
        here = pos(job.climb(altitude))[:2]
        for i, (n, e) in enumerate(points, 1):
            at[0] = i
            job.status(f"flying to point {i}/{len(points)}")
            job.drone.goto(n, e, altitude=altitude, speed=speed, wait=False)
            far = math.dist((n, e), here)
            if not job.wait_until(lambda s: math.dist(pos(s)[:2], (n, e)) < 3, far / speed * 2 + 60):
                job.event(f"point {i}: didn't get within 3 m, looking from here")
            h0 = math.degrees(math.atan2(e - here[1], n - here[0])) % 360 if far > 3 else 0.0   # the way it came in
            here = (n, e)
            for k in range(looks):
                hd = (h0 + k * 360.0 / looks) % 360
                job.status(f"point {i}/{len(points)}: looking {k + 1}/{looks}")
                job.drone.goto(n, e, altitude=look_altitude, heading=round(hd, 1), wait=False)
                job.wait_until(lambda s: abs(pos(s)[2] - look_altitude) < 1.5
                               and _angle(s["position"]["heading"], hd) < 12, 40)
                t_look = time.time()
                job.sleep(look_seconds)
                catch_up(seen_since=t_look)
            job.report["visited"] = i
            job.save()
            job.drone.goto(n, e, altitude=altitude, wait=False)   # straight up before moving on
            job.wait_until(lambda s: pos(s)[2] >= altitude - 2, 60)
        job.home()
    finally:   # stopped or not: anything not reported yet
        try:
            catch_up()
        except Exception as e:
            log.warning("sightings: %s", e)
    kinds = {}
    for f in found:
        kinds[f["label"]] = kinds.get(f["label"], 0) + 1
    what = ", ".join(f"{k} {v}" for k, v in sorted(kinds.items())) or "nothing"
    return f"found {what} at {job.report['visited']}/{len(points)} points; returning home"


app = plugin.app
