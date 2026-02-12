#!/usr/bin/env python3
"""Dual-drone coordinated flight demo."""
import drone_control
import time
import sys

def fly(name, cmd, *args):
    drone_control.set_drone_name(name)
    fn = getattr(drone_control, cmd)
    r = fn(*args) if args else fn()
    print(f"  {name}.{cmd}({', '.join(str(a) for a in args)}): {r.get('message','ok') if isinstance(r,dict) else r}")
    sys.stdout.flush()
    return r

def state(name):
    drone_control.set_drone_name(name)
    s = drone_control.get_state()
    print(f"  {name}: alt={-s['local_z']:.1f}m armed={s['arming_state']} mode={s['nav_state']}")
    sys.stdout.flush()
    return s

print("=== DUAL DRONE DEMO ===")
print()

# Phase 1: Launch both
print("[1] Launching drone1...")
fly('drone1', 'set_offboard')
time.sleep(2)
fly('drone1', 'arm')
time.sleep(2)
fly('drone1', 'set_position', 0, 0, -10, 0)

print("[2] Launching drone2...")
fly('drone2', 'set_offboard')
time.sleep(2)
fly('drone2', 'arm')
time.sleep(2)
fly('drone2', 'set_position', 0, 2, -10, 0)

print("[3] Waiting for climb...")
time.sleep(8)
state('drone1')
state('drone2')

# Phase 2: Fly apart
print("[4] Flying apart...")
fly('drone1', 'set_position', 10, 0, -10, 0)
fly('drone2', 'set_position', -10, 2, -10, 0)
time.sleep(8)
state('drone1')
state('drone2')

# Phase 3: Cross paths
print("[5] Crossing paths...")
fly('drone1', 'set_position', -10, -2, -12, 0)
fly('drone2', 'set_position', 10, 4, -8, 0)
time.sleep(8)
state('drone1')
state('drone2')

# Phase 4: Return and land
print("[6] Returning home...")
fly('drone1', 'set_position', 0, 0, -10, 0)
fly('drone2', 'set_position', 0, 2, -10, 0)
time.sleep(6)

print("[7] Landing...")
fly('drone1', 'land')
fly('drone2', 'land')
time.sleep(8)
state('drone1')
state('drone2')

print()
print("=== DEMO COMPLETE ===")
