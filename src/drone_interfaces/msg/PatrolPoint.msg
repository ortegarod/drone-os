# One Patrol leg target in PX4 local NED (same frame as DroneState local_x/local_y/local_z).
uint16 command             # 16 = NAV_WAYPOINT, 20 = RETURN_TO_LAUNCH (end: executor RTLs), 21 = LAND (end: executor lands)
float32 x                  # north, m
float32 y                  # east, m
float32 z                  # down, m (negative = above the local origin)
float32 yaw                # rad; NaN = heading uncontrolled
float32 acceptance_radius  # m (3D distance); <= 0 -> 2.0
float32 hold_time          # s to wait at the point before advancing
