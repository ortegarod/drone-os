# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Essential Commands

### Building and Running

```bash
# Build all packages
colcon build

# Build specific package
colcon build --packages-select drone_core
colcon build --packages-select drone_gcs_cli

# Source the workspace (required after building)
source install/setup.bash

# Run drone_core node (example for drone1)
ros2 run drone_core drone_core --ros-args \
    -r __node:=drone1 \
    -p drone_name:=drone1 \
    -p px4_namespace:=/fmu/ \
    -p mav_sys_id:=1

# Run GCS CLI
ros2 run drone_gcs_cli drone_gcs_cli -d drone1
```

### Docker Development Commands

```bash
# Start development environment (SITL)
docker compose -f docker/dev/docker-compose.dev.yml up -d --build

# Start only essential services for SITL (no camera)
docker compose -f docker/dev/docker-compose.dev.yml up -d --build drone_core micro_agent

# Enter drone_core container
docker compose -f docker/dev/docker-compose.dev.yml exec drone_core bash

# Enter micro_agent container
docker compose -f docker/dev/docker-compose.dev.yml exec micro_agent bash

# Build and run Micro-XRCE-DDS-Agent (inside micro_agent container)
cd /root/ws_droneOS/Micro-XRCE-DDS-Agent
mkdir build && cd build
cmake .. && make && make install
ldconfig /usr/local/lib/
./MicroXRCEAgent udp4 -p 8888  # For SITL
```

### Testing

```bash
# Python package tests (drone_gcs_cli)
colcon test --packages-select drone_gcs_cli
colcon test-result --verbose

# Running specific Python tests
python3 -m pytest src/drone_gcs_cli/test/
```

## High-Level Architecture

### System Overview
DroneOS is a ROS 2-based framework for autonomous drone control, built on top of PX4 Autopilot. The system follows a distributed architecture where each physical drone runs its own `drone_core` instance, and operators control drones through the `drone_gcs_cli` interface.

### Communication Flow
```
PX4 Autopilot ←→ Micro-XRCE-DDS-Agent ←→ ROS 2 DDS Network ←→ drone_core ←→ drone_gcs_cli
```

### Multi-Drone Architecture
- Each drone requires a unique configuration:
  - `MAV_SYS_ID`: MAVLink system identifier (1, 2, 3...)
  - `px4_namespace`: ROS 2 topic namespace (/fmu/, /px4_1/fmu/, /px4_2/fmu/...)
  - `drone_name`: Logical name for service namespacing (drone1, drone2...)
- The Micro-XRCE-DDS-Agent bridges PX4's internal DDS with ROS 2's DDS network
- In SITL: Agent connects via UDP (port 8888)
- In production: Agent connects via Serial/USB to flight controller

### Core Components

#### drone_core (C++)
- **DroneState**: Subscribes to PX4 topics, tracks vehicle state
- **DroneAgent**: Sends VehicleCommand messages to PX4
- **OffboardControl**: Manages offboard mode and trajectory setpoints
- **DroneController**: Orchestrates components, implements control logic
- **DroneNode**: ROS 2 node wrapper, exposes services

#### drone_gcs_cli (Python)
- Interactive CLI for drone control
- Creates service clients dynamically based on target drone
- Supports multi-drone targeting via `target` command

### Docker Architecture
- Development setup uses host networking for easy multi-container communication
- Production setup designed for companion computers (Raspberry Pi)
- Services:
  - `drone_core`: Main control logic
  - `micro_agent`: PX4-ROS2 bridge
  - `camera_service`: Camera streaming (optional, requires hardware)
  - `object_detector_service`: Coral TPU object detection (optional)

### Key Design Patterns
1. **Service-Based Control**: All drone commands exposed as ROS 2 services
2. **Namespace Isolation**: Each drone isolated by ROS 2 namespaces
3. **State Tracking**: Continuous monitoring of PX4 state topics
4. **Asynchronous Commands**: Non-blocking service calls with timeouts
5. **Hardware Abstraction**: Same code works for SITL and real drones

## Important Considerations

### PX4 Integration
- PX4 publishes/subscribes to specific topic patterns based on instance ID
- VehicleCommand messages must include correct target_system (MAV_SYS_ID)
- Offboard mode requires continuous setpoint streaming (>2Hz)

### Network Configuration
- Uses FastDDS with custom configuration (fastdds_config.xml)
- Domain ID must match across all nodes (default: 0)
- For remote operation, Tailscale VPN is recommended

### Development vs Production
- Development: All services in containers, PX4 SITL on host
- Production: Containers on companion computer, PX4 on flight controller
- Key difference: UDP (SITL) vs Serial (real hardware) for agent connection