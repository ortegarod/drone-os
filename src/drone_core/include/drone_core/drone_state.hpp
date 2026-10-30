#pragma once

#include <rclcpp/rclcpp.hpp>
#include <atomic>
#include <string>
#include <vector> // May need for returning bulk data
#include <mutex>  // May need for protecting complex data access

// Include message types needed for subscriptions
#include <px4_msgs/msg/vehicle_status.hpp>
#include <px4_msgs/msg/vehicle_global_position.hpp>
#include <px4_msgs/msg/vehicle_local_position.hpp>
#include <px4_msgs/msg/battery_status.hpp>
#include <px4_msgs/msg/sensor_gps.hpp>
#include <px4_msgs/msg/failsafe_flags.hpp>
#include <px4_msgs/msg/vehicle_attitude.hpp>
#include <px4_msgs/msg/estimator_status_flags.hpp>
#include <px4_msgs/msg/position_setpoint_triplet.hpp>
#include <px4_msgs/msg/mode_completed.hpp>
#include <drone_interfaces/msg/mode_completed.hpp>

// Include shared state enums
#include "drone_core/utils/state_enums.hpp"
#include <drone_interfaces/msg/drone_state.hpp>

/**
 * @class DroneState
 * @brief Tracks and provides access to the drone's state via ROS 2 subscriptions.
 *
 * This class subscribes to various PX4 topics (VehicleStatus, VehicleLandDetected,
 * VehicleGlobalPosition, VehicleLocalPosition) and maintains the latest known state
 * (navigation, landing, position fix) and data (positions, velocities).
 */
class DroneState {
public:
    /**
     * @brief Construct a new Drone State object
     * @param node Pointer to the parent ROS2 node for creating subscriptions.
     * @param ns The PX4 namespace (e.g., "/fmu/").
     * @param name The drone's name (for logging context).
     */
    DroneState(rclcpp::Node* node, const std::string& ns, const std::string& name);

    /**
     * @brief Destructor for DroneState.
     * Ensures subscriptions are released.
     */
    ~DroneState();

    // --- Public Getters ---

    /** @brief Get the currently tracked navigation state. */
    NavState get_nav_state() const;

    /** @brief Get the currently tracked landing state. */
    LandingState get_landing_state() const;

    /** @brief Get the currently tracked position fix state. */
    PositionFixState get_position_fix_state() const;

    /** @brief Get the currently tracked arming state. */
    ArmingState get_arming_state() const;

    /** 
     * @brief Get the latest received global position.
     * @param lat Latitude (degrees).
     * @param lon Longitude (degrees).
     * @param alt Altitude AMSL (meters).
     * @return True if lat/lon and alt data are currently considered valid, false otherwise.
     */
    bool get_latest_global_position(double& lat, double& lon, float& alt) const;
    // Why get_latest_global_position() is false ("" when it is valid)
    std::string global_position_problem() const;
    /** True if no VehicleLocalPosition has arrived for more than LOCAL_POS_STALE_NS (or none yet). */
    bool is_local_position_stale() const;

    /** 
     * @brief Get the latest received local position.
     * @param x Local X position (meters, NED).
     * @param y Local Y position (meters, NED).
     * @param z Local Z position (meters, NED).
     * @return True if xy and z data are currently considered valid, false otherwise.
     */
    bool get_latest_local_position(float& x, float& y, float& z) const;

    /** 
     * @brief Get the latest received local velocity.
     * @param vx Local X velocity (m/s, NED).
     * @param vy Local Y velocity (m/s, NED).
     * @param vz Local Z velocity (m/s, NED).
     * @return True if v_xy and v_z data are currently considered valid, false otherwise.
     */
    bool get_latest_local_velocity(float& vx, float& vy, float& vz) const;

    /** 
     * @brief Get the latest received local heading (yaw).
     * @return The latest yaw angle in radians (North=0, East=PI/2). Returns NAN if not available/valid.
     */
    float get_latest_local_yaw() const;

    /** 
     * @brief Get the latest compass heading.
     * @return The latest compass heading in degrees (0-360, 0=North). Returns NAN if not available/valid.
     */
    float get_latest_compass_heading() const;

