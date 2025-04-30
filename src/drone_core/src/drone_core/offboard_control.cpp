/**
 * @file offboard_control.cpp
 * @brief Implementation of the OffboardControl class for PX4 flight controller integration
 * 
 * This file implements the OffboardControl class which provides an interface for controlling
 * a PX4-based drone in offboard mode. It handles the communication with PX4 through ROS 2
 * topics and services, managing the transition to offboard mode, arming, and trajectory control.
 */

#include "drone_core/offboard_control.hpp"
using namespace std::chrono_literals;

/**
 * @brief Constructs an OffboardControl instance
 * 
 * Initializes publishers and clients for PX4 communication. Sets up the offboard control mode
 * publisher, trajectory setpoint publisher, and vehicle command client.
 * 
 * @param node Pointer to the ROS 2 node
 * @param px4_namespace Namespace for PX4 communication topics
 */
OffboardControl::OffboardControl(rclcpp::Node* node, const std::string& px4_namespace)
    : node_(node), ns_(px4_namespace)
{
    offboard_control_mode_pub_ = node_->create_publisher<px4_msgs::msg::OffboardControlMode>(ns_ + "in/offboard_control_mode", 10);
    trajectory_setpoint_pub_ = node_->create_publisher<px4_msgs::msg::TrajectorySetpoint>(ns_ + "in/trajectory_setpoint", 10);
    RCLCPP_INFO(node_->get_logger(), "[OffboardControl] Initialized publishers for OffboardControlMode and TrajectorySetpoint.");
}

/**
 * @brief Destructor for OffboardControl.
 */
OffboardControl::~OffboardControl() {
    RCLCPP_INFO(node_->get_logger(), "[OffboardControl] Destructor called. Stopping timer...");
    stop(); // Ensure the timer is stopped and reset
}

/**
 * @brief Starts the offboard control mode
 * 
 * Initializes the timer for publishing offboard control mode messages at 10 Hz (recommended for offboard control)
 * and begins the state machine for transitioning to offboard mode.
 */
void OffboardControl::start() {
    if (!offboard_control_loop_timer_) {
        // Set timer to 100ms (10 Hz) as recommended for offboard control
        offboard_control_loop_timer_ = node_->create_wall_timer(
            100ms,
            [this]() { offboard_control_loop_timer_callback(); }
        );
        RCLCPP_INFO(node_->get_logger(), "[OffboardControl] Started offboard control mode publisher at 10 Hz");
    }
}

/**
 * @brief Stops the offboard control mode
 * 
 * Cancels the timer and stops publishing offboard control mode messages.
 */
void OffboardControl::stop() {
    if (offboard_control_loop_timer_) {
        offboard_control_loop_timer_->cancel();
        offboard_control_loop_timer_.reset();
        RCLCPP_INFO(node_->get_logger(), "[OffboardControl] Stopped offboard control mode publisher");
    }
}

/**
 * @brief Timer callback for publishing offboard control mode messages
 * 
 * This callback is executed at 10 Hz and handles:
 * 1. Publishing the offboard control mode message
 * 2. Publishing the latest trajectory setpoint
 */
void OffboardControl::offboard_control_loop_timer_callback() {
    std::lock_guard<std::mutex> lock(data_mutex_); // Lock for reading targets

    // Determine current control type
    OffboardSetpointType current_type = current_setpoint_type_.load(std::memory_order_relaxed);

    // Publish offboard control mode, setting appropriate flags
    px4_msgs::msg::OffboardControlMode mode_msg{};
    mode_msg.position = (current_type == OffboardSetpointType::POSITION);
    mode_msg.velocity = (current_type == OffboardSetpointType::VELOCITY);
    mode_msg.acceleration = false;
    mode_msg.attitude = false;
    mode_msg.body_rate = false;
    mode_msg.timestamp = node_->get_clock()->now().nanoseconds() / 1000;
    offboard_control_mode_pub_->publish(mode_msg);

    // Publish the latest trajectory setpoint based on type
    px4_msgs::msg::TrajectorySetpoint sp_msg{};
    if (current_type == OffboardSetpointType::POSITION) {
        sp_msg.position = {target_x_, target_y_, target_z_};
        sp_msg.velocity = {NAN, NAN, NAN}; // Indicate velocity is not controlled
        sp_msg.yaw = target_yaw_;
        sp_msg.yawspeed = NAN;
    } else { // VELOCITY
        sp_msg.position = {NAN, NAN, NAN}; // Indicate position is not controlled
        sp_msg.velocity = {target_vx_, target_vy_, target_vz_};
        sp_msg.yaw = NAN; // Yaw controlled by rate
        sp_msg.yawspeed = target_yaw_rate_;
    }
    sp_msg.timestamp = node_->get_clock()->now().nanoseconds() / 1000;
    trajectory_setpoint_pub_->publish(sp_msg);

}

