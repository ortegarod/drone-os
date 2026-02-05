#!/usr/bin/env python3
"""
AI Agent Service - Event-driven AI execution for DroneOS
Receives trigger events via ROS 2 service and executes AI agent on demand.

Note: This service still uses rclpy for the ROS 2 service endpoint,
but drone commands go through drone_control.py (roslibpy/rosbridge).
"""

import rclpy
from rclpy.node import Node
from drone_interfaces.srv import ExecuteAIAgent
import json
import os
import sys
import traceback
from concurrent.futures import ThreadPoolExecutor

# Add project root for drone_control
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
import drone_control

# Import AI agent components
from agents import Agent, Runner
import openai_agent_tools
from run_basic_agent import DroneContext, get_dynamic_instructions


class AIAgentService(Node):
    """Service that executes AI agent on-demand based on trigger events"""

    def __init__(self):
        super().__init__('ai_agent_service')

        # Validate OpenAI API key
        if "OPENAI_API_KEY" not in os.environ:
            self.get_logger().error("OPENAI_API_KEY environment variable not set")
            raise RuntimeError("Missing OpenAI API key")

        # Test rosbridge connection
        try:
            drone_control.get_ros()
            self.get_logger().info(f"Connected to rosbridge. Targeting: {drone_control.get_drone_name()}")
        except Exception as e:
            self.get_logger().error(f"Failed to connect to rosbridge: {e}")
            raise

        # Create AI agent
        self.create_ai_agent()

        # Create ROS 2 service endpoint
        self.service = self.create_service(
            ExecuteAIAgent,
            '/drone1/execute_ai_agent',
            self.execute_ai_agent_callback
        )

        # Thread pool for async AI execution
        self.executor_pool = ThreadPoolExecutor(max_workers=2)

        self.get_logger().info("AI Agent Service initialized and ready")

    def create_ai_agent(self):
        """Create AI agent with tools"""
        tools_list = [
            openai_agent_tools.drone_set_offboard_mode,
            openai_agent_tools.drone_arm,
            openai_agent_tools.drone_land,
            openai_agent_tools.drone_disarm,
            openai_agent_tools.drone_set_position,
            openai_agent_tools.get_drone_telemetry,
            openai_agent_tools.get_drone_position,
        ]

        self.ai_agent = Agent[DroneContext](
            name="MissionCommander",
            instructions=self.get_trigger_instructions,
            tools=tools_list,
            model="gpt-4o-mini"
        )

        self.drone_context = DroneContext()
        self.drone_context.autonomous_mode = False

        self.get_logger().info("AI agent created successfully")

    def get_trigger_instructions(self, ctx, agent) -> str:
        """Dynamic instructions for high-level mission command"""
        try:
            state = drone_control.get_state()
            current_pos = (
                f"X={state.get('local_x', 0):.2f}m, Y={state.get('local_y', 0):.2f}m, "
                f"Z={state.get('local_z', 0):.2f}m"
            )
        except Exception:
            current_pos = "Position unavailable"

        return f"""You are a high-level mission commander for drone1.

CURRENT STATUS:
- Position: {current_pos}

ROLE:
You handle high-level mission decisions and execution. PX4 autopilot handles low-level flight control, stability, and drift correction.

You are called when:
- Mission commands need execution
- Complex decisions are required
- User gives high-level instructions

CAPABILITIES:
Use your available tools to accomplish missions. You have full access to drone control but focus on mission-level objectives.

COORDINATE SYSTEM: NED frame (North, East, Down) - positive Z is downward.

Analyze the context provided and execute the mission accordingly."""

    def execute_ai_agent_callback(self, request, response):
        """Handle AI agent execution requests"""
        try:
            self.get_logger().info(f"Received trigger: {request.trigger_type} (priority: {request.priority})")
            self.get_logger().info(f"Context: {request.description}")

            # Parse context data
            try:
                context_dict = json.loads(request.context_data) if request.context_data else {}
            except json.JSONDecodeError:
                context_dict = {"raw_data": request.context_data}

            # Create trigger message for AI
            trigger_message = self.create_trigger_message(request, context_dict)

            # Execute AI agent
            result = Runner.run_sync(
                self.ai_agent,
                trigger_message,
                context=self.drone_context,
                max_turns=5
            )

            if result and result.final_output:
                response.success = True
                response.response = result.final_output

                executed_commands = []
                for item in result.new_items:
                    if hasattr(item, 'tool_name'):
                        executed_commands.append(item.tool_name)

                response.commands_executed = executed_commands

                self.get_logger().info(f"AI response: {result.final_output}")
                if executed_commands:
                    self.get_logger().info(f"Commands executed: {executed_commands}")
            else:
                response.success = False
                response.error_message = "AI agent did not produce a response"
                self.get_logger().warning("AI agent did not produce output")

        except Exception as e:
            response.success = False
            response.error_message = str(e)
            self.get_logger().error(f"Error executing AI agent: {e}")
            traceback.print_exc()

        return response

    def create_trigger_message(self, request, context_dict):
        """Create formatted message for AI agent based on trigger"""
        message = f"TRIGGER EVENT: {request.trigger_type}\n"
        message += f"Priority: {request.priority:.2f}\n"
        message += f"Description: {request.description}\n"

        if context_dict:
            message += "Context Data:\n"
            for key, value in context_dict.items():
                message += f"  {key}: {value}\n"

        message += "\nPlease analyze this situation and respond appropriately."
        return message

    def shutdown(self):
        """Clean shutdown"""
        try:
            if hasattr(self, 'executor_pool'):
                self.executor_pool.shutdown(wait=True)
            self.get_logger().info("AI Agent Service shutdown complete")
        except Exception as e:
            self.get_logger().error(f"Error during shutdown: {e}")


def main():
    """Main entry point"""
    rclpy.init()

    try:
        service = AIAgentService()
        rclpy.spin(service)

    except KeyboardInterrupt:
        print("AI Agent Service interrupted")
    except Exception as e:
        print(f"AI Agent Service error: {e}")
        traceback.print_exc()
    finally:
        if 'service' in locals():
            service.shutdown()
        if rclpy.ok():
            rclpy.shutdown()


if __name__ == '__main__':
    main()
