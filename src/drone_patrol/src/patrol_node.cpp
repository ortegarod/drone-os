// drone_patrol: "PATROL" PX4 external mode + mode executor for one drone.
//
// Built on px4-ros2-interface-lib 1.4.0 (90bc476), PX4 v1.15.4, px4_msgs 1.15.
//  - Mode: ModeBase (lib components/mode.hpp:103) flying drone_core's plan with GotoSetpointType
//    (lib control/setpoint_types/goto.hpp:44-50; PX4 msg/GotoSetpoint.msg:17-18 max_horizontal_speed).
//  - Executor: ModeExecutorBase (lib components/mode_executor.hpp:52). PX4 hands the executor control when its
//    owned mode is selected and the vehicle is armed (lib src/components/mode_executor.cpp:296-307).
//    Airborne: straight to PATROL. Landed: takeoff (NAV_TAKEOFF, param7 AMSL: mode_executor.cpp:217-230) first.
//    End: RTL / LAND item -> rtl()/land(); otherwise Hold. Leg timeout or other failure -> mission failed + Hold.
//  - Topics: plan in (/<drone>/patrol/plan), status out (/<drone>/patrol/status, 5 Hz heartbeat).
#include <rclcpp/rclcpp.hpp>
#include <px4_ros2/components/mode.hpp>
#include <px4_ros2/components/mode_executor.hpp>
#include <px4_ros2/components/wait_for_fmu.hpp>
#include <px4_ros2/control/setpoint_types/goto.hpp>
#include <px4_ros2/odometry/local_position.hpp>
#include <px4_ros2/odometry/attitude.hpp>
#include <px4_ros2/vehicle_state/vehicle_status.hpp>
#include <drone_interfaces/msg/patrol_plan.hpp>
#include <drone_interfaces/msg/patrol_status.hpp>
#include <Eigen/Core>
#include <cmath>
#include <functional>
#include <mutex>
#include <optional>

using namespace std::chrono_literals;
using drone_interfaces::msg::PatrolPlan;
using drone_interfaces::msg::PatrolStatus;

static constexpr uint16_t CMD_WAYPOINT = 16, CMD_RTL = 20, CMD_LAND = 21;
static const char * kModeName = "PATROL";   // < 25 chars (lib mode.hpp Settings::name)

// Shared mission progress (single-threaded executor: all callbacks run on the node's thread).
struct Progress {
  PatrolPlan plan;
  bool plan_valid{false};
  uint16_t current{0};
  std::string state{"IDLE"};
  bool running{false}, finished{false}, failed{false};
  std::string reason;
  uint16_t total() const {return static_cast<uint16_t>(plan.points.size());}
  bool endItem(uint16_t i) const
  {
    return i >= total() || plan.points[i].command == CMD_RTL || plan.points[i].command == CMD_LAND;
  }
  void fail(const std::string & why)
  {
    failed = true; running = false; reason = why; state = "FAILED";
    if (changed) {changed();}
  }
  // Publishes PatrolStatus at once (set by PatrolNode). Called on every item advance and failure, so
  // drone_core sees the new current_item before the executor switches PX4 to the next mode.
  std::function<void()> changed;
};

class PatrolMode : public px4_ros2::ModeBase
{
public:
  PatrolMode(rclcpp::Node & node, Progress & p, const std::string & prefix)
  : ModeBase(node, Settings{kModeName, false}, prefix), _p(p)
  {
    _goto = std::make_shared<px4_ros2::GotoSetpointType>(*this);
    _pos = std::make_shared<px4_ros2::OdometryLocalPosition>(*this);
    _att = std::make_shared<px4_ros2::OdometryAttitude>(*this);
  }

  void onActivate() override
  {
    _p.state = "PATROL";
    _leg_started = false;
    _first_leg = true;   // first leg after (re)activation: course from the current position
    RCLCPP_INFO(node().get_logger(), "PATROL active, item %u/%u", _p.current, _p.total());
  }
  void onDeactivate() override {_leg_started = false;}

