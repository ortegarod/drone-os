#!/usr/bin/env python3
"""Dual-drone flight using direct roslibpy calls (no set_drone_name switching)."""
import roslibpy
import time
import sys

ros = roslibpy.Ros(host='<tailscale-ip>', port=9090)
ros.run(timeout=10)
print("Connected to rosbridge")
sys.stdout.flush()

def call_trigger(drone, service):
    svc = roslibpy.Service(ros, f'/{drone}/{service}', 'std_srvs/srv/Trigger')
    r = svc.call(roslibpy.ServiceRequest(), timeout=15)
    print(f"  {drone}/{service}: {r.get('message','ok')}")
    sys.stdout.flush()
    return r

def set_pos(drone, x, y, z, yaw):
    svc = roslibpy.Service(ros, f'/{drone}/set_position', 'drone_interfaces/srv/SetPosition')
    r = svc.call(roslibpy.ServiceRequest({'x': x, 'y': y, 'z': z, 'yaw': yaw}), timeout=15)
    print(f"  {drone}/set_position({x},{y},{z}): {r.get('message','ok')}")
    sys.stdout.flush()
    return r

def get_state(drone):
    svc = roslibpy.Service(ros, f'/{drone}/get_state', 'drone_interfaces/srv/GetState')
    r = svc.call(roslibpy.ServiceRequest(), timeout=15)
    print(f"  {drone}: alt={-r.get('local_z',0):.1f}m armed={r.get('arming_state')} nav={r.get('nav_state')}")
    sys.stdout.flush()
    return r

print("\n=== DUAL DRONE DEMO ===\n")

print("[1] Launch drone1")
call_trigger('drone1', 'set_offboard')
time.sleep(2)
call_trigger('drone1', 'arm')
time.sleep(2)
set_pos('drone1', 0, 0, -10, 0)

print("[2] Launch drone2")
call_trigger('drone2', 'set_offboard')
time.sleep(2)
call_trigger('drone2', 'arm')
time.sleep(2)
set_pos('drone2', 0, 2, -10, 0)

print("[3] Climbing...")
time.sleep(8)
get_state('drone1')
get_state('drone2')

print("[4] Fly apart")
set_pos('drone1', 10, 0, -10, 0)
set_pos('drone2', -10, 2, -10, 0)
time.sleep(8)
get_state('drone1')
get_state('drone2')

print("[5] Cross paths")
set_pos('drone1', -10, -2, -12, 0)
set_pos('drone2', 10, 4, -8, 0)
time.sleep(8)
get_state('drone1')
get_state('drone2')

print("[6] Return home")
set_pos('drone1', 0, 0, -10, 0)
set_pos('drone2', 0, 2, -10, 0)
time.sleep(6)

print("[7] Land")
call_trigger('drone1', 'land')
call_trigger('drone2', 'land')
time.sleep(8)
get_state('drone1')
get_state('drone2')

print("\n=== DEMO COMPLETE ===")
ros.close()
