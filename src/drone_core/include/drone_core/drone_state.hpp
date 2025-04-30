#pragma once

#include <rclcpp/rclcpp.hpp>
#include <atomic>
#include <string>
#include <vector> // May need for returning bulk data
#include <mutex>  // May need for protecting complex data access

// Include message types needed for subscriptions
#include <px4_msgs/msg/vehicle_status.hpp>
#include <px4_msgs/msg/vehicle_land_detected.hpp>
#include <px4_msgs/msg/vehicle_global_position.hpp>
#include <px4_msgs/msg/vehicle_local_position.hpp>

// Include shared state enums
#include "drone_core/utils/state_enums.hpp"

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

    // Add other getters as needed (e.g., for specific flags, raw messages)

private:
    // --- ROS Communication --- 
    rclcpp::Node* node_; ///< Pointer to the parent ROS node
    std::string ns_;     ///< PX4 namespace
    std::string name_;   ///< Drone name for logging

    // Subscriptions
    rclcpp::Subscription<px4_msgs::msg::VehicleStatus>::SharedPtr status_sub_;
    rclcpp::Subscription<px4_msgs::msg::VehicleLandDetected>::SharedPtr land_detected_sub_;
    rclcpp::Subscription<px4_msgs::msg::VehicleGlobalPosition>::SharedPtr global_pos_sub_;
    rclcpp::Subscription<px4_msgs::msg::VehicleLocalPosition>::SharedPtr local_pos_sub_;

    // --- State Variables (Atomic for thread safety) ---
    std::atomic<NavState> current_nav_state_{NavState::UNKNOWN};
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
    float latest_local_x_{0.0f};
    float latest_local_y_{0.0f};
    float latest_local_z_{0.0f};
    float latest_local_vx_{0.0f};
    float latest_local_vy_{0.0f};
    float latest_local_vz_{0.0f};
    float latest_local_yaw_{NAN}; // Added member for yaw (heading)

    // --- Private Callbacks ---
    void vehicle_status_callback(const px4_msgs::msg::VehicleStatus::SharedPtr msg);
    void vehicle_land_detected_callback(const px4_msgs::msg::VehicleLandDetected::SharedPtr msg);
    void vehicle_global_position_callback(const px4_msgs::msg::VehicleGlobalPosition::SharedPtr msg);
    void vehicle_local_position_callback(const px4_msgs::msg::VehicleLocalPosition::SharedPtr msg);

    // --- Private Helper Functions (State Conversion) ---
    // (Definitions will be in drone_state.cpp)
    NavState uint8_t_to_nav_state(uint8_t px4_state);
    LandingState vehicle_land_detected_to_landing_state(const px4_msgs::msg::VehicleLandDetected& msg);
    PositionFixState msg_to_position_fix_state(const px4_msgs::msg::VehicleGlobalPosition& msg);
    ArmingState uint8_t_to_arming_state(uint8_t px4_arming_state);
}; 