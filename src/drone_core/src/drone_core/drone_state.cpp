#include "drone_core/drone_state.hpp"
#include <chrono> // For chrono_literals
#include <cmath>  // For std::abs, std::sqrt, M_PI
#include <algorithm>

using namespace std::chrono_literals;

// Max PX4 position error estimate (1 sigma, meters) for global position to count as valid
static constexpr float HORIZONTAL_ACCURACY_THRESHOLD = 5.0f;
static constexpr float VERTICAL_ACCURACY_THRESHOLD = 10.0f;

// Worse of battery_status.warning (string) and failsafe_flags.battery_warning (BatteryStatus levels 0-3)
static std::string worst_battery_warning(const std::string& current, uint8_t flags_level) {
    static const char* names[] = {"NONE", "LOW", "CRITICAL", "EMERGENCY"};
    int cur = -1;
    for (int i = 0; i < 4; ++i) if (current == names[i]) cur = i;
    const int lvl = flags_level <= 3 ? flags_level : -1;
    const int worst = std::max(cur, lvl);
    return worst < 0 ? current : names[worst];
}

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
    std::string status_topic = ns_ + "out/vehicle_status";
    status_sub_ = node_->create_subscription<px4_msgs::msg::VehicleStatus>(
        status_topic,
        rclcpp::QoS(1).best_effort(),
        [this](const px4_msgs::msg::VehicleStatus::SharedPtr msg) { this->vehicle_status_callback(msg); });
    RCLCPP_INFO(node_->get_logger(), "[%s][State] Subscribed to %s", name_.c_str(), status_topic.c_str());

    // Landing state is derived from vehicle_status (vehicle_land_detected is not in PX4 v1.15.4 dds_topics.yaml).
    if (!node_->has_parameter("rc_input_mode")) {
        // Must match PX4 COM_RC_IN_MODE. 4 = "Stick input disabled" (commander_params.c:179): PX4 then always
        // reports manual_control_signal_lost, which is not a fault for us.
        node_->declare_parameter<int>("rc_input_mode", 4);
    }

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

    // VehicleAttitude subscription removed - using heading from VehicleLocalPosition instead

    // Additional telemetry subscriptions
    std::string battery_topic = ns_ + "out/battery_status";
    battery_sub_ = node_->create_subscription<px4_msgs::msg::BatteryStatus>(
        battery_topic,
        rclcpp::QoS(1).best_effort(),
        [this](const px4_msgs::msg::BatteryStatus::SharedPtr msg) { this->battery_status_callback(msg); });
    RCLCPP_INFO(node_->get_logger(), "[%s][State] Subscribed to %s", name_.c_str(), battery_topic.c_str());

    // PX4 v1.15.4 bridges SensorGps as out/vehicle_gps_position (dds_topics.yaml:62-63); out/sensor_gps does not exist.
    std::string gps_topic = ns_ + "out/vehicle_gps_position";
    gps_sub_ = node_->create_subscription<px4_msgs::msg::SensorGps>(
        gps_topic,
        rclcpp::QoS(1).best_effort(),
        [this](const px4_msgs::msg::SensorGps::SharedPtr msg) { this->sensor_gps_callback(msg); });
    RCLCPP_INFO(node_->get_logger(), "[%s][State] Subscribed to %s", name_.c_str(), gps_topic.c_str());

    std::string failsafe_topic = ns_ + "out/failsafe_flags";
    failsafe_sub_ = node_->create_subscription<px4_msgs::msg::FailsafeFlags>(
        failsafe_topic,
        rclcpp::QoS(1).best_effort(),
        [this](const px4_msgs::msg::FailsafeFlags::SharedPtr msg) { this->failsafe_flags_callback(msg); });
    RCLCPP_INFO(node_->get_logger(), "[%s][State] Subscribed to %s", name_.c_str(), failsafe_topic.c_str());

    // attitude (dds_topics.yaml:50) and EKF status flags (dds_topics.yaml:26)
    attitude_sub_ = node_->create_subscription<px4_msgs::msg::VehicleAttitude>(
        ns_ + "out/vehicle_attitude", rclcpp::QoS(1).best_effort(),
        [this](const px4_msgs::msg::VehicleAttitude::SharedPtr msg) { this->vehicle_attitude_callback(msg); });
    estimator_flags_sub_ = node_->create_subscription<px4_msgs::msg::EstimatorStatusFlags>(
        ns_ + "out/estimator_status_flags", rclcpp::QoS(1).best_effort(),
        [this](const px4_msgs::msg::EstimatorStatusFlags::SharedPtr msg) { this->estimator_flags_callback(msg); });
    RCLCPP_INFO(node_->get_logger(), "[%s][State] Subscribed to %sout/vehicle_attitude, %sout/estimator_status_flags",
                name_.c_str(), ns_.c_str(), ns_.c_str());

    // out/telemetry_status and out/wind are not bridged on PX4 v1.15.4 (dds_topics.yaml); fields stay 0 (deprecated).

    std::string triplet_topic = ns_ + "out/position_setpoint_triplet";  // dds_topics.yaml:38
    triplet_sub_ = node_->create_subscription<px4_msgs::msg::PositionSetpointTriplet>(
        triplet_topic,
        rclcpp::QoS(1).best_effort(),
        [this](const px4_msgs::msg::PositionSetpointTriplet::SharedPtr msg) {
            static const char* kTypes[] = {"POSITION", "VELOCITY", "LOITER", "TAKEOFF", "LAND", "IDLE"};  // PositionSetpoint.msg:5-10
            std::lock_guard<std::mutex> lock(home_mutex_);
            target_.target_valid = msg->current.valid;
            target_.target_lat = msg->current.lat;
            target_.target_lon = msg->current.lon;
            target_.target_alt = msg->current.alt;
            target_.target_type = msg->current.type <= 5 ? kTypes[msg->current.type] : "TYPE_" + std::to_string(msg->current.type);
            target_.target_loiter_radius = msg->current.loiter_radius;
            target_.next_valid = msg->next.valid;
            target_.next_lat = msg->next.lat;
            target_.next_lon = msg->next.lon;
            if (msg->current.valid) {
                triplet_lat_ = msg->current.lat;
                triplet_lon_ = msg->current.lon;
                triplet_rx_ns_ = std::chrono::duration_cast<std::chrono::nanoseconds>(
                    std::chrono::steady_clock::now().time_since_epoch()).count();
            }
        });
    RCLCPP_INFO(node_->get_logger(), "[%s][State] Subscribed to %s", name_.c_str(), triplet_topic.c_str());

    // Mode completion events (dds_topics.yaml:17) re-published as /<drone>/mode_completed
    mode_completed_pub_ = node_->create_publisher<drone_interfaces::msg::ModeCompleted>(
        "/" + name_ + "/mode_completed", rclcpp::QoS(10).reliable());
    std::string mc_topic = ns_ + "out/mode_completed";
    mode_completed_sub_ = node_->create_subscription<px4_msgs::msg::ModeCompleted>(
        mc_topic, rclcpp::QoS(10).best_effort(),
        [this](const px4_msgs::msg::ModeCompleted::SharedPtr msg) {
            // PX4 v1.15.4 Land::on_active() (src/modules/navigator/land.cpp:93-96) calls mode_completed(AUTO_LAND) on
            // every navigator cycle while land_detected.landed, without the "!finished" guard Takeoff has
            // (takeoff.cpp:67), so one landing arrives as ~40 copies (~20 Hz until auto-disarm). Forward only the
            // first of a burst: same nav_state + result with < 0.5 s (PX4 time) since the previous copy is a repeat.
            // The gap rolls forward with every copy, so a long burst stays one event; a later landing is new.
            const bool same = msg->nav_state == last_mc_nav_state_ && msg->result == last_mc_result_;
            const bool repeat = same && msg->timestamp >= last_mc_px4_us_ &&
                                msg->timestamp - last_mc_px4_us_ < 500000ULL;
            last_mc_nav_state_ = msg->nav_state;
            last_mc_result_ = msg->result;
            last_mc_px4_us_ = msg->timestamp;
            if (repeat) {
                return;
            }
            drone_interfaces::msg::ModeCompleted ev;
            ev.stamp = node_->get_clock()->now();
            ev.drone = name_;
            ev.nav_state = msg->nav_state;
            ev.mode = nav_state_name(msg->nav_state);
            ev.result_code = msg->result;
            ev.result = msg->result == 0 ? "SUCCESS" : (msg->result == 100 ? "FAILURE_OTHER" : "RESULT_" + std::to_string(msg->result));
            RCLCPP_INFO(node_->get_logger(), "[%s][State] PX4 mode completed: %s -> %s", name_.c_str(), ev.mode.c_str(), ev.result.c_str());
            mode_completed_pub_->publish(ev);
        });
    RCLCPP_INFO(node_->get_logger(), "[%s][State] Subscribed to %s", name_.c_str(), mc_topic.c_str());

    // Initialize telemetry data
    battery_data_.valid = false;
    gps_data_.valid = false;
    failsafe_data_.valid = false;
    telemetry_data_.valid = false;
    wind_data_.valid = false;
    
    // Initialize flight timer
    flight_start_time_ = std::chrono::steady_clock::now();

    // Create publisher for aggregated drone state
    std::string state_topic = "/" + name_ + "/drone_state";
    state_pub_ = node_->create_publisher<drone_interfaces::msg::DroneState>(
        state_topic, rclcpp::QoS(10).best_effort());
    RCLCPP_INFO(node_->get_logger(), "[%s][State] Publishing to %s", name_.c_str(), state_topic.c_str());

    // Create timer to publish state at 10Hz
    publish_timer_ = node_->create_wall_timer(
        100ms, std::bind(&DroneState::publish_state, this));
}

