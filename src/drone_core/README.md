# Package: `drone_core`

**`drone_core`** is the main C++ ROS 2 package within the **DroneOS** workspace. It provides a modular SDK for commanding and monitoring PX4-compatible autonomous drones.

This package contains both the core library (`drone_core_lib`) and a ROS 2 node executable (`drone_core`) that utilizes this library to control a single drone within a potentially multi-drone environment.

## ✈️ Features

- **Layered Control Architecture**: Separates state tracking (`DroneState`), low-level PX4 communication (`DroneAgent`, `OffboardControl`), and high-level control logic (`DroneController`).
- **Multi-Vehicle Targeting**: Reliably controls specific drones in a multi-drone setup using:
    - **ROS 2 Namespaces:** The `px4_namespace` parameter ensures commands are routed to the intended drone's communication interface (e.g., `/px4_1/fmu/vehicle_command`).
    - **MAVLink System ID:** The `mav_sys_id` parameter ensures commands contain the correct internal ID that PX4 checks, preventing accidental control of the wrong vehicle.
- **State Management**: `DroneState` subscribes to PX4 topics (`VehicleStatus`, `VehicleLandDetected`, `VehicleGlobalPosition`, `VehicleLocalPosition`) to track navigation state, arming state, landing state, position fix, and latest telemetry (position, velocity).
- **Offboard Mode Handling**: `OffboardControl` manages the sequence for entering PX4 offboard mode and continuously publishes necessary setpoints (position or velocity), initializing safely to the drone's current pose.
- **Command Interface**: `DroneAgent` provides a simplified interface for sending specific `VehicleCommand`s to the correctly targeted PX4.
- **High-Level Control**: `DroneController` orchestrates the components, manages an internal command queue, executes actions like arming, takeoff, landing, position/velocity control, and exposes these via ROS 2 services.
- **ROS 2 Node**: `DroneNode` (`drone_core` executable) wraps `DroneController`, handles parameter loading (`drone_name`, `px4_namespace`, `mav_sys_id`), and spins the node.
- **Service-Based Control**: Exposes functionalities via ROS 2 services namespaced by `drone_name`:
    - Basic commands: `arm`, `disarm`, `takeoff`, `land`
    - Mode changes: `set_offboard`, `set_position_mode`
    - Position control: `set_position` (custom `drone_interfaces/SetPosition`)
- **Asynchronous Operations**: Uses callbacks and separate threads for non-blocking operations.
- **PX4 Integration**: Leverages `px4_msgs` for communication and `std_srvs`/`drone_interfaces` for service definitions.

## 🏗️ Architecture

The package is structured as follows:

- **`drone_core_lib` (Shared Library)**:
    - **`DroneState`**: Subscribes to PX4 topics and maintains the drone's current state.
    - **`DroneAgent`**: Sends specific `VehicleCommand` requests to PX4.
    - **`OffboardControl`**: Manages the offboard mode state machine and publishes `OffboardControlMode` and `TrajectorySetpoint` messages.
    - **`DroneController`**: Integrates `DroneState`, `DroneAgent`, and `OffboardControl`. Implements high-level logic (takeoff, land, setpoint control), manages internal state/commands, and defines service callbacks.
    - **`utils/state_enums`**: Defines shared enumerations for navigation, arming, landing, etc.
- **`drone_core` (Executable)**:
    - **`DroneNode`**: A `rclcpp::Node` subclass that:
        - Reads ROS 2 parameters (`drone_name`, `px4_namespace`, `mav_sys_id`).
        - Instantiates and initializes a `DroneController`.
        - Creates ROS 2 service servers (e.g., `/drone_name/takeoff`, `/drone_name/set_position`) that trigger corresponding `DroneController` methods.
    - **`main.cpp`**: Entry point that initializes ROS 2, creates, initializes, and spins the `DroneNode`.

## 🚀 Getting Started

### Requirements

- ROS 2 Humble or newer
- PX4 Autopilot + `px4_msgs`
- `yaml-cpp` and standard ROS 2 build tools
- C++14 compatible compiler

### Dependencies

```bash
# Install ROS 2 dependencies
sudo apt install ros-${ROS_DISTRO}-px4-msgs
sudo apt install libyaml-cpp-dev
```

### Build

```bash
cd ~/ws_droneOS
colcon build --packages-select drone_core
source install/setup.bash
```

### Docker

The package can be run using Docker for consistent development and deployment environments:

```bash
# Development (SITL)
docker compose -f docker-compose.dev.yml up -d

# Raspberry Pi 5 Companion Computer (Real Drone)
docker compose up -d

# View logs
docker logs -f drone_core_node

# Stop services
docker compose -f docker-compose.dev.yml down
```

**Note**: When making code changes, use the `--build` flag to ensure the latest code is included:
```bash
docker compose -f docker-compose.dev.yml up -d --build
```

### Usage

1.  **Launch**: Launch the `drone_core` node using `ros2 run`, providing necessary parameters. Use the `--ros-args -r __node:=<node_name>` argument to set a unique node name matching your `drone_name`.
    ```bash
    # Example for Drone 1 (MAV_SYS_ID=1, default namespace)
    ros2 run drone_core drone_core --ros-args \
        -r __node:=drone1 \
        -p drone_name:=drone1 \
        -p px4_namespace:=/fmu/ \
        -p mav_sys_id:=1

    # Example for Drone 2 (MAV_SYS_ID=2, namespaced)
    ros2 run drone_core drone_core --ros-args \
        -r __node:=drone2 \
        -p drone_name:=drone2 \
        -p px4_namespace:=/px4_1/fmu/ \
        -p mav_sys_id:=2
    ```

2.  **Interact via Services**: Use ROS 2 tools or the `drone_gcs_cli` package to call the services exposed under the drone's name:
    ```bash
    # Example assuming node/drone name is 'drone1'
    ros2 service call /drone1/arm std_srvs/srv/Trigger {}
    ros2 service call /drone1/takeoff std_srvs/srv/Trigger {}
    ros2 service call /drone1/land std_srvs/srv/Trigger {}
    ros2 service call /drone1/set_offboard std_srvs/srv/Trigger {}
    ros2 service call /drone1/set_position drone_interfaces/srv/SetPosition "{x: 0.0, y: 0.0, z: -5.0, yaw: 0.0}"
    ```

3.  **Monitor Topics**: Observe PX4 topics directly (e.g., `/px4_X/fmu/out/vehicle_status`) or potentially custom status topics published by `DroneNode` (TBD) to monitor the drone's state.

## 📚 Documentation

- **API Documentation**: See header files in `include/drone_core/` for detailed class and function descriptions.
- **Overall Project**: Refer to the main `README.md` in the workspace root for the broader context.

## 🤝 Contributing

This is a proprietary project. For contribution inquiries, please contact the maintainer.

## 📄 License

Proprietary - All rights reserved