    // Telemetry data structures
    struct BatteryData {
        float voltage = 0.0f;
        float current = 0.0f;
        float remaining = 0.0f;
        float time_remaining = 0.0f;
        float temperature = 0.0f;
        std::string warning = "UNKNOWN";
        bool valid = false;
        rclcpp::Time timestamp;
    };

    struct GpsData {
        std::string fix_type = "UNKNOWN";
        uint8_t satellites_used = 0;
        float hdop = 0.0f;
        float vdop = 0.0f;
        float accuracy_horizontal = 0.0f;
        float accuracy_vertical = 0.0f;
        bool jamming_detected = false;
        bool spoofing_detected = false;
        bool valid = false;
        rclcpp::Time timestamp;
    };

    struct FailsafeData {
        bool manual_control_lost = false;
        bool gcs_connection_lost = false;
        bool geofence_breached = false;
        bool battery_warning = false;
        bool battery_unhealthy = false;
        bool wind_limit_exceeded = false;
        bool flight_time_limit_exceeded = false;
        float system_health_score = 0.0f;
        std::vector<std::string> active_warnings;
        std::vector<std::string> critical_failures;
        bool valid = false;
        rclcpp::Time timestamp;
    };

    struct TelemetryData {
        float rc_signal_strength = 0.0f;
        bool rc_signal_valid = false;
        float telemetry_link_quality = 0.0f;
        float packet_loss_rate = 0.0f;
        bool valid = false;
        rclcpp::Time timestamp;
    };

    struct WindData {
        float speed = 0.0f;
        float direction = 0.0f;
        bool valid = false;
        rclcpp::Time timestamp;
    };

    // Telemetry getters
    bool get_battery_data(BatteryData& data) const;
    bool get_gps_data(GpsData& data) const;
    bool get_failsafe_data(FailsafeData& data) const;
    bool get_telemetry_data(TelemetryData& data) const;
    bool get_wind_data(WindData& data) const;
    uint32_t get_flight_time_elapsed() const;

    // PX4-native health (vehicle_status / failsafe_flags)
    struct HealthData {
        bool status_valid = false;
        bool failsafe = false;                     // vehicle_status.failsafe
        bool pre_flight_checks_pass = false;       // vehicle_status.pre_flight_checks_pass
        std::string nav_state_user_intention = "UNKNOWN";
        bool flags_valid = false;
        std::vector<std::string> failsafe_reasons; // active failsafe_flags (manual control filtered if rc_input_mode==4)
        bool local_position_invalid = true;
        bool global_position_invalid = true;
        bool home_position_invalid = true;
        bool battery_low_remaining_time = false;
        uint8_t battery_warning = 0;               // failsafe_flags.battery_warning (BatteryStatus levels)
    };
    HealthData get_health() const;

    // attitude (vehicle_attitude) and EKF position health (estimator_status_flags)
    struct AttitudeHealth {
        float roll_deg = NAN;
        float pitch_deg = NAN;
        bool position_trusted = false;
        std::vector<std::string> estimator_warnings;
    };
    AttitudeHealth get_attitude_health() const;
    bool rc_input_disabled() const;

    // Home as PX4 defines it: position while disarmed and landed (Commander.cpp:1801). home_position is not bridged.
    bool get_home(double& lat, double& lon, float& alt_amsl) const;
    // raw PX4 nav_state / nav_state_user_intention (255 = none yet) and the PATROL external mode's id
    uint8_t get_raw_nav_state() const { return raw_nav_state_.load(); }
    uint8_t get_raw_user_intention() const { return raw_user_intention_.load(); }
    void set_patrol_nav_state(uint8_t id) { patrol_nav_state_.store(id); }
    uint8_t get_patrol_nav_state() const { return patrol_nav_state_.load(); }
    static bool is_external_nav_state(uint8_t raw) { return raw >= 23 && raw <= 30; }  // VehicleStatus.msg EXTERNAL1..8
    // Name for DroneState.nav_state etc.: the PATROL mode's id -> "PATROL", other external modes -> "EXTERNAL<n>"
    std::string nav_state_name(uint8_t raw) const;
    // Local NED (metres, EKF origin) -> lat/lon with PX4's MapProjection::reproject (lib/geo/geo.cpp:90-110)
    bool local_to_global(float north, float east, double& lat, double& lon) const;
    // Latest position_setpoint_triplet.current (lat/lon) and its arrival time (steady ns)
    bool get_triplet_current(double& lat, double& lon, int64_t& rx_ns) const;

