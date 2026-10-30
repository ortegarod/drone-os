import os
os.environ["FLEET_API_NO_AUTOSTART"] = "1"

import time

import pytest
from fastapi.testclient import TestClient

import app as appmod
import fleet as fleetmod


class FakeFleet:
    connected = True

    def __init__(self):
        self.calls = []
        self.states = {
            "drone1": {"arming_state": "DISARMED", "nav_state": "AUTO_LOITER", "landing_state": "LANDED",
                       "local_x": 1.0, "local_y": 2.0, "local_z": -0.1, "local_yaw": 0.5,
                       "battery_remaining": 0.9, "position_valid": True},
            "drone2": {"arming_state": "ARMED", "nav_state": "OFFBOARD", "landing_state": "IN_AIR",
                       "local_x": 0.0, "local_y": 0.0, "local_z": -20.0, "local_yaw": 0.0,
                       "battery_remaining": 0.5},
        }
        self.online = {"drone1": True, "drone2": True}
        self.fail = set()
        self.target_alt = {}

    def names(self):
        return sorted(self.states)

    def snapshot(self, name):
        if name not in self.states:
            return None
        return dict(self.states[name]), self.online[name], 0.0

    def trigger(self, name, service):
        if service in self.fail:
            raise fleetmod.CommandError(f"{service}: rejected")
        self.calls.append((name, service))
        if service == "set_offboard":
            self.states[name]["nav_state"] = "OFFBOARD"
        return "ok"

    def call(self, name, service, service_type, args=None):
        if service in self.fail:
            raise fleetmod.CommandError(f"{service}: rejected")
        self.calls.append((name, service, args))
        if service == "takeoff_to":  # simulate an instant takeoff
            self.states[name].update(arming_state="ARMED", local_z=-args["altitude"])
        return {"success": True, "message": "ok", "distance_m": 10.0, "speed_used": 3.0}

    def set_position(self, name, x, y, z, yaw):
        self.calls.append((name, "set_position", round(x, 2), round(y, 2), round(z, 2), round(yaw, 3)))
        self.states[name].update(arming_state="ARMED", local_z=z)  # simulate an instant climb
        return "ok"

    def upload_mission(self, name, items, cruise_speed=None):
        self.calls.append((name, "upload_mission", items))
        self.cruise_speed = cruise_speed
        return "ok"

    def mission_control(self, name, command):
        self.calls.append((name, "mission_control", command))
        return "ok"

    def mission_status(self, name):
        started = any(c[:3] == (name, "mission_control", "START") for c in self.calls if len(c) >= 3)
        return {"mission_valid": True, "mission_running": started, "current_item": 2, "total_items": 9, "mission_progress": 0.25,
                "mission_paused": getattr(self, "paused", False)}


class FakePlugins:
    """Stands in for plugin services: records calls, answers like a plugin would."""
    manifests = {"patrol": {"id": "patrol", "name": "Patrol", "operator": "patrol", "service_url": "http://fake"}}

    def __init__(self):
        self.calls = []
        self.reply = (200, "application/json", b'{"text": "2 points", "links": {"report": "r1"}}')

    def __call__(self, manifest, method, path, body=None, operator=None, caller=True, raw_body=None,
                 content_type="application/json", timeout=30):
        self.calls.append((manifest["id"], method, path, body if body is not None else raw_body, operator))
        return self.reply


@pytest.fixture
def env(tmp_path):
    f = FakeFleet()
    f.plugins = FakePlugins()
    a = appmod.create_app(fleet=f, tokens={"tr": "alice", "ta": "bob", "tp": "patrol"}, log_path=tmp_path / "log.jsonl",
                           control_path=tmp_path / "control.json", jobs_path=tmp_path / "jobs.json",
                           plugins=FakePlugins.manifests, plugin_call=f.plugins, geofence_path=tmp_path / "fence.json")
    return f, TestClient(a)


R = {"Authorization": "Bearer tr"}
A = {"Authorization": "Bearer ta"}
P = {"Authorization": "Bearer tp"}


def test_auth_required(env):
    f, c = env
    assert c.get("/api/v1/drones").status_code == 401
    assert c.get("/api/v1/drones", headers={"Authorization": "Bearer nope"}).status_code == 401
    assert c.get("/api/v1/health").status_code == 200


def test_list_and_summary(env):
    f, c = env
    drones = c.get("/api/v1/drones", headers=R).json()
    assert [d["name"] for d in drones] == ["drone1", "drone2"]
    d2 = drones[1]
    assert d2["armed"] and d2["position"]["altitude"] == 20.0 and d2["battery"]["percent"] == 50
    assert c.get("/api/v1/drones/nope", headers=R).status_code == 404


def test_takeoff_sequence(env):
    f, c = env
    r = c.post("/api/v1/drones/drone1/takeoff", json={"altitude": 15}, headers=R)
    assert r.status_code == 200, r.text
    assert f.calls == [("drone1", "takeoff_to", {"altitude": 15.0})]  # PX4 Takeoff mode


def test_goto_requires_flying_and_converts(env):
    f, c = env
    assert c.post("/api/v1/drones/drone1/goto", json={"north": 5, "east": 5}, headers=R).status_code == 422
    r = c.post("/api/v1/drones/drone2/goto", json={"north": 30, "east": -10, "heading": 90}, headers=R)
    assert r.status_code == 200, r.text
    name, svc, args = f.calls[-1]
    assert (name, svc) == ("drone2", "goto_location")  # PX4 reposition
    assert args["frame"] == 1 and args["north"] == 30.0 and args["east"] == -10.0
    assert args["altitude"] == 0.0 and args["heading_deg"] == 90.0 and args["speed"] == 0.0  # keep altitude


def test_one_pilot_per_drone(env):
    f, c = env
    assert c.post("/api/v1/drones/drone2/goto", json={"north": 1, "east": 1}, headers=R).status_code == 200
    # bob can't steer a drone alice holds...
    r = c.post("/api/v1/drones/drone2/goto", json={"north": 9, "east": 9}, headers=A)
    assert r.status_code == 409 and "alice" in r.json()["detail"]
    # ...but can always send safety commands, without taking control
    assert c.post("/api/v1/drones/drone2/return_home", headers=A).status_code == 200
    assert c.get("/api/v1/drones/drone2", headers=A).json()["controller"] == "alice"
    # take over requires force
    assert c.post("/api/v1/drones/drone2/control", json={}, headers=A).status_code == 409
    assert c.post("/api/v1/drones/drone2/control", json={"force": True}, headers=A).status_code == 200
    assert c.get("/api/v1/drones/drone2", headers=R).json()["controller"] == "bob"
    # release
    assert c.delete("/api/v1/drones/drone2/control", headers=R).status_code == 409
    assert c.delete("/api/v1/drones/drone2/control", headers=A).status_code == 200
    assert c.get("/api/v1/drones/drone2", headers=R).json()["controller"] is None


