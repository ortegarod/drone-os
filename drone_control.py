"""
DroneOS Drone Control Library

Shared drone control functions using roslibpy (rosbridge WebSocket).
Framework-agnostic — used by MCP server, OpenAI agent, and any future integrations.

Requires rosbridge running on the target machine (default: localhost:9090).
"""

import json
import os
import time
import roslibpy

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

ROSBRIDGE_HOST = os.environ.get("ROSBRIDGE_HOST", "localhost")
ROSBRIDGE_PORT = int(os.environ.get("ROSBRIDGE_PORT", "9090"))

_ros: roslibpy.Ros | None = None
_drone_name: str = os.environ.get("DRONE_NAME", "drone1")


def get_ros() -> roslibpy.Ros:
    """Get or create the rosbridge connection."""
    global _ros
    if _ros is not None and _ros.is_connected:
        return _ros
    _ros = roslibpy.Ros(host=ROSBRIDGE_HOST, port=ROSBRIDGE_PORT)
    _ros.run(timeout=10)
    return _ros


def get_drone_name() -> str:
    """Return the name of the currently targeted drone."""
    return _drone_name


def set_drone_name(name: str) -> str:
    """Switch which drone to control."""
    global _drone_name
    old = _drone_name
    _drone_name = name
    return f"Target changed from {old} to {name}"


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------

def _call_trigger(service_suffix: str) -> dict:
    """Call a Trigger service on the current drone."""
    ros = get_ros()
    svc = roslibpy.Service(ros, f"/{_drone_name}/{service_suffix}", "std_srvs/srv/Trigger")
    return dict(svc.call(roslibpy.ServiceRequest()))


# ---------------------------------------------------------------------------
# Basic flight commands
# ---------------------------------------------------------------------------

def arm() -> dict:
    """Arm the drone motors. Must be called before flight."""
    return _call_trigger("arm")


def disarm() -> dict:
    """Disarm the drone motors. Only works on the ground."""
    return _call_trigger("disarm")


def takeoff() -> dict:
    """Take off. Requires offboard mode + armed state.
    
    CRITICAL: After takeoff, you MUST command the drone to clear at least
    50 meters altitude FIRST before any lateral movement.
    Use set_position(0, 0, -50, 0) or lower (more negative = higher).
    Flying laterally at low altitude risks tree/obstacle collisions.
    """
    return _call_trigger("takeoff")


def land() -> dict:
    """Land the drone autonomously at its current position."""
    return _call_trigger("land")


def return_to_launch() -> dict:
    """Return to the launch/home position and land."""
    return _call_trigger("return_to_launch")


def flight_termination() -> dict:
    """EMERGENCY -- immediate motor cutoff. Drone will fall."""
    return _call_trigger("flight_termination")


# ---------------------------------------------------------------------------
# Mode commands
# ---------------------------------------------------------------------------

def set_offboard() -> dict:
    """Enter offboard mode (required for autonomous/position control)."""
    return _call_trigger("set_offboard")


def set_position_mode() -> dict:
    """Switch to manual position-hold mode."""
    return _call_trigger("set_position_mode")


# ---------------------------------------------------------------------------
# Position control
# ---------------------------------------------------------------------------

def set_position(x: float, y: float, z: float, yaw: float = 0.0) -> dict:
    """Set target position in NED frame.

    Args:
        x:   Meters north of home (positive = north)
        y:   Meters east of home  (positive = east)
        z:   Altitude -- use NEGATIVE values to go UP (e.g. -10 = 10m above home)
        yaw: Heading in radians (0 = north, pi/2 = east)
    """
    ros = get_ros()
    svc = roslibpy.Service(
        ros, f"/{_drone_name}/set_position", "drone_interfaces/srv/SetPosition"
    )
    req = roslibpy.ServiceRequest({"x": x, "y": y, "z": z, "yaw": yaw})
    return dict(svc.call(req))


# ---------------------------------------------------------------------------
# State queries
# ---------------------------------------------------------------------------

def get_state() -> dict:
    """Get full drone state: position, velocity, battery, GPS, health, warnings."""
    ros = get_ros()
    svc = roslibpy.Service(
        ros, f"/{_drone_name}/get_state", "drone_interfaces/srv/GetState"
    )
    return dict(svc.call(roslibpy.ServiceRequest()))


# ---------------------------------------------------------------------------
# Mission commands
# ---------------------------------------------------------------------------

def upload_mission(waypoints: list[dict]) -> dict:
    """Upload a waypoint mission.

    Args:
        waypoints: List of waypoint dicts with keys:
            command (int): MAV_CMD -- 16=WAYPOINT, 22=TAKEOFF, 21=LAND
            latitude (float): GPS degrees or x in local NED
            longitude (float): GPS degrees or y in local NED
            altitude (float): Meters AMSL or z in local NED
            yaw (float): Radians
            acceptance_radius (float): Meters, default 5.0
            hold_time (float): Seconds, default 0.0
            autocontinue (bool): Default true
            frame (int): 0=GLOBAL, 1=LOCAL_NED
    """
    ros = get_ros()
    svc = roslibpy.Service(
        ros, f"/{_drone_name}/upload_mission", "drone_interfaces/srv/UploadMission"
    )
    req = roslibpy.ServiceRequest({"waypoints": waypoints})
    return dict(svc.call(req))


