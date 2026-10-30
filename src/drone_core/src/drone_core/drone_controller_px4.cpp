/**
 * @file drone_controller_px4.cpp
 * @brief PX4-native actions: takeoff (NAV_TAKEOFF), hold (Hold mode), go-to (DO_REPOSITION), orbit (DO_ORBIT).
 *
 * drone_core only sends the command; PX4's own flight modes fly it, so the vehicle keeps flying safely if
 * drone_core dies. Sources: PX4 v1.15.4 (~/ref/PX4-Autopilot-v1.15.4/src/modules/...).
 * All commands go over the bridged in/vehicle_command (uxrce_dds_client/dds_topics.yaml:139).
 */

#include "drone_core/drone_controller.hpp"
#include <px4_msgs/msg/vehicle_command.hpp>
#include <algorithm>
#include <cmath>

using px4_msgs::msg::VehicleCommand;
using namespace std::chrono_literals;

namespace {
constexpr float kTakeoffDefault = 10.0f, kTakeoffMin = 2.0f, kTakeoffMax = 120.0f;  // 120 = GF_MAX_VER_DIST
constexpr std::chrono::milliseconds kTakeoffPositionWait{5000};  // takeoff_to: max wait for a valid global position
constexpr float kGotoSpeedMin = 1.0f, kGotoSpeedMax = 10.0f;                         // MPC_XY_CRUISE = 10
constexpr float kOrbitRadiusMin = 2.0f, kOrbitRadiusMax = 300.0f;                    // 300 = GF_MAX_HOR_DIST
constexpr float kOrbitSpeedDefault = 3.0f, kOrbitSpeedMax = 10.0f;                   // FlightTaskOrbit.hpp:73
constexpr float kOrbitAccMax = 2.0f;                                                 // FlightTaskOrbit.hpp:74
constexpr uint8_t kOrbitYawFaceCenter = 0, kOrbitYawTangent = 3;                     // msg/OrbitStatus.msg:2,5
constexpr float kPx4MainModeAuto = 4.0f, kPx4SubModeLoiter = 3.0f;                   // commander/px4_custom_mode.h:48,60

double distance_m(double lat1, double lon1, double lat2, double lon2) {
    constexpr double R = 6371000.0;
    const double p1 = lat1 * M_PI / 180.0, p2 = lat2 * M_PI / 180.0;
    const double dp = p2 - p1, dl = (lon2 - lon1) * M_PI / 180.0;
    const double a = std::sin(dp / 2) * std::sin(dp / 2) + std::cos(p1) * std::cos(p2) * std::sin(dl / 2) * std::sin(dl / 2);
    return 2.0 * R * std::atan2(std::sqrt(a), std::sqrt(1.0 - a));
}
int64_t steady_ns() {
    return std::chrono::duration_cast<std::chrono::nanoseconds>(std::chrono::steady_clock::now().time_since_epoch()).count();
}
}  // namespace

std::string DroneController::ack_to_string(uint8_t result) {
    switch (result) {
        case 0: return "accepted";
        case 1: return "temporarily rejected";
        case 2: return "denied";
        case 3: return "unsupported";
        case 4: return "failed";
        case DroneAgent::RESULT_NO_REPLY: return "no reply from PX4";
        default: return "result " + std::to_string(result);
    }
}

void DroneController::run_after(std::chrono::milliseconds delay, std::function<void()> fn) {
    auto holder = std::make_shared<rclcpp::TimerBase::SharedPtr>();
    *holder = node_->create_wall_timer(delay, [this, holder, fn]() {
        (*holder)->cancel();
        auto self = *holder;
        oneshot_timers_.erase(std::remove(oneshot_timers_.begin(), oneshot_timers_.end(), self), oneshot_timers_.end());
        fn();
    });
    oneshot_timers_.push_back(*holder);
}