def test_offline_and_failures_logged(env):
    f, c = env
    f.online["drone1"] = False
    r = c.post("/api/v1/drones/drone1/arm", headers=R)
    assert r.status_code == 422 and "offline" in r.json()["detail"]
    f.online["drone1"] = True
    f.fail.add("arm")
    assert c.post("/api/v1/drones/drone1/arm", headers=R).status_code == 422
    log = c.get("/api/v1/log", headers=R).json()
    assert log[0]["command"] == "arm" and log[0]["ok"] is False and log[0]["operator"] == "alice"
    assert c.post("/api/v1/drones/drone1/fly_to_moon", headers=R).status_code == 404


def test_validation(env):
    f, c = env
    assert c.post("/api/v1/drones/drone1/takeoff", json={"altitude": 500}, headers=R).status_code == 422
    assert c.post("/api/v1/drones/drone2/goto", json={"north": "x"}, headers=R).status_code == 422
    assert f.calls == []


def test_telemetry_ws(env):
    f, c = env
    with c.websocket_connect("/api/v1/telemetry?token=tr") as ws:
        msg = ws.receive_json()
        assert msg["type"] == "fleet" and msg["connected"] and len(msg["drones"]) == 2
        assert "raw" not in msg["drones"][0]
    with c.websocket_connect("/api/v1/telemetry?token=tr&raw=1") as ws:
        assert ws.receive_json()["drones"][1]["raw"]["nav_state"] == "OFFBOARD"


def test_altitude_reference_tracks_ground_while_disarmed():
    rf = fleetmod.RosFleet("unused", 0)
    rf._on_state("d", {"arming_state": "DISARMED", "landing_state": "UNKNOWN", "local_z": -0.9})
    rf._on_state("d", {"arming_state": "ARMED", "landing_state": "UNKNOWN", "local_z": -15.9})
    state, online, home_z = rf.snapshot("d")
    assert online and home_z == -0.9
    assert fleetmod.summarize("d", state, online, home_z)["position"]["altitude"] == 15.0


def test_goto_holds_commanded_altitude(env):
    f, c = env
    f.target_alt["drone2"] = 25.0          # commanded 25 m, currently reading 20 m
    c.post("/api/v1/drones/drone2/goto", json={"north": 5, "east": 5}, headers=R)
    assert f.calls[-1][2]["altitude"] == 25.0
    c.post("/api/v1/drones/drone2/land", headers=R)
    assert "drone2" not in f.target_alt


def test_patrol_takes_off_then_runs_onboard(env):
    f, c = env
    r = c.post("/api/v1/drones/drone1/patrol", json={"route": [[40, 0], [40, 30]], "altitude": 15, "loops": 2}, headers=R)
    assert r.status_code == 200, r.text
    assert [x[1] for x in f.calls] == ["takeoff_to", "upload_mission", "mission_control"]
    items = f.calls[1][2]
    assert len(items) == 5 and items[-1]["command"] == 20               # 2 points x 2 loops, then return home
    assert items[0]["latitude"] == 40 and items[0]["altitude"] == -15.0  # north; altitude above the ground
    assert f.calls[2][2] == "START"
    s = c.get("/api/v1/drones/drone1/patrol", headers=R).json()
    assert s["running"] and s["items"] == 9


def test_patrol_validation(env):
    f, c = env
    for body in [{}, {"route": []}, {"route": [[1]]}, {"route": [[0, 0]], "loops": 0}, {"route": [[0, 0]], "altitude": 1}]:
        assert c.post("/api/v1/drones/drone2/patrol", json=body, headers=R).status_code == 422, body
    assert f.calls == []


def test_control_survives_restart(tmp_path):
    f = FakeFleet()
    keys = {"tr": "alice", "ta": "bob"}
    c1 = TestClient(appmod.create_app(fleet=f, tokens=keys, log_path=tmp_path / "l", control_path=tmp_path / "c.json", jobs_path=tmp_path / "j.json", plugins={}))
    assert c1.post("/api/v1/drones/drone2/control", json={}, headers=R).status_code == 200
    c2 = TestClient(appmod.create_app(fleet=f, tokens=keys, log_path=tmp_path / "l", control_path=tmp_path / "c.json", jobs_path=tmp_path / "j.json", plugins={}))
    assert c2.get("/api/v1/drones/drone2", headers=A).json()["controller"] == "alice"
    assert c2.post("/api/v1/drones/drone2/goto", json={"north": 1, "east": 1}, headers=A).status_code == 409


def test_job_start_hands_control_to_the_plugin(env):
    f, c = env
    r = c.post("/api/v1/drones/drone1/job", json={"plugin": "patrol", "args": {"altitude": 30}}, headers=R)
    assert r.status_code == 200, r.text
    job = r.json()
    assert job["plugin"] == "patrol" and job["operator"] == "alice" and job["links"] == {"report": "r1"}
    pid, method, path, body, _ = f.plugins.calls[0]
    assert (pid, method, path) == ("patrol", "POST", "/jobs") and body["job"]["id"] == job["id"]
    assert c.get("/api/v1/drones/drone1", headers=R).json()["controller"] == "patrol"
    # one job per drone
    assert c.post("/api/v1/drones/drone1/job", json={"plugin": "patrol"}, headers=R).status_code == 409
    assert c.get("/api/v1/jobs/active", headers=R).json()["drone1"]["id"] == job["id"]
    # only the plugin ends it with a result; that frees the drone
    r = c.request("DELETE", "/api/v1/drones/drone1/job", json={"id": job["id"], "result": "completed", "reason": "4/4"}, headers=P)
    assert r.status_code == 200 and r.json()["result"] == "completed"
    assert c.get("/api/v1/drones/drone1/job", headers=R).json() is None
    assert c.get("/api/v1/drones/drone1", headers=R).json()["controller"] is None
    assert c.get("/api/v1/jobs?drone=drone1", headers=R).json()[0]["reason"] == "4/4"


def test_job_refused_by_plugin_frees_the_drone(env):
    f, c = env
    f.plugins.reply = (422, "application/json", b'{"detail": "drone1 has no route"}')
    r = c.post("/api/v1/drones/drone1/job", json={"plugin": "patrol"}, headers=R)
    assert r.status_code == 422 and "no route" in r.json()["detail"]
    assert c.get("/api/v1/drones/drone1/job", headers=R).json() is None
    assert c.get("/api/v1/drones/drone1", headers=R).json()["controller"] is None
    assert c.get("/api/v1/jobs", headers=R).json()[0]["result"] == "failed"
    assert c.post("/api/v1/drones/drone1/job", json={"plugin": "nope"}, headers=R).status_code == 404


