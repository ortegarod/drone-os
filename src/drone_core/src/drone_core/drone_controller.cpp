/**
 * @file drone_controller.cpp
 * @brief Implementation of the DroneController class
 */

#include "drone_core/drone_controller.hpp"
#include <px4_msgs/srv/vehicle_command.hpp>
#include <functional> // Required for std::bind
#include <thread> // Required for std::this_thread::sleep_for
#include <cmath> // For std::sqrt, std::isnan

// Reported in /<drone>/capabilities. Package version + compile time of this file (UTC in the container).
#ifndef DRONE_CORE_BUILD
#define DRONE_CORE_BUILD "drone_core 0.0.1, compiled " __DATE__ " " __TIME__
#endif

using namespace px4_msgs::msg;
using namespace std::chrono_literals;
using std::placeholders::_1;
using std::placeholders::_2;
using std::placeholders::_3;

/**
 * @brief Constructs a new DroneController instance
 * 
 * Initializes the drone controller with ROS2 publishers and sets up initial state.
 * The drone starts in a connected state, ready for commands.
 * 
 * @param node Pointer to the ROS2 node
 * @param name Name of the drone
 * @param px4_namespace PX4 namespace for communication
 * @param mav_sys_id MAVLink System ID of the target PX4
 */
DroneController::DroneController(rclcpp::Node* node, const std::string& name, const std::string& px4_namespace, int mav_sys_id)
    : node_(node), name_(name), ns_(px4_namespace)
{
    RCLCPP_INFO(node_->get_logger(), "[%s][Controller] Constructing...", name_.c_str());
    drone_agent_ = std::make_unique<DroneAgent>(node_, ns_, name_, mav_sys_id);
    RCLCPP_INFO(node_->get_logger(), "[%s][Controller] DroneAgent created.", name_.c_str());
    offboard_control_ = std::make_unique<OffboardControl>(node_, ns_);
    RCLCPP_INFO(node_->get_logger(), "[%s][Controller] OffboardControl created.", name_.c_str());
    drone_state_ = std::make_unique<DroneState>(node_, ns_, name_); // Re-enabled DroneState
    RCLCPP_INFO(node_->get_logger(), "[%s][Controller] DroneState created.", name_.c_str());
    
    mission_manager_ = std::make_unique<drone_core::MissionManager>(node_, name_);
    mission_manager_->subscribe_px4_topics(ns_);
    mission_manager_->set_command_sender([this](uint16_t command, float p1, float p2, float p3) {
        drone_agent_->sendVehicleCommand(command, p1, p2,
            [this, command](uint8_t result) {
                RCLCPP_INFO(node_->get_logger(), "[%s][Mission] Vehicle command %u ack result %u", name_.c_str(), command, result);
            }, NAN, p3);
    });
    RCLCPP_INFO(node_->get_logger(), "[%s][Controller] MissionManager created.", name_.c_str());
    
    failsafe_monitor_ = std::make_unique<drone_core::FailsafeMonitor>(node_, ns_);
    RCLCPP_INFO(node_->get_logger(), "[%s][Controller] FailsafeMonitor created.", name_.c_str());
    
    RCLCPP_INFO(node_->get_logger(), "[%s][Controller] Drone components initialized. Creating services...", name_.c_str());

    takeoff_service_ = node_->create_service<std_srvs::srv::Trigger>(
        "/" + name_ + "/takeoff",
        std::bind(&DroneController::takeoff_callback, this, _1, _2, _3));
    RCLCPP_INFO(node_->get_logger(), "[%s][Controller] Offering service: %s", name_.c_str(), takeoff_service_->get_service_name());

    // Create SetPosition service
    set_position_service_ = node_->create_service<drone_interfaces::srv::SetPosition>(
        "/" + name_ + "/set_position",
        std::bind(&DroneController::set_position_callback, this, _1, _2, _3));
    RCLCPP_INFO(node_->get_logger(), "[%s][Controller] Offering service: %s", name_.c_str(), set_position_service_->get_service_name());

    // Create GetState service
    get_state_service_ = node_->create_service<drone_interfaces::srv::GetState>(
        "/" + name_ + "/get_state",
        std::bind(&DroneController::get_state_callback, this, _1, _2, _3));
    RCLCPP_INFO(node_->get_logger(), "[%s][Controller] Offering service: %s", name_.c_str(), get_state_service_->get_service_name());

    // Create Mission services
    upload_mission_service_ = node_->create_service<drone_interfaces::srv::UploadMission>(
        "/" + name_ + "/upload_mission",
        std::bind(&DroneController::upload_mission_callback, this, _1, _2, _3));
    RCLCPP_INFO(node_->get_logger(), "[%s][Controller] Offering service: %s", name_.c_str(), upload_mission_service_->get_service_name());

    mission_control_service_ = node_->create_service<drone_interfaces::srv::MissionControl>(
        "/" + name_ + "/mission_control",
        std::bind(&DroneController::mission_control_callback, this, _1, _2, _3));
    RCLCPP_INFO(node_->get_logger(), "[%s][Controller] Offering service: %s", name_.c_str(), mission_control_service_->get_service_name());

    get_mission_status_service_ = node_->create_service<drone_interfaces::srv::GetMissionStatus>(
        "/" + name_ + "/get_mission_status",
        std::bind(&DroneController::get_mission_status_callback, this, _1, _2, _3));
    RCLCPP_INFO(node_->get_logger(), "[%s][Controller] Offering service: %s", name_.c_str(), get_mission_status_service_->get_service_name());

    create_px4_action_services();
    create_ack_trigger_services();

    RCLCPP_INFO(node_->get_logger(), "[%s][Controller] All services created.", name_.c_str());

    // Set offboard control reference in mission manager for waypoint execution
    mission_manager_->set_offboard_control(offboard_control_.get());
    RCLCPP_INFO(node_->get_logger(), "[%s][Controller] Mission manager configured with offboard control.", name_.c_str());
    
    // Set drone state reference in mission manager for position-based waypoint completion
    mission_manager_->set_drone_state(drone_state_.get());
    RCLCPP_INFO(node_->get_logger(), "[%s][Controller] Mission manager configured with drone state feedback.", name_.c_str());

    // Final RTL/LAND mission items hand control back to PX4
    mission_manager_->set_mode_command_handler([this](uint16_t command) {
        if (command == VehicleCommand::VEHICLE_CMD_NAV_RETURN_TO_LAUNCH) {
            return_to_launch();
        } else {
            land();
        }
    });

    // Mission failure (timeout / OFFBOARD never engaged): hold where we are. Freeze the stream on the current
    // pose, then hand over to PX4 Hold; the OFFBOARD guard stops the stream once PX4 has switched.
    mission_manager_->set_failure_handler([this](const std::string& reason) {
        float cx, cy, cz;
        if (offboard_control_->is_active() && drone_state_->get_latest_local_position(cx, cy, cz)) {
            const float yaw = drone_state_->get_latest_local_yaw();
            offboard_control_->set_goto_target(cx, cy, cz, std::isnan(yaw) ? NAN : yaw, 1.0f, 1.0f);
        }
        if (get_nav_state() != NavState::OFFBOARD && offboard_control_->is_active()) {
            offboard_control_->stop();
        }
        RCLCPP_WARN(node_->get_logger(), "[%s][Controller] Mission failed (%s); switching to Hold.", name_.c_str(), reason.c_str());
        drone_agent_->sendVehicleCommandFull(VehicleCommand::VEHICLE_CMD_DO_SET_MODE, 1.0f, 4.0f, 3.0f, NAN, NAN, NAN, NAN,
            [this](uint8_t result) {
                if (result != 0) {
                    RCLCPP_ERROR(node_->get_logger(), "[%s][Controller] Hold after mission failure rejected (%u)", name_.c_str(), result);
                }
            });
    });

    setup_patrol_link();
    setup_capabilities();
    drone_agent_->set_effect_checker([this](const px4_msgs::msg::VehicleCommand& cmd) { return command_effect_seen(cmd); });
    post_flight_timer_ = node_->create_wall_timer(std::chrono::seconds(1), [this]() { post_flight_check(); });
    offboard_guard_timer_ = node_->create_wall_timer(std::chrono::milliseconds(50), [this]() { offboard_guard_check(); });
}

