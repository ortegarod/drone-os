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

Acts as a broker between the ROS 2 DDS network and the PX4 Autopilot (which typically runs an XRCE-DDS *Client*). The PX4 client connects to the agent (e.g., over Serial or UDP) and tells the agent which uORB topics it wants to publish and subscribe to. The agent then creates the corresponding ROS 2 publishers and subscribers on the DDS network, relaying data back and forth. It also handles ROS 2 service calls, forwarding requests to PX4 and returning acknowledgements.
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


### Deployment Scenarios (SITL/Real Drone)

The primary difference between deployment scenarios lies in how the Micro XRCE-DDS Agent connects to PX4 (and where PX4 is deployed):

-   **SITL (Software-In-The-Loop)**:
    - PX4 runs entirely in simulation on your computer
    - Communication: UDP over localhost/network
    - Components:
        - PX4 SITL instance(s) running using latest build instructions on PX4-Autopilot GitHub
        - Micro XRCE-DDS Agent using UDP for communication with PX4; serves as an "agent" to broadcast PX4 uORB as ROS2 topics 
        - QGroundControl (optional) connecting over UDP
    - Best for: Development, testing, and simulations

-   **Real Drone**:
    - PX4 runs on the actual flight controller (e.g., Pixhawk 6C)
    - Communication between PX4 and Micro XRCE-DDS Agent:
        - **Direct Serial/USB**:
            - Companion computer (RPi 5, Jetson) directly connected to Pixhawk via TELEM2 port on Pixhawk and USB on Pi
    - Communication between PX4 and QGroundControl:
        - **Telemetry Radio**:
            - 915MHz Telemetry Radio on ground computer
            - 915MHz Telemetry Radio on Pixhawk
            - QGroundControl can connect directly to monitor status
            - Optional: Additional radio on companion computer (limited bandwidth) for sending commands instead of through Tailscale VPN and ROS2
    - Best for: Real-world deployment and testing

> **Note on HITL (Hardware-In-The-Loop)**: This setup involves running PX4 on real hardware while using simulated sensors. While theoretically possible using Serial/USB or UDP connections, this configuration is still under development and not fully documented.

The specific agent command and PX4 parameters (e.g., `XRCE_DDS_CFG`, baud rates) need to be adjusted based on the chosen setup.

### Remote Communication (e.g., over 4G/WAN)

#### Local Network Communication Flow

By default, `drone_gcs_cli` and `drone_core` assume they are running on the same local network (e.g., same Wi-Fi). Communication works as follows:
1.  **ROS 2 Discovery**: When both nodes start, ROS 2 middleware (DDS) uses multicast discovery protocols to find other ROS 2 nodes on the local network.
2.  **Service Calls**: `drone_gcs_cli` creates ROS 2 *clients* for the services advertised by the target `drone_core` node (e.g., `/drone1/arm`, `/drone1/set_position`). When you issue a command in the CLI:
    -   The client sends a request message over the network directly to the corresponding *service server* within the `drone_core` node.
3.  **Drone Core Execution**: The `drone_core` node receives the request, executes the associated logic (e.g., arming checks, setting offboard points), potentially interacts with PX4 via the Micro XRCE-DDS Agent, and sends back a response.
4.  **GCS Response**: The `drone_gcs_cli` client receives the response and displays the result.

This standard ROS 2 communication relies heavily on the ability of nodes to discover each other and directly route traffic within the local network.

#### Enabling Remote Communication via VPN

Standard ROS 2 discovery and direct communication often fail across the public internet or cellular networks due to NAT, firewalls, and the lack of multicast support.

