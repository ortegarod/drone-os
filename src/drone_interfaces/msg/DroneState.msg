# Complete drone state message for rosbridge integration
std_msgs/Header header
string drone_name

# Position data (NED frame)
float32 local_x
float32 local_y
float32 local_z
float32 local_yaw
float32 compass_heading        # Compass heading in degrees (0-360, 0=North)
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

# --- PX4-native health/failsafe (added) ---
bool failsafe                     # vehicle_status.failsafe: a PX4 failsafe is active
string[] failsafe_reasons         # active failsafe_flags field names (e.g. geofence_breached)
string nav_state_user_intention   # mode the user selected (differs from nav_state during a failsafe)
bool battery_low_remaining_time   # failsafe_flags.battery_low_remaining_time
bool home_position_valid          # !failsafe_flags.home_position_invalid

# --- Where PX4 is heading (position_setpoint_triplet; valid only in PX4 auto modes, not OFFBOARD) ---
bool target_valid                 # triplet.current.valid
float64 target_lat                # deg
float64 target_lon                # deg
float32 target_alt                # metres AMSL (PositionSetpoint.alt)
string target_type                # POSITION/VELOCITY/LOITER/TAKEOFF/LAND/IDLE
float32 target_loiter_radius      # m
bool next_valid                   # triplet.next.valid
float64 next_lat
float64 next_lon

# --- Attitude (/fmu/out/vehicle_attitude, PX4 v1.15.4 dds_topics.yaml:50; q = FRD body -> NED) ---
float32 roll_deg                  # deg, right wing down positive; NaN until the first sample
float32 pitch_deg                 # deg, nose up positive

# --- Position health (/fmu/out/estimator_status_flags, dds_topics.yaml:26; EKF2 publishes ~1 Hz or on change, EKF2.cpp:1851-1852) ---
bool position_trusted             # EKF aligned, fusing a horizontal position source (GPS/EV/flow/aux), not dead-reckoning,
                                  # horizontal position not rejected, not fake position, flags < 3 s old
string[] estimator_warnings       # short names (EstimatorStatusFlags.msg line):
#   dead_reckoning      cs_inertial_dead_reckoning (:36) or cs_wind_dead_reckoning (:37)
#   no_position_aiding  none of cs_gps (:9), cs_ev_pos (:19), cs_opt_flow (:10), cs_aux_gpos (:45) while not cs_fake_pos
#   gps_glitch          cs_gps and reject_hor_pos (:67) or reject_hor_vel (:65): GNSS rejected by the EKF innovation gate
#   height_rejected     reject_ver_pos (:68)
#   tilt_not_aligned    !cs_tilt_align (:7)     yaw_not_aligned  !cs_yaw_align (:8)
#   heading_rejected    reject_yaw (:69)
#   mag_fault           cs_mag_fault (:25)      mag_interference cs_mag_field_disturbed (:23)
#   mag_fusion_error    fs_bad_mag_x/y/z, fs_bad_hdg, fs_bad_mag_decl (:49-53)
#   accel_clipping      fs_bad_acc_clipping (:60)  accel_bias fs_bad_acc_bias (:58)  accel_vertical_bad fs_bad_acc_vertical (:59)
#   gps_yaw_fault       cs_gps_yaw_fault (:34)  rangefinder_fault cs_rng_fault (:35)
#   estimator_stale     no estimator_status_flags for > 3 s
