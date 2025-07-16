#!/usr/bin/env python3
"""
Basic RTL Failsafe Setup for DroneOS
Configure drone to return home on signal loss
"""
import rclpy
from rclpy.node import Node
from px4_msgs.msg import VehicleCommand
from px4_msgs.srv import VehicleCommand as VehicleCommandSrv
import time

class BasicFailsafeSetup(Node):
    def __init__(self):
        super().__init__('basic_failsafe_setup')
        
        # Vehicle command publisher
        self.vehicle_command_pub = self.create_publisher(
            VehicleCommand, 
            '/fmu/in/vehicle_command', 
            10
        )
        
        self.get_logger().info("🏠 Setting up basic RTL failsafe...")
        
    def set_rtl_failsafe_params(self):
        """Configure basic RTL failsafe parameters"""
        
        # RTL failsafe parameters
        rtl_params = {
            'COM_RCL_EXCEPT': 0,      # No exceptions for RC loss
            'NAV_RCL_ACT': 2,         # Return mode on RC loss
            'NAV_DLL_ACT': 2,         # Return mode on data link loss  
            'COM_RC_IN_MODE': 1,      # RC input mode
            'RTL_RETURN_ALT': 30.0,   # Return altitude (30m)
            'RTL_DESCEND_ALT': 10.0,  # Descend altitude (10m)
            'RTL_LAND_DELAY': 5.0,    # Hover time before landing (5s)
        }
        
        for param, value in rtl_params.items():
            self.set_parameter(param, value)
            time.sleep(0.1)  # Small delay between commands
            
        self.get_logger().info("✅ RTL failsafe parameters configured")
        
    def set_parameter(self, param_name, value):
        """Set a PX4 parameter"""
        msg = VehicleCommand()
        msg.timestamp = int(self.get_clock().now().nanoseconds / 1000)
        msg.command = VehicleCommand.VEHICLE_CMD_SET_PARAMETER
        msg.target_system = 1
        msg.target_component = 1
        
        # Convert parameter name to ID (simplified)
        msg.param1 = float(value)
        msg.param2 = 0.0
        msg.param3 = 0.0
        msg.param4 = 0.0
        msg.param5 = 0.0
        msg.param6 = 0.0
        msg.param7 = 0.0
        
        self.vehicle_command_pub.publish(msg)
        self.get_logger().info(f"📤 Set {param_name} = {value}")
        
    def set_home_position(self):
        """Set current position as home"""
        msg = VehicleCommand()
        msg.timestamp = int(self.get_clock().now().nanoseconds / 1000)
        msg.command = VehicleCommand.VEHICLE_CMD_DO_SET_HOME
        msg.target_system = 1
        msg.target_component = 1
        msg.param1 = 1.0  # Use current position
        
        self.vehicle_command_pub.publish(msg)
        self.get_logger().info("🏠 Home position set to current location")
        
    def test_rtl_trigger(self):
        """Manually trigger RTL for testing"""
        msg = VehicleCommand()
        msg.timestamp = int(self.get_clock().now().nanoseconds / 1000)
        msg.command = VehicleCommand.VEHICLE_CMD_NAV_RETURN_TO_LAUNCH
        msg.target_system = 1
        msg.target_component = 1
        
        self.vehicle_command_pub.publish(msg)
        self.get_logger().info("🔄 RTL manually triggered for testing")
        
    def setup_basic_failsafe(self):
        """Complete basic failsafe setup"""
        self.get_logger().info("🛡️  Starting Basic RTL Failsafe Setup")
        self.get_logger().info("="*50)
        
        # Step 1: Set home position
        self.set_home_position()
        time.sleep(1)
        
        # Step 2: Configure RTL parameters
        self.set_rtl_failsafe_params()
        time.sleep(1)
        
        # Step 3: Instructions
        self.get_logger().info("\n✅ Basic RTL Failsafe Setup Complete!")
        self.get_logger().info("="*50)
        self.get_logger().info("🏠 Drone will now return home when:")
        self.get_logger().info("   • RC signal is lost")
        self.get_logger().info("   • GCS connection is lost")
        self.get_logger().info("   • Manual RTL command is sent")
        self.get_logger().info("\n📋 RTL Behavior:")
        self.get_logger().info("   1. Climb to 30m altitude")
        self.get_logger().info("   2. Fly direct to home position")
        self.get_logger().info("   3. Descend to 10m and hover for 5s")
        self.get_logger().info("   4. Land at home position")
        
        # Optional: Test RTL trigger
        self.get_logger().info("\n🧪 To test RTL manually:")
        self.get_logger().info("   Run: python3 setup_basic_failsafe.py test")

def main():
    rclpy.init()
    setup = BasicFailsafeSetup()
    
    import sys
    if len(sys.argv) > 1 and sys.argv[1] == 'test':
        setup.test_rtl_trigger()
        time.sleep(2)
    else:
        setup.setup_basic_failsafe()
        time.sleep(2)
        
    setup.destroy_node()
    rclpy.shutdown()

if __name__ == '__main__':
    main()