def test_operator_stepping_in_stops_the_job(env):
    f, c = env
    c.post("/api/v1/drones/drone2/job", json={"plugin": "patrol"}, headers=R)
    # hold pauses (job stays), return home ends it, and the plugin is told
    assert c.post("/api/v1/drones/drone2/hold", headers=A).status_code == 200
    assert c.get("/api/v1/drones/drone2/job", headers=R).json() is not None
    assert c.post("/api/v1/drones/drone2/goto", json={"north": 1, "east": 1}, headers=A).status_code == 409  # plugin flies it
    assert c.post("/api/v1/drones/drone2/return_home", headers=A).status_code == 200
    assert c.get("/api/v1/drones/drone2/job", headers=R).json() is None
    h = c.get("/api/v1/jobs?drone=drone2", headers=R).json()[0]
    assert h["result"] == "stopped" and "bob" in h["reason"]
    assert f.plugins.calls[-1][1:3] == ("POST", f"/jobs/{h['id']}/stopped")
    assert c.get("/api/v1/drones/drone2", headers=R).json()["controller"] is None
    # taking control also stops a job
    c.post("/api/v1/drones/drone2/job", json={"plugin": "patrol"}, headers=R)
    assert c.post("/api/v1/drones/drone2/control", json={"force": True}, headers=A).status_code == 200
    assert c.get("/api/v1/jobs?drone=drone2", headers=R).json()[0]["reason"] == "bob took control"


def test_plugin_proxy(env):
    f, c = env
    f.plugins.reply = (200, "application/json", b'{"points": []}')
    r = c.get("/api/v1/plugins/patrol/drones/drone1/route?x=1", headers=R)
    assert r.status_code == 200 and r.json() == {"points": []}
    assert f.plugins.calls[-1] == ("patrol", "GET", "/drones/drone1/route?x=1", None, "alice")
    assert c.post("/api/v1/plugins/patrol/jobs", json={}, headers=R).status_code == 403
    assert c.get("/api/v1/plugins/patrol/routes").status_code == 401
    assert [p["id"] for p in c.get("/api/v1/plugins", headers=R).json()] == ["patrol"]


def test_event_stream(env):
    f, c = env
    with c.websocket_connect("/api/v1/events?token=tr&drone=drone2") as ws:
        c.post("/api/v1/drones/drone1/hold", headers=R)          # other drone: filtered out
        c.post("/api/v1/drones/drone2/hold", headers=R)
        e = ws.receive_json()
        assert e["drone"] == "drone2" and e["command"] == "hold" and e["operator"] == "alice"


def test_patrol_refuses_while_one_runs_and_clears_a_paused_one(env):
    f, c = env
    body = {"route": [[40, 0], [40, 30]], "altitude": 15}
    assert c.post("/api/v1/drones/drone2/patrol", json=body, headers=R).status_code == 200
    r = c.post("/api/v1/drones/drone2/patrol", json=body, headers=R)
    assert r.status_code == 422 and "already running" in r.json()["detail"]
    f.paused = True
    assert c.post("/api/v1/drones/drone2/patrol", json=body, headers=R).status_code == 200
    ctl = [x[2] for x in f.calls if x[1] == "mission_control"]
    assert ctl[-2:] == ["STOP", "START"]


def test_watchdog_ends_orphaned_jobs(env):
    f, c = env
    c.post("/api/v1/drones/drone1/job", json={"plugin": "patrol"}, headers=R)   # drone1 is landed in the fake
    check, since = c.app.state.check_orphans, {}
    t0 = time.time() + 300                    # job is old enough
    check(since, t0)
    assert c.get("/api/v1/drones/drone1/job", headers=R).json() is not None     # just landed: wait
    check(since, t0 + appmod.JOB_ORPHAN_S + 1)
    assert c.get("/api/v1/drones/drone1/job", headers=R).json() is None
    assert c.get("/api/v1/jobs", headers=R).json()[0]["result"] == "failed"
    assert c.get("/api/v1/drones/drone1", headers=R).json()["controller"] is None


# -- plugins installed while running -----------------------------------------

def _h(t):
    return {"Authorization": " ".join(["Bea" + "rer", t])}


@pytest.fixture
def live(tmp_path):
    f = FakeFleet()
    f.plugins = FakePlugins()
    bundled = tmp_path / "plugins"
    bundled.mkdir()
    a = appmod.create_app(fleet=f, tokens={"tr": "alice", "ta": "bob"}, log_path=tmp_path / "log.jsonl",
                          control_path=tmp_path / "control.json", jobs_path=tmp_path / "jobs.json",
                          plugins=None, plugin_call=f.plugins, admins="alice",
                          installed_plugins_path=tmp_path / "installed.json")
    a_plugins_dir = bundled
    return f, TestClient(a), a_plugins_dir, tmp_path


@pytest.fixture(autouse=True)
def _bundled_env(monkeypatch, tmp_path):
    monkeypatch.setenv("FLEET_API_PLUGINS", str(tmp_path / "plugins"))
    monkeypatch.setenv("FLEET_API_OPERATORS", str(tmp_path / "operators.json"))       # never the real one
    monkeypatch.setenv("FLEET_API_INSTALLED_PLUGINS", str(tmp_path / "installed.json"))
    monkeypatch.setenv("FLEET_API_GEOFENCE", str(tmp_path / "geofence.json"))          # never the real one


SPOT = {"id": "spot", "name": "Spot", "version": "0.1", "service_url": "http://127.0.0.1:8199", "ui": "/ui/job.js"}


def test_install_plugin_live_and_its_token_works(live):
    f, c, _, tmp = live
    assert c.post("/api/v1/plugins", json=SPOT, headers=_h("ta")).status_code == 403   # bob isn't an admin
    r = c.post("/api/v1/plugins", json=SPOT, headers=_h("tr"))
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["created"] and body["token"].startswith("dpl_") and body["plugin"]["source"] == "installed"
    assert body["token"] not in (tmp / "installed.json").read_text()                    # only the hash is kept
    assert [p["id"] for p in c.get("/api/v1/plugins", headers=_h("ta")).json()] == ["spot"]
    tok = body["token"]
    assert c.get("/api/v1/me", headers=_h(tok)).json()["operator"] == "spot"
    # a job runs through it like any plugin
    j = c.post("/api/v1/drones/drone1/job", json={"plugin": "spot", "args": {}}, headers=_h("ta"))
    assert j.status_code == 200, j.text
    assert c.delete("/api/v1/plugins/spot", headers=_h("tr")).status_code == 409        # job running
    assert c.request("DELETE", "/api/v1/drones/drone1/job", json={"result": "completed"}, headers=_h(tok)).json()["result"] == "completed"
    # update keeps the token, rotate gives a new one
    r2 = c.post("/api/v1/plugins", json={**SPOT, "version": "0.2"}, headers=_h("tr")).json()
    assert r2["created"] is False and r2["token"] is None
    assert c.get("/api/v1/me", headers=_h(tok)).status_code == 200
    r3 = c.post("/api/v1/plugins?rotate_token=true", json=SPOT, headers=_h("tr")).json()
    assert r3["token"] and c.get("/api/v1/me", headers=_h(tok)).status_code == 401
    # removal revokes it
    assert c.delete("/api/v1/plugins/spot", headers=_h("tr")).status_code == 200
    assert c.get("/api/v1/me", headers=_h(r3["token"])).status_code == 401
    assert c.get("/api/v1/plugins", headers=_h("ta")).json() == []
    kinds = [e["command"] for e in c.get("/api/v1/log", headers=_h("ta")).json()]
    assert "plugin_install" in kinds and "plugin_remove" in kinds


