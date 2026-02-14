# Coordinate Frames in Multi-Drone Systems

## Overview

When running multiple PX4 drones (simulated or real), each drone maintains its **own local coordinate frame**. This is crucial to understand for multi-drone operations.

## The Problem

You might observe:
- drone1 reports altitude: `+2.8m` (positive, above ground)
- drone2 reports altitude: `-0.9m` (negative, "below ground")

**This is normal behavior, not a bug.**

## How PX4 Local Frames Work

### Single Drone (Instance 0)

When you start the first drone:
```bash
PX4_GZ_MODEL=x500_mono_cam make px4_sitl gz_x500
```

PX4 initializes its **local NED frame** (North-East-Down) with the origin at the drone's spawn position.

- **Local position (0, 0, 0)** = where the drone spawned
- **Z-axis:** Positive = down, Negative = up (NED convention)
- **Altitude reading:** `-local_z` (negative Z means "up" in NED)

**Example:**
```
Spawn position: (0, 0) in world
Local frame origin: (0, 0, 0) in local NED
After takeoff to 10m: local_z = -10.0
Altitude displayed: 10.0m
```

### Multiple Drones (Instance 1+)

When you spawn drone2:
```bash
PX4_GZ_MODEL_POSE="3,0,0,0,0,0" ./build/px4_sitl_default/bin/px4 -i 1
```

drone2 **also** initializes its own local NED frame at **its** spawn position.

- **drone1 local origin:** (0, 0, 0) in world coords
- **drone2 local origin:** (3, 0, 0) in world coords (3m east)
- **Independent frames:** Each drone reports positions relative to its own origin

**Example with terrain variation:**
```
World terrain:
- drone1 spawn: 0m elevation (flat ground)
- drone2 spawn: -2m elevation (slight dip in terrain)

After spawn:
- drone1: local_z = 0.0, altitude = 0.0m ✅
- drone2: local_z = +2.0, altitude = -2.0m ⚠️
```

drone2 shows **negative altitude** because its local origin is 2m above its current position (due to terrain).

## Global Frame (GPS/AMSL)

All drones share a **global frame** based on GPS coordinates:

```python
state = dc.get_state()
print(f"drone1: lat={state['latitude']}, lon={state['longitude']}, alt_msl={state['altitude']}")
print(f"drone2: lat={state['latitude']}, lon={state['longitude']}, alt_msl={state['altitude']}")
```

**Output:**
```
drone1: lat=37.412211, lon=-121.998879, alt_msl=39.66m
drone2: lat=37.412179, lon=-121.998860, alt_msl=37.74m
```

The global altitude (MSL - Mean Sea Level) shows the true elevation difference:
- drone1: 39.66m MSL
- drone2: 37.74m MSL
- **Difference: 1.92m** (drone2 spawned lower in the terrain)

## Impact on Commands

### Local Position Commands

When you send position commands, they are **relative to each drone's local frame**:

```python
# drone1
dc.set_drone_name('drone1')
dc.set_position(10, 0, -15, 0)  # 10m north, 15m altitude (in drone1's frame)

# drone2
dc.set_drone_name('drone2')
dc.set_position(10, 0, -15, 0)  # 10m north, 15m altitude (in drone2's frame)
```

**Result:**
- drone1 goes to (10, 0, -15) in its local frame
- drone2 goes to (10, 0, -15) in its local frame
- **They maintain their original spacing** (3m apart in world coords)

### Altitude References

Each drone's altitude command is relative to **its own local origin**:

```python
# Command both drones to "15m altitude"
dc.set_position(0, 0, -15, 0)  # Z=-15 in NED = 15m up
```

**Result:**
- drone1: 15m above its spawn point
- drone2: 15m above its spawn point
- **Global altitudes differ** due to terrain variation (drone2 is ~2m lower in MSL)

## Practical Implications

### ✅ What Works

1. **Individual drone control:** Each drone responds correctly to commands in its own frame
2. **Takeoff/land:** Each drone lands at its own spawn location (local origin)
3. **Relative movements:** Commands like "move 5m north" work correctly for each drone

