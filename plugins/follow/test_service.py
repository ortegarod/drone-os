import math
import os
import sys
import time

sys.path.insert(0, os.path.dirname(__file__))

from fastapi.testclient import TestClient  # noqa: E402

import service  # noqa: E402

FLEET = {"X-DroneOS-Caller": "fleet-api"}


class Clock:
    def __init__(self):
        self.t = 1000.0

    def __call__(self):
        return self.t

    def sleep(self, s):
        self.t += s


class World:
    """A drone that is wherever it was last sent, and a person walking east at 1.2 m/s from
    N-30 E-30 (seen by the drone while within 70 m, unless `hidden` says otherwise)."""
    api, _token = "http://fleet", "t"

    def __init__(self, clock, hidden=lambda t: False):
        self.clock, self.hidden = clock, hidden
        self.calls = []
        self.pos = {"north": 0.0, "east": 0.0, "altitude": 0.0, "heading": 0.0}
        self.armed = False
        self.t0 = None
        self.dist = []

    def person(self):
        t = 0.0 if self.t0 is None else self.clock() - self.t0
        return -30.0, -30.0 + 1.2 * t

    def request(self, method, path, body=None, raw=False, timeout=30):
        self.calls.append((method, path, body))
        if method == "GET":
            pn, pe = self.person()
            objs = []
            if self.pos["altitude"] > 5 and not self.hidden(self.clock()) and \
                    math.hypot(pn - self.pos["north"], pe - self.pos["east"]) < 70:
                objs = [{"label": "person", "score": 0.8, "box": [0.5, 0.5, 0.52, 0.56], "confirmed": True,
                         "ground": {"north": round(pn + 0.4, 1), "east": round(pe - 0.3, 1)}}]
            if self.t0 is not None:
                self.dist.append(math.hypot(pn - self.pos["north"], pe - self.pos["east"]))
            return {"armed": self.armed, "landed_state": "AIRBORNE" if self.pos["altitude"] > 0 else "ON_GROUND",
                    "position": dict(self.pos), "detections": {"objects": objs}}
        cmd = path.rsplit("/", 1)[-1]
        if cmd == "takeoff":
            self.armed, self.pos["altitude"] = True, body["altitude"]
        if cmd == "goto":
            self.pos.update(north=body["north"], east=body["east"])
            if body.get("altitude"):
                self.pos["altitude"] = body["altitude"]
            if body.get("heading") is not None:
                self.pos["heading"] = body["heading"]
            if body.get("altitude") == 30 and self.t0 is None:
                self.t0 = self.clock()   # the person starts walking when the drone gets down there
        return {"message": cmd + " ok"}


def run_job(tmp_path, world, clock, args):
    service.plugin.configure(client=world, reports=tmp_path, fetch_photo=lambda d: b"\xff\xd8x",
                             sleep=lambda job, s: clock.sleep(s), clock=clock)
    c = TestClient(service.app)
    r = c.post("/jobs", json={"job": {"id": "f1", "drone": "drone1", "operator": "alice"}, "args": args}, headers=FLEET)
    assert r.status_code == 200, r.text
    service.plugin.running["f1"][1].join(10)
    return c, [b for m, p, b in world.calls if m == "DELETE"][0]


def test_target_does_not_jump_to_someone_standing_nearby():
    # walking north-east-ish along E -21, then unseen for 4 s at the corner; a standing person 15 m off
    t = service.Target(-28, -21, 0)
    for k in range(1, 9):
        assert t.update([(-28 + 1.2 * k * 0.5, -21, True)], k * 0.5)
    assert not t.update([(-14, -4, True)], 8.5)          # 17 m from the last fix after 4 s: not them
    assert t.update([(-14.5 + 0.3, -21.2, True), (-14, -4, True)], 8.5)   # them, on their way
    assert abs(t.e + 21) < 1
    # an unconfirmed box counts only right where they should be
    n0 = t.n
    assert not t.update([(t.n + 5, t.e, False)], 9.0)
    assert t.update([(t.predict(9.0)[0] + 1, t.e, False)], 9.0) and t.n > n0


def test_target_finds_them_again_after_a_long_gap_but_not_a_bystander():
    t = service.Target(-28, -21, 0)
    for k in range(1, 9):   # walking north; someone stands at N-14 E-4 the whole time
        assert t.update([(-28 + 1.2 * k * 0.5, -21, True), (-14, -4, True)], k * 0.5)
    # 11 s out of sight; they've turned the corner and are 13 m from where the prediction says
    assert not t.update([(-14, -4, True)], 15)            # the bystander, though within walking reach
    assert t.update([(-12, -18, True), (-14, -4, True)], 15)
    assert abs(t.n + 12) < 8 and t.e > -21


