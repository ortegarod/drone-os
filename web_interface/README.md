# DroneOS Web Interface

A real-time web-based ground control station for monitoring and controlling PX4 drones. Features live telemetry visualization, interactive maps, and AI-powered drone control.

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

1. **Start PX4 SITL (in separate terminal):**
```bash
cd PX4-Autopilot
HEADLESS=1 make px4_sitl gz_x500
```

2. **Start core drone services:**
```bash
cd ws_droneOS
docker compose -f docker/dev/docker-compose.dev.yml up -d --build drone_core micro_agent
```

3. **Start web interface services:**
```bash
# Start rosbridge_suite for frontend communication
docker compose -f docker/dev/docker-compose.dev.yml up -d rosbridge_server

# Start custom web bridge (optional, for REST API)
docker compose -f docker/dev/docker-compose.web.yml up -d web_interface
```

4. **Start frontend (React development server):**
```bash
cd web_interface/frontend
npm install
npm start
```

**Access Points:**
- **Web Interface**: `http://localhost:3000` (React frontend)
- **rosbridge WebSocket**: `ws://localhost:9090` (Used by frontend)
- **Custom API**: `http://localhost:8000` (Available but unused by frontend)

**Note**: If port 3000 is in use, the frontend will automatically use the next available port (e.g., 3001). Check the npm start output for the actual URL.

### Development Mode

**Frontend Development (with hot reload):**
```bash
cd web_interface/frontend
npm install
npm start
```
- Frontend runs on host machine for faster development
- Hot reload enabled for code changes
- Connects to rosbridge_suite running in Docker

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