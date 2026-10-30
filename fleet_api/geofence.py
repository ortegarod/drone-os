"""Property geofence: polygons in lat/lon, checked by the fleet API before any flight command.

One fence for the site: an inclusion polygon (stay inside), optional exclusion polygons (stay out:
the house, a neighbour's yard) and a height limit. It applies to a drone whose home is inside the
inclusion polygon (PX4 likewise refuses a fence that doesn't contain home); other drones (another
site, the Baylands sim) keep the plain PX4 cylinder. Flat-earth maths: fine at property scale.

PX4 enforces the same fence onboard once the drone side can load it (MAVLink FENCE upload,
/<drone>/set_geofence); the fleet API's check refuses commands before they reach the drone, with
a reason a person can act on.
"""

import json
import math
import threading
import time
from pathlib import Path

M_PER_DEG = 111320.0
MARGIN_M = 3.0   # targets this close to an edge are refused: the drone overshoots a little


class FenceError(ValueError):
    pass


def to_ne(home, lat, lon):
    return ((lat - home[0]) * M_PER_DEG, (lon - home[1]) * M_PER_DEG * math.cos(math.radians(home[0])))


def to_latlon(home, n, e):
    return (home[0] + n / M_PER_DEG, home[1] + e / (M_PER_DEG * math.cos(math.radians(home[0]))))


def inside(pt, poly):
    """Point in polygon (ray casting); pt and poly in the same planar coordinates."""
    x, y = pt
    hit = False
    j = len(poly) - 1
    for i in range(len(poly)):
        xi, yi = poly[i]
        xj, yj = poly[j]
        if (yi > y) != (yj > y) and x < (xj - xi) * (y - yi) / (yj - yi) + xi:
            hit = not hit
        j = i
    return hit


def edge_distance(pt, poly):
    best = float("inf")
    for i in range(len(poly)):
        (ax, ay), (bx, by) = poly[i], poly[(i + 1) % len(poly)]
        dx, dy = bx - ax, by - ay
        L = dx * dx + dy * dy
        t = 0.0 if L == 0 else max(0.0, min(1.0, ((pt[0] - ax) * dx + (pt[1] - ay) * dy) / L))
        best = min(best, math.hypot(pt[0] - (ax + t * dx), pt[1] - (ay + t * dy)))
    return best


def _poly(v, what):
    try:
        pts = [(float(a), float(b)) for a, b in v]
    except (TypeError, ValueError):
        raise FenceError(f"{what}: a list of [lat, lon] points")
    if len(pts) < 3:
        raise FenceError(f"{what}: at least 3 points")
    if len(pts) > 64:
        raise FenceError(f"{what}: at most 64 points")
    if any(not (-90 <= a <= 90 and -180 <= b <= 180) for a, b in pts):
        raise FenceError(f"{what}: lat/lon out of range")
    return [[round(a, 7), round(b, 7)] for a, b in pts]


def validate(body):
    """The fence as sent by an operator -> the stored form; FenceError if it's no good."""
    inc = _poly(body.get("inclusion"), "inclusion")
    exc = [_poly(p, f"exclusion {i + 1}") for i, p in enumerate(body.get("exclusions") or [])]
    try:
        alt = float(body.get("max_altitude_m", 60))
    except (TypeError, ValueError):
        raise FenceError("max_altitude_m: a number")
    if not 5 <= alt <= 120:
        raise FenceError("max_altitude_m: 5-120 m")
    c = inc[0]
    ne = [to_ne(c, a, b) for a, b in inc]
    span = max(math.hypot(p[0] - q[0], p[1] - q[1]) for p in ne for q in ne)
    if span > 2000:
        raise FenceError("inclusion polygon spans more than 2 km: is a point misplaced?")
    return {"inclusion": inc, "exclusions": exc, "max_altitude_m": alt}