def test_target_not_handed_to_someone_standing_by_a_corner():
    # the yard: someone stands at N12 E10, seen at lock-on; the walker goes north up E11 and turns
    # the corner 4.5 m from them, where the detector misses the walker for a few seconds
    t = service.Target(5, 9, 0)
    t.note_bystanders([(5, 9, True), (12, 10, True)], (5, 9, True), 0)
    for k in range(1, 5):
        assert t.update([(5 + 0.6 * k, 11, True)], k * 0.5)
    for k in range(5, 12):   # only the bystander in view, some fixes right where the prediction is
        assert not t.update([(12, 10, True), (11.5, 10.5, False)], k * 0.5)
    assert t.update([(7.5, 9, True), (12, 10, True)], 6.0)   # the walker, heading west
    assert math.hypot(t.n - 12, t.e - 10) > 3
    # walking right past them: a short gap while they're within 3 m of them, then them again
    t2 = service.Target(12, 3, 0)
    t2.bystanders = [[12, 10, 0]]
    seen = [t2.update([(12, 3 + 0.6 * k, True), (12, 10, True)], k * 0.5) for k in range(1, 20)]
    assert seen[:6] == [True] * 6 and not any(seen[8:15]) and all(seen[-3:])
    assert t2.e > 13


def test_target_follows_the_nearest_and_learns_speed():
    t = service.Target(0, 0, 0)
    for k in range(1, 11):
        assert t.update([(0, 1.2 * k * 0.5), (20, 20)], k * 0.5)
    assert abs(t.ve - 1.2) < 0.2 and abs(t.vn) < 0.1
    assert abs(t.predict(5 + 2)[1] - (6 + 2.4)) < 0.5
    assert not t.update([(20, 20)], 5.5)            # someone else, far off: not them


def test_follows_a_walking_person(tmp_path):
    clock = Clock()
    w = World(clock)
    c, end = run_job(tmp_path, w, clock, {"north": -30, "east": -30, "minutes": 1})
    assert end["result"] == "completed" and end["reason"].startswith("followed for 1 min")
    gotos = [b for m, p, b in w.calls if m == "POST" and p.endswith("/goto")]
    assert gotos[0]["altitude"] == 50 and gotos[1]["altitude"] == 30   # stand-off at 50 m, then down
    # while following, the drone stays within distance (= altitude, 30 m) + slack (5 m) of them...
    following = w.dist[len(w.dist) // 4:]
    assert 14 < min(following) and max(following) < 37, (min(following), max(following))
    # ...and moves only now and then (a walker at 1.2 m/s for a minute: a handful of hops, not 60)
    rep = c.get("/reports/f1").json()
    assert 2 <= rep["moves"] <= 12, rep["moves"]
    # and points at them
    last = gotos[-1]
    pn, pe = w.person()
    assert service.angle_diff(last["heading"], service.bearing(last["north"], last["east"], pn, pe)) < 15
    assert 55 < rep["walked_m"] < 85 and rep["photos"] and rep["path"]   # 72 m walked
    assert [p.rsplit("/", 1)[-1] for m, p, b in w.calls if m == "POST"][-1] == "return_home"


def test_lost_person_ends_the_job(tmp_path):
    clock = Clock()
    w = World(clock, hidden=lambda t: t > 1080)   # walks under the trees after a while
    c, end = run_job(tmp_path, w, clock, {"north": -30, "east": -30, "minutes": 10, "lost_seconds": 10})
    assert end["result"] == "completed" and "lost the person for 10 s" in end["reason"]
    assert c.get("/reports/f1").json()["lost_count"] == 1


def test_nobody_there_fails(tmp_path):
    clock = Clock()
    w = World(clock, hidden=lambda t: True)
    c, end = run_job(tmp_path, w, clock, {"north": -30, "east": -30})
    assert end["result"] == "failed" and "no person seen" in end["reason"]
    assert [p.rsplit("/", 1)[-1] for m, p, b in w.calls if m == "POST"][-1] == "return_home"


def test_bad_args_refused(tmp_path):
    service.plugin.configure(client=World(Clock()), reports=tmp_path, fetch_photo=lambda d: b"", sleep=lambda job, s: None)
    c = TestClient(service.app)
    job = {"job": {"id": "x", "drone": "drone1"}}
    assert c.post("/jobs", json={**job, "args": {"north": 0}}, headers=FLEET).status_code == 422
    r = c.post("/jobs", json={**job, "args": {"north": 500, "east": 0}}, headers=FLEET)
    assert r.status_code == 422 and "within 280 m" in r.json()["detail"]
    assert "distance must be 10-80" in c.post("/jobs", json={**job, "args": {"north": 0, "east": 0, "distance": 5}},
                                             headers=FLEET).json()["detail"]
    assert c.post("/jobs", json={**job, "args": {"north": 0, "east": 0}}).status_code == 403


def test_tilted_fixes_are_not_trusted_but_not_lost_either():
    v = {"attitude": {"roll": 1.0, "pitch": -2.0},
         "detections": {"objects": [{"label": "person", "confirmed": True, "ground": {"north": 1, "east": 2}},
                                    {"label": "person", "confirmed": False, "ground": {"north": 5, "east": 5}},
                                    {"label": "car", "confirmed": True, "ground": {"north": 9, "east": 9}}]}}
    assert service.people_in(v) == [(1, 2, True)]
    assert service.people_in(v, confirmed_only=False) == [(1, 2, True), (5, 5, False)]
    assert service.people_in({**v, "attitude": {"roll": 0.0, "pitch": -9.0}}) is None
    assert service.people_in({}) == []