/**
 * @brief Destructor for DroneState.
 */
DroneState::~DroneState() {
    RCLCPP_INFO(node_->get_logger(), "[%s][State] Destructor called. Releasing subscriptions...", name_.c_str());
    status_sub_.reset();
    global_pos_sub_.reset();
    local_pos_sub_.reset();
    battery_sub_.reset();
    gps_sub_.reset();
    failsafe_sub_.reset();
    triplet_sub_.reset();
    mode_completed_sub_.reset();
    RCLCPP_INFO(node_->get_logger(), "[%s][State] Subscriptions released.", name_.c_str());
}

// --- Callbacks ---

void DroneState::vehicle_status_callback(const px4_msgs::msg::VehicleStatus::SharedPtr msg) {
    // --- Navigation State --- 
    raw_nav_state_.store(msg->nav_state);
    raw_user_intention_.store(msg->nav_state_user_intention);
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

    {
        std::lock_guard<std::mutex> lock(health_mutex_);
        health_.status_valid = true;
        health_.failsafe = msg->failsafe;                              // VehicleStatus.msg:100
        health_.pre_flight_checks_pass = msg->pre_flight_checks_pass;  // VehicleStatus.msg:138
        health_.nav_state_user_intention = nav_state_name(msg->nav_state_user_intention);
    }

    // Landing state from vehicle_status: takeoff_time is set on "Takeoff detected" and reset on disarm
    // (Commander.cpp:2093-2098, 656).
    LandingState new_landing_state = LandingState::LANDED;
    if (msg->arming_state == px4_msgs::msg::VehicleStatus::ARMING_STATE_ARMED) {
        new_landing_state = (msg->takeoff_time == 0) ? LandingState::ON_GROUND : LandingState::AIRBORNE;
    }
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
    static constexpr auto relaxed = std::memory_order_relaxed;
    last_global_pos_ns_.store(std::chrono::duration_cast<std::chrono::nanoseconds>(
        std::chrono::steady_clock::now().time_since_epoch()).count(), relaxed);

    // --- TEMPORARILY COMMENTED OUT FOR TESTING --- 
    // --- DO NOT FLY WITH THESE CHECKS REMOVED --- 
    // lat_lon_valid_.store(msg->eph < HORIZONTAL_ACCURACY_THRESHOLD, relaxed); // Requires definition of HORIZONTAL_ACCURACY_THRESHOLD
    // alt_valid_.store(msg->epv < VERTICAL_ACCURACY_THRESHOLD, relaxed); // Requires definition of VERTICAL_ACCURACY_THRESHOLD
    // --- END TEMPORARY MODIFICATION ---
    
    // Global position is only valid when PX4's accuracy estimate is good enough and it is not dead-reckoning.
    // (px4_msgs for PX4 v1.15 has no lat_lon_valid/alt_valid fields; those arrive in v1.16.)
    lat_lon_valid_.store(!msg->dead_reckoning && msg->eph < HORIZONTAL_ACCURACY_THRESHOLD, relaxed);
    alt_valid_.store(!msg->dead_reckoning && msg->epv < VERTICAL_ACCURACY_THRESHOLD, relaxed);
    latest_lat_ = msg->lat;
    latest_lon_ = msg->lon;
    latest_alt_ = msg->alt;
    latest_eph_.store(msg->eph, relaxed);
    latest_epv_.store(msg->epv, relaxed);
    latest_dead_reckoning_.store(msg->dead_reckoning, relaxed);
    update_home();

    // Update latitude if valid and changed significantly
    // --- TEMPORARILY COMMENTED OUT FOR TESTING --- 
    // if (msg->eph < HORIZONTAL_ACCURACY_THRESHOLD && std::abs(msg->lat - latest_lat_) > 1e-7) {
    // --- TEMPORARILY ALWAYS UPDATE FOR TESTING --- 
    if (std::abs(msg->lat - latest_lat_) > 1e-7) {
        // --- FIX: Direct assignment --- 
        latest_lat_ = msg->lat;
        RCLCPP_DEBUG(node_->get_logger(), "Updated latitude to: %.7f", msg->lat);
    }

    // Update longitude if valid and changed significantly
    // --- TEMPORARILY COMMENTED OUT FOR TESTING --- 
    // if (msg->eph < HORIZONTAL_ACCURACY_THRESHOLD && std::abs(msg->lon - latest_lon_) > 1e-7) {
    // --- TEMPORARILY ALWAYS UPDATE FOR TESTING --- 
     if (std::abs(msg->lon - latest_lon_) > 1e-7) {
        // --- FIX: Direct assignment --- 
        latest_lon_ = msg->lon;
        RCLCPP_DEBUG(node_->get_logger(), "Updated longitude to: %.7f", msg->lon);
    }

    // Update altitude if valid and changed significantly
    // --- TEMPORARILY COMMENTED OUT FOR TESTING --- 
    //  if (msg->epv < VERTICAL_ACCURACY_THRESHOLD && std::abs(msg->alt - latest_alt_) > 0.1f) {
    // --- TEMPORARILY ALWAYS UPDATE FOR TESTING --- 
     if (std::abs(msg->alt - latest_alt_) > 0.1f) {
        // --- FIX: Direct assignment --- 
        latest_alt_ = msg->alt;
        RCLCPP_DEBUG(node_->get_logger(), "Updated altitude to: %.1f", msg->alt);
     }

    // Update position fix state; log PX4's raw accuracy values with every change so a
    // flapping estimate can be diagnosed from the drone_core log alone.
    const PositionFixState current_fix = msg_to_position_fix_state(*msg);
    const PositionFixState previous_fix = current_pos_fix_state_.exchange(current_fix, relaxed);
    if (previous_fix != current_fix) {
        RCLCPP_INFO(node_->get_logger(),
                    "[%s][State] Position Fix State changed: %s -> %s (eph=%.2f m, epv=%.2f m, dead_reckoning=%s; "
                    "valid needs eph<%.1f, epv<%.1f, no dead reckoning)",
                    name_.c_str(),
                    position_fix_state_enum_to_string(previous_fix).c_str(),
                    position_fix_state_enum_to_string(current_fix).c_str(),
                    msg->eph, msg->epv, msg->dead_reckoning ? "true" : "false",
                    HORIZONTAL_ACCURACY_THRESHOLD, VERTICAL_ACCURACY_THRESHOLD);
    }
    
    // Update latest data if valid
    // std::lock_guard<std::mutex> lock(data_mutex_); // Protect write access to data // DEBUG: Removed mutex
    bool pos_changed = false;
    std::string pos_changes_str;

    // --- TEMPORARILY COMMENTED OUT FOR TESTING --- 
    // if (msg->eph < HORIZONTAL_ACCURACY_THRESHOLD && std::abs(msg->lat - latest_lat_) > 1e-7) { 
    // --- TEMPORARILY ALWAYS UPDATE FOR TESTING --- 
    if (std::abs(msg->lat - latest_lat_) > 1e-7) { // Check only if changed
        pos_changes_str += " Lat:" + std::to_string(latest_lat_) + "->" + std::to_string(msg->lat);
        latest_lat_ = msg->lat;
        pos_changed = true;
    }
    // --- TEMPORARILY COMMENTED OUT FOR TESTING --- 
    // if (msg->eph < HORIZONTAL_ACCURACY_THRESHOLD && std::abs(msg->lon - latest_lon_) > 1e-7) {
    // --- TEMPORARILY ALWAYS UPDATE FOR TESTING --- 
    if (std::abs(msg->lon - latest_lon_) > 1e-7) { // Check only if changed
        pos_changes_str += " Lon:" + std::to_string(latest_lon_) + "->" + std::to_string(msg->lon);
        latest_lon_ = msg->lon;
        pos_changed = true;
    }
    // --- TEMPORARILY COMMENTED OUT FOR TESTING --- 
    //  if (msg->epv < VERTICAL_ACCURACY_THRESHOLD && std::abs(msg->alt - latest_alt_) > 0.1f) {
    // --- TEMPORARILY ALWAYS UPDATE FOR TESTING --- 
     if (std::abs(msg->alt - latest_alt_) > 0.1f) { // Check only if changed
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
    last_local_pos_ns_.store(std::chrono::duration_cast<std::chrono::nanoseconds>(
        std::chrono::steady_clock::now().time_since_epoch()).count(), relaxed);
    // Update validity flags
    xy_valid_.store(msg->xy_valid, relaxed);
    z_valid_.store(msg->z_valid, relaxed);
    v_xy_valid_.store(msg->v_xy_valid, relaxed);
    v_z_valid_.store(msg->v_z_valid, relaxed);
    if (msg->xy_global) {
        std::lock_guard<std::mutex> lock(home_mutex_);
        ref_valid_ = true;
        ref_lat_ = msg->ref_lat;
        ref_lon_ = msg->ref_lon;
    }

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
        
        // Calculate compass heading from NED heading
        float compass_heading_deg = msg->heading * 180.0f / M_PI;
        if (compass_heading_deg < 0.0f) {
            compass_heading_deg += 360.0f;
        }
        latest_compass_heading_ = compass_heading_deg;

        // Optional: Log position update
        // RCLCPP_DEBUG(node_->get_logger(), "[%s] Local Pos: x=%.2f, y=%.2f, z=%.2f, vx=%.2f, vy=%.2f, vz=%.2f, hdg=%.2f", 
        //             name_.c_str(), latest_local_x_, latest_local_y_, latest_local_z_, 
        //             latest_local_vx_, latest_local_vy_, latest_local_vz_, latest_local_yaw_);
    // }
}

// VehicleAttitude callback removed - using heading from VehicleLocalPosition instead

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

std::string DroneState::global_position_problem() const {
    double lat, lon; float alt;
    if (get_latest_global_position(lat, lon, alt)) return "";
    const int64_t last = last_global_pos_ns_.load(std::memory_order_relaxed);
    const int64_t now = std::chrono::duration_cast<std::chrono::nanoseconds>(
        std::chrono::steady_clock::now().time_since_epoch()).count();
    char buf[160];
    if (last == 0) return "no vehicle_global_position received";
    if (now - last > GLOBAL_POS_STALE_NS) {
        std::snprintf(buf, sizeof(buf), "vehicle_global_position stale (%.1f s old)", (now - last) / 1e9);
        return buf;
    }
    {
        std::lock_guard<std::mutex> lock(health_mutex_);
        if (health_.flags_valid && health_.global_position_invalid)
            return "PX4 reports global position invalid (failsafe_flags.global_position_invalid)";
    }
    std::snprintf(buf, sizeof(buf), "PX4 accuracy too low: eph=%.2f m (max %.1f), epv=%.2f m (max %.1f), dead_reckoning=%s",
                  latest_eph_.load(std::memory_order_relaxed), HORIZONTAL_ACCURACY_THRESHOLD,
                  latest_epv_.load(std::memory_order_relaxed), VERTICAL_ACCURACY_THRESHOLD,
                  latest_dead_reckoning_.load(std::memory_order_relaxed) ? "true" : "false");
    return buf;
}

bool DroneState::get_latest_global_position(double& lat, double& lon, float& alt) const {
    // std::lock_guard<std::mutex> lock(data_mutex_); // Protect read access // DEBUG: Removed mutex
    lat = latest_lat_;
    lon = latest_lon_;
    alt = latest_alt_;
    // Stale data is invalid: PX4 stops publishing vehicle_global_position when it loses the estimate.
    const int64_t last = last_global_pos_ns_.load(std::memory_order_relaxed);
    const int64_t now = std::chrono::duration_cast<std::chrono::nanoseconds>(
        std::chrono::steady_clock::now().time_since_epoch()).count();
    if (last == 0 || now - last > GLOBAL_POS_STALE_NS) {
        return false;
    }
    // PX4's own verdict (FailsafeFlags.msg:31) when available, plus our accuracy gate
    {
        std::lock_guard<std::mutex> lock(health_mutex_);
        if (health_.flags_valid && health_.global_position_invalid) return false;
    }
    return lat_lon_valid_.load(std::memory_order_relaxed) && alt_valid_.load(std::memory_order_relaxed);
}

bool DroneState::is_local_position_stale() const {
    const int64_t last = last_local_pos_ns_.load(std::memory_order_relaxed);
    const int64_t now = std::chrono::duration_cast<std::chrono::nanoseconds>(
        std::chrono::steady_clock::now().time_since_epoch()).count();
    return last == 0 || now - last > LOCAL_POS_STALE_NS;
}

bool DroneState::get_latest_local_position(float& x, float& y, float& z) const {
    // std::lock_guard<std::mutex> lock(data_mutex_); // Protect read access // DEBUG: Removed mutex
    x = latest_local_x_;
    y = latest_local_y_;
    z = latest_local_z_;
    // Stale data is invalid (no VehicleLocalPosition for more than LOCAL_POS_STALE_NS).
    const int64_t last = last_local_pos_ns_.load(std::memory_order_relaxed);
    const int64_t now = std::chrono::duration_cast<std::chrono::nanoseconds>(
        std::chrono::steady_clock::now().time_since_epoch()).count();
    if (last == 0 || now - last > LOCAL_POS_STALE_NS) {
        return false;
    }
    // Valid = fresh, EKF xy/z valid, and PX4 does not flag local position invalid (FailsafeFlags.msg:28)
    {
        std::lock_guard<std::mutex> lock(health_mutex_);
        if (health_.flags_valid && health_.local_position_invalid) return false;
    }
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

/**
 * @brief Get the latest compass heading.
 * @return The latest compass heading in degrees (0-360, 0=North). Returns NAN if not available/valid.
 */
float DroneState::get_latest_compass_heading() const {
    // Compass heading is valid if xy position is valid
    if (xy_valid_.load()) {
        return latest_compass_heading_;
    } else {
        return NAN;
    }
}
// --- End Added Yaw/Compass Getters ---

// --- Private Helper Functions (State Conversion) ---
// (Implementations copied from drone_controller.cpp)

NavState DroneState::uint8_t_to_nav_state(uint8_t px4_state) const {
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
        default:
            return is_external_nav_state(px4_state) ? NavState::EXTERNAL : NavState::UNKNOWN;
    }
}

std::string DroneState::nav_state_name(uint8_t raw) const {
    if (is_external_nav_state(raw)) {
        const uint8_t patrol = patrol_nav_state_.load();
        return (patrol != 0 && raw == patrol) ? "PATROL" : "EXTERNAL" + std::to_string(raw - 22);
    }
    return nav_state_enum_to_string(uint8_t_to_nav_state(raw));
}


PositionFixState DroneState::msg_to_position_fix_state(const px4_msgs::msg::VehicleGlobalPosition& msg) {
    const bool lat_lon_ok = !msg.dead_reckoning && msg.eph < HORIZONTAL_ACCURACY_THRESHOLD;
    const bool alt_ok = !msg.dead_reckoning && msg.epv < VERTICAL_ACCURACY_THRESHOLD;
    if (lat_lon_ok && alt_ok) return PositionFixState::BOTH_VALID;
    if (lat_lon_ok) return PositionFixState::LAT_LON_VALID;
    if (alt_ok) return PositionFixState::ALT_VALID;
    return PositionFixState::NO_FIX;
}

ArmingState DroneState::uint8_t_to_arming_state(uint8_t px4_arming_state) {
    switch (px4_arming_state) {
        case px4_msgs::msg::VehicleStatus::ARMING_STATE_DISARMED: return ArmingState::DISARMED;
        case px4_msgs::msg::VehicleStatus::ARMING_STATE_ARMED: return ArmingState::ARMED;
        default: return ArmingState::UNKNOWN;
    }
}

// Additional telemetry callbacks
void DroneState::battery_status_callback(const px4_msgs::msg::BatteryStatus::SharedPtr msg) {
    std::lock_guard<std::mutex> lock(battery_mutex_);
    
    battery_data_.voltage = msg->voltage_v;
    battery_data_.current = msg->current_a;
    battery_data_.remaining = msg->remaining;
    battery_data_.time_remaining = msg->time_remaining_s;
    battery_data_.temperature = msg->temperature;
    
    // Convert warning level
    switch (msg->warning) {
        case px4_msgs::msg::BatteryStatus::BATTERY_WARNING_NONE:
            battery_data_.warning = "NONE";
            break;
        case px4_msgs::msg::BatteryStatus::BATTERY_WARNING_LOW:
            battery_data_.warning = "LOW";
            break;
        case px4_msgs::msg::BatteryStatus::BATTERY_WARNING_CRITICAL:
            battery_data_.warning = "CRITICAL";
            break;
        case px4_msgs::msg::BatteryStatus::BATTERY_WARNING_EMERGENCY:
            battery_data_.warning = "EMERGENCY";
            break;
        default:
            battery_data_.warning = "UNKNOWN";
    }
    
    battery_data_.valid = true;
    battery_data_.timestamp = node_->get_clock()->now();
}

void DroneState::sensor_gps_callback(const px4_msgs::msg::SensorGps::SharedPtr msg) {
    std::lock_guard<std::mutex> lock(gps_mutex_);
    
    // Convert fix type
    switch (msg->fix_type) {
        case 0: gps_data_.fix_type = "NONE"; break;
        case 1: gps_data_.fix_type = "DEAD_RECKONING"; break;
        case 2: gps_data_.fix_type = "2D"; break;
        case 3: gps_data_.fix_type = "3D"; break;
        case 4: gps_data_.fix_type = "GNSS_DR"; break;
        case 5: gps_data_.fix_type = "RTK_FLOAT"; break;
        case 6: gps_data_.fix_type = "RTK_FIXED"; break;
        default: gps_data_.fix_type = "UNKNOWN";
    }
    
    gps_data_.satellites_used = msg->satellites_used;
    gps_data_.hdop = msg->hdop;
    gps_data_.vdop = msg->vdop;
    gps_data_.accuracy_horizontal = msg->eph;
    gps_data_.accuracy_vertical = msg->epv;
    gps_data_.jamming_detected = (msg->jamming_state == px4_msgs::msg::SensorGps::JAMMING_STATE_CRITICAL);
    gps_data_.spoofing_detected = (msg->spoofing_state == px4_msgs::msg::SensorGps::SPOOFING_STATE_INDICATED);
    
    gps_data_.valid = true;
    gps_data_.timestamp = node_->get_clock()->now();
}

void DroneState::failsafe_flags_callback(const px4_msgs::msg::FailsafeFlags::SharedPtr msg) {
    const bool rc_disabled = rc_input_disabled();
    const bool manual_lost = msg->manual_control_signal_lost && !rc_disabled;

    // Active PX4 failsafe conditions, named after FailsafeFlags.msg fields (px4_msgs release/1.15 lines 25-57).
    // Filtered: manual_control_signal_lost when stick input is disabled (COM_RC_IN_MODE=4, always set then);
    // auto_mission_missing (we do not use PX4 Mission mode); offboard_control_signal_lost outside OFFBOARD.
    std::vector<std::string> reasons;
    auto add = [&reasons](bool on, const char* name) { if (on) reasons.emplace_back(name); };
    add(msg->angular_velocity_invalid, "angular_velocity_invalid");
    add(msg->attitude_invalid, "attitude_invalid");
    add(msg->local_altitude_invalid, "local_altitude_invalid");
    add(msg->local_position_invalid, "local_position_invalid");
    add(msg->local_position_invalid_relaxed, "local_position_invalid_relaxed");
    add(msg->local_velocity_invalid, "local_velocity_invalid");
    add(msg->global_position_invalid, "global_position_invalid");
    add(msg->offboard_control_signal_lost && get_nav_state() == NavState::OFFBOARD, "offboard_control_signal_lost");
    add(msg->home_position_invalid, "home_position_invalid");
    add(manual_lost, "manual_control_signal_lost");
    add(msg->gcs_connection_lost, "gcs_connection_lost");
    add(msg->battery_warning != 0, "battery_warning");
    add(msg->battery_low_remaining_time, "battery_low_remaining_time");
    add(msg->battery_unhealthy, "battery_unhealthy");
    add(msg->geofence_breached, "geofence_breached");
    add(msg->mission_failure, "mission_failure");
    add(msg->wind_limit_exceeded, "wind_limit_exceeded");
    add(msg->flight_time_limit_exceeded, "flight_time_limit_exceeded");
    add(msg->local_position_accuracy_low, "local_position_accuracy_low");
    add(msg->fd_critical_failure, "fd_critical_failure");
    add(msg->fd_esc_arming_failure, "fd_esc_arming_failure");
    add(msg->fd_imbalanced_prop, "fd_imbalanced_prop");
    add(msg->fd_motor_failure, "fd_motor_failure");
    {
        std::lock_guard<std::mutex> lock(health_mutex_);
        health_.flags_valid = true;
        health_.failsafe_reasons = reasons;
        health_.local_position_invalid = msg->local_position_invalid;
        health_.global_position_invalid = msg->global_position_invalid;
        health_.home_position_invalid = msg->home_position_invalid;
        health_.battery_low_remaining_time = msg->battery_low_remaining_time;
        health_.battery_warning = msg->battery_warning;
    }

    std::lock_guard<std::mutex> lock(failsafe_mutex_);
    failsafe_data_.manual_control_lost = manual_lost;
    failsafe_data_.gcs_connection_lost = msg->gcs_connection_lost;
    failsafe_data_.geofence_breached = msg->geofence_breached;
    failsafe_data_.battery_warning = msg->battery_warning;
    failsafe_data_.battery_unhealthy = msg->battery_unhealthy;
    failsafe_data_.wind_limit_exceeded = msg->wind_limit_exceeded;
    failsafe_data_.flight_time_limit_exceeded = msg->flight_time_limit_exceeded;

    // Health score (0-100) over the checks below
    int issues = 0;
    const int total_checks = 7;
    if (manual_lost) issues++;
    if (msg->gcs_connection_lost) issues++;
    if (msg->geofence_breached) issues++;
    if (msg->battery_warning) issues++;
    if (msg->battery_unhealthy) issues++;
    if (msg->wind_limit_exceeded) issues++;
    if (msg->flight_time_limit_exceeded) issues++;
    failsafe_data_.system_health_score = ((total_checks - issues) * 100) / total_checks;

    failsafe_data_.active_warnings.clear();
    failsafe_data_.critical_failures.clear();
    if (msg->battery_warning) failsafe_data_.active_warnings.push_back("Battery warning");
    if (msg->battery_low_remaining_time) failsafe_data_.active_warnings.push_back("Battery low remaining flight time");
    if (msg->wind_limit_exceeded) failsafe_data_.active_warnings.push_back("Wind limit exceeded");
    if (msg->flight_time_limit_exceeded) failsafe_data_.active_warnings.push_back("Flight time limit exceeded");

    if (manual_lost) failsafe_data_.critical_failures.push_back("Manual control signal lost");
    if (msg->gcs_connection_lost) failsafe_data_.critical_failures.push_back("GCS connection lost");
    if (msg->geofence_breached) failsafe_data_.critical_failures.push_back("Geofence breached");
    if (msg->battery_unhealthy) failsafe_data_.critical_failures.push_back("Battery unhealthy");
    if (msg->local_position_invalid) failsafe_data_.critical_failures.push_back("Local position invalid");
    if (msg->global_position_invalid) failsafe_data_.critical_failures.push_back("Global position invalid");
    if (msg->fd_critical_failure) failsafe_data_.critical_failures.push_back("Critical failure (attitude/altitude limit)");
    if (msg->fd_motor_failure) failsafe_data_.critical_failures.push_back("Motor failure");

    failsafe_data_.valid = true;
    failsafe_data_.timestamp = node_->get_clock()->now();
}

DroneState::HealthData DroneState::get_health() const {
    std::lock_guard<std::mutex> lock(health_mutex_);
    return health_;
}

bool DroneState::rc_input_disabled() const {
    int mode = 4;
    node_->get_parameter("rc_input_mode", mode);
    return mode == 4;
}

void DroneState::update_home() {
    // Same rule as PX4 (Commander.cpp:1801): home follows the vehicle while disarmed and landed.
    if (get_arming_state() != ArmingState::DISARMED) return;
    if (!lat_lon_valid_.load(std::memory_order_relaxed) || !alt_valid_.load(std::memory_order_relaxed)) return;
    std::lock_guard<std::mutex> lock(home_mutex_);
    home_valid_ = true;
    home_lat_ = latest_lat_;
    home_lon_ = latest_lon_;
    home_alt_ = latest_alt_;
}

bool DroneState::get_home(double& lat, double& lon, float& alt_amsl) const {
    std::lock_guard<std::mutex> lock(home_mutex_);
    lat = home_lat_;
    lon = home_lon_;
    alt_amsl = home_alt_;
    return home_valid_;
}

bool DroneState::local_to_global(float north, float east, double& lat, double& lon) const {
    double ref_lat, ref_lon;
    {
        std::lock_guard<std::mutex> lock(home_mutex_);
        if (!ref_valid_) return false;
        ref_lat = ref_lat_ * M_PI / 180.0;
        ref_lon = ref_lon_ * M_PI / 180.0;
    }
    // PX4 MapProjection::reproject (src/lib/geo/geo.cpp:90-110), CONSTANTS_RADIUS_OF_EARTH = 6371000 (geo.h:57)
    constexpr double R = 6371000.0;
    const double x_rad = static_cast<double>(north) / R;
    const double y_rad = static_cast<double>(east) / R;
    const double c = std::sqrt(x_rad * x_rad + y_rad * y_rad);
    if (std::fabs(c) > 0) {
        const double sin_c = std::sin(c), cos_c = std::cos(c);
        const double sin_ref = std::sin(ref_lat), cos_ref = std::cos(ref_lat);
        lat = std::asin(cos_c * sin_ref + (x_rad * sin_c * cos_ref) / c) * 180.0 / M_PI;
        lon = (ref_lon + std::atan2(y_rad * sin_c, c * cos_ref * cos_c - x_rad * sin_ref * sin_c)) * 180.0 / M_PI;
    } else {
        lat = ref_lat * 180.0 / M_PI;
        lon = ref_lon * 180.0 / M_PI;
    }
    return true;
}

DroneState::TargetData DroneState::get_target() const {
    std::lock_guard<std::mutex> lock(home_mutex_);
    return target_;
}

bool DroneState::get_triplet_current(double& lat, double& lon, int64_t& rx_ns) const {
    std::lock_guard<std::mutex> lock(home_mutex_);
    lat = triplet_lat_;
    lon = triplet_lon_;
    rx_ns = triplet_rx_ns_;
    return triplet_rx_ns_ != 0;
}

// Telemetry getters
bool DroneState::get_battery_data(BatteryData& data) const {
    uint8_t flags_level = 0;
    {
        std::lock_guard<std::mutex> lock(health_mutex_);
        flags_level = health_.flags_valid ? health_.battery_warning : 0;
    }
    std::lock_guard<std::mutex> lock(battery_mutex_);
    data = battery_data_;
    data.warning = worst_battery_warning(data.warning, flags_level);
    return battery_data_.valid;
}

bool DroneState::get_gps_data(GpsData& data) const {
    std::lock_guard<std::mutex> lock(gps_mutex_);
    data = gps_data_;
    return gps_data_.valid;
}

bool DroneState::get_failsafe_data(FailsafeData& data) const {
    std::lock_guard<std::mutex> lock(failsafe_mutex_);
    data = failsafe_data_;
    return failsafe_data_.valid;
}

bool DroneState::get_telemetry_data(TelemetryData& data) const {
    std::lock_guard<std::mutex> lock(telemetry_mutex_);
    data = telemetry_data_;
    return telemetry_data_.valid;
}

bool DroneState::get_wind_data(WindData& data) const {
    std::lock_guard<std::mutex> lock(wind_mutex_);
    data = wind_data_;
    return wind_data_.valid;
}

uint32_t DroneState::get_flight_time_elapsed() const {
    auto now = std::chrono::steady_clock::now();
    auto elapsed = std::chrono::duration_cast<std::chrono::seconds>(now - flight_start_time_);
    return static_cast<uint32_t>(elapsed.count());
}

void DroneState::publish_state() {
    drone_interfaces::msg::DroneState msg;

    msg.header.stamp = node_->get_clock()->now();
    msg.header.frame_id = "base_link";
    msg.drone_name = name_;

    // Position
    float x, y, z;
    msg.position_valid = get_latest_local_position(x, y, z);
    msg.local_x = x;
    msg.local_y = y;
    msg.local_z = z;
    msg.local_yaw = std::isnan(get_latest_local_yaw()) ? 0.0f : get_latest_local_yaw();
    msg.compass_heading = get_latest_compass_heading();

    // Velocity
    float vx, vy, vz;
    msg.velocity_valid = get_latest_local_velocity(vx, vy, vz);
    msg.velocity_x = vx;
    msg.velocity_y = vy;
    msg.velocity_z = vz;

    // State
    msg.nav_state = raw_nav_state_.load() == 255 ? nav_state_enum_to_string(get_nav_state()) : nav_state_name(raw_nav_state_.load());
    msg.arming_state = arming_state_enum_to_string(get_arming_state());
    msg.landing_state = landing_state_enum_to_string(get_landing_state());

    // Global position
    double lat, lon;
    float alt;
    msg.global_position_valid = get_latest_global_position(lat, lon, alt);
    msg.latitude = lat;
    msg.longitude = lon;
    msg.altitude = alt;

    // Battery
    BatteryData battery;
    if (get_battery_data(battery)) {
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

    // GPS
    GpsData gps;
    if (get_gps_data(gps)) {
        msg.gps_fix_type = gps.fix_type;
        msg.gps_satellites_used = gps.satellites_used;
        msg.gps_hdop = gps.hdop;
        msg.gps_vdop = gps.vdop;
        msg.gps_accuracy_horizontal = gps.accuracy_horizontal;
        msg.gps_accuracy_vertical = gps.accuracy_vertical;
        msg.gps_jamming_detected = gps.jamming_detected;
        msg.gps_spoofing_detected = gps.spoofing_detected;
    }

    // Failsafe
    FailsafeData failsafe;
    if (get_failsafe_data(failsafe)) {
        msg.system_health_score = failsafe.system_health_score;
        msg.active_warnings = failsafe.active_warnings;
        msg.critical_failures = failsafe.critical_failures;
        msg.can_arm = false;  // set from vehicle_status.pre_flight_checks_pass below
        msg.manual_control_lost = failsafe.manual_control_lost;
        msg.gcs_connection_lost = failsafe.gcs_connection_lost;
        msg.geofence_breached = failsafe.geofence_breached;
        msg.geofence_status = failsafe.geofence_breached ? "OUTSIDE" : "INSIDE";
    } else {
        msg.system_health_score = 0.0f;
        msg.can_arm = false;
        msg.geofence_status = "UNKNOWN";
    }

    // PX4-native health
    const HealthData h = get_health();
    msg.can_arm = h.status_valid && h.pre_flight_checks_pass;  // VehicleStatus.msg:138
    msg.failsafe = h.failsafe;
    msg.failsafe_reasons = h.failsafe_reasons;
    msg.nav_state_user_intention = h.nav_state_user_intention;
    msg.battery_low_remaining_time = h.battery_low_remaining_time;
    msg.home_position_valid = h.flags_valid && !h.home_position_invalid;
    const AttitudeHealth ah = get_attitude_health();
    msg.roll_deg = ah.roll_deg;
    msg.pitch_deg = ah.pitch_deg;
    msg.position_trusted = ah.position_trusted;
    msg.estimator_warnings = ah.estimator_warnings;
    // rc_signal_*, telemetry_link_quality, packet_loss_rate, wind_*: not bridged on PX4 v1.15.4, left 0 (deprecated)

    // Flight time
    msg.altitude_rate = vz;
    msg.flight_time_elapsed = get_flight_time_elapsed();
    msg.flight_time_limit = 1800;

    const TargetData tg = get_target();
    msg.target_valid = tg.target_valid;
    msg.target_lat = tg.target_lat;
    msg.target_lon = tg.target_lon;
    msg.target_alt = tg.target_alt;
    msg.target_type = tg.target_type;
    msg.target_loiter_radius = tg.target_loiter_radius;
    msg.next_valid = tg.next_valid;
    msg.next_lat = tg.next_lat;
    msg.next_lon = tg.next_lon;
    state_pub_->publish(msg);
}


// ---------------------------------------------------------------------------------------------------------------
// attitude + EKF position health
// ---------------------------------------------------------------------------------------------------------------
void DroneState::vehicle_attitude_callback(const px4_msgs::msg::VehicleAttitude::SharedPtr msg) {
    // VehicleAttitude.msg: q = rotation FRD body -> NED, Hamilton [w, x, y, z]. ZYX Euler (as matrix::Eulerf).
    const float w = msg->q[0], x = msg->q[1], y = msg->q[2], z = msg->q[3];
    if (!std::isfinite(w) || !std::isfinite(x) || !std::isfinite(y) || !std::isfinite(z)) {
        return;
    }
    constexpr float kRadToDeg = 57.29577951f;
    const float roll = std::atan2(2.0f * (w * x + y * z), 1.0f - 2.0f * (x * x + y * y));
    const float pitch = std::asin(std::clamp(2.0f * (w * y - z * x), -1.0f, 1.0f));
    std::lock_guard<std::mutex> lock(att_mutex_);
    roll_deg_ = roll * kRadToDeg;
    pitch_deg_ = pitch * kRadToDeg;
}

void DroneState::estimator_flags_callback(const px4_msgs::msg::EstimatorStatusFlags::SharedPtr m) {
    // Field lines: px4_msgs release/1.15 msg/EstimatorStatusFlags.msg
    std::vector<std::string> w;
    const bool dead_reckoning = m->cs_inertial_dead_reckoning || m->cs_wind_dead_reckoning;           // :36, :37
    const bool aiding = m->cs_gps || m->cs_ev_pos || m->cs_opt_flow || m->cs_aux_gpos;              // :9, :19, :10, :45
    const bool gps_rejected = m->cs_gps && (m->reject_hor_pos || m->reject_hor_vel);               // :67, :65
    if (dead_reckoning) w.push_back("dead_reckoning");
    if (!aiding && !m->cs_fake_pos) w.push_back("no_position_aiding");
    if (gps_rejected) w.push_back("gps_glitch");
    if (m->reject_ver_pos) w.push_back("height_rejected");                                           // :68
    if (!m->cs_tilt_align) w.push_back("tilt_not_aligned");                                          // :7
    if (!m->cs_yaw_align) w.push_back("yaw_not_aligned");                                            // :8
    if (m->reject_yaw) w.push_back("heading_rejected");                                              // :69
    if (m->cs_mag_fault) w.push_back("mag_fault");                                                   // :25
    if (m->cs_mag_field_disturbed) w.push_back("mag_interference");                                  // :23
    if (m->fs_bad_mag_x || m->fs_bad_mag_y || m->fs_bad_mag_z || m->fs_bad_hdg || m->fs_bad_mag_decl)
        w.push_back("mag_fusion_error");                                                             // :49-53
    if (m->fs_bad_acc_clipping) w.push_back("accel_clipping");                                       // :60
    if (m->fs_bad_acc_bias) w.push_back("accel_bias");                                               // :58
    if (m->fs_bad_acc_vertical) w.push_back("accel_vertical_bad");                                   // :59
    if (m->cs_gps_yaw_fault) w.push_back("gps_yaw_fault");                                           // :34
    if (m->cs_rng_fault) w.push_back("rangefinder_fault");                                           // :35
    const bool ok = m->cs_tilt_align && m->cs_yaw_align && aiding && !m->cs_fake_pos && !dead_reckoning &&
                    !m->reject_hor_pos;
    std::lock_guard<std::mutex> lock(att_mutex_);
    est_flags_valid_ = true;
    est_position_ok_ = ok;
    est_warnings_ = std::move(w);
    est_rx_ = std::chrono::steady_clock::now();
}

DroneState::AttitudeHealth DroneState::get_attitude_health() const {
    AttitudeHealth a;
    const HealthData h = get_health();   // health_mutex_ taken and released before att_mutex_
    std::lock_guard<std::mutex> lock(att_mutex_);
    a.roll_deg = roll_deg_;
    a.pitch_deg = pitch_deg_;
    // EKF2 publishes the flags at >= 1 Hz (EKF2.cpp:1851-1852); 3 s without them = stale
    const bool fresh = est_flags_valid_ &&
        std::chrono::duration<double>(std::chrono::steady_clock::now() - est_rx_).count() < 3.0;
    a.estimator_warnings = est_warnings_;
    if (!fresh) {
        a.estimator_warnings.push_back("estimator_stale");
    }
    // Commander's own verdict (failsafe_flags.global/local_position_invalid) also vetoes trust
    const bool commander_ok = !h.flags_valid || (!h.local_position_invalid && !h.global_position_invalid);
    a.position_trusted = fresh && est_position_ok_ && commander_ok;
    return a;
}
