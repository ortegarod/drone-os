# DroneOS Web Interface

A real-time web-based ground control station for monitoring and controlling PX4 drones. Features live telemetry visualization, interactive maps, and AI-powered drone control.

## System Dependencies

The frontend requires these services to be running:

```
┌─────────────────────────────────────────────────────────────────┐
│                     FRONTEND (:3000)                            │
│                  DroneOS Command Center                         │
└───────────────────────┬─────────────────────┬───────────────────┘
                        │                     │
                        ▼                     ▼
        ┌───────────────────────┐   ┌─────────────────────┐
        │  rosbridge (:9090)    │   │ web_video_server    │
        │  WebSocket → ROS2     │   │ (:8080) MJPEG       │
        └───────────┬───────────┘   └──────────┬──────────┘
                    │                          │
                    ▼                          │
        ┌───────────────────────┐              │
        │     drone_core        │              │
        │  /drone1/arm          │              │
        │  /drone1/takeoff      │              │
        │  /drone1/get_state    │              │
        │  /drone1/set_position │              │
        └───────────┬───────────┘              │
                    │                          │
                    ▼                          ▼
        ┌───────────────────────┐   ┌─────────────────────┐
        │   micro_agent (DDS)   │   │  /camera topic      │
        │       (:8888)         │   │  (from Gazebo)      │
        └───────────┬───────────┘   └──────────┬──────────┘
                    │                          │
                    ▼                          ▼
        ┌─────────────────────────────────────────────────┐
        │              PX4 SITL + Gazebo                  │
        │           (runs on HOST, needs GPU)             │
        └─────────────────────────────────────────────────┘
```

### Service Summary

| Service | Port | Container | Purpose |
|---------|------|-----------|---------|
| Frontend | 3000 | `frontend_node` | React web UI |
| rosbridge | 9090 | `rosbridge_server` | WebSocket → ROS2 bridge |
| web_video_server | 8080 | `sim_camera_node` | MJPEG camera stream |
| drone_core | - | `drone_core_node` | Drone control services |
| micro_agent | 8888 | `micro_agent_service` | PX4 ↔ ROS2 DDS bridge |
| PX4 SITL | - | **HOST** | Flight controller simulation |
| Gazebo | - | **HOST** | 3D simulation (needs GPU) |
| ros_gz_bridge | - | **HOST** | Gazebo camera → ROS2 |

### What Happens If Services Are Missing

| Missing Service | Symptom in Frontend |
|-----------------|---------------------|
| rosbridge | "Disconnected" status, no telemetry |
| drone_core | Service calls fail, "get_state failed" |
| PX4 SITL | drone_core returns stale/zero data |
| web_video_server | "Loading video stream..." forever |
| ros_gz_bridge | Camera shows black/no signal |

## Architecture

### Frontend (React + TypeScript)
- **React 18** with TypeScript for type safety
- **Leaflet** for interactive mapping
- **ROSLIB.js** for real-time ROS2 communication via rosbridge
- **Webpack** for bundling and development

### Backend Services
- **rosbridge_server** (port 9090) - Primary WebSocket-based ROS2 communication
- **Custom Python bridge** (port 8000) - REST API with DroneOS-specific logic - use in conjunction with rosbridge - RPC/gRPC for commands. rosbridge/roslibjs for debugging and raw telemetry exploration.
- **AI Orchestrator** for natural language drone control

### Communication Architecture
The web interface uses **two parallel bridge services**:

#### 1. rosbridge_suite (WebSocket - Port 9090) - PRIMARY
- **Used by**: React frontend exclusively
- **Purpose**: Real-time ROS2 communication
- **Features**:
  - All drone commands (arm, disarm, takeoff, land, position control)
  - Real-time telemetry subscriptions
  - PX4 raw topic subscriptions (vehicle status, position, battery)
  - Service discovery and drone detection
  - Standard rosbridge protocol with ROSLIB.js

#### 2. Custom Python Bridge (REST API - Port 8000) - SECONDARY
- **Used by**: Currently unused by frontend
- **Purpose**: Application-specific business logic
- **Features**:
  - DroneOS-specific REST endpoints
  - Structured request/response with Pydantic models
  - Multi-drone target switching
  - State aggregation and management
  - HTTP-based drone control API

**Note**: The React frontend uses **only rosbridge_suite** for all communication. The custom Python bridge exists but is not currently utilized by the web interface.

### Real-Time Telemetry System
- **WebSocket streaming** for low-latency data transfer

## Key Features

### 🗺️ Real-Time GPS Mapping
- **Live position tracking** of multiple drones at 10Hz
- **Interactive map controls** for waypoint navigation

