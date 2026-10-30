import math
import os
import sys
import threading
import time

sys.path.insert(0, os.path.dirname(__file__))

from fastapi.testclient import TestClient  # noqa: E402

import service  # noqa: E402

FLEET = {"X-DroneOS-Caller": "fleet-api"}
LAT, LON = 45.0, 10.0
M = 111320.0
K = math.cos(math.radians(LAT))


def ll(n, e):
    return [LAT + n / M, LON + e / (M * K)]


class Fleet:
    """A drone that is wherever it was last sent, a 200 x 200 m fence around home, a car seen at one stop."""
    api, _token = "http://fleet", "t"

    def __init__(self, fence=True):
        self.calls, self.armed, self.pos = [], False, {"north": 0.0, "east": 0.0, "altitude": 0.0, "heading": 0.0}
        self.fence = {"inclusion": [ll(-100, -100), ll(-100, 100), ll(100, 100), ll(100, -100)],
                      "exclusions": [[ll(90, -10), ll(90, 10), ll(110, 10), ll(110, -10)]],
                      "max_altitude_m": 60} if fence else None
        self.sightings, self.car_at = [], None

    def request(self, method, path, body=None, timeout=30, raw=False):
        self.calls.append((method, path, body))
        if path == "/api/v1/geofence":
            return {"fence": self.fence, "drones": {"drone1": {"applies": bool(self.fence)}}}
        if path == "/api/v1/config":
            return {"geofence": {"radius_m": 120.0, "max_altitude_m": 120.0}}
        if "/sightings" in path:
            return self.sightings
        if method == "GET":
            p = self.pos
            return {"armed": self.armed, "landed_state": "AIRBORNE" if p["altitude"] > 0 else "ON_GROUND",
                    "position": dict(p), "gps": {"lat": LAT + p["north"] / M, "lon": LON + p["east"] / (M * K)}}
        cmd = path.rsplit("/", 1)[-1]
        if cmd == "takeoff":
            self.armed, self.pos["altitude"] = True, body["altitude"]
        if cmd == "goto":
            self.pos.update(north=body["north"], east=body["east"], heading=body.get("heading") or 0)
            if self.car_at and (body["north"], body["east"]) == self.car_at:
                self.sightings = [{"id": "drone1-7", "label": "car", "score": 0.9, "north": body["north"] + 20,
                                   "east": body["east"], "first_seen": time.time(), "last_seen": time.time() + 1}]
        return {"message": cmd + " ok"}


def setup(tmp_path, fleet):
    class Quiet:   # no event socket in tests: sightings come from the fleet API's list
        def __init__(self, job, fn):
            self.stop = threading.Event()

        def start(self):
            pass
    service.plugin.configure(client=fleet, reports=tmp_path, fetch_photo=lambda d: b"\xff\xd8x",
                             sleep=lambda job, s: None, listen=Quiet)
    return TestClient(service.app)


def run(c, jid, args=None):
    r = c.post("/jobs", json={"job": {"id": jid, "drone": "drone1"}, "args": args or {}}, headers=FLEET)
    assert r.status_code == 200, r.text
    service.plugin.running[jid][1].join(5)
    return c.get("/reports/" + jid).json()


def test_shrink_and_stops():
    sq = [[-100, -100], [-100, 100], [100, 100], [100, -100]]
    for poly in (sq, sq[::-1]):   # either winding
        assert sorted(map(lambda p: (round(p[0]), round(p[1])), service.shrink(poly, 10))) == \
            [(-90, -90), (-90, 90), (90, -90), (90, 90)]
    fence = {"inclusion": sq, "exclusions": [[[80, -10], [80, 10], [100, 10], [100, -10]]], "radius": 120}
    pts = service.stops(fence, 10, 45)
    assert all(math.hypot(n, e) <= 110.1 for n, e in pts)          # PX4's radius - 10 m: corners pulled in
    assert not any(80 < n < 100 and -10 < e < 10 for n, e in pts)   # nothing in the no-fly area
    assert len(pts) == 4 * 4 - 1


def test_flies_the_fence_and_marks_what_is_new(tmp_path):
    f = Fleet()
    c = setup(tmp_path, f)
    rep = run(c, "p1")
    assert rep["status"] == "completed" and rep["compared"] is False
    gotos = [b for m, p, b in f.calls if p.endswith("/goto")]
    assert len(gotos) == len(rep["route"]) + 1 and len(rep["photos"]) == len(gotos)   # a photo per stop, back to the start
    assert all(b["altitude"] == 50 for b in gotos)
    n, e, hd = gotos[0]["north"], gotos[0]["east"], gotos[0]["heading"]
    assert abs((math.degrees(math.atan2(e, n)) - hd + 180) % 360 - 180) < 30      # looking out
    assert [p.rsplit("/", 1)[-1] for m, p, b in f.calls if m == "POST"][-1] == "return_home"
    # second check: a car shows up at the third stop: it's new
    f2 = Fleet()
    f2.car_at = (rep["route"][2][0], rep["route"][2][1])
    c = setup(tmp_path, f2)
    rep2 = run(c, "p2")
    assert rep2["compared"] is True
    assert [(x["label"], x["new"], bool(x["photo"])) for x in rep2["found"]] == [("car", True, True)]
    end = [b for m, p, b in f2.calls if m == "DELETE"][0]
    assert end["result"] == "completed" and "car at N" in end["reason"]


def test_no_fence_fails_on_the_ground(tmp_path):
    f = Fleet(fence=False)
    c = setup(tmp_path, f)
    rep = run(c, "p3")
    assert rep["status"] == "failed" and "draw one in the Dev tab" in rep["summary"]
    assert not [1 for m, p, b in f.calls if m == "POST"]


def test_bad_args(tmp_path):
    c = setup(tmp_path, Fleet())
    r = c.post("/jobs", json={"job": {"id": "x", "drone": "drone1"}, "args": {"spacing": 5}}, headers=FLEET)
    assert r.status_code == 422 and "spacing must be 20-200" in r.json()["detail"]
