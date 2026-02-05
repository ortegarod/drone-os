---
name: droneos
description: Control PX4 drones via the DroneOS SDK. Use for flight commands, position control, missions, and telemetry. Requires offboard mode before position commands.
homepage: https://github.com/ortegarod/ws_droneOS
metadata: { "openclaw": { "emoji": "🛸", "requires": { "bins": ["python3"], "pip": ["roslibpy"] } } }
---

# DroneOS Drone Control

Control drones via `drone_control.py`. All commands:

```bash
cd /home/rodrigo/ws_droneOS && python3 -c "import drone_control; print(drone_control.FUNCTION())"
```

## Prerequisites

**Start PX4 SITL first** (on srv01 with NVIDIA GPU):
```bash
cd ~/PX4-Autopilot
DISPLAY=:0 __NV_PRIME_RENDER_OFFLOAD=1 __GLX_VENDOR_LIBRARY_NAME=nvidia \
__EGL_VENDOR_LIBRARY_FILENAMES=/usr/share/glvnd/egl_vendor.d/10_nvidia.json \
make px4_sitl gz_x500_mono_cam
```

Docker services (drone_core, rosbridge, etc.) should already be running.

## Flight Sequence (Tested Working)

⚠️ **CRITICAL: Offboard mode MUST be set BEFORE arming, or drone auto-disarms!**

```python
drone_control.set_offboard()      # 1. FIRST - enable offboard mode
drone_control.arm()               # 2. Arm motors  
drone_control.set_position(0, 0, -30, 0)  # 3. Fly to 30m (z=-30 = UP)
# ... do stuff ...
drone_control.land()              # 4. Land (auto-descent)
```

**Note:** `takeoff()` is a placeholder — use `set_position()` for altitude control.

## Coordinate System (NED)

- X = North, Y = East, Z = **Down**
- **Altitude is NEGATIVE Z**: `z=-10` = 10 meters UP

## Commands

| Function | Description |
|----------|-------------|
| `get_state()` | Full telemetry (position, battery, mode, warnings) |
| `set_offboard()` | Enable offboard control mode |
| `arm()` | Arm motors |
| `disarm()` | Disarm motors |
| `takeoff()` | Auto takeoff (placeholder) |
| `land()` | Land at current position |
| `return_to_launch()` | RTL to home |
| `set_position(x, y, z, yaw)` | Go to local position (NED, yaw in radians) |
| `flight_termination()` | **Emergency only** — drone falls |

## Missions

```python
# Build waypoints
waypoints = drone_control.build_local_waypoints([
    {"x": 10, "y": 0, "z": -15},
    {"x": 10, "y": 10, "z": -15},
])
drone_control.upload_mission(waypoints)
drone_control.mission_control('START')  # START, PAUSE, RESUME, STOP, CLEAR
drone_control.get_mission_status()
```

## Multi-Drone

```python
drone_control.set_drone_name('drone2')  # Switch target
drone_control.get_drone_name()          # Current target
```

## Troubleshooting

- **Auto-disarms**: Set offboard mode before arming
- **Position rejected**: Must be in OFFBOARD mode and ARMED
- **Connection refused**: rosbridge not running (`ros2 launch rosbridge_server rosbridge_websocket_launch.py`)
