/**
 * @file drone_controller.cpp
 * @brief Implementation of the DroneController class
 */

#include "drone_core/drone_controller.hpp"
#include <px4_msgs/srv/vehicle_command.hpp>
#include <functional> // Required for std::bind
#include <thread> // Required for std::this_thread::sleep_for
#include <cmath> // For std::sqrt, std::isnan
// #include "drone_core/utils/state_enums.hpp" // Included via drone_controller.hpp

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
 */
DroneController::DroneController(rclcpp::Node* node, const std::string& name, const std::string& px4_namespace)
    : node_(node), name_(name), ns_(px4_namespace)
{
    RCLCPP_WARN(node_->get_logger(), "[%s][Controller] DEBUG: Skipping creation of Agent, OffboardControl", name_.c_str());
    drone_agent_ = std::make_unique<DroneAgent>(node_, ns_, name_);
    offboard_control_ = std::make_unique<OffboardControl>(node_, ns_);
    drone_state_ = std::make_unique<DroneState>(node_, ns_, name_); // Re-enabled DroneState
    
    RCLCPP_INFO(node_->get_logger(), "[%s][Controller] Drone connected and ready for commands (Agent/Offboard Skipped)", name_.c_str());

    // --- Create Services (Added) ---
    arm_service_ = node_->create_service<std_srvs::srv::Trigger>(
        "/" + name_ + "/arm",
        std::bind(&DroneController::arm_callback, this, _1, _2, _3));
    RCLCPP_INFO(node_->get_logger(), "[%s][Controller] Offering service: %s", name_.c_str(), arm_service_->get_service_name());

    takeoff_service_ = node_->create_service<std_srvs::srv::Trigger>(
        "/" + name_ + "/takeoff",
        std::bind(&DroneController::takeoff_callback, this, _1, _2, _3));
    RCLCPP_INFO(node_->get_logger(), "[%s][Controller] Offering service: %s", name_.c_str(), takeoff_service_->get_service_name());

    land_service_ = node_->create_service<std_srvs::srv::Trigger>(
        "/" + name_ + "/land",
        std::bind(&DroneController::land_callback, this, _1, _2, _3));
    RCLCPP_INFO(node_->get_logger(), "[%s][Controller] Offering service: %s", name_.c_str(), land_service_->get_service_name());

    disarm_service_ = node_->create_service<std_srvs::srv::Trigger>(
        "/" + name_ + "/disarm",
        std::bind(&DroneController::disarm_callback, this, _1, _2, _3));
    RCLCPP_INFO(node_->get_logger(), "[%s][Controller] Offering service: %s", name_.c_str(), disarm_service_->get_service_name());

    // Added mode setting services
    set_offboard_service_ = node_->create_service<std_srvs::srv::Trigger>(
        "/" + name_ + "/set_offboard",
        std::bind(&DroneController::set_offboard_callback, this, _1, _2, _3));
    RCLCPP_INFO(node_->get_logger(), "[%s][Controller] Offering service: %s", name_.c_str(), set_offboard_service_->get_service_name());

    set_position_mode_service_ = node_->create_service<std_srvs::srv::Trigger>(
        "/" + name_ + "/set_position_mode",
        std::bind(&DroneController::set_position_mode_callback, this, _1, _2, _3));
    RCLCPP_INFO(node_->get_logger(), "[%s][Controller] Offering service: %s", name_.c_str(), set_position_mode_service_->get_service_name());

    // TODO: Create other services (RTL, SetBehavior) later
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
 * @brief Initiates the takeoff sequence
 * 
 */
void DroneController::takeoff() {
    // TODO: Implement takeoff sequence for non-offboard modes
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
    return offboard_control_->get_state() == OffboardControl::State::armed;
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
    // TODO: Add more robust checks - is drone already flying? Is state valid?
    // Drone should ALREADY BE ARMED before calling takeoff.
    if (get_arming_state() != ArmingState::ARMED) {
        RCLCPP_WARN(node_->get_logger(), "[%s][Controller] Takeoff rejected: Drone must be ARMED first.", name_.c_str());
        response->success = false;
        response->message = "Takeoff rejected: Drone must be ARMED first.";
        return;
    }
    
    try {
        this->takeoff(); // Call the existing internal method
        response->success = true;
        response->message = "Takeoff command initiated";
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
    // TODO: Add checks - is drone actually flying?
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
    // TODO: Add checks - e.g., only allow disarm if landed?
    if (drone_state_->get_landing_state() != LandingState::LANDED && 
        drone_state_->get_landing_state() != LandingState::MAYBE_LANDED) {
         RCLCPP_WARN(node_->get_logger(), "[%s][Controller] Disarm rejected: Drone is not landed.", name_.c_str());
         response->success = false;
         response->message = "Disarm rejected: Drone is not landed.";
         // return; // Decide if we enforce this strictly
    }

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
        RCLCPP_INFO(node_->get_logger(), "[%s][Controller] Waiting for 1.1 seconds for offboard stream...", name_.c_str());
        std::this_thread::sleep_for(std::chrono::milliseconds(1100)); // Wait 1.1 seconds

        // 5. Send Offboard mode command.
        RCLCPP_INFO(node_->get_logger(), "[%s][Controller] Sending Offboard mode command.", name_.c_str());
        this->set_mode(Px4CustomMode::OFFBOARD); // Use the corrected enum value via the helper
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
