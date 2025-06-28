#!/usr/bin/env python3

"""
Test script for rosbridge drone telemetry integration.

This script tests the complete pipeline:
1. Launches rosbridge server
2. Starts drone state publisher 
3. Simulates telemetry data
4. Tests WebSocket connectivity
5. Verifies real-time data flow

Usage:
    python3 test_rosbridge_integration.py [--drone-namespace px4_1] [--port 9090]
"""

import asyncio
import json
import time
import threading
import subprocess
import signal
import sys
import argparse
from typing import Dict, Any, Optional
import websockets
import rclpy
from rclpy.node import Node
from rclpy.executors import MultiThreadedExecutor
from drone_interfaces.msg import DroneState
from std_msgs.msg import Header


class DroneStateMockPublisher(Node):
    """Mock publisher for testing drone state telemetry."""
    
    def __init__(self, namespace: str = "px4_1"):
        super().__init__('drone_state_mock_publisher')
        self.namespace = namespace
        
        # Create publisher
        self.state_publisher = self.create_publisher(
            DroneState,
            f'/{namespace}/drone_state',
            10
        )
        
        # Create timer for periodic publishing
        self.timer = self.create_wall_timer(0.1, self.publish_mock_state)  # 10Hz
        
        # Mock state variables
        self.flight_time = 0.0
        self.battery_level = 1.0
        self.altitude = 0.0
        self.position_x = 0.0
        self.position_y = 0.0
        self.gps_satellites = 12
        self.nav_state = "OFFBOARD"
        self.arming_state = "ARMED"
        
        self.get_logger().info(f"Mock publisher started for {namespace}")
    
    def publish_mock_state(self):
        """Publish mock drone state with realistic data patterns."""
        msg = DroneState()
        
        # Header
        msg.header = Header()
        msg.header.stamp = self.get_clock().now().to_msg()
        msg.header.frame_id = "base_link"
        msg.drone_name = self.namespace
        
        # Simulate flight patterns
        self.flight_time += 0.1
        
        # Simulate circular flight pattern
        radius = 50.0
        angular_velocity = 0.1  # rad/s
        angle = angular_velocity * self.flight_time
        
        msg.local_x = radius * float(cos(angle))
        msg.local_y = radius * float(sin(angle))
        msg.local_z = -30.0 + 5.0 * float(sin(self.flight_time * 0.05))  # NED frame, negative is up
        msg.local_yaw = angle
        msg.position_valid = True
        
        # Simulate velocity
        msg.velocity_x = -radius * angular_velocity * float(sin(angle))
        msg.velocity_y = radius * angular_velocity * float(cos(angle))
        msg.velocity_z = 5.0 * 0.05 * float(cos(self.flight_time * 0.05))
        msg.velocity_valid = True
        
        # State information
        msg.nav_state = self.nav_state
        msg.arming_state = self.arming_state
        msg.landing_state = "AIRBORNE"
        
        # GPS (mock coordinates around San Francisco)
        msg.latitude = 37.7749 + 0.001 * float(cos(angle))
        msg.longitude = -122.4194 + 0.001 * float(sin(angle))
        msg.altitude = 100.0 - msg.local_z  # Convert NED to AMSL
        msg.global_position_valid = True
        
        # Battery simulation (slow discharge)
        self.battery_level -= 0.00001  # Loses 1% per 1000 cycles (100 seconds)
        msg.battery_voltage = 24.0 + 2.0 * self.battery_level
        msg.battery_current = 15.0 + 5.0 * float(sin(self.flight_time * 0.2))
        msg.battery_remaining = max(0.0, self.battery_level)
        msg.battery_time_remaining = max(0.0, self.battery_level * 1800)  # 30 min at full
        msg.battery_temperature = 25.0 + 10.0 * (1.0 - self.battery_level)
        
        if msg.battery_remaining < 0.15:
            msg.battery_warning = "CRITICAL"
        elif msg.battery_remaining < 0.25:
            msg.battery_warning = "LOW"
        else:
            msg.battery_warning = "NONE"
        msg.battery_valid = True
        
        # GPS details
        msg.gps_fix_type = "3D" if self.gps_satellites >= 4 else "2D"
        msg.gps_satellites_used = self.gps_satellites
        msg.gps_hdop = 1.0 + 2.0 * float(sin(self.flight_time * 0.3))
        msg.gps_vdop = 1.5 + 1.0 * float(cos(self.flight_time * 0.2))
        msg.gps_accuracy_horizontal = msg.gps_hdop * 2.0
        msg.gps_accuracy_vertical = msg.gps_vdop * 3.0
        msg.gps_jamming_detected = False
        msg.gps_spoofing_detected = False
        
        # System health
        health_base = 90.0
        health_penalty = (1.0 - msg.battery_remaining) * 30.0  # Lower health with battery
        msg.system_health_score = max(0.0, health_base - health_penalty)
        
        # Warnings based on state
        msg.active_warnings = []
        msg.critical_failures = []
        
        if msg.battery_remaining < 0.25:
            msg.active_warnings.append(f"Low battery: {int(msg.battery_remaining * 100)}%")
        if msg.battery_remaining < 0.15:
            msg.critical_failures.append("Critical battery level")
        if self.gps_satellites < 6:
            msg.active_warnings.append(f"Low satellite count: {self.gps_satellites}")
        
        msg.can_arm = msg.battery_remaining > 0.1 and self.gps_satellites >= 4
        msg.manual_control_lost = False
        msg.gcs_connection_lost = False
        msg.geofence_breached = False
        
        # Communication status
        msg.rc_signal_strength = 85.0 + 10.0 * float(sin(self.flight_time * 0.1))
        msg.rc_signal_valid = msg.rc_signal_strength > 50.0
        msg.telemetry_link_quality = 90.0 + 8.0 * float(cos(self.flight_time * 0.15))
        msg.packet_loss_rate = max(0.0, 0.05 - 0.04 * (msg.telemetry_link_quality / 100.0))
        
        # Flight performance
        msg.wind_speed = 5.0 + 3.0 * float(sin(self.flight_time * 0.05))
        msg.wind_direction = 180.0 + 45.0 * float(sin(self.flight_time * 0.02))
        msg.altitude_rate = msg.velocity_z
        
        # Safety status
        msg.geofence_status = "INSIDE"
        msg.flight_time_elapsed = int(self.flight_time)
        msg.flight_time_limit = 1800
        
        # Publish the message
        self.state_publisher.publish(msg)