void DroneController::offboard_guard_check() {
    const NavState nav = get_nav_state();
    // Only act on a real OFFBOARD -> other transition. Before PX4 first enters OFFBOARD (set_offboard
    // pre-streams for ~1 s), the stream must keep running.
    if (last_nav_state_ == NavState::OFFBOARD && nav != NavState::OFFBOARD && nav != NavState::UNKNOWN) {
        if (offboard_control_->is_active()) {
            RCLCPP_WARN(node_->get_logger(), "[%s][Controller] PX4 left OFFBOARD; stopping offboard setpoints.", name_.c_str());
            offboard_control_->stop();
        }
        if (mission_manager_->get_mission_status().mission_running && !mission_manager_->is_delegated()) {
            RCLCPP_WARN(node_->get_logger(), "[%s][Controller] PX4 left OFFBOARD; aborting running mission.", name_.c_str());
            mission_manager_->fail_mission("PX4 left OFFBOARD (now " + nav_state_enum_to_string(nav) + ")", false);
        }
    }
    // In flight, stale local position (no PX4 data > 1 s) means drone_core is steering blind: stop the stream and
    // abort the mission so PX4's offboard-loss failsafe (COM_OBL_RC_ACT) takes over. On the ground, do nothing.
    if (get_arming_state() == ArmingState::ARMED && drone_state_->is_local_position_stale()) {
        if (offboard_control_->is_active()) {
            RCLCPP_WARN(node_->get_logger(), "[%s][Controller] Local position stale (>1 s) in flight; stopping offboard setpoints.", name_.c_str());
            offboard_control_->stop();
        }
        if (mission_manager_->get_mission_status().mission_running && !mission_manager_->is_delegated()) {
            RCLCPP_WARN(node_->get_logger(), "[%s][Controller] Local position stale (>1 s) in flight; aborting running mission.", name_.c_str());
            mission_manager_->fail_mission("local position stale (>1 s) in flight", false);
        }
    }
    if (nav != NavState::UNKNOWN) {
        last_nav_state_ = nav;
    }
}

void DroneController::post_flight_check() {
    mission_manager_->check_delegated(patrol_fresh());
    external_mode_recovery();
    // A setpoint stream that has run for 5 s without the vehicle arming (e.g. set_offboard followed by a
    // rejected arm) is stopped, so a later arm can never fly off toward a stale target.
    if (get_arming_state() == ArmingState::DISARMED && offboard_control_->is_active()) {
        if (++offboard_disarmed_ticks_ >= 5) {
            RCLCPP_WARN(node_->get_logger(), "[%s][Controller] Offboard stream running 5 s while disarmed; stopping it.", name_.c_str());
            offboard_control_->stop();
            offboard_disarmed_ticks_ = 0;
        }
    } else {
        offboard_disarmed_ticks_ = 0;
    }
    if (get_arming_state() != ArmingState::DISARMED || get_nav_state() != NavState::OFFBOARD ||
        offboard_control_->is_active()) {
        offboard_idle_ticks_ = 0;
        return;
    }
    // Require two consecutive ticks so we never race a set_offboard in progress
    if (++offboard_idle_ticks_ < 2 || !drone_agent_->is_service_ready()) {
        return;
    }
    offboard_idle_ticks_ = 0;
    RCLCPP_INFO(node_->get_logger(), "[%s][Controller] Disarmed in OFFBOARD with no setpoint stream; switching to Hold.", name_.c_str());
    // DO_SET_MODE: param1=custom mode enabled, param2=AUTO main mode, param3=LOITER sub mode
    drone_agent_->sendVehicleCommand(VehicleCommand::VEHICLE_CMD_DO_SET_MODE, 1.0f,
        static_cast<float>(static_cast<uint8_t>(Px4CustomMode::AUTO)),
        [this](uint8_t result) {
            if (result != 0) {
                RCLCPP_WARN(node_->get_logger(), "[%s][Controller] Post-flight switch to Hold rejected (Result: %d)", name_.c_str(), result);
            }
        }, NAN, 3.0f);
}

DroneController::~DroneController()
{
    RCLCPP_INFO(node_->get_logger(), "[%s][Controller] Destructor called", name_.c_str());
    // No thread management needed as agent_thread_ was removed
}

/**
 * @brief Sends an arm command to the drone
 * 
 * Uses the command relay to send a vehicle command to arm the drone.
 * The result is handled asynchronously through a callback.
 */
void DroneController::arm() {
    if (!drone_agent_->is_service_ready()) {
        RCLCPP_ERROR(node_->get_logger(), "[%s][Controller] Arm command failed: Agent service not ready.", name_.c_str());
        return;
    }
    drone_agent_->sendVehicleCommand(VehicleCommand::VEHICLE_CMD_COMPONENT_ARM_DISARM, 1.0f, 0.0f,
        [this](uint8_t result) {
            if (result == 0) {
                RCLCPP_INFO(node_->get_logger(), "[%s][Controller] Vehicle is armed (Ack)", name_.c_str());
            } else {
                RCLCPP_ERROR(node_->get_logger(), "[%s][Controller] Failed to arm (Ack)", name_.c_str());
            }
        });
    RCLCPP_INFO(node_->get_logger(), "[%s][Controller] Arm command sent", name_.c_str());
}

/**
 * @brief Sends a disarm command to the drone
 * 
 * Uses the command relay to send a vehicle command to disarm the drone.
 * The result is handled asynchronously through a callback.
 */
void DroneController::disarm() {
    if (!drone_agent_->is_service_ready()) {
        RCLCPP_ERROR(node_->get_logger(), "[%s][Controller] Disarm command failed: Agent service not ready.", name_.c_str());
        return;
    }
    drone_agent_->sendVehicleCommand(VehicleCommand::VEHICLE_CMD_COMPONENT_ARM_DISARM, 0.0f, 0.0f,
        [this](uint8_t result) {
            if (result == 0) {
                RCLCPP_INFO(node_->get_logger(), "[%s][Controller] Vehicle is disarmed (Ack)", name_.c_str());
            } else {
                RCLCPP_ERROR(node_->get_logger(), "[%s][Controller] Failed to disarm (Ack)", name_.c_str());
            }
        });
    RCLCPP_INFO(node_->get_logger(), "[%s][Controller] Disarm command sent", name_.c_str());
}

/**
 * @brief Sets the target position and yaw for the drone
 * 
 * Updates the internal target position and yaw values.
 * These values will be used in the next trajectory setpoint message.
 * 
 * @param x Target x position in meters
 * @param y Target y position in meters
 * @param z Target z position in meters (negative is up in NED frame)
 * @param yaw Target yaw angle in radians
 */
void DroneController::set_position(float x, float y, float z, float yaw) {
    target_x_ = x;
    target_y_ = y;
    target_z_ = z;
    target_yaw_ = yaw;
    // Delegate to OffboardControl to set target and manage publishing mode
    offboard_control_->set_target_position(x, y, z, yaw); 
}

// Added implementation for set_velocity
void DroneController::set_velocity(float vx, float vy, float vz, float yaw_rate) {
    // Delegate to OffboardControl to set target and manage publishing mode
    offboard_control_->set_target_velocity(vx, vy, vz, yaw_rate);
}

/**
 * @brief Commands the drone to land
 * 
 * Sends a command to initiate the landing sequence.
 * The result is handled asynchronously through a callback.
 */
void DroneController::land() {
    RCLCPP_INFO(node_->get_logger(), "[%s][Controller] Initiating landing sequence...", name_.c_str());
    if (!drone_agent_->is_service_ready()) {
        RCLCPP_ERROR(node_->get_logger(), "[%s][Controller] Land command failed: Agent service not ready.", name_.c_str());
        return;
    }

    // If currently in offboard mode, stop the offboard controller first
    if (get_nav_state() == NavState::OFFBOARD) {
        RCLCPP_INFO(node_->get_logger(), "[%s][Controller] Was in Offboard mode, stopping OffboardControl before landing.", name_.c_str());
        offboard_control_->stop();
    }

    // Simplest way is often to send the NAV_LAND command
    drone_agent_->sendVehicleCommand(VehicleCommand::VEHICLE_CMD_NAV_LAND, 0.0f, 0.0f,
        [this](uint8_t result) {
            if (result == 0) {
                RCLCPP_INFO(node_->get_logger(), "[%s][Controller] Landing sequence initiated (Ack)", name_.c_str());
            } else {
                RCLCPP_ERROR(node_->get_logger(), "[%s][Controller] Failed to initiate landing (Ack)", name_.c_str());
            }
        });
    RCLCPP_INFO(node_->get_logger(), "[%s][Controller] Land command sent via NAV_LAND", name_.c_str());
}

void DroneController::return_to_launch() {
    RCLCPP_INFO(node_->get_logger(), "[%s][Controller] Initiating return to launch...", name_.c_str());
    if (!drone_agent_->is_service_ready()) {
        RCLCPP_ERROR(node_->get_logger(), "[%s][Controller] Return to launch command failed: Agent service not ready.", name_.c_str());
        return;
    }

    // If currently in offboard mode, stop the offboard controller first
    if (get_nav_state() == NavState::OFFBOARD) {
        RCLCPP_INFO(node_->get_logger(), "[%s][Controller] Was in Offboard mode, stopping OffboardControl before RTL.", name_.c_str());
        offboard_control_->stop();
    }

    // Send the NAV_RETURN_TO_LAUNCH command
    drone_agent_->sendVehicleCommand(VehicleCommand::VEHICLE_CMD_NAV_RETURN_TO_LAUNCH, 0.0f, 0.0f,
        [this](uint8_t result) {
            if (result == 0) {
                RCLCPP_INFO(node_->get_logger(), "[%s][Controller] Return to launch initiated (Ack)", name_.c_str());
            } else {
                RCLCPP_ERROR(node_->get_logger(), "[%s][Controller] Failed to initiate return to launch (Ack)", name_.c_str());
            }
        });
    RCLCPP_INFO(node_->get_logger(), "[%s][Controller] Return to launch command sent via NAV_RETURN_TO_LAUNCH", name_.c_str());
}