**The recommended approach is to use a VPN (Virtual Private Network), specifically [Tailscale](https://tailscale.com/).**
-   **How it Works**: Tailscale creates a secure, encrypted peer-to-peer mesh network over the public internet (like 4G). You install the Tailscale client on the drone's onboard computer (RPi 5) and the GCS machine, authenticate them to your private network ("tailnet"), and they are assigned stable virtual IP addresses.
-   **Benefit (Application Transparency)**: To ROS 2, the GCS and the drone now appear to be on the same local network via their Tailscale IP addresses. **Crucially, this means no code changes are needed in `drone_core` or `drone_gcs_cli`.** The ROS 2 nodes don't need to know *how* the connection is made; they simply use standard networking (DDS discovery, service calls, topics) over the virtual network interface provided by Tailscale, just as described in the *Local Network Communication Flow* section. Tailscale handles the underlying secure tunneling and NAT traversal automatically.
-   **Setup**: Install and configure the Tailscale client on both the drone's computer and the GCS machine following Tailscale documentation. No central VPN server setup is typically required.
-   **Integration with Docker**: When running `drone_core` (or other components) in Docker containers on the drone, Tailscale should be installed and run on the **host OS (e.g., the Raspberry Pi 5)**, *not* within the container. To allow the containerized ROS 2 nodes to use the host's Tailscale connection, launch the container with **host networking** enabled (e.g., `docker run --network=host ...` or equivalent in Docker Compose).


### Example: Running a Multi-Drone Simulation (2 Drones)

This outlines the steps to run a simulation with two drones (drone1 and drone2) controlled by separate `drone_core` instances using Docker containers.

1.  **Start PX4 SITL Instances**: Open two separate terminals. Navigate to your PX4-Autopilot directory in each.

    > **Prerequisite**: Before running SITL, ensure you have PX4-Autopilot installed following the [official PX4 installation guide](https://docs.px4.io/main/en/dev_setup/dev_env_linux_ubuntu.html). For Ubuntu users, make sure to run the `ubuntu.sh` script from the PX4-Autopilot repository to install all required Gazebo simulation tools and dependencies.

    *   **Terminal 1 (Drone 1):** Start PX4 instance 0 (`MAV_SYS_ID=1`). It will use the default namespace `/fmu/`.
        ```bash
        cd PX4-Autopilot
        HEADLESS=1 make px4_sitl gz_x500    
        ```
    *   **Terminal 2 (Drone 2):** Start PX4 instance 1 (`MAV_SYS_ID=2`). It will use namespace `/px4_1/fmu/`. Add `PX4_GZ_MODEL_POSE` to spawn it at a different location.
        ```bash
        cd PX4-Autopilot
        HEADLESS=1 PX4_SYS_AUTOSTART=4001 PX4_GZ_MODEL_POSE="0,1" PX4_SIM_MODEL=gz_x500 MAV_SYS_ID=2 ./build/px4_sitl_default/bin/px4 -i 1
        ```
    *   **(Optional) Headless & QGroundControl:** You can run SITL without the Gazebo GUI by prepending `HEADLESS=1` to the PX4 launch commands above. You can connect QGroundControl (typically listening on UDP port 14550 by default for the first instance) to monitor status and view the drones on the map.

    > **Note on SITL Instance Identity:**
    > *   The `make px4_sitl gz_x500` command (used for Drone 1) implicitly launches **instance 0** (`-i 0` is the default) and typically uses the default **`MAV_SYS_ID=1`**. Consequently, it uses the default UXRCE-DDS namespace `/fmu/`.
    > *   The direct execution command `./build/.../px4 -i 1` (used for Drone 2) explicitly sets the **instance ID** via `-i 1`. We also explicitly set the **`MAV_SYS_ID=2`** using an environment variable. Based on these, this SITL instance uses the UXRCE-DDS namespace `/px4_1/fmu/` when connecting to the agent. This differentiation is crucial for multi-drone control.

    > **Note**: MAV_SYS_ID can be updated via PX4 parameters using QGroundControl.

2.  **Launch Drone Core and Micro Agent Services**: In the DroneOS workspace, use Docker Compose to start the services. See `docker-compose.dev.yml` for detailed configuration options and notes about multi-drone setup.

    For the first drone (drone1), use the default development compose file:
    ```bash
    cd ws_droneOS
    docker compose -f docker-compose.dev.yml up -d
    ```

    For the second drone (drone2), create a copy of the development compose file and update its configuration:
    ```bash
    # Copy the development compose file
    cp docker-compose.dev.yml docker-compose.dev.drone2.yml

    # Edit docker-compose.dev.drone2.yml to update the command section:
    # - Change __node to drone2
    # - Change drone_name to drone2
    # - Change px4_namespace to /px4_1/fmu/
    # - Change mav_sys_id to 2

    # Launch the second drone
    docker compose -f docker-compose.dev.drone2.yml up -d
    ```

    > **Note**: Each drone needs its own PX4 SITL instance running with a unique MAVLink System ID. Make sure to start the PX4 SITL instances with different IDs (e.g., `make px4_sitl gz_x500 MAV_SYS_ID=2` for drone2).

3.  **Use GCS CLI**: Open a terminal and run the GCS CLI through Docker:
    ```bash
    docker compose -f docker-compose.gcs.yml run --rm -it gcs_cli ros2 run drone_gcs_cli drone_gcs_cli -d drone1
    ```
    *   The CLI defaults to targeting 'drone1'. Use the `target drone2` command to switch to the second drone.
    *   Send commands (e.g., `set_offboard`, `arm`, `pos 0 0 -5 0`, `land`). Only the targeted drone should react.
    *   To exit the GCS CLI and stop the container, press `CTRL+C`.

    > **Note**: The GCS CLI container is configured to use host networking mode to ensure proper ROS 2 DDS communication with the drone nodes. It also mounts a `logs` directory for persistent logging.

4.  **Cleanup**: When done, stop all services:
    ```bash
    docker compose -f docker-compose.dev.yml down
    docker compose -f docker-compose.dev.drone2.yml down
    ```
    Then stop the PX4 SITL instances in their respective terminals with `CTRL+C`.

### Example: Running on a Real Drone (Raspberry Pi)

This outlines the steps to run DroneOS on a real drone with a Raspberry Pi companion computer.

1.  **Prerequisites**:
    - Raspberry Pi (5 recommended) with Ubuntu Server installed
    - PX4 flight controller (e.g., Pixhawk 6C) connected to the RPi via Serial/USB
    - Tailscale installed on the RPi for remote access
    - udev rule for stable device naming (create `/etc/udev/rules.d/99-pixhawk.rules`):
      ```
      SUBSYSTEM=="tty", ATTRS{idVendor}=="26ac", ATTRS{idProduct}=="0011", SYMLINK+="pixhawk-telem2"
      ```
    - Ensure the RPi user has permission to access the serial device: `sudo usermod -a -G dialout $USER` and reboot

2.  **Setup DroneOS on RPi**:
    ```bash
    # Clone the repository
    git clone <repository-url> ws_droneOS
    cd ws_droneOS

    # Create logs directory
    mkdir logs
    ```

3.  **Launch Services**:
    ```bash
    # The docker-compose.yml file is already configured for a single real drone
    docker compose up -d
    ```

4.  **Use GCS CLI**: From your ground control station computer with Tailscale installed:
    ```bash
    docker compose -f docker-compose.gcs.yml run --rm -it gcs_cli ros2 run drone_gcs_cli drone_gcs_cli -d drone1
    ```

> **Important Notes**:
> - The `docker-compose.yml` file is already configured for a single real drone with:
>   - Serial communication to PX4
>   - Host networking for Tailscale/ROS2 communication
>   - Default configuration for drone1
> - For additional real drones, copy `docker-compose.yml` to a new file (e.g., `docker-compose.drone2.yml`) and update the drone configuration in the command section

## 🛠️ Workspace Structure

```
.
├── Micro-XRCE-DDS-Agent/   # DDS Agent (Open Source)
├── src/                    # ROS 2 Source Packages
│   ├── drone_core/         # Core SDK & Node (Proprietary)
│   ├── drone_gcs_cli/      # GCS Command Line Interface (Proprietary)
│   └── px4_msgs/           # PX4 Message Definitions (Open Source)
├── build/                  # Build artifacts
├── install/                # Installation space
├── log/                    # Runtime logs (from colcon)
├── logs/                   # Application logs directory
├── drone_core.Dockerfile   # Dockerfile for drone_core service
├── micro_agent.Dockerfile  # Dockerfile for Micro XRCE-DDS Agent
├── drone_gcs_cli.Dockerfile # Dockerfile for GCS CLI
├── docker-compose.yml      # Docker compose for real drone deployment
├── docker-compose.dev.yml  # Docker compose for SITL development
├── docker-compose.gcs.yml  # Docker compose for GCS CLI
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