    // Where PX4 is heading: latest position_setpoint_triplet (dds_topics.yaml:38; px4_msgs PositionSetpoint.msg)
    struct TargetData {
        bool target_valid = false;
        double target_lat = NAN, target_lon = NAN;
        float target_alt = NAN;          // AMSL
        std::string target_type = "NONE";
        float target_loiter_radius = 0.0f;
        bool next_valid = false;
        double next_lat = NAN, next_lon = NAN;
    };
    TargetData get_target() const;

private:
    // --- ROS Communication ---
    rclcpp::Node* node_; ///< Pointer to the parent ROS node
    std::string ns_;     ///< PX4 namespace
    std::string name_;   ///< Drone name for logging

    // Publisher for aggregated drone state (for web UI via rosbridge)
    rclcpp::Publisher<drone_interfaces::msg::DroneState>::SharedPtr state_pub_;
    rclcpp::TimerBase::SharedPtr publish_timer_;
    void publish_state();

    // Subscriptions
    rclcpp::Subscription<px4_msgs::msg::VehicleStatus>::SharedPtr status_sub_;
    rclcpp::Subscription<px4_msgs::msg::VehicleGlobalPosition>::SharedPtr global_pos_sub_;
    // steady_clock ns of the last VehicleGlobalPosition; 0 = never received. Global position is reported
    // invalid when older than GLOBAL_POS_STALE_NS (PX4 stops publishing it when it loses the estimate).
    std::atomic<int64_t> last_global_pos_ns_{0};
    static constexpr int64_t GLOBAL_POS_STALE_NS = 1000000000LL;
    std::atomic<int64_t> last_local_pos_ns_{0};  // same rule for VehicleLocalPosition (waypoint completion uses it)
    static constexpr int64_t LOCAL_POS_STALE_NS = 1000000000LL;
    rclcpp::Subscription<px4_msgs::msg::VehicleLocalPosition>::SharedPtr local_pos_sub_;
    // VehicleAttitude subscription removed - using heading from VehicleLocalPosition
    rclcpp::Subscription<px4_msgs::msg::BatteryStatus>::SharedPtr battery_sub_;
    rclcpp::Subscription<px4_msgs::msg::SensorGps>::SharedPtr gps_sub_;
    rclcpp::Subscription<px4_msgs::msg::FailsafeFlags>::SharedPtr failsafe_sub_;
    rclcpp::Subscription<px4_msgs::msg::PositionSetpointTriplet>::SharedPtr triplet_sub_;

    mutable std::mutex health_mutex_;
    HealthData health_;
    mutable std::mutex home_mutex_;
    bool home_valid_{false};
    double home_lat_{0.0}, home_lon_{0.0};
    float home_alt_{0.0f};
    bool ref_valid_{false};
    double ref_lat_{0.0}, ref_lon_{0.0};
    double triplet_lat_{NAN}, triplet_lon_{NAN};
    TargetData target_;
    rclcpp::Subscription<px4_msgs::msg::ModeCompleted>::SharedPtr mode_completed_sub_;
    rclcpp::Publisher<drone_interfaces::msg::ModeCompleted>::SharedPtr mode_completed_pub_;
    // De-dup of PX4 mode_completed bursts (PX4 v1.15 land.cpp:93-96 re-publishes every navigator cycle while landed)
    uint8_t last_mc_nav_state_{255};
    uint8_t last_mc_result_{255};
    uint64_t last_mc_px4_us_{0};
    int64_t triplet_rx_ns_{0};
    void update_home();

