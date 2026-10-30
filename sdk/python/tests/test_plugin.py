"""Tests for droneos.plugin (the plugin SDK). Needs fastapi + httpx (TestClient)."""

import threading
import time

import pytest
from fastapi.testclient import TestClient

from droneos.plugin import EventStream, Plugin, Stopped, arg

FLEET = {"X-DroneOS-Caller": "fleet-api"}


class Fleet:
    """A fake fleet API: records calls, drone climbs instantly."""
    api, _token = "http://fleet", "t"

    def __init__(self, armed=False):
        self.calls, self.armed, self.alt = [], armed, 50.0 if armed else 0.0

    def request(self, method, path, body=None, timeout=30, raw=False):
        self.calls.append((method, path, body))
        if path.endswith("/sightings?since=" + path.rsplit("=", 1)[-1]):
            return [{"id": "s9", "label": "car", "first_seen": time.time() + 1}]
        if method == "GET":
            return {"armed": self.armed, "online": True, "landed_state": "AIRBORNE" if self.alt > 0 else "ON_GROUND",
                    "mode": "AUTO_LOITER", "detections": {"objects": [{"label": "person"}]},
                    "position": {"altitude": self.alt, "north": 3.0, "east": 4.0}}
        if path.endswith("/takeoff"):
            self.armed, self.alt = True, body["altitude"]
        if path.endswith("/return_home"):
            self.armed, self.alt = False, 0.0
        return {"message": path.rsplit("/", 1)[-1] + " ok"}

    def posts(self):
        return [p.rsplit("/", 1)[-1] for m, p, b in self.calls if m == "POST"]

    def end(self):
        return [b for m, p, b in self.calls if m == "DELETE"]


def make(tmp_path, fleet=None, **kw):
    p = Plugin("demo", root=tmp_path)
    p.configure(client=fleet or Fleet(), reports=tmp_path / "r", fetch_photo=lambda d: b"\xff\xd8jpg",
                sleep=kw.pop("sleep", lambda job, s: job.stopped.wait(0.01)), **kw)
    return p, TestClient(p.app)


def run(c, p, args, jid="j1"):
    r = c.post("/jobs", json={"job": {"id": jid, "drone": "drone1", "operator": "op"}, "args": args}, headers=FLEET)
    if r.status_code == 200:
        p.running[jid][1].join(5)
    return r


def test_args_from_signature(tmp_path):
    p, c = make(tmp_path)
    got = {}

    @p.job(check=lambda a: a["low"] < a["high"] or (_ for _ in ()).throw(ValueError("low must be under high")))
    def demo(job, north: float, count: int = arg(3, min=1, max=8), fast: bool = False,
             low: float = 10, high: float = 20, points: list = arg([])):
        got.update(north=north, count=count, fast=fast, points=points)

    assert run(c, p, {"north": "1.5", "count": "4", "fast": "yes"}).status_code == 200
    assert got == {"north": 1.5, "count": 4, "fast": True, "points": []}
    bad = run(c, p, {"count": 9, "colour": "red", "fast": "maybe"}, "j2")
    assert bad.status_code == 422
    d = bad.json()["detail"]
    assert "unknown argument colour" in d and "north is required" in d and "count must be 1-8" in d
    assert "fast must be true or false" in d and "Arguments: north, count 1-8 (default 3)" in d
    assert "low must be under high" in run(c, p, {"north": 0, "low": 30}, "j3").json()["detail"]
    assert run(c, p, {"north": "nan"}, "j4").status_code == 422
    assert c.get("/args").json()["count"] == {"type": "int", "required": False, "default": 3, "min": 1,
                                              "max": 8, "help": ""}


def test_completed_job_ends_itself_with_its_report(tmp_path):
    f = Fleet()
    p, c = make(tmp_path, f)

    @p.job(text=lambda a: f"to {a['alt']:g} m")
    def demo(job, alt: float = 50):
        job.climb(alt)
        job.status("looking")
        job.photo(what="roof")
        job.report["seen"] = [d["label"] for d in job.detections()]
        job.home()
        return "1 photo"

    r = run(c, p, {})
    assert r.json() == {"text": "to 50 m", "links": {"report": "j1"}}
    assert f.posts() == ["takeoff", "return_home"]
    assert [b["text"] for m, pa, b in f.calls if m == "PATCH"] == ["looking"]
    assert f.end() == [{"id": "j1", "result": "completed", "reason": "1 photo", "links": {"report": "j1"}}]
    rep = c.get("/reports/j1").json()
    assert rep["status"] == "completed" and rep["summary"] == "1 photo" and rep["seen"] == ["person"]
    assert rep["photos"][0] | {"time": 0} == {"n": 1, "time": 0, "north": 3.0, "east": 4.0, "altitude": 50.0, "what": "roof"}
    assert c.get("/reports/j1/photos/1.jpg").content == b"\xff\xd8jpg"
    assert [x["id"] for x in c.get("/reports?drone=drone1").json()] == ["j1"]
    assert c.get("/jobs/j1").json()["running"] is False
    assert c.get("/jobs/nope").status_code == 404