void DroneController::flight_termination() {
    RCLCPP_WARN(node_->get_logger(), "[%s][Controller] EMERGENCY: Initiating flight termination...", name_.c_str());
    if (!drone_agent_->is_service_ready()) {
        RCLCPP_ERROR(node_->get_logger(), "[%s][Controller] Flight termination failed: Agent service not ready.", name_.c_str());
        return;
    }

    // Send the DO_FLIGHTTERMINATION command with param1 = 1.0 (activate termination)
    drone_agent_->sendVehicleCommand(VehicleCommand::VEHICLE_CMD_DO_FLIGHTTERMINATION, 1.0f, 0.0f,
        [this](uint8_t result) {
            if (result == 0) {
                RCLCPP_WARN(node_->get_logger(), "[%s][Controller] EMERGENCY: Flight termination activated (Ack)", name_.c_str());
            } else {
                RCLCPP_ERROR(node_->get_logger(), "[%s][Controller] EMERGENCY: Failed to activate flight termination (Ack)", name_.c_str());
            }
        });
    RCLCPP_WARN(node_->get_logger(), "[%s][Controller] EMERGENCY: Flight termination command sent via DO_FLIGHTTERMINATION", name_.c_str());
}

/**
 * @brief Sets the drone to altitude control mode
 * 
 * Sends a command to switch the drone to altitude control mode.
 * The result is handled asynchronously through a callback.
 */
void DroneController::set_altitude_mode() {
    // Now calls the internal helper with the correct mode enum
    set_mode(Px4CustomMode::ALTCTL);
}

/**
 * @brief Sets the drone to position control mode
 * 
 * Sends a command to switch the drone to position control mode.
 * The result is handled asynchronously through a callback.
 */
void DroneController::set_position_mode() {
    // Now calls the internal helper with the correct mode enum
    set_mode(Px4CustomMode::POSCTL); // Corrected from POSITION
}

/**
 * @brief Check if the drone is in offboard mode and armed
 * @return true if the drone is in offboard mode and armed
 */
bool DroneController::is_ready() const {
    // Check arming state and navigation state from DroneState
    bool is_armed = (this->get_arming_state() == ArmingState::ARMED);
    bool is_offboard = (this->get_nav_state() == NavState::OFFBOARD);
    return is_armed && is_offboard;
}

// Added getter implementation
NavState DroneController::get_nav_state() const {
    // Delegate to DroneState
    if (!drone_state_) { 
        // Should not happen if constructed properly
        RCLCPP_ERROR(node_->get_logger(), "[%s][Controller] DroneState not initialized!", name_.c_str());
        return NavState::UNKNOWN; 
    }
    return drone_state_->get_nav_state();
}

// Added getter implementation for ArmingState
ArmingState DroneController::get_arming_state() const {
    // Delegate to DroneState
    if (!drone_state_) { 
        RCLCPP_ERROR(node_->get_logger(), "[%s][Controller] DroneState not initialized!", name_.c_str());
        return ArmingState::UNKNOWN; 
    }
    return drone_state_->get_arming_state();
}

/**
 * @brief Initiates the takeoff sequence using offboard position control
 * 
 * Enters offboard mode and commands a position 10m above the current location.
 * Uses local NED coordinates (z negative = up) which avoids AMSL altitude issues.
 */
void DroneController::takeoff() {
    constexpr float default_takeoff_height = 10.0f;  // meters above current position

    RCLCPP_INFO(node_->get_logger(), "[%s][Controller] Initiating takeoff sequence (target: %.0fm above current)...", name_.c_str(), default_takeoff_height);

    // Get current position from drone state
    float cx, cy, cz;
    if (!drone_state_->get_latest_local_position(cx, cy, cz)) {
        RCLCPP_ERROR(node_->get_logger(), "[%s][Controller] Takeoff failed: no valid local position.", name_.c_str());
        return;
    }
    float cyaw = drone_state_->get_latest_local_yaw();
    float target_z = cz - default_takeoff_height;  // NED: more negative = higher

    RCLCPP_INFO(node_->get_logger(), "[%s][Controller] Current Z=%.1f, Target Z=%.1f (%.0fm up)",
        name_.c_str(), cz, target_z, default_takeoff_height);

    // Set target position — offboard control must already be running (call set_offboard first)
    offboard_control_->set_target_position(cx, cy, target_z, cyaw);

    RCLCPP_INFO(node_->get_logger(), "[%s][Controller] Takeoff target set: hold X=%.1f Y=%.1f, climb to Z=%.1f",
        name_.c_str(), cx, cy, target_z);
}

// --- Private Helper Methods ---

/**
 * @brief Internal helper to send a VEHICLE_CMD_DO_SET_MODE command
 * @param mode The target Px4CustomMode enum value
 */
void DroneController::set_mode(Px4CustomMode mode) {
    if (mode == Px4CustomMode::UNKNOWN) {
        RCLCPP_WARN(node_->get_logger(), "[%s][Controller] Attempted to set UNKNOWN mode.", name_.c_str());
        return;
    }

    if (!drone_agent_->is_service_ready()) {
        RCLCPP_ERROR(node_->get_logger(), "[%s][Controller] Set Mode command failed: Agent service not ready.", name_.c_str());
        return;
    }

    // If currently in offboard and requesting a DIFFERENT mode, stop OffboardControl first.
    // Assumes Px4CustomMode::OFFBOARD exists and corresponds to NavState::OFFBOARD logic.
    if (get_nav_state() == NavState::OFFBOARD && mode != Px4CustomMode::OFFBOARD) {
        RCLCPP_INFO(node_->get_logger(), "[%s][Controller] Was in Offboard mode, stopping OffboardControl before changing mode.", name_.c_str());
        offboard_control_->stop();
    }

    // param1 = 1.0f enables custom mode
    // param2 = float representation of the Px4CustomMode enum value
    float param1 = 1.0f;
    float param2 = static_cast<float>(static_cast<uint8_t>(mode));
    std::string mode_str = px4_custom_mode_to_string(mode);

    RCLCPP_INFO(node_->get_logger(), "[%s][Controller] Requesting set mode to %s (param2=%.1f)", name_.c_str(), mode_str.c_str(), param2);

    drone_agent_->sendVehicleCommand(VehicleCommand::VEHICLE_CMD_DO_SET_MODE, param1, param2,
        [this, mode_str](uint8_t result) {
            bool success = (result == 0);
            if (success) {
                RCLCPP_INFO(node_->get_logger(), "[%s][Controller] Set mode to %s acknowledged.", name_.c_str(), mode_str.c_str());
            } else {
                RCLCPP_ERROR(node_->get_logger(), "[%s][Controller] Failed to set mode to %s (Result: %d)", name_.c_str(), mode_str.c_str(), result);
            }
        });
}

// --- Synchronous Versions ---


bool DroneController::set_position_mode_sync(std::chrono::milliseconds timeout_ms) {
    return set_mode_sync(Px4CustomMode::POSCTL, timeout_ms); // Corrected from POSITION
}

bool DroneController::set_altitude_mode_sync(std::chrono::milliseconds timeout_ms) {
    return set_mode_sync(Px4CustomMode::ALTCTL, timeout_ms);
}

/**
 * @brief Internal helper to send VEHICLE_CMD_DO_SET_MODE and wait for acknowledgement.
 * @param mode The target Px4CustomMode enum value.
 * @param timeout_ms Maximum time to wait for acknowledgement.
 * @return true if command acknowledged successfully, false otherwise.
 */
