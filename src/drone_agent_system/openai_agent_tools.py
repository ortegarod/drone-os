"""
OpenAI Agents SDK tools for DroneOS.

Thin wrappers around drone_control.py, decorated with @function_tool
for use with the OpenAI Agents SDK. Framework-specific features like
mission completion actions are also defined here.
"""

import json
import sys
import os
from agents import function_tool, RunContextWrapper
from typing import TYPE_CHECKING, Any

# Add project root to path for drone_control import
_project_root = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, _project_root)
import drone_control

if TYPE_CHECKING:
    from run_basic_agent import DroneContext


# ---------------------------------------------------------------------------
# Basic flight commands
# ---------------------------------------------------------------------------

@function_tool
def drone_set_offboard_mode() -> str:
    """Commands the currently targeted drone to enter Offboard mode."""
    return json.dumps(drone_control.set_offboard())


@function_tool
def drone_arm() -> str:
    """Arms the currently targeted drone."""
    return json.dumps(drone_control.arm())


@function_tool
def drone_land() -> str:
    """Commands the currently targeted drone to land."""
    return json.dumps(drone_control.land())


@function_tool
def drone_disarm() -> str:
    """Disarms the currently targeted drone."""
    return json.dumps(drone_control.disarm())


@function_tool
def drone_set_position(x: float, y: float, z: float, yaw: float) -> str:
    """
    Sets the target position for SINGLE WAYPOINT movements only.

    WARNING: DO NOT use for multi-waypoint sequences -- use upload_mission instead.

    COORDINATE SYSTEM: NED (North-East-Down) frame relative to takeoff position
    - X: North (positive = north)
    - Y: East (positive = east)
    - Z: Down (NEGATIVE = altitude, e.g. Z=-20 means 20m above takeoff)

    Args:
        x: North position in meters
        y: East position in meters
        z: Down position in meters (use NEGATIVE for altitude)
        yaw: Heading in radians (0 = north)
    """
    return json.dumps(drone_control.set_position(x, y, z, yaw))


# ---------------------------------------------------------------------------
# Telemetry & state
# ---------------------------------------------------------------------------

@function_tool
def get_drone_telemetry() -> str:
    """Retrieves full telemetry data from the currently targeted drone."""
    state = drone_control.get_state()
    return f"Current telemetry: {json.dumps(state)}"


@function_tool
def get_drone_position() -> str:
    """
    Gets the current position and basic state of the targeted drone.
    Returns position in NED frame (North-East-Down).
    """
    state = drone_control.get_state()

    pos_info = (
        f"Position: X={state.get('local_x', 0):.2f}m, Y={state.get('local_y', 0):.2f}m, "
        f"Z={state.get('local_z', 0):.2f}m, Yaw={state.get('local_yaw', 0):.2f}rad"
    )
    state_info = (
        f"State: {state.get('arming_state', 'UNKNOWN')}, "
        f"Mode: {state.get('nav_state', 'UNKNOWN')}, "
        f"Landing: {state.get('landing_state', 'UNKNOWN')}"
    )
    validity = f"Position Valid: {state.get('position_valid', False)}"

    return f"{pos_info} | {state_info} | {validity}"


# ---------------------------------------------------------------------------
# Mission planning & execution
# ---------------------------------------------------------------------------

@function_tool
def upload_mission(waypoints_data: str) -> str:
    """
    Upload a mission for PATTERNS, PATROLS, and MULTI-WAYPOINT sequences.

    MUST be called before start_mission_and_wait().

    COORDINATE SYSTEM: NED frame -- use NEGATIVE Z for altitude (Z=-15 = 15m high)

    Args:
        waypoints_data: JSON string of waypoints. Format:
            '[{"x": 10.0, "y": 0.0, "z": -20.0, "yaw": 0.0, "hold_time": 2.0}, ...]'
    """
    try:
        points = json.loads(waypoints_data)
        waypoints = drone_control.build_local_waypoints(points)
        result = drone_control.upload_mission(waypoints)

        if result.get("success"):
            return f"Mission uploaded: {len(waypoints)} waypoints, ID: {result.get('mission_id', 'N/A')}"
        return f"Upload failed: {result.get('message', 'Unknown error')}"
    except json.JSONDecodeError:
        return "Error: Invalid JSON format for waypoints"


