# Rosbridge Real-time Telemetry Integration

This document describes the complete implementation of real-time drone telemetry using rosbridge WebSocket for your drone web interface.

## 🏗️ Architecture Overview

```
┌─────────────────┐    ┌──────────────────┐    ┌─────────────────┐
│  Drone System   │    │   Rosbridge      │    │ Web Frontend    │
│                 │    │   WebSocket      │    │                 │
│  ┌─────────────┐│    │                  │    │ ┌─────────────┐ │
│  │DroneState   ││───▶│  JSON Protocol   │◀──▶│ │StatusBar    │ │
│  │Publisher    ││    │                  │    │ │Component    │ │
│  └─────────────┘│    │  Port: 9090      │    │ └─────────────┘ │
│                 │    │                  │    │                 │
│  ┌─────────────┐│    │  Security:       │    │ ┌─────────────┐ │
│  │GetState     ││    │  Topic/Service   │    │ │Telemetry    │ │
│  │Service      ││    │  Access Control  │    │ │Hook         │ │
│  └─────────────┘│    │                  │    │ └─────────────┘ │
└─────────────────┘    └──────────────────┘    └─────────────────┘
```

## 📦 Components Created

### 1. Backend Components

#### DroneStatePublisher (`drone_core/src/drone_core/drone_state_publisher.cpp`)
- **Purpose**: Publishes continuous DroneState messages at 10Hz
- **Topics**: `/{namespace}/drone_state`
- **Services**: `/{namespace}/get_state`
- **Features**: 
  - Real-time telemetry aggregation
  - System health scoring
  - Warning/failure detection
  - Comprehensive state information

#### Rosbridge Launch Configuration (`rosbridge_launch.py`)
- **Purpose**: Configured rosbridge server for drone telemetry
- **Features**:
  - Security: Topic/service access control
  - Performance optimization
  - WebSocket configuration
  - Auto-starts rosapi for introspection

### 2. Frontend Components

#### RosbridgeClient (`web_interface/frontend/src/services/rosbridgeClient.ts`)
- **Purpose**: TypeScript client for rosbridge WebSocket communication
- **Features**:
  - Automatic reconnection with exponential backoff
  - Topic subscription management
  - Service call support
  - Connection status monitoring
  - Message throttling and queuing

#### RealTimeStatusBar (`web_interface/frontend/src/components/RealTimeStatusBar.tsx`)
- **Purpose**: Live status bar component for critical telemetry
- **Features**:
  - Real-time updates (10Hz)
  - Status indicators with color coding
  - Warning/critical failure alerts
  - Responsive design
  - Connection status display

#### useDroneTelemetry Hook (`web_interface/frontend/src/hooks/useDroneTelemetry.ts`)
- **Purpose**: React hook for telemetry state management
- **Features**:
  - Automatic connection management
  - Error recovery and retry logic
  - Data caching
  - Update throttling
  - State monitoring utilities

## 🚀 Quick Start Guide

### 1. Build and Install Components

```bash
# Add DroneStatePublisher to your CMakeLists.txt
cd /home/rodrigo/ws_droneOS
echo 'add_executable(drone_state_publisher src/drone_core/drone_state_publisher.cpp)' >> src/drone_core/CMakeLists.txt
echo 'target_link_libraries(drone_state_publisher ${drone_core_LIBRARIES})' >> src/drone_core/CMakeLists.txt

# Build the workspace
colcon build --packages-select drone_core drone_interfaces

# Source the workspace
source install/setup.bash
```

### 2. Start Rosbridge Server

```bash
# Method 1: Using custom launch file
python3 rosbridge_launch.py

# Method 2: Using standard rosbridge (less secure)
ros2 run rosbridge_server rosbridge_websocket --port 9090
```

### 3. Start Drone State Publisher

```bash
# In your drone controller node, add:
# #include "drone_core/drone_state_publisher.hpp"
# 
# // In constructor:
# state_publisher_ = std::make_unique<drone_core::DroneStatePublisher>(this, "px4_1");
```

### 4. Frontend Integration

```typescript
// Import components
import { RealTimeStatusBar } from './components/RealTimeStatusBar';
import { useDroneTelemetry } from './hooks/useDroneTelemetry';

// In your main component
function App() {
  const [telemetryState, telemetryActions] = useDroneTelemetry({
    droneNamespace: 'px4_1',
    autoConnect: true
  });

  return (
    <div className="app">
      {/* Your existing content */}
      
      {/* Add status bar at bottom */}
      <RealTimeStatusBar 
        droneNamespace="px4_1" 
        className="fixed bottom-0 left-0 right-0"
        showDetailedStatus={true}
      />
    </div>
  );
}
```

## 🧪 Testing

### Run Complete Integration Test

