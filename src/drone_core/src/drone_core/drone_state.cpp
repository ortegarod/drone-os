#include "drone_core/drone_state.hpp"
#include <chrono> // For chrono_literals
#include <cmath>  // For std::abs

using namespace std::chrono_literals;

DroneState::DroneState(rclcpp::Node* node, const std::string& ns, const std::string& name)
    : node_(node), ns_(ns), name_(name)
{
    // Use relaxed memory order for atomic stores/loads where strict ordering isn't critical
    auto relaxed = std::memory_order_relaxed;

    // Initialize state variables
    current_nav_state_.store(NavState::UNKNOWN, relaxed);
    current_landing_state_.store(LandingState::UNKNOWN, relaxed);
    current_pos_fix_state_.store(PositionFixState::UNKNOWN, relaxed);
    current_arming_state_.store(ArmingState::UNKNOWN, relaxed);
    lat_lon_valid_.store(false, relaxed);
    alt_valid_.store(false, relaxed);
    xy_valid_.store(false, relaxed);
    z_valid_.store(false, relaxed);
    v_xy_valid_.store(false, relaxed);
    v_z_valid_.store(false, relaxed);

    // Initialize Subscriptions
    std::string status_topic = ns_ + "out/vehicle_status_v1";
    status_sub_ = node_->create_subscription<px4_msgs::msg::VehicleStatus>(
        status_topic,
        rclcpp::QoS(1).best_effort(),
        [this](const px4_msgs::msg::VehicleStatus::SharedPtr msg) { this->vehicle_status_callback(msg); });
    RCLCPP_INFO(node_->get_logger(), "[%s][State] Subscribed to %s", name_.c_str(), status_topic.c_str());

    std::string land_detected_topic = ns_ + "out/vehicle_land_detected";
    land_detected_sub_ = node_->create_subscription<px4_msgs::msg::VehicleLandDetected>(
        land_detected_topic,
        rclcpp::QoS(1).best_effort(),
        [this](const px4_msgs::msg::VehicleLandDetected::SharedPtr msg) { this->vehicle_land_detected_callback(msg); });
    RCLCPP_INFO(node_->get_logger(), "[%s][State] Subscribed to %s", name_.c_str(), land_detected_topic.c_str());

    std::string global_pos_topic = ns_ + "out/vehicle_global_position";
    global_pos_sub_ = node_->create_subscription<px4_msgs::msg::VehicleGlobalPosition>(
        global_pos_topic,
        rclcpp::QoS(1).best_effort(),
        [this](const px4_msgs::msg::VehicleGlobalPosition::SharedPtr msg) { this->vehicle_global_position_callback(msg); });
    RCLCPP_INFO(node_->get_logger(), "[%s][State] Subscribed to %s", name_.c_str(), global_pos_topic.c_str());

    std::string local_pos_topic = ns_ + "out/vehicle_local_position";
    local_pos_sub_ = node_->create_subscription<px4_msgs::msg::VehicleLocalPosition>(
        local_pos_topic,
        rclcpp::QoS(1).best_effort(),
        [this](const px4_msgs::msg::VehicleLocalPosition::SharedPtr msg) { this->vehicle_local_position_callback(msg); });
    RCLCPP_INFO(node_->get_logger(), "[%s][State] Subscribed to %s", name_.c_str(), local_pos_topic.c_str());
}

/**
 * @brief Destructor for DroneState.
 */
DroneState::~DroneState() {
    RCLCPP_INFO(node_->get_logger(), "[%s][State] Destructor called. Releasing subscriptions...", name_.c_str());
    status_sub_.reset();
    land_detected_sub_.reset();
    global_pos_sub_.reset();
    local_pos_sub_.reset();
    RCLCPP_INFO(node_->get_logger(), "[%s][State] Subscriptions released.", name_.c_str());
}

// --- Callbacks ---

