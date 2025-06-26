#!/usr/bin/env python3
"""
AI Agent Service - Event-driven AI execution for DroneOS
Receives trigger events and executes AI agent only when needed
"""

import rclpy
from rclpy.node import Node
from drone_interfaces.srv import ExecuteAIAgent
import json
import os
import sys
import traceback
from typing import Optional
import asyncio
from concurrent.futures import ThreadPoolExecutor

# Import AI agent components
from agents import Agent, Runner
import drone_agent_tools
from run_basic_agent import DroneContext, get_dynamic_instructions


class AIAgentService(Node):
    """Service that executes AI agent on-demand based on trigger events"""
    
    def __init__(self):
        super().__init__('ai_agent_service')
        
        # Validate OpenAI API key
        if "OPENAI_API_KEY" not in os.environ:
            self.get_logger().error("OPENAI_API_KEY environment variable not set")
            raise RuntimeError("Missing OpenAI API key")
        
        # Initialize drone commander for AI tools
        self.init_drone_commander()
        
        # Create AI agent
        self.create_ai_agent()
        
        # Create service
        self.service = self.create_service(
            ExecuteAIAgent,
            '/drone1/execute_ai_agent',
            self.execute_ai_agent_callback
        )
        
        # Thread pool for async AI execution
        self.executor_pool = ThreadPoolExecutor(max_workers=2)
        
        self.get_logger().info("AI Agent Service initialized and ready")
        
    def init_drone_commander(self):
        """Initialize drone commander for AI tools"""
        try:
            # Use the existing pattern from run_basic_agent.py
            from rclpy.executors import SingleThreadedExecutor
            
            # Create commander instance for tools
            drone_agent_tools.drone_commander_instance = drone_agent_tools.DroneROS2Commander(
                default_drone_name='drone1',
                node_name='ai_agent_service_commander'
            )
            
            self.get_logger().info("Drone commander initialized for AI tools")
            
        except Exception as e:
            self.get_logger().error(f"Failed to initialize drone commander: {e}")
            raise
    
    def create_ai_agent(self):
        """Create AI agent with tools"""
        try:
            # Tool list for AI agent
            tools_list = [
                drone_agent_tools.drone_set_offboard_mode,
                drone_agent_tools.drone_arm,
                drone_agent_tools.drone_land,
                drone_agent_tools.drone_disarm,
                drone_agent_tools.drone_set_position,
                drone_agent_tools.get_drone_telemetry,
                drone_agent_tools.get_drone_position
            ]
            
            # Create AI agent
            self.ai_agent = Agent[DroneContext](
                name="MissionCommander",
                instructions=self.get_trigger_instructions,
                tools=tools_list,
                model="gpt-4o-mini"
            )
            
            # Create drone context
            self.drone_context = DroneContext()
            self.drone_context.autonomous_mode = False  # Event-driven mode
            
            self.get_logger().info("AI agent created successfully")
            
        except Exception as e:
            self.get_logger().error(f"Failed to create AI agent: {e}")
            raise
    
    def get_trigger_instructions(self, ctx, agent) -> str:
        """Dynamic instructions for high-level mission command"""
        try:
            # Get current position for context
            current_pos = drone_agent_tools.get_drone_position() if drone_agent_tools.drone_commander_instance else "Position unavailable"
        except:
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
            
            # Update drone context with trigger information
            self.drone_context.last_trigger_type = request.trigger_type
            self.drone_context.last_trigger_data = context_dict
            self.drone_context.last_trigger_priority = request.priority
            
            # Create trigger message for AI
            trigger_message = self.create_trigger_message(request, context_dict)
            
            # Execute AI agent synchronously (since this is a service callback)
            result = Runner.run_sync(
                self.ai_agent,
                trigger_message,
                context=self.drone_context,
                max_turns=5  # Limit turns for trigger responses
            )
            
            # Process result
            if result and result.final_output:
                response.success = True
                response.response = result.final_output
                
                # Extract commands executed (if any tool calls were made)
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
            message += f"Context Data:\n"
            for key, value in context_dict.items():
                message += f"  {key}: {value}\n"
        
        message += "\nPlease analyze this situation and respond appropriately."
        
        return message
    
    def shutdown(self):
        """Clean shutdown of AI agent service"""
        try:
            if hasattr(self, 'executor_pool'):
                self.executor_pool.shutdown(wait=True)
            
            if drone_agent_tools.drone_commander_instance:
                drone_agent_tools.drone_commander_instance.shutdown()
                
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