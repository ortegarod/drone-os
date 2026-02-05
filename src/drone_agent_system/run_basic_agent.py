"""
DroneOS AI Agent -- Interactive CLI using OpenAI Agents SDK

Uses drone_control.py (via roslibpy/rosbridge) for drone commands.
No ROS 2 dependency required -- just needs rosbridge running.
"""

import os
import sys
import time
import threading
import traceback
import asyncio
from datetime import datetime
from dataclasses import dataclass
from typing import Optional

from agents import Agent, Runner, ModelSettings, RunContextWrapper

# Add project root for drone_control
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
import drone_control
import openai_agent_tools


@dataclass
class DroneContext:
    drone_id: str = "drone1"
    mission_active: bool = False
    autonomous_mode: bool = True
    last_command_time: Optional[datetime] = None
    conversation_history: list = None
    last_api_call_time: float = 0.0

    # Mission context state
    current_mission_id: Optional[int] = None
    mission_type: Optional[str] = None  # "patrol", "sprint", etc.
    mission_completion_actions: list = None  # Actions to take when mission completes

    def __post_init__(self):
        if self.conversation_history is None:
            self.conversation_history = []
        if self.mission_completion_actions is None:
            self.mission_completion_actions = []


def get_dynamic_instructions(ctx, agent) -> str:
    """Dynamic instructions that include real-time drone state"""
    try:
        state = drone_control.get_state()
        current_pos = (
            f"X={state.get('local_x', 0):.2f}m, Y={state.get('local_y', 0):.2f}m, "
            f"Z={state.get('local_z', 0):.2f}m, Yaw={state.get('local_yaw', 0):.2f}rad"
        )
    except Exception:
        current_pos = "Position unavailable"

    mode_text = "AUTONOMOUS" if ctx.context.autonomous_mode else "MANUAL"
    mission_text = "ACTIVE" if ctx.context.mission_active else "STANDBY"

    instructions = f"""You are an autonomous drone pilot for {ctx.context.drone_id}.

CURRENT STATUS:
- Position: {current_pos}
- Mode: {mode_text}
- Mission: {mission_text}
- Last command: {ctx.context.last_command_time or 'None'}

CAPABILITIES:
You can execute complex maneuvers using multiple tool calls in sequence:

BASIC CONTROL:
- get_drone_position() - Check current location and state
- drone_set_offboard_mode() - Enter offboard control
- drone_arm() - Arm the drone
- drone_set_position(x, y, z, yaw) - Move to specific position
- drone_land() - Land safely
- drone_disarm() - Disarm after landing

MISSION PLANNING (REQUIRED for patterns/patrols):
- upload_mission(waypoints_json) - Upload mission for patrols, patterns, multi-waypoint sequences
- start_mission_and_wait() - Execute uploaded mission autonomously (blocks until complete)
- get_mission_status() - Monitor mission progress
- pause_mission() / resume_mission() / stop_mission() - Mission control

CONTEXT-AWARE MISSION COMPLETION:
- store_mission_completion_actions(actions_json) - Store actions to execute when mission completes
- check_mission_completion_and_execute_actions() - Check if mission done and execute stored actions

AUTONOMOUS MISSION MANAGEMENT:
The AI acts as MISSION PLANNER only. Mission execution is autonomous:
1. Plan mission waypoints and completion actions
2. Store completion actions (land, disarm, return to base, next mission)
3. Mission runs autonomously using C++ implementation
4. System executes stored actions when mission completes

CRITICAL TOOL SELECTION:
- Use upload_mission() + start_mission_and_wait() for: patrols, patterns, surveys, any multi-waypoint sequence
- Use drone_set_position() ONLY for: single simple moves to one location

MULTI-WAYPOINT OPERATIONS:
For requests with multiple destinations (patrol, sprint, fly to X then Y):
1. Calculate waypoint coordinates in meters (NED frame)
2. Call upload_mission() with JSON waypoint data
3. Call start_mission_and_wait() - this blocks until mission completes
4. Then call any subsequent commands (like drone_land(), drone_disarm())

Examples requiring missions: "sprint to X and back", "fly to A then B", "patrol", "circle", "survey"

COORDINATE SYSTEM - CRITICAL UNDERSTANDING:
NED frame (North-East-Down) relative to takeoff position:
- X: North direction (+ = north, - = south)
- Y: East direction (+ = east, - = west)
- Z: Down direction (+ = underground, - = altitude)

FOR ALTITUDE: Always use NEGATIVE Z values!
- Z = -10 means 10 meters above takeoff
- Z = -20 means 20 meters above takeoff
- Z = +5 means 5 meters below ground (WRONG!)

FLIGHT PROCEDURES:
1. For ANY pattern/patrol (even 2+ waypoints): ALWAYS use upload_mission() + start_mission_and_wait()
2. For single simple moves only: Use drone_set_position()
3. Always get current position first with get_drone_position()
4. Calculate waypoints relative to current position for patterns

NEVER use multiple drone_set_position() calls - use missions instead!

PATTERN CALCULATIONS:
- For radius patterns: Calculate waypoints around current position
- For 100ft radius = ~30.5 meters radius
- Example: Current at (0,0,-15), patrol waypoints could be:
  [(30,0,-15), (0,30,-15), (-30,0,-15), (0,-30,-15)]

PATROL MISSION EXAMPLE:
For "patrol 50ft radius at 20ft altitude":
1. Get current position first
2. Calculate waypoints around current position (50ft = ~15.2m radius)"""

    instructions += '''
3. Convert altitude: 20ft = 6.1m, so Z = -6.1 (negative for altitude)
4. Call upload_mission() with JSON: [{"x": 15.2, "y": 0, "z": -6.1, "yaw": 0}, ...]
5. Call start_mission_and_wait() - mission runs until complete

SPRINT EXAMPLE WITH AUTONOMOUS COMPLETION:
For "sprint 1000 yard north at 500ft and return, then land and disarm":
1. Calculate waypoints: 1000 yards = 914.4m north, 500ft = 152.4m altitude (Z = -152.4)
   Waypoints: [{"x": 914.4, "y": 0, "z": -152.4, "yaw": 0.0, "radius": 5.0}, {"x": 0, "y": 0, "z": -152.4, "yaw": 0.0, "radius": 5.0}]
2. Store completion actions: store_mission_completion_actions('[{"type": "land"}, {"type": "disarm"}]')
3. Upload and start mission: upload_mission() then start_mission_and_wait()
4. Mission executes autonomously, system automatically lands and disarms when complete

UNIT CONVERSIONS:
- 1 yard = 0.9144 meters
- 1 foot = 0.3048 meters
- 1000 yards = 914.4 meters
- 500 feet = 152.4 meters

ALTITUDE CONVERSION (feet to NED Z):
- 10ft = 3.05m -> Z = -3.05
- 20ft = 6.1m -> Z = -6.1
- 30ft = 9.15m -> Z = -9.15
- 500ft = 152.4m -> Z = -152.4
'''

    return instructions


