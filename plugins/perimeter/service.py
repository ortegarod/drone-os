"""Fence check: fly just inside the property fence, photograph it every few tens of meters
looking out, and report every person or vehicle the drone sees, marking the ones that weren't
there on the last check. Written with the plugin SDK (docs/plugins.md).

The route comes from the fence drawn in the Command Center (Dev tab), moved `inset` m inside it and
kept within PX4's own limit around home; stops inside no-fly areas are skipped.

Run: uvicorn service:app --host 127.0.0.1 --port 8095
Env: PERIMETER_CONFIG (json {"api", "token"}), PERIMETER_REPORTS (dir), CAMERA_URL
"""

import json
import math
import threading
import time

from droneos.plugin import DroneError, Plugin, arg

plugin = Plugin("perimeter")
SAME_SPOT_M = 10.0   # a find within this of the same kind on the last check isn't new


def shrink(poly, d):
    """The polygon moved d m inwards (each edge shifted along its inside normal)."""
    area = sum(a[1] * b[0] - b[1] * a[0] for a, b in zip(poly, poly[1:] + poly[:1]))   # x = east, y = north
    s = 1 if area > 0 else -1
    lines = []
    for (n0, e0), (n1, e1) in zip(poly, poly[1:] + poly[:1]):
        de, dn = e1 - e0, n1 - n0
        k = d / math.hypot(de, dn)
        oe, on = -dn * k * s, de * k * s          # inward normal, scaled to d
        lines.append(((n0 + on, e0 + oe), (dn, de)))
    out = []
    for (p, u), (q, v) in zip(lines[-1:] + lines[:-1], lines):   # previous edge meets this one
        cross = u[1] * v[0] - u[0] * v[1]
        t = 0 if abs(cross) < 1e-9 else ((q[1] - p[1]) * v[0] - (q[0] - p[0]) * v[1]) / cross
        out.append((p[0] + u[0] * t, p[1] + u[1] * t))
    return out


def inside(pt, poly):
    n, e, hit = pt[0], pt[1], False
    for (n0, e0), (n1, e1) in zip(poly, poly[1:] + poly[:1]):
        if (n0 > n) != (n1 > n) and e < e0 + (n - n0) * (e1 - e0) / (n1 - n0):
            hit = not hit
    return hit


def stops(fence, d, spacing):
    """Photo stops along the fence line, every `spacing` m, d m inside it."""
    line = shrink(fence["inclusion"], d)
    limit = (fence["radius"] or 1e9) - 10
    out = []
    for (n0, e0), (n1, e1) in zip(line, line[1:] + line[:1]):
        k = max(1, math.ceil(math.hypot(n1 - n0, e1 - e0) / spacing))
        for i in range(k):
            n, e = n0 + (n1 - n0) * i / k, e0 + (e1 - e0) * i / k
            r = math.hypot(n, e)
            if r > limit:                            # PX4 keeps it within radius of home
                n, e = n * limit / r, e * limit / r
            if not any(inside((n, e), x) for x in fence["exclusions"]):
                out.append([round(n, 1), round(e, 1)])
    return out


def last_finds(job):
    """What the previous completed fence check of this drone found."""
    reps = []
    for p in plugin.reports.glob("*/report.json"):
        try:
            r = json.loads(p.read_text())
        except (OSError, ValueError):
            continue
        if r["id"] != job.id and r["drone"] == job.drone.name and r["status"] == "completed":
            reps.append(r)
    return max(reps, key=lambda r: r["started"])["found"] if reps else None


@plugin.job(text=lambda a: f"fence line at {a['altitude']:g} m, photo every {a['spacing']:g} m")
def perimeter(job, altitude: float = arg(50.0, min=45, max=120),
              inset: float = arg(10.0, min=3, max=50),
              spacing: float = arg(50.0, min=20, max=200),
              speed: float = arg(5.0, min=1, max=10)):
    fence = job.fence()
    if not fence["inclusion"]:
        raise DroneError("no property fence for this drone: draw one in the Dev tab first")
    if fence["max_altitude"] and altitude > fence["max_altitude"]:
        raise DroneError(f"altitude {altitude:g} m is above the fence's {fence['max_altitude']:g} m")
    route = stops(fence, inset, spacing)
    if len(route) < 3:
        raise DroneError("the fence is too small for that inset")
    before = last_finds(job)
    found, lock, on_line = [], threading.Lock(), [None]   # on_line: when it reached the fence line
    job.report.update(route=route, visited=0, found=found, compared=before is not None)
    cx = sum(n for n, _ in route) / len(route)
    cy = sum(e for _, e in route) / len(route)

    def sighted(s, photo):
        if on_line[0] is None or s["last_seen"] < on_line[0]:
            return   # seen while climbing at home: not the fence line
        with lock:
            f = next((f for f in found if f["id"] == s["id"]), None)
            if f is None:
                new = before is not None and not any(
                    b["label"] == s["label"] and math.dist((b["north"], b["east"]), (s["north"], s["east"])) < SAME_SPOT_M
                    for b in before)
                f = {"n": len(found) + 1, "id": s["id"], "label": s["label"], "score": s["score"], "north": s["north"],
                     "east": s["east"], "lat": s.get("lat"), "lon": s.get("lon"), "new": new, "photo": None}
                found.append(f)
        if photo and not f["photo"]:
            p = job.photo(found=f["n"])
            f["photo"] = p and p["n"]
        job.save()

    def catch_up(seen_since=None):
        for s in job.sightings(since=on_line[0]) if on_line[0] else []:
            sighted(s, photo=seen_since is not None and s["last_seen"] >= seen_since)

    job.on_sighting(lambda s: sighted(s, photo=True))
    try:
        job.status(f"climbing to {altitude:g} m")
        p = job.climb(altitude)["position"]
        first = min(range(len(route)), key=lambda i: math.dist(route[i], (p["north"] or 0, p["east"] or 0)))
        order = route[first:] + route[:first] + [route[first]]
        for i, (n, e) in enumerate(order, 1):
            job.status(f"stop {i}/{len(order)}")
            hd = round(math.degrees(math.atan2(e - cy, n - cx)) % 360, 1)   # look out, across the fence
            t = time.time()
            job.drone.goto(n, e, altitude=altitude, heading=hd, speed=speed, wait=False)
            job.wait_until(lambda s: math.dist((s["position"]["north"] or 0, s["position"]["east"] or 0), (n, e)) < 3
                           and abs(((s["position"]["heading"] or 0) - hd + 180) % 360 - 180) < 12, 120)
            on_line[0] = on_line[0] or t
            job.photo(stop=i)
            catch_up(seen_since=t)
            job.report["visited"] = i
            job.save()
        job.home()
    finally:
        try:
            catch_up()
        except Exception:
            pass
    new = [f for f in found if f["new"]]
    what = ", ".join(f"{f['label']} at N{f['north']:.0f} E{f['east']:.0f}" for f in new) if new else "nothing new"
    return (f"{job.report['visited']} stops, {len(job.report['photos'])} photos; "
            + (what if before is not None else f"first check, saw {len(found)}") + "; returning home")


app = plugin.app