void DroneState::vehicle_status_callback(const px4_msgs::msg::VehicleStatus::SharedPtr msg) {
    // --- Navigation State --- 
    NavState new_nav_state = uint8_t_to_nav_state(msg->nav_state);
    NavState previous_nav_state = current_nav_state_.exchange(new_nav_state, std::memory_order_relaxed);

    if (new_nav_state != previous_nav_state) {
        RCLCPP_INFO(node_->get_logger(), 
                    "[%s][State] Navigation State changed: %s -> %s", 
                    name_.c_str(), 
                    nav_state_enum_to_string(previous_nav_state).c_str(),
                    nav_state_enum_to_string(new_nav_state).c_str());
    }

    // --- Arming State --- 
    ArmingState new_arming_state = uint8_t_to_arming_state(msg->arming_state);
    ArmingState previous_arming_state = current_arming_state_.exchange(new_arming_state, std::memory_order_relaxed);

    if (new_arming_state != previous_arming_state) {
         RCLCPP_INFO(node_->get_logger(), 
                    "[%s][State] Arming State changed: %s -> %s", 
                    name_.c_str(), 
                    arming_state_enum_to_string(previous_arming_state).c_str(),
                    arming_state_enum_to_string(new_arming_state).c_str());
    }

    // Could track other status changes here too: msg->failsafe, etc.
}

void DroneState::vehicle_land_detected_callback(const px4_msgs::msg::VehicleLandDetected::SharedPtr msg) {
    LandingState new_landing_state = vehicle_land_detected_to_landing_state(*msg);
    LandingState previous_state = current_landing_state_.exchange(new_landing_state, std::memory_order_relaxed);

    if (new_landing_state != previous_state) {
        RCLCPP_INFO(node_->get_logger(), 
                    "[%s][State] Landing State changed: %s -> %s", 
                    name_.c_str(), 
                    landing_state_enum_to_string(previous_state).c_str(),
                    landing_state_enum_to_string(new_landing_state).c_str());
    }
}

void DroneState::vehicle_global_position_callback(const px4_msgs::msg::VehicleGlobalPosition::SharedPtr msg) {
    auto relaxed = std::memory_order_relaxed;
    // Update validity flags
    lat_lon_valid_.store(msg->lat_lon_valid, relaxed);
    alt_valid_.store(msg->alt_valid, relaxed);

    // Update Position Fix State
    PositionFixState new_pos_fix_state = msg_to_position_fix_state(*msg);
    PositionFixState previous_state = current_pos_fix_state_.exchange(new_pos_fix_state, relaxed);

    if (new_pos_fix_state != previous_state) {
        RCLCPP_INFO(node_->get_logger(), 
                    "[%s][State] Position Fix State changed: %s -> %s", 
                    name_.c_str(), 
                    position_fix_state_enum_to_string(previous_state).c_str(),
                    position_fix_state_enum_to_string(new_pos_fix_state).c_str());
    }
    
    // Update latest data if valid
    // std::lock_guard<std::mutex> lock(data_mutex_); // Protect write access to data // DEBUG: Removed mutex
    bool pos_changed = false;
    std::string pos_changes_str;

    if (msg->lat_lon_valid && std::abs(msg->lat - latest_lat_) > 1e-7) {
        pos_changes_str += " Lat:" + std::to_string(latest_lat_) + "->" + std::to_string(msg->lat);
        latest_lat_ = msg->lat;
        pos_changed = true;
    }
    if (msg->lat_lon_valid && std::abs(msg->lon - latest_lon_) > 1e-7) {
        pos_changes_str += " Lon:" + std::to_string(latest_lon_) + "->" + std::to_string(msg->lon);
        latest_lon_ = msg->lon;
        pos_changed = true;
    }
     if (msg->alt_valid && std::abs(msg->alt - latest_alt_) > 0.1f) {
        pos_changes_str += " Alt:" + std::to_string(latest_alt_) + "->" + std::to_string(msg->alt);
        latest_alt_ = msg->alt;
        pos_changed = true;
    }

    if (pos_changed) {
        RCLCPP_DEBUG(node_->get_logger(), "[%s][State] Global Position changed:%s", name_.c_str(), pos_changes_str.c_str());
    }
}

