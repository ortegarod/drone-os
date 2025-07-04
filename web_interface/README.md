# DroneOS Web Interface

A real-time web-based ground control station for monitoring and controlling PX4 drones. Features live telemetry visualization, interactive maps, and AI-powered drone control.

## Architecture

### Frontend (React + TypeScript)
- **React 18** with TypeScript for type safety
- **Leaflet** for interactive mapping
- **ROSLIB.js** for real-time ROS2 communication via rosbridge
- **Webpack** for bundling and development

### Backend (Python)
- **rosbridge_server** for WebSocket-based ROS2 communication
- **AI Orchestrator** for natural language drone control
- **FastAPI** integration for REST endpoints

### Real-Time Telemetry System
- **10Hz GPS position updates** via ROS2 topics
- **WebSocket streaming** for low-latency data transfer
- **Optimized rendering** with throttled map updates

## Key Features

### 🗺️ Real-Time GPS Mapping
- **Live position tracking** of multiple drones at 10Hz
- **Interactive map controls** for waypoint navigation
- **OSRS-style drone markers** with customizable styling
- **Smooth position interpolation** for fluid movement visualization

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

### 🤖 AI Integration
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
PX4 → Micro-XRCE-DDS → telemetry_publisher → rosbridge → WebSocket → DroneMap
```

**Update Frequency:**
- PX4 sensors: Variable (up to 100Hz)
- Telemetry publisher: 10Hz
- WebSocket streaming: 10Hz
- Map rendering: Throttled to 10Hz

### Configuration

#### ROS2 Topics
- `/px4_1/drone_state` - Primary telemetry stream
- `/px4_1/get_state` - Service for on-demand state queries
- Additional topics for battery, GPS, failsafe data

#### WebSocket Settings
```typescript
// Optimized for real-time performance
const topic = new ROSLIB.Topic({
  ros: droneAPI.ros,
  name: '/px4_1/drone_state',
  messageType: 'drone_interfaces/DroneState',
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

1. **Start the complete system:**
```bash
cd ws_droneOS
docker compose -f docker/dev/docker-compose.dev.yml up -d --build
```

2. **Launch PX4 SITL:**
```bash
cd PX4-Autopilot
HEADLESS=1 make px4_sitl gz_x500
```

3. **Start telemetry publisher:**
```bash
source install/setup.bash
ros2 run drone_core telemetry_publisher
```

4. **Access web interface:**
```bash
cd web_interface
npm install
npm start
```

Navigate to `http://localhost:3000` to view the ground control station.

### Development Mode

For frontend development with hot reload:
```bash
cd web_interface/frontend
npm install
npm start
```

For backend development:
```bash
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

### Interactive Controls

- **Map click**: Send position commands to active drone
- **Marker popup**: View detailed drone information
- **Zoom controls**: Navigate between local and wide area views
- **Status indicators**: Monitor connection and GPS health

## Performance Optimization

### Real-Time Rendering
- **Throttled updates**: Prevents UI overwhelming at high frequencies
- **Smart marker management**: Only updates when positions change significantly
- **Efficient data structures**: Maps for O(1) drone lookups
- **WebSocket optimization**: Minimal message queuing

### GPS Accuracy
- **Coordinate validation**: Filters invalid GPS readings
- **Accuracy thresholds**: Configurable precision requirements
- **Fallback handling**: Graceful degradation when GPS is unavailable

## Troubleshooting

### Common Issues

**No GPS updates on map:**
1. Verify telemetry publisher is running
2. Check rosbridge connection in browser console
3. Ensure drone has valid GPS fix
4. Verify topic names match configuration

**Slow or choppy updates:**
1. Check network latency to rosbridge
2. Verify WebSocket throttling settings
3. Monitor browser performance in DevTools
4. Reduce update frequency if needed

**Map clicks not working:**
1. Ensure drone has valid local position
2. Check coordinate transformation calculations
3. Verify setPosition service is available
4. Monitor console for JavaScript errors

### Debug Commands

```bash
# Check ROS2 topics
ros2 topic list | grep drone_state
ros2 topic echo /px4_1/drone_state

# Monitor rosbridge
rostopic list
rostopic echo /rosbridge_websocket

# Check telemetry publisher
ros2 node info /telemetry_publisher
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

### Coordinate Systems
- **Local NED**: North-East-Down for flight control
- **GPS WGS84**: Global positioning for mapping
- **Map projection**: Automatic conversion between systems

### Update Pipeline
1. **PX4 sensors** → Raw telemetry data
2. **DroneState** → Aggregated state information
3. **Telemetry publisher** → ROS2 topic publication
4. **rosbridge** → WebSocket streaming
5. **DroneMap** → Real-time visualization

## Contributing

### Development Setup
1. Fork the repository
2. Create feature branch
3. Make changes with tests
4. Submit pull request

### Code Style
- **TypeScript**: Strict mode enabled
- **React**: Functional components with hooks
- **C++**: ROS2 coding standards
- **Python**: PEP 8 compliance

### Testing
```bash
# Frontend tests
npm test

# Backend tests
python -m pytest

# ROS2 integration tests
colcon test --packages-select drone_core
```

## License

This project is licensed under the MIT License - see the LICENSE file for details.

## Changelog

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