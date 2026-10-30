# Hold and orbit (PX4 modes through drone_core).
from test_app import env, R, A  # noqa: F401  (fixture + headers)


def test_hold_is_a_safety_command(env):
    f, c = env
    assert c.post("/api/v1/drones/drone2/goto", json={"north": 1, "east": 1}, headers=R).status_code == 200
    r = c.post("/api/v1/drones/drone2/hold", headers=A)  # bob can hold a drone alice flies
    assert r.status_code == 200, r.text
    assert f.calls[-1][1] == "hold"


def test_orbit(env):
    f, c = env
    assert c.post("/api/v1/drones/drone1/orbit", json={"north": 5, "east": 5}, headers=R).status_code == 422  # not flying
    r = c.post("/api/v1/drones/drone2/orbit", json={"north": 10, "east": -5, "radius": 20, "speed": 5}, headers=R)
    assert r.status_code == 200, r.text
    name, svc, args = f.calls[-1]
    assert svc == "orbit" and args["radius"] == 20.0 and args["face_center"] is True and args["clockwise"] is True
    assert "3.0 m/s" in r.json()["message"]  # fake PX4 capped the speed
    for body in [{"north": 1, "east": 1, "radius": 1}, {"north": 1, "east": 1, "speed": 20}, {"north": "x", "east": 1}]:
        assert c.post("/api/v1/drones/drone2/orbit", json=body, headers=R).status_code == 422, body