void DroneController::release_control_to_px4(const char* why) {
    // drone_core never fights a PX4 mode: stop our mission and setpoint stream before handing over.
    const auto ms = mission_manager_->get_mission_status();
    if (std::string(why) == "hold") {
        // Hold pauses a running mission (current_item kept, RESUME continues); a paused one stays paused
        if (ms.mission_running) {
            RCLCPP_INFO(node_->get_logger(), "[%s][Controller] %s: pausing running mission.", name_.c_str(), why);
            mission_manager_->pause_mission();
        }
    } else if (ms.mission_running || ms.mission_paused) {
        RCLCPP_INFO(node_->get_logger(), "[%s][Controller] %s: stopping %s mission.", name_.c_str(), why,
                    ms.mission_running ? "running" : "paused");
        mission_manager_->stop_mission();
    }
    if (offboard_control_->is_active()) {
        RCLCPP_INFO(node_->get_logger(), "[%s][Controller] %s: stopping offboard setpoints.", name_.c_str(), why);
        offboard_control_->stop();
    }
}

void DroneController::create_px4_action_services() {
    takeoff_to_service_ = node_->create_service<drone_interfaces::srv::Takeoff>(
        "/" + name_ + "/takeoff_to",
        [this](rclcpp::Service<drone_interfaces::srv::Takeoff>::SharedPtr s, const std::shared_ptr<rmw_request_id_t> h,
               const std::shared_ptr<drone_interfaces::srv::Takeoff::Request> r) { takeoff_to_callback(s, h, r); });
    hold_service_ = node_->create_service<std_srvs::srv::Trigger>(
        "/" + name_ + "/hold",
        [this](rclcpp::Service<std_srvs::srv::Trigger>::SharedPtr s, const std::shared_ptr<rmw_request_id_t> h,
               const std::shared_ptr<std_srvs::srv::Trigger::Request> r) { hold_callback(s, h, r); });
    goto_location_service_ = node_->create_service<drone_interfaces::srv::GotoLocation>(
        "/" + name_ + "/goto_location",
        [this](rclcpp::Service<drone_interfaces::srv::GotoLocation>::SharedPtr s, const std::shared_ptr<rmw_request_id_t> h,
               const std::shared_ptr<drone_interfaces::srv::GotoLocation::Request> r) { goto_location_callback(s, h, r); });
    orbit_service_ = node_->create_service<drone_interfaces::srv::Orbit>(
        "/" + name_ + "/orbit",
        [this](rclcpp::Service<drone_interfaces::srv::Orbit>::SharedPtr s, const std::shared_ptr<rmw_request_id_t> h,
               const std::shared_ptr<drone_interfaces::srv::Orbit::Request> r) { orbit_callback(s, h, r); });
    RCLCPP_INFO(node_->get_logger(), "[%s][Controller] Offering PX4-native services: takeoff_to, hold, goto_location, orbit",
                name_.c_str());
}