@function_tool
def start_mission_and_wait() -> str:
    """Start executing the uploaded mission and wait for completion. Blocks until done."""
    result = drone_control.start_mission_and_wait()
    if result.get("success"):
        return f"Mission completed: {result.get('progress', 0) * 100:.1f}% done"
    return f"Mission failed: {result.get('message', 'Unknown error')}"


@function_tool
def pause_mission() -> str:
    """Pause the currently executing mission."""
    return json.dumps(drone_control.mission_control("PAUSE"))


@function_tool
def resume_mission() -> str:
    """Resume a paused mission."""
    return json.dumps(drone_control.mission_control("RESUME"))


@function_tool
def stop_mission() -> str:
    """Stop the currently executing mission."""
    return json.dumps(drone_control.mission_control("STOP"))


@function_tool
def get_mission_status() -> str:
    """Get the status of the current mission."""
    status = drone_control.get_mission_status()

    if not status.get("mission_valid"):
        return "No valid mission loaded"

    progress = (
        f"Progress: {status.get('mission_progress', 0) * 100:.1f}% "
        f"({status.get('current_item', 0)}/{status.get('total_items', 0)})"
    )
    state = f"Running: {status.get('mission_running')}, Finished: {status.get('mission_finished')}"
    return f"Mission Status - {progress} | {state} | ID: {status.get('mission_id', 'N/A')}"


# ---------------------------------------------------------------------------
# OpenAI-specific: Mission completion context management
# ---------------------------------------------------------------------------

@function_tool
def store_mission_completion_actions(wrapper: RunContextWrapper[Any], actions_data: str) -> str:
    """
    Store actions to execute when the current mission completes.

    Args:
        actions_data: JSON string. Supported types:
            '[{"type": "land"}, {"type": "disarm"}, {"type": "return_to_base", "position": {"x": 0, "y": 0, "z": -10, "yaw": 0}}]'
    """
    try:
        actions = json.loads(actions_data)
        context = wrapper.context
        context.mission_completion_actions = actions

        descriptions = []
        for a in actions:
            atype = a.get("type", "unknown")
            if atype == "return_to_base":
                pos = a.get("position", {})
                descriptions.append(f"return to ({pos.get('x', 0)}, {pos.get('y', 0)}, {pos.get('z', -10)})")
            else:
                descriptions.append(atype)

        return f"Stored {len(actions)} completion actions: {', '.join(descriptions)}"
    except json.JSONDecodeError:
        return "Error: Invalid JSON for completion actions"


@function_tool
def check_mission_completion_and_execute_actions(wrapper: RunContextWrapper[Any]) -> str:
    """Check if mission is complete and execute stored completion actions."""
    try:
        status = drone_control.get_mission_status()
        context = wrapper.context

        if status.get("mission_finished") and context.mission_completion_actions:
            actions_taken = []

            for action in context.mission_completion_actions:
                atype = action.get("type", "")
                if atype == "land":
                    result = drone_control.land()
                    actions_taken.append(f"Landing: {result.get('message', '')}")
                elif atype == "disarm":
                    result = drone_control.disarm()
                    actions_taken.append(f"Disarming: {result.get('message', '')}")
                elif atype == "return_to_base":
                    pos = action.get("position", {"x": 0, "y": 0, "z": -10, "yaw": 0})
                    result = drone_control.set_position(pos["x"], pos["y"], pos["z"], pos["yaw"])
                    actions_taken.append(f"Return to base: {result.get('message', '')}")

            context.mission_completion_actions = []
            context.current_mission_id = None
            context.mission_type = None
            return f"Mission completed! Actions: {'; '.join(actions_taken)}"

        elif status.get("mission_finished"):
            context.current_mission_id = None
            context.mission_type = None
            return "Mission completed -- no completion actions configured"

        elif status.get("mission_running"):
            return f"Mission in progress: {status.get('mission_progress', 0) * 100:.1f}%"

        return "No active mission"
    except Exception as e:
        return f"Error checking mission completion: {e}"