### ⚠️ What Requires Care

1. **Fleet formation:** To fly in tight formation, you need to account for:
   - Initial spawn position differences (X, Y)
   - Terrain elevation differences (Z)

2. **Collision avoidance:** Drones at "same altitude" in local frames may be at different MSL altitudes

3. **Coordinated maneuvers:** Convert local positions to global frame or use relative positioning

## Solutions for Multi-Drone Coordination

### Option 1: Spawn Drones on Flat Terrain

Choose spawn positions with minimal elevation variation:

```bash
# Check terrain elevation before spawning
gz model -m ground_plane -p

# Spawn on known-flat area
PX4_GZ_MODEL_POSE="10,0,0,0,0,0"  # 10m north on flat ground
```

### Option 2: Use Global Frame for Coordination

Convert local positions to global GPS coordinates:

```python
# Get global positions
drone1_state = dc.get_state()  # drone1
drone1_gps = (drone1_state['latitude'], drone1_state['longitude'], drone1_state['altitude'])

drone2_state = dc.get_state()  # drone2
drone2_gps = (drone2_state['latitude'], drone2_state['longitude'], drone2_state['altitude'])

# Compare MSL altitudes
alt_diff = drone1_gps[2] - drone2_gps[2]
print(f"drone1 is {alt_diff:.2f}m higher than drone2 (MSL)")
```

### Option 3: Calibrate on Startup

Measure the offset between local frames after spawn:

```python
import drone_control as dc

# Get initial positions
dc.set_drone_name('drone1')
d1_init = dc.get_state()

dc.set_drone_name('drone2')
d2_init = dc.get_state()

# Calculate offsets
offset_x = d2_init['local_x'] - d1_init['local_x']
offset_y = d2_init['local_y'] - d1_init['local_y']
offset_z = d2_init['local_z'] - d1_init['local_z']

print(f"drone2 offset from drone1: ({offset_x:.2f}, {offset_y:.2f}, {offset_z:.2f})")

# Use offsets for coordinated commands
dc.set_drone_name('drone1')
dc.set_position(0, 0, -15, 0)

dc.set_drone_name('drone2')
dc.set_position(0 + offset_x, 0 + offset_y, -15 + offset_z, 0)
# Now both drones are at same global position
```

## Debugging Tips

### Check Frame Origins

```python
import drone_control as dc

def check_frame_origin(drone_name):
    dc.set_drone_name(drone_name)
    state = dc.get_state()
    print(f"{drone_name} frame:")
    print(f"  Local: ({state['local_x']:.2f}, {state['local_y']:.2f}, {state['local_z']:.2f})")
    print(f"  Global: lat={state['latitude']:.6f}, lon={state['longitude']:.6f}, msl={state['altitude']:.2f}m")
    print(f"  Altitude (NED): {-state['local_z']:.2f}m")
    print()

check_frame_origin('drone1')
check_frame_origin('drone2')
```

### Visualize in Gazebo

Gazebo's GUI shows **world coordinates** (not local frames):
- Right-click drone → "View → Transparent"
- Check world position vs reported local position

### Compare Local vs Global

```python
dc.set_drone_name('drone2')
state = dc.get_state()

print(f"Local altitude: {-state['local_z']:.2f}m (relative to spawn)")
print(f"Global altitude: {state['altitude']:.2f}m MSL (absolute)")
```

## Summary

- ✅ **Each drone has its own local coordinate frame**
- ✅ **"Negative altitude" is normal** if local origin is above current position
- ✅ **Commands work correctly** — they're relative to each drone's frame
- ⚠️ **Formation flying requires** accounting for frame offsets
- ⚠️ **Use global frame (GPS/MSL)** for absolute altitude comparisons

## See Also

- `docs/MULTI_DRONE_SETUP.md` — Multi-drone spawn procedures
- `docs/MULTI_DRONE_CAMERAS.md` — Camera-equipped multi-drone setup
- PX4 Documentation: [Coordinate Frames](https://docs.px4.io/main/en/ros/external_position_estimation.html#reference-frames-and-ros)
