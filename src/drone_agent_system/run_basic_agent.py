import rclpy
from agents import Agent, Runner, ModelSettings, ItemHelpers
import drone_agent_tools # Import the module
import os # For OPENAI_API_KEY
import sys
import traceback # Import the traceback module
import asyncio
import time
from datetime import datetime
from dataclasses import dataclass
from typing import Optional
from rclpy.executors import SingleThreadedExecutor # Need to import this for the test

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
        # Get current position for context
        current_pos = drone_agent_tools.get_drone_position() if drone_agent_tools.drone_commander_instance else "Position unavailable"
    except:
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
- start_mission() - Execute uploaded mission autonomously with persistent monitoring
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
- Use upload_mission() + start_mission() for: patrols, patterns, surveys, any multi-waypoint sequence
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
1. For ANY pattern/patrol (even 2+ waypoints): ALWAYS use upload_mission() + start_mission()
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
5. Call start_mission() - mission runs persistently

SPRINT EXAMPLE WITH AUTONOMOUS COMPLETION:
For "sprint 1000 yard north at 500ft and return, then land and disarm":
1. Calculate waypoints: 1000 yards = 914.4m north, 500ft = 152.4m altitude (Z = -152.4)
   Waypoints: [{"x": 914.4, "y": 0, "z": -152.4, "yaw": 0.0, "radius": 5.0}, {"x": 0, "y": 0, "z": -152.4, "yaw": 0.0, "radius": 5.0}]
2. Store completion actions: store_mission_completion_actions('[{"type": "land"}, {"type": "disarm"}]')
3. Upload and start mission: upload_mission() then start_mission()
4. Mission executes autonomously, system automatically lands and disarms when complete

UNIT CONVERSIONS:
- 1 yard = 0.9144 meters
- 1 foot = 0.3048 meters
- 1000 yards = 914.4 meters
- 500 feet = 152.4 meters

