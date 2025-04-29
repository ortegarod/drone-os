/**
 * @file drone_agent.hpp
 * @brief Defines the DroneAgent class for sending commands to PX4 autopilot
 */

#pragma once

#include <rclcpp/rclcpp.hpp>
#include <px4_msgs/srv/vehicle_command.hpp>
#include <px4_msgs/msg/vehicle_command.hpp>

/**
 * @class DroneAgent
 * @brief Handles communication with PX4 autopilot through ROS2 services
 * 
 * This class provides a simplified interface for sending vehicle commands
 * to the PX4 autopilot. It handles the creation of service clients and
 * provides a callback mechanism for command results.
 */
class DroneAgent {
public:
    /**
     * @brief Constructs a new DroneAgent instance
     * 
     * Initializes the command relay with a ROS2 node and sets up the
     * vehicle command service client.
     * 
     * @param node Pointer to the ROS2 node
     * @param ns PX4 namespace for communication
     * @param name Name of the drone for logging
     */
    DroneAgent(rclcpp::Node* node, const std::string& ns, const std::string& name);

    /**
     * @brief Sends a command to the PX4 autopilot
     * 
     * Creates and sends a vehicle command with the specified parameters.
     * The result is handled asynchronously through the provided callback.
     * 
     * @param command The command ID (from px4_msgs::msg::VehicleCommand)
     * @param param1 First parameter for the command
     * @param param2 Second parameter for the command
     * @param callback Function to be called with the command result
     */
    void sendVehicleCommand(uint16_t command, float param1, float param2,
              std::function<void(uint8_t)> callback);

private:
    /**
     * @brief Logs the result of a command
     * 
     * @param result The result code from the PX4 autopilot
     */
    void log_result(uint8_t result);

    rclcpp::Node* node_;                    ///< Pointer to ROS2 node
    std::string name_;                      ///< Name of the drone for logging
    rclcpp::Client<px4_msgs::srv::VehicleCommand>::SharedPtr client_;    ///< Service client for vehicle commands
}; 