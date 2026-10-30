import os
import sys
import threading
import time

sys.path.insert(0, os.path.dirname(__file__))

from fastapi.testclient import TestClient  # noqa: E402

import service  # noqa: E402

FLEET = {"X-DroneOS-Caller": "fleet-api"}


class FakeDrone:
    """A drone that is wherever it was last sent, instantly."""
    api, _token = "http://fleet", "t"

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
            return {"armed": self.armed, "online": True, "position": dict(self.pos)}
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
    def __init__(self, job, on_sighting):
        self.on_sighting, self.stop = on_sighting, threading.Event()
        FakeListener.last = self

    def start(self):
        pass


def person(i, n, e):
    return {"id": f"drone1-{i}", "label": "person", "score": 0.8, "north": n, "east": e, "lat": 1.0, "lon": 2.0,
            "box": [0.4, 0.5, 0.45, 0.6], "first_seen": time.time() + 1, "last_seen": time.time() + 1}


def setup(tmp_path, fd, sleep=lambda job, s: None):
    service.plugin.configure(client=fd, reports=tmp_path, fetch_photo=lambda d: b"\xff\xd8x", sleep=sleep, listen=FakeListener)
    return TestClient(service.app)


def test_args(tmp_path):
    assert service.look_points("10,20 -30,5") == [[10.0, 20.0], [-30.0, 5.0]]
    c = setup(tmp_path, FakeDrone())
    for bad, why in (({"points": []}, "points must be 1-10 points"), ({"points": "400,0"}, "within 290 m"),
                     ({"points": "1,1", "look_altitude": 60}, "look_altitude must be 20-45"),
                     ({"points": "1,1", "altitude": 45, "look_altitude": 45}, "look_altitude must be below altitude"),
                     ({"points": "1,1", "looks": 0}, "looks must be 1-8"), ({}, "points is required")):
        r = c.post("/jobs", json={"job": {"id": "x", "drone": "drone1"}, "args": bad}, headers=FLEET)
        assert r.status_code == 422 and why in r.json()["detail"], (bad, r.text)


def test_search_job_flies_looks_and_reports(tmp_path):
    fd = FakeDrone()
    c = setup(tmp_path, fd)
    seen = []
    def on_goto(body):   # at point 1, second heading: the detector confirms someone (twice: one entry)
        if body.get("heading") is not None and body["north"] == 40 and len([b for b in seen if b.get("heading") is not None]) == 1:
            FakeListener.last.on_sighting(person(1, 52, 3))
            FakeListener.last.on_sighting(person(1, 52, 3))
        seen.append(body)
    fd.on_goto = on_goto
    stale = {**person(2, -10, 60), "last_seen": time.time() - 100}
    fd.sightings = [stale]   # #2 only in the fleet API's list (seen before the job / socket missed it): no photo
    job = {"id": "s1", "drone": "drone1", "operator": "alice"}
    assert c.post("/jobs", json={"job": job, "args": {"points": "40,0 40,40"}}).status_code == 403
    assert c.post("/jobs", json={"job": job, "args": {"points": "999,0"}}, headers=FLEET).status_code == 422
    r = c.post("/jobs", json={"job": job, "args": {"points": "40,0 40,40", "looks": 2}}, headers=FLEET)
    assert r.status_code == 200 and "2 points" in r.json()["text"], r.text
    service.plugin.running["s1"][1].join(5)
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
    assert [(f["id"], f["point"], f["photo"]) for f in rep["found"]] == [("drone1-2", 1, None), ("drone1-1", 1, 1)]
    assert c.get("/reports/s1/photos/1.jpg").content.startswith(b"\xff\xd8")


def test_found_earlier_gets_its_photo_when_seen_from_a_look(tmp_path):
    fd = FakeDrone()
    c = setup(tmp_path, fd)
    early = {**person(1, 5, 5), "last_seen": time.time() - 100}   # seen at takeoff, not from the look point
    fd.sightings = [early]
    looks = []
    def on_goto(body):   # seen again while facing the third heading
        if body.get("heading") is not None:
            looks.append(body)
            if len(looks) == 3:
                fd.sightings = [{**early, "last_seen": time.time() + 5}]
    fd.on_goto = on_goto
    c.post("/jobs", json={"job": {"id": "s3", "drone": "drone1"}, "args": {"points": "40,0"}}, headers=FLEET)
    service.plugin.running["s3"][1].join(5)
    f = c.get("/reports/s3").json()["found"]
    assert [(x["id"], x["photo"]) for x in f] == [("drone1-1", 1)]
    assert any(m == "PATCH" and "looking" in (b or {}).get("text", "") for m, p, b in fd.calls)
    assert FakeListener.last.stop.is_set()
    assert c.get("/ui/job.js").text.startswith("// Search plugin UI")


def test_stopped_search_does_not_end_itself(tmp_path):
    fd = FakeDrone()
    c = setup(tmp_path, fd, sleep=lambda job, s: job.stopped.wait(0.05))
    c.post("/jobs", json={"job": {"id": "s2", "drone": "drone1"}, "args": {"points": "10,10 20,20", "look_seconds": 30}}, headers=FLEET)
    time.sleep(0.3)
    c.post("/jobs/s2/stopped", json={"reason": "bob: return home"}, headers=FLEET)
    service.plugin.running["s2"][1].join(5)
    assert c.get("/reports/s2").json()["status"] == "stopped"
    assert not [1 for m, p, b in fd.calls if m == "DELETE" or p.endswith("/return_home")]

