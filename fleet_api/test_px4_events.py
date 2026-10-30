# PX4 feedback from drone_core: mode_completed events and PX4's own target.
from test_app import env, R  # noqa: F401
import fleet as fleetmod


def test_mode_completed_goes_to_log(env):
    f, c = env
    c.app.state.on_mode_completed("drone2", {"mode": "AUTO_TAKEOFF", "result": "SUCCESS", "result_code": 0})
    log = c.get("/api/v1/log?drone=drone2", headers=R).json()
    assert log[0]["operator"] == "px4" and log[0]["message"] == "PX4: takeoff finished" and log[0]["ok"] is True


def test_target_in_view():
    s = {"target_valid": True, "target_lat": 37.4, "target_lon": -122.0, "target_alt": 70.0,
         "target_type": "LOITER", "target_loiter_radius": 20.0, "next_valid": False}
    v = fleetmod.summarize("d", s, True, 0.0)
    assert v["target"] == {"lat": 37.4, "lon": -122.0, "alt_msl": 70.0, "type": "LOITER", "loiter_radius": 20.0}
    assert v["next"] is None
    assert fleetmod.summarize("d", {"target_valid": True, "target_type": "IDLE"}, True, 0.0)["target"] is None
    assert fleetmod.summarize("d", {}, True, 0.0)["target"] is None


def test_attitude_and_position_health():
    s = {"roll_deg": 3.14159, "pitch_deg": None, "position_trusted": False, "estimator_warnings": ["gps_glitch"]}
    v = fleetmod.summarize("d", s, True, 0.0)
    assert v["attitude"] == {"roll": 3.1, "pitch": None}
    assert v["position_health"] == {"trusted": False, "warnings": ["gps_glitch"]}
    assert fleetmod.summarize("d", {}, True, 0.0)["position_health"] == {"trusted": None, "warnings": []}


def test_pause_resume_commands(env):
    f, c = env
    calls = []
    f.mission_control = lambda name, cmd: calls.append((name, cmd)) or "ok"
    assert c.post("/api/v1/drones/drone2/patrol_pause", headers=R).status_code == 200
    assert c.post("/api/v1/drones/drone2/patrol_resume", headers=R).status_code == 200
    assert calls == [("drone2", "PAUSE"), ("drone2", "RESUME")]
