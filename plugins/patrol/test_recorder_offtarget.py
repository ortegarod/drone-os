# A mission that advances while the drone sits elsewhere must not report success.


def test_points_not_reached_fail_the_report(env):
    f, rec = env
    rid = rec.start("drone2", "alice", [(40, 0), (40, 30)], 30, 1)
    st = f.states["drone2"]
    f.status = {"mission_valid": True, "current_item": 0}
    rec.tick()
    st.update(local_x=0.0, local_y=0.0)          # hovering at home
    f.status["current_item"] = 2; rec.tick()     # mission advanced anyway (timeouts)
    st.update(arming_state="DISARMED"); rec.tick()
    rep = rec.get(rid)
    assert rep["status"] == "failed" and [p["status"] for p in rep["points"]] == ["off_target", "off_target"]
    assert "never actually reached" in rep["summary"]