bool DroneController::set_mode_sync(Px4CustomMode mode, std::chrono::milliseconds timeout_ms) {
    if (mode == Px4CustomMode::UNKNOWN) {
        RCLCPP_WARN(node_->get_logger(), "[%s][Controller] Attempted to set UNKNOWN mode synchronously.", name_.c_str());
        return false;
    }

    if (!drone_agent_->is_service_ready()) {
        RCLCPP_ERROR(node_->get_logger(), "[%s][Controller] Set Mode command failed: Agent service not ready.", name_.c_str());
        return false;
    }

    std::promise<bool> ack_promise;
    std::future<bool> ack_future = ack_promise.get_future();

    float param1 = 1.0f;
    float param2 = static_cast<float>(static_cast<uint8_t>(mode));
    std::string mode_str = px4_custom_mode_to_string(mode);

    RCLCPP_INFO(node_->get_logger(), "[%s][Controller] Requesting set mode to %s (param2=%.1f) [sync]", name_.c_str(), mode_str.c_str(), param2);

    drone_agent_->sendVehicleCommand(VehicleCommand::VEHICLE_CMD_DO_SET_MODE, param1, param2,
        // This callback executes in the ROS spin thread
        [this, mode_str, &ack_promise](uint8_t result) { 
            bool success = (result == 0);
            if (success) {
                RCLCPP_INFO(node_->get_logger(), "[%s][Controller] Set mode to %s acknowledged [sync].", name_.c_str(), mode_str.c_str());
            } else {
                RCLCPP_ERROR(node_->get_logger(), "[%s][Controller] Failed to set mode to %s [sync] (Result: %d)", name_.c_str(), mode_str.c_str(), result);
            }
            // Set the promise value, which unblocks the future.get() in the calling thread
            try {
              ack_promise.set_value(success);
            } catch (const std::future_error& e) {
                // This can happen if the future is waited upon multiple times or promise is set twice
                RCLCPP_ERROR(node_->get_logger(), "[%s][Controller] Promise error setting value for mode %s: %s", name_.c_str(), mode_str.c_str(), e.what());
            }
        });

    // Wait for the future, blocking the *calling* thread (e.g., main or script thread)
    auto future_status = ack_future.wait_for(timeout_ms);
    if (future_status == std::future_status::ready) {
        return ack_future.get(); // Return the boolean result from the promise
    } else {
        RCLCPP_WARN(node_->get_logger(), "[%s][Controller] Timed out waiting for %s mode acknowledgement.", name_.c_str(), mode_str.c_str());
        return false; // Timed out or other error
    }
}

// --- Service Callback Implementations (Added) ---

// Added arm_callback implementation
void DroneController::arm_callback(
    const std::shared_ptr<rmw_request_id_t> /*request_header*/,
    const std::shared_ptr<std_srvs::srv::Trigger::Request> /*request*/,
    std::shared_ptr<std_srvs::srv::Trigger::Response> response)
{
    RCLCPP_INFO(node_->get_logger(), "[%s][Controller] Arm service called", name_.c_str());
    
    // Pre-condition checks
    if (get_arming_state() == ArmingState::ARMED) {
        RCLCPP_WARN(node_->get_logger(), "[%s][Controller] Arm rejected: Drone is already armed.", name_.c_str());
        response->success = false;
        response->message = "Drone is already armed";
        return;
    }

    // Add any other checks (e.g., minimum battery, system health)

    try {
        this->arm(); // Call the existing internal method
        response->success = true;
        response->message = "Arm command initiated";
        // Note: Success here means the command was sent. Confirmation comes via state updates.
    } catch (const std::exception& e) {
        RCLCPP_ERROR(node_->get_logger(), "[%s][Controller] Exception during arm command: %s", name_.c_str(), e.what());
        response->success = false;
        response->message = std::string("Exception during arm: ") + e.what();
    } 
}

void DroneController::takeoff_callback(
    const std::shared_ptr<rmw_request_id_t> /*request_header*/,
    const std::shared_ptr<std_srvs::srv::Trigger::Request> /*request*/,
    std::shared_ptr<std_srvs::srv::Trigger::Response> response)
{
    RCLCPP_INFO(node_->get_logger(), "[%s][Controller] Takeoff service called", name_.c_str());

    // Drone must be armed and in offboard mode
    if (get_arming_state() != ArmingState::ARMED) {
        RCLCPP_WARN(node_->get_logger(), "[%s][Controller] Takeoff rejected: Drone must be ARMED first.", name_.c_str());
        response->success = false;
        response->message = "Takeoff rejected: Drone must be ARMED first. Call set_offboard then arm first.";
        return;
    }
    if (get_nav_state() != NavState::OFFBOARD) {
        RCLCPP_WARN(node_->get_logger(), "[%s][Controller] Takeoff rejected: Must be in OFFBOARD mode.", name_.c_str());
        response->success = false;
        response->message = "Takeoff rejected: Must be in OFFBOARD mode. Call set_offboard first.";
        return;
    }
    
    try {
        this->takeoff();
        response->success = true;
        response->message = "Takeoff command initiated (offboard climb, default 10m)";
        RCLCPP_INFO(node_->get_logger(), "[%s][Controller] Takeoff command processed successfully.", name_.c_str());

    } catch (const std::exception& e) {
        RCLCPP_ERROR(node_->get_logger(), "[%s][Controller] Exception during takeoff command: %s", name_.c_str(), e.what());
        response->success = false;
        response->message = std::string("Exception during takeoff: ") + e.what();
    } 
}

void DroneController::land_callback(
    const std::shared_ptr<rmw_request_id_t> /*request_header*/,
    const std::shared_ptr<std_srvs::srv::Trigger::Request> /*request*/,
    std::shared_ptr<std_srvs::srv::Trigger::Response> response)
{
    RCLCPP_INFO(node_->get_logger(), "[%s][Controller] Land service called", name_.c_str());
    try {
        this->land(); // Call the existing internal method
        response->success = true;
        response->message = "Land command initiated";
    } catch (const std::exception& e) {
        RCLCPP_ERROR(node_->get_logger(), "[%s][Controller] Exception during land command: %s", name_.c_str(), e.what());
        response->success = false;
        response->message = std::string("Exception during land: ") + e.what();
    }
}

void DroneController::disarm_callback(
    const std::shared_ptr<rmw_request_id_t> /*request_header*/,
    const std::shared_ptr<std_srvs::srv::Trigger::Request> /*request*/,
    std::shared_ptr<std_srvs::srv::Trigger::Response> response)
{
    RCLCPP_INFO(node_->get_logger(), "[%s][Controller] Disarm service called", name_.c_str());
    // PX4 itself denies a non-forced disarm unless it detects the vehicle has landed.

    try {
        this->disarm(); // Call the existing internal method
        response->success = true;
        response->message = "Disarm command initiated";
    } catch (const std::exception& e) {
        RCLCPP_ERROR(node_->get_logger(), "[%s][Controller] Exception during disarm command: %s", name_.c_str(), e.what());
        response->success = false;
        response->message = std::string("Exception during disarm: ") + e.what();
    }
}

// Added set_offboard_callback implementation
void DroneController::set_offboard_callback(
    const std::shared_ptr<rmw_request_id_t> /*request_header*/,
    const std::shared_ptr<std_srvs::srv::Trigger::Request> /*request*/,
    std::shared_ptr<std_srvs::srv::Trigger::Response> response)
{
    RCLCPP_INFO(node_->get_logger(), "[%s][Controller] Set Offboard Mode service called", name_.c_str());
    
    try {
        // 1. Get current position and yaw from DroneState
        float current_x, current_y, current_z;
        bool pos_valid = drone_state_->get_latest_local_position(current_x, current_y, current_z);
        float current_yaw = drone_state_->get_latest_local_yaw(); // Returns NAN if invalid
        bool yaw_valid = !std::isnan(current_yaw);

        if (!pos_valid || !yaw_valid) {
            RCLCPP_ERROR(node_->get_logger(), "[%s][Controller] Set Offboard rejected: Cannot get valid current pose (PosValid:%d, YawValid:%d)", 
                         name_.c_str(), pos_valid, yaw_valid);
            response->success = false;
            response->message = "Cannot get valid current pose to initialize offboard";
            return;
        }
        
        RCLCPP_INFO(node_->get_logger(), "[%s][Controller] Current pose: X=%.2f, Y=%.2f, Z=%.2f, Yaw=%.2f", 
                    name_.c_str(), current_x, current_y, current_z, current_yaw);

        // 2. Set initial target to current pose
        RCLCPP_INFO(node_->get_logger(), "[%s][Controller] Setting initial offboard target to current pose.", name_.c_str());
        offboard_control_->set_target_position(current_x, current_y, current_z, current_yaw);

        // 3. Start the OffboardControl loop FIRST
        RCLCPP_INFO(node_->get_logger(), "[%s][Controller] Calling offboard_control_->start() to ensure heartbeat...", name_.c_str());
        offboard_control_->start(); 
        
        // 4. Add a delay to allow PX4 to register the stream before switching mode
        // Not a blocking sleep: blocking the (single-threaded) executor starves the position subscription, and in
        // flight the 1 s staleness guard then stops the stream before PX4 ever switches (found in batch 1 test).

        // 5. Send Offboard mode command 1.1 s later (PX4 needs the stream first), unless the stream was stopped meanwhile.
        run_after(std::chrono::milliseconds(1100), [this]() {
            if (!offboard_control_->is_active()) {
                RCLCPP_WARN(node_->get_logger(), "[%s][Controller] Offboard stream stopped before mode switch; not switching.", name_.c_str());
                return;
            }
            RCLCPP_INFO(node_->get_logger(), "[%s][Controller] Sending Offboard mode command.", name_.c_str());
            this->set_mode(Px4CustomMode::OFFBOARD);
        });
        response->success = true;
        response->message = "Set Offboard command initiated, target set to current pose";
        // Note: Success means the command was sent. Confirmation comes via state updates.
    } catch (const std::exception& e) {
        RCLCPP_ERROR(node_->get_logger(), "[%s][Controller] Exception during set_offboard command: %s", name_.c_str(), e.what());
        response->success = false;
        response->message = std::string("Exception during set_offboard: ") + e.what();
    } 
}

