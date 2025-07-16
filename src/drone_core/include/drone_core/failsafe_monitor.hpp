#pragma once

#include <rclcpp/rclcpp.hpp>
#include <px4_msgs/msg/failsafe_flags.hpp>
#include <px4_msgs/msg/battery_status.hpp>
#include <px4_msgs/msg/vehicle_status.hpp>
#include <functional>
#include <string>

namespace drone_core {

struct FailsafeStatus {
    // Critical failures requiring immediate action
    bool critical_battery_low = false;        // Emergency battery level
    bool critical_battery_unhealthy = false;  // Battery hardware failure
    bool critical_motor_failure = false;      // Motor/ESC failure
    bool critical_attitude_failure = false;   // Attitude control failure
    bool geofence_violation = false;          // Boundary breach
    
    // Warning conditions
    bool battery_warning = false;             // Low battery warning
    bool rc_signal_lost = false;              // Manual control lost
    bool gcs_connection_lost = false;         // Ground control lost
    bool position_invalid = false;            // GPS/navigation failure
    bool wind_limit_exceeded = false;         // High wind conditions
    
    // System status
    bool armed = false;
    bool in_air = false;
    uint8_t battery_warning_level = 0;        // 0=none, 1=low, 2=critical, 3=emergency
    float battery_remaining = 1.0f;           // 0.0 to 1.0
    
    std::string active_failsafe = "none";     // Current active failsafe action
    uint64_t timestamp = 0;
};

class FailsafeMonitor {
public:
    FailsafeMonitor(rclcpp::Node* node, const std::string& drone_namespace = "");
    ~FailsafeMonitor() = default;
    
    // Callback for failsafe status changes
    using FailsafeCallback = std::function<void(const FailsafeStatus&)>;
    void setFailsafeCallback(FailsafeCallback callback);
    
    // Get current failsafe status
    const FailsafeStatus& getStatus() const { return current_status_; }
    
    // Check if any critical failsafe is active
    bool hasCriticalFailsafe() const;
    
    // Check if drone is safe to perform missions
    bool isSafeForMission() const;
    
    // Get human-readable failsafe description
    std::string getFailsafeDescription() const;

private:
    void failsafeFlagsCallback(const px4_msgs::msg::FailsafeFlags::SharedPtr msg);
    void batteryStatusCallback(const px4_msgs::msg::BatteryStatus::SharedPtr msg);
    void vehicleStatusCallback(const px4_msgs::msg::VehicleStatus::SharedPtr msg);
    
    void updateFailsafeStatus();
    void triggerFailsafeCallback();
    
    rclcpp::Node* node_;
    std::string drone_namespace_;
    
    // ROS 2 subscribers
    rclcpp::Subscription<px4_msgs::msg::FailsafeFlags>::SharedPtr failsafe_flags_sub_;
    rclcpp::Subscription<px4_msgs::msg::BatteryStatus>::SharedPtr battery_status_sub_;
    rclcpp::Subscription<px4_msgs::msg::VehicleStatus>::SharedPtr vehicle_status_sub_;
    
    // Status tracking
    FailsafeStatus current_status_;
    FailsafeStatus previous_status_;
    FailsafeCallback failsafe_callback_;
    
    // PX4 message data
    px4_msgs::msg::FailsafeFlags::SharedPtr latest_failsafe_flags_;
    px4_msgs::msg::BatteryStatus::SharedPtr latest_battery_status_;
    px4_msgs::msg::VehicleStatus::SharedPtr latest_vehicle_status_;
    
    // Failsafe thresholds (configurable)
    float critical_battery_threshold_ = 0.15f;  // 15% remaining
    float warning_battery_threshold_ = 0.25f;   // 25% remaining
};

} // namespace drone_core