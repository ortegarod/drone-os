# The plugin service: starting a job, routes, pause/resume, ending the job when the drone lands.
from fastapi.testclient import TestClient

import service
from droneos.client import DroneError

OP = {"X-DroneOS-Operator": "alice"}
FLEET = {"X-DroneOS-Caller": "fleet-api"}


class FakeClient:
    def __init__(self):
        self.calls = []
        self.job = None

    def request(self, method, path, body=None, raw=False, timeout=30):
        self.calls.append((method, path, body))
        if path.endswith("/patrol") and method == "POST":
            if len(body["route"]) < 2:
                raise DroneError("bad route", 422)
            return {"message": "patrol started"}
        if path.endswith("/job") and method == "GET":
            return self.job
        if path.endswith("/job") and method == "DELETE":
            return {}
        if path.startswith("/api/v1/log"):
            return []
        return {"message": "ok"}


def make(tmp_path):
    from conftest import FakeFleet
    fc, ff = FakeClient(), FakeFleet()
    app = service.create_app(client=fc, fleet=ff, reports_dir=str(tmp_path / "rep"), routes_path=tmp_path / "routes.json",
                             fetch_photo=lambda d: b"\xff\xd8x", background=False)
    return fc, ff, app, TestClient(app)


def test_routes_and_start(tmp_path):
    fc, ff, app, c = make(tmp_path)
    assert c.get("/routes").status_code == 401                       # only through the fleet API
    assert c.put("/drones/drone2/route", json={"points": [[1, 2, 3]]}, headers=OP).status_code == 422
    r = c.put("/drones/drone2/route", json={"points": [[40, 0], [40, 30.04]]}, headers=OP)
    assert r.json()["points"] == [[40.0, 0.0], [40.0, 30.0]] and r.json()["operator"] == "alice"
    job = {"id": "j1", "drone": "drone2", "operator": "alice"}
    assert c.post("/jobs", json={"job": job, "args": {}}).status_code == 403   # fleet API only
    r = c.post("/jobs", json={"job": job, "args": {"altitude": 50, "loops": 2, "speed": 6}}, headers=FLEET)
    assert r.status_code == 200, r.text
    assert fc.calls[-1] == ("POST", "/api/v1/drones/drone2/patrol", {"route": [[40.0, 0.0], [40.0, 30.0]], "altitude": 50.0, "loops": 2, "speed": 6})
    rid = r.json()["links"]["report"]
    assert c.get(f"/reports/{rid}", headers=OP).json()["job"] == "j1"
    # no route -> refused
    job3 = {"id": "j3", "drone": "drone3", "operator": "alice"}
    assert c.post("/jobs", json={"job": job3, "args": {}}, headers=FLEET).status_code == 422


def test_landing_ends_the_job(tmp_path):
    fc, ff, app, c = make(tmp_path)
    job = {"id": "j1", "drone": "drone2", "operator": "alice"}
    c.post("/jobs", json={"job": job, "args": {"route": [[10, 0], [10, 10]]}}, headers=FLEET)
    rec = app.state.recorder
    ff.status = {"mission_valid": True, "current_item": 0}
    rec.tick()
    ff.states["drone2"].update(local_x=10.0, local_y=0.0); ff.status["current_item"] = 1; rec.tick()
    ff.states["drone2"].update(local_x=10.0, local_y=10.0); ff.status["current_item"] = 2; rec.tick()
    ff.states["drone2"].update(arming_state="DISARMED", local_x=0.0, local_y=0.0, local_z=0.0); rec.tick()
    method, path, body = fc.calls[-1]
    assert (method, path) == ("DELETE", "/api/v1/drones/drone2/job") and body["id"] == "j1" and body["result"] == "completed"


def test_pause_needs_a_patrol_job(tmp_path):
    fc, ff, app, c = make(tmp_path)
    assert c.post("/drones/drone2/pause", headers=OP).status_code == 409
    fc.job = {"id": "j1", "plugin": "patrol"}
    assert c.post("/drones/drone2/pause", headers=OP).status_code == 200
    assert fc.calls[-1][:2] == ("POST", "/api/v1/drones/drone2/patrol_pause")


def test_px4_events_go_into_the_report(tmp_path):
    fc, ff, app, c = make(tmp_path)
    c.post("/jobs", json={"job": {"id": "j1", "drone": "drone2", "operator": "alice"}, "args": {"route": [[10, 0], [10, 10]]}}, headers=FLEET)
    app.state.on_event({"operator": "px4", "drone": "drone2", "command": "mode_completed", "message": "PX4: takeoff finished"})
    app.state.on_event({"operator": "px4", "drone": "drone1", "command": "mode_completed", "message": "other drone"})
    rid = app.state.recorder.list("drone2")[0]["id"]
    whats = [e["what"] for e in app.state.recorder.get(rid)["events"]]
    assert "PX4: takeoff finished" in whats and "other drone" not in whats
