/**
 * @file telemetry_publisher_node.cpp
 * @brief Standalone ROS2 node for publishing drone telemetry via rosbridge
 * 
 * This node creates DroneStatePublisher instances for multiple drones and publishes
 * comprehensive telemetry data that can be consumed by web frontends through rosbridge.
 */

#include <rclcpp/rclcpp.hpp>
#include <memory>
#include <vector>
#include <string>

#include "drone_core/drone_state_publisher.hpp"

class TelemetryPublisherNode : public rclcpp::Node {
public:
    TelemetryPublisherNode() : Node("telemetry_publisher") {
        
        // Declare parameters for drone configuration
        this->declare_parameter<std::vector<std::string>>("drone_namespaces", std::vector<std::string>{"px4_1"});
        this->declare_parameter<int>("publish_rate_hz", 10);
        this->declare_parameter<bool>("enable_rosbridge_topics", true);
        this->declare_parameter<bool>("enable_get_state_services", true);
        
        // Get parameters
        auto drone_namespaces = this->get_parameter("drone_namespaces").as_string_array();
        auto publish_rate = this->get_parameter("publish_rate_hz").as_int();
        auto enable_rosbridge = this->get_parameter("enable_rosbridge_topics").as_bool();
        auto enable_services = this->get_parameter("enable_get_state_services").as_bool();
        
        RCLCPP_INFO(this->get_logger(), "Starting telemetry publisher for %zu drones", drone_namespaces.size());
        RCLCPP_INFO(this->get_logger(), "Publish rate: %d Hz", publish_rate);
        RCLCPP_INFO(this->get_logger(), "Rosbridge topics: %s", enable_rosbridge ? "enabled" : "disabled");
        RCLCPP_INFO(this->get_logger(), "GetState services: %s", enable_services ? "enabled" : "disabled");
        
        // Create DroneStatePublisher for each drone
        for (const auto& drone_ns : drone_namespaces) {
            try {
                auto publisher = std::make_shared<drone_core::DroneStatePublisher>(this, drone_ns);
                drone_publishers_.push_back(publisher);
                RCLCPP_INFO(this->get_logger(), "Created telemetry publisher for drone: %s", drone_ns.c_str());
            } catch (const std::exception& e) {
                RCLCPP_ERROR(this->get_logger(), "Failed to create publisher for drone %s: %s", drone_ns.c_str(), e.what());
            }
        }
        
        if (drone_publishers_.empty()) {
            RCLCPP_WARN(this->get_logger(), "No drone publishers created. Check your configuration.");
        } else {
            RCLCPP_INFO(this->get_logger(), "Telemetry publisher node initialized with %zu drone(s)", drone_publishers_.size());
            
            // Create a timer for periodic status reporting
            status_timer_ = this->create_wall_timer(
                std::chrono::seconds(30),
                std::bind(&TelemetryPublisherNode::print_status, this)
            );
        }
    }
    
    ~TelemetryPublisherNode() {
        RCLCPP_INFO(this->get_logger(), "Shutting down telemetry publisher node");
    }

private:
    /**
     * @brief Print periodic status information
     */
    void print_status() {
        RCLCPP_INFO(this->get_logger(), 
            "Telemetry publisher running - %zu drone publishers active", 
            drone_publishers_.size());
        
        // Add any additional status information here
        for (size_t i = 0; i < drone_publishers_.size(); ++i) {
            RCLCPP_DEBUG(this->get_logger(), "Publisher %zu: Active", i);
        }
    }
    
    std::vector<std::shared_ptr<drone_core::DroneStatePublisher>> drone_publishers_;
    rclcpp::TimerBase::SharedPtr status_timer_;
};

int main(int argc, char** argv) {
    rclcpp::init(argc, argv);
    
    try {
        auto node = std::make_shared<TelemetryPublisherNode>();
        
        RCLCPP_INFO(node->get_logger(), "Telemetry publisher node started. Spinning...");
        rclcpp::spin(node);
        
    } catch (const std::exception& e) {
        RCLCPP_FATAL(rclcpp::get_logger("telemetry_publisher"), "Failed to start node: %s", e.what());
        return 1;
    }
    
    rclcpp::shutdown();
    return 0;
}