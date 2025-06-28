# Ground Station Setup

This directory contains the ground station setup that provides a centralized web interface for controlling multiple drones via rosbridge.

## Architecture

```
Web Frontend (React + roslibjs)
    ↕ WebSocket (port 3000 → 9090)
Ground Station
├── rosbridge_server (port 9090) - WebSocket/JSON bridge to ROS2
├── rosapi_node - ROS2 network meta-information
└── web_interface (port 3000) - React frontend
    ↕ ROS2 DDS Network (via Tailscale/LAN)
Drone Fleet
├── Drone1 → drone_core (/drone1/* services)
├── Drone2 → drone_core (/drone2/* services)
└── Drone3 → drone_core (/drone3/* services)
```

## Usage

### 1. Start Ground Station Services

```bash
cd /home/rodrigo/ws_droneOS/docker/ground_station
docker compose -f docker-compose.ground.yml up -d
```

### 2. Access Web Interface

- **Frontend**: http://localhost:3000
- **rosbridge WebSocket**: ws://localhost:9090

### 3. Connect Drones

Ensure your drones are running on the same ROS2 network:

```bash
# On each drone (or development machine)
cd ws_droneOS
docker compose -f docker/dev/docker-compose.dev.yml up -d drone_core micro_agent
```

## Services

### rosbridge_server
- **Port**: 9090 (WebSocket)
- **Protocol**: rosbridge v2.0 JSON over WebSocket
- **Purpose**: Translates web requests to ROS2 service calls/topic subscriptions
- **Auto-discovers**: All drone services (/drone1/arm, /drone2/takeoff, etc.)

### rosapi_node  
- **Purpose**: Provides ROS2 network introspection services
- **Services**: /rosapi/topics, /rosapi/services, /rosapi/nodes, etc.
- **Used by**: rosbridge for network discovery

### web_interface
- **Port**: 3000 (HTTP)
- **Technology**: React + roslibjs
- **Purpose**: User interface for drone control and monitoring

## Network Requirements

- **Same ROS2 Domain**: All services must use `ROS_DOMAIN_ID=0`
- **Network Connectivity**: LAN or VPN (Tailscale recommended for WAN)
- **DDS Discovery**: Multicast or static peer configuration via fastdds_config.xml

## Benefits

1. **Centralized Control**: One web interface for all drones
2. **Scalable**: Add more drones without additional rosbridge instances  
3. **Standard Protocol**: Uses industry-standard rosbridge
4. **Real-time**: WebSocket connection for live telemetry
5. **Zero Drone Changes**: Works with existing drone_core services

## Development

To modify the web interface:

```bash
cd web_interface/frontend
npm install
npm start  # Development server on port 3001
```

The production build is served by the web_interface container on port 3000.