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
    vehicle_command_pub_ = node_->create_publisher<px4_msgs::msg::VehicleCommand>(
        "/" + namespace_ + "/fmu/in/vehicle_command", 10);
    
    // Initialize subscribers
    mission_result_sub_ = node_->create_subscription<px4_msgs::msg::MissionResult>(
        "/" + namespace_ + "/fmu/out/mission_result", 10,
        std::bind(&MissionManager::mission_result_callback, this, std::placeholders::_1));
    
    mission_item_sub_ = node_->create_subscription<px4_msgs::msg::NavigatorMissionItem>(
        "/" + namespace_ + "/fmu/out/navigator_mission_item", 10,
        std::bind(&MissionManager::navigator_mission_item_callback, this, std::placeholders::_1));
    
    RCLCPP_INFO(node_->get_logger(), "MissionManager initialized for namespace: %s", namespace_.c_str());
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

bool MissionManager::upload_mission(const std::vector<drone_interfaces::msg::Waypoint>& waypoints, uint32_t& mission_id) {
    std::lock_guard<std::mutex> lock(status_mutex_);
    
    if (waypoints.empty()) {
        RCLCPP_ERROR(node_->get_logger(), "Cannot upload empty mission");
        return false;
    }
    
    // Assign mission ID
    mission_id = next_mission_id_++;
    
    // Store mission locally
    current_mission_ = waypoints;
    mission_status_.mission_id = mission_id;
    mission_status_.total_items = waypoints.size();
    mission_status_.mission_valid = true;
    mission_status_.mission_running = false;
    mission_status_.mission_finished = false;
    mission_status_.current_item = 0;
    mission_status_.mission_progress = 0.0f;
    
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
    mission_status_.mission_running = true;
    mission_status_.mission_finished = false;
    mission_status_.current_item = 0;
    
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
    
    RCLCPP_INFO(node_->get_logger(), "Programmatic mission paused");
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
    
    // Resume programmatic mission execution
    mission_status_.mission_running = true;
    
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
    
    RCLCPP_INFO(node_->get_logger(), "Programmatic mission stopped");
    return true;
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
    px4_msgs::msg::VehicleCommand cmd{};
    cmd.timestamp = node_->get_clock()->now().nanoseconds() / 1000;
    cmd.command = command;
    cmd.param1 = param1;
    cmd.param2 = param2;
    cmd.param3 = param3;
    cmd.param4 = param4;
    cmd.target_system = 1;
    cmd.target_component = 1;
    cmd.source_system = 1;
    cmd.source_component = 1;
    cmd.from_external = true;
    
    vehicle_command_pub_->publish(cmd);
    
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
    cmd.target_system = 1;
    cmd.target_component = 1;
    cmd.source_system = 1;
    cmd.source_component = 1;
    cmd.from_external = true;
    
    vehicle_command_pub_->publish(cmd);
    
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
        return;
    }
    
    const auto& waypoint = current_mission_[mission_status_.current_item];
    
    // Convert waypoint to position command
    float x = waypoint.latitude;   // Using latitude field for local X
    float y = waypoint.longitude;  // Using longitude field for local Y  
    float z = waypoint.altitude;   // Altitude field for local Z
    float yaw = waypoint.yaw;
    
    // Send position command via offboard control
    offboard_control_->set_target_position(x, y, z, yaw);
    waypoint_start_time_ = std::chrono::steady_clock::now();
    
    RCLCPP_INFO(node_->get_logger(), "Executing waypoint %u: X=%.2f, Y=%.2f, Z=%.2f, Yaw=%.2f", 
                mission_status_.current_item, x, y, z, yaw);
}

void MissionManager::check_waypoint_completion() {
    std::lock_guard<std::mutex> lock(status_mutex_);
    
    if (!mission_status_.mission_running || current_mission_.empty()) {
        return;
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
                // Log progress for debugging
                RCLCPP_DEBUG(node_->get_logger(), "Waypoint %u progress: distance %.2f m (target: %.2f m)", 
                            mission_status_.current_item, distance, acceptance_radius);
            }
        } else {
            RCLCPP_WARN_THROTTLE(node_->get_logger(), *node_->get_clock(), 5000, 
                                 "Position feedback not available, falling back to timeout");
        }
    }
    
    // Fallback to adaptive timeout (safety mechanism)
    if (!waypoint_reached) {
        // Calculate expected time based on distance and typical drone speed
        float expected_time = 5.0f; // Default for safety
        if (drone_state_) {
            float current_x, current_y, current_z;
            if (drone_state_->get_latest_local_position(current_x, current_y, current_z)) {
                float target_x = current_waypoint.latitude;
                float target_y = current_waypoint.longitude;  
                float target_z = current_waypoint.altitude;
                
                float distance = std::sqrt(
                    std::pow(current_x - target_x, 2) +
                    std::pow(current_y - target_y, 2) +
                    std::pow(current_z - target_z, 2)
                );
                
                // Estimate time: distance / typical_speed + buffer
                float typical_speed = 3.0f; // m/s - conservative estimate
                expected_time = (distance / typical_speed) + 3.0f; // 3s buffer
                expected_time = std::max(expected_time, 5.0f); // Minimum 5s
                expected_time = std::min(expected_time, 30.0f); // Maximum 30s
            }
        }
        
        if (elapsed >= static_cast<long>(expected_time * WAYPOINT_TIMEOUT_MULTIPLIER)) {
            waypoint_reached = true;
            RCLCPP_WARN(node_->get_logger(), "Waypoint %u timeout reached (%.1f s), forcing advance", 
                       mission_status_.current_item, expected_time * WAYPOINT_TIMEOUT_MULTIPLIER);
        }
    }
    
    if (waypoint_reached) {
        // Check if we need to hold at this waypoint
        if (current_waypoint.hold_time > 0.0f) {
            RCLCPP_INFO(node_->get_logger(), "Holding at waypoint for %.1f seconds", current_waypoint.hold_time);
            std::this_thread::sleep_for(std::chrono::milliseconds(static_cast<int>(current_waypoint.hold_time * 1000)));
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

} // namespace drone_core