def test_installed_plugins_survive_a_restart(live, tmp_path):
    f, c, _, tmp = live
    tok = c.post("/api/v1/plugins", json=SPOT, headers=_h("tr")).json()["token"]
    a2 = appmod.create_app(fleet=f, tokens={"tr": "alice"}, log_path=tmp / "log.jsonl", control_path=tmp / "c2.json",
                           jobs_path=tmp / "j2.json", plugins=None, plugin_call=f.plugins, admins="alice",
                           installed_plugins_path=tmp / "installed.json")
    c2 = TestClient(a2)
    assert c2.get("/api/v1/me", headers=_h(tok)).json()["operator"] == "spot"
    assert [p["id"] for p in c2.get("/api/v1/plugins", headers=_h("tr")).json()] == ["spot"]


def test_bundled_folder_is_picked_up_without_restart(live):
    import json as _json
    f, c, bundled, _ = live
    assert c.get("/api/v1/plugins", headers=_h("tr")).json() == []
    (bundled / "hello").mkdir()
    (bundled / "hello" / "droneos-plugin.json").write_text(_json.dumps({"id": "hello", "service_url": "http://x:1"}))
    time.sleep(1.1)   # rescans at most once a second
    ps = c.get("/api/v1/plugins", headers=_h("tr")).json()
    assert [(p["id"], p["source"]) for p in ps] == [("hello", "bundled")]
    # can't install over it or remove it through the API
    assert c.post("/api/v1/plugins", json={"id": "hello", "service_url": "http://y:2"}, headers=_h("tr")).status_code == 422
    assert c.delete("/api/v1/plugins/hello", headers=_h("tr")).status_code == 409
    (bundled / "hello" / "droneos-plugin.json").unlink()
    time.sleep(1.1)
    assert c.get("/api/v1/plugins", headers=_h("tr")).json() == []


def test_install_rejects_bad_or_clashing_manifests(live):
    f, c, _, _ = live
    bad = [{"id": "Spot", "service_url": "http://a:1"},                 # id rules
           {"id": "spot"},                                              # no service_url
           {"id": "spot", "service_url": "file:///etc/passwd"},
           {"id": "spot", "service_url": "http://a:1", "operator": "alice"},   # a person's name
           {"id": "spot", "service_url": "http://a:1", "ui": "job.js"}]
    for m in bad:
        assert c.post("/api/v1/plugins", json=m, headers=_h("tr")).status_code == 422, m
    assert c.post("/api/v1/plugins", json={"id": "one", "service_url": "http://a:1", "operator": "bot"}, headers=_h("tr")).status_code == 200
    r = c.post("/api/v1/plugins", json={"id": "two", "service_url": "http://a:1", "operator": "bot"}, headers=_h("tr"))
    assert r.status_code == 422 and "one" in r.text



# -- plugin liveness: a job whose plugin stops answering --------------------

import jobs as jobsmod


class FlakyPlugins(FakePlugins):
    """Answers like a plugin, except GET /jobs/{id} (the liveness check) when told to be down."""
    def __init__(self):
        super().__init__()
        self.down = None   # None = fine; "503" = unreachable; "404" = lost the job

    def __call__(self, manifest, method, path, body=None, operator=None, caller=True, raw_body=None,
                 content_type="application/json", timeout=30):
        if method == "GET" and path.startswith("/jobs/"):
            self.calls.append((manifest["id"], method, path, None, operator))
            if self.down == "503":
                raise jobsmod.PluginError(503, "unreachable")
            if self.down == "404":
                return 404, "application/json", b'{"detail": "no job"}'
            return 200, "application/json", b'{"running": true}'
        if self.down == "503" and path.endswith("/stopped"):
            raise jobsmod.PluginError(503, "unreachable")
        return super().__call__(manifest, method, path, body, operator, caller, raw_body, content_type, timeout)


def _liveness_env(tmp_path, manifests):
    f = FakeFleet()
    f.plugins = FlakyPlugins()
    a = appmod.create_app(fleet=f, tokens={"tr": "alice", "tp": "patrol"}, log_path=tmp_path / "log.jsonl",
                          control_path=tmp_path / "control.json", jobs_path=tmp_path / "jobs.json",
                          plugins=manifests, plugin_call=f.plugins)
    return f, TestClient(a)


AL = _h("tr")


@pytest.mark.parametrize("how", ["503", "404"])
def test_job_whose_plugin_stops_answering_ends_and_drone_goes_home(tmp_path, how):
    f, c = _liveness_env(tmp_path, FakePlugins.manifests)
    assert c.post("/api/v1/drones/drone2/job", json={"plugin": "patrol"}, headers=AL).status_code == 200   # drone2 flies
    check, lost = c.app.state.check_plugins, {}
    t = time.time()
    check(lost, t)
    assert not lost                                           # answering: nothing to do
    f.plugins.down = how
    check(lost, t + 5)
    check(lost, t + 5 + appmod.PLUGIN_LOST_S - 1)
    assert c.get("/api/v1/drones/drone2/job", headers=AL).json() is not None   # a blip: wait
    assert ("drone2", "return_to_launch") not in f.calls
    check(lost, t + 5 + appmod.PLUGIN_LOST_S + 1)
    assert c.get("/api/v1/drones/drone2/job", headers=AL).json() is None
    j = c.get("/api/v1/jobs", headers=AL).json()[0]
    assert j["result"] == "failed" and "stopped answering" in j["reason"] and "sent home" in j["reason"]
    assert ("drone2", "return_to_launch") in f.calls
    assert c.get("/api/v1/drones/drone2", headers=AL).json()["controller"] is None
    log = c.get("/api/v1/log", headers=AL).json()
    assert log[0]["command"] == "return_home" and log[0]["operator"] == "fleet-api"


def test_plugin_that_comes_back_keeps_its_job(tmp_path):
    f, c = _liveness_env(tmp_path, FakePlugins.manifests)
    c.post("/api/v1/drones/drone2/job", json={"plugin": "patrol"}, headers=AL)
    check, lost, t = c.app.state.check_plugins, {}, time.time()
    f.plugins.down = "503"
    check(lost, t)
    f.plugins.down = None
    check(lost, t + 10)
    f.plugins.down = "503"
    check(lost, t + 20)                                        # down again: the clock restarts
    check(lost, t + 20 + appmod.PLUGIN_LOST_S - 1)
    assert c.get("/api/v1/drones/drone2/job", headers=AL).json() is not None
    assert ("drone2", "return_to_launch") not in f.calls


