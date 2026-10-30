# Patrol reports: photo per reached point, events, final status.


def test_report_photos_and_completion(env):
    f, rec = env
    rid = rec.start("drone2", "alice", [(10, 0), (10, 10)], 30, 2, job="j1")
    st = f.states["drone2"]
    f.status = {"mission_valid": True, "mission_running": True, "current_item": 0, "total_items": 5}
    rec.tick()
    for item, (x, y) in [(1, (10, 0)), (2, (10, 10)), (3, (10, 1)), (4, (10, 9))]:
        st.update(local_x=x, local_y=y)
        f.status["current_item"] = item
        rec.tick()
    st.update(nav_state="AUTO_RTL"); rec.tick()
    rep = rec.get(rid)
    assert rep["status"] == "running" and [p["status"] for p in rep["points"]] == ["reached"] * 4
    assert any("AUTO_RTL" in e["what"] for e in rep["events"])
    assert f.finished == []
    st.update(arming_state="DISARMED", nav_state="OFFBOARD", local_x=0.1, local_y=0.0, local_z=0.0); rec.tick()
    rep = rec.get(rid)
    assert not any("AUTO_RTL -> OFFBOARD" in e["what"] for e in rep["events"])
    assert rep["status"] == "completed" and rep["landed"]["from_home_m"] == 0.1, rep["summary"]
    assert rep["summary"].startswith("4/4 points, 4 photos")
    assert rec.photo_path(rid, 1) and rec.photo_path(rid, 9) is None
    assert rec.list("drone2")[0]["id"] == rid and rec.list("drone2")[0]["photos"] == 4
    assert [r["job"] for r in f.finished] == ["j1"] and f.finished[0]["status"] == "completed"


def test_failsafe_abort(env):
    f, rec = env
    rid = rec.start("drone2", "alice", [(10, 0), (10, 10)], 30, 2)
    st = f.states["drone2"]
    st.update(local_x=10.0, local_y=0.0)
    f.status = {"mission_valid": True, "current_item": 1}
    rec.tick()
    st.update(failsafe=True, failsafe_reasons=["battery_warning", "gcs_connection_lost"]); rec.tick()
    st.update(arming_state="DISARMED"); rec.tick()
    rep = rec.get(rid)
    assert rep["status"] == "aborted" and "battery_warning" in rep["summary"] and "gcs" not in rep["summary"]
    assert [p["status"] for p in rep["points"]] == ["reached", "missed", "missed", "missed"]
