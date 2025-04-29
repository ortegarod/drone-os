/**
 * @file drone_controller.hpp
 * @brief Defines the DroneController class for managing drone operations and state
 */

#pragma once

#include <rclcpp/rclcpp.hpp>
#include "drone_core/drone_agent.hpp"
#include "drone_core/offboard_control.hpp"
#include <memory>
#include <thread>
#include <atomic>
#include <queue>
#include <mutex>
#include <px4_msgs/msg/vehicle_status.hpp>
#include <px4_msgs/msg/vehicle_land_detected.hpp>
#include <px4_msgs/msg/vehicle_global_position.hpp>
#include <px4_msgs/msg/vehicle_local_position.hpp>
#include <future>     // Added include for std::promise/future
#include <chrono>     // Added include for std::chrono
#include "drone_core/utils/state_enums.hpp" // Added include for shared enums
#include "drone_core/drone_state.hpp" // Added DroneState include
#include <std_srvs/srv/trigger.hpp> // Include for Trigger service
#include <vector>
#include <cmath> // For std::isnan

/**
 * @class DroneController
 * @brief Manages the state and control of a single drone
 * 
 * This class handles the core functionality for controlling a drone.
 * 
 */
class DroneController {
public:
    /**
     * @brief Construct a new DroneController object
     * @param node Pointer to the ROS2 node
     * @param name Name of the drone
     * @param px4_namespace PX4 namespace for communication
     */
    DroneController(rclcpp::Node* node, const std::string& name, const std::string& px4_namespace);

    /**
     * @brief Destroy the Drone Controller object
     * Cleans up resources, like joining the agent thread.
     */
    ~DroneController();

    /**
     * @brief Start the drone's internal agent loop
     */
    void start();

    /**
     * @brief Arm the drone
     */
    void arm();

    /**
     * @brief Disarm the drone
     */
    void disarm();

    /**
     * @brief Command the drone to takeoff
     */
    void takeoff();

    /**
     * @brief Set target position and yaw
     * @param x Target x position in meters
     * @param y Target y position in meters
     * @param z Target z position in meters
     * @param yaw Target yaw angle in radians
     */
    void set_position(float x, float y, float z, float yaw);

    /**
     * @brief Set target velocity and yaw rate
     * @param vx Target x velocity in m/s (NED frame)
     * @param vy Target y velocity in m/s (NED frame)
     * @param vz Target z velocity in m/s (NED frame, positive down)
     * @param yaw_rate Target yaw rate in rad/s (positive clockwise looking down)
     */
    void set_velocity(float vx, float vy, float vz, float yaw_rate = NAN);

    /**
     * @brief Command the drone to land
     */
    void land();

    /**
     * @brief Set the drone to position control mode
     */
    void set_position_mode();

    /**
     * @brief Set the drone to altitude control mode
     */
    void set_altitude_mode();

    /**
     * @brief Sets the drone to loiter mode and waits for acknowledgement.
     * @param timeout_ms Maximum time to wait for acknowledgement in milliseconds.
     * @return true if command was acknowledged successfully within timeout, false otherwise.
     */
    bool set_loiter_mode_sync(std::chrono::milliseconds timeout_ms = std::chrono::milliseconds(2000));

    /**
     * @brief Sets the drone to position control mode and waits for acknowledgement.
     * @param timeout_ms Maximum time to wait for acknowledgement in milliseconds.
     * @return true if command was acknowledged successfully within timeout, false otherwise.
     */
    bool set_position_mode_sync(std::chrono::milliseconds timeout_ms = std::chrono::milliseconds(2000));

    /**
     * @brief Sets the drone to altitude control mode and waits for acknowledgement.
     * @param timeout_ms Maximum time to wait for acknowledgement in milliseconds.
     * @return true if command was acknowledged successfully within timeout, false otherwise.
     */
    bool set_altitude_mode_sync(std::chrono::milliseconds timeout_ms = std::chrono::milliseconds(2000));

    /**
     * @brief Check if the drone is in offboard mode and armed
     * @return true if the drone is in offboard mode and armed
     */
    bool is_ready() const;

    /**
     * @brief Get the currently tracked navigation state.
     * @return The current NavState enum value.
     */
    NavState get_nav_state() const;

    /**
     * @brief Get the currently tracked arming state.
     * @return The current ArmingState enum value.
     */
    ArmingState get_arming_state() const;

    /**
     * @brief Enqueue a command for the drone to execute
     * @param cmd The command to add to the queue
     */
    void enqueue(const Command& cmd);

private:
    rclcpp::Node* node_;                    ///< Pointer to ROS2 node
    std::string name_;                      ///< Name of the drone
    std::string ns_;                        ///< PX4 namespace

