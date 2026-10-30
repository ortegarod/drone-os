/**
 * @file drone_agent.cpp
 * @brief Implementation of the DroneAgent class for sending commands to PX4 autopilot
 */

#include "drone_core/drone_agent.hpp"

/**
 * @brief Constructs a new DroneAgent instance
 * 
 * Initializes the command relay with a ROS2 node and sets up the vehicle command service client.
 * The constructor will wait for the service to become available before proceeding.
 * 
 * @param node Pointer to the ROS2 node
 * @param ns PX4 namespace for communication
 * @param name Name of the drone for logging
 * @param mav_sys_id MAVLink System ID of the target PX4
 */
DroneAgent::DroneAgent(rclcpp::Node* node, const std::string& ns, const std::string& name, int mav_sys_id)
    : node_(node), name_(name), mav_sys_id_(mav_sys_id)
{
    client_ = node_->create_client<px4_msgs::srv::VehicleCommand>(ns + "vehicle_command");
    RCLCPP_INFO(node_->get_logger(), "[%s][Agent] Vehicle command client created.", name_.c_str());
}

/**
 * @brief Destructor for DroneAgent.
 */
DroneAgent::~DroneAgent() {
    RCLCPP_INFO(node_->get_logger(), "[%s][Agent] Destructor called. Releasing service client...", name_.c_str());
    client_.reset(); // Explicitly reset the client shared pointer
    RCLCPP_INFO(node_->get_logger(), "[%s][Agent] Service client released.", name_.c_str());
}

/**
 * @brief Sends a command to the PX4 autopilot
 * 
 * Creates and sends a vehicle command with the specified parameters.
 * The command is sent asynchronously, and the result is handled through the provided callback.
 * 
 * @param command The command ID (from px4_msgs::msg::VehicleCommand)
 * @param param1 First parameter for the command
 * @param param2 Second parameter for the command
 * @param callback Function to be called with the command result
 */
void DroneAgent::sendVehicleCommand(uint32_t command, float param1, float param2,
          std::function<void(uint8_t)> callback, float param7, float param3)
{
    auto request = std::make_shared<px4_msgs::srv::VehicleCommand::Request>();
    px4_msgs::msg::VehicleCommand msg{};
    msg.param1 = param1;
    msg.param2 = param2;
    msg.param3 = param3;
    msg.param7 = param7;
    msg.command = command;
    msg.target_system = this->mav_sys_id_;
    msg.target_component = 1;
    msg.source_system = 1;
    msg.source_component = 1;
    msg.from_external = true;
    request->request = msg;
    command_queue_.push_back({request, callback});
    if (!command_in_flight_) {
        send_next_command();
    } else {
        RCLCPP_INFO(node_->get_logger(), "[%s][Agent] Command %u queued behind pending command (%zu waiting)",
                    name_.c_str(), command, command_queue_.size());
    }
}

void DroneAgent::sendVehicleCommandFull(uint32_t command, float p1, float p2, float p3, float p4,
                                        double p5, double p6, float p7, std::function<void(uint8_t)> callback)
{
    auto request = std::make_shared<px4_msgs::srv::VehicleCommand::Request>();
    px4_msgs::msg::VehicleCommand msg{};
    msg.param1 = p1;
    msg.param2 = p2;
    msg.param3 = p3;
    msg.param4 = p4;
    msg.param5 = p5;
    msg.param6 = p6;
    msg.param7 = p7;
    msg.command = command;
    msg.target_system = this->mav_sys_id_;
    msg.target_component = 1;
    msg.source_system = 1;
    msg.source_component = 1;
    msg.from_external = true;
    request->request = msg;
    command_queue_.push_back({request, callback, true});
    if (!command_in_flight_) {
        send_next_command();
    }
}

void DroneAgent::sendCommand(uint32_t command, float p1, float p2, float p3, float p4, double p5, double p6, float p7,
                             std::function<void(const Ack&)> callback)
{
    auto request = std::make_shared<px4_msgs::srv::VehicleCommand::Request>();
    px4_msgs::msg::VehicleCommand msg{};
    msg.param1 = p1; msg.param2 = p2; msg.param3 = p3; msg.param4 = p4;
    msg.param5 = p5; msg.param6 = p6; msg.param7 = p7;
    msg.command = command;
    msg.target_system = this->mav_sys_id_;
    msg.target_component = 1;
    msg.source_system = 1;
    msg.source_component = 1;
    msg.from_external = true;
    request->request = msg;
    PendingCommand pc;
    pc.request = request;
    pc.callback = [](uint8_t) {};
    pc.ack_callback = callback;
    command_queue_.push_back(pc);
    if (!command_in_flight_) {
        send_next_command();
    }
}

