# Waypoint definition for mission planning
uint16 command          # MAV_CMD (16=NAV_WAYPOINT, 22=TAKEOFF, 21=LAND, etc.)
float64 latitude        # GPS latitude (degrees, 0 for local frame)
float64 longitude       # GPS longitude (degrees, 0 for local frame)  
float32 altitude        # Altitude in meters (AMSL for GPS, relative for local)
float32 yaw            # Target yaw in radians
float32 acceptance_radius # Waypoint acceptance radius in meters (default: 5.0)
float32 hold_time       # Time to hold at waypoint in seconds (default: 0.0)
bool autocontinue       # Auto advance to next waypoint (default: true)
uint8 frame            # Coordinate frame (0=GLOBAL, 1=LOCAL_NED, 2=MISSION, etc.)

# Common MAV_CMD values:
# 16 = NAV_WAYPOINT (navigate to waypoint)
# 21 = NAV_LAND (land at waypoint)  
# 22 = NAV_TAKEOFF (takeoff from waypoint)
# 17 = NAV_LOITER_UNLIM (loiter at waypoint indefinitely)
# 18 = NAV_LOITER_TURNS (loiter for specified turns)
# 19 = NAV_LOITER_TIME (loiter for specified time)