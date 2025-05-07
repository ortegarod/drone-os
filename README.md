# DroneOS

DroneOS is a modular framework for autonomous drone control, built on ROS 2 and PX4 Autopilot. It includes:

- **Drone Core SDK**: A C++ library for drone state tracking, command execution, and offboard control
- **PX4 Integration**: Seamless communication with PX4 flight controllers via Micro XRCE-DDS
- **CLI Control**: A command-line interface for managing individual drones and fleets (GUI coming soon; use QGroundControl for live telemetry)
- **Multi-Drone Architecture**: Native support for simultaneous control of multiple drones, with swarm intelligence in active development

##  Core Components

### `drone_core` (C++)


The package is structured in two main parts:

1. **`drone_core_lib`**: A shared C++ library that provides the core drone control functionality:


2. **`drone_core` Node**: A ROS 2 node that uses `drone_core_lib` to expose drone control capabilities as ROS 2 services:


For detailed implementation specifications, API documentation, and usage guidelines, refer to `src/drone_core/README.md`.

### `drone_gcs_cli` (Python, Proprietary)

A command-line interface for controlling drones managed by `drone_core`. It supports both SITL and real drone deployments, with multi-drone targeting and remote control capabilities.

For detailed usage, commands, and architecture, see `src/drone_gcs_cli/README.md`.

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

1. **Install Docker and Docker Compose**:
   Follow the official Docker installation guide at https://docs.docker.com/engine/install/ to install Docker Engine and Docker Compose plugin for your operating system.

2. **Install PX4 Autopilot**:
   Follow the official PX4 installation guide at https://docs.px4.io/main/en/dev_setup/dev_env.html to install PX4 and its dependencies for your operating system.

### Setting up Development Environment

This outlines the steps to run a DroneOS SDK development environment using PX4 Autopilot and Gazebo simulator.


1. **Clone DroneOS Repository**:
   ```bash
   git clone https://github.com/ortegarod/ws_droneOS.git ws_droneOS
   cd ws_droneOS
   ```

