# DroneOS Command Center

Web-based command and control interface for DroneOS autonomous drone operations.

- to start backend: 'cd /home/rodrigo/ws_droneOS && export ROS_DISCOVERY_SERVER=127.0.0.1:11811 && source /opt/ros/humble/setup.bash && source install/setup.bash && cd web_interface && python3 backend/ros2_web_bridge.py'

## Architecture

- **Backend**: ROS2-Web Bridge (Python FastAPI + your existing GCSNode)
- **Frontend**: React TypeScript interface with real-time updates
- **Communication**: HTTP API + WebSocket for telemetry streaming

## Quick Start

### Prerequisites

1. **ROS2 Environment**: Make sure ROS2 is sourced
   ```bash
   source /opt/ros/humble/setup.bash
   source ~/ws_droneOS/install/setup.bash
   ```

2. **Node.js**: Install Node.js 16+ for frontend development

3. **Python**: Python 3.8+ with pip

### Running the System

1. **Start Backend** (Terminal 1):
   ```bash
   cd web_interface
   chmod +x start_backend.sh
   ./start_backend.sh
   ```

2. **Start Frontend** (Terminal 2):
   ```bash
   cd web_interface  
   chmod +x start_frontend.sh
   ./start_frontend.sh
   ```

3. **Access Interface**: Open http://localhost:3000 in your browser

## Features

### Manual Controls
- **Flight Commands**: Arm, disarm, takeoff, land, set offboard mode
- **Position Control**: Direct X, Y, Z, Yaw positioning in NED frame
- **Quick Commands**: Predefined altitude and position shortcuts

### AI Orchestrator Interface
- **Natural Language Commands**: "fly up 10 meters", "patrol 50 meter radius"
- **Quick Command Buttons**: Common operations with one click
- **Chat History**: Track command history and AI responses

### Real-time Status Display
- **Connection Status**: Live WebSocket connection indicator
- **Flight Status**: Armed state, flight mode, position
- **Visual Position**: 2D position indicator with compass
- **System Info**: Battery, timestamps, debug information

## API Endpoints

### Drone Control
- `POST /api/drone/arm` - Arm the drone
- `POST /api/drone/disarm` - Disarm the drone  
- `POST /api/drone/takeoff` - Command takeoff
- `POST /api/drone/land` - Command landing
- `POST /api/drone/set_offboard` - Set offboard mode
- `POST /api/drone/position` - Set target position

### AI Integration
- `POST /api/ai/command` - Send natural language command to AI orchestrator

### System Status
- `GET /api/status` - Get system and connection status
- `WebSocket /ws` - Real-time telemetry updates

## Development

### Backend Development
The backend extends your existing `GCSNode` class to also serve web requests:

```python
# Backend combines ROS2 + FastAPI in single process
class ROS2WebBridge(GCSNode):
    # Uses your existing service calls
    # Adds web endpoints and WebSocket broadcasting
```

### Frontend Development
React TypeScript interface with three main panels:

- **Left Panel**: Manual drone controls
- **Center Panel**: Real-time status and position visualization  
- **Right Panel**: AI chat interface

### Adding Features

1. **New Drone Commands**: Add to `GCSNode`, then expose via FastAPI endpoint
2. **AI Integration**: Extend `/api/ai/command` to communicate with your `run_basic_agent.py`
3. **Frontend Components**: Add to `src/components/` and integrate with main `App.tsx`

## Integration with Existing Systems

### GCS CLI Integration
Reuses your existing `src/drone_gcs_cli/gcs_node.py` - no code duplication.

### AI Agent Integration  
Ready to integrate with your `src/drone_agent_system/run_basic_agent.py` system.

### ROS2 Services
Uses the same ROS2 services as your CLI:
- `/drone1/arm`, `/drone1/disarm`, etc.
- Direct service calls, no subprocess overhead

## Deployment

For production deployment:

1. **Build Frontend**: `cd frontend && npm run build`
2. **Serve Static Files**: Backend can serve built frontend
3. **Single Process**: One Python process handles both ROS2 and web
4. **Police Networks**: Works on any network, just need browser access

## Next Steps

1. **AI Integration**: Connect `/api/ai/command` to your AI orchestrator
2. **Map Integration**: Add interactive map for click-to-go functionality
3. **Video Streaming**: Integrate camera feeds for ISR operations
4. **Multi-Drone**: Scale to manage multiple drones from single interface

## Troubleshooting

### Backend Issues
- **ROS2 not found**: Source ROS2 environment first
- **Service unavailable**: Check if drone_core is running
- **Port conflicts**: Change port in `ros2_web_bridge.py`

### Frontend Issues  
- **Dependencies**: Run `npm install` in frontend directory
- **API connection**: Check backend is running on port 8000
- **WebSocket errors**: Verify WebSocket endpoint accessibility

### Network Issues
- **CORS errors**: Backend allows all origins for development
- **Firewall**: Ensure ports 3000 (frontend) and 8000 (backend) are open