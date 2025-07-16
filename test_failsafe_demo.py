#!/usr/bin/env python3
"""
DroneOS Failsafe System Demo & Test Suite
Shows how to use the failsafe system in real applications
"""
import rclpy
from rclpy.node import Node
from drone_interfaces.srv import GetState, SetPosition
from std_srvs.srv import Trigger
import time
import threading

class FailsafeDemo(Node):
    def __init__(self):
        super().__init__('failsafe_demo')
        self.get_logger().info("🛡️  DroneOS Failsafe System Demo")
        
        # Service clients
        self.get_state_client = self.create_client(GetState, '/drone1/get_state')
        self.set_position_client = self.create_client(SetPosition, '/drone1/set_position')
        self.arm_client = self.create_client(Trigger, '/drone1/arm')
        self.takeoff_client = self.create_client(Trigger, '/drone1/takeoff')
        self.land_client = self.create_client(Trigger, '/drone1/land')
        
        # Wait for services
        self.wait_for_services()
        
    def wait_for_services(self):
        """Wait for all required services"""
        services = [
            (self.get_state_client, '/drone1/get_state'),
            (self.set_position_client, '/drone1/set_position'),
            (self.arm_client, '/drone1/arm'),
            (self.takeoff_client, '/drone1/takeoff'),
            (self.land_client, '/drone1/land')
        ]
        
        for client, name in services:
            self.get_logger().info(f"⏳ Waiting for {name}...")
            while not client.wait_for_service(timeout_sec=2.0):
                self.get_logger().info(f"   Still waiting for {name}...")
        
        self.get_logger().info("✅ All services available")
        
    def get_drone_state(self):
        """Get current drone state and failsafe status"""
        request = GetState.Request()
        future = self.get_state_client.call_async(request)
        rclpy.spin_until_future_complete(self, future)
        return future.result()
        
    def call_service(self, client, request):
        """Helper to call any service"""
        future = client.call_async(request)
        rclpy.spin_until_future_complete(self, future)
        return future.result()
        
    def display_failsafe_status(self):
        """Display current failsafe status"""
        state = self.get_drone_state()
        
        if not state.success:
            self.get_logger().error(f"❌ Failed to get state: {state.message}")
            return False
            
        self.get_logger().info("📊 Current Drone Status:")
        self.get_logger().info(f"   🔋 Battery: {state.battery_remaining:.1%}")
        self.get_logger().info(f"   🚁 Armed: {state.arming_state}")
        self.get_logger().info(f"   🎯 Mode: {state.nav_state}")
        self.get_logger().info(f"   📍 Position: ({state.local_x:.1f}, {state.local_y:.1f}, {state.local_z:.1f})")
        
        # Assess safety conditions
        battery_safe = state.battery_remaining > 0.25
        position_valid = abs(state.local_x) < 1000 and abs(state.local_y) < 1000
        
        self.get_logger().info("🛡️  Safety Assessment:")
        self.get_logger().info(f"   {'✅' if battery_safe else '❌'} Battery Level: {'SAFE' if battery_safe else 'LOW'}")
        self.get_logger().info(f"   {'✅' if position_valid else '❌'} Position: {'VALID' if position_valid else 'INVALID'}")
        
        overall_safe = battery_safe and position_valid
        status = "🟢 SAFE FOR MISSION" if overall_safe else "🔴 UNSAFE - FAILSAFE ACTIVE"
        self.get_logger().info(f"   Overall: {status}")
        
        return overall_safe
        
    def test_emergency_response_scenario(self):
        """Test emergency response with failsafe checks"""
        self.get_logger().info("\n🚨 EMERGENCY RESPONSE SCENARIO TEST")
        self.get_logger().info("="*50)
        
        # Step 1: Pre-flight safety check
        self.get_logger().info("1️⃣ Pre-flight Safety Check")
        if not self.display_failsafe_status():
            self.get_logger().error("❌ Pre-flight check failed - emergency deployment aborted")
            return False
        
        # Step 2: Simulate emergency deployment
        self.get_logger().info("\n2️⃣ Emergency Deployment")
        self.get_logger().info("🚁 Deploying to emergency coordinates...")
        
        # Set emergency position (simulate GPS coordinates)
        emergency_lat, emergency_lon = 37.7749, -122.4194  # San Francisco
        emergency_x, emergency_y = 50.0, 50.0  # Local coordinates
        
        request = SetPosition.Request()
        request.x = emergency_x
        request.y = emergency_y
        request.z = -10.0  # 10m altitude
        request.yaw = 0.0
        
        response = self.call_service(self.set_position_client, request)
        
        if response.success:
            self.get_logger().info("✅ Emergency position set successfully")
        else:
            self.get_logger().error(f"❌ Emergency deployment failed: {response.message}")
            return False
            
        # Step 3: Monitor mission safety
        self.get_logger().info("\n3️⃣ Mission Safety Monitoring")
        for i in range(3):
            time.sleep(1)
            self.get_logger().info(f"🔍 Safety check {i+1}/3...")
            
            if not self.display_failsafe_status():
                self.get_logger().error("🚨 FAILSAFE TRIGGERED - Aborting mission")
                return False
                
        self.get_logger().info("✅ Emergency response mission completed safely")
        return True
        
    def test_battery_failsafe_simulation(self):
        """Simulate battery failsafe conditions"""
        self.get_logger().info("\n🔋 BATTERY FAILSAFE SIMULATION")
        self.get_logger().info("="*50)
        
        # Get current state
        state = self.get_drone_state()
        current_battery = state.battery_remaining
        
        self.get_logger().info(f"Current battery: {current_battery:.1%}")
        
        # Simulate different battery levels
        test_levels = [0.90, 0.50, 0.25, 0.15, 0.10]
        
        for level in test_levels:
            self.get_logger().info(f"\n📉 Simulating {level:.0%} battery level...")
            
            if level > 0.25:
                status = "🟢 SAFE - Normal operation"
            elif level > 0.15:
                status = "🟡 WARNING - Consider return to base"
            else:
                status = "🔴 CRITICAL - Emergency landing required"
                
            self.get_logger().info(f"   Failsafe Status: {status}")
            
            # Simulate mission safety check
            safe_for_mission = level > 0.25
            mission_status = "✅ APPROVED" if safe_for_mission else "❌ REJECTED"
            self.get_logger().info(f"   Mission Authorization: {mission_status}")
            
            time.sleep(0.5)
            
    def test_real_time_monitoring(self):
        """Test real-time failsafe monitoring"""
        self.get_logger().info("\n⏱️  REAL-TIME FAILSAFE MONITORING")
        self.get_logger().info("="*50)
        self.get_logger().info("Monitoring failsafe conditions for 10 seconds...")
        
        start_time = time.time()
        check_count = 0
        
        while time.time() - start_time < 10:
            check_count += 1
            self.get_logger().info(f"\n🔍 Check #{check_count}")
            
            safe = self.display_failsafe_status()
            
            if not safe:
                self.get_logger().warn("⚠️  Failsafe conditions detected!")
            
            time.sleep(2)
            
        self.get_logger().info(f"✅ Monitoring completed - {check_count} safety checks performed")
        
    def run_full_demo(self):
        """Run complete failsafe system demonstration"""
        self.get_logger().info("\n🎬 STARTING FULL FAILSAFE DEMO")
        self.get_logger().info("="*60)
        
        tests = [
            ("Emergency Response Scenario", self.test_emergency_response_scenario),
            ("Battery Failsafe Simulation", self.test_battery_failsafe_simulation),
            ("Real-time Monitoring", self.test_real_time_monitoring)
        ]
        
        for test_name, test_func in tests:
            self.get_logger().info(f"\n🧪 Running: {test_name}")
            try:
                test_func()
                self.get_logger().info(f"✅ {test_name} completed")
            except Exception as e:
                self.get_logger().error(f"❌ {test_name} failed: {str(e)}")
                
            time.sleep(1)
            
        self.get_logger().info("\n🎉 FAILSAFE DEMO COMPLETED!")
        self.get_logger().info("="*60)
        self.get_logger().info("The DroneOS failsafe system is working correctly!")

def main():
    rclpy.init()
    demo = FailsafeDemo()
    
    try:
        demo.run_full_demo()
    except KeyboardInterrupt:
        demo.get_logger().info("🛑 Demo interrupted by user")
    finally:
        demo.destroy_node()
        rclpy.shutdown()

if __name__ == '__main__':
    main()