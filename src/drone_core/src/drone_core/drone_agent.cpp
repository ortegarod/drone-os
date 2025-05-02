/**
 * @file drone_agent.cpp
 * @brief Implementation of the DroneAgent class for sending commands to PX4 autopilot
 */

#include "drone_core/drone_agent.hpp"

/**
 * @brief Constructs a new DroneAgent instance
 * 
 * Initializes the command relay with a ROS2 node and sets up the vehicle command service client.
 * The constructor will wait for the service to become available before proceeding.
 * 
 * @param node Pointer to the ROS2 node
 * @param ns PX4 namespace for communication
 * @param name Name of the drone for logging
 * @param mav_sys_id MAVLink System ID of the target PX4
 */
DroneAgent::DroneAgent(rclcpp::Node* node, const std::string& ns, const std::string& name, int mav_sys_id)
    : node_(node), name_(name), mav_sys_id_(mav_sys_id)
{
    client_ = node_->create_client<px4_msgs::srv::VehicleCommand>(ns + "vehicle_command");

    RCLCPP_INFO(node_->get_logger(), "[%s][Agent] Waiting for vehicle_command service...", name_.c_str());
    while (!client_->wait_for_service(std::chrono::seconds(1))) {
        if (!rclcpp::ok()) {
            RCLCPP_ERROR(node_->get_logger(), "[%s][Agent] Interrupted waiting for service", name_.c_str());
            return;
        }
        RCLCPP_INFO(node_->get_logger(), "[%s][Agent] Still waiting for vehicle_command...", name_.c_str());
    }
    RCLCPP_INFO(node_->get_logger(), "[%s][Agentt] vehicle_command service ready", name_.c_str());
}

/**
 * @brief Destructor for DroneAgent.
 */
DroneAgent::~DroneAgent() {
    RCLCPP_INFO(node_->get_logger(), "[%s][Agent] Destructor called. Releasing service client...", name_.c_str());
    client_.reset(); // Explicitly reset the client shared pointer
    RCLCPP_INFO(node_->get_logger(), "[%s][Agent] Service client released.", name_.c_str());
}

/**
 * @brief Sends a command to the PX4 autopilot
 * 
 * Creates and sends a vehicle command with the specified parameters.
 * The command is sent asynchronously, and the result is handled through the provided callback.
 * 
 * @param command The command ID (from px4_msgs::msg::VehicleCommand)
 * @param param1 First parameter for the command
 * @param param2 Second parameter for the command
 * @param callback Function to be called with the command result
 */
void DroneAgent::sendVehicleCommand(uint16_t command, float param1, float param2,
          std::function<void(uint8_t)> callback)
{
    auto request = std::make_shared<px4_msgs::srv::VehicleCommand::Request>();
    px4_msgs::msg::VehicleCommand msg{};
    msg.param1 = param1;
    msg.param2 = param2;
    msg.command = command;
    msg.target_system = this->mav_sys_id_;
    msg.target_component = 1;
    msg.source_system = 1;
    msg.source_component = 1;
    msg.from_external = true;
    msg.timestamp = node_->get_clock()->now().nanoseconds() / 1000;
    request->request = msg;

    client_->async_send_request(request,
        [this, callback](rclcpp::Client<px4_msgs::srv::VehicleCommand>::SharedFuture future) {
            const auto result = future.get()->reply.result;
            log_result(result);
            callback(result);
        });
}

/**
 * @brief Logs the result of a command
 * 
 * Logs the command result with appropriate severity level based on the result code.
 * 
 * @param result The result code from the PX4 autopilot:
 *              - 0: Command accepted
 *              - 1: Command temporarily rejected
 *              - 2: Command denied
 *              - 3: Command unsupported
 *              - 4: Command failed
 *              - Other: Unknown result
 */
void DroneAgent::log_result(uint8_t result)
{
    switch (result) {
        case 0:  // VEHICLE_CMD_RESULT_ACCEPTED
            RCLCPP_INFO(node_->get_logger(), "[%s][Agent] Command accepted", name_.c_str());
            break;
        case 1:  // VEHICLE_CMD_RESULT_TEMPORARILY_REJECTED
            RCLCPP_WARN(node_->get_logger(), "[%s][Agent] Command temporarily rejected", name_.c_str());
            break;
        case 2:  // VEHICLE_CMD_RESULT_DENIED
            RCLCPP_WARN(node_->get_logger(), "[%s][Agent] Command denied", name_.c_str());
            break;
        case 3:  // VEHICLE_CMD_RESULT_UNSUPPORTED
            RCLCPP_WARN(node_->get_logger(), "[%s][Agent] Command unsupported", name_.c_str());
            break;
        case 4:  // VEHICLE_CMD_RESULT_FAILED
            RCLCPP_WARN(node_->get_logger(), "[%s][Agent] Command failed", name_.c_str());
            break;
        default:
            RCLCPP_WARN(node_->get_logger(), "[%s][Agent] Unknown command result: %d", name_.c_str(), result);
            break;
    }
} 