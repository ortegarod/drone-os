#include "drone_core/drone_state_publisher.hpp"
#include <chrono>
#include <cmath>

using namespace std::chrono_literals;

namespace drone_core {

DroneStatePublisher::DroneStatePublisher(rclcpp::Node* node, const std::string& drone_namespace)
    : node_(node), namespace_(drone_namespace) {
    
    // Initialize DroneState manager
    drone_state_ = std::make_unique<DroneState>(node_, "/" + namespace_ + "/fmu", "DroneStatePublisher");
    
    // Create publisher for DroneState message
    state_pub_ = node_->create_publisher<drone_interfaces::msg::DroneState>(
        "/" + namespace_ + "/drone_state", 
        rclcpp::QoS(10).reliable().durability_volatile()
    );
    
    // Create service for GetState
    get_state_service_ = node_->create_service<drone_interfaces::srv::GetState>(
        "/" + namespace_ + "/get_state",
        std::bind(&DroneStatePublisher::get_state_callback, this, 
                  std::placeholders::_1, std::placeholders::_2)
    );
    
    // Create timer to publish state periodically
    publish_timer_ = node_->create_wall_timer(
        100ms,  // 10Hz update rate for real-time telemetry
        std::bind(&DroneStatePublisher::publish_state, this)
    );
    
    RCLCPP_INFO(node_->get_logger(), "DroneStatePublisher initialized for namespace: %s", namespace_.c_str());
}

DroneStatePublisher::~DroneStatePublisher() {
    if (publish_timer_) {
        publish_timer_->cancel();
    }
}

void DroneStatePublisher::publish_state() {
    if (!drone_state_) {
        return;
    }
    
    auto state_msg = create_drone_state_message();
    state_pub_->publish(state_msg);
}

void DroneStatePublisher::get_state_callback(
    const std::shared_ptr<drone_interfaces::srv::GetState::Request> request,
    std::shared_ptr<drone_interfaces::srv::GetState::Response> response) {
    
    (void)request;  // Unused parameter
    
    if (!drone_state_) {
        response->success = false;
        response->message = "DroneState not initialized";
        return;
    }
    
    // Populate response with current state
    populate_get_state_response(response);
    response->success = true;
    response->message = "State retrieved successfully";
}

drone_interfaces::msg::DroneState DroneStatePublisher::create_drone_state_message() {
    drone_interfaces::msg::DroneState msg;
    
    // Set header
    msg.header.stamp = node_->get_clock()->now();
    msg.header.frame_id = "base_link";
    msg.drone_name = namespace_;
    
    // Get current position
    float x, y, z;
    bool pos_valid = drone_state_->get_latest_local_position(x, y, z);
    msg.local_x = x;
    msg.local_y = y;
    msg.local_z = z;
    msg.local_yaw = drone_state_->get_latest_local_yaw();
    msg.position_valid = pos_valid;
    
    // Get current velocity
    float vx, vy, vz;
    bool vel_valid = drone_state_->get_latest_local_velocity(vx, vy, vz);
    msg.velocity_x = vx;
    msg.velocity_y = vy;
    msg.velocity_z = vz;
    msg.velocity_valid = vel_valid;
    
    // Get state information
    msg.nav_state = nav_state_to_string(drone_state_->get_nav_state());
    msg.arming_state = arming_state_to_string(drone_state_->get_arming_state());
    msg.landing_state = landing_state_to_string(drone_state_->get_landing_state());
    
    // Get global position
    double lat, lon;
    float alt;
    bool global_valid = drone_state_->get_latest_global_position(lat, lon, alt);
    msg.latitude = lat;
    msg.longitude = lon;
    msg.altitude = alt;
    msg.global_position_valid = global_valid;
    
    // Get battery information
    DroneState::BatteryData battery;
    if (drone_state_->get_battery_data(battery)) {
        msg.battery_voltage = battery.voltage;
        msg.battery_current = battery.current;
        msg.battery_remaining = battery.remaining;
        msg.battery_time_remaining = battery.time_remaining;
        msg.battery_temperature = battery.temperature;
        msg.battery_warning = battery.warning;
        msg.battery_valid = battery.valid;
    } else {
        msg.battery_valid = false;
        msg.battery_warning = "UNKNOWN";
    }
    
    // Get GPS information
    DroneState::GpsData gps;
    if (drone_state_->get_gps_data(gps)) {
        msg.gps_fix_type = gps.fix_type;
        msg.gps_satellites_used = gps.satellites_used;
        msg.gps_hdop = gps.hdop;
        msg.gps_vdop = gps.vdop;
        msg.gps_accuracy_horizontal = gps.accuracy_horizontal;
        msg.gps_accuracy_vertical = gps.accuracy_vertical;
        msg.gps_jamming_detected = gps.jamming_detected;
        msg.gps_spoofing_detected = gps.spoofing_detected;
    }
    
    // Get system health
    DroneState::FailsafeData failsafe;
    if (drone_state_->get_failsafe_data(failsafe)) {
        msg.system_health_score = failsafe.system_health_score;
        msg.active_warnings = failsafe.active_warnings;
        msg.critical_failures = failsafe.critical_failures;
        msg.manual_control_lost = failsafe.manual_control_lost;
        msg.gcs_connection_lost = failsafe.gcs_connection_lost;
        msg.geofence_breached = failsafe.geofence_breached;
        msg.can_arm = !failsafe.manual_control_lost && !failsafe.gcs_connection_lost;
    } else {
        msg.system_health_score = 0.0f;
        msg.can_arm = false;
    }
    
    // Get communication status
    DroneState::TelemetryData telemetry;
    if (drone_state_->get_telemetry_data(telemetry)) {
        msg.rc_signal_strength = telemetry.rc_signal_strength;
        msg.rc_signal_valid = telemetry.rc_signal_valid;
        msg.telemetry_link_quality = telemetry.telemetry_link_quality;
        msg.packet_loss_rate = telemetry.packet_loss_rate;
    } else {
        msg.rc_signal_strength = 0.0f;
        msg.rc_signal_valid = false;
        msg.telemetry_link_quality = 0.0f;
        msg.packet_loss_rate = 1.0f;
    }
    
    // Get flight performance
    DroneState::WindData wind;
    if (drone_state_->get_wind_data(wind)) {
        msg.wind_speed = wind.speed;
        msg.wind_direction = wind.direction;
    } else {
        msg.wind_speed = 0.0f;
        msg.wind_direction = 0.0f;
    }
    msg.altitude_rate = vz;  // Z velocity is altitude rate
    
    // Safety status
    msg.geofence_status = failsafe.geofence_breached ? "OUTSIDE" : "INSIDE";
    msg.flight_time_elapsed = drone_state_->get_flight_time_elapsed();
    msg.flight_time_limit = 1800;  // 30 minutes default limit
    
    return msg;
}

void DroneStatePublisher::populate_get_state_response(
    std::shared_ptr<drone_interfaces::srv::GetState::Response> response) {
    
    // Get current position
    float x, y, z;
    bool pos_valid = drone_state_->get_latest_local_position(x, y, z);
    response->local_x = x;
    response->local_y = y;
    response->local_z = z;
    response->local_yaw = drone_state_->get_latest_local_yaw();
    response->position_valid = pos_valid;
    
    // Get current velocity
    float vx, vy, vz;
    bool vel_valid = drone_state_->get_latest_local_velocity(vx, vy, vz);
    response->velocity_x = vx;
    response->velocity_y = vy;
    response->velocity_z = vz;
    response->velocity_valid = vel_valid;
    
    // Get state information
    response->nav_state = nav_state_to_string(drone_state_->get_nav_state());
    response->arming_state = arming_state_to_string(drone_state_->get_arming_state());
    response->landing_state = landing_state_to_string(drone_state_->get_landing_state());
    
    // Get global position
    double lat, lon;
    float alt;
    bool global_valid = drone_state_->get_latest_global_position(lat, lon, alt);
    response->latitude = lat;
    response->longitude = lon;
    response->altitude = alt;
    response->global_position_valid = global_valid;
    
    // Get battery information
    DroneState::BatteryData battery;
    if (drone_state_->get_battery_data(battery)) {
        response->battery_voltage = battery.voltage;
        response->battery_current = battery.current;
        response->battery_remaining = battery.remaining;
        response->battery_time_remaining = battery.time_remaining;
        response->battery_temperature = battery.temperature;
        response->battery_warning = battery.warning;
        response->battery_valid = battery.valid;
    } else {
        response->battery_valid = false;
        response->battery_warning = "UNKNOWN";
    }
    
    // Get GPS information
    DroneState::GpsData gps;
    if (drone_state_->get_gps_data(gps)) {
        response->gps_fix_type = gps.fix_type;
        response->gps_satellites_used = gps.satellites_used;
        response->gps_hdop = gps.hdop;
        response->gps_vdop = gps.vdop;
        response->gps_accuracy_horizontal = gps.accuracy_horizontal;
        response->gps_accuracy_vertical = gps.accuracy_vertical;
        response->gps_jamming_detected = gps.jamming_detected;
        response->gps_spoofing_detected = gps.spoofing_detected;
    }
    
    // Get system health
    DroneState::FailsafeData failsafe;
    if (drone_state_->get_failsafe_data(failsafe)) {
        response->system_health_score = failsafe.system_health_score;
        response->active_warnings = failsafe.active_warnings;
        response->critical_failures = failsafe.critical_failures;
        response->manual_control_lost = failsafe.manual_control_lost;
        response->gcs_connection_lost = failsafe.gcs_connection_lost;
        response->geofence_breached = failsafe.geofence_breached;
        response->can_arm = !failsafe.manual_control_lost && !failsafe.gcs_connection_lost;
    } else {
        response->system_health_score = 0.0f;
        response->can_arm = false;
    }
    
    // Get communication status
    DroneState::TelemetryData telemetry;
    if (drone_state_->get_telemetry_data(telemetry)) {
        response->rc_signal_strength = telemetry.rc_signal_strength;
        response->rc_signal_valid = telemetry.rc_signal_valid;
        response->telemetry_link_quality = telemetry.telemetry_link_quality;
        response->packet_loss_rate = telemetry.packet_loss_rate;
    } else {
        response->rc_signal_strength = 0.0f;
        response->rc_signal_valid = false;
        response->telemetry_link_quality = 0.0f;
        response->packet_loss_rate = 1.0f;
    }
    
    // Get flight performance
    DroneState::WindData wind;
    if (drone_state_->get_wind_data(wind)) {
        response->wind_speed = wind.speed;
        response->wind_direction = wind.direction;
    } else {
        response->wind_speed = 0.0f;
        response->wind_direction = 0.0f;
    }
    response->altitude_rate = vz;
    
    // Safety status
    response->geofence_status = failsafe.geofence_breached ? "OUTSIDE" : "INSIDE";
    response->flight_time_elapsed = drone_state_->get_flight_time_elapsed();
    response->flight_time_limit = 1800;
}

std::string DroneStatePublisher::get_battery_warning_string(uint8_t warning) const {
    switch (warning) {
        case 0: return "NONE";
        case 1: return "LOW";
        case 2: return "CRITICAL";
        case 3: return "EMERGENCY";
        default: return "UNKNOWN";
    }
}

std::string DroneStatePublisher::get_gps_fix_type_string(uint8_t fix_type) const {
    switch (fix_type) {
        case 0: return "NONE";
        case 2: return "2D";
        case 3: return "3D";
        case 5: return "RTK_FLOAT";
        case 6: return "RTK_FIXED";
        default: return "UNKNOWN";
    }
}

float DroneStatePublisher::calculate_system_health_score() const {
    float score = 100.0f;
    
    DroneState::BatteryData battery;
    DroneState::GpsData gps;
    DroneState::FailsafeData failsafe;
    
    // Deduct points for various issues
    if (drone_state_->get_battery_data(battery) && battery.valid) {
        if (battery.remaining < 0.2f) score -= 30.0f;
        else if (battery.remaining < 0.3f) score -= 15.0f;
    } else {
        score -= 20.0f;
    }
    
    if (drone_state_->get_gps_data(gps) && gps.valid) {
        if (gps.satellites_used < 6) score -= 10.0f;
    } else {
        score -= 25.0f;
    }
    
    if (drone_state_->get_failsafe_data(failsafe)) {
        if (failsafe.manual_control_lost) score -= 20.0f;
        if (failsafe.gcs_connection_lost) score -= 15.0f;
        if (failsafe.geofence_breached) score -= 25.0f;
    }
    
    return std::max(0.0f, std::min(100.0f, score));
}

float DroneStatePublisher::calculate_link_quality() const {
    DroneState::TelemetryData telemetry;
    if (!drone_state_->get_telemetry_data(telemetry) || !telemetry.valid) {
        return 0.0f;
    }
    
    float quality = 100.0f * (1.0f - telemetry.packet_loss_rate);
    return std::max(0.0f, std::min(100.0f, quality));
}

void DroneStatePublisher::populate_warning_messages(
    std::vector<std::string>& warnings, 
    std::vector<std::string>& critical_failures) const {
    
    warnings.clear();
    critical_failures.clear();
    
    DroneState::BatteryData battery;
    DroneState::FailsafeData failsafe;
    DroneState::GpsData gps;
    
    // Battery warnings
    if (drone_state_->get_battery_data(battery) && battery.valid) {
        if (battery.remaining < 0.15f) {
            critical_failures.push_back("Critical battery level: " + std::to_string(int(battery.remaining * 100)) + "%");
        } else if (battery.remaining < 0.25f) {
            warnings.push_back("Low battery: " + std::to_string(int(battery.remaining * 100)) + "%");
        }
    }
    
    // GPS warnings
    if (drone_state_->get_gps_data(gps)) {
        if (!gps.valid) {
            critical_failures.push_back("GPS fix lost or insufficient");
        } else if (gps.satellites_used < 6) {
            warnings.push_back("Low satellite count: " + std::to_string(gps.satellites_used));
        }
        
        // GPS security warnings
        if (gps.jamming_detected) {
            critical_failures.push_back("GPS jamming detected");
        }
        if (gps.spoofing_detected) {
            critical_failures.push_back("GPS spoofing detected");
        }
    }
    
    // Communication warnings
    if (drone_state_->get_failsafe_data(failsafe)) {
        if (failsafe.manual_control_lost) {
            critical_failures.push_back("Manual control signal lost");
        }
        if (failsafe.gcs_connection_lost) {
            warnings.push_back("Ground control connection lost");
        }
        
        // Safety warnings
        if (failsafe.geofence_breached) {
            critical_failures.push_back("Geofence violation detected");
        }
    }
}

// Helper functions to convert enums to strings
std::string DroneStatePublisher::nav_state_to_string(NavState state) const {
    switch (state) {
        case NavState::MANUAL: return "MANUAL";
        case NavState::ALTCTL: return "ALTCTL";
        case NavState::POSCTL: return "POSCTL";
        case NavState::AUTO_MISSION: return "AUTO_MISSION";
        case NavState::AUTO_LOITER: return "AUTO_LOITER";
        case NavState::AUTO_RTL: return "AUTO_RTL";
        case NavState::ACRO: return "ACRO";
        case NavState::OFFBOARD: return "OFFBOARD";
        case NavState::STAB: return "STAB";
        case NavState::AUTO_TAKEOFF: return "AUTO_TAKEOFF";
        case NavState::AUTO_LAND: return "AUTO_LAND";
        case NavState::AUTO_FOLLOW_TARGET: return "AUTO_FOLLOW_TARGET";
        case NavState::AUTO_PRECLAND: return "AUTO_PRECLAND";
        case NavState::ORBIT: return "ORBIT";
        case NavState::AUTO_VTOL_TAKEOFF: return "AUTO_VTOL_TAKEOFF";
        case NavState::FREEFALL: return "FREEFALL";
        default: return "UNKNOWN";
    }
}

std::string DroneStatePublisher::arming_state_to_string(ArmingState state) const {
    switch (state) {
        case ArmingState::DISARMED: return "DISARMED";
        case ArmingState::ARMED: return "ARMED";
        default: return "UNKNOWN";
    }
}

std::string DroneStatePublisher::landing_state_to_string(LandingState state) const {
    switch (state) {
        case LandingState::LANDED: return "LANDED";
        case LandingState::AIRBORNE: return "AIRBORNE";
        case LandingState::MAYBE_LANDED: return "MAYBE_LANDED";
        case LandingState::GROUND_CONTACT: return "GROUND_CONTACT";
        default: return "UNKNOWN";
    }
}

} // namespace drone_core