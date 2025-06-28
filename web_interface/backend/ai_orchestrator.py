"""
AI Orchestrator Service
Handles communication between web interface and drone AI agent system
"""
import sys
import os
import threading
import asyncio
import time
from datetime import datetime
from typing import Optional, Dict, Any
import json

# Add drone agent system to path
sys.path.append('/home/rodrigo/ws_droneOS/src/drone_agent_system')
sys.path.append('/home/rodrigo/ws_droneOS/src/drone_gcs_cli')

import rclpy
from rclpy.executors import SingleThreadedExecutor

# Import your existing AI agent system
import drone_agent_tools
from run_basic_agent import DroneContext, get_dynamic_instructions
from agents import Agent, Runner, ModelSettings


class AIOrchestrator:
    """
    AI Orchestrator that manages the drone AI agent for web interface commands
    """
    
    def __init__(self):
        self.ai_agent = None
        self.drone_context = None
        self.executor = None
        self.is_initialized = False
        self.last_command_time = 0.0
        self.command_lock = threading.Lock()
        
        # Initialize in separate thread to avoid blocking web server
        threading.Thread(target=self._initialize_ai_system, daemon=True).start()
    
    def _initialize_ai_system(self):
        """Initialize the AI agent system in background thread"""
        try:
            print("🤖 Initializing AI Orchestrator...")
            
            # Check for OpenAI API key
            if "OPENAI_API_KEY" not in os.environ:
                print("⚠️ Warning: OPENAI_API_KEY not set - AI features will be limited")
                return
            
            # Create executor for AI agent ROS2 operations
            self.executor = SingleThreadedExecutor()
            
            # Initialize drone commander for AI agent tools
            print("🔧 Setting up AI agent ROS2 connection...")
            drone_agent_tools.drone_commander_instance = drone_agent_tools.DroneROS2Commander(
                executor=self.executor,
                default_drone_name='drone1',
                node_name='web_ai_orchestrator_node'
            )
            
            # Add to executor
            self.executor.add_node(drone_agent_tools.drone_commander_instance)
            
            # Create drone context
            self.drone_context = DroneContext()
            self.drone_context.autonomous_mode = False  # Web-controlled mode
            
            # Create AI agent with your existing tools
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
                drone_agent_tools.start_mission_and_wait,
                drone_agent_tools.pause_mission,
                drone_agent_tools.resume_mission,
                drone_agent_tools.stop_mission,
                drone_agent_tools.get_mission_status,
                
                # Context-aware mission completion management
                drone_agent_tools.check_mission_completion_and_execute_actions,
                drone_agent_tools.store_mission_completion_actions
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
            
            # Start ROS2 spinning in background
            def ros_spinner():
                while rclpy.ok():
                    try:
                        self.executor.spin_once(timeout_sec=0.01)
                    except Exception as e:
                        print(f"ROS2 spinner error: {e}")
                        
            threading.Thread(target=ros_spinner, daemon=True).start()
            
            self.is_initialized = True
            print("✅ AI Orchestrator initialized successfully")
            
        except Exception as e:
            print(f"❌ AI Orchestrator initialization failed: {e}")
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
                print(f"🎯 AI Orchestrator processing: {user_message}")
                
                # Update context
                self.drone_context.last_command_time = datetime.now()
                self.drone_context.last_api_call_time = current_time
                self.last_command_time = current_time
                
                # Determine if this is a mission command
                mission_keywords = ['patrol', 'mission', 'sprint', 'and back', 'return to', 'fly to', 'then']
                is_mission_command = any(keyword in user_message.lower() for keyword in mission_keywords)
                
                if is_mission_command:
                    print("🎯 Detected mission command - using mission-specific agent")
                    # Use mission tools (without drone_set_position to force mission usage)
                    mission_tools = [tool for tool in self.ai_agent.tools if tool != drone_agent_tools.drone_set_position]
                    temp_agent = Agent[DroneContext](
                        name="MissionAIOrchestrator",
                        instructions=get_dynamic_instructions,
                        tools=mission_tools,
                        model="gpt-4o",
                        model_settings=ModelSettings(tool_choice="required")
                    )
                    agent_to_use = temp_agent
                    self.drone_context.conversation_history = []  # Clear for mission focus
                else:
                    agent_to_use = self.ai_agent
                
                # Run AI agent
                if self.drone_context.conversation_history:
                    input_list = self.drone_context.conversation_history + [{"role": "user", "content": user_message}]
                else:
                    input_list = user_message
                
                # Execute AI agent synchronously (in thread pool to avoid blocking)
                loop = asyncio.get_event_loop()
                result = await loop.run_in_executor(
                    None, 
                    lambda: Runner.run_sync(agent_to_use, input_list, context=self.drone_context)
                )
                
                if result:
                    # Update conversation history
                    self.drone_context.conversation_history = result.to_input_list()
                    
                    response_text = result.final_output or "Command executed successfully"
                    
                    print(f"✅ AI Orchestrator response: {response_text}")
                    
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
                        "response": "The AI agent was unable to process your command. Please try rephrasing or check system status."
                    }
                    
            except Exception as e:
                print(f"❌ AI Orchestrator error: {e}")
                import traceback
                traceback.print_exc()
                
                return {
                    "success": False,
                    "message": f"AI processing error: {str(e)}",
                    "response": f"An error occurred while processing your command: {str(e)}"
                }
    
    def get_status(self) -> Dict[str, Any]:
        """Get AI orchestrator status"""
        return {
            "initialized": self.is_initialized,
            "ai_agent_available": self.ai_agent is not None,
            "drone_context_active": self.drone_context is not None,
            "ros2_ok": rclpy.ok() if 'rclpy' in globals() else False,
            "openai_key_configured": "OPENAI_API_KEY" in os.environ,
            "last_command_time": self.last_command_time
        }
    
    def shutdown(self):
        """Clean shutdown of AI orchestrator"""
        try:
            if drone_agent_tools.drone_commander_instance:
                drone_agent_tools.drone_commander_instance.shutdown()
            if self.executor:
                self.executor.shutdown()
            print("🔄 AI Orchestrator shutdown complete")
        except Exception as e:
            print(f"Error during AI orchestrator shutdown: {e}")


# Global orchestrator instance
ai_orchestrator = None

def get_ai_orchestrator() -> AIOrchestrator:
    """Get or create global AI orchestrator instance"""
    global ai_orchestrator
    if ai_orchestrator is None:
        ai_orchestrator = AIOrchestrator()
    return ai_orchestrator