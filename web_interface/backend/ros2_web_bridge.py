"""
DroneOS ROS2-Web Bridge
Simple ROS2 node that discovers services and topics with FastAPI web server
"""
import sys
import os
import threading
import asyncio
import json
import time
from typing import List, Dict, Set, Optional, Any
from contextlib import asynccontextmanager

import rclpy
from rclpy.node import Node
from rclpy.qos import QoSProfile, ReliabilityPolicy, HistoryPolicy
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
import uvicorn
from std_srvs.srv import Trigger

# Import DroneOS service types
try:
    from drone_interfaces.srv import SetPosition, GetState, MissionControl, GetMissionStatus, UploadMission
    from drone_interfaces.msg import Waypoint
except ImportError:
    print("Warning: drone_interfaces not found. Some services may not work.")
    SetPosition = None
    GetState = None

class ROS2WebBridge(Node):
    """
    Simple ROS2 node that discovers services and topics, serves web interface
    Single process handles both ROS2 discovery and web communications
    """
    
    def __init__(self, default_drone_name='drone1'):
        # Initialize ROS2 node
        super().__init__('ros2_web_bridge')
        
        # Current target drone
        self.target_drone = default_drone_name
        
        # Web interface state
        self.active_websockets: Set[WebSocket] = set()
        self.latest_status = {
            "drone_name": self.target_drone,
            "connected": True,
            "armed": False,
            "flight_mode": "UNKNOWN",
            "position": {"x": 0, "y": 0, "z": 0, "yaw": 0},
            "battery": 0,
            "timestamp": time.time()
        }
        
        # ROS2 discovery state
        self.discovered_services = {}
        self.discovered_topics = {}
        self.discovered_nodes = []
        
        # Service clients for drone control
        self.service_clients = {}
        self._setup_service_clients()
        
        # Start discovery
        self._discovery_timer = self.create_timer(2.0, self._discover_ros2_network)
        
        # State subscribers
        self._setup_state_subscribers()
        
        # Create FastAPI app
        self.app = self._create_fastapi_app()
        
        # Background task for telemetry updates
        self._telemetry_task = None
        
        self.get_logger().info("ROS2-Web Bridge initialized")
    
    
    def _discover_ros2_network(self):
        """Discover available ROS2 services and topics"""
        try:
            # Discover services
            service_names_and_types = self.get_service_names_and_types()
            current_services = {name: types for name, types in service_names_and_types}
            
            # Check for new services
            for service_name, service_types in current_services.items():
                if service_name not in self.discovered_services:
                    self.discovered_services[service_name] = service_types
                    self.get_logger().info(f"Discovered service: {service_name} ({service_types})")
            
            # Discover topics
            topic_names_and_types = self.get_topic_names_and_types()
            current_topics = {name: types for name, types in topic_names_and_types}
            
            # Check for new topics
            for topic_name, topic_types in current_topics.items():
                if topic_name not in self.discovered_topics:
                    self.discovered_topics[topic_name] = topic_types
                    self.get_logger().info(f"Discovered topic: {topic_name} ({topic_types})")
            
            # Discover nodes
            node_names = self.get_node_names()
            if node_names != self.discovered_nodes:
                self.discovered_nodes = node_names
                self.get_logger().info(f"Discovered nodes: {node_names}")
                    
        except Exception as e:
            self.get_logger().warn(f"Discovery error: {e}")
    
    def _setup_service_clients(self):
        """Setup service clients for drone control (mirroring CLI behavior)"""
        drone_prefix = f"/{self.target_drone}"
        
        # Standard trigger services
        self.service_clients['arm'] = self.create_client(Trigger, f"{drone_prefix}/arm")
        self.service_clients['disarm'] = self.create_client(Trigger, f"{drone_prefix}/disarm")
        self.service_clients['takeoff'] = self.create_client(Trigger, f"{drone_prefix}/takeoff")
        self.service_clients['land'] = self.create_client(Trigger, f"{drone_prefix}/land")
        self.service_clients['set_offboard'] = self.create_client(Trigger, f"{drone_prefix}/set_offboard")
        self.service_clients['set_position_mode'] = self.create_client(Trigger, f"{drone_prefix}/set_position_mode")
        
        # DroneOS-specific services
        if SetPosition:
            self.service_clients['set_position'] = self.create_client(SetPosition, f"{drone_prefix}/set_position")
        if GetState:
            self.service_clients['get_state'] = self.create_client(GetState, f"{drone_prefix}/get_state")
            
        self.get_logger().info(f"Service clients created for {self.target_drone}")
    
    def _setup_state_subscribers(self):
        """Setup subscribers for drone state topics"""
        # This would subscribe to drone status topics if they exist
        # For now, we'll use service calls to get state
        pass
    
    def _recreate_service_clients_for_target(self, new_target: str):
        """Recreate service clients when target drone changes"""
        old_target = self.target_drone
        self.target_drone = new_target
        
        # Destroy old clients
        for client in self.service_clients.values():
            self.destroy_client(client)
        self.service_clients.clear()
        
        # Create new clients
        self._setup_service_clients()
        self.get_logger().info(f"Service clients recreated for target change: {old_target} -> {new_target}")
    
    async def _call_service_async(self, service_name: str, request=None) -> tuple[bool, str]:
        """Call a drone service asynchronously (mirroring CLI behavior)"""
        if service_name not in self.service_clients:
            return False, f"Service {service_name} not available"
        
        client = self.service_clients[service_name]
        
        # Wait for service
        if not client.wait_for_service(timeout_sec=2.0):
            return False, f"Service /{self.target_drone}/{service_name} not available. Is drone_core running?"
        
        try:
            # Create request if not provided
            if request is None:
                if service_name in ['arm', 'disarm', 'takeoff', 'land', 'set_offboard', 'set_position_mode']:
                    request = Trigger.Request()
                elif service_name == 'get_state' and GetState:
                    request = GetState.Request()
                else:
                    return False, f"Unknown request type for service {service_name}"
            
            # Call service
            future = client.call_async(request)
            
            # Wait for response in executor thread to avoid blocking
            loop = asyncio.get_event_loop()
            response = await loop.run_in_executor(
                None, 
                lambda: self._wait_for_future(future, timeout_sec=5.0)
            )
            
            if response is None:
                return False, f"Service call to {service_name} timed out"
            
            # Handle response based on service type
            if hasattr(response, 'success'):
                message = getattr(response, 'message', f"{service_name} completed")
                return response.success, message
            else:
                return True, f"{service_name} completed"
                
        except Exception as e:
            return False, f"Service call failed: {str(e)}"
    
    def _wait_for_future(self, future, timeout_sec=5.0):
        """Wait for future completion in a blocking way"""
        import time
        start_time = time.time()
        
        while not future.done():
            rclpy.spin_once(self, timeout_sec=0.1)
            if time.time() - start_time > timeout_sec:
                return None
        
        return future.result()
    
    async def call_arm(self) -> tuple[bool, str]:
        """Arm the drone (mirroring CLI behavior)"""
        return await self._call_service_async('arm')
    
    async def call_disarm(self) -> tuple[bool, str]:
        """Disarm the drone (mirroring CLI behavior)"""
        return await self._call_service_async('disarm')
    
    async def call_takeoff(self) -> tuple[bool, str]:
        """Takeoff the drone (mirroring CLI behavior)"""
        return await self._call_service_async('takeoff')
    
    async def call_land(self) -> tuple[bool, str]:
        """Land the drone (mirroring CLI behavior)"""
        return await self._call_service_async('land')
    
    async def call_set_offboard(self) -> tuple[bool, str]:
        """Set offboard mode (mirroring CLI behavior)"""
        return await self._call_service_async('set_offboard')
    
    async def call_set_position(self, x: float, y: float, z: float, yaw: float) -> tuple[bool, str]:
        """Set position (mirroring CLI 'pos' command)"""
        if not SetPosition:
            return False, "SetPosition service not available (drone_interfaces not imported)"
        
        request = SetPosition.Request()
        request.x = x
        request.y = y
        request.z = z
        request.yaw = yaw
        
        return await self._call_service_async('set_position', request)
    
    async def call_get_state(self) -> tuple[bool, str, Optional[Any]]:
        """Get drone state (mirroring CLI behavior)"""
        if not GetState:
            return False, "GetState service not available", None
        
        success, message = await self._call_service_async('get_state')
        
        # If successful, get the actual state data
        if success:
            client = self.service_clients['get_state']
            if client.wait_for_service(timeout_sec=1.0):
                try:
                    request = GetState.Request()
                    future = client.call_async(request)
                    
                    loop = asyncio.get_event_loop()
                    response = await loop.run_in_executor(
                        None, 
                        lambda: self._wait_for_future(future, timeout_sec=3.0)
                    )
                    
                    if response:
                        return True, "State retrieved", response
                except Exception as e:
                    return False, f"Failed to get state data: {e}", None
        
        return success, message, None
    
    def change_target(self, drone_name: str):
        """Change target drone (mirroring CLI 'target' command)"""
        if drone_name != self.target_drone:
            self._recreate_service_clients_for_target(drone_name)
    
    def get_ros2_network_info(self) -> Dict[str, Any]:
        """Get current ROS2 network discovery information"""
        return {
            "services": self.discovered_services,
            "topics": self.discovered_topics,
            "nodes": self.discovered_nodes,
            "target_drone": self.target_drone
        }
    
    
    
    def _create_fastapi_app(self) -> FastAPI:
        """Create FastAPI application with all routes"""
        
        app = FastAPI(
            title="DroneOS Command Center",
            description="ROS2-Web Bridge for drone control",
            version="1.0.0"
        )
        
        # Enable CORS for web frontend
        app.add_middleware(
            CORSMiddleware,
            allow_origins=["*"],
            allow_methods=["*"],
            allow_headers=["*"],
        )
        
        # Request models
        class DroneCommand(BaseModel):
            drone_name: str = "drone1"
        
        class PositionCommand(BaseModel):
            x: float
            y: float
            z: float
            yaw: float
            drone_name: str = "drone1"
            
        class AICommand(BaseModel):
            message: str
        
        # API Routes
        @app.get("/")
        async def root():
            return {
                "message": "DroneOS Command Center API",
                "status": "running",
                "current_drone": self.target_drone,
                "ros2_ok": rclpy.ok()
            }
        
        @app.get("/api/status")
        async def get_status():
            """Get current system and drone status"""
            return {
                "bridge_active": True,
                "ros2_ok": rclpy.ok(),
                "current_drone": self.target_drone,
                "websocket_clients": len(self.active_websockets),
                "latest_status": self.latest_status
            }
        
        # Drone Control Endpoints (mirroring CLI behavior)
        @app.post("/api/drone/arm")
        async def arm_drone(cmd: DroneCommand):
            """Arm the drone (mirrors CLI 'arm' command)"""
            if cmd.drone_name != self.target_drone:
                self.change_target(cmd.drone_name)
            
            success, message = await self.call_arm()
            
            if success:
                # Update status for WebSocket clients
                self.latest_status["armed"] = True
                await self._broadcast_status_update()
            
            return {"success": success, "message": message}
        
        @app.post("/api/drone/disarm")
        async def disarm_drone(cmd: DroneCommand):
            """Disarm the drone (mirrors CLI 'disarm' command)"""
            if cmd.drone_name != self.target_drone:
                self.change_target(cmd.drone_name)
            
            success, message = await self.call_disarm()
            
            if success:
                self.latest_status["armed"] = False
                await self._broadcast_status_update()
            
            return {"success": success, "message": message}
        
        @app.post("/api/drone/takeoff")
        async def takeoff_drone(cmd: DroneCommand):
            """Takeoff the drone (mirrors CLI 'takeoff' command)"""
            if cmd.drone_name != self.target_drone:
                self.change_target(cmd.drone_name)
            
            success, message = await self.call_takeoff()
            return {"success": success, "message": message}
        
        @app.post("/api/drone/land")
        async def land_drone(cmd: DroneCommand):
            """Land the drone (mirrors CLI 'land' command)"""
            if cmd.drone_name != self.target_drone:
                self.change_target(cmd.drone_name)
            
            success, message = await self.call_land()
            return {"success": success, "message": message}
        
        @app.post("/api/drone/set_offboard")
        async def set_offboard_mode(cmd: DroneCommand):
            """Set offboard mode (mirrors CLI 'set_offboard' command)"""
            if cmd.drone_name != self.target_drone:
                self.change_target(cmd.drone_name)
            
            success, message = await self.call_set_offboard()
            
            if success:
                self.latest_status["flight_mode"] = "OFFBOARD"
                await self._broadcast_status_update()
            
            return {"success": success, "message": message}
        
        @app.post("/api/drone/position")
        async def set_position(pos: PositionCommand):
            """Set position (mirrors CLI 'pos x y z yaw' command)"""
            if pos.drone_name != self.target_drone:
                self.change_target(pos.drone_name)
            
            success, message = await self.call_set_position(pos.x, pos.y, pos.z, pos.yaw)
            
            if success:
                self.latest_status["position"] = {
                    "x": pos.x, "y": pos.y, "z": pos.z, "yaw": pos.yaw
                }
                await self._broadcast_status_update()
            
            return {"success": success, "message": message}
        
        @app.get("/api/drone/state")
        async def get_drone_state(drone_name: str = None):
            """Get drone state (mirrors CLI behavior)"""
            if drone_name and drone_name != self.target_drone:
                self.change_target(drone_name)
            
            success, message, state_data = await self.call_get_state()
            
            response = {"success": success, "message": message}
            
            if success and state_data:
                # Convert state data to dict for JSON response
                response["state"] = {
                    "position": {
                        "x": state_data.local_x,
                        "y": state_data.local_y,
                        "z": state_data.local_z,
                        "yaw": state_data.local_yaw,
                        "valid": state_data.position_valid
                    },
                    "velocity": {
                        "x": state_data.velocity_x,
                        "y": state_data.velocity_y,
                        "z": state_data.velocity_z,
                        "valid": state_data.velocity_valid
                    },
                    "nav_state": state_data.nav_state,
                    "arming_state": state_data.arming_state,
                    "landing_state": state_data.landing_state,
                    "global_position": {
                        "latitude": state_data.latitude,
                        "longitude": state_data.longitude,
                        "altitude": state_data.altitude,
                        "valid": state_data.global_position_valid
                    }
                }
                
                # Update internal status
                self.latest_status.update({
                    "armed": state_data.arming_state == "ARMED",
                    "flight_mode": state_data.nav_state,
                    "position": {
                        "x": state_data.local_x,
                        "y": state_data.local_y,
                        "z": state_data.local_z,
                        "yaw": state_data.local_yaw
                    }
                })
            
            return response
        
        @app.post("/api/target_drone")
        async def set_target_drone(cmd: DroneCommand):
            """Set the target drone (mirrors CLI 'target' command)"""
            old_target = self.target_drone
            self.change_target(cmd.drone_name)
            
            return {
                "success": True, 
                "message": f"Target changed to {cmd.drone_name}",
                "old_target": old_target,
                "new_target": cmd.drone_name
            }
        
        # ROS2 Network Discovery Endpoints (for debugging/monitoring)
        @app.get("/api/ros2/network")
        async def get_ros2_network():
            """Get discovered ROS2 services, topics, and nodes"""
            return self.get_ros2_network_info()
        
        @app.get("/api/ros2/services")
        async def get_ros2_services():
            """Get all discovered ROS2 services"""
            return {"services": self.discovered_services}
        
        @app.get("/api/drone/services")
        async def get_drone_services():
            """Get available services for the current target drone"""
            drone_services = {}
            target_prefix = f"/{self.target_drone}/"
            
            for service_name, service_types in self.discovered_services.items():
                if service_name.startswith(target_prefix):
                    service_suffix = service_name[len(target_prefix):]
                    drone_services[service_suffix] = {
                        "full_name": service_name,
                        "types": service_types
                    }
            
            return {
                "target_drone": self.target_drone,
                "services": drone_services
            }
        
        # WebSocket endpoint for real-time updates
        @app.websocket("/ws")
        async def websocket_endpoint(websocket: WebSocket):
            await self._handle_websocket(websocket)
            
        return app
    
    async def _handle_websocket(self, websocket: WebSocket):
        """Handle WebSocket connection for real-time updates"""
        await websocket.accept()
        self.active_websockets.add(websocket)
        self.get_logger().info(f"WebSocket client connected. Total: {len(self.active_websockets)}")
        
        try:
            # Send initial status
            await websocket.send_text(json.dumps({
                "type": "initial_status",
                "data": self.latest_status
            }))
            
            # Keep connection alive and handle incoming messages
            while True:
                try:
                    # Wait for messages from client (heartbeat, etc.)
                    data = await asyncio.wait_for(websocket.receive_text(), timeout=1.0)
                    # Echo back or handle client messages if needed
                    
                except asyncio.TimeoutError:
                    # No message received - continue loop
                    pass
                    
        except WebSocketDisconnect:
            pass
        finally:
            self.active_websockets.discard(websocket)
            self.get_logger().info(f"WebSocket client disconnected. Total: {len(self.active_websockets)}")
    
    async def _broadcast_status_update(self):
        """Broadcast status update to all connected WebSocket clients"""
        await self._broadcast_to_websockets({
            "type": "status_update",
            "data": self.latest_status
        })
    
    async def _broadcast_to_websockets(self, message_data: dict):
        """Generic WebSocket broadcasting helper"""
        if not self.active_websockets:
            return
            
        message_data["timestamp"] = time.time()
        message = json.dumps(message_data)
        
        # Send to all connected clients
        disconnected = []
        for websocket in self.active_websockets:
            try:
                await websocket.send_text(message)
            except:
                disconnected.append(websocket)
        
        # Remove disconnected clients
        for websocket in disconnected:
            self.active_websockets.discard(websocket)
    
    def start_web_server(self, host="0.0.0.0", port=8000):
        """Start the web server in a separate thread"""
        def run_server():
            uvicorn.run(self.app, host=host, port=port, log_level="info")
        
        web_thread = threading.Thread(target=run_server, daemon=True)
        web_thread.start()
        self.get_logger().info(f"Web server started on http://{host}:{port}")
        return web_thread
    
    def start_telemetry_updates(self):
        """Start basic status updates - no real telemetry needed since we call services on demand"""
        async def status_loop():
            while rclpy.ok():
                # Just update timestamp and basic connectivity
                self.latest_status.update({
                    "timestamp": time.time(),
                    "connected": True
                })
                
                # Broadcast to web clients
                await self._broadcast_status_update()
                
                # Wait before next update
                await asyncio.sleep(5.0)  # Less frequent since no real data
        
        # Start the status task
        loop = asyncio.new_event_loop()
        def run_status():
            asyncio.set_event_loop(loop)
            loop.run_until_complete(status_loop())
            
        status_thread = threading.Thread(target=run_status, daemon=True)
        status_thread.start()
        self.get_logger().info("Basic status update task started")


def main():
    """Main entry point for ROS2-Web Bridge"""
    print("Starting DroneOS Command Center...")
    
    # Initialize ROS2
    rclpy.init()
    
    try:
        # Create the bridge (combines ROS2 node + web server)
        bridge = ROS2WebBridge(default_drone_name='drone1')
        
        # Start web server
        web_thread = bridge.start_web_server(host="0.0.0.0", port=8000)
        
        # Start telemetry updates
        bridge.start_telemetry_updates()
        
        print("DroneOS Command Center running at http://localhost:8000")
        print("WebSocket endpoint: ws://localhost:8000/ws")
        print("Press Ctrl+C to stop...")
        
        # Run ROS2 node (main thread)
        while rclpy.ok():
            rclpy.spin_once(bridge, timeout_sec=0.01)
            
    except KeyboardInterrupt:
        print("\nShutting down...")
    finally:
        # Cleanup
        if 'bridge' in locals():
            bridge.destroy_node()
        if rclpy.ok():
            rclpy.shutdown()
        print("Shutdown complete")


if __name__ == "__main__":
    main()