// --- Takeoff: NAV_TAKEOFF switches to Takeoff mode (Commander.cpp:1035-1044); navigator climbs to param7 (AMSL)
// at the current lat/lon when param5/6 are NaN (navigator_main.cpp:595-634, takeoff.cpp:99-117), then holds
// (takeoff.cpp:71-75). Then ARM (Commander.cpp:923).
void DroneController::takeoff_to_callback(rclcpp::Service<drone_interfaces::srv::Takeoff>::SharedPtr service,
                                          const std::shared_ptr<rmw_request_id_t> header,
                                          const std::shared_ptr<drone_interfaces::srv::Takeoff::Request> request) {
    auto resp = std::make_shared<drone_interfaces::srv::Takeoff::Response>();
    auto reply = [service, header, resp](bool ok, const std::string& m) {
        resp->success = ok; resp->message = m; service->send_response(*header, *resp);
    };
    const auto health = drone_state_->get_health();
    if (!drone_agent_->is_service_ready()) return reply(false, "PX4 command service not ready");
    if (get_arming_state() != ArmingState::DISARMED || drone_state_->get_landing_state() != LandingState::LANDED)
        return reply(false, "takeoff_to requires a disarmed, landed vehicle");
    if (!(health.status_valid && health.pre_flight_checks_pass))
        return reply(false, "PX4 preflight checks fail (can_arm=false)");

    // PX4's global estimate can drop out for ~1 s (seen on drone1 after landing),
    // so wait up to kTakeoffPositionWait for it instead of refusing on a single sample.
    double lat, lon; float alt;
    if (drone_state_->get_latest_global_position(lat, lon, alt))
        return takeoff_to_send(reply, resp, request->altitude, alt);
    RCLCPP_WARN(node_->get_logger(), "[%s][Controller] takeoff_to: waiting up to %lld ms for a valid global position (%s)",
                name_.c_str(), (long long)kTakeoffPositionWait.count(), drone_state_->global_position_problem().c_str());
    auto timer = std::make_shared<rclcpp::TimerBase::SharedPtr>();
    const auto start = std::chrono::steady_clock::now();
    const float requested_alt = request->altitude;
    *timer = node_->create_wall_timer(std::chrono::milliseconds(100),
        [this, timer, start, reply, resp, requested_alt]() {
            double la, lo; float al;
            const bool ok = drone_state_->get_latest_global_position(la, lo, al);
            const bool expired = std::chrono::steady_clock::now() - start >= kTakeoffPositionWait;
            if (!ok && !expired) return;
            (*timer)->cancel();
            if (!ok) {
                const std::string why = drone_state_->global_position_problem();
                RCLCPP_WARN(node_->get_logger(), "[%s][Controller] takeoff_to refused: no valid global position after %lld ms (%s)",
                            name_.c_str(), (long long)kTakeoffPositionWait.count(), why.c_str());
                return reply(false, "no valid global position after " + std::to_string(kTakeoffPositionWait.count()) + " ms: " + why);
            }
            // Re-check what may have changed while waiting
            if (get_arming_state() != ArmingState::DISARMED || drone_state_->get_landing_state() != LandingState::LANDED)
                return reply(false, "takeoff_to requires a disarmed, landed vehicle");
            RCLCPP_INFO(node_->get_logger(), "[%s][Controller] takeoff_to: global position valid after %lld ms",
                        name_.c_str(), (long long)std::chrono::duration_cast<std::chrono::milliseconds>(
                            std::chrono::steady_clock::now() - start).count());
            takeoff_to_send(reply, resp, requested_alt, al);
        });
}

void DroneController::takeoff_to_send(const std::function<void(bool, const std::string&)>& reply,
                                      const std::shared_ptr<drone_interfaces::srv::Takeoff::Response>& resp,
                                      float requested_altitude, float alt) {
    const float rel = requested_altitude <= 0.0f ? kTakeoffDefault : std::clamp(requested_altitude, kTakeoffMin, kTakeoffMax);
    const float target_amsl = alt + rel;  // disarmed and landed: current position is home (Commander.cpp:1801)
    resp->target_altitude_amsl = target_amsl;
    release_control_to_px4("takeoff_to");
    RCLCPP_INFO(node_->get_logger(), "[%s][Controller] takeoff_to: NAV_TAKEOFF to %.1f m AMSL (%.1f m above home)",
                name_.c_str(), target_amsl, rel);

    drone_agent_->sendCommand(VehicleCommand::VEHICLE_CMD_NAV_TAKEOFF, NAN, NAN, NAN, NAN, NAN, NAN, target_amsl,
        [this, reply, rel](const DroneAgent::Ack& ack) {
            if (!ack.accepted()) return reply(false, DroneAgent::describe(ack));
            drone_agent_->sendCommand(VehicleCommand::VEHICLE_CMD_COMPONENT_ARM_DISARM, 1.0f, 0.0f, NAN, NAN, NAN, NAN, NAN,
                [this, reply, rel](const DroneAgent::Ack& arm_ack) {
                    if (arm_ack.accepted()) {
                        char m[96];
                        std::snprintf(m, sizeof(m), "Takeoff to %.1f m above home started (PX4 Takeoff mode)", rel);
                        return reply(true, m);
                    }
                    // Leave the disarmed vehicle in Hold rather than in Takeoff mode
                    drone_agent_->sendVehicleCommandFull(VehicleCommand::VEHICLE_CMD_DO_SET_MODE, 1.0f, kPx4MainModeAuto,
                        kPx4SubModeLoiter, NAN, NAN, NAN, NAN, [](uint8_t) {});
                    reply(false, DroneAgent::describe(arm_ack));
                });
        });
}

