/**
 * @file drone_controller.hpp
 * @brief Defines the DroneController class for managing drone operations and state
 */

#pragma once

#include <rclcpp/rclcpp.hpp>
#include "drone_core/drone_agent.hpp"
#include "drone_core/offboard_control.hpp"
#include "drone_core/mission_manager.hpp"
#include "drone_core/failsafe_monitor.hpp"
#include <memory>
#include <future>     // Used for sync methods
#include <chrono>     // Used for sync methods
#include "drone_core/utils/state_enums.hpp" // Used for state enums and potentially Command struct
#include "drone_core/drone_state.hpp" // Used for DroneState member
#include <std_srvs/srv/trigger.hpp> // Used for Trigger services
#include <vector> // Potentially used internally or by included headers
#include <cmath> // Used for std::isnan in cpp, potentially by included headers
#include <drone_interfaces/srv/set_position.hpp> // Used for SetPosition service
#include <drone_interfaces/srv/get_state.hpp> // Used for GetState service
#include <drone_interfaces/srv/upload_mission.hpp> // Used for mission services
#include <drone_interfaces/srv/mission_control.hpp>
#include <drone_interfaces/srv/get_mission_status.hpp>
#include <drone_interfaces/srv/takeoff.hpp>
#include <drone_interfaces/srv/goto_location.hpp>
#include <drone_interfaces/srv/orbit.hpp>
#include <drone_interfaces/msg/patrol_plan.hpp>
#include <drone_interfaces/msg/patrol_status.hpp>
#include <std_msgs/msg/string.hpp>
#include <mutex>

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
     * @param mav_sys_id MAVLink System ID of the target PX4
     */
    DroneController(rclcpp::Node* node, const std::string& name, const std::string& px4_namespace, int mav_sys_id);

    /**
     * @brief Destroy the Drone Controller object
     * Cleans up resources, like joining the agent thread.
     */
    ~DroneController();

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
     * @brief Command the drone to return to launch
     */
    void return_to_launch();

    /**
     * @brief Emergency flight termination (immediate motor cutoff)
     */
    void flight_termination();

    /**
     * @brief Set the drone to position control mode
     */
    void set_position_mode();

    /**
     * @brief Set the drone to altitude control mode
     */
    void set_altitude_mode();

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
     * @brief Get current failsafe status
     * @return Current FailsafeStatus structure
     */
    const drone_core::FailsafeStatus& getFailsafeStatus() const;

    /**
     * @brief Check if drone is safe for mission execution
     * @return true if safe, false if failsafe conditions present
     */
    bool isSafeForMission() const;

    /**
     * @brief Get human-readable failsafe description
     * @return String description of current failsafe state
     */
    std::string getFailsafeDescription() const;

