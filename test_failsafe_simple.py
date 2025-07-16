#!/usr/bin/env python3
"""
Simple test to check failsafe monitoring
"""
import rclpy
from rclpy.node import Node
from drone_interfaces.srv import GetState
import time

class SimpleFailsafeTest(Node):
    def __init__(self):
        super().__init__('simple_failsafe_test')
        
        # Create service client
        self.get_state_client = self.create_client(GetState, '/drone1/get_state')
        
        # Wait for service
        while not self.get_state_client.wait_for_service(timeout_sec=1.0):
            self.get_logger().info("⏳ Waiting for /drone1/get_state...")
        
        self.get_logger().info("✅ Service available")
        
    def test_failsafe_monitoring(self):
        """Test failsafe monitoring over time"""
        self.get_logger().info("🛡️  Testing Failsafe Monitoring")
        
        for i in range(5):
            self.get_logger().info(f"\n--- Test {i+1}/5 ---")
            
            request = GetState.Request()
            future = self.get_state_client.call_async(request)
            rclpy.spin_until_future_complete(self, future)
            response = future.result()
            
            if response.success:
                self.get_logger().info(f"✅ State: {response.arming_state}")
                self.get_logger().info(f"   Battery: {response.battery_remaining:.1%}")
                self.get_logger().info(f"   Mode: {response.nav_state}")
                
                # Check for failsafe conditions
                if response.battery_remaining < 0.25:
                    self.get_logger().warn("⚠️  LOW BATTERY WARNING")
                if response.battery_remaining < 0.15:
                    self.get_logger().error("🚨 CRITICAL BATTERY - EMERGENCY LANDING REQUIRED")
                    
            else:
                self.get_logger().error(f"❌ Failed: {response.message}")
                
            time.sleep(2)

def main():
    rclpy.init()
    test_node = SimpleFailsafeTest()
    
    try:
        test_node.test_failsafe_monitoring()
        test_node.get_logger().info("🎉 Failsafe monitoring test completed!")
    except KeyboardInterrupt:
        test_node.get_logger().info("🛑 Test interrupted")
    finally:
        test_node.destroy_node()
        rclpy.shutdown()

if __name__ == '__main__':
    main()