// --- Hold: DO_SET_MODE AUTO/LOITER (Commander.cpp:785) = PX4 Hold mode.
void DroneController::hold_callback(rclcpp::Service<std_srvs::srv::Trigger>::SharedPtr service,
                                    const std::shared_ptr<rmw_request_id_t> header,
                                    const std::shared_ptr<std_srvs::srv::Trigger::Request> /*request*/) {
    auto resp = std::make_shared<std_srvs::srv::Trigger::Response>();
    auto reply = [service, header, resp](bool ok, const std::string& m) {
        resp->success = ok; resp->message = m; service->send_response(*header, *resp);
    };
    if (!drone_agent_->is_service_ready()) return reply(false, "PX4 command service not ready");
    release_control_to_px4("hold");
    drone_agent_->sendCommand(VehicleCommand::VEHICLE_CMD_DO_SET_MODE, 1.0f, kPx4MainModeAuto, kPx4SubModeLoiter,
        NAN, NAN, NAN, NAN, [reply](const DroneAgent::Ack& ack) {
            if (ack.accepted()) return reply(true, "Hold mode (PX4 AUTO_LOITER)");
            reply(false, DroneAgent::describe(ack));
        });
}

// --- Go-to: DO_REPOSITION with param2 bit0 = change mode (required, Commander.cpp:748-752) switches to Hold;
// navigator flies to param5/6/7 at param1 ground speed, heading param4 (navigator_main.cpp:260-340), only if
// armed and the target passes the geofence (navigator_main.cpp:281, 405).
void DroneController::goto_location_callback(rclcpp::Service<drone_interfaces::srv::GotoLocation>::SharedPtr service,
                                             const std::shared_ptr<rmw_request_id_t> header,
                                             const std::shared_ptr<drone_interfaces::srv::GotoLocation::Request> request) {
    auto resp = std::make_shared<drone_interfaces::srv::GotoLocation::Response>();
    auto reply = [service, header, resp](bool ok, const std::string& m) {
        resp->success = ok; resp->message = m; service->send_response(*header, *resp);
    };
    double cur_lat, cur_lon, home_lat, home_lon, lat, lon; float cur_alt, home_alt;
    if (!drone_agent_->is_service_ready()) return reply(false, "PX4 command service not ready");
    if (get_arming_state() != ArmingState::ARMED || drone_state_->get_landing_state() != LandingState::AIRBORNE)
        return reply(false, "goto_location requires an armed, airborne vehicle");
    if (!drone_state_->get_latest_global_position(cur_lat, cur_lon, cur_alt)) return reply(false, "no valid global position");
    const bool home_ok = drone_state_->get_home(home_lat, home_lon, home_alt);
    if (request->frame == drone_interfaces::srv::GotoLocation::Request::FRAME_LOCAL) {
        if (!drone_state_->local_to_global(request->north, request->east, lat, lon))
            return reply(false, "local frame origin not available");
    } else if (request->frame == drone_interfaces::srv::GotoLocation::Request::FRAME_GLOBAL) {
        lat = request->latitude; lon = request->longitude;
        if (std::fabs(lat) > 90.0 || std::fabs(lon) > 180.0) return reply(false, "latitude/longitude out of range");
    } else {
        return reply(false, "frame must be 0 (GLOBAL) or 1 (LOCAL)");
    }
    float alt_amsl = NAN;
    if (request->altitude > 0.0f) {
        if (!home_ok) return reply(false, "home not known; cannot convert altitude");
        alt_amsl = home_alt + request->altitude;
    }
    const float speed = request->speed <= 0.0f ? -1.0f : std::clamp(request->speed, kGotoSpeedMin, kGotoSpeedMax);
    float yaw = NAN;
    if (request->heading_deg >= 0.0f) {
        float d = std::fmod(request->heading_deg, 360.0f);
        if (d > 180.0f) d -= 360.0f;
        yaw = d * static_cast<float>(M_PI) / 180.0f;
    }
    resp->target_latitude = lat;
    resp->target_longitude = lon;
    resp->target_altitude_amsl = std::isnan(alt_amsl) ? cur_alt : alt_amsl;
    resp->distance_m = static_cast<float>(distance_m(cur_lat, cur_lon, lat, lon));
    release_control_to_px4("goto_location");
    RCLCPP_INFO(node_->get_logger(), "[%s][Controller] goto_location: DO_REPOSITION to %.7f, %.7f, %.1f m AMSL, %.0f m away, speed %.1f",
                name_.c_str(), lat, lon, resp->target_altitude_amsl, resp->distance_m, speed);

    const int64_t sent_ns = steady_ns();
    drone_agent_->sendCommand(VehicleCommand::VEHICLE_CMD_DO_REPOSITION, speed, 1.0f, 0.0f, yaw, lat, lon, alt_amsl,
        [this, reply, lat, lon, sent_ns](const DroneAgent::Ack& ack) {
            if (!ack.accepted()) return reply(false, DroneAgent::describe(ack));
            // Commander only switches mode; the navigator decides. Confirm it took the target from the bridged
            // position_setpoint_triplet (dds_topics.yaml:38).
            run_after(1000ms, [this, reply, lat, lon, sent_ns]() {
                double tlat, tlon; int64_t rx;
                const bool have = drone_state_->get_triplet_current(tlat, tlon, rx);
                if (have && rx > sent_ns && distance_m(tlat, tlon, lat, lon) < 1.0) {
                    return reply(true, "Going to target (PX4 Hold mode)");
                }
                reply(false, "PX4 did not take the target (outside geofence?); vehicle is holding");
            });
        });
}

