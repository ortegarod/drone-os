#include "drone_core/drone_node.hpp"

// Constructor: Initialize base Node and declare parameters
DroneNode::DroneNode()
: rclcpp::Node("drone_node") // Base node name (can be overridden with ROS args)
{
    RCLCPP_INFO(this->get_logger(), "[DroneNode] Constructing...");

    // Declare parameters with default values
    // These can be overridden via launch files or command line
    this->declare_parameter<std::string>("drone_name", "drone1"); // Default name
    this->declare_parameter<std::string>("px4_namespace", "/fmu/"); // Default PX4 namespace
    this->declare_parameter<int>("mav_sys_id", 1); // Default MAV_SYS_ID for first vehicle
    
}

// Initialization method: Get params, create controller and services
bool DroneNode::init()
{
    RCLCPP_INFO(this->get_logger(), "[DroneNode] Initializing internals...");

    // Get parameters
    this->get_parameter("drone_name", drone_name_);
    this->get_parameter("px4_namespace", px4_namespace_);
    int mav_sys_id = this->get_parameter("mav_sys_id").as_int(); // Get mav_sys_id

    // Log the parameters being used
    RCLCPP_INFO(this->get_logger(), "Initializing for drone: '%s' (ID: %d) with PX4 namespace: '%s'", 
                drone_name_.c_str(), mav_sys_id, px4_namespace_.c_str());

    // Create the DroneController instance.
    // We use the init() pattern because make_shared needs to happen *after*
    // the DroneNode is constructed to enable shared_from_this.
    try {
        drone_controller_ = std::make_shared<DroneController>(this, drone_name_, px4_namespace_, mav_sys_id);
    } catch (const std::exception& e) {
        RCLCPP_FATAL(this->get_logger(), "Failed to create DroneController: %s", e.what());
        return false;
    }

    RCLCPP_INFO(this->get_logger(), "DroneNode '%s' initialized successfully.", this->get_name());
    return true;
}

// --- Destructor Definition ---
DroneNode::~DroneNode()
{
    RCLCPP_INFO(this->get_logger(), "DroneNode '%s' destructor called. Resetting DroneController...", this->get_name());
    if (drone_controller_) {
        // Resetting the shared_ptr triggers the DroneController destructor
        // and consequently the destructors of its components (Agent, OffboardControl, State).
        drone_controller_.reset(); 
        RCLCPP_INFO(this->get_logger(), "DroneController instance reset.");
    } else {
        RCLCPP_WARN(this->get_logger(), "DroneController was already null in destructor.");
    }
    RCLCPP_INFO(this->get_logger(), "DroneNode '%s' destructor finished.", this->get_name());
}