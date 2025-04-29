# DroneOS Workspace

DroneOS is a ROS 2 workspace designed for developing and operating autonomous drone systems using the **PX4 Autopilot**. It provides a core C++ SDK (`drone_core`), a Python-based CLI (`drone_gcs_cli`), and integrates essential third-party tools (`px4_msgs`, `Micro-XRCE-DDS-Agent`) for communication and control.

## 🎯 Purpose

- **Modular Drone Control**: Offer a reusable C++ library (`drone_core_lib`) for common drone control tasks (state tracking, command execution, offboard control).
- **PX4 Integration**: Seamlessly communicate with PX4 using standard ROS 2 messages (`px4_msgs`) via the Micro XRCE-DDS bridge.
- **Simplified Interaction**: Provide a command-line interface (`drone_gcs_cli`) for basic drone commands and monitoring.
- **Foundation for Autonomy**: Establish a base for building higher-level autonomous behaviors and multi-drone coordination.

## 📦 Core Components

### `drone_core` (C++, Proprietary)

The central package providing the core SDK library (`drone_core_lib`) and a ROS 2 node executable (`drone_core`) for controlling a single drone.
- **Features**: Layered architecture (State, Agent, Controller, Offboard), service-based command execution (takeoff, land, arm, etc.), PX4 state tracking, offboard mode management.
- **See**: `src/drone_core/README.md` for details.

### `drone_gcs_cli` (Python, Proprietary)

An interactive command-line tool for sending commands to `drone_core` nodes.
- **Features**: Target specific drones, send basic flight commands (arm, takeoff, land, mode changes), view status (TBD), uses ROS 2 services.
- **See**: `src/drone_gcs_cli/README.md` for details.

## 🔗 Third-Party Integrations

### `px4_msgs` (ROS 2 Package - Open Source)

Contains the standard ROS 2 message and service definitions required to communicate with the PX4 Autopilot flight stack.
- **Location**: `src/px4_msgs/`
- **Source**: Pulled from [PX4/px4_msgs](https://github.com/PX4/px4_msgs)
- **See**: `src/px4_msgs/README.md`

### `Micro-XRCE-DDS-Agent` (Application - Open Source)

Acts as a broker between the ROS 2 DDS network and the PX4 Autopilot (which typically runs an XRCE-DDS *Client*). This agent translates messages between the two domains.
- **Location**: `Micro-XRCE-DDS-Agent/` (Workspace Root)
- **Source**: Pulled from [eProsima/Micro-XRCE-DDS-Agent](https://github.com/eProsima/Micro-XRCE-DDS-Agent)
- **See**: `Micro-XRCE-DDS-Agent/README.md`

## 🚀 Getting Started

### Prerequisites
- **ROS 2**: Humble recommended (ensure `px4_msgs` branch matches).
- **PX4 Autopilot**: Running on target hardware or SITL, configured for ROS 2/XRCE-DDS communication.
- **Micro XRCE-DDS Agent**: Built or installed (see its README).
- **Build Tools**: `colcon`, `cmake` (>=3.5), C++14 compiler, Python 3.
- **Dependencies**: `libyaml-cpp-dev` (for `drone_core`).

### Building the Workspace

1.  **Clone**: Clone this repository.
2.  **Agent Setup**: Ensure the `Micro-XRCE-DDS-Agent` is built or available.
3.  **ROS Dependencies**: `sudo apt update && sudo apt install ros-${ROS_DISTRO}-px4-msgs libyaml-cpp-dev`
4.  **Source ROS 2**: `source /opt/ros/${ROS_DISTRO}/setup.bash`
5.  **Build Packages**: From the workspace root (`ws_droneOS/`):
    ```bash
    colcon build --symlink-install
    ```
6.  **Source Workspace**: `source install/setup.bash`

### Running

1.  **Start Micro XRCE-DDS Agent**: Run the agent, configuring the correct transport (e.g., UDP, serial) to connect to your PX4 instance.
    ```bash
    # Example using UDP
    MicroXRCEAgent udp4 -p 8888 
    ```
2.  **Launch Drone Core Node**: Start the `drone_core` node for each drone, providing parameters.
    ```bash
    # Example - Launch file TBD
    ros2 launch drone_core drone_os_launch.py drone_name:=drone1 px4_namespace:=px4_1 
    ```
3.  **Use GCS CLI (Optional)**:
    ```bash
    ros2 run drone_gcs_cli cli --default-drone drone1
    ```

## 🛠️ Workspace Structure

```
.
├── Micro-XRCE-DDS-Agent/  # DDS Agent (Open Source)
├── src/                    # ROS 2 Source Packages
│   ├── drone_core/         # Core SDK & Node (Proprietary)
│   ├── drone_gcs_cli/      # GCS Command Line Interface (Proprietary)
│   └── px4_msgs/           # PX4 Message Definitions (Open Source)
├── build/                  # Build artifacts
├── install/                # Installation space
├── log/                    # Runtime logs (from colcon)
├── docs/                   # Project documentation (if any)
├── Dockerfile              # Main Docker build definition
├── micro_agent.Dockerfile  # Dockerfile for agent (if used)
├── docker-compose.yml      # Docker compose setup (if used)
└── README.md               # This file
```

## 📚 Documentation

- **This File**: High-level overview.
- **`drone_core/README.md`**: Details on the core C++ SDK and node.
- **`drone_gcs_cli/README.md`**: Details on the Python CLI tool.
- **`src/px4_msgs/README.md`**: Information on the PX4 message package.
- **`Micro-XRCE-DDS-Agent/README.md`**: Information on the DDS Agent.
- **Source Code**: Header files in `drone_core/include/drone_core/` contain C++ API documentation.

## 📝 License

This workspace combines proprietary and open-source components:
- **Proprietary**: `drone_core`, `drone_gcs_cli`
- **Open Source**: `px4_msgs` (License info in its README), `Micro-XRCE-DDS-Agent` (License info in its README)

All rights reserved for proprietary components.

## 👥 Maintainer

- Rodrigo Ortega (ortegarod000@gmail.com) 