import os
import sys
import time

sys.path.insert(0, os.path.dirname(__file__))

from fastapi.testclient import TestClient  # noqa: E402

import service  # noqa: E402

FLEET = {"X-DroneOS-Caller": "fleet-api"}


class FakeClient:
    api, _token = "http://fleet", "t"

    def __init__(self):
        self.calls = []
        self.alt = 0.0

    def request(self, method, path, body=None, timeout=30, raw=False):
        self.calls.append((method, path, body))
        if method == "GET":
            return {"armed": self.alt > 0, "online": True, "position": {"altitude": self.alt, "north": 1.0, "east": 2.0}}
        if path.endswith("/takeoff"):
            self.alt = body["altitude"]
        return {"message": path.rsplit("/", 1)[-1] + " ok"}


def setup(tmp_path, sleep=lambda job, s: None):
    fc = FakeClient()
    service.plugin.configure(client=fc, reports=tmp_path, fetch_photo=lambda d: b"\xff\xd8x", sleep=sleep)
    return fc, TestClient(service.app)


def wait(jid):
    service.plugin.running[jid][1].join(5)


def test_inspection_job(tmp_path):
    fc, c = setup(tmp_path)
    job = {"id": "j1", "drone": "drone1", "operator": "alice"}
    r = c.post("/jobs", json={"job": job, "args": {"north": 10}}, headers=FLEET)
    assert r.status_code == 422 and "east is required" in r.json()["detail"]
    assert c.post("/jobs", json={"job": job, "args": {"north": 10, "east": 5, "radius": 500}}, headers=FLEET).status_code == 422
    assert c.post("/jobs", json={"job": job, "args": {"north": 10, "east": 5}}).status_code == 403
    r = c.post("/jobs", json={"job": job, "args": {"north": 10, "east": "5", "minutes": 0.2}}, headers=FLEET)
    assert r.status_code == 200, r.text
    assert r.json()["text"] == "circle N10 E5, r 20 m, 0.2 min"
    wait("j1")
    cmds = [p.rsplit("/", 1)[-1] for m, p, b in fc.calls if m == "POST"]
    assert cmds[:2] == ["takeoff", "orbit"] and cmds[-1] == "return_home"
    end = [b for m, p, b in fc.calls if m == "DELETE"][0]
    assert end["id"] == "j1" and end["result"] == "completed"
    rep = c.get("/reports/j1").json()
    assert rep["status"] == "completed" and len(rep["photos"]) >= 1
    assert c.get("/reports/j1/photos/1.jpg").content.startswith(b"\xff\xd8")
    assert c.get("/ui/job.js").text.startswith("// Inspect plugin UI")


def test_stopped_job_does_not_end_itself(tmp_path):
    fc, c = setup(tmp_path, sleep=lambda job, s: job.stopped.wait(0.05))
    c.post("/jobs", json={"job": {"id": "j2", "drone": "drone1"}, "args": {"north": 0, "east": 0, "minutes": 5}}, headers=FLEET)
    time.sleep(0.2)
    c.post("/jobs/j2/stopped", json={"reason": "bob: return home"}, headers=FLEET)
    wait("j2")
    assert c.get("/reports/j2").json()["status"] == "stopped"
    assert not [1 for m, p, b in fc.calls if m == "DELETE"]
    assert not [1 for m, p, b in fc.calls if p.endswith("/return_home")]