std::string DroneAgent::command_name(uint32_t c)
{
    using VC = px4_msgs::msg::VehicleCommand;
    switch (c) {
        case VC::VEHICLE_CMD_COMPONENT_ARM_DISARM: return "ARM_DISARM";
        case VC::VEHICLE_CMD_NAV_TAKEOFF: return "NAV_TAKEOFF";
        case VC::VEHICLE_CMD_NAV_LAND: return "NAV_LAND";
        case VC::VEHICLE_CMD_NAV_RETURN_TO_LAUNCH: return "NAV_RETURN_TO_LAUNCH";
        case VC::VEHICLE_CMD_DO_SET_MODE: return "DO_SET_MODE";
        case VC::VEHICLE_CMD_DO_REPOSITION: return "DO_REPOSITION";
        case VC::VEHICLE_CMD_DO_ORBIT: return "DO_ORBIT";
        case VC::VEHICLE_CMD_DO_FLIGHTTERMINATION: return "DO_FLIGHTTERMINATION";
        case VC::VEHICLE_CMD_MISSION_START: return "MISSION_START";
        default: return "command " + std::to_string(c);
    }
}

std::string DroneAgent::result_name(uint8_t r)
{
    switch (r) {  // VehicleCommandAck.msg:8-14
        case 0: return "ACCEPTED";
        case 1: return "TEMPORARILY_REJECTED";
        case 2: return "DENIED";
        case 3: return "UNSUPPORTED";
        case 4: return "FAILED";
        case 5: return "IN_PROGRESS";
        case 6: return "CANCELLED";
        case RESULT_NO_REPLY: return "NO_REPLY";
        default: return "RESULT_" + std::to_string(r);
    }
}

std::string DroneAgent::describe(const Ack& a)
{
    if (!a.replied && a.effect_seen) {
        return "PX4 did " + command_name(a.command) + " but sent no ack (effect confirmed from vehicle_status)";
    }
    if (!a.replied) {
        return "no ack from PX4 for " + command_name(a.command) + " within " +
               std::to_string(COMMAND_REPLY_TIMEOUT.count()) + " ms; state unknown";
    }
    std::string s = "PX4 " + result_name(a.result) + " " + command_name(a.command);
    if (a.result_param1 != 0 || a.result_param2 != 0) {
        s += " (result_param1=" + std::to_string(a.result_param1) + ", result_param2=" + std::to_string(a.result_param2) + ")";
    }
    return s;
}

void DroneAgent::send_next_command()
{
    if (command_queue_.empty()) {
        command_in_flight_ = false;
        return;
    }
    PendingCommand next = std::move(command_queue_.front());
    command_queue_.pop_front();
    command_in_flight_ = true;
    const uint64_t seq = ++command_seq_;
    const uint32_t command = next.request->request.command;
    next.request->request.timestamp = node_->get_clock()->now().nanoseconds() / 1000;

    auto callback = next.callback;
    auto ack_callback = next.ack_callback;
    timeout_callback_ = next.notify_on_timeout ? next.callback : std::function<void(uint8_t)>();
    timeout_ack_callback_ = ack_callback;
    timeout_plain_callback_ = next.notify_on_timeout ? std::function<void(uint8_t)>() : next.callback;
    in_flight_request_ = next.request;
    ++stat_sent_;
    if (!stats_timer_) {
        stats_timer_ = node_->create_wall_timer(std::chrono::minutes(10), [this]() {
            if (stat_sent_ > 0) RCLCPP_INFO(node_->get_logger(), "[%s][Agent] %s", name_.c_str(), ack_stats().c_str());
        });
    }
    client_->async_send_request(next.request,
        [this, callback, ack_callback, seq, command](rclcpp::Client<px4_msgs::srv::VehicleCommand>::SharedFuture future) {
            const auto reply = future.get()->reply;
            if (seq != command_seq_ || !command_in_flight_) {
                return;  // reply after timeout: the timeout path already handled this command
            }
            timeout_callback_ = nullptr;
            timeout_ack_callback_ = nullptr;
            timeout_plain_callback_ = nullptr;
            ++stat_acked_;
            log_result(reply.result);
            Ack ack;
            ack.command = command;
            ack.replied = true;
            ack.result = reply.result;
            ack.result_param1 = reply.result_param1;
            ack.result_param2 = reply.result_param2;
            if (reply.command != command) {  // PX4 matches ids (vehicle_command_srv.cpp:71); guard anyway
                ack.replied = false;
            }
            callback(reply.result);
            if (ack_callback) ack_callback(ack);
            finish_command(seq);
        });

    if (command_timeout_timer_) {
        command_timeout_timer_->cancel();
    }
    command_timeout_timer_ = node_->create_wall_timer(COMMAND_REPLY_TIMEOUT, [this, seq, command]() {
        if (seq == command_seq_ && command_in_flight_) {
            auto cb = timeout_callback_;
            auto acb = timeout_ack_callback_;
            auto pcb = timeout_plain_callback_;
            auto req = in_flight_request_;
            timeout_callback_ = nullptr;
            timeout_ack_callback_ = nullptr;
            timeout_plain_callback_ = nullptr;
            // no ack -> look at vehicle_status for the requested effect before reporting
            const int effect = (effect_checker_ && req) ? effect_checker_(req->request) : -1;
            ++stat_no_ack_;
            if (effect == 1) ++stat_no_ack_effect_;
            RCLCPP_WARN(node_->get_logger(), "[%s][Agent] No ack for %s within %ld ms; vehicle_status: %s. %s",
                        name_.c_str(), command_name(command).c_str(), static_cast<long>(COMMAND_REPLY_TIMEOUT.count()),
                        effect == 1 ? "effect seen (treated as accepted)" : effect == 0 ? "effect NOT seen" : "no observable effect",
                        ack_stats().c_str());
            finish_command(seq);
            Ack a;
            a.command = command;
            a.effect_seen = effect == 1;
            if (effect == 1) {
                if (cb) cb(0);
                if (pcb) pcb(0);
            } else if (cb) {
                cb(RESULT_NO_REPLY);
            }
            if (acb) acb(a);
        }
    });
}

