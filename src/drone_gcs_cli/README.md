# Package: `drone_gcs_cli`

**`drone_gcs_cli`** is a Python-based ROS 2 package within the **DroneOS** workspace providing an interactive command-line interface (CLI) for controlling and monitoring drones managed by `drone_core`.

## 📦 Package Structure

```
drone_gcs_cli/
├── drone_gcs_cli/
│   ├── __init__.py
│   ├── cli.py          # Main CLI interface and command parsing
│   └── gcs_node.py     # ROS 2 node implementation and service clients
├── test/               # Test files
├── resource/           # Resource files
├── setup.py           # Package setup configuration
├── setup.cfg          # Python package configuration
└── package.xml        # ROS 2 package manifest
```

## 🎯 Purpose

The Ground Control Station (GCS) CLI provides:

- **Interactive Control**: Terminal-based interface for drone control
- **Multi-Drone Support**: Switch between multiple drones seamlessly
- **Real-time Monitoring**: Display drone status and telemetry
- **Development Tools**: Facilitate testing and debugging of `drone_core`
- **Remote Operation**: Support for controlling drones over network/VPN

## 🏗️ Architecture

### Core Components

1. **`cli.py`**
   - Main executable script (`ros2 run drone_gcs_cli gcs`)
   - Handles command-line parsing and user interaction
   - Implements command loop and input processing
   - Manages ROS 2 node lifecycle
   - Features:
     - Interactive command prompt
     - Command history
     - Error handling
     - Graceful shutdown

2. **`gcs_node.py`**
   - Implements `GCSNode` class
   - Manages ROS 2 communication
   - Features:
     - Dynamic service client creation
     - Asynchronous service calls
     - Target drone switching
     - Status monitoring
     - Error handling and retries

### Communication Flow

1. **ROS 2 Discovery**
   - Uses DDS middleware for node discovery
   - Supports local network and VPN connections
   - Automatic service client creation

2. **Command Processing**
   ```
   User Input → CLI Parser → GCSNode → ROS 2 Service Call → drone_core → PX4
   ```

3. **Response Handling**
   - Asynchronous service call management
   - Timeout handling
   - Error reporting
   - Status updates

## ✨ Features & Commands

### Basic Commands
- `help` - Display available commands
- `exit` - Exit the CLI
- `target <drone_name>` - Switch target drone

### Flight Control
- `arm` - Arm the drone
- `disarm` - Disarm the drone
- `takeoff` - Command takeoff
- `land` - Command landing

### Mode Control
- `set_offboard` - Enter offboard mode
- `set_posctl` - Enter position control mode

### Position Control
- `pos <x> <y> <z> <yaw>` - Set target position/yaw
  - Coordinates in NED frame
  - Yaw in radians
  - Example: `pos 0.0 0.0 -5.0 0.0`

## 🚀 Getting Started

### Prerequisites
- ROS 2 installed
- `drone_core` package built
- Network connectivity to target drone

### Building
```bash
# From workspace root
colcon build --packages-select drone_gcs_cli
```

### Running

#### Native Installation
```bash
# Source the workspace
source install/setup.bash

# Run with default target (drone1)
ros2 run drone_gcs_cli drone_gcs_cli

# Run with specific target
ros2 run drone_gcs_cli drone_gcs_cli -d drone2
```

#### Docker
```bash
# Run in Docker container
docker compose -f docker-compose.gcs.yml run --rm -it gcs_cli \
    ros2 run drone_gcs_cli drone_gcs_cli -d drone1
```

### Usage Examples

1. **Basic Flight Sequence**
```bash
GCS (drone1)> arm
GCS (drone1)> set_offboard
GCS (drone1)> takeoff
GCS (drone1)> pos 0.0 0.0 -5.0 0.0
GCS (drone1)> land
GCS (drone1)> disarm
```

2. **Multi-Drone Control**
```bash
GCS (drone1)> target drone2
GCS (drone2)> arm
GCS (drone2)> set_offboard
```

## 🔧 Dependencies

- **ROS 2**: Core communication
- **rclpy**: Python ROS 2 client library
- **std_srvs**: Standard service definitions
- **drone_interfaces**: Custom service definitions

## 📚 Documentation

- **Source Code**: See `cli.py` and `gcs_node.py` for implementation details
- **API Reference**: Header files in `drone_core` package
- **Project Context**: Main workspace `README.md`

## 🔒 Security Notes

- **Network Security**: Use VPN (e.g., Tailscale) for remote operation
- **Authentication**: Implemented at ROS 2 DDS level
- **Command Validation**: All commands validated before execution

## 🤝 Contributing

This is a proprietary project. For contribution inquiries, please contact the maintainer.

## 📄 License

Proprietary - All rights reserved