### 📊 Comprehensive Telemetry Dashboard
- **Battery status** with voltage, current, and remaining percentage
- **GPS health** including satellite count, accuracy, and fix type
- **Flight modes** and arming status
- **System health** scoring with warning/failure detection
- **Wind conditions** and environmental data

### 🎮 Manual Controls
- **Arm/Disarm** drone control
- **Takeoff/Landing** automation
- **Position control** with local coordinate targeting
- **Emergency RTL** (Return to Launch)

### 🤖 AI Integration - highly experimental!
- **Natural language** drone control commands
- **OpenAI GPT** integration for intelligent flight planning
- **Safety validation** of AI-generated commands

## Real-Time GPS Implementation

### Core Components

#### 1. Telemetry Publisher (C++)
```cpp
// src/drone_core/src/telemetry_publisher_node.cpp
// Publishes drone state at 10Hz to /px4_1/drone_state topic
```

**Key Features:**
- High-frequency publishing (10Hz) for smooth position updates
- Comprehensive telemetry data aggregation
- Multiple drone support with namespaced topics
- Real-time sensor fusion from PX4 topics

#### 2. DroneMap Component (React)
```typescript
// web_interface/frontend/src/components/DroneMap.tsx
// Real-time GPS visualization with interactive controls
```

**Key Features:**
- WebSocket subscription to ROS2 topics via rosbridge
- Throttled updates (100ms) to prevent UI overwhelming
- Interactive waypoint setting via map clicks
- Multi-drone position tracking with distinctive markers

#### 3. Real-Time Data Flow
```
PX4 → Micro-XRCE-DDS → drone_core → rosbridge_suite → WebSocket → React Frontend
```

**Communication Paths:**
- **Drone Commands**: React → ROSLIB.js → rosbridge_suite → ROS2 Services → drone_core
- **Telemetry Data**: drone_core → ROS2 Topics → rosbridge_suite → WebSocket → React
- **PX4 Raw Data**: PX4 → Micro-XRCE-DDS → rosbridge_suite → WebSocket → React

**Update Frequency:**
- PX4 sensors: Variable (up to 100Hz)
- drone_core services: On-demand (service calls)
- rosbridge_suite: Real-time (WebSocket streaming)
- React frontend: Throttled to 10Hz for smooth UI

### Configuration

#### ROS2 Topics
- `/px4_1/drone_state` - Primary telemetry stream
- `/px4_1/get_state` - Service for on-demand state queries
- Additional topics for battery, GPS, failsafe data

#### WebSocket Settings
```typescript
// rosbridge_suite connection (port 9090)
const ros = new ROSLIB.Ros({
  url: 'ws://localhost:9090'
});

// Example service call for drone commands
const armService = new ROSLIB.Service({
  ros: ros,
  name: '/drone1/arm',
  serviceType: 'std_srvs/srv/Trigger'
});

// Example topic subscription for telemetry
const stateTopic = new ROSLIB.Topic({
  ros: ros,
  name: '/drone1/fmuout/vehicle_local_position',
  messageType: 'px4_msgs/msg/VehicleLocalPosition',
  throttle_rate: 100,  // 10Hz maximum
  queue_length: 1      // Latest message only
});
```

## Getting Started

### Prerequisites
- Docker and Docker Compose
- Node.js 18+ (for local development)
- Python 3.8+ (for backend development)
- ROS2 Humble with rosbridge_suite

### Quick Start

**Step 1: Start Docker services**
```bash
cd ~/ws_droneOS
docker compose -f docker/dev/docker-compose.dev.yml up -d
```

This starts: `frontend_node`, `rosbridge_server`, `drone_core_node`, `micro_agent_service`, `sim_camera_node`

**Step 2: Start PX4 SITL + Gazebo (HOST - needs GPU)**
```bash
cd ~/PX4-Autopilot

# For NVIDIA GPU (required on srv01):
DISPLAY=:0 __NV_PRIME_RENDER_OFFLOAD=1 __GLX_VENDOR_LIBRARY_NAME=nvidia \
make px4_sitl gz_x500_mono_cam

# For integrated graphics or headless:
# HEADLESS=1 make px4_sitl gz_x500_mono_cam
```

Wait for: `[commander] Ready for takeoff!`

**Step 3: Start camera bridge (HOST - same terminal or new one)**
```bash
source /opt/ros/humble/setup.bash
ros2 run ros_gz_bridge parameter_bridge /camera@sensor_msgs/msg/Image@gz.msgs.Image
```

**Step 4: Verify**
```bash
# Check all containers running
docker ps --format "table {{.Names}}\t{{.Status}}"

# Test frontend
curl -s -o /dev/null -w "%{http_code}" http://localhost:3000  # Should return 200

# Test camera stream
curl -s "http://localhost:8080/snapshot?topic=/camera" -o /tmp/test.jpg && file /tmp/test.jpg
```

