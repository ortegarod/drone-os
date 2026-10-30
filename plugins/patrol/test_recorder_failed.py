# drone_core marks a mission failed (timeout / lost OFFBOARD) and holds; the report must say why.


def test_mission_failed_fails_the_report(env):
    f, rec = env
    rid = rec.start("drone2", "alice", [(40, 0), (40, 30)], 30, 1)
    st = f.states["drone2"]
    f.status = {"mission_valid": True, "mission_running": True, "current_item": 0, "total_items": 3}
    rec.tick()
    st.update(local_x=40.0, local_y=0.0)
    f.status["current_item"] = 1; rec.tick()
    f.status.update(mission_running=False, mission_failed=True, failure_reason="waypoint 2 not reached within 46 s (timeout)")
    rec.tick(); rec.tick()
    rep = rec.get(rid)
    assert rep["status"] == "running"
    assert sum("mission failed" in e["what"] for e in rep["events"]) == 1
    st.update(arming_state="DISARMED"); rec.tick()
    rep = rec.get(rid)
    assert rep["status"] == "failed" and "waypoint 2 not reached" in rep["summary"], rep["summary"]
    assert [p["status"] for p in rep["points"]] == ["reached", "missed"]
