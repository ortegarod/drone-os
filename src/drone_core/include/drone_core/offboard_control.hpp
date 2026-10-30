/**
 * @file offboard_control.hpp
 * @brief Defines the OffboardControl class for managing offboard control mode
 */

#pragma once

#include <rclcpp/rclcpp.hpp>
#include <px4_msgs/msg/offboard_control_mode.hpp>
#include <px4_msgs/msg/trajectory_setpoint.hpp>
#include <px4_msgs/msg/goto_setpoint.hpp>
#include <memory>
#include <atomic>
#include <mutex>

/**
 * @class OffboardControl
 * @brief Manages offboard control mode and trajectory setpoints
 * 
 * This class handles:
 * - Continuous publishing of offboard control mode messages
 * - On-demand publishing of trajectory setpoints
 */
class OffboardControl {
public:
    /**
     * @brief Enumeration for setpoint type
     */
    enum class OffboardSetpointType {
        POSITION,
        VELOCITY,
        GOTO   // PX4-smoothed goto: publish GotoSetpoint instead of TrajectorySetpoint
    };

    /**
     * @brief Construct a new OffboardControl object
     * @param node Pointer to the ROS2 node
     * @param px4_namespace PX4 namespace for communication
     */
    OffboardControl(rclcpp::Node* node, const std::string& px4_namespace);

    /**
     * @brief Destructor for OffboardControl.
     * Ensures the timer is stopped.
     */
    ~OffboardControl();

    /**
     * @brief Start publishing offboard control mode messages and state machine
     */
    void start();

    /**
     * @brief Stop publishing offboard control mode messages
     */
    void stop();

    /** @brief True while the 10 Hz setpoint publisher is running */
    bool is_active() const { return static_cast<bool>(offboard_control_loop_timer_); }

    /**
     * @brief Publish a trajectory setpoint
     * @param x Target x position in meters
     * @param y Target y position in meters
     * @param z Target z position in meters
     * @param yaw Target yaw angle in radians
     */
    void set_target_position(float x, float y, float z, float yaw);

    /**
     * Fly to a position with PX4's jerk-limited GotoControl (PX4 v1.15.4 src/modules/mc_pos_control/GotoControl).
     * While active, the 10 Hz loop publishes OffboardControlMode(position=true) + GotoSetpoint and no
     * TrajectorySetpoint (GotoControl publishes trajectory_setpoint itself; two writers would conflict).
     * PX4 clamps max_horizontal_speed to MPC_XY_CRUISE and max_vertical_speed to MPC_Z_V_AUTO_UP/DN.
     */
    void set_goto_target(float x, float y, float z, float yaw, float max_horizontal_speed, float max_vertical_speed);

    /**
     * @brief Publish a velocity setpoint
     * @param vx Target x velocity in meters per second
     * @param vy Target y velocity in meters per second
     * @param vz Target z velocity in meters per second
     * @param yaw_rate Target yaw rate in radians per second
     */
    void set_target_velocity(float vx, float vy, float vz, float yaw_rate = NAN);

private:
    /**
     * @brief Timer callback for publishing offboard control mode and state machine
     */
    void offboard_control_loop_timer_callback();

    /**
     * @brief Send a vehicle command to PX4
     * @param command Command code
     * @param param1 First parameter
     * @param param2 Second parameter
     */
    void send_vehicle_command(uint16_t command, float param1 = 0.0f, float param2 = 0.0f);

    rclcpp::Node* node_;                    ///< Pointer to ROS2 node
    std::string ns_;                        ///< PX4 namespace
    rclcpp::TimerBase::SharedPtr offboard_control_loop_timer_;    ///< Timer for periodic publishing (renamed from timer_)
    rclcpp::Publisher<px4_msgs::msg::OffboardControlMode>::SharedPtr offboard_control_mode_pub_;    ///< Publisher for offboard control mode
    rclcpp::Publisher<px4_msgs::msg::TrajectorySetpoint>::SharedPtr trajectory_setpoint_pub_;
    rclcpp::Publisher<px4_msgs::msg::GotoSetpoint>::SharedPtr goto_setpoint_pub_;       ///< Publisher for trajectory setpoints

    // Store latest setpoint
    float target_x_{0.0f};
    float target_y_{0.0f};
    float target_z_{0.0f};
    float target_yaw_{0.0f};
    float target_vx_{0.0f};
    float target_vy_{0.0f};
    float target_vz_{0.0f};
    float target_yaw_rate_{NAN};
    float goto_max_h_speed_{NAN};
    float goto_max_v_speed_{NAN};

    // Added atomic variable for current setpoint type
    std::atomic<OffboardSetpointType> current_setpoint_type_{OffboardSetpointType::POSITION};
    // Mutex to protect target access
    mutable std::mutex data_mutex_;
}; 