/**
 * @brief Publishes a **position** trajectory setpoint to PX4
 * 
 * Sends a desired target position (X, Y, Z in local NED frame) and yaw angle.
 * PX4's flight controller will then work to reach and maintain this pose.
 * Velocity components are explicitly ignored by setting them to NAN.
 * 
 * @param x X position in meters (NED frame)
 * @param y Y position in meters (NED frame)
 * @param z Z position in meters (NED frame, positive down)
 * @param yaw Yaw angle in radians
 */
void OffboardControl::set_target_position(float x, float y, float z, float yaw) {
    std::lock_guard<std::mutex> lock(data_mutex_); // Lock for writing targets
    // Store the latest setpoint locally for the timer loop
    target_x_ = x;
    target_y_ = y;
    target_z_ = z;
    target_yaw_ = yaw;
    // Set the internal flag indicating the active setpoint type is POSITION
    current_setpoint_type_.store(OffboardSetpointType::POSITION, std::memory_order_relaxed);

    // Publish it once immediately for responsiveness (the timer loop will continue publishing)
    px4_msgs::msg::TrajectorySetpoint msg{};
    // Set the target position fields
    msg.position = {target_x_, target_y_, target_z_}; 
    // Mark velocity fields as invalid/unused for this setpoint type
    msg.velocity = {NAN, NAN, NAN}; 
    // Set the target yaw field
    msg.yaw = target_yaw_; 
    // Mark yaw rate field as invalid/unused for this setpoint type
    msg.yawspeed = NAN; 
    msg.timestamp = node_->get_clock()->now().nanoseconds() / 1000;
    trajectory_setpoint_pub_->publish(msg);
}

/**
 * @brief Publishes a **velocity** trajectory setpoint to PX4
 * 
 * Sends a desired target velocity (Vx, Vy, Vz in local NED frame) and yaw rate.
 * PX4's flight controller will work to achieve and maintain these rates.
 * Position components are explicitly ignored by setting them to NAN.
 * 
 * @param vx X velocity in m/s (NED frame)
 * @param vy Y velocity in m/s (NED frame)
 * @param vz Z velocity in m/s (NED frame, positive down)
 * @param yaw_rate Target yaw rate in rad/s (positive clockwise looking down)
 */
void OffboardControl::set_target_velocity(float vx, float vy, float vz, float yaw_rate) {
    std::lock_guard<std::mutex> lock(data_mutex_); // Lock for writing targets
    // Store the latest velocity setpoint locally for the timer loop
    target_vx_ = vx;
    target_vy_ = vy;
    target_vz_ = vz;
    target_yaw_rate_ = yaw_rate;
    // Set the internal flag indicating the active setpoint type is VELOCITY
    current_setpoint_type_.store(OffboardSetpointType::VELOCITY, std::memory_order_relaxed);

    // Publish it once immediately for responsiveness (the timer loop will continue publishing)
    px4_msgs::msg::TrajectorySetpoint msg{};
    // Mark position fields as invalid/unused for this setpoint type
    msg.position = {NAN, NAN, NAN}; 
    // Set the target velocity fields
    msg.velocity = {target_vx_, target_vy_, target_vz_}; 
    // Mark yaw field as invalid/unused for this setpoint type
    msg.yaw = NAN; 
    // Set the target yaw rate field
    msg.yawspeed = target_yaw_rate_; 
    msg.timestamp = node_->get_clock()->now().nanoseconds() / 1000;
    trajectory_setpoint_pub_->publish(msg);
} 