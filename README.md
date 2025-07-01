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

### `camera_ros` (C++ with libcamera integration)

Provides access to camera streams from a physical camera (e.g., Raspberry Pi camera module) connected to the drone's companion computer. It publishes these streams as ROS 2 topics. This component integrates `libcamera` for camera hardware interaction and `rpicam-apps` for lower-level camera control, packaged within a ROS 2 node.

- **Purpose**: Streams live video from a camera physically connected to the drone's companion computer (e.g., Raspberry Pi).
- **Deployment**: Typically runs as a dedicated Docker service (`camera_service`) on the companion computer, not usually on a local development machine for SITL unless a camera is directly attached and configured for that machine.
- **Integration**: Runs as a dedicated Docker service (`camera_service`).
- **Source**: Based on [christianrauch/camera_ros](https://github.com/christianrauch/camera_ros), built from source within its Docker image along with `libcamera` and `rpicam-apps`.
- **Configuration**: Configured in `docker/dev/docker-compose.dev.yml` (for general service definition) and `docker/dev/camera.dev.Dockerfile` (for image build). The `docker-compose.prod.yml` would be used for on-drone deployment.
- **Usage**: Publishes image topics that can be consumed by other ROS 2 nodes for computer vision tasks, telemetry, or recording. Requires a functioning camera and correctly configured drivers on the host system where the service is run.

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

   **Prerequisite**: Before running SITL, ensure you have PX4-Autopilot installed following the [official PX4 installation guide](https://docs.px4.io/main/en/dev_setup/dev_env_linux_ubuntu.html). For Ubuntu users, make sure to run the `ubuntu.sh` script from the PX4-Autopilot repository to install all required Gazebo simulation tools and dependencies.




   * **Terminal 1 (Drone 1)**: Start PX4 instance 0 (`MAV_SYS_ID=1`). It will use the default namespace `/fmu/`.
     ```bash
     cd PX4-Autopilot
     HEADLESS=1 make px4_sitl gz_x500    
     ```
        **Note**: While this guide shows a multi-drone setup as an example, you can start with just one drone and skip instructions for Drone 2.

   * **Terminal 2 (Drone 2)**: Start PX4 instance 1 (`MAV_SYS_ID=2`). It will use namespace `/px4_1/fmu/`. Add `PX4_GZ_MODEL_POSE` to spawn it at a different location.
     ```bash
     cd PX4-Autopilot
     HEADLESS=1 PX4_SYS_AUTOSTART=4001 PX4_GZ_MODEL_POSE="0,1" PX4_SIM_MODEL=gz_x500 MAV_SYS_ID=2 ./build/px4_sitl_default/bin/px4 -i 1
     ```

   **Note on PX4 SITL Instance Identity**:
   * The `make px4_sitl gz_x500` command (used for Drone 1) implicitly launches **instance 0** (`-i 0` is the default) and typically uses the default **`MAV_SYS_ID=1`**. Consequently, it uses the default UXRCE-DDS namespace `/fmu/`.
   * The direct execution command `./build/.../px4 -i 1` (used for Drone 2) explicitly sets the **instance ID** via `-i 1`. We also explicitly set the **`MAV_SYS_ID=2`** using an environment variable. Based on these, this SITL instance uses the UXRCE-DDS namespace `/px4_1/fmu/` when connecting to the agent.
   * **Note**: MAV_SYS_ID can be updated via PX4 parameters using QGroundControl.


  /home/rodrigo/PX4-Autopilot/Tools/simulation/gz/worlds/default.sdf


    

3. **Start Micro-XRCE-DDS-Agent**:


   Now that your PX4 SITL instances are running, we'll set up the communication bridge between PX4 and ROS 2 using Micro-XRCE-DDS-Agent. This agent converts PX4's internal DDS messages into ROS 2 topics and services.
   
   **Important Note for Multi-Machine SITL Development**: The instructions below assume that the Docker environment (running `micro_agent`, `drone_core`, etc.) is on the **same machine** as your PX4 SITL instances. If PX4 SITL is running on a separate computer on your local network, the Micro XRCE-DDS Agent (running `MicroXRCEAgent udp4 -p 8888`) needs to be configured to connect to the IP address of the machine running PX4 SITL, and PX4 SITL needs to be configured to accept connections from the agent's machine. For simplicity in the initial dev setup, running both on the same machine is recommended. Advanced configurations for distributed SITL setups are possible but require careful network configuration.

   Let's start by building and running our development containers:

   ```bash
   cd ws_droneOS
   docker compose -f docker/dev/docker-compose.dev.yml up -d --build
   ```
   **Note**: For local SITL development where a physical camera is not connected to your development machine, it is recommended to start only the `drone_core` and `micro_agent` services. The `camera_service` is intended to be run on the drone's companion computer with a connected camera.
   To start only the essential services for SITL (without the camera), run:
   ```bash
   docker compose -f docker/dev/docker-compose.dev.yml up -d --build drone_core micro_agent
   ```
   This command builds the development environment and starts two containers:
   - `drone_core`: Contains the ROS 2 environment and Drone SDK
   - `micro_agent`: Runs the Micro-XRCE-DDS-Agent for PX4 communication

   If you run `docker compose ... up -d --build` without specifying services, it will also attempt to start `camera_service`. This service requires a physical camera and appropriate drivers, and may not function correctly or could produce errors if run on a system without a connected and configured camera.
   
   
   ### `micro_agent` Container
   
   - This container automatically builds and runs the DDS agent that bridges ROS 2 and PX4. The agent starts automatically when the container launches.
   - **Verification**: Check that the agent is running correctly by viewing logs:
     ```bash
     docker logs -f micro_agent_service
     ```
     You should see initialization messages indicating creation of topics, subscribers, and datareaders, confirming PX4 has connected to the agent.
   
   - **Manual rebuild** (only needed if you modify agent source code):
     ```bash
     docker compose -f docker/dev/docker-compose.dev.yml exec micro_agent bash
     cd /root/ws_droneOS/Micro-XRCE-DDS-Agent
     mkdir build && cd build && cmake .. && make && make install && ldconfig /usr/local/lib/
     ```
   
   

### Configuring ROS 2 Communication

#### Current Default Configuration (`fastdds_config.xml` at Project Root)

The `fastdds_config.xml` file located at the root of the `ws_droneOS` project is currently configured for a simplified development setup where **all components (PX4 SITL, Micro XRCE-DDS Agent, Drone Core, GCS/AI Agent CLI, etc.) are expected to run on the same host machine (e.g., your development laptop)**.

This configuration uses the `SIMPLE` discovery protocol, relying on multicast for nodes to find each other. This is the most straightforward way to get a development environment working quickly when all parts of the system are on one computer.

**Key characteristics of this default setup:**
-   **Discovery Type**: `SIMPLE` (peer-to-peer via multicast).
-   **Target Environment**: Single host development (e.g., running PX4 SITL and all Docker services on your local machine).
-   **Simplicity**: Reduces the need for complex network configuration for initial development and testing.
-   **File Used**: The `fastdds_config.xml` at the project root is referenced by `FASTRTPS_DEFAULT_PROFILES_FILE` in `docker/dev/docker-compose.dev.yml` for the `drone_core`, `micro_agent`, and `agent_system` services.

**Limitations and Future Considerations:**
-   **LAN Communication (Multi-Machine)**: While the `SIMPLE` discovery with multicast *can* work across a LAN if multicast is properly configured on the network, it's often less reliable than static peer lists or a Discovery Server for multi-machine setups. The notes below on "Configuring for LAN Communication (Static Peers)" provide guidance if you need to connect nodes across different machines on the same LAN.
-   **Real Drone Hardware / 4G / VPN**: This default configuration is **not suitable** for scenarios involving actual drone hardware communicating over a more complex network (like 4G, or a VPN like Tailscale). These situations typically break multicast and require a **Discovery Server** for robust node discovery. We plan to explore and document the Discovery Server setup in the future. For now, this setup is primarily for local development.


3.  **Ensure Consistency**: If other machines on the LAN are also using FastDDS with an XML configuration, ensure their `fastdds_config.xml` files are similarly updated to include all relevant peer IPs.

4.  **Restart Services**:
    *   **Docker Containers**: After modifying `fastdds_config.xml` on your Docker host machine, restart the relevant Docker services:
        ```bash
        # Restart all services defined in the compose file
        docker compose -f docker/dev/docker-compose.dev.yml down
        docker compose -f docker/dev/docker-compose.dev.yml up -d --build

        # Or restart specific services
        docker compose -f docker/dev/docker-compose.dev.yml restart micro_agent drone_core agent_system
        ```
    *   **Other ROS 2 Nodes**: Restart any ROS 2 applications on the other machines.

5.  **Network Configuration for Docker**:
    Ensure your Docker services in `docker-compose.dev.yml` are using `network_mode: "host"`. This is crucial for the Docker containers to use the host's network stack directly, making LAN communication simpler. The provided `docker-compose.dev.yml` already does this.
    The environment variable `FASTRTPS_WHITELIST_INTERFACES=all` set in the `docker-compose.dev.yml` can also be helpful as it allows FastDDS to attempt communication over all available network interfaces on the host.

By correctly configuring the `initialPeersList` and `metatrafficUnicastLocatorList` with the actual IP addresses of your LAN machines, ROS 2 nodes should be able to discover and communicate with each other effectively. For more advanced scenarios or troubleshooting, refer to the [FastDDS documentation on Discovery](https://fast-dds.docs.eprosima.com/en/latest/fastdds/discovery/discovery.html).

4. **Start Drone SDK**:

### `drone_core` Container
   
   - This container automatically builds and runs the Drone SDK. By default, it starts `drone1` connected to PX4 SITL.
   - **Verification**: Check that drone_core is running correctly:
     ```bash
     docker logs -f drone_core_node
     ```
     You should see service initialization messages for `/drone1/arm`, `/drone1/takeoff`, etc.
   
   - **Manual development** (for code changes or additional drones):
     ```bash
     # Enter the container for development
     docker compose -f docker/dev/docker-compose.dev.yml exec drone_core bash
     
     # Rebuild after code changes
     cd /root/ws_droneOS && colcon build && source install/setup.bash
     
     # Run additional drone instances manually (if needed)
     ros2 run drone_core drone_core --ros-args \
         -r __node:=drone2 \
         -p drone_name:=drone2 \
         -p px4_namespace:=/px4_1/fmu/ \
         -p mav_sys_id:=2
     ```
   
   - For local development, a single `drone_core` Docker container can run multiple `drone_core` SDK instances, each controlling a different drone. This is possible because everything runs locally with low latency and high bandwidth and `micro_agent` can handle multiple connections on same port. 
   
   - For production deployments, each drone requires its own companion computer (e.g., Raspberry Pi) with dedicated Docker containers for `drone_core` and `micro_agent`. This ensures optimal performance and reliability by maintaining direct, low-latency communication between the control software and the PX4 flight controller.
   
   - `drone_gcs_cli` continues to operate the same in either setup; using ROS 2 topics and services on the network. 
   
     
   **Notes on Docker**:
   - The development containers (`drone_core`, `micro_agent`) automatically start their main applications when launched. The `drone_core` container runs the drone SDK, and `micro_agent` starts the XRCE-DDS bridge to PX4. The `agent_system` container is configured for interactive mode and requires manual startup or the `docker compose run` command for interactive sessions.
   - All your development work (source code, builds, installations, and logs) is mounted from your host machine into the container. This means you can edit code in your preferred IDE and see changes immediately without rebuilding the container (though C++/Python builds like `colcon build` or Python script restarts are still needed).
   - **Viewing Container Logs**: To view the logs for a specific running container, you can use the `docker logs` command. For example, to see the logs for the `drone_core_node` container:
     ```bash
     docker logs drone_core_node
     ```
     To follow the logs in real-time (similar to `tail -f`):
     ```bash
     docker logs -f drone_core_node
     ```
     Replace `drone_core_node` with the name of the container you want to inspect (e.g., `micro_agent_service`, `agent_system_node`). You can find the names of your running containers using `docker ps`.

5. **Start and Use AI Agent System**:

### `agent_system` Container
   
   - This container runs the AI agent (`run_basic_agent.py`), which uses tools to interact with services provided by `drone_core`.
   - It requires the `OPENAI_API_KEY` environment variable to be set. Ensure this is exported in your host shell before running `docker compose up`, or manage it via an `.env` file recognized by Docker Compose.
   
   **Running the Agent:**
   The `agent_system` service in `docker-compose.dev.yml` is configured to run `python3 src/drone_agent_system/run_basic_agent.py` by default when the container starts.
   
   1. **Ensure Prerequisite Services are Running**:
      - PX4 SITL (on the same machine, as per earlier notes).
      - `micro_agent` container with the `MicroXRCEAgent` binary running inside it.
      - `drone_core` container with the `drone_core` ROS 2 node running inside it (providing services like `/drone1/arm`).
   2. **Start the `agent_system` service** (if not already started with other services):
      ```bash
      # In ws_droneOS directory on host
      # Ensure OPENAI_API_KEY is exported in this shell
      export OPENAI_API_KEY="your_openai_api_key"
      docker compose -f docker/dev/docker-compose.dev.yml up -d --build agent_system 
      ```
      (If you started all services together, including `agent_system`, it should already be running).
   3. **Interacting with the Agent:**
      Since `run_basic_agent.py` uses `input()` for commands, direct interaction with a detached container can be tricky.
      *   **Option A (View Logs Only)**:
          ```bash
          docker logs -f agent_system_node
          ```
          This will show you the startup messages and any output from the agent, but you won't be able to type commands.
      *   **Option B (Interactive Session - Recommended for Dev/Testing)**:
          It's often easier to get an interactive shell in the container and run the script manually. To do this, you might first want to change the default `command` for the `agent_system` in `docker-compose.dev.yml` to something like `["sleep", "infinity"]` so it doesn't immediately run the script. Then:
          ```bash
          # After 'docker compose up -d ... agent_system' (with modified command or if it exited)
          docker compose -f docker/dev/docker-compose.dev.yml exec agent_system bash
          ```
          Inside the `agent_system` container's shell:
          ```bash
          # The OPENAI_API_KEY should be inherited from the container's environment
          source /opt/ros/humble/setup.bash
          python3 src/drone_agent_system/run_basic_agent.py
          ```
          Now you can type commands directly to the "Drone Agent>" prompt.
      *   **Option C (Attach - if tty and stdin_open are configured)**:
          If you modify `docker-compose.dev.yml` for the `agent_system` service to include:
          ```yaml
          stdin_open: true # Equivalent to -i in docker run
          tty: true      # Equivalent to -t in docker run
          ```
          And run `docker compose -f docker/dev/docker-compose.dev.yml up --build agent_system` (without `-d`), you might be able to interact directly.
      *   **Option D (Interactive Session using `docker compose run` - Recommended)**:
          For a reliable interactive session, especially if Option C doesn't provide input capability, use the `docker compose run` command. This command is designed for running one-off tasks with a service and correctly handles TTY allocation.
          ```bash
          # In ws_droneOS directory on host, in an external terminal (e.g., macOS Terminal app)
          # Ensure OPENAI_API_KEY is exported in this shell or set in your .env file
          # export OPENAI_API_KEY="your_openai_api_key" 
          docker compose -f docker/dev/docker-compose.dev.yml run --rm --service-ports agent_system
          ```
          This will start the `agent_system` container, and you should see the `Drone Agent>` prompt, allowing you to type commands directly. The `--rm` flag ensures the container is removed when you exit (e.g., by typing `exit` at the prompt or pressing `Ctrl+C`).
   
   **Troubleshooting**:
   - If the agent script reports errors about not finding services, ensure `drone_core` is running correctly and that DDS discovery is working (all services on `ROS_DOMAIN_ID=0` and `network_mode: "host"` or properly configured networking).
   - Check `docker logs agent_system_node` for any Python errors or messages from the OpenAI SDK.

6. **Cleanup**: When done, stop all services:
   ```bash
   docker compose -f docker-compose.dev.yml down
   ```
   Then stop the PX4 SITL instances in their respective terminals with `CTRL+C`.

## Using the GCS CLI

For testing, open a terminal and run the GCS CLI through its own Docker image:
```bash
cd ws_droneOS
docker compose -f docker/dev/gcs/docker-compose.gcs.yml run --rm -it gcs_cli ros2 run drone_gcs_cli drone_gcs_cli -d drone1
```
- The CLI defaults to targeting 'drone1'. Use the `target drone2` command to switch to the second drone.
- Send commands (e.g., `set_offboard`, `arm`, `pos 0 0 -5 0`, `land`). Only the targeted drone should react.
- To exit the GCS CLI and stop the container, press `CTRL+C`.

**Note**: The GCS CLI runs in its own container for several benefits:
- Ensures proper ROS 2 DDS communication with the drone nodes via host networking
- Provides a consistent  environment with all required dependencies
- Allows running the CLI from any machine that has Docker and Tailscale VPN installed
- Isolates the CLI from the development environment, making it suitable for both development and production use
- Simplifies deployment as the container can be run on any machine that needs to control the drones (requires Tailscale VPN for remote access)

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
This builds the docker containers and runs drone_core and micro_agent automatically. and with restart:unless-stopped it will restart on boot. This means Docker will automatically restart your containers on boot, as long as they were running before the reboot. Now you should be able to send commands to your real drone hardware from the GCS CLI. 


  `drone_core`:
    - Pre-built ROS 2 Humble image with all dependencies
    - Contains compiled `drone_core` node and SDK
    - Only mounts logs directory for persistence
    - Configured for specific drone ID and MAVLink system ID
  
  `micro_agent`:
    - Pre-built agent binary optimized for production
    - Configured for serial communication with PX4
    - Includes udev rules for stable device naming
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


**Important Notes**:
- The `docker-compose.yml` file is already configured for a single real drone with:
  - Serial communication to PX4
  - Host networking for Tailscale/ROS2 communication
  - Default configuration for drone1

### Deployment Scenarios: SITL vs. Real Drone

When deploying DroneOS, the main distinction is whether you are working with a simulated environment (SITL) or actual drone hardware (Real Drone).

In the **SITL (Software-In-The-Loop)** scenario, everything runs on your development computer. PX4 Autopilot is launched in simulation (typically with Gazebo), and the Micro XRCE-DDS Agent communicates with PX4 over UDP, usually via localhost or your local network. This setup is ideal for development, testing, and running multiple simulated drones, since you can quickly iterate and debug without any physical hardware. QGroundControl can also connect over UDP to monitor and control the simulated drones.

In contrast, the **Real Drone** scenario involves running PX4 on an actual flight controller, such as a Pixhawk. Here, the Micro XRCE-DDS Agent typically connects to PX4 via a direct Serial or USB link—often through a companion computer (like a Raspberry Pi or Jetson) physically connected to the flight controller's telemetry port. For ground control, QGroundControl usually connects via a pair of telemetry radios (e.g., 915MHz) between the ground station and the drone, allowing for real-time monitoring and command. Optionally, a radio can also be attached to the companion computer for sending commands, but this is often limited by bandwidth and may be replaced by VPN-based solutions like Tailscale combined with 4G/5G for more advanced setups (see section on Tailscale below).

In summary, SITL is best suited for rapid development and simulation on a single machine using network-based communication, while the Real Drone setup is designed for actual flight, requiring hardware connections and often more complex networking. The way the Micro XRCE-DDS Agent interfaces with PX4—UDP for SITL, Serial/USB for real hardware—is the key technical difference.

**Note on HITL (Hardware-In-The-Loop)**: This approach runs PX4 on real hardware but uses simulated sensors. While possible using Serial/USB or UDP, this configuration is still experimental and not fully documented here.

**Note**: The Micro XRCE-DDS Agent command and PX4 parameters (e.g., `XRCE_DDS_CFG`, baud rates) must be configured according to your specific setup:
- For SITL: Use UDP communication with appropriate port settings
- For Real Drone: Configure serial baud rate and device path

### Remote Communication (e.g., over 4G/WAN)

#### Local Network Communication Flow

This standard ROS 2 communication relies heavily on the ability of nodes to discover each other and directly route traffic within the local network.

#### Enabling Remote Communication via VPN

Standard ROS 2 discovery and direct communication often fail across the public internet or cellular networks due to NAT, firewalls, and the lack of multicast support.

**The recommended approach is to use a VPN (Virtual Private Network), specifically [Tailscale](https://tailscale.com/).**

- **How it Works**: Tailscale creates a secure, encrypted peer-to-peer mesh network over the public internet (like 4G). You install the Tailscale client on the drone's onboard computer (RPi 5) and the GCS machine, authenticate them to your private network ("tailnet"), and they are assigned stable virtual IP addresses.
- **Benefit (Application Transparency)**: To ROS 2, the GCS and the drone now appear to be on the same local network via their Tailscale IP addresses. **Crucially, this means no code changes are needed in `
