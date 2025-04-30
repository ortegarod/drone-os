# DroneOS Workspace

DroneOS is a ROS 2 workspace designed for developing and operating autonomous drone systems using the **PX4 Autopilot**. It provides a core C++ SDK (`drone_core`), a Python-based CLI (`drone_gcs_cli`), and integrates essential third-party tools (`px4_msgs`, `Micro-XRCE-DDS-Agent`) for communication and control, **with support for multi-vehicle scenarios.**

## 🎯 Purpose

- **Modular Drone Control**: Offer a reusable C++ library (`drone_core_lib`) for common drone control tasks (state tracking, command execution, offboard control).
- **PX4 Integration**: Seamlessly communicate with PX4 using standard ROS 2 messages (`px4_msgs`) via the Micro XRCE-DDS bridge, **correctly handling ROS 2 namespaces and MAVLink System IDs for multi-drone targeting.**
- **Simplified Interaction**: Provide a command-line interface (`drone_gcs_cli`) for basic drone commands and monitoring, **allowing targeting of specific drones in a multi-vehicle setup.**
- **Foundation for Autonomy**: Establish a base for building higher-level autonomous behaviors and multi-drone coordination.

## 📦 Core Components

### `drone_core` (C++, Proprietary)

The central package providing the core SDK library (`drone_core_lib`) and a ROS 2 node executable (`drone_core`) for controlling a single drone **within a potentially multi-drone environment**.
- **Features**: Layered architecture (State, Agent, Controller, Offboard), service-based command execution (takeoff, land, arm, set_position, etc.), PX4 state tracking, offboard mode management, **parameterized MAVLink System ID targeting and ROS 2 namespacing for multi-vehicle compatibility.**
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

### Example: Running a Multi-Drone Simulation (2 Drones)

This outlines the steps to run a simulation with two drones (drone1 and drone2) controlled by separate `drone_core` instances.

1.  **Build & Source**: Ensure the workspace is built and sourced:
    ```bash
    cd ws_droneOS
    colcon build --symlink-install
    source install/setup.bash
    ```

2.  **Start PX4 SITL Instances**: Open two separate terminals. Navigate to your PX4-Autopilot directory in each.
    *   **Terminal 1 (Drone 1):** Start PX4 instance 0 (`MAV_SYS_ID=1`). It will use the default namespace `/fmu/`.
        ```bash
        cd PX4-Autopilot
        HEADLESS=1 PX4_SYS_AUTOSTART=4001 PX4_SIM_MODEL=gz_x500 ./build/px4_sitl_default/bin/px4 -i 0
        ```
        *(Note: The model `gz_x500` is an example, use your desired model)*
    *   **Terminal 2 (Drone 2):** Start PX4 instance 1 (`MAV_SYS_ID=2`). It will use namespace `/px4_1/fmu/`. Add `PX4_GZ_MODEL_POSE` to spawn it at a different location.
        ```bash
        cd PX4-Autopilot
        HEADLESS=1 PX4_SYS_AUTOSTART=4001 PX4_GZ_MODEL_POSE="0,1" PX4_SIM_MODEL=gz_x500 ./build/px4_sitl_default/bin/px4 -i 1
        ```
    *   **(Optional) Headless & QGroundControl:** You can run SITL without the Gazebo GUI by prepending `HEADLESS=1` to the PX4 launch commands above. You can connect QGroundControl (typically listening on UDP port 14550 by default for the first instance) to monitor status and view the drones on the map.

3.  **Start Micro XRCE-DDS Agent**: Open a new terminal and run the agent (using UDP in this example).
    ```bash
    MicroXRCEAgent udp4 -p 8888
    ```
    *The agent should detect connections from both PX4 instances.* 

4.  **Launch Drone Core Nodes**: Open two more terminals. Source the workspace in each.
    *   **Terminal 4 (Drone 1 Controller):** Launch `drone_core` targeting `MAV_SYS_ID=1` and using the default namespace.
        ```bash
        cd ws_droneOS
        source install/setup.bash
        ros2 run drone_os drone_core --ros-args \
            -r __node:=drone1 \
            -p drone_name:=drone1 \
            -p px4_namespace:=/fmu/ \
            -p mav_sys_id:=1
        ```
    *   **Terminal 5 (Drone 2 Controller):** Launch `drone_core` targeting `MAV_SYS_ID=2` and using the `/px4_1/fmu/` namespace.
        ```bash
        cd ws_droneOS
        source install/setup.bash
        ros2 run drone_os drone_core --ros-args \
            -r __node:=drone2 \
            -p drone_name:=drone2 \
            -p px4_namespace:=/px4_1/fmu/ \
            -p mav_sys_id:=2 
        ```

5.  **Use GCS CLI**: Open a final terminal. Source the workspace.
    ```bash
    cd ws_droneOS
    source install/setup.bash
    ros2 run drone_gcs_cli gcs
    ```
    *   Use `target drone1` or `target drone2` to switch focus.
    *   Send commands (e.g., `set_offboard`, `arm`, `pos 0 0 -5 0`, `land`). Only the targeted drone should react.

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