def test_onboard_part_keeps_flying_when_cloud_part_dies(tmp_path):
    m = {"patrol": {**FakePlugins.manifests["patrol"], "onboard_mode": "PATROL"}}
    f, c = _liveness_env(tmp_path, m)
    c.post("/api/v1/drones/drone2/job", json={"plugin": "patrol"}, headers=AL)
    f.calls.append(("drone2", "mission_control", "START"))     # the fake now says the onboard mission runs
    check, lost, t = c.app.state.check_plugins, {}, time.time()
    f.plugins.down = "503"
    check(lost, t)
    check(lost, t + appmod.PLUGIN_LOST_S + 1)
    check(lost, t + appmod.PLUGIN_LOST_S + 10)
    assert c.get("/api/v1/drones/drone2/job", headers=AL).json() is not None   # the drone finishes on its own
    assert ("drone2", "return_to_launch") not in f.calls
    lost_logs = [e for e in c.get("/api/v1/log", headers=AL).json() if e["command"] == "plugin_lost"]
    assert len(lost_logs) == 1 and "onboard" in lost_logs[0]["message"]


def test_paused_onboard_mission_is_not_flying_on_its_own(tmp_path):
    m = {"patrol": {**FakePlugins.manifests["patrol"], "onboard_mode": "PATROL"}}
    f, c = _liveness_env(tmp_path, m)
    c.post("/api/v1/drones/drone2/job", json={"plugin": "patrol"}, headers=AL)
    f.paused = True                                             # PX4 Hold: nothing onboard ends it
    check, lost, t = c.app.state.check_plugins, {}, time.time()
    f.plugins.down = "503"
    check(lost, t)
    check(lost, t + appmod.PLUGIN_LOST_S + 1)
    assert ("drone2", "return_to_launch") in f.calls


def test_landed_drone_job_just_fails_when_plugin_dies(tmp_path):
    f, c = _liveness_env(tmp_path, FakePlugins.manifests)
    c.post("/api/v1/drones/drone1/job", json={"plugin": "patrol"}, headers=AL)    # drone1 is on the ground
    check, lost, t = c.app.state.check_plugins, {}, time.time()
    f.plugins.down = "503"
    check(lost, t)
    check(lost, t + appmod.PLUGIN_LOST_S + 1)
    j = c.get("/api/v1/jobs", headers=AL).json()[0]
    assert j["result"] == "failed" and "sent home" not in j["reason"]
    assert ("drone1", "return_to_launch") not in f.calls



def test_onboard_mode_by_name_counts_as_flying(tmp_path):
    m = {"patrol": {**FakePlugins.manifests["patrol"], "onboard_mode": "PATROL"}}
    f, c = _liveness_env(tmp_path, m)
    c.post("/api/v1/drones/drone2/job", json={"plugin": "patrol"}, headers=AL)
    f.states["drone2"]["nav_state"] = "PATROL"                  # drone_core reports the external mode by name
    check, lost, t = c.app.state.check_plugins, {}, time.time()
    f.plugins.down = "503"
    check(lost, t)
    check(lost, t + appmod.PLUGIN_LOST_S + 1)
    assert c.get("/api/v1/drones/drone2/job", headers=AL).json() is not None
    assert ("drone2", "return_to_launch") not in f.calls



# -- operator accounts and roles --------------------------------------------

@pytest.fixture
def ops(tmp_path):
    f = FakeFleet()
    f.plugins = FakePlugins()
    a = appmod.create_app(fleet=f, tokens={"tr": "alice", "tp": "patrol"}, log_path=tmp_path / "log.jsonl",
                          control_path=tmp_path / "control.json", jobs_path=tmp_path / "jobs.json",
                          plugins=FakePlugins.manifests, plugin_call=f.plugins, admins="alice",
                          operators_path=tmp_path / "ops.json")
    return f, TestClient(a), tmp_path


def test_admin_adds_operators_with_roles(ops):
    f, c, tmp = ops
    assert c.get("/api/v1/me", headers=_h("tr")).json() == {"operator": "alice", "role": "admin"}
    assert c.get("/api/v1/me", headers=_h("tp")).json()["role"] == "pilot"          # file operators fly
    r = c.post("/api/v1/operators", json={"name": "bob", "role": "pilot"}, headers=_h("tr"))
    assert r.status_code == 200, r.text
    bob = r.json()["token"]
    assert bob.startswith("dop_") and bob not in (tmp / "ops.json").read_text()
    assert c.get("/api/v1/me", headers=_h(bob)).json() == {"operator": "bob", "role": "pilot"}
    assert c.post("/api/v1/drones/drone1/takeoff", json={"altitude": 10}, headers=_h(bob)).status_code == 200
    assert c.post("/api/v1/operators", json={"name": "eve"}, headers=_h(bob)).status_code == 403   # pilots don't manage
    v = c.post("/api/v1/operators", json={"name": "vic", "role": "viewer"}, headers=_h("tr")).json()["token"]
    assert c.get("/api/v1/drones", headers=_h(v)).status_code == 200                 # viewers watch
    assert c.get("/api/v1/log", headers=_h(v)).status_code == 200
    for method, path, body in [("POST", "/api/v1/drones/drone2/hold", {}), ("POST", "/api/v1/drones/drone2/control", {}),
                               ("POST", "/api/v1/drones/drone2/job", {"plugin": "patrol"}),
                               ("PUT", "/api/v1/plugins/patrol/drones/drone2/route", {"points": []})]:
        assert c.request(method, path, json=body, headers=_h(v)).status_code == 403, path
    assert c.get("/api/v1/plugins/patrol/routes", headers=_h(v)).status_code == 200  # reading plugin data is fine
    names = {o["name"]: o for o in c.get("/api/v1/operators", headers=_h("tr")).json()}
    assert names["bob"]["source"] == "account" and names["alice"]["source"] == "file" and names["alice"]["role"] == "admin"


def test_name_clashes_and_bad_roles_are_refused(ops):
    f, c, _ = ops
    for body in [{"name": "alice"}, {"name": "patrol"}, {"name": "px4"}, {"name": "Bob"}, {"name": "bob", "role": "god"}]:
        assert c.post("/api/v1/operators", json=body, headers=_h("tr")).status_code == 422, body
    c.post("/api/v1/operators", json={"name": "bob"}, headers=_h("tr"))
    assert c.post("/api/v1/operators", json={"name": "bob"}, headers=_h("tr")).status_code == 422


def test_role_change_token_reset_and_removal(ops):
    f, c, tmp = ops
    bob = c.post("/api/v1/operators", json={"name": "bob", "role": "pilot"}, headers=_h("tr")).json()["token"]
    c.post("/api/v1/drones/drone2/control", json={}, headers=_h(bob))
    assert c.get("/api/v1/drones/drone2", headers=_h("tr")).json()["controller"] == "bob"
    assert c.patch("/api/v1/operators/bob", json={"role": "viewer"}, headers=_h("tr")).status_code == 200
    assert c.get("/api/v1/drones/drone2", headers=_h("tr")).json()["controller"] is None   # a viewer holds nothing
    assert c.post("/api/v1/drones/drone2/hold", json={}, headers=_h(bob)).status_code == 403
    new = c.post("/api/v1/operators/bob/token", headers=_h("tr")).json()["token"]
    assert c.get("/api/v1/me", headers=_h(bob)).status_code == 401 and c.get("/api/v1/me", headers=_h(new)).status_code == 200
    # survives a restart
    a2 = appmod.create_app(fleet=f, tokens={"tr": "alice"}, log_path=tmp / "log.jsonl", control_path=tmp / "c2.json",
                           jobs_path=tmp / "j2.json", plugins={}, plugin_call=f.plugins, admins="alice",
                           operators_path=tmp / "ops.json")
    assert TestClient(a2).get("/api/v1/me", headers=_h(new)).json() == {"operator": "bob", "role": "viewer"}
    assert c.delete("/api/v1/operators/bob", headers=_h("tr")).status_code == 200
    assert c.get("/api/v1/me", headers=_h(new)).status_code == 401
    assert c.delete("/api/v1/operators/alice", headers=_h("tr")).status_code == 409   # yourself / file operator
    assert c.patch("/api/v1/operators/patrol", json={"role": "viewer"}, headers=_h("tr")).status_code == 404


