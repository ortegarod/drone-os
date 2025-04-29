#pragma once

#include <rclcpp/rclcpp.hpp>
#include <std_srvs/srv/trigger.hpp>
#include <memory>
#include <string>
#include "drone_core/drone_controller.hpp"

// TODO: Include headers for custom services (SetPosition, SetVelocity) when defined

/**
 * @brief ROS 2 Node acting as the primary controller for a single drone.
 *
 * This node runs on the drone's companion computer, manages a DroneController instance,
 * and exposes control functionalities (takeoff, land, setpoint setting) via ROS 2 services.
 * It also handles parameter loading for drone-specific configuration.
 */
class DroneNode : public rclcpp::Node, public std::enable_shared_from_this<DroneNode> {
public:
    /**
     * @brief Construct a new Drone Node object.
     *        Initializes the base node and declares parameters.
     */
    DroneNode();

    /**
     * @brief Initialize the DroneController and associated services/topics.
     *        Must be called after the node is created via std::make_shared.
     *        Reads parameters declared in the constructor.
     * @return true if initialization is successful, false otherwise.
     */
    bool init();

    /**
     * @brief Destroy the Drone Node object.
     */
    virtual ~DroneNode() override;

    /**
     * @brief Get a shared pointer to the underlying DroneController.
     * @return std::shared_ptr<DroneController> The controller instance.
     * @warning Returns nullptr if init() has not been successfully called.
     */
    std::shared_ptr<DroneController> get_controller() { return drone_controller_; }

    /**
     * @brief Stops the node's components, particularly the controller's thread.
     */
    void stop();

private:
    // Core controller for this specific drone
    std::shared_ptr<DroneController> drone_controller_;

    // Drone Identification Parameters
    std::string drone_name_; 
    std::string px4_namespace_; 

    // --- Service Servers --- 
    rclcpp::Service<std_srvs::srv::Trigger>::SharedPtr takeoff_service_;
    rclcpp::Service<std_srvs::srv::Trigger>::SharedPtr land_service_;
    // rclcpp::Service<your_interfaces::srv::SetPosition>::SharedPtr set_position_service_;
    // rclcpp::Service<your_interfaces::srv::SetVelocity>::SharedPtr set_velocity_service_;

    /**
     * @brief Callback for the takeoff service.
     */
    void handle_takeoff(
        const std::shared_ptr<rmw_request_id_t> request_header,
        const std::shared_ptr<std_srvs::srv::Trigger::Request> request,
        std::shared_ptr<std_srvs::srv::Trigger::Response> response);

    /**
     * @brief Callback for the land service.
     */
    void handle_land(
        const std::shared_ptr<rmw_request_id_t> request_header,
        const std::shared_ptr<std_srvs::srv::Trigger::Request> request,
        std::shared_ptr<std_srvs::srv::Trigger::Response> response);

    // TODO: Add callbacks for set_position, set_velocity services

    // TODO: Add publishers for status/telemetry
    // rclcpp::Publisher<your_interfaces::msg::DroneStatus>::SharedPtr status_publisher_;
    // rclcpp::TimerBase::SharedPtr status_publish_timer_;
    // void publish_status();

}; 