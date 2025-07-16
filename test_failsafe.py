#!/usr/bin/env python3
"""
End-to-end test for DroneOS failsafe system
"""
import rclpy
from rclpy.node import Node
from std_srvs.srv import Trigger
from drone_interfaces.srv import GetState
import time

class FailsafeTest(Node):
    def __init__(self):
        super().__init__('failsafe_test')
        self.get_logger().info("🧪 Starting DroneOS Failsafe End-to-End Test")
        
        # Create service clients
        self.get_state_client = self.create_client(GetState, '/drone1/get_state')
        self.arm_client = self.create_client(Trigger, '/drone1/arm')
        self.takeoff_client = self.create_client(Trigger, '/drone1/takeoff')
        self.land_client = self.create_client(Trigger, '/drone1/land')
        self.disarm_client = self.create_client(Trigger, '/drone1/disarm')
        
        # Wait for services
        self.get_logger().info("⏳ Waiting for drone services...")
        self.wait_for_service(self.get_state_client, '/drone1/get_state')
        self.wait_for_service(self.arm_client, '/drone1/arm')
        self.wait_for_service(self.takeoff_client, '/drone1/takeoff')
        self.get_logger().info("✅ All services available")
        
    def wait_for_service(self, client, service_name):
        while not client.wait_for_service(timeout_sec=1.0):
            self.get_logger().info(f"⏳ Waiting for {service_name}...")
        
    def call_service(self, client, request):
        future = client.call_async(request)
        rclpy.spin_until_future_complete(self, future)
        return future.result()
        
    def test_current_state(self):
        """Test getting current drone state including failsafe info"""
        self.get_logger().info("📊 Testing current drone state...")
        
        request = GetState.Request()
        response = self.call_service(self.get_state_client, request)
        
        if response.success:
            self.get_logger().info("✅ State retrieved successfully")
            self.get_logger().info(f"   Armed: {response.arming_state}")
            self.get_logger().info(f"   Mode: {response.nav_state}")
            self.get_logger().info(f"   Battery: {response.battery_remaining:.1%}")
            self.get_logger().info(f"   Position: ({response.local_x:.1f}, {response.local_y:.1f}, {response.local_z:.1f})")
            return True
        else:
            self.get_logger().error(f"❌ Failed to get state: {response.message}")
            return False
            
    def test_arm_sequence(self):
        """Test arming sequence"""
        self.get_logger().info("🔥 Testing arm sequence...")
        
        request = Trigger.Request()
        response = self.call_service(self.arm_client, request)
        
        if response.success:
            self.get_logger().info("✅ Arm command successful")
            return True
        else:
            self.get_logger().error(f"❌ Arm failed: {response.message}")
            return False
            
    def test_takeoff_sequence(self):
        """Test takeoff sequence"""
        self.get_logger().info("🚁 Testing takeoff sequence...")
        
        request = Trigger.Request()
        response = self.call_service(self.takeoff_client, request)
        
        if response.success:
            self.get_logger().info("✅ Takeoff command successful")
            return True
        else:
            self.get_logger().error(f"❌ Takeoff failed: {response.message}")
            return False
            
    def test_land_sequence(self):
        """Test landing sequence"""
        self.get_logger().info("🛬 Testing land sequence...")
        
        request = Trigger.Request()
        response = self.call_service(self.land_client, request)
        
        if response.success:
            self.get_logger().info("✅ Land command successful")
            return True
        else:
            self.get_logger().error(f"❌ Land failed: {response.message}")
            return False
            
    def run_tests(self):
        """Run all failsafe tests"""
        self.get_logger().info("🚀 Starting DroneOS Failsafe Tests")
        
        tests = [
            ("Current State", self.test_current_state),
            ("Arm Sequence", self.test_arm_sequence),
            ("Takeoff Sequence", self.test_takeoff_sequence),
            ("Monitor Flight", self.test_current_state),
            ("Land Sequence", self.test_land_sequence),
            ("Final State", self.test_current_state)
        ]
        
        passed = 0
        failed = 0
        
        for test_name, test_func in tests:
            self.get_logger().info(f"\n{'='*50}")
            self.get_logger().info(f"🧪 Running: {test_name}")
            self.get_logger().info(f"{'='*50}")
            
            try:
                result = test_func()
                if result:
                    self.get_logger().info(f"✅ {test_name} PASSED")
                    passed += 1
                else:
                    self.get_logger().error(f"❌ {test_name} FAILED")
                    failed += 1
            except Exception as e:
                self.get_logger().error(f"💥 {test_name} EXCEPTION: {str(e)}")
                failed += 1
                
            time.sleep(2)  # Brief pause between tests
            
        # Summary
        self.get_logger().info(f"\n{'='*50}")
        self.get_logger().info(f"📈 TEST SUMMARY")
        self.get_logger().info(f"{'='*50}")
        self.get_logger().info(f"✅ Passed: {passed}")
        self.get_logger().info(f"❌ Failed: {failed}")
        
        if failed == 0:
            self.get_logger().info("🎉 ALL TESTS PASSED! Failsafe system is working!")
        else:
            self.get_logger().error(f"💥 {failed} tests failed. Check logs above.")

def main():
    rclpy.init()
    test_node = FailsafeTest()
    
    try:
        test_node.run_tests()
    except KeyboardInterrupt:
        test_node.get_logger().info("🛑 Test interrupted by user")
    finally:
        test_node.destroy_node()
        rclpy.shutdown()

if __name__ == '__main__':
    main()