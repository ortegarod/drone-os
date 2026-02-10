# Multi-Drone Simulation Setup

## Overview

DroneOS supports running multiple simulated drones in Gazebo. This is useful for:
- Fleet coordination demonstrations
- Multi-agent mission planning
- Collision avoidance testing
- Hackathon "wow factor" (AI controlling multiple drones simultaneously)

## Prerequisites

- PX4-Autopilot installed at `~/PX4-Autopilot`
- Gazebo simulation environment working
- DroneOS Docker services running

## Starting Multiple Drones

### Drone 1 (Primary - MAV_SYS_ID=1)

**Terminal 1:**
```bash
cd ~/PX4-Autopilot
HEADLESS=1 make px4_sitl gz_x500
```

- Instance ID: 0 (default)
- MAV_SYS_ID: 1
- Namespace: `/fmu/`
- UXRCE-DDS port: 8888 (default)
- Position: (0, 0) origin

### Drone 2 (Secondary - MAV_SYS_ID=2)

**Terminal 2:**
```bash
cd ~/PX4-Autopilot
HEADLESS=1 \
  PX4_SYS_AUTOSTART=4001 \
  PX4_GZ_MODEL_POSE="0,2" \
  PX4_SIM_MODEL=gz_x500 \
  MAV_SYS_ID=2 \
  ./build/px4_sitl_default/bin/px4 -i 1
```

- Instance ID: 1
- MAV_SYS_ID: 2
- Namespace: `/px4_1/fmu/`
- UXRCE-DDS port: 8889 (auto-incremented)
- Position: (0, 2) - 2 meters East of origin

### Drone 3 (Optional - MAV_SYS_ID=3)

**Terminal 3:**
```bash
cd ~/PX4-Autopilot
HEADLESS=1 \
  PX4_SYS_AUTOSTART=4001 \
  PX4_GZ_MODEL_POSE="2,0" \
  PX4_SIM_MODEL=gz_x500 \
  MAV_SYS_ID=3 \
  ./build/px4_sitl_default/bin/px4 -i 2
```

- Instance ID: 2
- MAV_SYS_ID: 3
- Namespace: `/px4_2/fmu/`
- UXRCE-DDS port: 8890 (auto-incremented)
- Position: (2, 0) - 2 meters North of origin

## Running drone_core for Each Drone

Each drone needs its own `drone_core` instance to expose ROS2 services.

### Drone 1 (Already Running)

This is the default instance that starts automatically with Docker:
```bash
# Already running via docker-compose.dev.yml
docker logs -f drone_core_node
```

### Drone 2

**Inside drone_core container:**
```bash
docker exec -it drone_core_node bash
source /opt/ros/humble/setup.bash
source ~/ws_droneOS/install/setup.bash

ros2 run drone_core drone_core --ros-args \
  -r __node:=drone2 \
  -p drone_name:=drone2 \
  -p px4_namespace:=/px4_1/fmu/ \
  -p mav_sys_id:=2
```

### Drone 3

**Inside drone_core container (different terminal):**
```bash
docker exec -it drone_core_node bash
source /opt/ros/humble/setup.bash
source ~/ws_droneOS/install/setup.bash

ros2 run drone_core drone_core --ros-args \
  -r __node:=drone3 \
  -p drone_name:=drone3 \
  -p px4_namespace:=/px4_2/fmu/ \
  -p mav_sys_id:=3
```

## Verifying Multi-Drone Setup

### Check ROS2 Services

```bash
# Should see services for all drones
ros2 service list | grep -E "drone[123]"
```

Expected output:
```
/drone1/arm
/drone1/disarm
/drone1/land
/drone1/set_offboard
/drone1/set_position
...
/drone2/arm
/drone2/disarm
...
/drone3/arm
/drone3/disarm
...
```

### Check Telemetry Topics

```bash
ros2 topic list | grep -E "drone[123]"
```

Expected output:
```
/drone1/drone_state
/drone1/battery_status
...
/drone2/drone_state
/drone2/battery_status
...
```

### Test GCS CLI with Multiple Drones

```bash
docker compose -f docker/dev/gcs/docker-compose.gcs.yml run --rm -it gcs_cli \
  ros2 run drone_gcs_cli drone_gcs_cli -d drone1
```

Commands:
```
# Control drone1
set_offboard
arm
pos 0 0 -5 0

# Switch to drone2
target drone2
set_offboard
arm
pos 0 2 -5 0

# Switch to drone3
target drone3
set_offboard
arm
pos 2 0 -5 0
```

## OpenClaw Multi-Drone Control

### Using drone_control.py

Create `multi_drone_test.py`:
```python
#!/usr/bin/env python3
import sys
sys.path.append('/home/rodrigo/ws_droneOS')
import drone_control

# Configure for drone2
drone_control.DRONE_NAME = "drone2"

# Same commands as drone1
drone_control.set_offboard()
drone_control.arm()
drone_control.set_position(0, 2, -10, 0)  # 10m altitude at (0,2)
```

### Fleet Command Script

Create `fleet_test.py`:
```python
#!/usr/bin/env python3
import time
import subprocess

def control_drone(drone_name, x, y, z):
    """Send position command to a specific drone"""
    script = f"""
import sys
sys.path.append('/home/rodrigo/ws_droneOS')
import drone_control

drone_control.DRONE_NAME = "{drone_name}"
drone_control.set_offboard()
drone_control.arm()
drone_control.set_position({x}, {y}, {z}, 0)
"""
    subprocess.run(["python3", "-c", script])

# Command all drones to formation
print("Commanding fleet to formation...")
control_drone("drone1", 0, 0, -10)
time.sleep(1)
control_drone("drone2", 0, 5, -10)
time.sleep(1)
control_drone("drone3", 5, 0, -10)

print("Fleet in formation at 10m altitude!")
```

## Troubleshooting

### Drones spawn at same location

**Problem:** Multiple drones appear at origin (0,0)
**Solution:** Ensure `PX4_GZ_MODEL_POSE` is set correctly for each instance

### Services not appearing

**Problem:** `/drone2/` services not listed
**Solution:** 
- Check PX4 SITL is running with correct MAV_SYS_ID
- Verify micro_agent is connected (check logs)
- Ensure drone_core launched with correct px4_namespace

### Drones interfere with each other

**Problem:** Commands sent to one drone affect another
**Solution:**
- Verify each drone has unique MAV_SYS_ID
- Check drone_name parameter in drone_core
- Ensure proper namespace isolation

## Performance Considerations

### Resource Usage
- Each PX4 SITL instance: ~500MB RAM
- Gazebo (shared): ~2GB RAM + GPU
- Each drone_core: ~50MB RAM

**Recommended max for srv01:** 3-4 drones (16GB RAM total)

### Network Bandwidth
- Each drone publishes telemetry at ~10Hz
- rosbridge forwards to VPS
- Optimize by reducing update frequency for non-critical topics

## Demo Scenarios

### Scenario 1: Formation Flight
3 drones in triangle formation, coordinated climb

### Scenario 2: Area Search
Grid pattern with 2 drones covering different sectors

### Scenario 3: Patrol Route
Drones follow waypoints in sequence, one after another

## Next Steps

- [ ] Test 2-drone setup on srv01
- [ ] Integrate multi-drone control into OpenClaw
- [ ] Build fleet coordination logic
- [ ] Add to frontend dashboard (multiple drone markers)
- [ ] Demo for hackathon judges 🚁🚁🚁