2. **Start PX4 SITL Instances**:
   Open two separate terminals. Navigate to your PX4-Autopilot directory in each.

   > **Prerequisite**: Before running SITL, ensure you have PX4-Autopilot installed following the [official PX4 installation guide](https://docs.px4.io/main/en/dev_setup/dev_env_linux_ubuntu.html). For Ubuntu users, make sure to run the `ubuntu.sh` script from the PX4-Autopilot repository to install all required Gazebo simulation tools and dependencies.




   * **Terminal 1 (Drone 1)**: Start PX4 instance 0 (`MAV_SYS_ID=1`). It will use the default namespace `/fmu/`.
     ```bash
     cd PX4-Autopilot
     HEADLESS=1 make px4_sitl gz_x500    
     ```
        > **Note**: While this guide shows a multi-drone setup as an example, you can start with just one drone and skip instructions for Drone 2.

   * **Terminal 2 (Drone 2)**: Start PX4 instance 1 (`MAV_SYS_ID=2`). It will use namespace `/px4_1/fmu/`. Add `PX4_GZ_MODEL_POSE` to spawn it at a different location.
     ```bash
     cd PX4-Autopilot
     HEADLESS=1 PX4_SYS_AUTOSTART=4001 PX4_GZ_MODEL_POSE="0,1" PX4_SIM_MODEL=gz_x500 MAV_SYS_ID=2 ./build/px4_sitl_default/bin/px4 -i 1
     ```

   > **Note on PX4 SITL Instance Identity**:
   > * The `make px4_sitl gz_x500` command (used for Drone 1) implicitly launches **instance 0** (`-i 0` is the default) and typically uses the default **`MAV_SYS_ID=1`**. Consequently, it uses the default UXRCE-DDS namespace `/fmu/`.
   > * The direct execution command `./build/.../px4 -i 1` (used for Drone 2) explicitly sets the **instance ID** via `-i 1`. We also explicitly set the **`MAV_SYS_ID=2`** using an environment variable. Based on these, this SITL instance uses the UXRCE-DDS namespace `/px4_1/fmu/` when connecting to the agent.
   > * **Note**: MAV_SYS_ID can be updated via PX4 parameters using QGroundControl.



    

3. **Start Micro-XRCE-DDS-Agent**:


   > Now that your PX4 SITL instances are running, we'll set up the communication bridge between PX4 and ROS 2 using Micro-XRCE-DDS-Agent. This agent converts PX4's internal DDS messages into ROS 2 topics and services.

   > Let's start by building and running our development containers:

   ```bash
   cd ws_droneOS
   docker compose -f docker/dev/docker-compose.dev.yml up -d --build
   ```
   This command builds the development environment and starts two containers:
   - `drone_core`: Contains the ROS 2 environment and Drone SDK
   - `micro_agent`: Runs the Micro-XRCE-DDS-Agent for PX4 communication


   >
   
   > ### `micro_agent` Container
   >
   > - This container is used to build and run the DDS agent that bridges ROS 2 and PX4. The agent source and build directories are mounted from the host. You only need to rebuild the agent if you change the source code or delete the build artifacts. The compiled binary and build directory persist across container restarts due to the volume mount.
   > - TODO: Revisit using the official eProsima Micro XRCE-DDS Agent Docker image. We currently build from source because the official repo did not compile correctly in some environments without a small change.
   >   ```bash
   >   # Enter the micro_agent container
   >   docker compose -f docker/dev/docker-compose.dev.yml exec micro_agent bash
   >   
   >   # Build the agent
   >   cd /root/ws_droneOS/Micro-XRCE-DDS-Agent
   >   mkdir build && cd build
   >   cmake ..
   >   make
   >   make install
   >   ldconfig /usr/local/lib/
   >   
   >   # Start the agent (in the same shell)
   >   ./MicroXRCEAgent udp4 -p 8888
   >   ```
   >
   >
4. **Start Drone SDK**:

> ### `drone_core` Container
   >

   > - Now that we have the containers built, we have our development environment all setup and ready to run our Drone SDK. To do this we need to "enter" the container. Note: look into VSCode extensions for coding in Docker container shell.
   >
   >   ```bash
   >   # Enter the drone_core container - this gives us a clean, optimized ROS 2 environment where we can run our Drone SDK code. 
   >
   >   docker compose -f docker/dev/docker-compose.dev.yml exec drone_core bash
   >   
   >   # Build packages
   >   cd /root/ws_droneOS
   >   colcon build
   >   source install/setup.bash
   >   
   >   # Run the drone_core executable for each drone - required parameters must match your PX4 SITL instance configuration!
   >
   >   # For drone 1
   >   ros2 run drone_core drone_core --ros-args \
   >       -r __node:=drone1 \
   >       -p drone_name:=drone1 \
   >       -p px4_namespace:=/fmu/ \
   >       -p mav_sys_id:=1
   >
   >   # For drone 2 
   >   ros2 run drone_core drone_core --ros-args \
   >       -r __node:=drone2 \
   >       -p drone_name:=drone2 \
   >       -p px4_namespace:=/px4_2/fmu/ \
   >       -p mav_sys_id:=2
   >
   >   # For additional drones, follow the same pattern:
   >   # - Increment __node and drone_name (drone3, drone4, etc.)
   >   # - Use /px4_N/fmu/ namespace where N is the drone number
   >   ```
   >
   > - For local development, a single `drone_core` Docker container can run multiple `drone_core` SDK instances, each controlling a different drone. This is possible because everything runs locally with low latency and high bandwidth and `micro_agent` can handle multiple connections on same port. 
   
   > - For production deployments, each drone requires its own companion computer (e.g., Raspberry Pi) with dedicated Docker containers for `drone_core` and `micro_agent`. This ensures optimal performance and reliability by maintaining direct, low-latency communication between the control software and the PX4 flight controller.
   
   > - `drone_gcs_cli` continues to operate the same in either setup; using ROS 2 topics and services on the network. 
   >
   >   
   > **Notes on Docker**:
   > - Our development containers are intentionally minimal on startup - they don't automatically build or run ROS 2 nodes or the agent. This design gives you full control over what runs and when, making it easier to test different configurations and debug issues.
   > - All your development work (source code, builds, installations, and logs) is mounted from your host machine into the container. This means you can edit code in your preferred IDE and see changes immediately without rebuilding the container. Although, you still need to build your packages same as always (e.g., colcon build).




5. **Use GCS CLI**: For testing, open a terminal and run the GCS CLI through its own Docker image:
   ```bash
   docker compose -f docker-compose.gcs.yml run --rm -it gcs_cli ros2 run drone_gcs_cli drone_gcs_cli -d drone1
   ```
   - The CLI defaults to targeting 'drone1'. Use the `target drone2` command to switch to the second drone.
   - Send commands (e.g., `set_offboard`, `arm`, `pos 0 0 -5 0`, `land`). Only the targeted drone should react.
   - To exit the GCS CLI and stop the container, press `CTRL+C`.

   > **Note**: The GCS CLI runs in its own container for several benefits:
   > - Ensures proper ROS 2 DDS communication with the drone nodes via host networking
   > - Provides a consistent  environment with all required dependencies
   > - Allows running the CLI from any machine that has Docker and Tailscale VPN installed
   > - Isolates the CLI from the development environment, making it suitable for both development and production use
   > - Simplifies deployment as the container can be run on any machine that needs to control the drones (requires Tailscale VPN for remote access)

6. **Cleanup**: When done, stop all services:
   ```bash
   docker compose -f docker-compose.dev.yml down
   ```
   Then stop the PX4 SITL instances in their respective terminals with `CTRL+C`.

### Example: Running on a Real Drone (Raspberry Pi)

**Setup DroneOS on RPi**:
   ```bash
   # Clone the repository
   git clone https://github.com/ortegarod/droneOS.git ws_droneOS
   cd ws_droneOS
   ```
Use `docker/prod/docker-compose.yml` for real drone deployment

   ```bash
   cd ws_droneOS
   docker compose -f docker/prod/docker-compose.yml up -d --build
   ```
  >`drone_core`:
   >  - Pre-built ROS 2 Humble image with all dependencies
    > - Contains compiled `drone_core` node and SDK
     >- Only mounts logs directory for persistence
     >- Configured for specific drone ID and MAVLink system ID
  
  >`micro_agent`:
  >   - Pre-built agent binary optimized for production
   >  - Configured for serial communication with PX4
    > - Includes udev rules for stable device naming
- Uses host network mode for Tailscale VPN connectivity
- Supports multi-drone setups with unique node names and MAVLink IDs
- Each physical drone requires its own companion computer running these two containers

**Prerequisites**:
   - Raspberry Pi (5 recommended) with Ubuntu Server installed
   - PX4 flight controller (e.g., Pixhawk 6C) connected to the RPi via Serial/USB
   - Tailscale installed on the RPi for remote access
   - udev rule for stable device naming (create `/etc/udev/rules.d/99-pixhawk.rules`):
     ```
     SUBSYSTEM=="tty", ATTRS{idVendor}=="26ac", ATTRS{idProduct}=="0011", SYMLINK+="pixhawk-telem2"
     ```
   - Ensure the RPi user has permission to access the serial device: `sudo usermod -a -G dialout $USER` and reboot


> **Important Notes**:
> - The `docker-compose.yml` file is already configured for a single real drone with:
>   - Serial communication to PX4
>   - Host networking for Tailscale/ROS2 communication
>   - Default configuration for drone1

### Deployment Scenarios: SITL vs. Real Drone

When deploying DroneOS, the main distinction is whether you are working with a simulated environment (SITL) or actual drone hardware (Real Drone).

In the **SITL (Software-In-The-Loop)** scenario, everything runs on your development computer. PX4 Autopilot is launched in simulation (typically with Gazebo), and the Micro XRCE-DDS Agent communicates with PX4 over UDP, usually via localhost or your local network. This setup is ideal for development, testing, and running multiple simulated drones, since you can quickly iterate and debug without any physical hardware. QGroundControl can also connect over UDP to monitor and control the simulated drones.

In contrast, the **Real Drone** scenario involves running PX4 on an actual flight controller, such as a Pixhawk. Here, the Micro XRCE-DDS Agent typically connects to PX4 via a direct Serial or USB link—often through a companion computer (like a Raspberry Pi or Jetson) physically connected to the flight controller's telemetry port. For ground control, QGroundControl usually connects via a pair of telemetry radios (e.g., 915MHz) between the ground station and the drone, allowing for real-time monitoring and command. Optionally, a radio can also be attached to the companion computer for sending commands, but this is often limited by bandwidth and may be replaced by VPN-based solutions like Tailscale combined with 4G/5G for more advanced setups (see section on Tailscale below).

In summary, SITL is best suited for rapid development and simulation on a single machine using network-based communication, while the Real Drone setup is designed for actual flight, requiring hardware connections and often more complex networking. The way the Micro XRCE-DDS Agent interfaces with PX4—UDP for SITL, Serial/USB for real hardware—is the key technical difference.

> **Note on HITL (Hardware-In-The-Loop)**: This approach runs PX4 on real hardware but uses simulated sensors. While possible using Serial/USB or UDP, this configuration is still experimental and not fully documented here.

> **Note**: The Micro XRCE-DDS Agent command and PX4 parameters (e.g., `XRCE_DDS_CFG`, baud rates) must be configured according to your specific setup:
> - For SITL: Use UDP communication with appropriate port settings
> - For Real Drone: Configure serial baud rate and device path

### Remote Communication (e.g., over 4G/WAN)

#### Local Network Communication Flow

This standard ROS 2 communication relies heavily on the ability of nodes to discover each other and directly route traffic within the local network.

#### Enabling Remote Communication via VPN

Standard ROS 2 discovery and direct communication often fail across the public internet or cellular networks due to NAT, firewalls, and the lack of multicast support.

**The recommended approach is to use a VPN (Virtual Private Network), specifically [Tailscale](https://tailscale.com/).**

- **How it Works**: Tailscale creates a secure, encrypted peer-to-peer mesh network over the public internet (like 4G). You install the Tailscale client on the drone's onboard computer (RPi 5) and the GCS machine, authenticate them to your private network ("tailnet"), and they are assigned stable virtual IP addresses.
- **Benefit (Application Transparency)**: To ROS 2, the GCS and the drone now appear to be on the same local network via their Tailscale IP addresses. **Crucially, this means no code changes are needed in `drone_core` or the CLI.** The ROS 2 nodes don't need to know *how* the connection is made; they simply use standard networking (DDS discovery, service calls, topics) over the virtual network interface provided by Tailscale, just as described in the *Local Network Communication Flow* section. Tailscale handles the underlying secure tunneling and NAT traversal automatically.
- **Setup**: Install and configure the Tailscale client on both the drone's computer and the GCS machine following Tailscale documentation. No central VPN server setup is typically required.
- **Integration with Docker**: When running `drone_core` (or other components) in Docker containers on the drone, Tailscale should be installed and run on the **host OS (e.g., the Raspberry Pi 5)**, *not* within the container. To allow the containerized ROS 2 nodes to use the host's Tailscale connection, launch the container with **host networking** enabled (e.g., `docker run --network=host ...` or equivalent in Docker Compose).