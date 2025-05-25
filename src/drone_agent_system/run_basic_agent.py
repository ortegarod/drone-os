import rclpy
from agents import Agent, Runner
import drone_agent_tools # Import the module
import os # For OPENAI_API_KEY
import sys
import traceback # Import the traceback module
from rclpy.executors import SingleThreadedExecutor # Need to import this for the test

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
        drone_agent_tools.set_active_drone,
        drone_agent_tools.drone_set_offboard_mode,
        drone_agent_tools.drone_set_position_control_mode,
        drone_agent_tools.drone_arm,
        drone_agent_tools.drone_takeoff,
        drone_agent_tools.drone_land,
        drone_agent_tools.drone_disarm,
        drone_agent_tools.drone_set_position,
        drone_agent_tools.get_drone_telemetry # Includes the placeholder telemetry tool
    ]

    agent_instructions = (
        "You are a helpful drone control assistant. "
        "Use the available tools to command the drone based on user requests. "
        "Available commands include arming, taking off, landing, disarming, setting modes (offboard, position control), "
        "setting position (x, y, z, yaw in NED frame, yaw in radians), and changing the active drone. "
        "You can also get basic drone telemetry. "
        "Always confirm the active drone if unsure. "
        "For position commands, z is positive down."
    )

    ai_drone_agent = Agent(
        name="BasicDroneControllerAgent",
        instructions=agent_instructions,
        tools=tools_list,
        # You might want to specify a model, e.g., model="gpt-4o-mini"
        # model="gpt-4o-mini" # Example
    )

    print("Basic Drone Agent CLI. Type 'exit' to quit.")
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

    # Main application try/finally block for graceful shutdown
    try:
        if sys.stdin.isatty():
            print("Running in interactive mode. CLI is active.")
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
                    result = Runner.run_sync(ai_drone_agent, user_input)
                    if result and result.final_output:
                        print(f"Agent Response: {result.final_output}")
                    else:
                        print("Agent did not produce a final output or an error occurred.")
            except KeyboardInterrupt:
                print("\nUser interrupted (interactive mode). Shutting down...")
            except EOFError:
                print("\nEOF received (interactive mode). Shutting down...")
            except Exception as e:
                print(f"An unexpected error occurred in the interactive main loop: {e}")
                traceback.print_exc()
        else:
            print("Running in non-interactive mode. ROS node will spin. (No CLI input)")
            try:
                while rclpy.ok(): 
                    executor.spin_once(timeout_sec=1.0) 
            except KeyboardInterrupt:
                print("\nUser interrupted (non-interactive mode). Shutting down...")
            except Exception as e:
                print(f"An unexpected error occurred in the non-interactive main loop: {e}")
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