// Added set_position_mode_callback implementation
void DroneController::set_position_mode_callback(
    const std::shared_ptr<rmw_request_id_t> /*request_header*/,
    const std::shared_ptr<std_srvs::srv::Trigger::Request> /*request*/,
    std::shared_ptr<std_srvs::srv::Trigger::Response> response)
{
    RCLCPP_INFO(node_->get_logger(), "[%s][Controller] Set Position Mode service called", name_.c_str());
    
    // Pre-condition checks
    // Note: get_nav_state() returns NavState enum, check against NavState::POSCTL
    if (get_nav_state() == NavState::POSCTL) {
        RCLCPP_WARN(node_->get_logger(), "[%s][Controller] Set Position Mode rejected: Already in Position mode.", name_.c_str());
        response->success = false;
        response->message = "Already in Position mode";
        return;
    }
    // Reject if armed (safer not to change modes while armed?)
    if (get_arming_state() == ArmingState::ARMED) {
         RCLCPP_WARN(node_->get_logger(), "[%s][Controller] Set Position Mode rejected: Drone is armed.", name_.c_str());
         response->success = false;
         response->message = "Cannot change mode while armed";
         return;
    }

    try {
        // Use the internal helper method
        this->set_mode(Px4CustomMode::POSCTL); // Corrected from POSITION
        response->success = true;
        response->message = "Set Position Mode command initiated";
        // Note: Success means the command was sent. Confirmation comes via state updates.
    } catch (const std::exception& e) {
        RCLCPP_ERROR(node_->get_logger(), "[%s][Controller] Exception during set_position_mode command: %s", name_.c_str(), e.what());
        response->success = false;
        response->message = std::string("Exception during set_position_mode: ") + e.what();
    } 
}

void DroneController::return_to_launch_callback(
    const std::shared_ptr<rmw_request_id_t> /*request_header*/,
    const std::shared_ptr<std_srvs::srv::Trigger::Request> /*request*/,
    std::shared_ptr<std_srvs::srv::Trigger::Response> response)
{
    RCLCPP_INFO(node_->get_logger(), "[%s][Controller] Return to launch service called", name_.c_str());
    try {
        this->return_to_launch(); // Call the internal method
        response->success = true;
        response->message = "Return to launch command initiated";
    } catch (const std::exception& e) {
        RCLCPP_ERROR(node_->get_logger(), "[%s][Controller] Exception during return to launch command: %s", name_.c_str(), e.what());
        response->success = false;
        response->message = std::string("Exception during return to launch: ") + e.what();
    }
}

void DroneController::flight_termination_callback(
    const std::shared_ptr<rmw_request_id_t> /*request_header*/,
    const std::shared_ptr<std_srvs::srv::Trigger::Request> /*request*/,
    std::shared_ptr<std_srvs::srv::Trigger::Response> response)
{
    RCLCPP_WARN(node_->get_logger(), "[%s][Controller] EMERGENCY: Flight termination service called", name_.c_str());
    try {
        this->flight_termination(); // Call the internal method
        response->success = true;
        response->message = "EMERGENCY: Flight termination command initiated";
    } catch (const std::exception& e) {
        RCLCPP_ERROR(node_->get_logger(), "[%s][Controller] Exception during flight termination command: %s", name_.c_str(), e.what());
        response->success = false;
        response->message = std::string("Exception during flight termination: ") + e.what();
    }
}

// --- Added SetPosition Callback Implementation ---
void DroneController::set_position_callback(
    const std::shared_ptr<rmw_request_id_t> /*request_header*/,
    const std::shared_ptr<drone_interfaces::srv::SetPosition::Request> request,
    std::shared_ptr<drone_interfaces::srv::SetPosition::Response> response)
{
    RCLCPP_INFO(node_->get_logger(), "[%s][Controller] Set Position service called: X=%.2f, Y=%.2f, Z=%.2f, Yaw=%.2f", 
                name_.c_str(), request->x, request->y, request->z, request->yaw);

    // Basic check: Is the drone in offboard mode? 
    // You might want more sophisticated checks (e.g., is it armed? is it stable?)
    // Also accept while our offboard stream is running: set_offboard returns before PX4 reports
    // the OFFBOARD switch, and this only updates the target the stream publishes.
    if (get_nav_state() != NavState::OFFBOARD && !offboard_control_->is_active()) {
        RCLCPP_WARN(node_->get_logger(), "[%s][Controller] Set Position rejected: Drone is not in OFFBOARD mode.", name_.c_str());
        response->success = false;
        response->message = "Set Position rejected: Drone must be in OFFBOARD mode.";
        return;
    }

    try {
        // Call the internal method to update the target in OffboardControl
        this->set_position(request->x, request->y, request->z, request->yaw);
        response->success = true;
        response->message = "Set Position target updated";
    } catch (const std::exception& e) {
        RCLCPP_ERROR(node_->get_logger(), "[%s][Controller] Exception during set_position command: %s", name_.c_str(), e.what());
        response->success = false;
        response->message = std::string("Exception during set_position: ") + e.what();
    } 
}

// --- Added GetState Callback Implementation ---
void DroneController::get_state_callback(
    const std::shared_ptr<rmw_request_id_t> /*request_header*/,
    const std::shared_ptr<drone_interfaces::srv::GetState::Request> /*request*/,
    std::shared_ptr<drone_interfaces::srv::GetState::Response> response)
{
    RCLCPP_DEBUG(node_->get_logger(), "[%s][Controller] Get State service called", name_.c_str());

    try {
        // Get position data
        float local_x, local_y, local_z;
        bool position_valid = drone_state_->get_latest_local_position(local_x, local_y, local_z);
        
        response->local_x = local_x;
        response->local_y = local_y;
        response->local_z = local_z;
        response->position_valid = position_valid;

        // Get yaw
        float local_yaw = drone_state_->get_latest_local_yaw();
        response->local_yaw = std::isnan(local_yaw) ? 0.0f : local_yaw;

        // Get velocity data
        float velocity_x, velocity_y, velocity_z;
        bool velocity_valid = drone_state_->get_latest_local_velocity(velocity_x, velocity_y, velocity_z);
        
        response->velocity_x = velocity_x;
        response->velocity_y = velocity_y;
        response->velocity_z = velocity_z;
        response->velocity_valid = velocity_valid;

        // Get state information
        response->nav_state = drone_state_->get_raw_nav_state() == 255 ? nav_state_enum_to_string(drone_state_->get_nav_state())
                                                                       : drone_state_->nav_state_name(drone_state_->get_raw_nav_state());
        response->arming_state = arming_state_enum_to_string(drone_state_->get_arming_state());
        response->landing_state = landing_state_enum_to_string(drone_state_->get_landing_state());

        // Get global position data
        double latitude, longitude;
        float altitude;
        bool global_position_valid = drone_state_->get_latest_global_position(latitude, longitude, altitude);
        
        response->latitude = latitude;
        response->longitude = longitude;
        response->altitude = altitude;
        response->global_position_valid = global_position_valid;

        // Get battery data
        DroneState::BatteryData battery_data;
        bool battery_valid = drone_state_->get_battery_data(battery_data);
        response->battery_voltage = battery_data.voltage;
        response->battery_current = battery_data.current;
        response->battery_remaining = battery_data.remaining;
        response->battery_time_remaining = battery_data.time_remaining;
        response->battery_temperature = battery_data.temperature;
        response->battery_warning = battery_data.warning;
        response->battery_valid = battery_valid;

        // Get GPS data
        DroneState::GpsData gps_data;
        bool gps_valid = drone_state_->get_gps_data(gps_data);
        response->gps_fix_type = gps_data.fix_type;
        response->gps_satellites_used = gps_data.satellites_used;
        response->gps_hdop = gps_data.hdop;
        response->gps_vdop = gps_data.vdop;
        response->gps_accuracy_horizontal = gps_data.accuracy_horizontal;
        response->gps_accuracy_vertical = gps_data.accuracy_vertical;
        response->gps_jamming_detected = gps_data.jamming_detected;
        response->gps_spoofing_detected = gps_data.spoofing_detected;

        // Get failsafe/health data
        DroneState::FailsafeData failsafe_data;
        bool failsafe_valid = drone_state_->get_failsafe_data(failsafe_data);
        response->system_health_score = failsafe_data.system_health_score;
        response->active_warnings = failsafe_data.active_warnings;
        response->critical_failures = failsafe_data.critical_failures;
        // PX4-native health (vehicle_status / failsafe_flags)
        const DroneState::HealthData health = drone_state_->get_health();
        response->can_arm = health.status_valid && health.pre_flight_checks_pass;  // VehicleStatus.msg:138
        response->failsafe = health.failsafe;
        response->failsafe_reasons = health.failsafe_reasons;
        response->nav_state_user_intention = health.nav_state_user_intention;
        response->battery_low_remaining_time = health.battery_low_remaining_time;
        response->home_position_valid = health.flags_valid && !health.home_position_invalid;
        const DroneState::AttitudeHealth ah = drone_state_->get_attitude_health();
        response->roll_deg = ah.roll_deg;
        response->pitch_deg = ah.pitch_deg;
        response->position_trusted = ah.position_trusted;
        response->estimator_warnings = ah.estimator_warnings;
        const DroneState::TargetData tg = drone_state_->get_target();
        response->target_valid = tg.target_valid;
        response->target_lat = tg.target_lat;
        response->target_lon = tg.target_lon;
        response->target_alt = tg.target_alt;
        response->target_type = tg.target_type;
        response->target_loiter_radius = tg.target_loiter_radius;
        response->next_valid = tg.next_valid;
        response->next_lat = tg.next_lat;
        response->next_lon = tg.next_lon;
        response->manual_control_lost = failsafe_data.manual_control_lost;
        response->gcs_connection_lost = failsafe_data.gcs_connection_lost;
        response->geofence_breached = failsafe_data.geofence_breached;

        // rc_signal_*, telemetry_link_quality, packet_loss_rate, wind_*: not bridged on PX4 v1.15.4; left 0 (deprecated)

        // Get flight performance data
        response->altitude_rate = velocity_z; // Use velocity_z as altitude rate
        
        // Get safety status
        response->geofence_status = failsafe_data.geofence_breached ? "OUTSIDE" : "INSIDE";
        response->flight_time_elapsed = drone_state_->get_flight_time_elapsed();
        response->flight_time_limit = 1800; // 30 minutes default limit

        // Set success
        response->success = true;
        response->message = "State data retrieved successfully";

        RCLCPP_DEBUG(node_->get_logger(), 
                    "[%s][Controller] State: Pos(%.2f,%.2f,%.2f) Valid:%d, Armed:%s, Mode:%s", 
                    name_.c_str(), local_x, local_y, local_z, position_valid,
                    response->arming_state.c_str(), response->nav_state.c_str());

    } catch (const std::exception& e) {
        RCLCPP_ERROR(node_->get_logger(), "[%s][Controller] Exception during get_state: %s", name_.c_str(), e.what());
        response->success = false;
        response->message = std::string("Exception during get_state: ") + e.what();
    }
}