```bash
# Test with mock data
python3 test_rosbridge_integration.py --drone-namespace px4_1 --test-duration 30

# Test with real drone data
python3 test_rosbridge_integration.py --skip-mock-publisher --drone-namespace px4_1
```

### Manual Testing Steps

1. **Start Services**:
   ```bash
   # Terminal 1: Rosbridge
   python3 rosbridge_launch.py
   
   # Terminal 2: Mock data (if needed)
   python3 test_rosbridge_integration.py --drone-namespace px4_1
   ```

2. **Frontend Test**:
   ```bash
   cd web_interface/frontend
   npm start
   ```

3. **WebSocket Test**:
   ```bash
   # Test connection
   curl -v -H "Connection: Upgrade" -H "Upgrade: websocket" \
        -H "Sec-WebSocket-Key: test" -H "Sec-WebSocket-Version: 13" \
        http://localhost:9090
   ```

## 📊 Data Flow

### Real-time Updates
```
PX4 Telemetry → DroneState → ROS Topic → Rosbridge → WebSocket → Frontend
    (50Hz)        (10Hz)      (10Hz)      (10Hz)     (10Hz)     (10Hz)
```

### On-demand Queries
```
Frontend → WebSocket → Rosbridge → GetState Service → DroneStatePublisher → Response
```

## 🔧 Configuration Options

### Rosbridge Server
- **Port**: Default 9090, configurable
- **Security**: Topic/service glob patterns
- **Performance**: Message throttling, compression
- **Reliability**: Ping/pong, auto-reconnect

### DroneStatePublisher
- **Update Rate**: 10Hz (configurable)
- **Health Scoring**: Weighted system status
- **Warning Thresholds**: Battery, GPS, communication
- **Data Sources**: Multiple PX4 topics

### Frontend Client
- **Reconnection**: Exponential backoff (max 10 attempts)
- **Throttling**: 50ms minimum between updates
- **Caching**: Optional state persistence
- **Error Recovery**: Automatic retry with user feedback

## 🛡️ Security Considerations

### Topic Access Control
```python
# Only allow specific drone topics
topics_glob = [
    '/px4_*/drone_state',
    '/px4_*/fmu/out/*',
    '/rosout'
]

# Only allow safe services
services_glob = [
    '/px4_*/get_state',
    '/rosapi/*'
]
```

### Network Security
- Use SSL/TLS in production
- Implement authentication if needed
- Restrict WebSocket origins
- Monitor connection attempts

## 🚨 Troubleshooting

### Common Issues

1. **"Connection refused"**
   - Check if rosbridge server is running
   - Verify port is not blocked by firewall
   - Ensure ROS2 workspace is sourced

2. **"No data received"**
   - Verify DroneStatePublisher is running
   - Check topic names match configuration
   - Confirm drone namespace is correct

3. **"High latency/dropped messages"**
   - Reduce update rates
   - Enable compression
   - Check network bandwidth

4. **"Authentication errors"**
   - Verify topic/service access patterns
   - Check rosbridge security configuration
   - Ensure proper permissions

### Debug Commands

```bash
# Check topics
ros2 topic list | grep drone_state
ros2 topic echo /px4_1/drone_state

# Check services
ros2 service list | grep get_state
ros2 service call /px4_1/get_state drone_interfaces/srv/GetState

# Monitor rosbridge
ros2 topic echo /rosout | grep rosbridge

# Test WebSocket
wscat -c ws://localhost:9090
```

## 📈 Performance Metrics

### Target Performance
- **Latency**: < 100ms end-to-end
- **Update Rate**: 10Hz continuous
- **Reliability**: > 99% message delivery
- **Memory**: < 50MB total overhead

### Monitoring
- Connection status in status bar
- Message timestamps for latency measurement
- Packet loss rate display
- Reconnection attempt tracking

## 🔄 Future Enhancements

### Planned Features
1. **Multi-drone Support**: Handle multiple drone namespaces
2. **Historical Data**: Store and display telemetry trends
3. **Alert System**: Customizable warning thresholds
4. **Data Export**: Save telemetry for analysis
5. **Mobile Support**: Responsive design for tablets/phones

### Integration Options
1. **Mission Planning**: Real-time status during waypoint missions
2. **Video Overlay**: Telemetry data on camera feed
3. **Map Integration**: Live position updates on map
4. **Voice Alerts**: Audio warnings for critical conditions

---

## 📝 Implementation Summary

✅ **Completed Components**:
- DroneStatePublisher (C++)
- Rosbridge configuration and launch
- WebSocket client library (TypeScript)
- Real-time status bar component (React)
- Telemetry management hooks
- Error handling and reconnection
- Integration test suite
- Documentation and examples

This implementation provides a robust, scalable foundation for real-time drone telemetry in your web interface. The modular design allows for easy extension and customization based on your specific requirements.