void DroneState::vehicle_local_position_callback(const px4_msgs::msg::VehicleLocalPosition::SharedPtr msg) {
    auto relaxed = std::memory_order_relaxed;
    // Update validity flags
    xy_valid_.store(msg->xy_valid, relaxed);
    z_valid_.store(msg->z_valid, relaxed);
    v_xy_valid_.store(msg->v_xy_valid, relaxed);
    v_z_valid_.store(msg->v_z_valid, relaxed);

    // Update latest data if valid
    // std::lock_guard<std::mutex> lock(data_mutex_); // Protect write access to data // DEBUG: Removed mutex
    bool local_data_changed = false;
    std::string local_changes_str;

    if (msg->xy_valid && std::abs(msg->x - latest_local_x_) > 0.01f) {
        local_changes_str += " X:" + std::to_string(latest_local_x_) + "->" + std::to_string(msg->x);
        latest_local_x_ = msg->x;
        local_data_changed = true;
    }
    if (msg->xy_valid && std::abs(msg->y - latest_local_y_) > 0.01f) {
        local_changes_str += " Y:" + std::to_string(latest_local_y_) + "->" + std::to_string(msg->y);
        latest_local_y_ = msg->y;
        local_data_changed = true;
    }
     if (msg->z_valid && std::abs(msg->z - latest_local_z_) > 0.01f) {
        local_changes_str += " Z:" + std::to_string(latest_local_z_) + "->" + std::to_string(msg->z);
        latest_local_z_ = msg->z;
        local_data_changed = true;
    }
    if (msg->v_xy_valid && std::abs(msg->vx - latest_local_vx_) > 0.01f) {
        local_changes_str += " VX:" + std::to_string(latest_local_vx_) + "->" + std::to_string(msg->vx);
        latest_local_vx_ = msg->vx;
        local_data_changed = true;
    }
    if (msg->v_xy_valid && std::abs(msg->vy - latest_local_vy_) > 0.01f) {
        local_changes_str += " VY:" + std::to_string(latest_local_vy_) + "->" + std::to_string(msg->vy);
        latest_local_vy_ = msg->vy;
        local_data_changed = true;
    }
     if (msg->v_z_valid && std::abs(msg->vz - latest_local_vz_) > 0.01f) {
        local_changes_str += " VZ:" + std::to_string(latest_local_vz_) + "->" + std::to_string(msg->vz);
        latest_local_vz_ = msg->vz;
        local_data_changed = true;
    }

    if (local_data_changed) {
        RCLCPP_DEBUG(node_->get_logger(), "[%s][State] Local Position/Velocity changed:%s", name_.c_str(), local_changes_str.c_str());
    }

    // Update latest data (protected by mutex)
    // {
        // std::lock_guard<std::mutex> lock(data_mutex_); // DEBUG: Removed mutex
        latest_local_x_ = msg->x;
        latest_local_y_ = msg->y;
        latest_local_z_ = msg->z;
        latest_local_vx_ = msg->vx;
        latest_local_vy_ = msg->vy;
        latest_local_vz_ = msg->vz;
        latest_local_yaw_ = msg->heading; // Store heading

        // Optional: Log position update
        // RCLCPP_DEBUG(node_->get_logger(), "[%s] Local Pos: x=%.2f, y=%.2f, z=%.2f, vx=%.2f, vy=%.2f, vz=%.2f, hdg=%.2f", 
        //             name_.c_str(), latest_local_x_, latest_local_y_, latest_local_z_, 
        //             latest_local_vx_, latest_local_vy_, latest_local_vz_, latest_local_yaw_);
    // }
}

// --- Getters ---

NavState DroneState::get_nav_state() const {
    return current_nav_state_.load(std::memory_order_relaxed);
}

LandingState DroneState::get_landing_state() const {
    return current_landing_state_.load(std::memory_order_relaxed);
}

PositionFixState DroneState::get_position_fix_state() const {
    return current_pos_fix_state_.load(std::memory_order_relaxed);
}

ArmingState DroneState::get_arming_state() const {
    return current_arming_state_.load(std::memory_order_relaxed);
}

bool DroneState::get_latest_global_position(double& lat, double& lon, float& alt) const {
    // std::lock_guard<std::mutex> lock(data_mutex_); // Protect read access // DEBUG: Removed mutex
    lat = latest_lat_;
    lon = latest_lon_;
    alt = latest_alt_;
    // Return combined validity from atomic flags
    return lat_lon_valid_.load(std::memory_order_relaxed) && alt_valid_.load(std::memory_order_relaxed);
}

bool DroneState::get_latest_local_position(float& x, float& y, float& z) const {
    // std::lock_guard<std::mutex> lock(data_mutex_); // Protect read access // DEBUG: Removed mutex
    x = latest_local_x_;
    y = latest_local_y_;
    z = latest_local_z_;
    // Return combined validity from atomic flags
    return xy_valid_.load(std::memory_order_relaxed) && z_valid_.load(std::memory_order_relaxed);
}

bool DroneState::get_latest_local_velocity(float& vx, float& vy, float& vz) const {
    // std::lock_guard<std::mutex> lock(data_mutex_); // Protect read access // DEBUG: Removed mutex
    vx = latest_local_vx_;
    vy = latest_local_vy_;
    vz = latest_local_vz_;
    // Return combined validity from atomic flags
    return v_xy_valid_.load(std::memory_order_relaxed) && v_z_valid_.load(std::memory_order_relaxed);
}

