# Published on /<drone>/mode_completed when PX4 reports a mode finished (/fmu/out/mode_completed,
# PX4 v1.15.4 msg/ModeCompleted.msg). On 1.15.4 only Navigator publishes it: Takeoff (takeoff.cpp:71),
# Land (land.cpp:96), Mission (mission_base.cpp:466), VTOL takeoff (vtol_takeoff.cpp:154); all with
# RESULT_SUCCESS. NOT published when an RTL ends in a landing: rtl_direct.cpp:306 switches to IDLE on
# landing and on_active returns early (rtl_direct.cpp:103), so the publish at rtl_direct.cpp:315 is never
# reached. Watch arming_state/landing_state for RTL completion instead. Not published on user mode
# switches or failsafes. External (ROS 2) modes report their own completion (e.g. /<drone>/patrol/status).
builtin_interfaces/Time stamp   # drone_core receive time (ROS clock)
string drone                    # e.g. drone1
string mode                     # nav_state name, e.g. AUTO_TAKEOFF, AUTO_RTL, AUTO_LAND
uint8 nav_state                 # raw PX4 nav_state
string result                   # SUCCESS or FAILURE_OTHER (or RESULT_<n>)
uint8 result_code               # raw PX4 result (0 = success, 100 = failure other)