def main():
    # Ensure OPENAI_API_KEY is set
    if "OPENAI_API_KEY" not in os.environ:
        print("Error: OPENAI_API_KEY environment variable not set.")
        print("Please set it before running the agent.")
        print("Example: export OPENAI_API_KEY='sk-...'")
        sys.exit(1)

    # Test rosbridge connection
    try:
        print(f"Connecting to rosbridge at {drone_control.ROSBRIDGE_HOST}:{drone_control.ROSBRIDGE_PORT}...")
        drone_control.get_ros()
        print(f"Connected. Targeting drone: '{drone_control.get_drone_name()}'")
    except Exception as e:
        print(f"Failed to connect to rosbridge: {e}")
        print("Make sure rosbridge is running (default: localhost:9090)")
        sys.exit(1)

    # Tool list
    tools_list = [
        # Basic drone control
        openai_agent_tools.drone_set_offboard_mode,
        openai_agent_tools.drone_arm,
        openai_agent_tools.drone_land,
        openai_agent_tools.drone_disarm,
        openai_agent_tools.drone_set_position,
        openai_agent_tools.get_drone_telemetry,
        openai_agent_tools.get_drone_position,

        # Mission planning and execution
        openai_agent_tools.upload_mission,
        openai_agent_tools.start_mission_and_wait,
        openai_agent_tools.pause_mission,
        openai_agent_tools.resume_mission,
        openai_agent_tools.stop_mission,
        openai_agent_tools.get_mission_status,

        # Context-aware mission completion management
        openai_agent_tools.check_mission_completion_and_execute_actions,
        openai_agent_tools.store_mission_completion_actions,
    ]

    # Create drone context for this session
    drone_context = DroneContext()

    ai_drone_agent = Agent[DroneContext](
        name="AutonomousDroneAgent",
        instructions=get_dynamic_instructions,
        tools=tools_list,
        model="gpt-4o",
        model_settings=ModelSettings(
            tool_choice="required"
        ),
    )

    print("Autonomous Drone Agent ready. Type 'exit' to quit.")
    print("Make sure rosbridge and drone_core are running.")

    # Mission monitoring for autonomous completion
    def mission_monitor_loop():
        while True:
            time.sleep(5)
            try:
                if drone_context.mission_completion_actions:
                    wrapper = RunContextWrapper(drone_context)
                    # Call the underlying function directly
                    func = getattr(
                        openai_agent_tools.check_mission_completion_and_execute_actions,
                        '_func',
                        getattr(openai_agent_tools.check_mission_completion_and_execute_actions, 'func', None),
                    )
                    if func:
                        result = func(wrapper)
                        if "Mission completed!" in str(result):
                            print(f"AUTONOMOUS COMPLETION: {result}")
            except Exception as e:
                print(f"Mission monitor error: {e}")

    monitor_thread = threading.Thread(target=mission_monitor_loop, daemon=True)
    monitor_thread.start()

    # Interactive CLI loop
    try:
        while True:
            user_input = input("Drone Agent> ").strip()
            if not user_input:
                continue
            if user_input.lower() == "exit":
                print("Exiting agent...")
                break
            print(f"Sending to agent: '{user_input}'")

            # Rate limiting
            current_time = time.time()
            time_since_last = current_time - drone_context.last_api_call_time
            if time_since_last < 2.0:
                wait_time = 2.0 - time_since_last
                print(f"Rate limiting: waiting {wait_time:.1f}s...")
                time.sleep(wait_time)

            # Update context
            drone_context.autonomous_mode = False
            drone_context.last_command_time = datetime.now()
            drone_context.last_api_call_time = time.time()

            # Detect mission commands
            mission_keywords = ['patrol', 'mission', 'sprint', 'and back', 'return to', 'fly to', 'then']
            is_mission_command = any(kw in user_input.lower() for kw in mission_keywords)

            if is_mission_command:
                input_list = user_input
                drone_context.conversation_history = []

                # Remove drone_set_position to force mission usage
                mission_tools = [t for t in tools_list if t != openai_agent_tools.drone_set_position]
                temp_agent = Agent[DroneContext](
                    name="MissionDroneAgent",
                    instructions=get_dynamic_instructions,
                    tools=mission_tools,
                    model="gpt-4o",
                    model_settings=ModelSettings(tool_choice="required"),
                )

                drone_context.mission_type = user_input.lower()

                # Run with streaming for debug output
                async def run_mission_with_debug():
                    result = Runner.run_streamed(temp_agent, input_list, context=drone_context)
                    async for event in result.stream_events():
                        if event.type == "run_item_stream_event":
                            if event.item.type == "tool_call_item":
                                tool_name = getattr(event.item, 'tool_name', None) or \
                                           getattr(event.item, 'name', 'unknown')
                                print(f"  Tool: {tool_name}")
                            elif event.item.type == "tool_call_output_item":
                                output = event.item.output[:100] + "..." if len(event.item.output) > 100 else event.item.output
                                print(f"  Output: {output}")
                    return result

                result = asyncio.run(run_mission_with_debug())
            else:
                # Normal command
                if drone_context.conversation_history:
                    input_list = drone_context.conversation_history + [{"role": "user", "content": user_input}]
                else:
                    input_list = user_input

                result = Runner.run_sync(ai_drone_agent, input_list, context=drone_context)

            if result:
                drone_context.conversation_history = result.to_input_list()
                if result.final_output:
                    print(f"Agent: {result.final_output}")
                else:
                    print("Agent did not produce output.")
            else:
                print("Agent error occurred.")

    except KeyboardInterrupt:
        print("\nShutting down...")
    except EOFError:
        print("\nEOF received. Shutting down...")
    except Exception as e:
        print(f"Error: {e}")
        traceback.print_exc()
    finally:
        print("Cleanup complete.")


if __name__ == '__main__':
    main()