class RosbridgeTestClient:
    """WebSocket client for testing rosbridge connectivity and data flow."""
    
    def __init__(self, uri: str = "ws://localhost:9090"):
        self.uri = uri
        self.websocket = None
        self.message_count = 0
        self.last_message_time = None
        self.data_received = False
        
    async def connect_and_test(self, drone_namespace: str = "px4_1", test_duration: int = 10):
        """Connect to rosbridge and test telemetry data flow."""
        print(f"Connecting to rosbridge at {self.uri}")
        
        try:
            async with websockets.connect(self.uri) as websocket:
                self.websocket = websocket
                print("✓ Connected to rosbridge WebSocket server")
                
                # Subscribe to drone state topic
                subscribe_msg = {
                    "op": "subscribe",
                    "topic": f"/{drone_namespace}/drone_state",
                    "type": "drone_interfaces/DroneState",
                    "throttle_rate": 500,  # 2Hz for testing
                    "queue_length": 1
                }
                
                await websocket.send(json.dumps(subscribe_msg))
                print(f"✓ Subscribed to /{drone_namespace}/drone_state")
                
                # Test service call
                service_msg = {
                    "op": "call_service",
                    "service": "/rosapi/get_topics",
                    "type": "rosapi/GetTopics",
                    "id": "test_service_call"
                }
                
                await websocket.send(json.dumps(service_msg))
                print("✓ Called rosapi service")
                
                # Listen for messages
                start_time = time.time()
                while time.time() - start_time < test_duration:
                    try:
                        message = await asyncio.wait_for(websocket.recv(), timeout=1.0)
                        await self.handle_message(message)
                    except asyncio.TimeoutError:
                        continue
                    except websockets.exceptions.ConnectionClosed:
                        print("✗ Connection closed unexpectedly")
                        break
                
                # Test results
                print(f"\n📊 Test Results:")
                print(f"  Messages received: {self.message_count}")
                print(f"  Data flowing: {'✓' if self.data_received else '✗'}")
                if self.last_message_time:
                    print(f"  Last message: {time.time() - self.last_message_time:.1f}s ago")
                
                return self.data_received and self.message_count > 0
                
        except Exception as e:
            print(f"✗ Connection failed: {e}")
            return False
    
    async def handle_message(self, message: str):
        """Handle incoming WebSocket messages."""
        try:
            data = json.loads(message)
            self.message_count += 1
            self.last_message_time = time.time()
            
            if data.get("op") == "publish" and "drone_state" in data.get("topic", ""):
                self.data_received = True
                msg_data = data.get("msg", {})
                print(f"📡 Drone State - Battery: {msg_data.get('battery_remaining', 0)*100:.1f}%, "
                      f"Alt: {abs(msg_data.get('local_z', 0)):.1f}m, "
                      f"GPS: {msg_data.get('gps_satellites_used', 0)} sats")
                      
            elif data.get("op") == "service_response":
                print(f"🔧 Service Response: {data.get('service', 'unknown')}")
                
            elif data.get("op") == "status":
                print(f"ℹ️  Status: {data.get('msg', '')}")
                
        except json.JSONDecodeError:
            print(f"✗ Failed to parse message: {message[:100]}...")