  void updateSetpoint(float /*dt_s*/) override
  {
    if (!_p.plan_valid || _p.failed || _p.finished) {
      if (!_p.plan_valid) {_p.fail("PATROL selected without a plan");}
      completed(px4_ros2::Result::ModeFailureOther);
      return;
    }
    if (_p.endItem(_p.current)) {        // nothing (left) to fly: hand back to the executor
      completed(px4_ros2::Result::Success);
      return;
    }
    if (!_pos->positionXYValid() || !_pos->positionZValid()) {
      _p.fail("local position invalid during PATROL");
      completed(px4_ros2::Result::ModeFailureOther);
      return;
    }
    const auto & wp = _p.plan.points[_p.current];
    const Eigen::Vector3f target{wp.x, wp.y, wp.z};
    const Eigen::Vector3f pos = _pos->positionNed();
    const rclcpp::Time now = node().get_clock()->now();
    if (!_leg_started) {startLeg(pos, target, now);}

    // Nose along the course of the leg (set in startLeg), held while at the point; rate-limited turn.
    // GotoSetpointType::update(position, heading, max_h, max_v, max_heading_rate) (lib 1.4.0 goto.hpp:44-50).
    _goto->update(target, _leg_heading, _p.plan.cruise_speed, _p.plan.max_vertical_speed, kMaxHeadingRate);

    if (!_mid_logged && _leg_heading && _leg_len > 4.f &&
        (pos - target).head<2>().norm() <= 0.5f * _leg_len) {
      _mid_logged = true;
      const float yaw = _att->yaw();
      float err = std::remainder(yaw - *_leg_heading, 2.0f * static_cast<float>(M_PI));
      RCLCPP_INFO(node().get_logger(), "PATROL item %u mid-leg heading %.1f deg vs course %.1f deg (error %.1f deg)",
                  _p.current, deg360(yaw), deg360(*_leg_heading), err * 180.0f / static_cast<float>(M_PI));
    }

    const float radius = wp.acceptance_radius > 0.f ? wp.acceptance_radius : 2.0f;
    const float dist = (pos - target).norm();
    if (!_reached && dist <= radius) {
      _reached = true;
      _reached_at = now;
      RCLCPP_INFO(node().get_logger(), "PATROL item %u reached (%.2f m <= %.2f m)", _p.current, dist, radius);
    }
    if (!_reached) {
      // Timeout is never "reached": fail the mission; the executor switches PX4 to Hold.
      const double elapsed = (now - _leg_start).seconds();
      if (elapsed >= _leg_timeout_s) {
        char why[160];
        std::snprintf(why, sizeof(why), "waypoint %u not reached within %.0f s (timeout)", _p.current, _leg_timeout_s);
        _p.fail(why);
        RCLCPP_WARN(node().get_logger(), "%s", why);
        completed(px4_ros2::Result::Timeout);
      }
      return;
    }
    if ((now - _reached_at).seconds() < wp.hold_time) {return;}
    _p.current++;
    _leg_started = false;
    if (_p.changed) {_p.changed();}   // before completed(): the executor's RTL follows within ms
    if (_p.endItem(_p.current)) {
      RCLCPP_INFO(node().get_logger(), "PATROL legs complete at item %u", _p.current);
      completed(px4_ros2::Result::Success);
    }
  }

private:
  void startLeg(const Eigen::Vector3f & pos, const Eigen::Vector3f & target, const rclcpp::Time & now)
  {
    // Same rule as drone_core's OFFBOARD path (mission_manager.cpp:413, 545-548):
    // expected = min(leg / cruise + 10, 300) s; timeout = max(expected, 5) * multiplier.
    const float cruise = _p.plan.cruise_speed > 0.1f ? _p.plan.cruise_speed : 5.0f;
    const float expected = std::min((target - pos).norm() / cruise + 10.0f, 300.0f);
    const float mult = _p.plan.timeout_multiplier > 0.f ? _p.plan.timeout_multiplier : 2.0f;
    _leg_timeout_s = std::max(expected, 5.0f) * mult;
    _leg_start = now;
    _leg_started = true;
    _reached = false;
    _mid_logged = false;
    // Course: from the previous point, or from the current position on the first leg after activation
    // (start/resume). NED: heading = atan2(dEast, dNorth). Legs with < 1 m horizontal travel keep the
    // previous heading (none on the first leg: PX4 then holds the current heading).
    Eigen::Vector3f from = pos;
    if (!_first_leg && _p.current > 0) {
      const auto & prev = _p.plan.points[_p.current - 1];
      from = Eigen::Vector3f{prev.x, prev.y, prev.z};
    }
    _first_leg = false;
    const Eigen::Vector2f d = (target - from).head<2>();
    _leg_len = (target - pos).head<2>().norm();
    if (d.norm() >= 1.0f) {_leg_heading = std::atan2(d.y(), d.x());}
    if (_leg_heading) {
      RCLCPP_INFO(node().get_logger(), "PATROL item %u course %.1f deg", _p.current, deg360(*_leg_heading));
    }
    RCLCPP_INFO(node().get_logger(), "PATROL item %u: %.1f m at up to %.1f m/s (timeout %.0f s)", _p.current,
                (target - pos).norm(), cruise, _leg_timeout_s);
  }

  static float deg360(float rad)
  {
    float d = rad * 180.0f / static_cast<float>(M_PI);
    return d < 0.f ? d + 360.f : d;
  }
  static constexpr float kMaxHeadingRate = 0.785f;   // rad/s (45 deg/s): turn toward the new course smoothly