    // --- State Variables (Atomic for thread safety) ---
    std::atomic<NavState> current_nav_state_{NavState::UNKNOWN};
    std::atomic<uint8_t> raw_nav_state_{255};
    std::atomic<uint8_t> raw_user_intention_{255};
    std::atomic<uint8_t> patrol_nav_state_{0};
    std::atomic<LandingState> current_landing_state_{LandingState::UNKNOWN};
    std::atomic<PositionFixState> current_pos_fix_state_{PositionFixState::UNKNOWN};
    std::atomic<ArmingState> current_arming_state_{ArmingState::UNKNOWN};
    // Store validity flags from messages atomically as well
    std::atomic<bool> lat_lon_valid_{false};
    std::atomic<bool> alt_valid_{false};
    std::atomic<bool> xy_valid_{false};
    std::atomic<bool> z_valid_{false};
    std::atomic<bool> v_xy_valid_{false};
    std::atomic<bool> v_z_valid_{false};

    // --- Latest Data (Protected by mutex for consistent access if needed, though atomic loads might suffice for simple types) ---
    // Consider using a mutex if returning complex structs or needing transactional reads
    mutable std::mutex data_mutex_; // Protects access to non-atomic latest data
    double latest_lat_{0.0}; 
    double latest_lon_{0.0}; 
    float latest_alt_{0.0f};
    std::atomic<float> latest_eph_{0.0f};
    std::atomic<float> latest_epv_{0.0f};
    std::atomic<bool> latest_dead_reckoning_{false};
    float latest_local_x_{0.0f};
    float latest_local_y_{0.0f};
    float latest_local_z_{0.0f};
    float latest_local_vx_{0.0f};
    float latest_local_vy_{0.0f};
    float latest_local_vz_{0.0f};
    float latest_local_yaw_{NAN}; // Added member for yaw (heading)
    float latest_compass_heading_{NAN}; // Compass heading in degrees (0-360, 0=North)

    // --- Telemetry Data ---
    mutable std::mutex battery_mutex_;
    mutable std::mutex gps_mutex_;
    mutable std::mutex failsafe_mutex_;
    mutable std::mutex telemetry_mutex_;
    mutable std::mutex wind_mutex_;
    
    BatteryData battery_data_;
    GpsData gps_data_;
    FailsafeData failsafe_data_;
    TelemetryData telemetry_data_;
    WindData wind_data_;
    
    std::chrono::steady_clock::time_point flight_start_time_;

    // --- Private Callbacks ---
    void vehicle_status_callback(const px4_msgs::msg::VehicleStatus::SharedPtr msg);
    void vehicle_global_position_callback(const px4_msgs::msg::VehicleGlobalPosition::SharedPtr msg);
    void vehicle_local_position_callback(const px4_msgs::msg::VehicleLocalPosition::SharedPtr msg);
    // vehicle_attitude_callback removed - using heading from VehicleLocalPosition
    void battery_status_callback(const px4_msgs::msg::BatteryStatus::SharedPtr msg);
    void sensor_gps_callback(const px4_msgs::msg::SensorGps::SharedPtr msg);
    void failsafe_flags_callback(const px4_msgs::msg::FailsafeFlags::SharedPtr msg);
    void vehicle_attitude_callback(const px4_msgs::msg::VehicleAttitude::SharedPtr msg);
    void estimator_flags_callback(const px4_msgs::msg::EstimatorStatusFlags::SharedPtr msg);
    rclcpp::Subscription<px4_msgs::msg::VehicleAttitude>::SharedPtr attitude_sub_;
    rclcpp::Subscription<px4_msgs::msg::EstimatorStatusFlags>::SharedPtr estimator_flags_sub_;
    mutable std::mutex att_mutex_;
    float roll_deg_ = NAN, pitch_deg_ = NAN;
    bool est_flags_valid_ = false;
    bool est_position_ok_ = false;
    std::vector<std::string> est_warnings_;
    std::chrono::steady_clock::time_point est_rx_{};

    // --- Private Helper Functions (State Conversion) ---
    // (Definitions will be in drone_state.cpp)
    NavState uint8_t_to_nav_state(uint8_t px4_state) const;
    PositionFixState msg_to_position_fix_state(const px4_msgs::msg::VehicleGlobalPosition& msg);
    ArmingState uint8_t_to_arming_state(uint8_t px4_arming_state);
}; 