// Mission service callbacks
void DroneController::upload_mission_callback(const std::shared_ptr<rmw_request_id_t> /*request_header*/,
                                              const std::shared_ptr<drone_interfaces::srv::UploadMission::Request> request,
                                              std::shared_ptr<drone_interfaces::srv::UploadMission::Response> response)
{
    try {
        RCLCPP_INFO(node_->get_logger(), "[%s][Controller] Upload mission request: %zu waypoints", 
                    name_.c_str(), request->waypoints.size());

        const std::string busy = busy_reason("upload_mission");
        if (!busy.empty()) {
            response->success = false;
            response->mission_id = mission_manager_->get_mission_status().mission_id;
            response->cruise_speed_used = mission_manager_->get_cruise_speed();
            response->message = busy;
            RCLCPP_WARN(node_->get_logger(), "[%s][Controller] %s", name_.c_str(), busy.c_str());
            return;
        }
        uint32_t mission_id;
        bool success = mission_manager_->upload_mission(request->waypoints, mission_id, request->cruise_speed);
        
        response->success = success;
        response->mission_id = mission_id;
        response->cruise_speed_used = mission_manager_->get_cruise_speed();
        response->message = success ? "Mission uploaded successfully" : "Failed to upload mission";
        
        RCLCPP_INFO(node_->get_logger(), "[%s][Controller] Mission upload %s (ID: %u)", 
                    name_.c_str(), success ? "succeeded" : "failed", mission_id);

    } catch (const std::exception& e) {
        RCLCPP_ERROR(node_->get_logger(), "[%s][Controller] Exception during upload_mission: %s", name_.c_str(), e.what());
        response->success = false;
        response->message = std::string("Exception during upload_mission: ") + e.what();
        response->mission_id = 0;
    }
}

void DroneController::mission_control_callback(const std::shared_ptr<rmw_request_id_t> /*request_header*/,
                                               const std::shared_ptr<drone_interfaces::srv::MissionControl::Request> request,
                                               std::shared_ptr<drone_interfaces::srv::MissionControl::Response> response)
{
    try {
        RCLCPP_INFO(node_->get_logger(), "[%s][Controller] Mission control command: %s", 
                    name_.c_str(), request->command.c_str());

        bool success = false;
        std::string message;

        const std::string busy = request->command == "START" ? busy_reason("START") : std::string();
        if (!busy.empty()) {
            success = false;
            message = busy;
            RCLCPP_WARN(node_->get_logger(), "[%s][Controller] %s", name_.c_str(), busy.c_str());
        } else if (request->command == "START" || request->command == "RESUME") {
            const bool is_start = request->command == "START";
            const NavState nav = get_nav_state();
            const bool in_offboard = nav == NavState::OFFBOARD;
            const bool airborne = get_arming_state() == ArmingState::ARMED &&
                                  drone_state_->get_landing_state() == LandingState::AIRBORNE;
            float cx, cy, cz;
            uint8_t patrol_id = 0;
            if (patrol_available(patrol_id)) {
                // fly the mission in the PX4 external mode PATROL (from the air or from the ground)
                success = patrol_start(is_start, message);
            } else if (!in_offboard && !airborne) {
                success = false;
                message = std::string(is_start ? "START" : "RESUME") + " refused: PX4 is in " + nav_state_enum_to_string(nav) +
                          " and the vehicle is not airborne. Take off first (takeoff_to) or switch to OFFBOARD (set_offboard).";
            } else if (!in_offboard && !drone_state_->get_latest_local_position(cx, cy, cz)) {
                success = false;
                message = "Mission refused: no valid local position to engage OFFBOARD";
            } else {
                success = is_start ? mission_manager_->start_mission() : mission_manager_->resume_mission();
                if (!success) {
                    message = is_start ? "Failed to start mission (no valid mission uploaded?)" : "Failed to resume mission";
                } else if (in_offboard) {
                    message = is_start ? "Mission started" : "Mission resumed";
                } else {
                    // Airborne in a PX4 mode (e.g. Hold after takeoff_to): engage OFFBOARD ourselves. PX4 only accepts
                    // OFFBOARD with a live setpoint stream (offboardCheck.cpp:47-65, mode_requirements.cpp:132;
                    // user guide flight_modes/offboard.md:8,26), so stream first and switch 1.1 s later. The mission
                    // leg clock only starts once PX4 is in OFFBOARD; if PX4 never switches, the mission fails in 5 s.
                    offboard_control_->start();
                    run_after(std::chrono::milliseconds(1100), [this]() {
                        if (!offboard_control_->is_active() || !mission_manager_->get_mission_status().mission_running) {
                            return;
                        }
                        RCLCPP_INFO(node_->get_logger(), "[%s][Controller] Mission: switching PX4 to OFFBOARD.", name_.c_str());
                        this->set_mode(Px4CustomMode::OFFBOARD);
                    });
                    message = std::string(is_start ? "Mission started" : "Mission resumed") + "; switching PX4 from " +
                              nav_state_enum_to_string(nav) + " to OFFBOARD";
                }
            }
        } else if ((request->command == "PAUSE" || request->command == "STOP") &&
                   (mission_manager_->is_delegated() ||
                    (drone_state_->get_patrol_nav_state() != 0 &&
                     drone_state_->get_raw_nav_state() == drone_state_->get_patrol_nav_state()))) {
            // mission flown by PATROL -> stop tracking it here, then PX4 Hold (PATROL deactivates)
            const bool pause = request->command == "PAUSE";
            success = pause ? mission_manager_->pause_mission() : mission_manager_->stop_mission();
            if (drone_state_->get_patrol_nav_state() != 0 &&
                drone_state_->get_raw_nav_state() == drone_state_->get_patrol_nav_state()) {
                send_hold(pause ? "mission PAUSE" : "mission STOP");
                success = true;
            }
            message = success ? (pause ? "Mission paused (PX4 Hold)" : "Mission stopped (PX4 Hold)")
                              : (pause ? "Failed to pause mission" : "Failed to stop mission");
        } else if (request->command == "PAUSE") {
            success = mission_manager_->pause_mission();
            message = success ? "Mission paused" : "Failed to pause mission";
        } else if (request->command == "STOP") {
            success = mission_manager_->stop_mission();
            message = success ? "Mission stopped" : "Failed to stop mission";
        } else if (request->command == "CLEAR") {
            success = mission_manager_->clear_mission();
            message = success ? "Mission cleared" : "Failed to clear mission";
        } else if (request->command == "GOTO_ITEM") {
            success = mission_manager_->goto_mission_item(request->item_index);
            message = success ? "Going to mission item" : "Failed to go to mission item";
        } else {
            message = "Unknown mission command: " + request->command;
        }

        // Get current mission status
        auto status = mission_manager_->get_mission_status();
        
        response->success = success;
        response->message = message;
        response->current_item = status.current_item;
        response->total_items = status.total_items;

        RCLCPP_INFO(node_->get_logger(), "[%s][Controller] Mission control result: %s", 
                    name_.c_str(), message.c_str());

    } catch (const std::exception& e) {
        RCLCPP_ERROR(node_->get_logger(), "[%s][Controller] Exception during mission_control: %s", name_.c_str(), e.what());
        response->success = false;
        response->message = std::string("Exception during mission_control: ") + e.what();
        response->current_item = 0;
        response->total_items = 0;
    }
}

