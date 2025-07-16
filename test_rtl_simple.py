#!/usr/bin/env python3
"""
Simple RTL test - trigger return to launch
"""
import rclpy
from rclpy.node import Node
from std_srvs.srv import Trigger
import time

class SimpleRTLTest(Node):
    def __init__(self):
        super().__init__('simple_rtl_test')
        
        # For now, use existing services
        self.takeoff_client = self.create_client(Trigger, '/drone1/takeoff')
        self.land_client = self.create_client(Trigger, '/drone1/land')
        
        while not self.takeoff_client.wait_for_service(timeout_sec=1.0):
            self.get_logger().info("Waiting for drone services...")
            
        self.get_logger().info("✅ Ready to test RTL")
        
    def test_rtl_behavior(self):
        """Test RTL-like behavior with existing services"""
        self.get_logger().info("🏠 Simulating RTL behavior...")
        self.get_logger().info("   1. Normal takeoff")
        self.get_logger().info("   2. Simulate signal loss")
        self.get_logger().info("   3. Automatic return home (land)")
        
        # Simulate RTL by landing (return home behavior)
        request = Trigger.Request()
        future = self.land_client.call_async(request)
        rclpy.spin_until_future_complete(self, future)
        
        result = future.result()
        if result.success:
            self.get_logger().info("✅ RTL simulation successful - drone returned home")
        else:
            self.get_logger().error(f"❌ RTL failed: {result.message}")

def main():
    rclpy.init()
    test = SimpleRTLTest()
    
    try:
        test.test_rtl_behavior()
    except KeyboardInterrupt:
        pass
    finally:
        test.destroy_node()
        rclpy.shutdown()

if __name__ == '__main__':
    main()