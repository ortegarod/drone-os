#pragma once

#include <rclcpp/rclcpp.hpp>
#include <px4_msgs/msg/vehicle_command.hpp>
#include <px4_msgs/msg/mission_result.hpp>
#include <px4_msgs/msg/navigator_mission_item.hpp>
#include <drone_interfaces/msg/waypoint.hpp>
#include <drone_interfaces/srv/upload_mission.hpp>
#include <drone_interfaces/srv/mission_control.hpp>
#include <drone_interfaces/srv/get_mission_status.hpp>
#include <drone_interfaces/msg/patrol_plan.hpp>
#include <drone_interfaces/msg/patrol_status.hpp>
#include <atomic>
#include <vector>
#include <memory>
#include <chrono>
#include <functional>
#include <optional>
#include <algorithm>
#include <cmath>

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
    bool mission_failed = false;      // aborted: waypoint timeout, PX4 left/refused OFFBOARD, stale position
    std::string failure_reason;
    bool mission_paused = false;      // PAUSE / Hold while running; RESUME continues from current_item
};

class MissionManager {
public:
    MissionManager(rclcpp::Node* node, const std::string& drone_namespace);
    ~MissionManager();
    
    // Set offboard control reference for mission execution  
    void set_offboard_control(::OffboardControl* offboard_control);
    
    // Set drone state reference for position feedback
    void set_drone_state(::DroneState* drone_state);

    // Called when the mission reaches a RETURN_TO_LAUNCH (20) or LAND (21) item.
    // The handler hands control back to PX4, which flies the rest on its own.
    void set_mode_command_handler(std::function<void(uint16_t command)> handler);

    // Core mission operations
    bool upload_mission(const std::vector<drone_interfaces::msg::Waypoint>& waypoints, uint32_t& mission_id, float cruise_speed = 0.0f);
    /** Cruise speed applied to the current mission (m/s). */
    float get_cruise_speed() const { return cruise_speed_; }
    bool start_mission();
    bool pause_mission();
    bool resume_mission();
    bool stop_mission();
    // Abort a running mission as FAILED (mission_running=false, mission_finished=false, mission_failed=true)
    // and ask the controller to hold. Safe to call from any timer callback; no-op if not running.
    void fail_mission(const std::string& reason, bool request_hold);
    void set_failure_handler(std::function<void(const std::string&)> handler) { failure_handler_ = handler; }
    bool clear_mission();
    bool goto_mission_item(uint16_t item_index);
    
    // Mission status
    MissionStatus get_mission_status() const;
    bool is_mission_active() const { return mission_status_.mission_running; }

    // --- mission flown by the PX4 external mode PATROL (drone_patrol) instead of OFFBOARD ---
    // Marks the mission running/delegated and fills the plan to publish. resume=true continues from current_item.
    // home_alt_amsl: NaN when airborne (no takeoff); else takeoff altitude = home_alt_amsl - z of the first item.
    bool start_delegated(bool resume, float home_alt_amsl, drone_interfaces::msg::PatrolPlan& plan, std::string& why);
    // Mirror drone_patrol's progress into mission_status_ (only for the plan we sent).
    void apply_patrol_status(const drone_interfaces::msg::PatrolStatus& s);
    // 1 Hz: fail if PX4 never handed the mission to PATROL within 5 s, or if PATROL's heartbeat is lost.
    void check_delegated(bool heartbeat_fresh);
    bool is_delegated() const { std::lock_guard<std::mutex> l(status_mutex_); return delegated_; }

private:
    // ROS 2 node reference
    rclcpp::Node* node_;
    std::string namespace_;
    
    // Publishers
    // Vehicle commands go through DroneAgent (correct PX4 namespace, target_system = mav_sys_id, ack handling).
    std::function<void(uint16_t, float, float, float)> command_sender_;
    
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
    std::optional<std::chrono::steady_clock::time_point> hold_until_;
    std::function<void(const std::string&)> failure_handler_;
    // OFFBOARD engagement: the leg clock only runs while PX4 is in OFFBOARD; if PX4 is not in OFFBOARD within
    // OFFBOARD_ENGAGE_TIMEOUT_S of START, the mission fails.
    bool offboard_engaged_{false};
    bool delegated_{false};           // current run is flown by PATROL
    bool delegated_engaged_{false};   // PATROL reported TAKEOFF/PATROL for our plan
    uint32_t plan_seq_{0};
    std::chrono::steady_clock::time_point mission_start_time_;
    static constexpr float OFFBOARD_ENGAGE_TIMEOUT_S = 5.0f;
    void fail_mission_locked(const std::string& reason, bool request_hold, std::unique_lock<std::mutex>& lock);
    std::function<void(uint16_t)> mode_command_handler_;
    static constexpr float WAYPOINT_ACCEPTANCE_RADIUS = 2.0f; // meters
    // Legs are flown with PX4 GotoSetpoint (PX4 does the jerk-limited smoothing).
    static constexpr float DEFAULT_CRUISE_SPEED = 5.0f;
    static constexpr float MIN_CRUISE_SPEED = 1.0f;
    static constexpr float MAX_CRUISE_SPEED = 10.0f;  // = MPC_XY_CRUISE on the sim drones; PX4 clamps Goto speed to it
    static constexpr float MAX_VERTICAL_SPEED = 2.0f; // m/s, Goto max_vertical_speed (PX4 clamps to MPC_Z_V_AUTO_UP/DN)
    float cruise_speed_{DEFAULT_CRUISE_SPEED};
    float leg_expected_s_{5.0f};  // expected leg duration, computed at leg start (timeout = 2x)
    static constexpr float WAYPOINT_TIMEOUT_MULTIPLIER = 2.0f; // Timeout = 2x expected time
    
    // Callback methods
    void mission_result_callback(const px4_msgs::msg::MissionResult::SharedPtr msg);
    void navigator_mission_item_callback(const px4_msgs::msg::NavigatorMissionItem::SharedPtr msg);
    
    // Helper methods
public:
    /** Wire MissionManager to DroneAgent's vehicle-command path (call once from DroneController). */
    void set_command_sender(std::function<void(uint16_t, float, float, float)> sender) { command_sender_ = std::move(sender); }
    /** Subscribe to PX4 mission topics under the drone's PX4 namespace (e.g. "/px4_1/fmu/"). */
    void subscribe_px4_topics(const std::string& px4_namespace);
private:
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
    static constexpr uint16_t VEHICLE_CMD_NAV_RETURN_TO_LAUNCH = 20;
    static constexpr uint16_t VEHICLE_CMD_NAV_LOITER_UNLIM = 17;
    static constexpr uint16_t VEHICLE_CMD_DO_PAUSE_CONTINUE = 193;
    
    // MAVLink mission protocol constants
    static constexpr uint16_t MAV_CMD_MISSION_COUNT = 44;
    static constexpr uint16_t MAV_CMD_MISSION_ITEM_INT = 73;
};

} // namespace drone_core