void DroneController::get_mission_status_callback(const std::shared_ptr<rmw_request_id_t> /*request_header*/,
                                                 const std::shared_ptr<drone_interfaces::srv::GetMissionStatus::Request> /*request*/,
                                                 std::shared_ptr<drone_interfaces::srv::GetMissionStatus::Response> response)
{
    try {
        auto status = mission_manager_->get_mission_status();
        
        response->success = true;
        response->message = "Mission status retrieved successfully";
        response->mission_valid = status.mission_valid;
        response->mission_finished = status.mission_finished;
        response->mission_running = status.mission_running;
        response->current_item = status.current_item;
        response->total_items = status.total_items;
        response->mission_id = status.mission_id;
        response->mission_progress = status.mission_progress;
        response->mission_failed = status.mission_failed;
        response->failure_reason = status.failure_reason;
        response->mission_paused = status.mission_paused;

        RCLCPP_DEBUG(node_->get_logger(), "[%s][Controller] Mission status: Valid:%d Running:%d Progress:%.1f%% (%u/%u)", 
                     name_.c_str(), status.mission_valid, status.mission_running, 
                     status.mission_progress * 100.0f, status.current_item, status.total_items);

    } catch (const std::exception& e) {
        RCLCPP_ERROR(node_->get_logger(), "[%s][Controller] Exception during get_mission_status: %s", name_.c_str(), e.what());
        response->success = false;
        response->message = std::string("Exception during get_mission_status: ") + e.what();
        response->mission_valid = false;
        response->mission_finished = false;
        response->mission_running = false;
        response->current_item = 0;
        response->total_items = 0;
        response->mission_id = 0;
        response->mission_progress = 0.0f;
    }
}

// Failsafe monitoring methods
const drone_core::FailsafeStatus& DroneController::getFailsafeStatus() const {
    return failsafe_monitor_->getStatus();
}

bool DroneController::isSafeForMission() const {
    return failsafe_monitor_->isSafeForMission();
}

std::string DroneController::getFailsafeDescription() const {
    return failsafe_monitor_->getFailsafeDescription();
}


// =====================================================================================================================
// PATROL external mode link (drone_patrol, px4-ros2-interface-lib 1.4.0)
// =====================================================================================================================
void DroneController::setup_patrol_link() {
    patrol_plan_pub_ = node_->create_publisher<drone_interfaces::msg::PatrolPlan>(
        "/" + name_ + "/patrol/plan", rclcpp::QoS(1).reliable().transient_local());
    patrol_status_sub_ = node_->create_subscription<drone_interfaces::msg::PatrolStatus>(
        "/" + name_ + "/patrol/status", rclcpp::QoS(10).reliable(),
        [this](const drone_interfaces::msg::PatrolStatus::SharedPtr msg) {
            bool was_registered = false;
            {
                std::lock_guard<std::mutex> lock(patrol_mutex_);
                was_registered = patrol_status_.registered;
                patrol_status_ = *msg;
                patrol_rx_ = std::chrono::steady_clock::now();
            }
            if (msg->registered && !was_registered) {
                RCLCPP_INFO(node_->get_logger(), "[%s][Controller] PATROL registered with PX4 as nav_state %u",
                            name_.c_str(), msg->nav_state);
            }
            if (msg->registered) {
                drone_state_->set_patrol_nav_state(msg->nav_state);
            }
            mission_manager_->apply_patrol_status(*msg);
        });
    RCLCPP_INFO(node_->get_logger(), "[%s][Controller] PATROL link: %s / %s", name_.c_str(),
                patrol_plan_pub_->get_topic_name(), patrol_status_sub_->get_topic_name());
}

// =====================================================================================================================
// one job per drone (onboard check) + capabilities topic
// =====================================================================================================================
std::string DroneController::busy_reason(const char* what) const {
    const auto s = mission_manager_->get_mission_status();
    if (!s.mission_running && !s.mission_paused) {
        return "";
    }
    char buf[240];
    std::snprintf(buf, sizeof(buf),
                  "%s refused: mission %u is %s (item %u of %u). One job per drone: STOP it first%s.",
                  what, s.mission_id, s.mission_running ? "running" : "paused", s.current_item, s.total_items,
                  s.mission_paused ? ", or RESUME it" : "");
    return buf;
}

namespace {
std::string json_escape(const std::string& in) {
    std::string out;
    for (char c : in) {
        if (c == '"' || c == '\\') { out += '\\'; out += c; }
        else if (static_cast<unsigned char>(c) < 0x20) { out += ' '; }
        else { out += c; }
    }
    return out;
}
}  // namespace

std::string DroneController::capabilities_json(bool with_stamp) const {
    // Small and NaN-free (rosbridge). Modes: onboard PX4 external modes drone_core can start (PATROL).
    std::string j = "{\"drone\":\"" + json_escape(name_) + "\",\"drone_core_build\":\"" DRONE_CORE_BUILD "\",\"modes\":[";
    drone_interfaces::msg::PatrolStatus s;
    const bool fresh = patrol_fresh(&s);
    bool seen;
    {
        std::lock_guard<std::mutex> lock(patrol_mutex_);
        seen = patrol_rx_ != std::chrono::steady_clock::time_point{};
    }
    if (seen) {
        const bool reg = s.registered && DroneState::is_external_nav_state(s.nav_state);
        j += "{\"name\":\"" + json_escape(s.mode_name.empty() ? std::string("PATROL") : s.mode_name) + "\"";
        j += ",\"nav_state\":" + (reg ? std::to_string(s.nav_state) : std::string("null"));
        j += ",\"registered\":" + std::string(reg ? "true" : "false");
        j += ",\"heartbeat_fresh\":" + std::string(fresh ? "true" : "false");
        j += ",\"version\":null}";   // drone_patrol does not report a version (PatrolStatus has no field)
    }
    j += "]";
    if (with_stamp) {
        j += ",\"stamp\":" + std::to_string(node_->get_clock()->now().seconds());
    }
    return j + "}";
}

void DroneController::publish_capabilities(bool force) {
    const std::string content = capabilities_json(false);
    const auto now = std::chrono::steady_clock::now();
    if (!force && content == capabilities_last_ && now - capabilities_sent_ < std::chrono::seconds(5)) {
        return;
    }
    if (content != capabilities_last_) {
        RCLCPP_INFO(node_->get_logger(), "[%s][Controller] capabilities: %s", name_.c_str(), content.c_str());
    }
    capabilities_last_ = content;
    capabilities_sent_ = now;
    std_msgs::msg::String m;
    m.data = capabilities_json(true);
    capabilities_pub_->publish(m);
}

void DroneController::setup_capabilities() {
    capabilities_pub_ = node_->create_publisher<std_msgs::msg::String>(
        "/" + name_ + "/capabilities", rclcpp::QoS(1).reliable().transient_local());
    // Checked every 1 s: published at once on change, otherwise every 5 s.
    capabilities_timer_ = node_->create_wall_timer(std::chrono::seconds(1), [this]() { publish_capabilities(false); });
    publish_capabilities(true);
}

bool DroneController::patrol_fresh(drone_interfaces::msg::PatrolStatus* out) const {
    std::lock_guard<std::mutex> lock(patrol_mutex_);
    if (patrol_rx_ == std::chrono::steady_clock::time_point{}) {
        return false;
    }
    if (out) {
        *out = patrol_status_;
    }
    return std::chrono::duration<double>(std::chrono::steady_clock::now() - patrol_rx_).count() < PATROL_HEARTBEAT_TIMEOUT_S;
}

bool DroneController::patrol_available(uint8_t& nav_state) const {
    drone_interfaces::msg::PatrolStatus s;
    if (!patrol_fresh(&s) || !s.registered || !DroneState::is_external_nav_state(s.nav_state)) {
        return false;
    }
    nav_state = s.nav_state;
    return true;
}