  Progress & _p;
  std::shared_ptr<px4_ros2::OdometryAttitude> _att;
  std::optional<float> _leg_heading;
  float _leg_len{0.f};
  bool _first_leg{true}, _mid_logged{false};
  std::shared_ptr<px4_ros2::GotoSetpointType> _goto;
  std::shared_ptr<px4_ros2::OdometryLocalPosition> _pos;
  bool _leg_started{false}, _reached{false};
  rclcpp::Time _leg_start, _reached_at;
  double _leg_timeout_s{60.0};
};

class PatrolExecutor : public px4_ros2::ModeExecutorBase
{
public:
  PatrolExecutor(rclcpp::Node & node, PatrolMode & mode, Progress & p, const std::string & prefix)
  : ModeExecutorBase(node, Settings{}, mode, prefix), _node(node), _p(p)
  {
    // ModeExecutorBase is not a px4_ros2::Context; the owned mode is (lib mode.hpp:103), and its
    // subscriptions stay live while the mode is inactive.
    _status = std::make_shared<px4_ros2::VehicleStatus>(mode);
  }

  void onActivate() override
  {
    if (!_p.plan_valid) {
      _p.fail("PATROL selected without a plan");
      return hold();
    }
    if (_p.finished || _p.failed) {
      return hold();
    }
    _p.running = true;
    // vehicle_land_detected is not bridged by PX4 v1.15 (not in uxrce_dds_client/dds_topics.yaml), so the lib's
    // LandDetected never receives data. Use vehicle_status (dds_topics.yaml:71): takeoff_time is set on
    // "Takeoff detected" and reset on disarm (Commander.cpp:2093-2098, 656). Fallback: drone_core's hint
    // (takeoff_altitude_amsl is NaN when drone_core saw the vehicle airborne).
    bool landed;
    if (_status->lastValid(std::chrono::seconds(2))) {
      landed = !(_status->armed() && _status->last().takeoff_time != 0);
    } else {
      landed = std::isfinite(_p.plan.takeoff_altitude_amsl);
    }
    if (landed) {
      if (!std::isfinite(_p.plan.takeoff_altitude_amsl)) {
        _p.fail("START from the ground without a takeoff altitude");
        return hold();
      }
      _p.state = "TAKEOFF";
      RCLCPP_INFO(_node.get_logger(), "Executor: takeoff to %.1f m AMSL", _p.plan.takeoff_altitude_amsl);
      takeoff([this](px4_ros2::Result r) {
          if (r != px4_ros2::Result::Success) {return onStepFailed("takeoff", r);}
          runPatrol();
        }, _p.plan.takeoff_altitude_amsl);
    } else {
      runPatrol();
    }
  }

  void onDeactivate(DeactivateReason reason) override
  {
    if (_p.running) {
      _p.running = false;
      _p.state = "DEACTIVATED";
      _p.reason = reason == DeactivateReason::FailsafeActivated ? "PX4 failsafe" : "mode changed";
      RCLCPP_WARN(_node.get_logger(), "Executor deactivated (%s) at item %u", _p.reason.c_str(), _p.current);
    }
  }

private:
  void runPatrol()
  {
    _p.state = "PATROL";
    scheduleMode(ownedMode().id(), [this](px4_ros2::Result r) {
        if (r != px4_ros2::Result::Success) {return onStepFailed("PATROL", r);}
        finish();
      });
  }

  void finish()
  {
    const uint16_t cmd = _p.current < _p.total() ? _p.plan.points[_p.current].command : CMD_WAYPOINT;
    _p.running = false;
    _p.finished = true;
    if (cmd == CMD_RTL) {
      _p.state = "RTL";
      rtl([this](px4_ros2::Result r) {
          if (r != px4_ros2::Result::Success) {return;}
          waitUntilDisarmed([this](px4_ros2::Result) {_p.state = "DONE";});
        });
    } else if (cmd == CMD_LAND) {
      _p.state = "LAND";
      land([this](px4_ros2::Result r) {
          if (r != px4_ros2::Result::Success) {return;}
          waitUntilDisarmed([this](px4_ros2::Result) {_p.state = "DONE";});
        });
    } else {
      _p.state = "DONE";
      hold();
    }
  }

  void onStepFailed(const char * step, px4_ros2::Result r)
  {
    if (r == px4_ros2::Result::Deactivated) {return;}   // user / failsafe took over: onDeactivate reports it
    if (!_p.failed) {_p.fail(std::string(step) + " failed: " + px4_ros2::resultToString(r));}
    RCLCPP_WARN(_node.get_logger(), "Executor: %s -> Hold", _p.reason.c_str());
    hold();
  }

  void hold()
  {
    if (_p.state != "DONE") {_p.state = _p.failed ? "FAILED" : "HOLD";}
    scheduleMode(px4_ros2::ModeBase::kModeIDLoiter, [](px4_ros2::Result) {});
  }

