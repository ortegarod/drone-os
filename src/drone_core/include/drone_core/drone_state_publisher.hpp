#pragma once

#include <rclcpp/rclcpp.hpp>
#include <memory>
#include <string>
#include <vector>

#include "drone_interfaces/msg/drone_state.hpp"
#include "drone_interfaces/srv/get_state.hpp"
#include "drone_core/drone_state.hpp"

namespace drone_core {

/**
 * @brief Publishes real-time drone state information and provides GetState service
 * 
 * This class creates a continuous publisher for DroneState messages and implements
 * the GetState service for on-demand state queries. It integrates with the existing
 * DroneState class to provide comprehensive telemetry data.
 */
class DroneStatePublisher {
public:
    /**
     * @brief Constructor
     * @param node ROS2 node handle
     * @param drone_namespace Namespace for the drone (e.g., "px4_1")
     */
    DroneStatePublisher(rclcpp::Node* node, const std::string& drone_namespace);
    
    /**
     * @brief Destructor
     */
    ~DroneStatePublisher();

private:
    /**
     * @brief Timer callback to publish drone state periodically
     */
    void publish_state();
    
    /**
     * @brief Service callback for GetState requests
     * @param request Service request (empty)
     * @param response Service response with current state
     */
    void get_state_callback(
        const std::shared_ptr<drone_interfaces::srv::GetState::Request> request,
        std::shared_ptr<drone_interfaces::srv::GetState::Response> response);
    
    /**
     * @brief Create a DroneState message from current state
     * @return Populated DroneState message
     */
    drone_interfaces::msg::DroneState create_drone_state_message();
    
    /**
     * @brief Populate GetState service response
     * @param response Service response to populate
     */
    void populate_get_state_response(
        std::shared_ptr<drone_interfaces::srv::GetState::Response> response);
    
    /**
     * @brief Convert battery warning code to string
     * @param warning Battery warning code
     * @return Warning string
     */
    std::string get_battery_warning_string(uint8_t warning) const;
    
    /**
     * @brief Convert GPS fix type to string
     * @param fix_type GPS fix type code
     * @return Fix type string
     */
    std::string get_gps_fix_type_string(uint8_t fix_type) const;
    
    /**
     * @brief Calculate overall system health score (0-100)
     * @return System health score
     */
    float calculate_system_health_score() const;
    
    /**
     * @brief Calculate telemetry link quality (0-100)
     * @return Link quality percentage
     */
    float calculate_link_quality() const;
    
    /**
     * @brief Populate warning and critical failure message vectors
     * @param warnings Vector to populate with warning messages
     * @param critical_failures Vector to populate with critical failure messages
     */
    void populate_warning_messages(
        std::vector<std::string>& warnings, 
        std::vector<std::string>& critical_failures) const;
    
    /**
     * @brief Convert NavState enum to string
     * @param state Navigation state enum
     * @return String representation
     */
    std::string nav_state_to_string(NavState state) const;
    
    /**
     * @brief Convert ArmingState enum to string
     * @param state Arming state enum
     * @return String representation
     */
    std::string arming_state_to_string(ArmingState state) const;
    
    /**
     * @brief Convert LandingState enum to string
     * @param state Landing state enum
     * @return String representation
     */
    std::string landing_state_to_string(LandingState state) const;

    // ROS2 components
    rclcpp::Node* node_;
    std::string namespace_;
    
    // Publishers and services
    rclcpp::Publisher<drone_interfaces::msg::DroneState>::SharedPtr state_pub_;
    rclcpp::Service<drone_interfaces::srv::GetState>::SharedPtr get_state_service_;
    rclcpp::TimerBase::SharedPtr publish_timer_;
    
    // Drone state manager
    std::unique_ptr<DroneState> drone_state_;
};

} // namespace drone_core