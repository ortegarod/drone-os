import os
import sys
import threading
import time

os.environ["SEARCH_NO_AUTOSTART"] = "1"
sys.path.insert(0, os.path.dirname(__file__))

from fastapi.testclient import TestClient  # noqa: E402

import service  # noqa: E402

FLEET = {"X-DroneOS-Caller": "fleet-api"}


class FakeDrone:
    """A drone that is wherever it was last sent, instantly."""

    def __init__(self):
        self.calls = []
        self.pos = {"north": 0.0, "east": 0.0, "altitude": 0.0, "heading": 0.0}
        self.armed = False
        self.on_goto = None
        self.sightings = []

    def request(self, method, path, body=None, raw=False, timeout=30):
        self.calls.append((method, path, body))
        if method == "GET" and "/sightings" in path:
            return self.sightings
        if method == "GET":
            return {"armed": self.armed, "position": dict(self.pos)}
        cmd = path.rsplit("/", 1)[-1]
        if cmd == "takeoff":
            self.armed, self.pos["altitude"] = True, body["altitude"]
        if cmd == "goto":
            self.pos.update(north=body["north"], east=body["east"])
            if "altitude" in body:
                self.pos["altitude"] = body["altitude"]
            if body.get("heading") is not None:
                self.pos["heading"] = body["heading"]
            if self.on_goto:
                self.on_goto(body)
        return {"message": cmd + " ok"}


class FakeListener:
    def __init__(self, drone, on_sighting):
        self.on_sighting, self.stop = on_sighting, threading.Event()
        FakeListener.last = self

    def start(self):
        pass


def person(i, n, e):
    return {"id": f"drone1-{i}", "label": "person", "score": 0.8, "north": n, "east": e, "lat": 1.0, "lon": 2.0,
            "box": [0.4, 0.5, 0.45, 0.6], "first_seen": time.time() + 1, "last_seen": time.time() + 1}


def test_parse_args():
    a = service.parse_args({"points": "10,20 -30,5"})
    assert a["points"] == [[10.0, 20.0], [-30.0, 5.0]] and a["look_altitude"] == 30 and a["looks"] == 4
    for bad in ({"points": []}, {"points": "400,0"}, {"points": "1,1", "look_altitude": 60},
                {"points": "1,1", "altitude": 30}, {"points": "1,1", "looks": 0}):
        try:
            service.parse_args(bad)
            raise AssertionError(bad)
        except (ValueError, AssertionError, KeyError) as e:
            assert not str(e).startswith("{"), bad


def test_search_job_flies_looks_and_reports(tmp_path):
    fd = FakeDrone()
    app = service.create_app(client=fd, reports_dir=tmp_path, fetch_photo=lambda d: b"\xff\xd8x",
                             sleep=lambda s: None, listen=FakeListener)
    seen = []
    def on_goto(body):   # at point 1, second heading: the detector confirms someone (twice: one entry)
        if body.get("heading") is not None and body["north"] == 40 and len([b for b in seen if b.get("heading") is not None]) == 1:
            FakeListener.last.on_sighting(person(1, 52, 3))
            FakeListener.last.on_sighting(person(1, 52, 3))
        seen.append(body)
    fd.on_goto = on_goto
    fd.sightings = [person(1, 52, 3), person(2, -10, 60)]   # #2 only in the fleet API's list (socket missed it)
    c = TestClient(app)
    job = {"id": "s1", "drone": "drone1", "operator": "alice"}
    assert c.post("/jobs", json={"job": job, "args": {"points": "40,0 40,40"}}).status_code == 403
    assert c.post("/jobs", json={"job": job, "args": {"points": "999,0"}}, headers=FLEET).status_code == 422
    r = c.post("/jobs", json={"job": job, "args": {"points": "40,0 40,40", "looks": 2}}, headers=FLEET)
    assert r.status_code == 200 and "2 points" in r.json()["text"], r.text
    app.state.running["s1"].join(5)
    gotos = [b for m, p, b in fd.calls if m == "POST" and p.endswith("/goto")]
    # per point: transit at 50 m, 2 headings at 30 m, straight up again
    assert [(g["north"], g["east"], g["altitude"], g.get("heading")) for g in gotos[:4]] == [
        (40, 0, 50.0, None), (40, 0, 30.0, 0.0), (40, 0, 30.0, 180.0), (40, 0, 50.0, None)]
    assert gotos[5]["heading"] == 90.0          # point 2 faces the way it came in (east)
    posts = [p.rsplit("/", 1)[-1] for m, p, b in fd.calls if m == "POST"]
    assert posts[0] == "takeoff" and posts[-1] == "return_home"
    end = [b for m, p, b in fd.calls if m == "DELETE"][0]
    assert end["result"] == "completed" and end["reason"].startswith("found person 2 at 2/2 points")
    rep = c.get("/reports/s1").json()
    assert [(f["id"], f["point"], f["photo"]) for f in rep["found"]] == [("drone1-1", 1, True), ("drone1-2", 2, False)]
    assert c.get("/reports/s1/photos/1.jpg").content.startswith(b"\xff\xd8")
    assert any(m == "PATCH" and "looking" in (b or {}).get("text", "") for m, p, b in fd.calls)
    assert FakeListener.last.stop.is_set()
    assert c.get("/ui/job.js").text.startswith("// Search plugin UI")


def test_stopped_search_does_not_end_itself(tmp_path):
    fd = FakeDrone()
    app = service.create_app(client=fd, reports_dir=tmp_path, fetch_photo=lambda d: b"\xff\xd8x",
                             sleep=lambda s: time.sleep(0.05), listen=FakeListener)
    c = TestClient(app)
    c.post("/jobs", json={"job": {"id": "s2", "drone": "drone1"}, "args": {"points": "10,10 20,20", "look_seconds": 30}}, headers=FLEET)
    time.sleep(0.3)
    c.post("/jobs/s2/stopped", json={"reason": "bob: return home"}, headers=FLEET)
    app.state.running["s2"].join(5)
    assert c.get("/reports/s2").json()["status"] == "stopped"
    assert not [1 for m, p, b in fd.calls if m == "DELETE" or p.endswith("/return_home")]


def test_event_listener_reconnects_and_passes_detections():
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

    lis = service.EventListener("http://127.0.0.1:8090", "tok", "drone1", lambda s: got.append(s["id"]), connect=connect)
    lis.stop.wait = lambda s: time.sleep(0.01)   # don't wait 2 s between tries in the test
    lis.start()
    for _ in range(200):
        if len(got) == 2:
            break
        time.sleep(0.01)
    lis.stop.set()
    lis.join(2)
    assert got == ["d-1", "d-2"] and urls[0] == "ws://127.0.0.1:8090/api/v1/events?token=tok&drone=drone1"
