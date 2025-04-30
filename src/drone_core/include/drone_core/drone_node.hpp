#pragma once

#include <rclcpp/rclcpp.hpp>
#include <memory>
#include <string>
#include "drone_core/drone_controller.hpp"

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

private:
    // Core controller for this specific drone
    std::shared_ptr<DroneController> drone_controller_;

    // Drone Identification Parameters
    std::string drone_name_; 
    std::string px4_namespace_;
}; 