def mission_control(command: str, item_index: int = 0) -> dict:
    """Control mission execution.

    Args:
        command: One of START, PAUSE, RESUME, STOP, CLEAR, GOTO_ITEM
        item_index: Waypoint index for GOTO_ITEM (0-based)
    """
    ros = get_ros()
    svc = roslibpy.Service(
        ros, f"/{_drone_name}/mission_control", "drone_interfaces/srv/MissionControl"
    )
    req = roslibpy.ServiceRequest({"command": command, "item_index": item_index})
    return dict(svc.call(req))


def get_mission_status() -> dict:
    """Get mission progress: current item, total items, running state, progress %."""
    ros = get_ros()
    svc = roslibpy.Service(
        ros, f"/{_drone_name}/get_mission_status", "drone_interfaces/srv/GetMissionStatus"
    )
    return dict(svc.call(roslibpy.ServiceRequest()))


# ---------------------------------------------------------------------------
# Mission helpers
# ---------------------------------------------------------------------------

def start_mission_and_wait(poll_interval: float = 1.0) -> dict:
    """Start the uploaded mission and block until it completes.

    Returns:
        dict with keys: success (bool), message (str), progress (float)
    """
    result = mission_control("START")
    if not result.get("success", False):
        return result

    while True:
        status = get_mission_status()
        if status.get("mission_finished", False):
            return {"success": True, "message": "Mission completed", "progress": 1.0}
        if not status.get("mission_running", False):
            return {
                "success": False,
                "message": "Mission stopped or failed",
                "progress": status.get("mission_progress", 0),
            }
        time.sleep(poll_interval)


def build_local_waypoints(points: list[dict]) -> list[dict]:
    """Convert simple x/y/z/yaw dicts to full waypoint format for local NED frame.

    Args:
        points: List of dicts with keys: x, y, z, yaw (opt), hold_time (opt), radius (opt)

    Returns:
        List of waypoint dicts ready for upload_mission()
    """
    waypoints = []
    for pt in points:
        waypoints.append({
            "command": 16,  # NAV_WAYPOINT
            "frame": 1,     # LOCAL_NED
            "latitude": pt.get("x", 0.0),
            "longitude": pt.get("y", 0.0),
            "altitude": pt.get("z", -10.0),
            "yaw": pt.get("yaw", 0.0),
            "acceptance_radius": pt.get("radius", 2.0),
            "hold_time": pt.get("hold_time", 0.0),
            "autocontinue": True,
        })
    return waypoints


# ---------------------------------------------------------------------------
# Quick test / example usage
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    import argparse
    import sys

    parser = argparse.ArgumentParser(description="DroneOS Control - CLI")
    parser.add_argument("--drone", default=None, help="Drone name (e.g. drone1, drone2)")
    
    # Flight commands
    parser.add_argument("--arm", action="store_true", help="Arm the drone")
    parser.add_argument("--disarm", action="store_true", help="Disarm the drone")
    parser.add_argument("--takeoff", action="store_true", help="Take off")
    parser.add_argument("--land", action="store_true", help="Land at current position")
    parser.add_argument("--rtl", action="store_true", help="Return to launch")
    parser.add_argument("--set-offboard", action="store_true", help="Enter offboard mode")
    parser.add_argument("--set-position", nargs='+', metavar='N',
                        help="Set position: X Y Z [YAW] - z is NEGATIVE for up (e.g. -15 = 15m altitude)")
    parser.add_argument("--get-state", action="store_true", help="Get full state (JSON)")
    
    args = parser.parse_args()

    if args.drone:
        set_drone_name(args.drone)

    # Execute command if provided
    executed = False
    
    if args.arm:
        result = arm()
        print(f"ARM: {result.get('message', result)}")
        executed = True
        
    if args.disarm:
        result = disarm()
        print(f"DISARM: {result.get('message', result)}")
        executed = True
        
    if args.takeoff:
        result = takeoff()
        print(f"TAKEOFF: {result.get('message', result)}")
        executed = True
        
    if args.land:
        result = land()
        print(f"LAND: {result.get('message', result)}")
        executed = True
        
    if args.rtl:
        result = return_to_launch()
        print(f"RTL: {result.get('message', result)}")
        executed = True
        
    if args.set_offboard:
        result = set_offboard()
        print(f"SET_OFFBOARD: {result.get('message', result)}")
        executed = True
        
    if args.set_position:
        if len(args.set_position) < 3:
            print("ERROR: --set-position requires at least 3 arguments (x y z)", file=sys.stderr)
            sys.exit(1)
        x = float(args.set_position[0])
        y = float(args.set_position[1])
        z = float(args.set_position[2])
        yaw = float(args.set_position[3]) if len(args.set_position) > 3 else 0.0
        result = set_position(x, y, z, yaw)
        print(f"SET_POSITION({x}, {y}, {z}, {yaw}): {result.get('message', result)}")
        executed = True
        
    if args.get_state:
        import json
        state = get_state()
        print(json.dumps(state, indent=2))
        executed = True

    # If no command given, show status (legacy behavior)
    if not executed:
        print("DroneOS Control Library - Quick Status")
        print("=" * 40)
        
        state = get_state()
        print(f"Drone: {get_drone_name()}")
        print(f"Armed: {state.get('arming_state')}")
        print(f"Mode: {state.get('nav_state')}")
        print(f"Altitude: {-state.get('local_z', 0):.1f}m")
        print(f"Battery: {state.get('battery_remaining', 0) * 100:.0f}%")
        print(f"Position valid: {state.get('position_valid')}")