**Access Points:**
- **Web Interface**: `http://<server-ip>:3000`
- **Camera Stream**: `http://<server-ip>:8080/stream?topic=/camera&type=mjpeg`
- **rosbridge WebSocket**: `ws://<server-ip>:9090`

### Development Mode

**Frontend runs in Docker** with hot reload (source is mounted):
```bash
# Start frontend container
docker compose -f docker/dev/docker-compose.dev.yml up -d frontend

# View logs
docker logs -f frontend_node

# Restart after changes (usually auto-reloads)
docker restart frontend_node
```

**Alternative: Run frontend on host** (if you prefer):
```bash
cd web_interface/frontend
npm install
npm start
```

**Backend Development:**
```bash
# For rosbridge_suite (primary backend)
docker compose -f docker/dev/docker-compose.dev.yml logs -f rosbridge_server

# For custom Python bridge (optional)
cd web_interface/backend
pip install -r requirements.txt
python ros2_web_bridge.py
```

## Usage

### Real-Time GPS Tracking

1. **Start telemetry publisher** to begin broadcasting drone positions
2. **Open web interface** and navigate to the Map tab
3. **Observe real-time updates** as drone markers move smoothly on the map
4. **Click on map** to send waypoint commands to the active drone

### Multi-Drone Support

The system supports multiple drones with distinct markers:
- **Red marker**: Current target drone
- **Blue markers**: Other drones in the fleet
- **Real-time updates**: All drones update simultaneously


### Debug Commands

```bash
# Check running containers
docker ps --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}"

# Check rosbridge_suite logs
docker logs -f rosbridge_server

# Test rosbridge WebSocket connection
curl -s -w "%{http_code}" http://localhost:9090 || echo "rosbridge not responding"

# Check ROS2 services available to drone
docker exec drone_core_node ros2 service list | grep drone1

# Monitor ROS2 topics
docker exec drone_core_node ros2 topic list | grep drone1
docker exec drone_core_node ros2 topic echo /drone1/fmuout/vehicle_status

# Check frontend development server
lsof -i :3000  # Check if port 3000 is in use
lsof -i :3001  # Check if port 3001 is in use

# Verify npm dependencies
cd web_interface/frontend && npm list --depth=0
```

## Technical Details

### Message Format
```typescript
interface DroneState {
  header: Header;
  drone_name: string;
  local_x: number;
  local_y: number;
  local_z: number;
  local_yaw: number;
  latitude: number;
  longitude: number;
  altitude: number;
  global_position_valid: boolean;
  // ... additional telemetry fields
}
```


## Changelog

### v1.3.0 - Frontend Architecture Update
- **Fixed frontend deployment**: React frontend now runs on host machine for optimal development
- **Clarified dual bridge architecture**: rosbridge_suite (primary) + custom Python bridge (optional)
- **Updated documentation**: Comprehensive troubleshooting and setup procedures
- **Improved port management**: Automatic port selection for frontend development
- **Enhanced debugging**: Added detailed debug commands and container monitoring

### v1.2.0 - Real-Time GPS Implementation
- Added 10Hz telemetry publishing
- Implemented real-time map updates
- Enhanced multi-drone support
- Improved coordinate system handling

### v1.1.0 - Web Interface Foundation
- Initial React frontend
- Basic telemetry dashboard
- Manual control interface
- AI integration framework

### v1.0.0 - Initial Release
- Core ROS2 integration
- Basic mapping functionality
- Docker containerization
- Development environment setup
---

## Camera Streaming

### Current Setup
```
Gazebo (640x480 @ 30fps) → ros_gz_bridge → ROS2 /camera → web_video_server → MJPEG → Browser
```

**Note:** Raw camera data (~28MB/s) flows through ROS2 regardless of frontend resolution request. web_video_server compresses after receiving full frames.

### Stream URL Parameters
```
http://host:8080/stream?topic=/camera&type=mjpeg&width=640&height=480&quality=50&qos_profile=sensor_data
```

| Param | Default | Description |
|-------|---------|-------------|
| `type` | mjpeg | Stream format (mjpeg, vp8, h264, png) |
| `width/height` | 0 (original) | Output resolution |
| `quality` | 95 | JPEG quality (1-100) |
| `qos_profile` | default | Use `sensor_data` for smoother streaming |

### Optimization Options (Not Yet Implemented)

If streaming is still choppy, consider:

1. **Reduce Gazebo camera resolution** — Edit `PX4-Autopilot/Tools/simulation/gz/models/mono_cam/model.sdf`
2. **Use gstreamer** — Hardware-accelerated encoding
3. **Skip ROS2 entirely** — Gazebo has native streaming capabilities
4. **Use compressed image transport** — Compress at ros_gz_bridge level