// --- Orbit: DO_ORBIT switches a multicopter to Orbit mode (Commander.cpp:1133-1168); FlightTaskOrbit takes
// param1 = radius (sign = direction, + clockwise), param2 = speed, param3 = yaw behaviour, param5/6 centre,
// param7 AMSL (FlightTaskOrbit.cpp:60-118); speed limited to 10 m/s and sqrt(2*radius) (FlightTaskOrbit.cpp:150-163).
void DroneController::orbit_callback(rclcpp::Service<drone_interfaces::srv::Orbit>::SharedPtr service,
                                     const std::shared_ptr<rmw_request_id_t> header,
                                     const std::shared_ptr<drone_interfaces::srv::Orbit::Request> request) {
    auto resp = std::make_shared<drone_interfaces::srv::Orbit::Response>();
    auto reply = [service, header, resp](bool ok, const std::string& m) {
        resp->success = ok; resp->message = m; service->send_response(*header, *resp);
    };
    double cur_lat, cur_lon, home_lat, home_lon, lat, lon; float cur_alt, home_alt;
    if (!drone_agent_->is_service_ready()) return reply(false, "PX4 command service not ready");
    if (get_arming_state() != ArmingState::ARMED || drone_state_->get_landing_state() != LandingState::AIRBORNE)
        return reply(false, "orbit requires an armed, airborne vehicle");
    if (!drone_state_->get_latest_global_position(cur_lat, cur_lon, cur_alt)) return reply(false, "no valid global position");
    const bool home_ok = drone_state_->get_home(home_lat, home_lon, home_alt);
    if (request->frame == drone_interfaces::srv::Orbit::Request::FRAME_LOCAL) {
        if (!drone_state_->local_to_global(request->north, request->east, lat, lon))
            return reply(false, "local frame origin not available");
    } else if (request->frame == drone_interfaces::srv::Orbit::Request::FRAME_GLOBAL) {
        lat = request->latitude; lon = request->longitude;
        if (std::fabs(lat) > 90.0 || std::fabs(lon) > 180.0) return reply(false, "latitude/longitude out of range");
    } else {
        return reply(false, "frame must be 0 (GLOBAL) or 1 (LOCAL)");
    }
    float alt_amsl = NAN;
    if (request->altitude > 0.0f) {
        if (!home_ok) return reply(false, "home not known; cannot convert altitude");
        alt_amsl = home_alt + request->altitude;
    }
    const float radius = std::clamp(request->radius, kOrbitRadiusMin, kOrbitRadiusMax);
    float speed = request->speed <= 0.0f ? kOrbitSpeedDefault : std::min(request->speed, kOrbitSpeedMax);
    if (speed * speed >= kOrbitAccMax * radius) speed = std::sqrt(kOrbitAccMax * radius);  // PX4 does the same
    resp->center_latitude = lat;
    resp->center_longitude = lon;
    resp->altitude_amsl = std::isnan(alt_amsl) ? cur_alt : alt_amsl;
    resp->speed_used = speed;
    const float yaw_mode = request->face_center ? kOrbitYawFaceCenter : kOrbitYawTangent;
    release_control_to_px4("orbit");
    RCLCPP_INFO(node_->get_logger(), "[%s][Controller] orbit: DO_ORBIT centre %.7f, %.7f r=%.1f %s v=%.1f alt=%.1f AMSL yaw=%d",
                name_.c_str(), lat, lon, radius, request->clockwise ? "cw" : "ccw", speed, resp->altitude_amsl,
                static_cast<int>(yaw_mode));
    drone_agent_->sendCommand(VehicleCommand::VEHICLE_CMD_DO_ORBIT, request->clockwise ? radius : -radius, speed,
        yaw_mode, NAN, lat, lon, alt_amsl, [reply](const DroneAgent::Ack& ack) {
            if (ack.accepted()) return reply(true, "Orbiting (PX4 Orbit mode)");
            reply(false, DroneAgent::describe(ack));
        });
}