void DroneController::send_hold(const std::string& why) {
    RCLCPP_INFO(node_->get_logger(), "[%s][Controller] %s: switching to Hold.", name_.c_str(), why.c_str());
    // DO_SET_MODE: param1=custom mode enabled, param2=AUTO (4), param3=LOITER (3)
    drone_agent_->sendVehicleCommandFull(VehicleCommand::VEHICLE_CMD_DO_SET_MODE, 1.0f, 4.0f, 3.0f, NAN, NAN, NAN, NAN,
        [this, why](uint8_t result) {
            if (result != 0) {
                RCLCPP_ERROR(node_->get_logger(), "[%s][Controller] Hold (%s) rejected (%u)", name_.c_str(), why.c_str(), result);
            }
        });
}

// START/RESUME via PATROL. Airborne: select PATROL, the executor goes straight to the patrol legs. On the ground:
// select PATROL, then arm; the executor takes off to the explicit altitude first (lib mode_executor.cpp:296-307).
bool DroneController::patrol_start(bool is_start, std::string& message) {
    uint8_t patrol_id = 0;
    if (!patrol_available(patrol_id)) {
        message = "PATROL not available";
        return false;
    }
    const bool armed = get_arming_state() == ArmingState::ARMED;
    const bool airborne = armed && drone_state_->get_landing_state() == LandingState::AIRBORNE;
    float cx, cy, cz;
    if (!drone_state_->get_latest_local_position(cx, cy, cz)) {
        message = "Mission refused: no valid local position";
        return false;
    }
    float home_alt = NAN;
    if (!airborne) {
        double hlat, hlon;
        if (!drone_state_->get_home(hlat, hlon, home_alt) || !std::isfinite(home_alt)) {
            message = "Mission refused: on the ground and no home position for the takeoff altitude";
            return false;
        }
    }
    drone_interfaces::msg::PatrolPlan plan;
    std::string why;
    if (!mission_manager_->start_delegated(!is_start, home_alt, plan, why)) {
        message = std::string(is_start ? "Failed to start mission: " : "Failed to resume mission: ") + why;
        return false;
    }
    if (offboard_control_->is_active()) {
        offboard_control_->stop();   // PATROL flies; drone_core's OFFBOARD stream must not linger
    }
    patrol_plan_pub_->publish(plan);
    // Give drone_patrol the plan before PX4 activates the mode (transient_local + 300 ms).
    run_after(std::chrono::milliseconds(300), [this, patrol_id, armed]() {
        if (!mission_manager_->get_mission_status().mission_running || !mission_manager_->is_delegated()) {
            return;
        }
        // VEHICLE_CMD_SET_NAV_STATE: param1 = nav_state (Commander.cpp:911-921)
        drone_agent_->sendVehicleCommand(VehicleCommand::VEHICLE_CMD_SET_NAV_STATE, static_cast<float>(patrol_id), 0.0f,
            [this, armed](uint8_t result) {
                if (result != 0) {
                    mission_manager_->fail_mission("PX4 rejected PATROL (result " + std::to_string(result) + ")", false);
                    return;
                }
                if (armed) {
                    return;
                }
                drone_agent_->sendVehicleCommand(VehicleCommand::VEHICLE_CMD_COMPONENT_ARM_DISARM, 1.0f, 0.0f,
                    [this](uint8_t arm_result) {
                        if (arm_result != 0) {
                            mission_manager_->fail_mission("arming for PATROL rejected (result " +
                                                           std::to_string(arm_result) + ")", true);
                        }
                    });
            });
    });
    char buf[200];
    if (airborne) {
        std::snprintf(buf, sizeof(buf), "Mission %s in PX4 PATROL mode from item %u",
                      is_start ? "started" : "resumed", plan.start_item);
    } else {
        std::snprintf(buf, sizeof(buf), "Mission %s in PX4 PATROL mode from item %u: arming, takeoff to %.1f m AMSL",
                      is_start ? "started" : "resumed", plan.start_item, plan.takeoff_altitude_amsl);
    }
    message = buf;
    return true;
}

// PX4 keeps a dead external mode while it is the user's intention (ModeManagement.cpp:400-406), which blocks arming.
// On the ground and disarmed with the user intention on an external mode whose heartbeat is gone (or can_arm false),
// switch to Hold after 3 consecutive 1 Hz ticks so the vehicle can arm again.
void DroneController::external_mode_recovery() {
    const uint8_t ui = drone_state_->get_raw_user_intention();
    const bool candidate = DroneState::is_external_nav_state(ui) && get_arming_state() == ArmingState::DISARMED &&
                           drone_state_->get_landing_state() != LandingState::AIRBORNE;
    if (!candidate) {
        external_stuck_ticks_ = 0;
        return;
    }
    uint8_t patrol_id = 0;
    const bool live = patrol_available(patrol_id) && patrol_id == ui;
    const auto health = drone_state_->get_health();
    const bool can_arm = health.status_valid && health.pre_flight_checks_pass;
    // After a PATROL mission's RTL lands and disarms, PX4 falls back to the user intention (PATROL) while disarmed.
    // Leave it only while a START is in progress (mission running: PATROL selected, arm pending).
    const bool idle_in_patrol = live && !mission_manager_->get_mission_status().mission_running;
    if (live && can_arm && !idle_in_patrol) {
        external_stuck_ticks_ = 0;
        return;
    }
    if (++external_stuck_ticks_ < 3) {
        return;
    }
    external_stuck_ticks_ = -5;   // retry at most every ~8 s
    send_hold(std::string("Landed/disarmed with ") + drone_state_->nav_state_name(ui) + " selected (" +
              (!live ? "mode not running" : (!can_arm ? "can_arm=false" : "no mission running")) + ")");
}

// what vehicle_status should show after a command PX4 did not ack. nav_state numbers:
// px4_msgs release/1.15 VehicleStatus.msg:34-55; custom modes: commander/px4_custom_mode.h:44-69.
int DroneController::command_effect_seen(const px4_msgs::msg::VehicleCommand& cmd) const {
    using VC = px4_msgs::msg::VehicleCommand;
    const uint8_t nav = drone_state_->get_raw_nav_state();
    const uint8_t ui = drone_state_->get_raw_user_intention();
    if (nav == 255) return 0;
    auto mode_is = [&](int want) { return (nav == want || ui == want) ? 1 : 0; };
    switch (cmd.command) {
        case VC::VEHICLE_CMD_COMPONENT_ARM_DISARM: {
            const bool want_armed = std::lround(cmd.param1) == 1;
            return (get_arming_state() == ArmingState::ARMED) == want_armed ? 1 : 0;
        }
        case VC::VEHICLE_CMD_NAV_TAKEOFF:          return mode_is(17);
        case VC::VEHICLE_CMD_NAV_LAND:             return mode_is(18);
        case VC::VEHICLE_CMD_NAV_RETURN_TO_LAUNCH: return mode_is(5);
        case VC::VEHICLE_CMD_DO_ORBIT:             return mode_is(21);
        case VC::VEHICLE_CMD_SET_NAV_STATE:        return mode_is(static_cast<int>(std::lround(cmd.param1)));
        case VC::VEHICLE_CMD_DO_REPOSITION: {
            // Hold (AUTO_LOITER) with the triplet target on the requested point (Commander.cpp DO_REPOSITION -> Navigator)
            if (!mode_is(4)) return 0;
            if (!std::isfinite(cmd.param5) || !std::isfinite(cmd.param6)) return 1;
            const DroneState::TargetData tg = drone_state_->get_target();
            if (!tg.target_valid) return 0;
            const double dn = (tg.target_lat - cmd.param5) * 111320.0;
            const double de = (tg.target_lon - cmd.param6) * 111320.0 * std::cos(cmd.param5 * M_PI / 180.0);
            return std::hypot(dn, de) < 1.0 ? 1 : 0;
        }
        case VC::VEHICLE_CMD_DO_SET_MODE: {
            const int main = static_cast<int>(std::lround(cmd.param2));
            const int sub = static_cast<int>(std::lround(cmd.param3));
            switch (main) {
                case 1: return mode_is(0);    // MANUAL
                case 2: return mode_is(1);    // ALTCTL
                case 3: return mode_is(2);    // POSCTL
                case 6: return mode_is(14);   // OFFBOARD
                case 4:                       // AUTO
                    switch (sub) {
                        case 2: return mode_is(17);   // TAKEOFF
                        case 3: return mode_is(4);    // LOITER (Hold)
                        case 4: return mode_is(3);    // MISSION
                        case 5: return mode_is(5);    // RTL
                        case 6: return mode_is(18);   // LAND
                        case 9: return mode_is(20);   // PRECLAND
                        default:
                            if (sub >= 11 && sub <= 18) return mode_is(23 + (sub - 11));   // EXTERNAL1..8
                            return -1;
                    }
                default: return -1;
            }
        }
        default: return -1;   // e.g. DO_FLIGHTTERMINATION: nothing safe to infer
    }
}