def test_account_admin_can_manage_but_not_demote_itself(ops):
    f, c, _ = ops
    root = c.post("/api/v1/operators", json={"name": "root2", "role": "admin"}, headers=_h("tr")).json()["token"]
    assert c.post("/api/v1/operators", json={"name": "carl"}, headers=_h(root)).status_code == 200
    assert c.patch("/api/v1/operators/root2", json={"role": "pilot"}, headers=_h(root)).status_code == 409
    assert c.delete("/api/v1/operators/root2", headers=_h(root)).status_code == 409
    # and the events socket accepts account tokens
    with c.websocket_connect("/api/v1/events?token=" + root) as ws:
        c.post("/api/v1/drones/drone1/hold", json={}, headers=_h(root))
        assert ws.receive_json()["operator"] == "root2"



def test_detections_relay_cleans_and_expires():
    f = fleetmod.RosFleet("x", 1)
    f._on_detections("drone1", {"data": '{"stamp": 1, "model": "ssd", "fps": 7.5, "objects": ['
                                      '{"label": "person", "score": 0.81234, "box": [0.1, 0.2, 0.3, 1.4]},'
                                      '{"label": "car", "score": "x", "box": [0, 0, 1, 1]},'
                                      '{"label": "bad", "score": 0.5, "box": [0.1]}]}'})
    d = f.detections("drone1")
    assert d["objects"] == [{"label": "person", "score": 0.812, "box": [0.1, 0.2, 0.3, 1.0], "track": 1, "confirmed": False}]
    assert d["fps"] == 7.5 and d["tracks"] == []
    f._on_detections("drone1", {"data": "not json"})          # ignored, keeps the last good one
    assert f.detections("drone1")["objects"]
    f._dets["drone1"]["received"] -= 10
    assert f.detections("drone1") is None and f.detections("drone9") is None


def test_drone_view_has_detections(env):
    f, c = env
    f.detections = lambda n: {"objects": [{"label": "person", "score": 0.9, "box": [0, 0, 0.5, 0.5]}]} if n == "drone1" else None
    assert c.get("/api/v1/drones/drone1", headers=R).json()["detections"]["objects"][0]["label"] == "person"
    assert c.get("/api/v1/drones/drone2", headers=R).json()["detections"] is None



def test_ground_projection_geometry():
    cam = {"pitch_deg": 45, "hfov_deg": 60, "width": 640, "height": 480}
    pose = {"north": 0, "east": 0, "alt": 30, "heading_deg": 0}
    # centre of the image, camera 45 deg down, 30 m up: 30 m straight ahead (north)
    n, e = fleetmod.ground_point([0.49, 0.4, 0.51, 0.5], cam, pose)
    assert abs(n - 30) < 0.2 and abs(e) < 0.2
    # facing east: the point is east
    n, e = fleetmod.ground_point([0.49, 0.4, 0.51, 0.5], cam, {**pose, "heading_deg": 90})
    assert abs(n) < 0.2 and abs(e - 30) < 0.2
    # right half of the frame lands to the right (east when facing north)
    n, e = fleetmod.ground_point([0.7, 0.4, 0.8, 0.5], cam, pose)
    assert e > 5
    # lower in the frame = closer
    assert fleetmod.ground_point([0.49, 0.8, 0.51, 0.9], cam, pose)[0] < 30
    # looking level (pitch 0), the upper half is sky
    assert fleetmod.ground_point([0.4, 0.1, 0.6, 0.3], {**cam, "pitch_deg": 0}, pose) is None
    assert fleetmod.ground_point([0.4, 0.1, 0.6, 0.3], cam, {**pose, "alt": 0.2}) is None   # on the ground


def test_detections_get_ground_positions_from_telemetry():
    det = {"objects": [{"label": "person", "score": 0.9, "box": [0.49, 0.4, 0.51, 0.5]}],
           "camera": {"pitch_deg": 45, "hfov_deg": 60, "width": 640, "height": 480}}
    view = {"position": {"north": 10, "east": 5, "altitude": 30, "heading": 0}}
    g = fleetmod.place_detections(det, view)["objects"][0]["ground"]
    assert abs(g["north"] - 40) < 0.3 and abs(g["east"] - 5) < 0.3
    assert fleetmod.place_detections({"objects": [], "camera": None}, view)["camera"] is None



def _det(label, n, e, box=(0.4, 0.4, 0.45, 0.5), score=0.8):
    return {"label": label, "score": score, "box": list(box), "ground": {"north": n, "east": e} if n is not None else None}


def test_tracker_confirms_only_what_repeats_at_the_same_spot():
    tr = fleetmod.DetectionTracker()
    o = (0.0, 0.0)
    # a real person at N-33 E-15 every frame (jitter ~1 m); a tree "person" at a new spot each time
    for k in range(3):
        objs = [_det("person", -33 + 0.5 * (k % 2), -15), _det("person", -65 + 7 * k, -51)]
        tr.update(objs, 100 + 0.5 * k, o)
    assert objs[0]["confirmed"] and not objs[1]["confirmed"]
    ts = tr.tracks(101.0)
    assert len(ts) == 1 and ts[0]["label"] == "person" and abs(ts[0]["ground"]["north"] + 33) < 1
    # gone for longer than the TTL: dropped
    tr.update([], 101 + fleetmod.TRACK_TTL + 0.1, o)
    assert tr.tracks(101 + fleetmod.TRACK_TTL + 0.1) == []


def test_tracker_hits_must_fall_in_the_window_and_groups_vehicles():
    tr = fleetmod.DetectionTracker()
    o = (0.0, 0.0)
    for k, lab in enumerate(["car", "truck", "car"]):      # SUV flips between car and truck
        objs = [_det(lab, -34.6, -20)]
        tr.update(objs, 10 + 2.5 * k, o)                  # 3 hits over 5 s > CONFIRM_WINDOW: not yet
    assert not objs[0]["confirmed"]
    tr.update([_det("car", -34.6, -20)], 15.5, o)
    ts = tr.tracks(15.5)
    assert len(ts) == 1 and ts[0]["label"] == "car" and ts[0]["seen"] == 4
    # a person on the same spot is a different track
    p = [_det("person", -34.6, -20)]
    tr.update(p, 16, o)
    assert p[0]["track"] != ts[0]["id"]