void DroneAgent::finish_command(uint64_t seq)
{
    if (seq != command_seq_ || !command_in_flight_) {
        return;  // late reply for a command that already timed out
    }
    if (command_timeout_timer_) {
        command_timeout_timer_->cancel();
        command_timeout_timer_.reset();
    }
    command_in_flight_ = false;
    send_next_command();
}

/**
 * @brief Logs the result of a command
 * 
 * Logs the command result with appropriate severity level based on the result code.
 * 
 * @param result The result code from the PX4 autopilot:
 *              - 0: Command accepted
 *              - 1: Command temporarily rejected
 *              - 2: Command denied
 *              - 3: Command unsupported
 *              - 4: Command failed
 *              - Other: Unknown result
 */
void DroneAgent::log_result(uint8_t result)
{
    switch (result) {
        case 0:  // VEHICLE_CMD_RESULT_ACCEPTED
            RCLCPP_INFO(node_->get_logger(), "[%s][Agent] Command accepted", name_.c_str());
            break;
        case 1:  // VEHICLE_CMD_RESULT_TEMPORARILY_REJECTED
            RCLCPP_WARN(node_->get_logger(), "[%s][Agent] Command temporarily rejected", name_.c_str());
            break;
        case 2:  // VEHICLE_CMD_RESULT_DENIED
            RCLCPP_WARN(node_->get_logger(), "[%s][Agent] Command denied", name_.c_str());
            break;
        case 3:  // VEHICLE_CMD_RESULT_UNSUPPORTED
            RCLCPP_WARN(node_->get_logger(), "[%s][Agent] Command unsupported", name_.c_str());
            break;
        case 4:  // VEHICLE_CMD_RESULT_FAILED
            RCLCPP_WARN(node_->get_logger(), "[%s][Agentt] Command failed", name_.c_str());
            break;
        default:
            RCLCPP_WARN(node_->get_logger(), "[%s][Agent] Unknown command result: %d", name_.c_str(), result);
            break;
    }
}

// ADDED: Non-blocking check for service readiness
bool DroneAgent::is_service_ready() const {
    if (!client_) { 
        RCLCPP_ERROR(node_->get_logger(), "[%s][Agent] Client pointer is null in is_service_ready!", name_.c_str());
        return false; 
    }
    return client_->service_is_ready();
}

std::string DroneAgent::ack_stats() const
{
    char b[200];
    const double pct = stat_sent_ ? 100.0 * static_cast<double>(stat_no_ack_) / static_cast<double>(stat_sent_) : 0.0;
    std::snprintf(b, sizeof(b), "Ack stats: %llu sent, %llu acked, %llu without ack (%.1f%%), %llu of those with effect seen",
                  static_cast<unsigned long long>(stat_sent_), static_cast<unsigned long long>(stat_acked_),
                  static_cast<unsigned long long>(stat_no_ack_), pct, static_cast<unsigned long long>(stat_no_ack_effect_));
    return b;
}
