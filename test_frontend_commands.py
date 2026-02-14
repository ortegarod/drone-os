#!/usr/bin/env python3
"""
Frontend Command Test Suite
Tests all drone commands end-to-end via drone_control.py
"""

import time
import drone_control as dc

def test_header(msg):
    print(f"\n{'='*60}")
    print(f"  {msg}")
    print(f"{'='*60}")

def test_command(name, func, *args):
    print(f"\n[TEST] {name}")
    print(f"  Args: {args if args else 'none'}")
    try:
        result = func(*args) if args else func()
        success = result.get('success', False)
        message = result.get('message', 'no message')
        print(f"  {'✅ PASS' if success else '❌ FAIL'}: {message}")
        if not success:
            print(f"  Full response: {result}")
        return success
    except Exception as e:
        print(f"  ❌ ERROR: {e}")
        return False

def get_status_summary(drone_name):
    dc.set_drone_name(drone_name)
    state = dc.get_state()
    if state.get('success'):
        return (
            f"{drone_name}: {state['arming_state']}, "
            f"{state['nav_state']}, "
            f"alt={-state['local_z']:.1f}m, "
            f"bat={state['battery_remaining']*100:.0f}%"
        )
    return f"{drone_name}: STATE ERROR"

def main():
    test_header("DroneOS Frontend Command Test Suite")
    
    # Test both drones
    for drone_name in ['drone1', 'drone2']:
        test_header(f"Testing {drone_name.upper()}")
        dc.set_drone_name(drone_name)
        
        # Initial state
        print(f"\n[INITIAL STATE]")
        print(f"  {get_status_summary(drone_name)}")
        
        # Test 1: Get state
        test_command("get_state()", dc.get_state)
        
        # Test 2: Set offboard mode
        test_command("set_offboard()", dc.set_offboard)
        time.sleep(1)
        
        # Test 3: Arm
        test_command("arm()", dc.arm)
        time.sleep(1)
        
        # Test 4: Set position (small move)
        test_command(
            "set_position(5, 0, -10, 0)",
            dc.set_position, 5, 0, -10, 0
        )
        time.sleep(2)
        
        # Test 5: Check state after commands
        print(f"\n[STATE AFTER COMMANDS]")
        print(f"  {get_status_summary(drone_name)}")
        
        # Test 6: Land
        test_command("land()", dc.land)
        time.sleep(2)
        
        # Test 7: Disarm
        test_command("disarm()", dc.disarm)
        time.sleep(1)
        
        # Final state
        print(f"\n[FINAL STATE]")
        print(f"  {get_status_summary(drone_name)}")
    
    # Summary
    test_header("Test Complete")
    print(f"\ndrone1: {get_status_summary('drone1')}")
    print(f"drone2: {get_status_summary('drone2')}")

if __name__ == "__main__":
    main()