def test_failure_sends_a_flying_drone_home(tmp_path):
    f = Fleet()
    p, c = make(tmp_path, f)

    @p.job
    def demo(job):
        job.climb(50)
        raise RuntimeError("lost the plot")

    run(c, p, {})
    assert f.posts() == ["takeoff", "return_home"]
    assert f.end()[0]["result"] == "failed" and f.end()[0]["reason"] == "lost the plot; sent home"


def test_failure_on_the_ground_sends_nothing(tmp_path):
    f = Fleet(armed=True)
    f.alt = 0.0   # armed on the ground (e.g. just landed): an RTL there would block the next arming
    p, c = make(tmp_path, f)

    @p.job
    def demo(job):
        raise RuntimeError("nope")

    run(c, p, {})
    assert f.posts() == [] and f.end()[0]["reason"] == "nope"


def test_stop_unwinds_the_job_and_blocks_commands(tmp_path):
    f = Fleet(armed=True)
    p, c = make(tmp_path, f)
    inside, swallowed = threading.Event(), []

    @p.job
    def demo(job):
        try:
            inside.set()
            job.drone.goto(100, 100, wait=True)   # never gets there: the fake doesn't move
        except Exception as e:                    # a broad except must not swallow the stop
            swallowed.append(e)
        job.drone.hold()                          # would fly on after the stop

    c.post("/jobs", json={"job": {"id": "j1", "drone": "drone1"}, "args": {}}, headers=FLEET)
    inside.wait(2)
    time.sleep(0.1)
    assert c.post("/jobs/j1/stopped", json={"reason": "bob: land"}).status_code == 403
    assert c.post("/jobs/j1/stopped", json={"reason": "bob: land"}, headers=FLEET).json() == {"ok": True}
    p.running["j1"][1].join(5)
    assert not swallowed
    assert f.posts() == ["goto"] and not f.end()
    rep = c.get("/reports/j1").json()
    assert rep["status"] == "stopped" and rep["summary"] == "bob: land"


def test_sightings_listener_runs_for_the_job(tmp_path):
    started, stopped = [], []

    class Listener:
        def __init__(self, job, fn):
            self.fn, self.stop = fn, threading.Event()

        def start(self):
            started.append(1)
            self.fn({"id": "s1", "label": "person"})

    p, c = make(tmp_path, listen=Listener)
    seen = []

    @p.job
    def demo(job):
        job.on_sighting(lambda s: seen.append(s["label"]))
        seen.extend(s["label"] for s in job.sightings())
        stopped.append(job._listeners[0])

    run(c, p, {})
    assert seen == ["person", "car"] and started == [1] and stopped[0].stop.is_set()


def test_wait_until_times_out_on_the_clock(tmp_path):
    t = [0.0]
    p, c = make(tmp_path, clock=lambda: t[0], sleep=lambda job, s: t.__setitem__(0, t[0] + s))
    out = []

    @p.job
    def demo(job):
        out.append(job.wait_until(lambda s: False, 30, every=5))
        out.append(t[0])

    run(c, p, {})
    assert out == [None, 30.0]


def test_stopped_is_not_an_exception():
    assert not issubclass(Stopped, Exception)


def test_duplicate_start_and_no_ui(tmp_path):
    p, c = make(tmp_path)
    gate = threading.Event()

    @p.job
    def demo(job):
        gate.wait(2)

    body = {"job": {"id": "j1", "drone": "drone1"}, "args": {}}
    assert c.post("/jobs", json=body, headers=FLEET).status_code == 200
    assert c.post("/jobs", json=body, headers=FLEET).json()["text"] == "already running"
    assert c.get("/jobs/j1").json()["running"] is True
    gate.set()
    p.running["j1"][1].join(5)
    assert c.get("/ui/job.js").status_code == 404


def test_event_stream_reconnects_and_passes_detections():
    msgs = [['{"command": "hold"}', '{"command": "detected", "sighting": {"id": "d-1"}}'], ['{"command": "detected", "sighting": {"id": "d-2"}}']]
    got, urls = [], []

    class WS:
        def __init__(self, batch):
            self.batch = list(batch)
        def __enter__(self):
            return self
        def __exit__(self, *a):
            return False
        def recv(self, timeout=None):
            if self.batch:
                return self.batch.pop(0)
            raise ConnectionError("dropped")

    def connect(url, open_timeout=5):
        urls.append(url)
        if not msgs:
            raise ConnectionError("down")
        return WS(msgs.pop(0))

    class J:
        id = "j1"
        _c = type("C", (), {"api": "http://127.0.0.1:8090", "_token": "tok"})()
        drone = type("D", (), {"name": "drone1"})()

    lis = EventStream(J(), lambda s: got.append(s["id"]), connect=connect)
    lis.stop.wait = lambda s: time.sleep(0.01)   # don't wait 2 s between tries in the test
    lis.start()
    for _ in range(200):
        if len(got) == 2:
            break
        time.sleep(0.01)
    lis.stop.set()
    lis.join(2)
    assert got == ["d-1", "d-2"] and urls[0] == "ws://127.0.0.1:8090/api/v1/events?token=tok&drone=drone1"