def test_tracker_two_people_side_by_side_stay_two_tracks():
    tr = fleetmod.DetectionTracker()
    for k in range(3):
        objs = [_det("person", -33, -15), _det("person", -33.5, -16.5)]
        tr.update(objs, k * 0.5, (0.0, 0.0))
    assert objs[0]["track"] != objs[1]["track"] and len(tr.tracks(1.0)) == 2


def test_tracker_without_ground_uses_the_image():
    tr = fleetmod.DetectionTracker()
    for k in range(3):
        objs = [_det("person", None, None, box=(0.5, 0.5, 0.52 + 0.005 * k, 0.6))]
        tr.update(objs, k * 0.5)
    assert objs[0]["confirmed"] and tr.tracks(1.0)[0]["ground"] is None


def test_detections_message_is_placed_and_tracked_on_arrival():
    f = fleetmod.RosFleet("x", 1)
    f._states["drone1"] = {"local_x": 0.0, "local_y": 0.0, "local_z": -30.0, "compass_heading": 0.0}
    f._home_z["drone1"] = 0.0
    msg = {"data": '{"camera": {"pitch_deg": 45, "hfov_deg": 90, "width": 640, "height": 480},'
                   ' "objects": [{"label": "person", "score": 0.9, "box": [0.49, 0.4, 0.51, 0.5]}]}'}
    for _ in range(3):
        f._on_detections("drone1", msg)
    d = f.detections("drone1")
    o = d["objects"][0]
    assert o["ground"]["north"] > 20 and abs(o["ground"]["east"]) < 1 and o["confirmed"]
    assert len(d["tracks"]) == 1 and fleetmod.place_detections(d, {}) is d


def test_repeated_mode_completed_is_one_event():
    f = fleetmod.RosFleet("x", 1)
    got = []
    f.on_mode_completed = lambda n, m: got.append((n, m["mode"]))
    land = {"mode": "AUTO_LAND", "result": "SUCCESS"}
    for _ in range(40):
        f._on_mode_completed("drone1", dict(land))
    f._on_mode_completed("drone2", dict(land))                       # other drone: its own event
    f._on_mode_completed("drone1", {"mode": "AUTO_TAKEOFF", "result": "SUCCESS"})
    assert got == [("drone1", "AUTO_LAND"), ("drone2", "AUTO_LAND"), ("drone1", "AUTO_TAKEOFF")]
    f._last_completed["drone1"] = (("AUTO_LAND", "SUCCESS"), time.monotonic() - 10)
    f._on_mode_completed("drone1", dict(land))                       # a later landing counts again
    assert got[-1] == ("drone1", "AUTO_LAND")


def _confirm(tr, sg, label, n, e, t0, lat=29.0, lon=-95.0):
    """Feed one object 3 frames in a row; returns the new sightings."""
    fresh = []
    for k in range(3):
        objs = [_det(label, n, e)]
        new = tr.update(objs, t0 + 0.5 * k, (0.0, 0.0))
        fresh += sg.update(tr, new, t0 + 0.5 * k, lat, lon, 0.0, 0.0, objs)
    return fresh


def test_sightings_one_per_object_and_spot():
    tr, sg = fleetmod.DetectionTracker(), fleetmod.Sightings("drone1")
    first = _confirm(tr, sg, "person", -33, -15, 100)
    assert len(first) == 1 and first[0]["id"] == "drone1-1" and first[0]["label"] == "person"
    assert abs(first[0]["lat"] - (29.0 - 33 / fleetmod.M_PER_DEG)) < 1e-6 and first[0]["lon"] < -95.0
    # the person drops out (track expires), comes back 2 m off: the same sighting, no new event
    assert _confirm(tr, sg, "person", -31, -15, 110) == []
    # a car on the same spot, and a person 20 m away: two new sightings
    assert [s["label"] for s in _confirm(tr, sg, "car", -33, -15, 120)] == ["car"]
    assert [s["id"] for s in _confirm(tr, sg, "person", -13, -15, 130)] == ["drone1-3"]
    assert len(sg.list()) == 3 and [s["id"] for s in sg.list(since=129)] == ["drone1-3"]
    # long after: forgotten, so the first spot is new again
    assert len(_confirm(tr, sg, "person", -33, -15, 130 + fleetmod.SIGHTING_MEMORY + 60)) == 1


def test_detections_raise_one_sighting_event():
    f = fleetmod.RosFleet("x", 1)
    f._states["drone1"] = {"local_x": 0.0, "local_y": 0.0, "local_z": -30.0, "compass_heading": 0.0,
                           "latitude": 37.41, "longitude": -121.99}
    f._home_z["drone1"] = 0.0
    got = []
    f.on_sighting = lambda n, s: got.append((n, s))
    msg = {"data": '{"camera": {"pitch_deg": 45, "hfov_deg": 90, "width": 640, "height": 480},'
                   ' "objects": [{"label": "person", "score": 0.9, "box": [0.49, 0.4, 0.51, 0.5]}]}'}
    for _ in range(6):
        f._on_detections("drone1", msg)
    assert len(got) == 1 and got[0][0] == "drone1" and got[0][1]["north"] > 20
    assert got[0][1]["box"] == [0.49, 0.4, 0.51, 0.5]
    assert f.sightings("drone1")[0]["frames"] >= 6 and f.sightings("drone9") == []


def test_sighting_events_and_endpoint(env):
    f, c = env
    tok = R["Authorization"].split()[1]
    s = {"id": "drone2-1", "drone": "drone2", "label": "person", "group": "person", "score": 0.87,
         "north": -33.0, "east": -15.0, "lat": None, "lon": None, "box": [], "first_seen": 1.0, "last_seen": 1.0, "frames": 3}
    f.sightings = lambda name, since=0.0: [s] if name == "drone2" else []
    with c.websocket_connect(f"/api/v1/events?token={tok}&drone=drone2") as ws:
        c.app.state.on_sighting("drone1", {**s, "drone": "drone1"})   # other drone: filtered out
        c.app.state.on_sighting("drone2", s)
        e = ws.receive_json()
    assert e["command"] == "detected" and e["operator"] == "detector" and e["sighting"]["id"] == "drone2-1"
    assert "person at N-33 E-15" in e["message"]
    assert c.get("/api/v1/drones/drone2/sightings", headers=R).json()[0]["label"] == "person"
    assert c.get("/api/v1/drones/drone1/sightings", headers=R).json() == []
    assert not any(x["command"] == "detected" for x in c.get("/api/v1/log", headers=R).json())   # not a command


