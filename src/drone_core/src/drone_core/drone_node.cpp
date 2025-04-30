#include "drone_core/drone_node.hpp"
#include <functional> // std::bind, std::placeholders

// Constructor: Initialize base Node and declare parameters
DroneNode::DroneNode()
: rclcpp::Node("drone_node") // Renamed base node name
{
    RCLCPP_INFO(this->get_logger(), "[DroneNode] Initializing DroneNode...");

    // Declare parameters with default values
    // These can be overridden via launch files or command line
    this->declare_parameter<std::string>("drone_name", "drone1"); // Default name
    this->declare_parameter<std::string>("px4_namespace", "/fmu/"); // Default PX4 namespace
    
}

// Initialization method: Get params, create controller and services
bool DroneNode::init()
{
    RCLCPP_INFO(this->get_logger(), "[DroneNode] Initializing internals...");

    // Get parameters
    this->get_parameter("drone_name", drone_name_);
    this->get_parameter("px4_namespace", px4_namespace_);

    // Log the parameters being used
    RCLCPP_INFO(this->get_logger(), "Initializing for drone: '%s' with PX4 namespace: '%s'", 
                drone_name_.c_str(), px4_namespace_.c_str());

    // Create the DroneController instance for this specific drone
    // We need shared_from_this here, hence the init() pattern
    try {
        // Pass the node itself (as rclcpp::Node*) and the parameters
        drone_controller_ = std::make_shared<DroneController>(this, drone_name_, px4_namespace_); 
    } catch (const std::exception& e) {
        RCLCPP_FATAL(this->get_logger(), "Failed to create DroneController: %s", e.what());
        return false;
    }

    // --- Create Services (namespaced relative to the node) ---
    // Service names will be like /drone1/takeoff if node name is drone1
    std::string takeoff_service_name = "takeoff"; // Relative service name
    std::string land_service_name = "land";       // Relative service name

    // Takeoff Service
    try {
        takeoff_service_ = this->create_service<std_srvs::srv::Trigger>(
            takeoff_service_name,
            std::bind(&DroneNode::handle_takeoff, this, std::placeholders::_1, std::placeholders::_2, std::placeholders::_3)
        );
        // Use .c_str() to convert std::string to const char*
        std::string full_takeoff_service_name = this->get_fully_qualified_name() + std::string("/") + takeoff_service_name;
        RCLCPP_INFO(this->get_logger(), "Service '%s' created.", full_takeoff_service_name.c_str());
    } catch (const rclcpp::exceptions::RCLError& e) {
        RCLCPP_ERROR(this->get_logger(), "Failed to create takeoff service: %s", e.what());
        return false;
    }

    // Land Service
    try {
        land_service_ = this->create_service<std_srvs::srv::Trigger>(
            land_service_name,
            std::bind(&DroneNode::handle_land, this, std::placeholders::_1, std::placeholders::_2, std::placeholders::_3)
        );
        // Use .c_str() to convert std::string to const char*
        std::string full_land_service_name = this->get_fully_qualified_name() + std::string("/") + land_service_name;
        RCLCPP_INFO(this->get_logger(), "Service '%s' created.", full_land_service_name.c_str());
    } catch (const rclcpp::exceptions::RCLError& e) {
        RCLCPP_ERROR(this->get_logger(), "Failed to create land service: %s", e.what());
        return false;
    }

    // TODO: Create services for set_position, set_velocity
    // TODO: Create publishers/timers for status

    RCLCPP_INFO(this->get_logger(), "DroneNode '%s' initialized successfully.", this->get_name());
    return true;
}

// Takeoff Service Callback
void DroneNode::handle_takeoff(
    const std::shared_ptr<rmw_request_id_t> /*request_header*/, 
    const std::shared_ptr<std_srvs::srv::Trigger::Request> /*request*/, 
    std::shared_ptr<std_srvs::srv::Trigger::Response> response)
{
    RCLCPP_INFO(this->get_logger(), "Service '%s/takeoff' called.", this->get_name());
    try {
        drone_controller_->takeoff();
        response->success = true;
        response->message = "Takeoff command initiated for " + drone_name_;
        RCLCPP_INFO(this->get_logger(), "Takeoff command sent successfully.");
    } catch (const std::exception& e) {
        response->success = false;
        response->message = "Failed to initiate takeoff for " + drone_name_ + ": " + e.what();
        RCLCPP_ERROR(this->get_logger(), "Takeoff command failed: %s", e.what());
    }
}

// Land Service Callback
void DroneNode::handle_land(
    const std::shared_ptr<rmw_request_id_t> /*request_header*/, 
    const std::shared_ptr<std_srvs::srv::Trigger::Request> /*request*/,
    std::shared_ptr<std_srvs::srv::Trigger::Response> response)
{
    RCLCPP_INFO(this->get_logger(), "Service '%s/land' called.", this->get_name());
    try {
        drone_controller_->land();
        response->success = true;
        response->message = "Land command initiated for " + drone_name_;
        RCLCPP_INFO(this->get_logger(), "Land command sent successfully.");
    } catch (const std::exception& e) {
        response->success = false;
        response->message = "Failed to initiate land for " + drone_name_ + ": " + e.what();
        RCLCPP_ERROR(this->get_logger(), "Land command failed: %s", e.what());
    }
}


// --- Destructor Definition ---
DroneNode::~DroneNode()
{
    RCLCPP_INFO(this->get_logger(), "DroneNode '%s' destructor called. Explicitly stopping controller...", this->get_name());
    if (drone_controller_) {
        // Resetting the shared_ptr triggers the DroneController destructor
        // and consequently the destructors of DroneAgent, OffboardControl, DroneState.
        drone_controller_.reset(); 
        RCLCPP_INFO(this->get_logger(), "DroneController instance reset.");
    } else {
        RCLCPP_WARN(this->get_logger(), "DroneController was already null in destructor.");
    }
    // Original stop() method is now less relevant as reset() handles controller destruction.
    // stop(); // Removing call to stop() as reset() handles it.
    RCLCPP_INFO(this->get_logger(), "DroneNode '%s' destructor finished.", this->get_name());
}

// --- Stop Method --- // This method might become redundant
void DroneNode::stop()
{
    // This logic is now handled by drone_controller_.reset() in the destructor
    // If stop() is not called elsewhere, it could potentially be removed later.
    RCLCPP_INFO(this->get_logger(), "DroneNode::stop() called for %s (may be redundant).", this->get_name());
    // Original logic removed as it's handled by reset()
    // if (drone_controller_) { ... }
} 