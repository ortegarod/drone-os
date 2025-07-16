#include "drone_core/failsafe_monitor.hpp"
#include <rclcpp/rclcpp.hpp>

namespace drone_core {

FailsafeMonitor::FailsafeMonitor(rclcpp::Node* node, const std::string& drone_namespace)
    : node_(node), drone_namespace_(drone_namespace) {
    
    // Construct topic names with namespace
    std::string failsafe_topic = drone_namespace_ + "out/failsafe_flags";
    std::string battery_topic = drone_namespace_ + "out/battery_status";
    std::string vehicle_status_topic = drone_namespace_ + "out/vehicle_status";
    
    RCLCPP_INFO(node_->get_logger(), "FailsafeMonitor: Subscribing to topics:");
    RCLCPP_INFO(node_->get_logger(), "  - %s", failsafe_topic.c_str());
    RCLCPP_INFO(node_->get_logger(), "  - %s", battery_topic.c_str());
    RCLCPP_INFO(node_->get_logger(), "  - %s", vehicle_status_topic.c_str());
    
    // Create subscribers
    failsafe_flags_sub_ = node_->create_subscription<px4_msgs::msg::FailsafeFlags>(
        failsafe_topic, 10,
        std::bind(&FailsafeMonitor::failsafeFlagsCallback, this, std::placeholders::_1)
    );
    
    battery_status_sub_ = node_->create_subscription<px4_msgs::msg::BatteryStatus>(
        battery_topic, 10,
        std::bind(&FailsafeMonitor::batteryStatusCallback, this, std::placeholders::_1)
    );
    
    vehicle_status_sub_ = node_->create_subscription<px4_msgs::msg::VehicleStatus>(
        vehicle_status_topic, 10,
        std::bind(&FailsafeMonitor::vehicleStatusCallback, this, std::placeholders::_1)
    );
}

void FailsafeMonitor::setFailsafeCallback(FailsafeCallback callback) {
    failsafe_callback_ = callback;
}

bool FailsafeMonitor::hasCriticalFailsafe() const {
    return current_status_.critical_battery_low ||
           current_status_.critical_battery_unhealthy ||
           current_status_.critical_motor_failure ||
           current_status_.critical_attitude_failure ||
           current_status_.geofence_violation;
}

bool FailsafeMonitor::isSafeForMission() const {
    // Check if conditions are safe for autonomous missions
    return !hasCriticalFailsafe() && 
           current_status_.battery_remaining > critical_battery_threshold_ &&
           !current_status_.battery_warning &&
           !current_status_.position_invalid &&
           !current_status_.wind_limit_exceeded;
}

std::string FailsafeMonitor::getFailsafeDescription() const {
    if (current_status_.critical_battery_low) {
        return "CRITICAL: Emergency battery level - immediate landing required";
    }
    if (current_status_.critical_battery_unhealthy) {
        return "CRITICAL: Battery hardware failure detected";
    }
    if (current_status_.critical_motor_failure) {
        return "CRITICAL: Motor/ESC failure detected";
    }
    if (current_status_.critical_attitude_failure) {
        return "CRITICAL: Attitude control failure";
    }
    if (current_status_.geofence_violation) {
        return "WARNING: Geofence boundary violation";
    }
    if (current_status_.battery_warning) {
        return "WARNING: Low battery - consider returning to base";
    }
    if (current_status_.rc_signal_lost) {
        return "WARNING: Manual control signal lost";
    }
    if (current_status_.gcs_connection_lost) {
        return "WARNING: Ground control connection lost";
    }
    if (current_status_.position_invalid) {
        return "WARNING: GPS/navigation failure";
    }
    if (current_status_.wind_limit_exceeded) {
        return "WARNING: Wind speed exceeds limits";
    }
    
    return "All systems nominal";
}

void FailsafeMonitor::failsafeFlagsCallback(const px4_msgs::msg::FailsafeFlags::SharedPtr msg) {
    latest_failsafe_flags_ = msg;
    updateFailsafeStatus();
}

void FailsafeMonitor::batteryStatusCallback(const px4_msgs::msg::BatteryStatus::SharedPtr msg) {
    latest_battery_status_ = msg;
    updateFailsafeStatus();
}

void FailsafeMonitor::vehicleStatusCallback(const px4_msgs::msg::VehicleStatus::SharedPtr msg) {
    latest_vehicle_status_ = msg;
    updateFailsafeStatus();
}

void FailsafeMonitor::updateFailsafeStatus() {
    // Store previous status for comparison
    previous_status_ = current_status_;
    
    // Update timestamp
    current_status_.timestamp = node_->get_clock()->now().nanoseconds();
    
    // Update from vehicle status
    if (latest_vehicle_status_) {
        current_status_.armed = (latest_vehicle_status_->arming_state == 2); // ARMED
        current_status_.in_air = (latest_vehicle_status_->nav_state != 1);   // Not landed
    }
    
    // Update from battery status
    if (latest_battery_status_) {
        current_status_.battery_remaining = latest_battery_status_->remaining;
        current_status_.battery_warning_level = latest_battery_status_->warning;
        
        // Determine battery failsafe conditions
        current_status_.critical_battery_low = 
            (latest_battery_status_->warning >= 2) || // CRITICAL or EMERGENCY
            (latest_battery_status_->remaining < critical_battery_threshold_);
            
        current_status_.critical_battery_unhealthy = 
            (latest_battery_status_->warning == 4) || // FAILED
            (latest_battery_status_->warning == 6);   // UNHEALTHY
            
        current_status_.battery_warning = 
            (latest_battery_status_->warning >= 1) || // LOW or higher
            (latest_battery_status_->remaining < warning_battery_threshold_);
    }
    
    // Update from failsafe flags
    if (latest_failsafe_flags_) {
        current_status_.rc_signal_lost = latest_failsafe_flags_->manual_control_signal_lost;
        current_status_.gcs_connection_lost = latest_failsafe_flags_->gcs_connection_lost;
        current_status_.position_invalid = latest_failsafe_flags_->local_position_invalid ||
                                          latest_failsafe_flags_->global_position_invalid;
        current_status_.geofence_violation = latest_failsafe_flags_->geofence_breached;
        current_status_.wind_limit_exceeded = latest_failsafe_flags_->wind_limit_exceeded;
        current_status_.critical_motor_failure = latest_failsafe_flags_->fd_motor_failure;
        current_status_.critical_attitude_failure = latest_failsafe_flags_->fd_critical_failure;
    }
    
    // Determine active failsafe action
    if (current_status_.critical_battery_low) {
        current_status_.active_failsafe = "emergency_land";
    } else if (current_status_.critical_motor_failure || current_status_.critical_attitude_failure) {
        current_status_.active_failsafe = "emergency_land";
    } else if (current_status_.geofence_violation) {
        current_status_.active_failsafe = "return_to_launch";
    } else if (current_status_.battery_warning) {
        current_status_.active_failsafe = "return_to_launch";
    } else if (current_status_.rc_signal_lost || current_status_.gcs_connection_lost) {
        current_status_.active_failsafe = "hold";
    } else {
        current_status_.active_failsafe = "none";
    }
    
    // Trigger callback if status changed
    triggerFailsafeCallback();
}

void FailsafeMonitor::triggerFailsafeCallback() {
    // Only trigger callback if significant status change occurred
    bool status_changed = 
        (current_status_.critical_battery_low != previous_status_.critical_battery_low) ||
        (current_status_.critical_battery_unhealthy != previous_status_.critical_battery_unhealthy) ||
        (current_status_.critical_motor_failure != previous_status_.critical_motor_failure) ||
        (current_status_.critical_attitude_failure != previous_status_.critical_attitude_failure) ||
        (current_status_.geofence_violation != previous_status_.geofence_violation) ||
        (current_status_.battery_warning != previous_status_.battery_warning) ||
        (current_status_.rc_signal_lost != previous_status_.rc_signal_lost) ||
        (current_status_.gcs_connection_lost != previous_status_.gcs_connection_lost) ||
        (current_status_.position_invalid != previous_status_.position_invalid) ||
        (current_status_.wind_limit_exceeded != previous_status_.wind_limit_exceeded) ||
        (current_status_.active_failsafe != previous_status_.active_failsafe);
    
    if (status_changed && failsafe_callback_) {
        RCLCPP_INFO(node_->get_logger(), "FailsafeMonitor: Status changed - %s", 
                   getFailsafeDescription().c_str());
        failsafe_callback_(current_status_);
    }
}

} // namespace drone_core