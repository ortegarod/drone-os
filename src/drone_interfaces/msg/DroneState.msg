# Complete drone state message for rosbridge integration
std_msgs/Header header
string drone_name

# Position data (NED frame)
float32 local_x
float32 local_y
float32 local_z
float32 local_yaw
bool position_valid

# Velocity data (NED frame)
float32 velocity_x
float32 velocity_y
float32 velocity_z
bool velocity_valid

# State information
string nav_state
string arming_state
string landing_state

# Global position (GPS)
float64 latitude
float64 longitude
float32 altitude
bool global_position_valid

# Battery & Power
float32 battery_voltage
float32 battery_current
float32 battery_remaining
float32 battery_time_remaining
float32 battery_temperature
string battery_warning
bool battery_valid

# GPS detailed info
string gps_fix_type
uint8 gps_satellites_used
float32 gps_hdop
float32 gps_vdop
float32 gps_accuracy_horizontal
float32 gps_accuracy_vertical
bool gps_jamming_detected
bool gps_spoofing_detected

# System health
float32 system_health_score
string[] active_warnings
string[] critical_failures
bool can_arm
bool manual_control_lost
bool gcs_connection_lost
bool geofence_breached

# Communication status
float32 rc_signal_strength
bool rc_signal_valid
float32 telemetry_link_quality
float32 packet_loss_rate

# Flight performance
float32 wind_speed
float32 wind_direction
float32 altitude_rate

# Safety status
string geofence_status
uint32 flight_time_elapsed
uint32 flight_time_limit