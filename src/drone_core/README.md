# Package: `drone_core`

**`drone_core`** is the main C++ ROS 2 package within the **DroneOS** workspace. It provides a modular SDK for commanding and monitoring PX4-compatible autonomous drones.

## 📦 Package Structure

The package is organized into two main components:

1. **`drone_core_lib`**: A shared C++ library providing core drone control functionality
2. **`drone_core`**: A ROS 2 node executable that utilizes the library

### Source Code Organization

```
drone_core/
├── include/drone_core/
│   ├── drone_agent.hpp      # PX4 command interface
│   ├── drone_controller.hpp # High-level control logic
│   ├── drone_node.hpp       # ROS 2 node implementation
│   ├── drone_state.hpp      # State tracking
│   ├── offboard_control.hpp # Offboard mode management
│   └── utils/
│       └── state_enums.hpp  # Shared state enumerations
├── src/
│   ├── drone_core/          # Implementation files
│   ├── main.cpp            # Node entry point
│   └── utils/              # Utility implementations
├── CMakeLists.txt
└── package.xml
```

## 🏗️ Architecture

### Core Components

1. **`DroneState`** (`drone_state.hpp`)
   - Tracks drone state through PX4 topic subscriptions
   - Monitors: navigation state, arming state, landing state, position fix
   - Provides state query methods and state change notifications
   - Subscribes to:
     - `VehicleStatus`
     - `VehicleLandDetected`
     - `VehicleGlobalPosition`
     - `VehicleLocalPosition`

2. **`DroneAgent`** (`drone_agent.hpp`)
   - Handles PX4 command communication
   - Manages MAVLink system ID targeting
   - Provides methods for sending specific `VehicleCommand`s
   - Ensures commands are routed to the correct PX4 instance

3. **`OffboardControl`** (`offboard_control.hpp`)
   - Manages offboard mode state machine
   - Handles setpoint publishing for position/velocity control
   - Ensures safe initialization to current pose
   - Publishes:
     - `OffboardControlMode`
     - `TrajectorySetpoint`

4. **`DroneController`** (`drone_controller.hpp`)
   - Orchestrates all components
   - Implements high-level control logic
   - Provides ROS 2 service interfaces
   - Manages command execution and state transitions
   - Exposes methods for:
     - Basic commands (arm, disarm, takeoff, land)
     - Mode changes (offboard, position, altitude)
     - Position/velocity control
     - State queries

5. **`DroneNode`** (`drone_node.hpp`)
   - ROS 2 node implementation
   - Handles parameter loading
   - Creates and manages service servers
   - Initializes and runs the controller

## 🚀 Features

### Multi-Vehicle Support
- **ROS 2 Namespacing**: Commands are routed using `px4_namespace` parameter
- **MAVLink Targeting**: Uses `mav_sys_id` for precise vehicle targeting
- **Isolated Control**: Each drone instance operates independently

### Control Capabilities
- **Basic Operations**:
  - Arm/Disarm
  - Takeoff/Land
  - Mode switching (Position, Altitude, Offboard)
- **Position Control**:
  - Set absolute position and yaw
  - Set velocity and yaw rate
  - Synchronous and asynchronous commands
- **State Management**:
  - Real-time state tracking
  - State change notifications
  - Safety checks and validations

### ROS 2 Integration
- **Service-Based Interface**:
  - `/drone_name/arm`
  - `/drone_name/disarm`
  - `/drone_name/takeoff`
  - `/drone_name/land`
  - `/drone_name/set_offboard`
  - `/drone_name/set_position_mode`
  - `/drone_name/set_position`
- **Parameter Configuration**:
  - `drone_name`: Unique identifier
  - `px4_namespace`: PX4 communication namespace
  - `mav_sys_id`: MAVLink system ID

## 💻 Usage

### Building
```bash
# From workspace root
colcon build --packages-select drone_core
```

### Running
```bash
# Basic usage
ros2 run drone_core drone_core --ros-args \
    -r __node:=drone1 \
    -p drone_name:=drone1 \
    -p px4_namespace:=/fmu/ \
    -p mav_sys_id:=1

# Multi-drone setup
ros2 run drone_core drone_core --ros-args \
    -r __node:=drone2 \
    -p drone_name:=drone2 \
    -p px4_namespace:=/px4_1/fmu/ \
    -p mav_sys_id:=2
```

### Service Calls
```bash
# Basic commands
ros2 service call /drone1/arm std_srvs/srv/Trigger {}
ros2 service call /drone1/disarm std_srvs/srv/Trigger {}
ros2 service call /drone1/takeoff std_srvs/srv/Trigger {}
ros2 service call /drone1/land std_srvs/srv/Trigger {}

# Mode changes
ros2 service call /drone1/set_offboard std_srvs/srv/Trigger {}
ros2 service call /drone1/set_position_mode std_srvs/srv/Trigger {}

# Position control
ros2 service call /drone1/set_position drone_interfaces/srv/SetPosition "{x: 0.0, y: 0.0, z: -5.0, yaw: 0.0}"
```

### Monitoring
```bash
# View drone status
ros2 topic echo /px4_1/fmu/out/vehicle_status

# Monitor position
ros2 topic echo /px4_1/fmu/out/vehicle_local_position
```

## 🔧 Dependencies

- **ROS 2**: Core communication and node management
- **px4_msgs**: PX4 message definitions
- **std_srvs**: Standard service definitions
- **drone_interfaces**: Custom service definitions
- **yaml-cpp**: Configuration parsing

## 📚 API Documentation

Detailed API documentation is available in the header files:
- `include/drone_core/drone_controller.hpp`: Main control interface
- `include/drone_core/drone_state.hpp`: State management
- `include/drone_core/offboard_control.hpp`: Offboard control
- `include/drone_core/drone_agent.hpp`: PX4 communication
- `include/drone_core/utils/state_enums.hpp`: State definitions

## 🤝 Contributing

This is a proprietary project. For contribution inquiries, please contact the maintainer.

## 📄 License

Proprietary - All rights reserved
