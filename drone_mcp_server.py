# /// script
# dependencies = ["mcp[cli]", "roslibpy"]
# ///
"""Drone Control MCP Server -- wraps drone_control as MCP tools for Claude."""

import json
from mcp.server.fastmcp import FastMCP
import drone_control

mcp = FastMCP("drone-control")


# ---------------------------------------------------------------------------
# Basic flight commands
# ---------------------------------------------------------------------------

@mcp.tool()
def arm() -> str:
    """Arm the drone motors. Must be called before flight."""
    return json.dumps(drone_control.arm())


@mcp.tool()
def disarm() -> str:
    """Disarm the drone motors. Only works on the ground."""
    return json.dumps(drone_control.disarm())


@mcp.tool()
def takeoff() -> str:
    """Take off. Requires offboard mode + armed state."""
    return json.dumps(drone_control.takeoff())


@mcp.tool()
def land() -> str:
    """Land the drone autonomously at its current position."""
    return json.dumps(drone_control.land())


@mcp.tool()
def return_to_launch() -> str:
    """Return to the launch/home position and land."""
    return json.dumps(drone_control.return_to_launch())


@mcp.tool()
def flight_termination() -> str:
    """EMERGENCY -- immediate motor cutoff. Drone will fall. Use only in emergencies."""
    return json.dumps(drone_control.flight_termination())


# ---------------------------------------------------------------------------
# Mode commands
# ---------------------------------------------------------------------------

@mcp.tool()
def set_offboard() -> str:
    """Enter offboard mode (required for autonomous/position control)."""
    return json.dumps(drone_control.set_offboard())


@mcp.tool()
def set_position_mode() -> str:
    """Switch to manual position-hold mode."""
    return json.dumps(drone_control.set_position_mode())


# ---------------------------------------------------------------------------
# Position control
# ---------------------------------------------------------------------------

@mcp.tool()
def set_position(x: float, y: float, z: float, yaw: float = 0.0) -> str:
    """Set target position in NED frame (North-East-Down).

    Args:
        x:   Meters north of home (positive = north)
        y:   Meters east of home  (positive = east)
        z:   Altitude -- use NEGATIVE values to go UP (e.g. -10 = 10 m above home)
        yaw: Heading in radians (0 = north, pi/2 = east)
    """
    return json.dumps(drone_control.set_position(x, y, z, yaw))


# ---------------------------------------------------------------------------
# State queries
# ---------------------------------------------------------------------------

@mcp.tool()
def get_state() -> str:
    """Get full drone state: position, velocity, battery, GPS, health, warnings."""
    return json.dumps(drone_control.get_state())


# ---------------------------------------------------------------------------
# Mission commands
# ---------------------------------------------------------------------------

@mcp.tool()
def upload_mission(waypoints: list[dict]) -> str:
    """Upload a waypoint mission.

    Args:
        waypoints: List of waypoint dicts. Each waypoint has:
            command  (int):  MAV_CMD -- 16=WAYPOINT, 22=TAKEOFF, 21=LAND
            latitude  (float): GPS degrees (0 for local frame)
            longitude (float): GPS degrees (0 for local frame)
            altitude  (float): Meters AMSL (or relative for local)
            yaw       (float): Radians
            acceptance_radius (float): Meters, default 5.0
            hold_time (float): Seconds at waypoint, default 0.0
            autocontinue (bool): Auto-advance, default true
            frame     (int):  0=GLOBAL, 1=LOCAL_NED
    """
    return json.dumps(drone_control.upload_mission(waypoints))


@mcp.tool()
def mission_control(command: str, item_index: int = 0) -> str:
    """Control mission execution.

    Args:
        command: One of START, PAUSE, RESUME, STOP, CLEAR, GOTO_ITEM
        item_index: Waypoint index for GOTO_ITEM (0-based)
    """
    return json.dumps(drone_control.mission_control(command, item_index))


@mcp.tool()
def get_mission_status() -> str:
    """Get mission progress: current item, total items, running state, progress %."""
    return json.dumps(drone_control.get_mission_status())


# ---------------------------------------------------------------------------
# Multi-drone
# ---------------------------------------------------------------------------

@mcp.tool()
def set_target_drone(drone_name: str) -> str:
    """Switch which drone to control (e.g. 'drone1', 'drone2')."""
    return drone_control.set_drone_name(drone_name)


@mcp.tool()
def get_target_drone() -> str:
    """Return the name of the currently targeted drone."""
    return drone_control.get_drone_name()


if __name__ == "__main__":
    mcp.run()