def test_ground_point_corrects_for_tilt():
    cam = {"pitch_deg": 45, "hfov_deg": 90, "width": 640, "height": 480}
    pose = {"north": 0, "east": 0, "alt": 30, "heading_deg": 0}
    box = [0.49, 0.4, 0.51, 0.5]                       # bottom-centre = image centre: 45 deg down
    n, e = fleetmod.ground_point(box, cam, pose)
    assert abs(n - 30) < 0.5 and abs(e) < 0.5
    # nose down 5 deg (flying forward): the camera looks 50 deg down, the spot is closer (30/tan50 = 25.2)
    n, e = fleetmod.ground_point(box, cam, {**pose, "pitch_deg": -5})
    assert abs(n - 25.2) < 0.3 and abs(e) < 0.3
    # nose up 5 deg (braking): further (30/tan40 = 35.8)
    assert abs(fleetmod.ground_point(box, cam, {**pose, "pitch_deg": 5})[0] - 35.8) < 0.3
    # right side down: the camera rolls with the drone, so its centre looks left of the nose
    n, e = fleetmod.ground_point(box, cam, {**pose, "roll_deg": 5})
    assert e < -1 and abs(n - 30) < 1.5
    # the same tilt at heading 90 rotates with the drone
    n, e = fleetmod.ground_point(box, cam, {**pose, "heading_deg": 90, "pitch_deg": -5})
    assert abs(e - 25.2) < 0.3 and abs(n) < 0.3


# -- geofence (made-up site; never a real address in tests) ---------------------------------
import math  # noqa: E402

import geofence as geomod  # noqa: E402

SITE = (47.0, 8.0)


def _ll(n, e):
    return list(geomod.to_latlon(SITE, n, e))


def _square(half, cn=0.0, ce=0.0):
    return [_ll(cn - half, ce - half), _ll(cn - half, ce + half), _ll(cn + half, ce + half), _ll(cn + half, ce - half)]


def test_geofence_checks_points_paths_and_height(tmp_path):
    g = geomod.Geofence(tmp_path / "f.json")
    g.set({"inclusion": _square(50), "exclusions": [_square(5, 20, 0)], "max_altitude_m": 40}, "alice")
    assert (tmp_path / "f.json").stat().st_mode & 0o777 == 0o600
    home = SITE
    g.check(home, [(30, 30)], [((0, 0), (30, 30))], 30)                       # fine
    for pts, legs, alt, why in [
            ([(60, 0)], [], None, "outside the geofence"),
            ([(48.5, 0)], [], None, "edge"),
            ([(20, 0)], [], None, "no-fly"),
            ([(40, 0)], [((0, 0), (40, 0))], None, "no-fly area of the geofence (on the way"),
            ([], [], 45, "above the geofence"),
    ]:
        try:
            g.check(home, pts, legs, alt)
            raise AssertionError(why)
        except geomod.FenceError as e:
            assert why in str(e), (why, str(e))
    # a drone elsewhere (another site) isn't bound by it
    g.check((48.0, 9.0), [(60, 0)], [], 100)
    assert g.applies(SITE) and not g.applies((48.0, 9.0))
    # survives a restart
    assert geomod.Geofence(tmp_path / "f.json").get()["max_altitude_m"] == 40


def test_geofence_validation():
    for bad, why in [({"inclusion": [[47, 8], [47.001, 8]]}, "at least 3"),
                     ({"inclusion": _square(50), "max_altitude_m": 500}, "5-120"),
                     ({"inclusion": _square(50) + [[48, 8]]}, "2 km")]:
        try:
            geomod.validate(bad)
            raise AssertionError(why)
        except geomod.FenceError as e:
            assert why in str(e)


def test_home_of_and_command_shape():
    lat, lon = geomod.to_latlon(SITE, 10, -5)
    h = geomod.home_of({"latitude": lat, "longitude": lon, "local_x": 10, "local_y": -5})
    assert abs(h[0] - SITE[0]) < 1e-7 and abs(h[1] - SITE[1]) < 1e-7
    assert geomod.home_of({"latitude": None}) is None
    pts, legs, alt = geomod.command_shape("orbit", {"north": 0, "east": 0, "radius": 10, "altitude": 30}, (0, 0))
    assert len(pts) == 24 and alt == 30 and all(abs(math.hypot(*q) - 10) < 1e-6 for q in pts)
    pts, legs, alt = geomod.command_shape("patrol", {"route": [[10, 0], [10, 10]]}, (0, 0))
    assert legs[-1] == ((10.0, 10.0), (0.0, 0.0))     # home at the end


def test_api_geofence_refuses_commands_outside(env):
    f, c = env
    for n in ("drone1", "drone2"):
        lat, lon = geomod.to_latlon(SITE, f.states[n]["local_x"], f.states[n]["local_y"])
        f.states[n].update(latitude=lat, longitude=lon)
    pushed = []
    f.publish_geofence = lambda n, m: pushed.append((n, m))
    f.geofence_status = lambda n: None
    body = {"inclusion": _square(50), "max_altitude_m": 40}
    assert c.put("/api/v1/geofence", json=body, headers=R).status_code == 403     # pilots can't
    # alice is a pilot in this fixture; the rest runs on an app where she's an admin
    import app as appmod2
    a = appmod2.create_app(fleet=f, tokens={"tr": "alice"}, log_path=c.app.state.log.path, admins="alice",
                           control_path=c.app.state.log.path.parent / "c2.json", jobs_path=c.app.state.log.path.parent / "j2.json",
                           plugins=FakePlugins.manifests, plugin_call=f.plugins, geofence_path=c.app.state.log.path.parent / "fence2.json")
    c = TestClient(a)
    r = c.put("/api/v1/geofence", json=body, headers=R)
    assert r.status_code == 200, r.text
    assert r.json()["drones"]["drone2"]["applies"] and pushed and pushed[-1][1]["fence"]["max_altitude_m"] == 40
    assert c.put("/api/v1/geofence", json={"inclusion": [[1, 2]]}, headers=R).status_code == 422
    # drone2 is flying at home: inside is fine, outside / too high / takeoff too high are refused
    assert c.post("/api/v1/drones/drone2/goto", json={"north": 20, "east": 10}, headers=R).status_code == 200
    r = c.post("/api/v1/drones/drone2/goto", json={"north": 80, "east": 0}, headers=R)
    assert r.status_code == 422 and "outside the geofence" in r.json()["detail"]
    assert "above" in c.post("/api/v1/drones/drone2/goto", json={"north": 1, "east": 1, "altitude": 60}, headers=R).json()["detail"]
    assert c.post("/api/v1/drones/drone1/takeoff", json={"altitude": 60}, headers=R).status_code == 422
    assert c.post("/api/v1/drones/drone2/orbit", json={"north": 40, "east": 0, "radius": 20}, headers=R).status_code == 422
    log = c.get("/api/v1/log", headers=R).json()
    assert any(e["command"] == "goto" and not e["ok"] and "refused" in e["message"] for e in log)
    assert any(e["command"] == "geofence_set" for e in log)
    # removed: back to the cylinder only
    assert c.delete("/api/v1/geofence", headers=R).json()["fence"] is None
    assert c.post("/api/v1/drones/drone2/goto", json={"north": 80, "east": 0}, headers=R).status_code == 200
    assert pushed[-1][1]["fence"] is None