private:
    rclcpp::Node* node_;                    ///< Pointer to ROS2 node
    std::string name_;                      ///< Name of the drone
    std::string ns_;                        ///< PX4 namespace

    float target_x_ = 0.0f;                 ///< Target x position for commands
    float target_y_ = 0.0f;                 ///< Target y position for commands
    float target_z_ = 0.0f;                 ///< Target z position
    float target_yaw_ = 0.0f;               ///< Target yaw angle

    // Core Components
    std::unique_ptr<DroneAgent> drone_agent_;    ///< Command relay for PX4 communication
    std::unique_ptr<OffboardControl> offboard_control_;    ///< Offboard control manager
    std::unique_ptr<DroneState> drone_state_;       ///< Drone state tracker
    std::unique_ptr<drone_core::MissionManager> mission_manager_;  ///< Mission planning and execution
    std::unique_ptr<drone_core::FailsafeMonitor> failsafe_monitor_; ///< Failsafe monitoring and safety checks

    // ROS 2 Services (Added)
    rclcpp::Service<std_srvs::srv::Trigger>::SharedPtr arm_service_;
    rclcpp::Service<std_srvs::srv::Trigger>::SharedPtr takeoff_service_;
    rclcpp::Service<std_srvs::srv::Trigger>::SharedPtr land_service_;
    rclcpp::Service<std_srvs::srv::Trigger>::SharedPtr disarm_service_;
    rclcpp::Service<std_srvs::srv::Trigger>::SharedPtr set_offboard_service_;
    rclcpp::Service<std_srvs::srv::Trigger>::SharedPtr set_position_mode_service_;
    rclcpp::Service<std_srvs::srv::Trigger>::SharedPtr return_to_launch_service_;
    rclcpp::Service<std_srvs::srv::Trigger>::SharedPtr flight_termination_service_;
    rclcpp::Service<drone_interfaces::srv::SetPosition>::SharedPtr set_position_service_; // Added SetPosition service
    rclcpp::Service<drone_interfaces::srv::GetState>::SharedPtr get_state_service_; // Added GetState service
    
    // Mission Services
    rclcpp::Service<drone_interfaces::srv::UploadMission>::SharedPtr upload_mission_service_;
    rclcpp::Service<drone_interfaces::srv::MissionControl>::SharedPtr mission_control_service_;
    rclcpp::Service<drone_interfaces::srv::GetMissionStatus>::SharedPtr get_mission_status_service_;

    // TODO: Add services for RTL, SetBehavior, etc. later

    /**
     * @brief Internal helper to send a VEHICLE_CMD_DO_SET_MODE command
     * @param mode The target Px4CustomMode
     */
    void set_mode(Px4CustomMode mode);

    // After an RTL/LAND, PX4 restores the previous mode (OFFBOARD) on disarm even though no
    // setpoints are streaming. This 1 Hz check puts a disarmed vehicle in that state back into Hold.
    void post_flight_check();
    rclcpp::TimerBase::SharedPtr post_flight_timer_;
    int offboard_idle_ticks_{0};
    int offboard_disarmed_ticks_{0};  // seconds the setpoint stream has run while disarmed

    // Hard rule: once PX4 leaves OFFBOARD (failsafe, RC, GCS, anything), stop publishing
    // offboard setpoints and abort any running mission, so PX4's own mode (e.g. RTL) is never fought.
    void offboard_guard_check();
    rclcpp::TimerBase::SharedPtr offboard_guard_timer_;
    NavState last_nav_state_{NavState::UNKNOWN};

    /**
     * @brief Internal helper to send VEHICLE_CMD_DO_SET_MODE and wait for acknowledgement.
     * @param mode The target Px4CustomMode.
     * @param timeout_ms Maximum time to wait for acknowledgement.
     * @return true if command acknowledged successfully, false otherwise.
     */
    bool set_mode_sync(Px4CustomMode mode, std::chrono::milliseconds timeout_ms);

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

    void return_to_launch_callback(const std::shared_ptr<rmw_request_id_t> request_header,
                                   const std::shared_ptr<std_srvs::srv::Trigger::Request> request,
                                   std::shared_ptr<std_srvs::srv::Trigger::Response> response);

    void flight_termination_callback(const std::shared_ptr<rmw_request_id_t> request_header,
                                     const std::shared_ptr<std_srvs::srv::Trigger::Request> request,
                                     std::shared_ptr<std_srvs::srv::Trigger::Response> response);

    // Added SetPosition service callback declaration
    void set_position_callback(const std::shared_ptr<rmw_request_id_t> request_header,
                               const std::shared_ptr<drone_interfaces::srv::SetPosition::Request> request,
                               std::shared_ptr<drone_interfaces::srv::SetPosition::Response> response);

    // Added GetState service callback declaration
    void get_state_callback(const std::shared_ptr<rmw_request_id_t> request_header,
                           const std::shared_ptr<drone_interfaces::srv::GetState::Request> request,
                           std::shared_ptr<drone_interfaces::srv::GetState::Response> response);

    // Mission service callbacks
    void upload_mission_callback(const std::shared_ptr<rmw_request_id_t> request_header,
                                const std::shared_ptr<drone_interfaces::srv::UploadMission::Request> request,
                                std::shared_ptr<drone_interfaces::srv::UploadMission::Response> response);

    void mission_control_callback(const std::shared_ptr<rmw_request_id_t> request_header,
                                 const std::shared_ptr<drone_interfaces::srv::MissionControl::Request> request,
                                 std::shared_ptr<drone_interfaces::srv::MissionControl::Response> response);

    void get_mission_status_callback(const std::shared_ptr<rmw_request_id_t> request_header,
                                    const std::shared_ptr<drone_interfaces::srv::GetMissionStatus::Request> request,
                                    std::shared_ptr<drone_interfaces::srv::GetMissionStatus::Response> response);

    // --- PX4-native actions (drone_controller_px4.cpp). Deferred-response services: the reply is sent
    // when PX4 acknowledges, so callers get PX4's verdict without blocking the executor. ---
    rclcpp::Service<drone_interfaces::srv::Takeoff>::SharedPtr takeoff_to_service_;
    rclcpp::Service<std_srvs::srv::Trigger>::SharedPtr hold_service_;
    rclcpp::Service<drone_interfaces::srv::GotoLocation>::SharedPtr goto_location_service_;
    rclcpp::Service<drone_interfaces::srv::Orbit>::SharedPtr orbit_service_;
    std::vector<rclcpp::TimerBase::SharedPtr> oneshot_timers_;
    void create_px4_action_services();
    void create_ack_trigger_services();
    void release_control_to_px4(const char* why);  // stop mission + offboard stream before a PX4 mode takes over
    void run_after(std::chrono::milliseconds delay, std::function<void()> fn);

    // --- PX4 external mode PATROL (drone_patrol) ---
    rclcpp::Publisher<drone_interfaces::msg::PatrolPlan>::SharedPtr patrol_plan_pub_;
    rclcpp::Subscription<drone_interfaces::msg::PatrolStatus>::SharedPtr patrol_status_sub_;
    mutable std::mutex patrol_mutex_;
    drone_interfaces::msg::PatrolStatus patrol_status_;
    std::chrono::steady_clock::time_point patrol_rx_{};
    int external_stuck_ticks_{0};
    static constexpr double PATROL_HEARTBEAT_TIMEOUT_S = 1.0;
    void setup_patrol_link();
    bool patrol_fresh(drone_interfaces::msg::PatrolStatus* out = nullptr) const;  // heartbeat < 1 s old
    bool patrol_available(uint8_t& nav_state) const;  // fresh + registered with PX4

    // --- /<drone>/capabilities (std_msgs/String, JSON, transient_local) ---
    rclcpp::Publisher<std_msgs::msg::String>::SharedPtr capabilities_pub_;
    rclcpp::TimerBase::SharedPtr capabilities_timer_;
    std::string capabilities_last_;                       // last published content (without stamp)
    std::chrono::steady_clock::time_point capabilities_sent_{};
    void setup_capabilities();
    std::string capabilities_json(bool with_stamp) const;
    void publish_capabilities(bool force);
    // one job per drone; empty when a new mission (upload/START) may replace the current one
    std::string busy_reason(const char* what) const;
    bool patrol_start(bool is_start, std::string& message);
    void send_hold(const std::string& why);
    void external_mode_recovery();
    int command_effect_seen(const px4_msgs::msg::VehicleCommand& cmd) const;  // see DroneAgent::EffectChecker
    static std::string ack_to_string(uint8_t result);

    void takeoff_to_callback(rclcpp::Service<drone_interfaces::srv::Takeoff>::SharedPtr service,
                             const std::shared_ptr<rmw_request_id_t> header,
                             const std::shared_ptr<drone_interfaces::srv::Takeoff::Request> request);
    void takeoff_to_send(const std::function<void(bool, const std::string&)>& reply,
                         const std::shared_ptr<drone_interfaces::srv::Takeoff::Response>& resp,
                         float requested_altitude, float alt);
    void hold_callback(rclcpp::Service<std_srvs::srv::Trigger>::SharedPtr service,
                       const std::shared_ptr<rmw_request_id_t> header,
                       const std::shared_ptr<std_srvs::srv::Trigger::Request> request);
    void goto_location_callback(rclcpp::Service<drone_interfaces::srv::GotoLocation>::SharedPtr service,
                                const std::shared_ptr<rmw_request_id_t> header,
                                const std::shared_ptr<drone_interfaces::srv::GotoLocation::Request> request);
    void orbit_callback(rclcpp::Service<drone_interfaces::srv::Orbit>::SharedPtr service,
                        const std::shared_ptr<rmw_request_id_t> header,
                        const std::shared_ptr<drone_interfaces::srv::Orbit::Request> request);
};
