# Late item advance from drone_core: judge the point by the closest approach, not the late position.


def test_late_advance_uses_closest_approach(env):
    f, rec = env
    rid = rec.start("drone2", "alice", [(30, 0)], 30, 1)
    st = f.states["drone2"]
    f.status = {"mission_valid": True, "current_item": 0}
    st.update(local_x=10.0, local_y=0.0); rec.tick()
    st.update(local_x=29.5, local_y=0.0); rec.tick()      # at the point
    st.update(local_x=12.0, local_y=0.0)                   # already heading home...
    f.status["current_item"] = 1; rec.tick()               # ...when drone_core reports the advance
    pt = rec.get(rid)["points"][0]
    assert pt["status"] == "reached" and pt["off_target_m"] == 0.5 and pt["north"] == 29.5
    assert "late" in pt.get("photo_note", "")
