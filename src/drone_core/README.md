# Package: `drone_core`

**`drone_core`** is the central, proprietary C++ ROS 2 package within the **DroneOS** workspace. It provides a modular SDK for commanding and monitoring PX4-compatible autonomous drones.

This package contains both the core control library (`drone_core_lib`) and a ROS 2 node executable (`drone_core`) that utilizes this library to control a single drone.

## ✈️ Features

- **Layered Control Architecture**: Separates state tracking (`DroneState`), low-level PX4 communication (`DroneAgent`, `OffboardControl`), and high-level control logic (`DroneController`).
- **State Management**: `DroneState` subscribes to PX4 topics (`VehicleStatus`, `VehicleLandDetected`, `VehicleGlobalPosition`, `VehicleLocalPosition`) to track navigation state, arming state, landing state, position fix, and latest telemetry (position, velocity).
- **Offboard Mode Handling**: `OffboardControl` manages the sequence for entering PX4 offboard mode and continuously publishes necessary setpoints (position or velocity).
- **Command Interface**: `DroneAgent` provides a simplified interface for sending specific `VehicleCommand`s to PX4.
- **High-Level Control**: `DroneController` orchestrates the components, manages an internal command queue, executes actions like arming, takeoff, landing, position/velocity control, and exposes these via ROS 2 services.
- **ROS 2 Node**: `DroneNode` (`drone_core` executable) wraps `DroneController`, handles parameter loading (`drone_name`, `px4_namespace`), and exposes core functionalities via ROS 2 services (currently uses `std_srvs/Trigger`).
- **Asynchronous Operations**: Uses callbacks and potentially separate threads (e.g., `DroneController::run`) for non-blocking operations.
- **PX4 Integration**: Leverages `px4_msgs` for communication and `std_srvs` for basic service definitions.

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
        - Reads ROS 2 parameters (`drone_name`, `px4_namespace`).
        - Instantiates and initializes a `DroneController`.
        - Creates ROS 2 service servers (e.g., `~/takeoff`, `~/land`) that trigger corresponding `DroneController` methods.
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

### Usage

1.  **Launch**: Launch the `drone_core` node, providing necessary parameters (e.g., via a launch file):
    ```bash
    # Example launch (actual launch file structure TBD)
    ros2 launch drone_core drone_os_launch.py drone_name:=my_drone px4_namespace:=/fmu # Fictional example
    # Or run directly (less common)
    # ros2 run drone_core drone_core --ros-args -p drone_name:=my_drone -p px4_namespace:=/fmu
    ```

2.  **Interact via Services**: Use ROS 2 tools to call the services exposed by the `DroneNode` (relative to the node's namespace, which depends on the launch file):
    ```bash
    # Example assuming node name 'my_drone_node' (adjust as needed)
    ros2 service call /my_drone_node/takeoff std_srvs/srv/Trigger {}
    ros2 service call /my_drone_node/land std_srvs/srv/Trigger {}
    # Other services (arm, disarm, set_offboard, set_position_mode) are likely implemented
    # directly within DroneController but might not be directly exposed by DroneNode yet.
    # Custom services for set_position/set_velocity are planned but not yet implemented.
    ```

3.  **Monitor Topics**: Observe PX4 topics directly or potentially custom status topics published by `DroneNode` (TBD) to monitor the drone's state.

## 📚 Documentation

- **API Documentation**: See header files in `include/drone_core/` for detailed class and function descriptions.
- **Examples**: The `src/main.cpp` file might serve as a basic usage example.
- **Overall Project**: Refer to the main `README.md` in the workspace root for the broader context.

## 🤝 Contributing

This is a proprietary project. For contribution inquiries, please contact the maintainer.

## 📄 License

Proprietary - All rights reserved
