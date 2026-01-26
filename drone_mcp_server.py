# /// script
# dependencies = ["mcp[cli]", "roslibpy"]
# ///
"""Drone Control MCP Server — exposes PX4 drone commands as MCP tools via ROSBridge."""

import json
import os
import roslibpy
from mcp.server.fastmcp import FastMCP

mcp = FastMCP("drone-control")

ROSBRIDGE_HOST = os.environ.get("ROSBRIDGE_HOST", "localhost")
ROSBRIDGE_PORT = int(os.environ.get("ROSBRIDGE_PORT", "9090"))

_ros: roslibpy.Ros | None = None
_drone_name: str = os.environ.get("DRONE_NAME", "drone1")


def get_ros() -> roslibpy.Ros:
    global _ros
    if _ros is not None and _ros.is_connected:
        return _ros
    _ros = roslibpy.Ros(host=ROSBRIDGE_HOST, port=ROSBRIDGE_PORT)
    _ros.run(timeout=10)
    return _ros


def _to_dict(response) -> dict:
    """Convert a roslibpy ServiceResponse to a plain dict."""
    return dict(response)


def call_trigger(service_name: str) -> dict:
    ros = get_ros()
    svc = roslibpy.Service(ros, f"/{_drone_name}/{service_name}", "std_srvs/srv/Trigger")
    return _to_dict(svc.call(roslibpy.ServiceRequest()))


# ---------------------------------------------------------------------------
# Basic flight commands
# ---------------------------------------------------------------------------

@mcp.tool()
def arm() -> str:
    """Arm the drone motors. Must be called before flight."""
    return json.dumps(call_trigger("arm"))


@mcp.tool()
def disarm() -> str:
    """Disarm the drone motors. Only works on the ground."""
    return json.dumps(call_trigger("disarm"))


@mcp.tool()
def takeoff() -> str:
    """Take off. Requires offboard mode + armed state."""
    return json.dumps(call_trigger("takeoff"))


@mcp.tool()
def land() -> str:
    """Land the drone autonomously at its current position."""
    return json.dumps(call_trigger("land"))


@mcp.tool()
def return_to_launch() -> str:
    """Return to the launch/home position and land."""
    return json.dumps(call_trigger("return_to_launch"))


@mcp.tool()
def flight_termination() -> str:
    """EMERGENCY — immediate motor cutoff. Drone will fall. Use only in emergencies."""
    return json.dumps(call_trigger("flight_termination"))


# ---------------------------------------------------------------------------
# Mode commands
# ---------------------------------------------------------------------------

@mcp.tool()
def set_offboard() -> str:
    """Enter offboard mode (required for autonomous/position control)."""
    return json.dumps(call_trigger("set_offboard"))


@mcp.tool()
def set_position_mode() -> str:
    """Switch to manual position-hold mode."""
    return json.dumps(call_trigger("set_position_mode"))


# ---------------------------------------------------------------------------
# Position control
# ---------------------------------------------------------------------------

@mcp.tool()
def set_position(x: float, y: float, z: float, yaw: float = 0.0) -> str:
    """Set target position in NED frame (North-East-Down).

    Args:
        x:   Meters north of home (positive = north)
        y:   Meters east of home  (positive = east)
        z:   Altitude — use NEGATIVE values to go UP (e.g. -10 = 10 m above home)
        yaw: Heading in radians (0 = north, π/2 = east)
    """
    ros = get_ros()
    svc = roslibpy.Service(
        ros,
        f"/{_drone_name}/set_position",
        "drone_interfaces/srv/SetPosition",
    )
    req = roslibpy.ServiceRequest({"x": x, "y": y, "z": z, "yaw": yaw})
    return json.dumps(_to_dict(svc.call(req)))


# ---------------------------------------------------------------------------
# State queries
# ---------------------------------------------------------------------------

@mcp.tool()
def get_state() -> str:
    """Get full drone state: position, velocity, battery, GPS, health, warnings."""
    ros = get_ros()
    svc = roslibpy.Service(
        ros,
        f"/{_drone_name}/get_state",
        "drone_interfaces/srv/GetState",
    )
    return json.dumps(_to_dict(svc.call(roslibpy.ServiceRequest())))


# ---------------------------------------------------------------------------
# Mission commands
# ---------------------------------------------------------------------------

@mcp.tool()
def upload_mission(waypoints: list[dict]) -> str:
    """Upload a waypoint mission.

    Args:
        waypoints: List of waypoint dicts. Each waypoint has:
            command  (int):  MAV_CMD — 16=WAYPOINT, 22=TAKEOFF, 21=LAND
            latitude  (float): GPS degrees (0 for local frame)
            longitude (float): GPS degrees (0 for local frame)
            altitude  (float): Meters AMSL (or relative for local)
            yaw       (float): Radians
            acceptance_radius (float): Meters, default 5.0
            hold_time (float): Seconds at waypoint, default 0.0
            autocontinue (bool): Auto-advance, default true
            frame     (int):  0=GLOBAL, 1=LOCAL_NED
    """
    ros = get_ros()
    svc = roslibpy.Service(
        ros,
        f"/{_drone_name}/upload_mission",
        "drone_interfaces/srv/UploadMission",
    )
    req = roslibpy.ServiceRequest({"waypoints": waypoints})
    return json.dumps(_to_dict(svc.call(req)))


@mcp.tool()
def mission_control(command: str, item_index: int = 0) -> str:
    """Control mission execution.

    Args:
        command: One of START, PAUSE, RESUME, STOP, CLEAR, GOTO_ITEM
        item_index: Waypoint index for GOTO_ITEM (0-based)
    """
    ros = get_ros()
    svc = roslibpy.Service(
        ros,
        f"/{_drone_name}/mission_control",
        "drone_interfaces/srv/MissionControl",
    )
    req = roslibpy.ServiceRequest({"command": command, "item_index": item_index})
    return json.dumps(_to_dict(svc.call(req)))


@mcp.tool()
def get_mission_status() -> str:
    """Get mission progress: current item, total items, running state, progress %."""
    ros = get_ros()
    svc = roslibpy.Service(
        ros,
        f"/{_drone_name}/get_mission_status",
        "drone_interfaces/srv/GetMissionStatus",
    )
    return json.dumps(_to_dict(svc.call(roslibpy.ServiceRequest())))


# ---------------------------------------------------------------------------
# Multi-drone
# ---------------------------------------------------------------------------

@mcp.tool()
def set_target_drone(drone_name: str) -> str:
    """Switch which drone to control (e.g. 'drone1', 'drone2')."""
    global _drone_name
    _drone_name = drone_name
    return f"Now targeting {drone_name}"


@mcp.tool()
def get_target_drone() -> str:
    """Return the name of the currently targeted drone."""
    return _drone_name


if __name__ == "__main__":
    mcp.run()
