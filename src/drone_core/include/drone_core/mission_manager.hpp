#pragma once

#include <rclcpp/rclcpp.hpp>
#include <px4_msgs/msg/vehicle_command.hpp>
#include <px4_msgs/msg/mission_result.hpp>
#include <px4_msgs/msg/navigator_mission_item.hpp>
#include <drone_interfaces/msg/waypoint.hpp>
#include <drone_interfaces/srv/upload_mission.hpp>
#include <drone_interfaces/srv/mission_control.hpp>
#include <drone_interfaces/srv/get_mission_status.hpp>
#include <atomic>
#include <vector>
#include <memory>
#include <chrono>

// Forward declaration (OffboardControl is in global namespace)
class OffboardControl;

// Forward declaration for DroneState
class DroneState;

namespace drone_core {

struct MissionStatus {
    bool mission_valid = false;
    bool mission_finished = false;
    bool mission_running = false;
    uint16_t current_item = 0;
    uint16_t total_items = 0;
    uint32_t mission_id = 0;
    float mission_progress = 0.0f;
};

class MissionManager {
public:
    MissionManager(rclcpp::Node* node, const std::string& drone_namespace);
    ~MissionManager();
    
    // Set offboard control reference for mission execution  
    void set_offboard_control(::OffboardControl* offboard_control);
    
    // Set drone state reference for position feedback
    void set_drone_state(::DroneState* drone_state);

    // Core mission operations
    bool upload_mission(const std::vector<drone_interfaces::msg::Waypoint>& waypoints, uint32_t& mission_id);
    bool start_mission();
    bool pause_mission();
    bool resume_mission();
    bool stop_mission();
    bool clear_mission();
    bool goto_mission_item(uint16_t item_index);
    
    // Mission status
    MissionStatus get_mission_status() const;
    bool is_mission_active() const { return mission_status_.mission_running; }

private:
    // ROS 2 node reference
    rclcpp::Node* node_;
    std::string namespace_;
    
    // Publishers
    rclcpp::Publisher<px4_msgs::msg::VehicleCommand>::SharedPtr vehicle_command_pub_;
    
    // Subscribers  
    rclcpp::Subscription<px4_msgs::msg::MissionResult>::SharedPtr mission_result_sub_;
    rclcpp::Subscription<px4_msgs::msg::NavigatorMissionItem>::SharedPtr mission_item_sub_;
    
    // Mission state tracking
    mutable std::mutex status_mutex_;
    MissionStatus mission_status_;
    std::vector<drone_interfaces::msg::Waypoint> current_mission_;
    uint32_t next_mission_id_;
    
    // Mission execution 
    ::OffboardControl* offboard_control_;
    ::DroneState* drone_state_;
    std::chrono::steady_clock::time_point waypoint_start_time_;
    rclcpp::TimerBase::SharedPtr mission_timer_;
    static constexpr float WAYPOINT_ACCEPTANCE_RADIUS = 2.0f; // meters
    static constexpr float WAYPOINT_TIMEOUT_MULTIPLIER = 2.0f; // Timeout = 2x expected time
    
    // Callback methods
    void mission_result_callback(const px4_msgs::msg::MissionResult::SharedPtr msg);
    void navigator_mission_item_callback(const px4_msgs::msg::NavigatorMissionItem::SharedPtr msg);
    
    // Helper methods
    void send_vehicle_command(uint16_t command, float param1 = 0.0f, float param2 = 0.0f, 
                             float param3 = 0.0f, float param4 = 0.0f);
    void send_mission_item(uint16_t seq, uint8_t frame, uint16_t command, uint8_t current, uint8_t autocontinue,
                          float param1, float param2, float param3, float param4, 
                          double param5, double param6, float param7);
    bool upload_mission_to_px4(const std::vector<drone_interfaces::msg::Waypoint>& waypoints);
    void update_mission_progress();
    void execute_current_waypoint();
    void check_waypoint_completion();  // Event-driven waypoint checking
    
    // Mission command constants
    static constexpr uint16_t VEHICLE_CMD_MISSION_START = 300;
    static constexpr uint16_t VEHICLE_CMD_NAV_WAYPOINT = 16;
    static constexpr uint16_t VEHICLE_CMD_NAV_TAKEOFF = 22;
    static constexpr uint16_t VEHICLE_CMD_NAV_LAND = 21;
    static constexpr uint16_t VEHICLE_CMD_NAV_LOITER_UNLIM = 17;
    static constexpr uint16_t VEHICLE_CMD_DO_PAUSE_CONTINUE = 193;
    
    // MAVLink mission protocol constants
    static constexpr uint16_t MAV_CMD_MISSION_COUNT = 44;
    static constexpr uint16_t MAV_CMD_MISSION_ITEM_INT = 73;
};

} // namespace drone_core