class Geofence:
    def __init__(self, path):
        self.path = Path(path).expanduser()
        self._lock = threading.Lock()
        self.fence = None
        if self.path.is_file():
            try:
                self.fence = json.loads(self.path.read_text()) or None
            except ValueError:
                self.fence = None

    def get(self):
        with self._lock:
            return dict(self.fence) if self.fence else None

    def set(self, body, by):
        f = {**validate(body), "updated": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), "by": by}
        with self._lock:
            self.path.parent.mkdir(parents=True, exist_ok=True)
            tmp = self.path.with_suffix(".tmp")
            tmp.write_text(json.dumps(f, indent=1))
            tmp.chmod(0o600)   # it's someone's property: not world-readable
            tmp.replace(self.path)
            self.fence = f
        return dict(f)

    def clear(self):
        with self._lock:
            self.fence = None
            if self.path.exists():
                self.path.unlink()

    # -- checks ---------------------------------------------------------------
    def _local(self, home):
        f = self.get()
        if not f or home is None:
            return None
        inc = [to_ne(home, a, b) for a, b in f["inclusion"]]
        if not inside((0.0, 0.0), inc):
            return None   # this drone's home isn't in the fence: not its site
        return f, inc, [[to_ne(home, a, b) for a, b in p] for p in f["exclusions"]]

    def applies(self, home):
        return self._local(home) is not None

    def check(self, home, points=(), path=(), altitude=None):
        """Refuse (FenceError with a reason) if any point (north, east from home), or any point
        along the path segments, is outside the fence or inside an exclusion, or the altitude
        is over the limit. No-op when the fence doesn't apply to this drone."""
        loc = self._local(home)
        if loc is None:
            return
        f, inc, exc = loc
        if altitude is not None and altitude > f["max_altitude_m"]:
            raise FenceError(f"{altitude:g} m is above the geofence's {f['max_altitude_m']:g} m limit")
        samples = [(p, True) for p in points]
        for a, b in path:   # every 2 m along each leg
            n = max(1, int(math.hypot(b[0] - a[0], b[1] - a[1]) // 2))
            samples += [((a[0] + (b[0] - a[0]) * k / n, a[1] + (b[1] - a[1]) * k / n), False) for k in range(n + 1)]
        for p, is_target in samples:
            where = f"N{p[0]:.0f} E{p[1]:.0f}"
            if not inside(p, inc):
                raise FenceError(f"{where} is outside the geofence" + ("" if is_target else " (on the way there)"))
            if is_target and edge_distance(p, inc) < MARGIN_M:
                raise FenceError(f"{where} is within {MARGIN_M:g} m of the geofence edge")
            for i, x in enumerate(exc):
                if inside(p, x):
                    raise FenceError(f"{where} is inside a no-fly area of the geofence" + ("" if is_target else " (on the way there)"))


def home_of(state, home_z=None):
    """A drone's home (lat, lon) from its GPS position minus its local offset; None if unknown."""
    try:
        lat, lon = float(state["latitude"]), float(state["longitude"])
        n, e = float(state["local_x"]), float(state["local_y"])
    except (KeyError, TypeError, ValueError):
        return None
    if lat != lat or lon != lon or (lat == 0 and lon == 0):
        return None
    return (lat - n / M_PER_DEG, lon - e / (M_PER_DEG * math.cos(math.radians(lat))))


def command_shape(command, args, here):
    """What a command would make the drone cross: (targets, legs, altitude). here = (north, east)."""
    a = args or {}
    alt = a.get("altitude")
    alt = float(alt) if isinstance(alt, (int, float)) or (isinstance(alt, str) and alt.strip()) else None
    if command == "takeoff":
        return [], [], alt
    if command == "goto":
        t = (float(a["north"]), float(a["east"]))
        return [t], [(here, t)], alt
    if command == "orbit":
        c, r = (float(a["north"]), float(a["east"])), float(a.get("radius", 20.0))
        ring = [(c[0] + r * math.cos(2 * math.pi * k / 24), c[1] + r * math.sin(2 * math.pi * k / 24)) for k in range(24)]
        return ring, [(here, ring[0])] + list(zip(ring, ring[1:] + ring[:1])), alt
    if command == "patrol":
        route = [(float(n), float(e)) for n, e in a.get("route") or []]
        legs = [(here, route[0])] + list(zip(route, route[1:])) + [(route[-1], route[0]), (route[-1], (0.0, 0.0))] if route else []
        return route, legs, alt
    return [], [], None