    float target_x_ = 0.0f;                 ///< Target x position for commands
    float target_y_ = 0.0f;                 ///< Target y position for commands
    float target_z_ = 0.0f;                 ///< Target z position
    float target_yaw_ = 0.0f;               ///< Target yaw angle

    // Command Queue members
    std::queue<Command> command_queue_;     ///< Queue for incoming commands
    std::mutex command_mutex_;              ///< Mutex to protect command queue

    // Core Components
    std::unique_ptr<DroneAgent> drone_agent_;    ///< Command relay for PX4 communication
    std::unique_ptr<OffboardControl> offboard_control_;    ///< Offboard control manager
    std::unique_ptr<DroneState> drone_state_;       ///< Drone state tracker

    // Agent loop members
    std::thread agent_thread_;              ///< Thread for the agent loop
    std::atomic<bool> running_{false};      ///< Flag to control the agent loop

    // Mission Execution Members (NEW)
    std::vector<Waypoint> mission_waypoints_; ///< Current mission waypoints
    size_t current_waypoint_index_{0};      ///< Index of the waypoint the drone is heading towards
    std::atomic<bool> mission_active_{false}; ///< Flag indicating if a mission is currently running
    std::mutex mission_mutex_;               ///< Mutex to protect mission data access
    float default_acceptance_radius_ = 1.5f;  ///< Default radius for reaching a waypoint (meters)

    // ROS 2 Services (Added)
    rclcpp::Service<std_srvs::srv::Trigger>::SharedPtr arm_service_;
    rclcpp::Service<std_srvs::srv::Trigger>::SharedPtr takeoff_service_;
    rclcpp::Service<std_srvs::srv::Trigger>::SharedPtr land_service_;
    rclcpp::Service<std_srvs::srv::Trigger>::SharedPtr disarm_service_;
    rclcpp::Service<std_srvs::srv::Trigger>::SharedPtr set_offboard_service_;
    rclcpp::Service<std_srvs::srv::Trigger>::SharedPtr set_position_mode_service_;
    // TODO: Add services for RTL, SetBehavior, etc. later

    /**
     * @brief The persistent agent loop
     */
    void run();

    /**
     * @brief Processes one command from the queue, if available
     */
    void process_command_queue();

    // Service Callbacks (Added)
    void arm_callback(const std::shared_ptr<rmw_request_id_t> request_header,
                      const std::shared_ptr<std_srvs::srv::Trigger::Request> request,
                      std::shared_ptr<std_srvs::srv::Trigger::Response> response);

    void takeoff_callback(const std::shared_ptr<rmw_request_id_t> request_header,
                          const std::shared_ptr<std_srvs::srv::Trigger::Request> request,
                          std::shared_ptr<std_srvs::srv::Trigger::Response> response);

    void land_callback(const std::shared_ptr<rmw_request_id_t> request_header,
                       const std::shared_ptr<std_srvs::srv::Trigger::Request> request,
                       std::shared_ptr<std_srvs::srv::Trigger::Response> response);

    void disarm_callback(const std::shared_ptr<rmw_request_id_t> request_header,
                         const std::shared_ptr<std_srvs::srv::Trigger::Request> request,
                         std::shared_ptr<std_srvs::srv::Trigger::Response> response);

    void set_offboard_callback(const std::shared_ptr<rmw_request_id_t> request_header,
                               const std::shared_ptr<std_srvs::srv::Trigger::Request> request,
                               std::shared_ptr<std_srvs::srv::Trigger::Response> response);

    void set_position_mode_callback(const std::shared_ptr<rmw_request_id_t> request_header,
                                    const std::shared_ptr<std_srvs::srv::Trigger::Request> request,
                                    std::shared_ptr<std_srvs::srv::Trigger::Response> response);

    // TODO: Add callbacks for other services later

    /**
     * @brief Internal helper to send a VEHICLE_CMD_DO_SET_MODE command
     * @param mode The target Px4CustomMode
     */
    void set_mode(Px4CustomMode mode);

    /**
     * @brief Internal helper to send VEHICLE_CMD_DO_SET_MODE and wait for acknowledgement.
     * @param mode The target Px4CustomMode.
     * @param timeout_ms Maximum time to wait for acknowledgement.
     * @return true if command acknowledged successfully, false otherwise.
     */
    bool set_mode_sync(Px4CustomMode mode, std::chrono::milliseconds timeout_ms);
};