// --- Added: Yaw Getter ---
/**
 * @brief Get the latest received local heading (yaw).
 * Assumes heading is valid if xy position is valid.
 * @return The latest yaw angle in radians (North=0, East=PI/2). Returns NAN if not available/valid.
 */
float DroneState::get_latest_local_yaw() const {
    // std::lock_guard<std::mutex> lock(data_mutex_); // Protect read // DEBUG: Removed mutex
    // We might consider adding a specific validity flag for heading if needed,
    // but often its validity is tied to xy position validity.
    if (xy_valid_.load()) {
        return latest_local_yaw_;
    } else {
        return NAN;
    }
}
// --- End Added Yaw Getter ---

// --- Private Helper Functions (State Conversion) ---
// (Implementations copied from drone_controller.cpp)

NavState DroneState::uint8_t_to_nav_state(uint8_t px4_state) {
    switch (px4_state) {
        case px4_msgs::msg::VehicleStatus::NAVIGATION_STATE_MANUAL: return NavState::MANUAL;
        case px4_msgs::msg::VehicleStatus::NAVIGATION_STATE_ALTCTL: return NavState::ALTCTL;
        case px4_msgs::msg::VehicleStatus::NAVIGATION_STATE_POSCTL: return NavState::POSCTL;
        case px4_msgs::msg::VehicleStatus::NAVIGATION_STATE_AUTO_MISSION: return NavState::AUTO_MISSION;
        case px4_msgs::msg::VehicleStatus::NAVIGATION_STATE_AUTO_LOITER: return NavState::AUTO_LOITER;
        case px4_msgs::msg::VehicleStatus::NAVIGATION_STATE_AUTO_RTL: return NavState::AUTO_RTL;
        case px4_msgs::msg::VehicleStatus::NAVIGATION_STATE_ACRO: return NavState::ACRO;
        case px4_msgs::msg::VehicleStatus::NAVIGATION_STATE_OFFBOARD: return NavState::OFFBOARD;
        case px4_msgs::msg::VehicleStatus::NAVIGATION_STATE_STAB: return NavState::STAB;
        case px4_msgs::msg::VehicleStatus::NAVIGATION_STATE_AUTO_TAKEOFF: return NavState::AUTO_TAKEOFF;
        case px4_msgs::msg::VehicleStatus::NAVIGATION_STATE_AUTO_LAND: return NavState::AUTO_LAND;
        case px4_msgs::msg::VehicleStatus::NAVIGATION_STATE_AUTO_FOLLOW_TARGET: return NavState::AUTO_FOLLOW_TARGET;
        case px4_msgs::msg::VehicleStatus::NAVIGATION_STATE_AUTO_PRECLAND: return NavState::AUTO_PRECLAND;
        case px4_msgs::msg::VehicleStatus::NAVIGATION_STATE_ORBIT: return NavState::ORBIT;
        case px4_msgs::msg::VehicleStatus::NAVIGATION_STATE_AUTO_VTOL_TAKEOFF: return NavState::AUTO_VTOL_TAKEOFF;
        default: return NavState::UNKNOWN;
    }
}

LandingState DroneState::vehicle_land_detected_to_landing_state(const px4_msgs::msg::VehicleLandDetected& msg) {
    if (msg.freefall) return LandingState::FREEFALL;
    if (msg.landed) return LandingState::LANDED;
    if (msg.maybe_landed) return LandingState::MAYBE_LANDED;
    if (msg.ground_contact) return LandingState::GROUND_CONTACT;
    return LandingState::AIRBORNE; 
}

PositionFixState DroneState::msg_to_position_fix_state(const px4_msgs::msg::VehicleGlobalPosition& msg) {
    if (msg.lat_lon_valid && msg.alt_valid) {
        return PositionFixState::BOTH_VALID;
    } else if (msg.lat_lon_valid) {
        return PositionFixState::LAT_LON_VALID;
    } else if (msg.alt_valid) {
        return PositionFixState::ALT_VALID;
    } else {
        return PositionFixState::NO_FIX;
    }
}

ArmingState DroneState::uint8_t_to_arming_state(uint8_t px4_arming_state) {
    switch (px4_arming_state) {
        case px4_msgs::msg::VehicleStatus::ARMING_STATE_DISARMED: return ArmingState::DISARMED;
        case px4_msgs::msg::VehicleStatus::ARMING_STATE_ARMED: return ArmingState::ARMED;
        default: return ArmingState::UNKNOWN;
    }
} 