ALTITUDE CONVERSION (feet to NED Z):
- 10ft = 3.05m → Z = -3.05
- 20ft = 6.1m → Z = -6.1  
- 30ft = 9.15m → Z = -9.15
- 500ft = 152.4m → Z = -152.4
'''
    
    return instructions



def main():
    # Ensure OPENAI_API_KEY is set
    if "OPENAI_API_KEY" not in os.environ:
        print("Error: OPENAI_API_KEY environment variable not set.")
        print("Please set it before running the agent.")
        print("Example: export OPENAI_API_KEY='sk-...'")
        sys.exit(1)

    rclpy.init()
    print("DEBUG: rclpy.init() called.")

    executor = None
    drone_agent_tools.drone_commander_instance = None # Ensure it's defined for finally if setup fails early

    try:
        print("DEBUG: Creating SingleThreadedExecutor...")
        executor = SingleThreadedExecutor()
        if executor is None:
            print("CRITICAL: SingleThreadedExecutor() returned None in main script. Exiting.")
            sys.exit(1)
        print(f"DEBUG: SingleThreadedExecutor created: {executor}")

        # Initialize the global drone_commander_instance from the tools module
        # Pass the executor to the commander.
        print("DEBUG: Attempting to initialize DroneROS2Commander...")
        drone_agent_tools.drone_commander_instance = drone_agent_tools.DroneROS2Commander(
            executor=executor, # Pass the created executor
            default_drone_name='drone1', 
            node_name='basic_agent_ros_interface_node'
        )
        print("DEBUG: DroneROS2Commander instance created.")

        # Add the commander node to the executor
        print(f"DEBUG: Adding DroneROS2Commander node ({drone_agent_tools.drone_commander_instance.get_name()}) to executor...")
        executor.add_node(drone_agent_tools.drone_commander_instance)
        print("DEBUG: DroneROS2Commander node added to executor.")

    except Exception as e:
        print(f"CRITICAL: Error during initial ROS2/Agent setup: {e}")
        traceback.print_exc() # Print the full traceback
        # Perform immediate cleanup if setup fails
        if drone_agent_tools.drone_commander_instance:
            # Attempt to destroy node if it was partially created
            try:
                if drone_agent_tools.drone_commander_instance.context.ok():
                    drone_agent_tools.drone_commander_instance.destroy_node()
            except Exception as destroy_e:
                print(f"DEBUG: Error destroying node during setup failure: {destroy_e}")
        if executor:
            executor.shutdown()
        if rclpy.ok():
            rclpy.shutdown()
        sys.exit(1)
    
    # If setup was successful, proceed with agent logic
    # List of tool functions from the drone_agent_tools module
    tools_list = [
        # Basic drone control
        drone_agent_tools.drone_set_offboard_mode,
        drone_agent_tools.drone_arm,
        drone_agent_tools.drone_land,
        drone_agent_tools.drone_disarm,
        drone_agent_tools.drone_set_position,
        drone_agent_tools.get_drone_telemetry,
        drone_agent_tools.get_drone_position,
        
        # Mission planning and execution
        drone_agent_tools.upload_mission,
        drone_agent_tools.start_mission_and_wait,  # Blocks until completion
        drone_agent_tools.pause_mission,
        drone_agent_tools.resume_mission,
        drone_agent_tools.stop_mission,
        drone_agent_tools.get_mission_status,
        
        # Context-aware mission completion management
        drone_agent_tools.check_mission_completion_and_execute_actions,
        drone_agent_tools.store_mission_completion_actions
    ]

    # Create drone context for this session
    drone_context = DroneContext()

    ai_drone_agent = Agent[DroneContext](
        name="AutonomousDroneAgent", 
        instructions=get_dynamic_instructions,  # Dynamic instructions function
        tools=tools_list,
        model="gpt-4o",  # Use full gpt-4o for better tool usage reliability
        model_settings=ModelSettings(
            tool_choice="required"  # Force the agent to use tools for mission commands
        )
    )

    print("Autonomous Drone Agent. Type 'exit' to quit.")
    # Ensure instance is not None before accessing attributes, in case of early exit
    if drone_agent_tools.drone_commander_instance:
        print(f"Targeting drone: '{drone_agent_tools.drone_commander_instance.target_drone}' initially.")
    else:
        print("Error: Drone commander instance not initialized. Exiting.")
        if executor:
            executor.shutdown()
        if rclpy.ok():
            rclpy.shutdown()
        sys.exit(1)
        
    print("Make sure your ROS 2 environment is sourced and drone services are available.")

    # Create AI orchestrator service server for web interface communication
    web_command_queue = []  # Simple queue for commands from web interface
    
    def handle_web_command(request, response):
        """Handle command from web interface"""
        try:
            # Add command to queue for processing
            # For now, we'll process immediately in the main loop
            print(f"🌐 Web command received via ROS2 service")
            
            # We'll use a simple flag system for this demo
            # The actual command will come through a different mechanism
            response.success = True
            response.message = "Command received by AI orchestrator"
            
            return response
        except Exception as e:
            print(f"Error handling web command: {e}")
            response.success = False
            response.message = f"Error: {str(e)}"
            return response
    
    # Create service server for web interface
    if drone_agent_tools.drone_commander_instance:
        try:
            from std_srvs.srv import Trigger
            web_service = drone_agent_tools.drone_commander_instance.create_service(
                Trigger,
                '/ai_agent/process_command',
                handle_web_command
            )
            print("🌐 AI Orchestrator service server created: /ai_agent/process_command")
        except Exception as e:
            print(f"Warning: Could not create web service: {e}")

    # Mission monitoring for autonomous completion
    mission_monitor_timer = None
    
    def check_mission_completion_periodically():
        """Periodic check for mission completion and execute stored actions"""
        try:
            if drone_context.mission_completion_actions:
                # Use the completion checker tool function directly with proper context
                from agents import RunContextWrapper
                wrapper = RunContextWrapper(drone_context)
                # Call the actual function directly
                try:
                    # Try to get the underlying function from the FunctionTool
                    if hasattr(drone_agent_tools.check_mission_completion_and_execute_actions, '_func'):
                        result = drone_agent_tools.check_mission_completion_and_execute_actions._func(wrapper)
                    elif hasattr(drone_agent_tools.check_mission_completion_and_execute_actions, 'func'):
                        result = drone_agent_tools.check_mission_completion_and_execute_actions.func(wrapper)
                    else:
                        # Fallback: just call the FunctionTool directly (might work)
                        result = str(drone_agent_tools.check_mission_completion_and_execute_actions)
                except Exception as e:
                    print(f"DEBUG: Mission monitoring access error: {e}")
                    result = "Mission monitoring temporarily unavailable"
                if "Mission completed!" in result:
                    print(f"AUTONOMOUS COMPLETION: {result}")
        except Exception as e:
            print(f"DEBUG: Mission monitoring error: {e}")
    
    # Start mission monitoring timer (check every 5 seconds)
    import threading
    def mission_monitor_loop():
        while True:
            time.sleep(5)
            check_mission_completion_periodically()
    
    monitor_thread = threading.Thread(target=mission_monitor_loop, daemon=True)
    monitor_thread.start()
    print("DEBUG: Started autonomous mission completion monitoring")

    # Interactive CLI mode only
    print("Running in interactive CLI mode.")
    try:
        while True:
            executor.spin_once(timeout_sec=0.05) 
            user_input = input("Drone Agent> ").strip()
            if not user_input:
                continue
            if user_input.lower() == "exit":
                print("Exiting agent...")
                break
            print(f"Sending to agent: '{user_input}'")
            
            # Rate limiting - minimum 2 seconds between API calls
            current_time = time.time()
            time_since_last_call = current_time - drone_context.last_api_call_time
            if time_since_last_call < 2.0:
                wait_time = 2.0 - time_since_last_call
                print(f"Rate limiting: waiting {wait_time:.1f}s before API call...")
                time.sleep(wait_time)
            
            # Update context for interactive mode
            drone_context.autonomous_mode = False
            drone_context.last_command_time = datetime.now()
            drone_context.last_api_call_time = time.time()
            
            # Use context in interactive mode too - but clear history for mission commands to avoid confusion
            mission_keywords = ['patrol', 'mission', 'sprint', 'and back', 'return to', 'fly to', 'then']
            is_mission_command = any(keyword in user_input.lower() for keyword in mission_keywords)
            
            if is_mission_command:
                # Clear conversation history for mission commands to avoid tool sequence confusion
                input_list = user_input
                drone_context.conversation_history = []
                print("DEBUG: Cleared conversation history for mission command")
                
                # Temporarily remove drone_set_position from tools to force mission usage
                mission_tools = [tool for tool in tools_list if tool != drone_agent_tools.drone_set_position]
                temp_agent = Agent[DroneContext](
                    name="MissionDroneAgent", 
                    instructions=get_dynamic_instructions,
                    tools=mission_tools,  # Without drone_set_position
                    model="gpt-4o",
                    model_settings=ModelSettings(tool_choice="required")
                )
                
                # Store mission context
                drone_context.mission_type = user_input.lower()
                print(f"DEBUG: Set mission type in context: {drone_context.mission_type}")
                mission_tool_names = [getattr(tool, 'name', str(tool)) for tool in mission_tools]
                print(f"DEBUG: Created temporary agent without drone_set_position. Available tools: {mission_tool_names}")
                
                # Use the mission-specific agent with streaming to debug tool sequence
                print("DEBUG: Starting mission agent with streaming debug...")
                
                async def run_mission_with_debug():
                    result = Runner.run_streamed(temp_agent, input_list, context=drone_context)
                    tool_sequence = []
                    
                    async for event in result.stream_events():
                        if event.type == "run_item_stream_event":
                            if event.item.type == "tool_call_item":
                                # Try multiple ways to get tool name
                                tool_name = getattr(event.item, 'tool_name', None) or \
                                           getattr(event.item, 'name', None) or \
                                           getattr(getattr(event.item, 'raw', {}), 'function', {}).get('name', 'unknown')
                                tool_sequence.append(f"CALLING: {tool_name}")
                                print(f"DEBUG: Tool called: {tool_name}")
                            elif event.item.type == "tool_call_output_item":
                                output = event.item.output[:100] + "..." if len(event.item.output) > 100 else event.item.output
                                tool_sequence.append(f"OUTPUT: {output}")
                                print(f"DEBUG: Tool output: {output}")
                    
                    print(f"DEBUG: Complete tool sequence: {tool_sequence}")
                    return result
                
                # Run the async streaming function
                import asyncio
                result = asyncio.run(run_mission_with_debug())
                ai_drone_agent.model_settings.tool_choice = "required"  # Reset main agent
            else:
                # Normal execution for non-mission commands
                if drone_context.conversation_history:
                    input_list = drone_context.conversation_history + [{"role": "user", "content": user_input}]
                else:
                    input_list = user_input
                
                result = Runner.run_sync(ai_drone_agent, input_list, context=drone_context)
            
            if result:
                # Update conversation history
                drone_context.conversation_history = result.to_input_list()
                if result.final_output:
                    print(f"Agent Response: {result.final_output}")
                else:
                    print("Agent did not produce a final output.")
            else:
                print("Agent error occurred.")
    except KeyboardInterrupt:
        print("\nUser interrupted. Shutting down...")
    except EOFError:
        print("\nEOF received. Shutting down...")
    except Exception as e:
        print(f"An unexpected error occurred in the main loop: {e}")
        traceback.print_exc()
    finally:
        print("Cleaning up...")
        if drone_agent_tools.drone_commander_instance:
            print("DEBUG: Shutting down DroneROS2Commander node...")
            drone_agent_tools.drone_commander_instance.shutdown() 
            print("DEBUG: DroneROS2Commander node shutdown complete.")
        if executor:
            print("DEBUG: Shutting down executor...")
            executor.shutdown()
            print("DEBUG: Executor shutdown complete.")
        if rclpy.ok():
            print("DEBUG: Shutting down rclpy...")
            rclpy.shutdown()
            print("DEBUG: rclpy shutdown complete.")
        print("Cleanup complete. Exited.")

if __name__ == '__main__':
    main()
