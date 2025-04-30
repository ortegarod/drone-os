#include "drone_core/drone_node.hpp" // Include the renamed node definition
#include <rclcpp/rclcpp.hpp>             // Include the ROS 2 C++ client library
#include <memory>                         // Required for std::make_shared
#include <vector>                         // Required for std::vector

/**
 * @brief Main entry point for the Drone Node executable.
 *
 * Initializes ROS 2, creates an instance of the DroneNode,
 * initializes it (which reads parameters and sets up the controller/services),
 * and spins the node to keep it running.
 * 
 * @param argc Number of command-line arguments.
 * @param argv Array of command-line arguments.
 * @return int Exit code (0 for success).
 */
int main(int argc, char* argv[]) {
    // 1. Initialize ROS 2
    rclcpp::init(argc, argv);

    // 2. Create the DroneNode instance
    auto drone_node = std::make_shared<DroneNode>(); // Renamed from DroneControllerNode

    // 3. Initialize the node's internals (DroneController, services, etc.)
    //    This will also read parameters like drone_name and px4_namespace.
    if (!drone_node->init()) { // Use renamed instance
        // Use a temporary logger or stderr since node name might not be set if init fails early
        fprintf(stderr, "DroneNode initialization failed!\n"); // Renamed
        rclcpp::shutdown();
        return 1; // Indicate failure
    }
    
    // 4. Spin the node
    //    Keeps the node alive to process service calls, subscriptions, etc.
    rclcpp::spin(drone_node); // Use renamed instance

    // 5. Shutdown ROS 2
    //    Reached after spin() returns (e.g., via Ctrl+C or shutdown signal).
    rclcpp::shutdown();

    return 0; // Indicate successful execution
} 