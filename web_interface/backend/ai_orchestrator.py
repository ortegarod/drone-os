"""
AI Orchestrator Service
Handles communication between web interface and drone AI agent system.

Uses drone_control.py (roslibpy/rosbridge) for drone commands.
No ROS 2 dependency required.
"""
import sys
import os
import threading
import asyncio
import time
from datetime import datetime
from typing import Optional, Dict, Any
import json

# Add paths for imports
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', '..'))  # project root
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', '..', 'src', 'drone_agent_system'))

import drone_control
import openai_agent_tools
from run_basic_agent import DroneContext, get_dynamic_instructions
from agents import Agent, Runner, ModelSettings


class AIOrchestrator:
    """
    AI Orchestrator that manages the drone AI agent for web interface commands
    """

    def __init__(self):
        self.ai_agent = None
        self.drone_context = None
        self.is_initialized = False
        self.last_command_time = 0.0
        self.command_lock = threading.Lock()

        # Initialize in separate thread to avoid blocking web server
        threading.Thread(target=self._initialize_ai_system, daemon=True).start()

    def _initialize_ai_system(self):
        """Initialize the AI agent system in background thread"""
        try:
            print("Initializing AI Orchestrator...")

            # Check for OpenAI API key
            if "OPENAI_API_KEY" not in os.environ:
                print("Warning: OPENAI_API_KEY not set - AI features will be limited")
                return

            # Test rosbridge connection
            print("Connecting to rosbridge...")
            drone_control.get_ros()
            print(f"Connected. Targeting: {drone_control.get_drone_name()}")

            # Create drone context
            self.drone_context = DroneContext()
            self.drone_context.autonomous_mode = False  # Web-controlled mode

            # Create AI agent with tools
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

            self.ai_agent = Agent[DroneContext](
                name="WebAIOrchestrator",
                instructions=get_dynamic_instructions,
                tools=tools_list,
                model="gpt-4o",
                model_settings=ModelSettings(
                    tool_choice="required"
                )
            )

            self.is_initialized = True
            print("AI Orchestrator initialized successfully")

        except Exception as e:
            print(f"AI Orchestrator initialization failed: {e}")
            import traceback
            traceback.print_exc()

    async def process_command(self, user_message: str) -> Dict[str, Any]:
        """
        Process natural language command from web interface
        """
        with self.command_lock:
            # Rate limiting
            current_time = time.time()
            if current_time - self.last_command_time < 2.0:
                return {
                    "success": False,
                    "message": "Rate limit: Please wait before sending another command",
                    "response": "Commands are rate-limited to prevent system overload."
                }

            if not self.is_initialized:
                return {
                    "success": False,
                    "message": "AI Orchestrator is still initializing",
                    "response": "Please wait for AI system to finish initializing."
                }

            if not self.ai_agent or not self.drone_context:
                return {
                    "success": False,
                    "message": "AI Agent not available",
                    "response": "AI agent system is not properly configured. Check OpenAI API key and system status."
                }

            try:
                print(f"AI Orchestrator processing: {user_message}")

                # Update context
                self.drone_context.last_command_time = datetime.now()
                self.drone_context.last_api_call_time = current_time
                self.last_command_time = current_time

                # Determine if this is a mission command
                mission_keywords = ['patrol', 'mission', 'sprint', 'and back', 'return to', 'fly to', 'then']
                is_mission_command = any(keyword in user_message.lower() for keyword in mission_keywords)

                if is_mission_command:
                    print("Detected mission command - using mission-specific agent")
                    mission_tools = [tool for tool in self.ai_agent.tools if tool != openai_agent_tools.drone_set_position]
                    temp_agent = Agent[DroneContext](
                        name="MissionAIOrchestrator",
                        instructions=get_dynamic_instructions,
                        tools=mission_tools,
                        model="gpt-4o",
                        model_settings=ModelSettings(tool_choice="required")
                    )
                    agent_to_use = temp_agent
                    self.drone_context.conversation_history = []
                else:
                    agent_to_use = self.ai_agent

                # Run AI agent
                if self.drone_context.conversation_history:
                    input_list = self.drone_context.conversation_history + [{"role": "user", "content": user_message}]
                else:
                    input_list = user_message

                # Execute AI agent
                loop = asyncio.get_event_loop()
                result = await loop.run_in_executor(
                    None,
                    lambda: Runner.run_sync(agent_to_use, input_list, context=self.drone_context)
                )

                if result:
                    self.drone_context.conversation_history = result.to_input_list()
                    response_text = result.final_output or "Command executed successfully"

                    print(f"AI Orchestrator response: {response_text}")

                    return {
                        "success": True,
                        "message": f"AI processed: {user_message}",
                        "response": response_text,
                        "agent_type": "mission" if is_mission_command else "standard"
                    }
                else:
                    return {
                        "success": False,
                        "message": "AI agent execution failed",
                        "response": "The AI agent was unable to process your command."
                    }

            except Exception as e:
                print(f"AI Orchestrator error: {e}")
                import traceback
                traceback.print_exc()

                return {
                    "success": False,
                    "message": f"AI processing error: {str(e)}",
                    "response": f"An error occurred: {str(e)}"
                }

    def get_status(self) -> Dict[str, Any]:
        """Get AI orchestrator status"""
        return {
            "initialized": self.is_initialized,
            "ai_agent_available": self.ai_agent is not None,
            "drone_context_active": self.drone_context is not None,
            "openai_key_configured": "OPENAI_API_KEY" in os.environ,
            "last_command_time": self.last_command_time
        }

    def shutdown(self):
        """Clean shutdown of AI orchestrator"""
        print("AI Orchestrator shutdown complete")


# Global orchestrator instance
ai_orchestrator = None

def get_ai_orchestrator() -> AIOrchestrator:
    """Get or create global AI orchestrator instance"""
    global ai_orchestrator
    if ai_orchestrator is None:
        ai_orchestrator = AIOrchestrator()
    return ai_orchestrator
