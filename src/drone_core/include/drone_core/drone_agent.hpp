/**
 * @file drone_agent.hpp
 * @brief Defines the DroneAgent class for sending commands to PX4 autopilot
 */

#pragma once

#include <rclcpp/rclcpp.hpp>
#include <px4_msgs/srv/vehicle_command.hpp>
#include <px4_msgs/msg/vehicle_command.hpp>
#include <functional>
#include <deque>

/**
 * @class DroneAgent
 * @brief Handles communication with PX4 autopilot through ROS2 services
 * 
 * This class provides a simplified interface for sending vehicle commands
 * to the PX4 autopilot. It handles the creation of service clients and
 * provides a callback mechanism for command results.
 */
class DroneAgent {
public:
    static constexpr uint8_t RESULT_NO_REPLY = 255;
    /**
     * @brief Constructs a new DroneAgent instance
     * 
     * Initializes the command relay with a ROS2 node and sets up the
     * vehicle command service client.
     * 
     * @param node Pointer to the ROS2 node
     * @param ns PX4 namespace for communication
     * @param name Name of the drone for logging
     * @param mav_sys_id MAVLink System ID of the target PX4
     */
    DroneAgent(rclcpp::Node* node, const std::string& ns, const std::string& name, int mav_sys_id);

    /**
     * @brief Destructor for DroneAgent.
     * Ensures the service client is released.
     */
    ~DroneAgent();

    bool is_service_ready() const;

    /**
     * @brief Sends a command to the PX4 autopilot
     * 
     * Creates and sends a vehicle command with the specified parameters.
     * The result is handled asynchronously through the provided callback.
     * 
     * @param command The command ID (from px4_msgs::msg::VehicleCommand)
     * @param param1 First parameter for the command
     * @param param2 Second parameter for the command
     * @param callback Function to be called with the command result
     */
    void sendVehicleCommand(uint32_t command, float param1 = 0.0f, float param2 = 0.0f,
              std::function<void(uint8_t)> callback = [](uint8_t){},
              float param7 = NAN, float param3 = 0.0f);

    /** All seven VehicleCommand params (param5/6 are float64 in px4_msgs release/1.15 VehicleCommand.msg:175-176). */
    void sendVehicleCommandFull(uint32_t command, float p1, float p2, float p3, float p4,
                                double p5, double p6, float p7, std::function<void(uint8_t)> callback);

    /** PX4's reply: the vehicle_command_ack forwarded by PX4's VehicleCommand service, which only replies with an
     *  ack for the same command id newer than the request (PX4 v1.15.4 uxrce_dds_client/vehicle_command_srv.cpp:66-75;
     *  fields px4_msgs release/1.15 VehicleCommandAck.msg:26-29). replied=false: no ack within the timeout. */
    struct Ack {
        uint32_t command{0};
        bool replied{false};
        uint8_t result{RESULT_NO_REPLY};
        uint8_t result_param1{0};
        int32_t result_param2{0};
        bool effect_seen{false};   // no ack, but vehicle_status shows the requested effect (see set_effect_checker)
        bool accepted() const { return (replied && (result == 0 || result == 5)) || effect_seen; }  // ACCEPTED / IN_PROGRESS
    };
    /** Effect checker for commands PX4 did not ack: 1 = vehicle_status shows the requested effect, 0 = it does not,
     *  -1 = the command has no observable effect (stays a failure). Called once when the reply times out. */
    using EffectChecker = std::function<int(const px4_msgs::msg::VehicleCommand& cmd)>;
    void set_effect_checker(EffectChecker checker) { effect_checker_ = std::move(checker); }
    void sendCommand(uint32_t command, float p1, float p2, float p3, float p4, double p5, double p6, float p7,
                     std::function<void(const Ack&)> callback);
    static std::string command_name(uint32_t command);
    static std::string result_name(uint8_t result);
    /** "PX4 DENIED VEHICLE_CMD_DO_ORBIT (result_param1=0, result_param2=0)" / "no ack from PX4 within 1.5 s ..." */
    static std::string describe(const Ack& ack);

private:
    /**
     * @brief Logs the result of a command
     * 
     * @param result The result code from the PX4 autopilot
     */
    void log_result(uint8_t result);

    rclcpp::Node* node_;                    ///< Pointer to ROS2 node
    std::string name_;                      ///< Name of the drone for logging
    int mav_sys_id_;                      ///< MAVLink System ID of the target drone
    rclcpp::Client<px4_msgs::srv::VehicleCommand>::SharedPtr client_;    ///< Service client for vehicle commands

    // PX4's uXRCE vehicle_command service handles one request at a time; a request sent while
    // another is pending can be dropped without a reply. Commands are therefore queued and sent
    // one by one: the next goes out when the previous reply arrives or after a timeout.
    struct PendingCommand {
        std::shared_ptr<px4_msgs::srv::VehicleCommand::Request> request;
        std::function<void(uint8_t)> callback;
        bool notify_on_timeout{false};  // Full commands: callback(RESULT_NO_REPLY) if PX4 does not answer
        std::function<void(const Ack&)> ack_callback;  // sendCommand: full ack, also called on timeout
    };
public:
private:
    std::function<void(uint8_t)> timeout_callback_;
    std::function<void(uint8_t)> timeout_plain_callback_;   // sendVehicleCommand callback: only called if effect seen
    std::shared_ptr<px4_msgs::srv::VehicleCommand::Request> in_flight_request_;
    EffectChecker effect_checker_;
    // Ack statistics (logged on every missing ack and every 10 min)
    uint64_t stat_sent_{0}, stat_acked_{0}, stat_no_ack_{0}, stat_no_ack_effect_{0};
    rclcpp::TimerBase::SharedPtr stats_timer_;
    std::string ack_stats() const;
    std::function<void(const Ack&)> timeout_ack_callback_;
    void send_next_command();
    void finish_command(uint64_t seq);
    std::deque<PendingCommand> command_queue_;
    bool command_in_flight_{false};
    uint64_t command_seq_{0};
    rclcpp::TimerBase::SharedPtr command_timeout_timer_;
    static constexpr std::chrono::milliseconds COMMAND_REPLY_TIMEOUT{1500};
}; 