def cos(x): return __import__('math').cos(x)
def sin(x): return __import__('math').sin(x)


async def main():
    """Main test function."""
    parser = argparse.ArgumentParser(description='Test rosbridge drone telemetry integration')
    parser.add_argument('--drone-namespace', default='px4_1', help='Drone namespace')
    parser.add_argument('--port', type=int, default=9090, help='Rosbridge port')
    parser.add_argument('--test-duration', type=int, default=30, help='Test duration in seconds')
    parser.add_argument('--skip-mock-publisher', action='store_true', help='Skip mock publisher')
    args = parser.parse_args()
    
    print("🚁 Drone Telemetry Integration Test")
    print("=" * 50)
    
    # Initialize ROS2
    rclpy.init()
    
    # Start mock publisher if not skipped
    mock_publisher = None
    executor = None
    executor_thread = None
    
    if not args.skip_mock_publisher:
        print("🔧 Starting mock drone state publisher...")
        mock_publisher = DroneStateMockPublisher(args.drone_namespace)
        executor = MultiThreadedExecutor()
        executor.add_node(mock_publisher)
        
        executor_thread = threading.Thread(target=executor.spin)
        executor_thread.daemon = True
        executor_thread.start()
        print("✓ Mock publisher started")
    
    try:
        # Wait a moment for publisher to start
        if not args.skip_mock_publisher:
            await asyncio.sleep(2)
        
        # Test rosbridge connection
        print(f"\n🌐 Testing rosbridge connection...")
        client = RosbridgeTestClient(f"ws://localhost:{args.port}")
        success = await client.connect_and_test(args.drone_namespace, args.test_duration)
        
        if success:
            print("\n✅ Integration test PASSED!")
            print("\nNext steps:")
            print("1. Start your web interface")
            print("2. Import the RealTimeStatusBar component")
            print("3. Connect to rosbridge WebSocket at ws://localhost:9090")
            print("4. Subscribe to drone telemetry topics")
        else:
            print("\n❌ Integration test FAILED!")
            print("\nTroubleshooting:")
            print("1. Ensure rosbridge server is running: ros2 launch rosbridge_launch.py")
            print("2. Check if the drone state publisher is active")
            print("3. Verify WebSocket port is accessible")
            
    except KeyboardInterrupt:
        print("\n🛑 Test interrupted by user")
    finally:
        # Cleanup
        if mock_publisher:
            mock_publisher.destroy_node()
        if executor:
            executor.shutdown()
        rclpy.shutdown()


if __name__ == "__main__":
    asyncio.run(main())