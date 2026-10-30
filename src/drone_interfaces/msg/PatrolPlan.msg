# drone_core -> drone_patrol: the mission to fly in the PX4 external "Patrol" mode.
# Published on /<drone>/patrol/plan (reliable, transient_local, depth 1). Re-sent on START/RESUME.
builtin_interfaces/Time stamp
uint32 mission_id
uint32 plan_seq                # increments on every publish; drone_patrol echoes it in PatrolStatus
uint16 start_item              # first item to fly (RESUME continues from current_item)
float32 cruise_speed           # m/s, Goto max_horizontal_speed
float32 max_vertical_speed     # m/s, Goto max_vertical_speed
float32 takeoff_altitude_amsl  # m AMSL, used when START comes from the ground (executor takeoff); NaN = no takeoff
float32 timeout_multiplier     # leg timeout = multiplier * max(5, dist/cruise_speed + 10) s, capped at 300 s base
PatrolPoint[] points