// --- Trigger services that send one VehicleCommand and answer with PX4's ack. The reply is deferred until
// PX4's VehicleCommand service answers with the matching vehicle_command_ack (uxrce_dds_client/vehicle_command_srv.cpp:66-75)
// or DroneAgent's 1.5 s timeout fires; success only if PX4 answered ACCEPTED (or IN_PROGRESS).
void DroneController::create_ack_trigger_services() {
    using Trig = std_srvs::srv::Trigger;
    auto make = [this](const std::string& name, std::function<void(std::function<void(bool, const std::string&)>)> body) {
        return node_->create_service<Trig>("/" + name_ + "/" + name,
            [body](rclcpp::Service<Trig>::SharedPtr service, const std::shared_ptr<rmw_request_id_t> header,
                   const std::shared_ptr<Trig::Request>) {
                auto resp = std::make_shared<Trig::Response>();
                body([service, header, resp](bool ok, const std::string& m) {
                    resp->success = ok; resp->message = m; service->send_response(*header, *resp);
                });
            });
    };
    // send one command; reply with PX4's verdict
    auto send = [this](uint16_t cmd, float p1, float p2, float p3, const std::string& ok_msg,
                       std::function<void(bool, const std::string&)> reply, std::function<void()> on_accept = nullptr) {
        if (!drone_agent_->is_service_ready()) return reply(false, "PX4 command service not ready");
        drone_agent_->sendCommand(cmd, p1, p2, p3, NAN, NAN, NAN, NAN, [reply, ok_msg, on_accept](const DroneAgent::Ack& ack) {
            if (!ack.accepted()) return reply(false, DroneAgent::describe(ack));
            if (on_accept) on_accept();
            reply(true, ok_msg + " (PX4 " + DroneAgent::result_name(ack.result) + ")");
        });
    };
    // COMPONENT_ARM_DISARM param1 1/0 (Commander.cpp:923)
    arm_service_ = make("arm", [send](auto reply) {
        send(VehicleCommand::VEHICLE_CMD_COMPONENT_ARM_DISARM, 1.0f, 0.0f, NAN, "Armed", reply);
    });
    disarm_service_ = make("disarm", [send](auto reply) {
        send(VehicleCommand::VEHICLE_CMD_COMPONENT_ARM_DISARM, 0.0f, 0.0f, NAN, "Disarmed", reply);
    });
    // NAV_LAND (Commander.cpp:1064), NAV_RETURN_TO_LAUNCH (Commander.cpp:1021), DO_FLIGHTTERMINATION
    land_service_ = make("land", [this, send](auto reply) {
        release_control_to_px4("land");
        send(VehicleCommand::VEHICLE_CMD_NAV_LAND, NAN, NAN, NAN, "Landing (PX4 Land mode)", reply);
    });
    return_to_launch_service_ = make("return_to_launch", [this, send](auto reply) {
        release_control_to_px4("return_to_launch");
        send(VehicleCommand::VEHICLE_CMD_NAV_RETURN_TO_LAUNCH, NAN, NAN, NAN, "Returning (PX4 RTL mode)", reply);
    });
    flight_termination_service_ = make("flight_termination", [send](auto reply) {
        send(VehicleCommand::VEHICLE_CMD_DO_FLIGHTTERMINATION, 1.0f, 0.0f, NAN, "Flight termination", reply);
    });
    // DO_SET_MODE param1=1 (custom), param2=main mode (commander/px4_custom_mode.h:44-55; Commander.cpp:785)
    set_position_mode_service_ = make("set_position_mode", [send](auto reply) {
        send(VehicleCommand::VEHICLE_CMD_DO_SET_MODE, 1.0f, static_cast<float>(Px4CustomMode::POSCTL), NAN, "Position mode", reply);
    });
    // set_offboard: stream at the current pose, switch 1.1 s later (PX4 needs the stream first:
    // HealthAndArmingChecks/checks/offboardCheck.cpp:47-65), reply with PX4's ack to the switch.
    set_offboard_service_ = make("set_offboard", [this](auto reply) {
        float cx, cy, cz;
        const float yaw = drone_state_->get_latest_local_yaw();
        if (!drone_agent_->is_service_ready()) return reply(false, "PX4 command service not ready");
        if (!drone_state_->get_latest_local_position(cx, cy, cz) || std::isnan(yaw))
            return reply(false, "Cannot get valid current pose to initialize offboard");
        offboard_control_->set_target_position(cx, cy, cz, yaw);
        offboard_control_->start();
        run_after(std::chrono::milliseconds(1100), [this, reply]() {
            if (!offboard_control_->is_active()) return reply(false, "Offboard stream stopped before the mode switch");
            drone_agent_->sendCommand(VehicleCommand::VEHICLE_CMD_DO_SET_MODE, 1.0f, static_cast<float>(Px4CustomMode::OFFBOARD),
                NAN, NAN, NAN, NAN, NAN, [reply](const DroneAgent::Ack& ack) {
                    if (ack.accepted()) return reply(true, "OFFBOARD (PX4 ACCEPTED); holding current pose");
                    reply(false, DroneAgent::describe(ack));
                });
        });
    });
}