  rclcpp::Node & _node;
  Progress & _p;
  std::shared_ptr<px4_ros2::VehicleStatus> _status;
};

class PatrolNode : public rclcpp::Node
{
public:
  PatrolNode()
  : Node("patrol")
  {
    _drone = declare_parameter<std::string>("drone_name", "drone1");
    std::string ns = declare_parameter<std::string>("px4_namespace", "/fmu/");   // same param as drone_core
    // lib topics are prefix + "fmu/..." (e.g. lib control/setpoint_types/direct_actuators.cpp:16)
    _prefix = ns.size() >= 4 && ns.compare(ns.size() - 4, 4, "fmu/") == 0 ? ns.substr(0, ns.size() - 4) : ns;
    if (_prefix.empty()) {_prefix = "/";}

    _status_pub = create_publisher<PatrolStatus>("/" + _drone + "/patrol/status", rclcpp::QoS(10).reliable());
    _plan_sub = create_subscription<PatrolPlan>("/" + _drone + "/patrol/plan",
        rclcpp::QoS(1).reliable().transient_local(),
        [this](PatrolPlan::SharedPtr msg) {onPlan(*msg);});
    _status_timer = create_wall_timer(200ms, [this]() {publishStatus();});
    _register_timer = create_wall_timer(1s, [this]() {tryRegister();});
    RCLCPP_INFO(get_logger(), "[%s] drone_patrol up, PX4 topic prefix '%s'", _drone.c_str(), _prefix.c_str());
  }

private:
  void tryRegister()
  {
    _register_timer->cancel();
    if (!px4_ros2::waitForFMU(*this, 15s, _prefix)) {
      RCLCPP_WARN(get_logger(), "No FMU on prefix '%s' yet; retrying", _prefix.c_str());
      _register_timer->reset();
      return;
    }
    _mode = std::make_unique<PatrolMode>(*this, _p, _prefix);
    _executor = std::make_unique<PatrolExecutor>(*this, *_mode, _p, _prefix);
    _p.changed = [this]() {publishStatus();};
    if (!_executor->doRegister()) {   // registers mode + executor (lib mode_executor.hpp doRegister)
      RCLCPP_ERROR(get_logger(), "Registration with PX4 failed; retrying in 5 s");
      _executor.reset();
      _mode.reset();
      _register_timer = create_wall_timer(5s, [this]() {tryRegister();});
      return;
    }
    _registered = true;
    RCLCPP_INFO(get_logger(), "[%s] registered '%s' as nav_state %u", _drone.c_str(), kModeName, _mode->id());
  }

  void onPlan(const PatrolPlan & plan)
  {
    if (_executor && _executor->isInCharge() && _p.running) {
      RCLCPP_WARN(get_logger(), "Plan %u received while PATROL is running; replacing", plan.plan_seq);
    }
    _p.plan = plan;
    _p.plan_valid = !plan.points.empty();
    _p.current = plan.start_item;
    const bool in_charge = _executor && _executor->isInCharge();
    _p.running = in_charge;
    _p.finished = false;
    _p.failed = false;
    _p.reason.clear();
    _p.state = in_charge ? "PATROL" : "IDLE";
    RCLCPP_INFO(get_logger(), "Plan seq %u mission %u: %zu points from item %u, %.1f m/s", plan.plan_seq,
                plan.mission_id, plan.points.size(), plan.start_item, plan.cruise_speed);
    publishStatus();
  }

  void publishStatus()
  {
    PatrolStatus s;
    s.stamp = now();
    s.drone = _drone;
    s.registered = _registered;
    s.mode_name = kModeName;
    s.nav_state = _registered ? _mode->id() : 0;
    s.mission_id = _p.plan.mission_id;
    s.plan_seq = _p.plan.plan_seq;
    s.plan_valid = _p.plan_valid;
    s.state = _p.state;
    s.mission_running = _p.running;
    s.mission_finished = _p.finished;
    s.mission_failed = _p.failed;
    s.failure_reason = _p.reason;
    s.current_item = _p.current;
    s.total_items = _p.total();
    _status_pub->publish(s);
  }

  std::string _drone, _prefix;
  Progress _p;
  bool _registered{false};
  std::unique_ptr<PatrolMode> _mode;
  std::unique_ptr<PatrolExecutor> _executor;
  rclcpp::Publisher<PatrolStatus>::SharedPtr _status_pub;
  rclcpp::Subscription<PatrolPlan>::SharedPtr _plan_sub;
  rclcpp::TimerBase::SharedPtr _status_timer, _register_timer;
};

int main(int argc, char * argv[])
{
  rclcpp::init(argc, argv);
  rclcpp::spin(std::make_shared<PatrolNode>());
  rclcpp::shutdown();
  return 0;
}
