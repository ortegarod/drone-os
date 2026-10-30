#include "drone_core/mission_manager.hpp"
#include "drone_core/offboard_control.hpp"
#include "drone_core/drone_state.hpp"
#include <chrono>
#include <thread>
#include <cmath>

using namespace std::chrono_literals;

namespace drone_core {

MissionManager::MissionManager(rclcpp::Node* node, const std::string& drone_namespace)
    : node_(node), namespace_(drone_namespace), next_mission_id_(1), offboard_control_(nullptr), drone_state_(nullptr) {
    
    waypoint_start_time_ = std::chrono::steady_clock::now();
    
    // Initialize publishers
    
    // PX4 subscriptions are created in subscribe_px4_topics() once the PX4 namespace is known.
    RCLCPP_INFO(node_->get_logger(), "MissionManager initialized for namespace: %s", namespace_.c_str());
}

void MissionManager::subscribe_px4_topics(const std::string& px4_namespace) {
    // px4_namespace is e.g. "/fmu/", "/px4_1/fmu/" (same convention as DroneState/DroneAgent).
    // Note: PX4 v1.15's default dds_topics.yaml does not export mission_result or navigator_mission_item,
    // so these stay silent unless PX4 is built with them added.
    mission_result_sub_ = node_->create_subscription<px4_msgs::msg::MissionResult>(
        px4_namespace + "out/mission_result", 10,
        std::bind(&MissionManager::mission_result_callback, this, std::placeholders::_1));
    mission_item_sub_ = node_->create_subscription<px4_msgs::msg::NavigatorMissionItem>(
        px4_namespace + "out/navigator_mission_item", 10,
        std::bind(&MissionManager::navigator_mission_item_callback, this, std::placeholders::_1));
    RCLCPP_INFO(node_->get_logger(), "[%s][Mission] Subscribed to %sout/mission_result and %sout/navigator_mission_item",
                namespace_.c_str(), px4_namespace.c_str(), px4_namespace.c_str());
}

MissionManager::~MissionManager() {
    // Clean shutdown
    if (mission_timer_) {
        mission_timer_->cancel();
    }
}

void MissionManager::set_offboard_control(::OffboardControl* offboard_control) {
    std::lock_guard<std::mutex> lock(status_mutex_);
    offboard_control_ = offboard_control;
}

void MissionManager::set_drone_state(::DroneState* drone_state) {
    std::lock_guard<std::mutex> lock(status_mutex_);
    drone_state_ = drone_state;
}

void MissionManager::set_mode_command_handler(std::function<void(uint16_t command)> handler) {
    std::lock_guard<std::mutex> lock(status_mutex_);
    mode_command_handler_ = std::move(handler);
}

bool MissionManager::upload_mission(const std::vector<drone_interfaces::msg::Waypoint>& waypoints, uint32_t& mission_id, float cruise_speed) {
    std::lock_guard<std::mutex> lock(status_mutex_);
    
    if (waypoints.empty()) {
        RCLCPP_ERROR(node_->get_logger(), "Cannot upload empty mission");
        return false;
    }
    
    // Assign mission ID
    mission_id = next_mission_id_++;
    
    // Debug: Log incoming waypoints before storage
    RCLCPP_INFO(node_->get_logger(), "📥 Uploading mission with %zu waypoints:", waypoints.size());
    for (size_t i = 0; i < waypoints.size(); ++i) {
        const auto& wp = waypoints[i];
        RCLCPP_INFO(node_->get_logger(), "  Waypoint %zu: lat=%.6f, lon=%.6f, alt=%.6f, yaw=%.6f, radius=%.2f", 
                   i, wp.latitude, wp.longitude, wp.altitude, wp.yaw, wp.acceptance_radius);
    }
    
    // Store mission locally
    current_mission_ = waypoints;
    delegated_ = false;
    mission_status_.mission_paused = false;
    cruise_speed_ = (cruise_speed > 0.0f) ? std::clamp(cruise_speed, MIN_CRUISE_SPEED, MAX_CRUISE_SPEED) : DEFAULT_CRUISE_SPEED;
    RCLCPP_INFO(node_->get_logger(), "[%s][Mission] Cruise speed %.1f m/s (requested %.1f)", namespace_.c_str(), cruise_speed_, cruise_speed);
    mission_status_.mission_id = mission_id;
    mission_status_.total_items = waypoints.size();
    mission_status_.mission_valid = true;
    mission_status_.mission_running = false;
    mission_status_.mission_finished = false;
    mission_status_.mission_failed = false;
    mission_status_.failure_reason.clear();
    mission_status_.current_item = 0;
    mission_status_.mission_progress = 0.0f;
    
    // Debug: Verify storage by reading back
    RCLCPP_INFO(node_->get_logger(), "💾 Mission stored locally - verifying storage:");
    for (size_t i = 0; i < current_mission_.size(); ++i) {
        const auto& wp = current_mission_[i];
        RCLCPP_INFO(node_->get_logger(), "  Stored waypoint %zu: lat=%.6f, lon=%.6f, alt=%.6f, yaw=%.6f, radius=%.2f", 
                   i, wp.latitude, wp.longitude, wp.altitude, wp.yaw, wp.acceptance_radius);
    }
    
    // Upload to PX4
    bool success = upload_mission_to_px4(waypoints);
    
    RCLCPP_INFO(node_->get_logger(), "Mission upload %s: %zu waypoints, ID: %u", 
                success ? "succeeded" : "failed", waypoints.size(), mission_id);
    
    return success;
}

bool MissionManager::start_mission() {
    std::lock_guard<std::mutex> lock(status_mutex_);
    
    if (!mission_status_.mission_valid) {
        RCLCPP_ERROR(node_->get_logger(), "No valid mission to start");
        return false;
    }
    
    if (mission_status_.mission_running) {
        RCLCPP_WARN(node_->get_logger(), "Mission already running");
        return true;
    }
    
    if (!offboard_control_) {
        RCLCPP_ERROR(node_->get_logger(), "No offboard control available for programmatic mission execution");
        return false;
    }
    
    // Start programmatic mission execution using offboard control
    delegated_ = false;
    mission_status_.mission_running = true;
    mission_status_.mission_paused = false;
    mission_status_.mission_finished = false;
    mission_status_.mission_failed = false;
    mission_status_.failure_reason.clear();
    mission_status_.current_item = 0;
    offboard_engaged_ = false;
    mission_start_time_ = std::chrono::steady_clock::now();
    
    // Create waypoint completion checker (1Hz - much more reasonable than 10Hz)
    mission_timer_ = node_->create_wall_timer(
        std::chrono::seconds(1),
        std::bind(&MissionManager::check_waypoint_completion, this));
    
    // Execute first waypoint immediately
    execute_current_waypoint();
    
    RCLCPP_INFO(node_->get_logger(), "Programmatic mission started (ID: %u) - Full DroneOS control", mission_status_.mission_id);
    return true;
}

bool MissionManager::pause_mission() {
    std::lock_guard<std::mutex> lock(status_mutex_);
    
    if (!mission_status_.mission_running) {
        RCLCPP_WARN(node_->get_logger(), "No active mission to pause");
        return false;
    }
    
    // Stop mission completion checker
    if (mission_timer_) {
        mission_timer_->cancel();
        mission_timer_.reset();
    }
    
    mission_status_.mission_running = false;
    mission_status_.mission_paused = true;
    hold_until_.reset();
    
    RCLCPP_INFO(node_->get_logger(), "[%s][Mission] Paused at item %u%s", namespace_.c_str(),
                mission_status_.current_item, delegated_ ? " (PATROL)" : "");
    return true;
}

bool MissionManager::resume_mission() {
    std::lock_guard<std::mutex> lock(status_mutex_);
    
    if (mission_status_.mission_running) {
        RCLCPP_WARN(node_->get_logger(), "Mission already running");
        return true;
    }
    
    if (!mission_status_.mission_valid || mission_status_.mission_finished) {
        RCLCPP_ERROR(node_->get_logger(), "No paused mission to resume");
        return false;
    }
    
    if (!offboard_control_) {
        RCLCPP_ERROR(node_->get_logger(), "No offboard control available for programmatic mission execution");
        return false;
    }
    
    // Resume programmatic mission execution (also retries a failed mission from its current item)
    delegated_ = false;
    mission_status_.mission_running = true;
    mission_status_.mission_paused = false;
    mission_status_.mission_failed = false;
    mission_status_.failure_reason.clear();
    offboard_engaged_ = false;
    mission_start_time_ = std::chrono::steady_clock::now();
    
    // Recreate waypoint completion checker
    mission_timer_ = node_->create_wall_timer(
        std::chrono::seconds(1),
        std::bind(&MissionManager::check_waypoint_completion, this));
    
    // Continue with current waypoint
    execute_current_waypoint();
    
    RCLCPP_INFO(node_->get_logger(), "Programmatic mission resumed");
    return true;
}

bool MissionManager::stop_mission() {
    std::lock_guard<std::mutex> lock(status_mutex_);
    
    if (!mission_status_.mission_running && !mission_status_.mission_valid) {
        RCLCPP_WARN(node_->get_logger(), "No mission to stop");
        return false;
    }
    
    // Stop mission completion checker
    if (mission_timer_) {
        mission_timer_->cancel();
        mission_timer_.reset();
    }
    
    mission_status_.mission_running = false;
    mission_status_.mission_finished = true;
    mission_status_.mission_paused = false;
    
    RCLCPP_INFO(node_->get_logger(), "Programmatic mission stopped");
    return true;
}

void MissionManager::fail_mission(const std::string& reason, bool request_hold) {
    std::unique_lock<std::mutex> lock(status_mutex_);
    fail_mission_locked(reason, request_hold, lock);
}

// request_hold=true only where drone_core still owns the vehicle (timeout, never engaged). When PX4 has left
// OFFBOARD or position is stale, PX4's own mode/failsafe is in charge and drone_core must not command anything.
void MissionManager::fail_mission_locked(const std::string& reason, bool request_hold, std::unique_lock<std::mutex>& lock) {
    if (!mission_status_.mission_running) {
        return;
    }
    if (mission_timer_) {
        mission_timer_->cancel();
        mission_timer_.reset();
    }
    mission_status_.mission_running = false;
    mission_status_.mission_finished = false;
    mission_status_.mission_failed = true;
    mission_status_.failure_reason = reason;
    RCLCPP_ERROR(node_->get_logger(), "[%s][Mission] FAILED at item %u: %s", namespace_.c_str(),
                 mission_status_.current_item, reason.c_str());
    auto handler = failure_handler_;
    lock.unlock();
    if (request_hold && handler) {
        handler(reason);
    }
}

bool MissionManager::clear_mission() {
    std::lock_guard<std::mutex> lock(status_mutex_);
    
    // Clear local mission data
    current_mission_.clear();
    mission_status_ = MissionStatus();  // Reset to default state
    
    RCLCPP_INFO(node_->get_logger(), "Mission cleared");
    return true;
}

bool MissionManager::goto_mission_item(uint16_t item_index) {
    std::lock_guard<std::mutex> lock(status_mutex_);
    
    if (!mission_status_.mission_valid) {
        RCLCPP_ERROR(node_->get_logger(), "No valid mission for goto command");
        return false;
    }
    
    if (item_index >= mission_status_.total_items) {
        RCLCPP_ERROR(node_->get_logger(), "Invalid mission item index: %u (max: %u)", 
                     item_index, mission_status_.total_items - 1);
        return false;
    }
    
    // Send goto mission item command
    send_vehicle_command(VEHICLE_CMD_MISSION_START, item_index, -1);
    
    mission_status_.current_item = item_index;
    update_mission_progress();
    
    RCLCPP_INFO(node_->get_logger(), "Going to mission item: %u", item_index);
    return true;
}

MissionStatus MissionManager::get_mission_status() const {
    std::lock_guard<std::mutex> lock(status_mutex_);
    return mission_status_;
}

void MissionManager::mission_result_callback(const px4_msgs::msg::MissionResult::SharedPtr msg) {
    std::lock_guard<std::mutex> lock(status_mutex_);
    
    RCLCPP_DEBUG(node_->get_logger(), "Mission result: finished=%d, current_seq=%u", 
                 msg->finished, msg->seq_current);
    
    mission_status_.mission_finished = msg->finished;
    mission_status_.current_item = msg->seq_current;
    
    if (msg->finished) {
        mission_status_.mission_running = false;
        mission_status_.mission_progress = 1.0f;
        RCLCPP_INFO(node_->get_logger(), "Mission completed successfully");
    } else {
        update_mission_progress();
    }
}

void MissionManager::navigator_mission_item_callback(const px4_msgs::msg::NavigatorMissionItem::SharedPtr msg) {
    std::lock_guard<std::mutex> lock(status_mutex_);
    
    // Update current mission item from navigator
    mission_status_.current_item = msg->sequence_current;
    update_mission_progress();
    
    RCLCPP_DEBUG(node_->get_logger(), "Navigator at mission item: %u", msg->sequence_current);
}

void MissionManager::send_vehicle_command(uint16_t command, float param1, float param2, 
                                         float param3, float param4) {
    if (!command_sender_) {
        RCLCPP_ERROR(node_->get_logger(), "[%s][Mission] No command sender wired; dropping vehicle command %u", namespace_.c_str(), command);
        return;
    }
    if (param4 != 0.0f) {
        RCLCPP_WARN(node_->get_logger(), "[%s][Mission] param4 not supported by DroneAgent path; ignored for command %u", namespace_.c_str(), command);
    }
    command_sender_(command, param1, param2, param3);
    
    RCLCPP_DEBUG(node_->get_logger(), "Sent vehicle command: %u (%.2f, %.2f, %.2f, %.2f)", 
                 command, param1, param2, param3, param4);
}

void MissionManager::send_mission_item(uint16_t seq, uint8_t frame, uint16_t command, uint8_t current, uint8_t autocontinue,
                                      float param1, float param2, float param3, float param4, 
                                      double param5, double param6, float param7) {
    px4_msgs::msg::VehicleCommand cmd{};
    cmd.timestamp = node_->get_clock()->now().nanoseconds() / 1000;
    cmd.command = MAV_CMD_MISSION_ITEM_INT;
    cmd.param1 = static_cast<float>(seq);      // sequence number
    cmd.param2 = static_cast<float>(frame);    // coordinate frame
    cmd.param3 = static_cast<float>(command);  // MAV_CMD
    cmd.param4 = static_cast<float>(current);  // current waypoint
    cmd.param5 = param5;  // latitude or local X
    cmd.param6 = param6;  // longitude or local Y
    cmd.param7 = param7;  // altitude or local Z
    // Never called. Previously published to a topic PX4 does not listen on, with target_system = 1.
    // Kept unsent: DroneAgent's path carries no param5/6, so a MISSION_ITEM_INT cannot go through it.
    (void)cmd; (void)autocontinue; (void)param1; (void)param2; (void)param3; (void)param4;
    RCLCPP_ERROR(node_->get_logger(), "[%s][Mission] send_mission_item is not supported", namespace_.c_str());
    return;
    RCLCPP_DEBUG(node_->get_logger(), "Sent mission item %u: cmd=%u frame=%u", seq, command, frame);
}

bool MissionManager::upload_mission_to_px4(const std::vector<drone_interfaces::msg::Waypoint>& waypoints) {
    // For programmatic execution, we store the mission locally and execute via offboard control
    // No need to upload to PX4's mission system - we have full programmatic control!
    
    RCLCPP_INFO(node_->get_logger(), "Mission stored for programmatic execution: %zu waypoints ready", 
                waypoints.size());
    
    return true;
}

void MissionManager::update_mission_progress() {
    if (mission_status_.total_items > 0) {
        mission_status_.mission_progress = 
            static_cast<float>(mission_status_.current_item) / mission_status_.total_items;
    }
}

void MissionManager::execute_current_waypoint() {
    if (!offboard_control_ || current_mission_.empty() || 
        mission_status_.current_item >= current_mission_.size()) {
        RCLCPP_WARN(node_->get_logger(), "execute_current_waypoint() aborted: offboard=%p, mission_size=%zu, current_item=%u", 
                   offboard_control_, current_mission_.size(), mission_status_.current_item);
        return;
    }
    
    const auto& waypoint = current_mission_[mission_status_.current_item];
    hold_until_.reset();

    // RTL/LAND items are handed to PX4 by check_waypoint_completion(), not flown as setpoints
    if (waypoint.command == VEHICLE_CMD_NAV_RETURN_TO_LAUNCH || waypoint.command == VEHICLE_CMD_NAV_LAND) {
        return;
    }
    
    // Debug: Log raw waypoint data from storage
    RCLCPP_INFO(node_->get_logger(), "🔍 Raw waypoint %u from storage: lat=%.6f, lon=%.6f, alt=%.6f, yaw=%.6f, radius=%.2f", 
               mission_status_.current_item, waypoint.latitude, waypoint.longitude, waypoint.altitude, waypoint.yaw, waypoint.acceptance_radius);
    
    // Convert waypoint to position command
    float x = waypoint.latitude;   // Using latitude field for local X
    float y = waypoint.longitude;  // Using longitude field for local Y  
    float z = waypoint.altitude;   // Altitude field for local Z
    float yaw = waypoint.yaw;
    
    // Debug: Log converted coordinates before sending to offboard control
    RCLCPP_INFO(node_->get_logger(), "🚀 Converted coordinates: X=%.6f, Y=%.6f, Z=%.6f, Yaw=%.6f", x, y, z, yaw);
    
    // Send position command via offboard control
    // Fly the leg with PX4 GotoSetpoint: PX4's GotoControl does jerk-limited smoothing using
    // MPC_ACC_HOR / MPC_JERK_AUTO, with speed limited to min(cruise_speed_, MPC_XY_CRUISE)
    // (PX4 v1.15.4 src/modules/mc_pos_control/GotoControl/GotoControl.cpp:163-205).
    float dist = 0.0f;
    float cx, cy, cz;
    if (drone_state_ && drone_state_->get_latest_local_position(cx, cy, cz)) {
        dist = std::sqrt((x - cx) * (x - cx) + (y - cy) * (y - cy) + (z - cz) * (z - cz));
        // Nose along the course (same rule as drone_patrol): NED heading = atan2(dEast, dNorth) from the
        // current position; legs with < 1 m horizontal travel keep the waypoint's yaw.
        if (std::hypot(x - cx, y - cy) >= 1.0f) {
            yaw = std::atan2(y - cy, x - cx);
        }
    }
    leg_expected_s_ = std::min(dist / cruise_speed_ + 10.0f, 300.0f);
    offboard_control_->set_goto_target(x, y, z, yaw, cruise_speed_, MAX_VERTICAL_SPEED);
    RCLCPP_INFO(node_->get_logger(), "[%s][Mission] Goto item %u: %.1f m at up to %.1f m/s",
                namespace_.c_str(), mission_status_.current_item, dist, cruise_speed_);
    waypoint_start_time_ = std::chrono::steady_clock::now();
    
    RCLCPP_INFO(node_->get_logger(), "✅ Executing waypoint %u: X=%.2f, Y=%.2f, Z=%.2f, Yaw=%.2f", 
                mission_status_.current_item, x, y, z, yaw);
}

void MissionManager::check_waypoint_completion() {
    std::unique_lock<std::mutex> lock(status_mutex_);
    
    if (!mission_status_.mission_running || current_mission_.empty()) {
        return;
    }

    // Final RTL/LAND item: finish the mission and let PX4 fly home/land on its own
    if (mission_status_.current_item < current_mission_.size()) {
        const uint16_t command = current_mission_[mission_status_.current_item].command;
        if (command == VEHICLE_CMD_NAV_RETURN_TO_LAUNCH || command == VEHICLE_CMD_NAV_LAND) {
            mission_status_.mission_running = false;
            mission_status_.mission_finished = true;
            mission_status_.mission_progress = 1.0f;
            if (mission_timer_) {
                mission_timer_->cancel();
                mission_timer_.reset();
            }
            RCLCPP_INFO(node_->get_logger(), "Mission item %u: handing over to PX4 (command %u)",
                        mission_status_.current_item, command);
            auto handler = mode_command_handler_;
            lock.unlock();
            if (handler) {
                handler(command);
            } else {
                RCLCPP_ERROR(node_->get_logger(), "No mode command handler set; drone will hold position");
            }
            return;
        }
    }
    
    if (mission_status_.current_item >= current_mission_.size()) {
        // Mission completed
        mission_status_.mission_running = false;
        mission_status_.mission_finished = true;
        mission_status_.mission_progress = 1.0f;
        
        // Stop the completion checker timer
        if (mission_timer_) {
            mission_timer_->cancel();
            mission_timer_.reset();
        }
        
        RCLCPP_INFO(node_->get_logger(), "Programmatic mission completed successfully!");
        return;
    }
    
    // Legs are only flown in OFFBOARD (PX4 uses our goto/trajectory setpoints only in OFFBOARD:
    // MulticopterPositionControl.cpp:385-389 runs GotoControl only with offboard position control enabled).
    // Do not run the leg clock or evaluate waypoints until PX4 is actually in OFFBOARD.
    if (drone_state_ && drone_state_->get_nav_state() != NavState::OFFBOARD) {
        if (!offboard_engaged_) {
            const float waited = std::chrono::duration<float>(std::chrono::steady_clock::now() - mission_start_time_).count();
            if (waited > OFFBOARD_ENGAGE_TIMEOUT_S) {
                fail_mission_locked("PX4 did not enter OFFBOARD within 5 s of START (nav_state " +
                                    nav_state_enum_to_string(drone_state_->get_nav_state()) + ")", true, lock);
            }
            return;
        }
        // Was engaged and PX4 left OFFBOARD: the controller's guard fails the mission; never advance here.
        return;
    }
    if (!offboard_engaged_) {
        offboard_engaged_ = true;
        waypoint_start_time_ = std::chrono::steady_clock::now();  // leg clock starts at OFFBOARD entry
        RCLCPP_INFO(node_->get_logger(), "[%s][Mission] PX4 in OFFBOARD; flying item %u", namespace_.c_str(),
                    mission_status_.current_item);
    }

    const auto& current_waypoint = current_mission_[mission_status_.current_item];
    auto elapsed = std::chrono::duration_cast<std::chrono::seconds>(
        std::chrono::steady_clock::now() - waypoint_start_time_).count();
    
    bool waypoint_reached = false;
    
    // Try position-based completion first (industry standard)
    if (drone_state_) {
        float current_x, current_y, current_z;
        bool position_valid = drone_state_->get_latest_local_position(current_x, current_y, current_z);
        
        if (position_valid) {
            // Target position from waypoint
            float target_x = current_waypoint.latitude;   // Using latitude field for local X
            float target_y = current_waypoint.longitude;  // Using longitude field for local Y  
            float target_z = current_waypoint.altitude;   // Altitude field for local Z
            
            // Calculate 3D distance to target
            float distance = std::sqrt(
                std::pow(current_x - target_x, 2) +
                std::pow(current_y - target_y, 2) +
                std::pow(current_z - target_z, 2)
            );
            
            float acceptance_radius = (current_waypoint.acceptance_radius > 0) ? 
                                    current_waypoint.acceptance_radius : WAYPOINT_ACCEPTANCE_RADIUS;
            
            if (distance <= acceptance_radius) {
                waypoint_reached = true;
                RCLCPP_INFO(node_->get_logger(), "Waypoint %u reached (distance: %.2f m, acceptance: %.2f m)", 
                           mission_status_.current_item, distance, acceptance_radius);
            } else {
                // Log progress for debugging every 5 seconds
                static auto last_log_time = std::chrono::steady_clock::now();
                auto now = std::chrono::steady_clock::now();
                auto time_since_log = std::chrono::duration_cast<std::chrono::seconds>(now - last_log_time).count();
                
                if (time_since_log >= 5) {
                    RCLCPP_INFO(node_->get_logger(), "Waypoint %u progress: distance %.2f m (target: %.2f m) - Current: (%.2f, %.2f, %.2f), Target: (%.2f, %.2f, %.2f)", 
                                mission_status_.current_item, distance, acceptance_radius,
                                current_x, current_y, current_z, target_x, target_y, target_z);
                    last_log_time = now;
                }
            }
        } else {
            RCLCPP_WARN_THROTTLE(node_->get_logger(), *node_->get_clock(), 5000, 
                                 "Position feedback not available, falling back to timeout");
        }
    }
    
    // Fallback timeout (safety mechanism). Expected time is computed once at leg start from the full leg
    // length and cruise speed; recomputing it from the remaining distance cut long legs short (T9/T9b).
    // A timeout is never "reached": the vehicle did not get there, so fail the mission and hold.
    if (!waypoint_reached) {
        const float expected_time = std::max(leg_expected_s_, 5.0f);
        if (elapsed >= static_cast<long>(expected_time * WAYPOINT_TIMEOUT_MULTIPLIER)) {
            char why[160];
            std::snprintf(why, sizeof(why), "waypoint %u not reached within %.0f s (timeout)",
                          mission_status_.current_item, expected_time * WAYPOINT_TIMEOUT_MULTIPLIER);
            fail_mission_locked(why, true, lock);
            return;
        }
    }
    
    if (waypoint_reached) {
        // Check if we need to hold at this waypoint
        if (current_waypoint.hold_time > 0.0f) {
            const auto now = std::chrono::steady_clock::now();
            if (!hold_until_) {
                hold_until_ = now + std::chrono::milliseconds(static_cast<int>(current_waypoint.hold_time * 1000));
                RCLCPP_INFO(node_->get_logger(), "Holding at waypoint for %.1f seconds", current_waypoint.hold_time);
            }
            if (now < *hold_until_) {
                return;
            }
        }
        
        // Advance to next waypoint
        mission_status_.current_item++;
        update_mission_progress();
        
        if (mission_status_.current_item < current_mission_.size()) {
            execute_current_waypoint();
            RCLCPP_INFO(node_->get_logger(), "Advancing to waypoint %u", mission_status_.current_item);
        } else {
            // Mission completed
            mission_status_.mission_running = false;
            mission_status_.mission_finished = true;
            mission_status_.mission_progress = 1.0f;
            
            // Stop the completion checker timer
            if (mission_timer_) {
                mission_timer_->cancel();
                mission_timer_.reset();
            }
            
            RCLCPP_INFO(node_->get_logger(), "Programmatic mission completed successfully!");
        }
    }
}


// ---------------------------------------------------------------------------------------------------------------
// delegation to the PX4 external mode PATROL (drone_patrol, px4-ros2-interface-lib 1.4.0)
// ---------------------------------------------------------------------------------------------------------------
bool MissionManager::start_delegated(bool resume, float home_alt_amsl, drone_interfaces::msg::PatrolPlan& plan,
                                     std::string& why) {
    std::lock_guard<std::mutex> lock(status_mutex_);
    if (!mission_status_.mission_valid || current_mission_.empty()) {
        why = "no valid mission uploaded";
        return false;
    }
    if (mission_status_.mission_running) {
        why = "mission already running";
        return false;
    }
    if (resume && mission_status_.mission_finished) {
        why = "mission already finished";
        return false;
    }
    const uint16_t start = resume ? mission_status_.current_item : 0;
    if (start >= current_mission_.size()) {
        why = "nothing left to fly";
        return false;
    }
    if (mission_timer_) {
        mission_timer_->cancel();
        mission_timer_.reset();
    }
    plan = drone_interfaces::msg::PatrolPlan();
    plan.stamp = node_->get_clock()->now();
    plan.mission_id = mission_status_.mission_id;
    plan.plan_seq = ++plan_seq_;
    plan.start_item = start;
    plan.cruise_speed = cruise_speed_;
    plan.max_vertical_speed = MAX_VERTICAL_SPEED;
    plan.timeout_multiplier = WAYPOINT_TIMEOUT_MULTIPLIER;
    for (const auto& wp : current_mission_) {
        drone_interfaces::msg::PatrolPoint p;
        p.command = wp.command;
        p.x = static_cast<float>(wp.latitude);    // local X (same convention as execute_current_waypoint)
        p.y = static_cast<float>(wp.longitude);   // local Y
        p.z = wp.altitude;                        // local Z (NED, negative up)
        p.yaw = wp.yaw;
        p.acceptance_radius = wp.acceptance_radius > 0.0f ? wp.acceptance_radius : WAYPOINT_ACCEPTANCE_RADIUS;
        p.hold_time = wp.hold_time;
        plan.points.push_back(p);
    }
    plan.takeoff_altitude_amsl = std::isfinite(home_alt_amsl) ? home_alt_amsl - plan.points[start].z : NAN;
    delegated_ = true;
    delegated_engaged_ = false;
    mission_status_.current_item = start;
    mission_status_.mission_running = true;
    mission_status_.mission_paused = false;
    mission_status_.mission_finished = false;
    mission_status_.mission_failed = false;
    mission_status_.failure_reason.clear();
    mission_start_time_ = std::chrono::steady_clock::now();
    RCLCPP_INFO(node_->get_logger(), "[%s][Mission] %s mission %u via PATROL from item %u (plan %u, %.1f m/s)",
                namespace_.c_str(), resume ? "Resuming" : "Starting", plan.mission_id, start, plan.plan_seq, cruise_speed_);
    return true;
}

void MissionManager::apply_patrol_status(const drone_interfaces::msg::PatrolStatus& s) {
    std::unique_lock<std::mutex> lock(status_mutex_);
    if (!delegated_ || s.plan_seq != plan_seq_ || s.mission_id != mission_status_.mission_id) {
        return;
    }
    if (!mission_status_.mission_running) {
        // paused/stopped/failed/finished: PATROL's DEACTIVATED is expected, and a restarted drone_patrol
        // re-reads the latched plan (transient_local) and reports its start item again: ignore both,
        // so current_item stays where the mission ended or paused.
        return;
    }
    if (s.current_item <= mission_status_.total_items) {
        mission_status_.current_item = s.current_item;
        if (mission_status_.total_items > 0) {
            mission_status_.mission_progress = static_cast<float>(s.current_item) / mission_status_.total_items;
        }
    }
    if (s.state == "TAKEOFF" || s.state == "PATROL") {
        delegated_engaged_ = true;
    }
    if (s.mission_failed) {
        fail_mission_locked("PATROL: " + s.failure_reason, false, lock);   // drone_patrol already switched to Hold
    } else if (s.mission_finished) {
        mission_status_.mission_running = false;
        mission_status_.mission_finished = true;
        mission_status_.mission_progress = 1.0f;
        RCLCPP_INFO(node_->get_logger(), "[%s][Mission] PATROL finished at item %u (%s)", namespace_.c_str(),
                    s.current_item, s.state.c_str());
    } else if (delegated_engaged_ && s.state == "DEACTIVATED") {
        // PX4 left PATROL. A user switch to Hold (e.g. from a GCS) pauses the mission; any other
        // mode change or a failsafe ends it. PX4 is in charge either way: command nothing.
        if (s.failure_reason == "mode changed" && drone_state_ &&
            drone_state_->get_nav_state() == NavState::AUTO_LOITER) {
            mission_status_.mission_running = false;
            mission_status_.mission_paused = true;
            RCLCPP_INFO(node_->get_logger(), "[%s][Mission] PX4 switched PATROL -> Hold: paused at item %u",
                        namespace_.c_str(), mission_status_.current_item);
        } else {
            fail_mission_locked("PX4 left PATROL (" + s.failure_reason + ")", false, lock);
        }
    }
}

void MissionManager::check_delegated(bool heartbeat_fresh) {
    std::unique_lock<std::mutex> lock(status_mutex_);
    if (!delegated_ || !mission_status_.mission_running) {
        return;
    }
    if (!heartbeat_fresh) {
        // PX4 detects the dead mode itself (3 x 300 ms, externalChecks.hpp:72-74) and fails safe; just record it.
        fail_mission_locked("PATROL heartbeat lost (drone_patrol not running)", false, lock);
        return;
    }
    const float waited = std::chrono::duration<float>(std::chrono::steady_clock::now() - mission_start_time_).count();
    if (!delegated_engaged_ && waited > OFFBOARD_ENGAGE_TIMEOUT_S) {
        fail_mission_locked("PX4 did not hand the mission to PATROL within 5 s of START", true, lock);
    }
}

} // namespace drone_core
