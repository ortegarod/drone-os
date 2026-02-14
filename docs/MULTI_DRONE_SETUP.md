# Multi-Drone Simulation Setup

## Overview

DroneOS supports running multiple simulated drones in Gazebo for fleet coordination, multi-agent missions, and demo scenarios. This document covers the complete setup for adding drones to the simulation environment.

---

## Current Architecture (srv01)

srv01 runs simulation services in two layers: systemd user services and Docker containers.

### Systemd User Services (`~/.config/systemd/user/`)

| Service | Description | Auto-start | Management |
|---------|-------------|------------|------------|
| `px4-sitl` | PX4 drone1 + Gazebo (baylands world) | ✅ on boot | `systemctl --user start/stop/restart px4-sitl` |
| `px4-drone2` | PX4 instance 1 (drone2) | ✅ 20s after px4-sitl | `systemctl --user start/stop/restart px4-drone2` |
| `px4-drone3` | PX4 instance 2 (drone3) | ✅ 25s after px4-sitl | `systemctl --user start/stop/restart px4-drone3` |
| `ros-gz-bridge` | Camera bridge: Gazebo → `/droneX/camera` ROS topics | ✅ 15s after px4-sitl | `systemctl --user start/stop/restart ros-gz-bridge` |

**Notes:**
- All PX4 services auto-start on boot and survive reboots
- drone2/drone3 have `After=` dependencies on `px4-sitl` to ensure Gazebo is ready
- Logs: `journalctl --user -u <service> -f`

### Docker Containers (`docker/dev/docker-compose.*.yml`)

| Container | Purpose | Namespace | MAV_SYS_ID | Management |
|-----------|---------|-----------|------------|------------|
| `micro_agent_service` | XRCE-DDS bridge (PX4↔ROS2, UDP:8888) | — | — | `docker restart micro_agent_service` |
| `drone_core_node` | drone1 SDK | `/fmu/` | 1 | `docker restart drone_core_node` |
| `drone_core_node2` | drone2 SDK | `/px4_1/fmu/` | 2 | `docker restart drone_core_node2` |
| `drone_core_node3` | drone3 SDK | `/px4_2/fmu/` | 3 | `docker restart drone_core_node3` |
| `rosbridge_server` | WebSocket JSON→ROS2 bridge (TCP:9090) | — | — | `docker restart rosbridge_server` |
| `sim_camera_node` | web_video_server (MJPEG streams, TCP:8080) | — | — | `docker restart sim_camera_node` |

**Notes:**
- All use `network_mode: host` and `restart: unless-stopped`
- Auto-restart with Docker daemon
- Logs: `docker logs -f <container_name>`

---

## Drone Configuration Reference

| Drone | PX4 Instance | MAV_SYS_ID | Namespace | Spawn Pose (Y offset) | Service |
|-------|--------------|------------|-----------|------------------------|---------|
| drone1 | 0 | 1 | `/fmu/` | 0 | `px4-sitl` |
| drone2 | 1 | 2 | `/px4_1/fmu/` | 2 | `px4-drone2` |
| drone3 | 2 | 3 | `/px4_2/fmu/` | 4 | `px4-drone3` |
| drone4 | 3 | 4 | `/px4_3/fmu/` | 6 | `px4-drone4` |
| drone5 | 4 | 5 | `/px4_4/fmu/` | 8 | `px4-drone5` |

**Pattern:**
- **Instance ID:** `N - 1` (drone1 → 0, drone2 → 1, etc.)
- **MAV_SYS_ID:** Same as drone number (drone1 → 1, drone2 → 2)
- **Namespace:** drone1 uses `/fmu/`, others use `/px4_{instance}/fmu/`
- **Spawn Pose:** `0,{instance*2},0,0,0,0` (spreads drones along Y-axis)
- **Gazebo Model:** `x500_mono_cam_{instance}` (e.g., `x500_mono_cam_0`, `x500_mono_cam_1`)

---

## Adding a New Drone

Follow these steps to add drone4, drone5, etc. Replace:
- `N` = drone number (4, 5, 6...)
- `I` = PX4 instance index (`N - 1`, so drone4 → 3)
- `Y_OFFSET` = `I * 2` (spawn position along Y-axis)

### Step 1: Create PX4 Systemd Service

**On srv01:**

```bash
cat > ~/.config/systemd/user/px4-drone${N}.service << EOF
[Unit]
Description=PX4 SITL Drone${N} (instance ${I})
After=px4-sitl.service
Requires=px4-sitl.service

[Service]
Type=simple
WorkingDirectory=/home/rodrigo/PX4-Autopilot/build/px4_sitl_default
Environment=PX4_GZ_STANDALONE=1
Environment=PX4_GZ_WORLD=baylands
Environment=PX4_GZ_MODEL_POSE=0,${Y_OFFSET},0,0,0,0
Environment=PX4_SIM_MODEL=gz_x500_mono_cam
Environment=HEADLESS=1
ExecStartPre=/bin/bash -c "rm -f /tmp/px4-daemon-app-${I}.lock /home/rodrigo/PX4-Autopilot/build/px4_sitl_default/rootfs/${I}/*.lock 2>/dev/null; true"
ExecStartPre=/bin/sleep 25
ExecStart=/bin/bash -lc 'cd /home/rodrigo/PX4-Autopilot/build/px4_sitl_default && ./bin/px4 -i ${I}'
Restart=on-failure
RestartSec=10

[Install]
WantedBy=default.target
EOF

systemctl --user daemon-reload
systemctl --user enable px4-drone${N}.service
systemctl --user start px4-drone${N}.service
```

**Example for drone4:**
```bash
# N=4, I=3, Y_OFFSET=6
cat > ~/.config/systemd/user/px4-drone4.service << 'EOF'
[Unit]
Description=PX4 SITL Drone4 (instance 3)
After=px4-sitl.service
Requires=px4-sitl.service

[Service]
Type=simple
WorkingDirectory=/home/rodrigo/PX4-Autopilot/build/px4_sitl_default
Environment=PX4_GZ_STANDALONE=1
Environment=PX4_GZ_WORLD=baylands
Environment=PX4_GZ_MODEL_POSE=0,6,0,0,0,0
Environment=PX4_SIM_MODEL=gz_x500_mono_cam
Environment=HEADLESS=1
ExecStartPre=/bin/bash -c "rm -f /tmp/px4-daemon-app-3.lock /home/rodrigo/PX4-Autopilot/build/px4_sitl_default/rootfs/3/*.lock 2>/dev/null; true"
ExecStartPre=/bin/sleep 25
ExecStart=/bin/bash -lc 'cd /home/rodrigo/PX4-Autopilot/build/px4_sitl_default && ./bin/px4 -i 3'
Restart=on-failure
RestartSec=10

[Install]
WantedBy=default.target
EOF

systemctl --user daemon-reload
systemctl --user enable px4-drone4.service
systemctl --user start px4-drone4.service
```

**Wait ~30 seconds**, then verify:
```bash
systemctl --user status px4-drone${N}
gz model --list | grep x500_mono_cam_${I}
```

### Step 2: Create Drone Core Docker Service

**On srv01:**

```bash
cat > ~/ws_droneOS/docker/dev/docker-compose.drone${N}.yml << EOF
services:
  drone_core${N}:
    build:
      context: .
      dockerfile: drone_core.dev.Dockerfile
    container_name: drone_core_node${N}
    network_mode: "host"
    restart: unless-stopped
    volumes:
      - ../../src:/root/ws_droneOS/src
      - ../../build:/root/ws_droneOS/build
      - ../../install:/root/ws_droneOS/install
      - ../../logs:/root/ws_droneOS/logs
      - ../../fastdds_config_dev_simple.xml:/root/ws_droneOS/fastdds_config.xml
    environment:
      - RMW_IMPLEMENTATION=rmw_fastrtps_cpp
      - ROS_LOG_SEVERITY_THRESHOLD=debug
      - ROS_DOMAIN_ID=0
      - FASTRTPS_DEFAULT_PROFILES_FILE=/root/ws_droneOS/fastdds_config.xml
    command:
      - bash
      - -c
      - |
        . /opt/ros/humble/setup.bash
        cd /root/ws_droneOS
        colcon build --packages-select drone_interfaces px4_msgs drone_core
        . install/setup.bash
        ros2 run drone_core drone_core --ros-args \
          -r __node:=drone${N} \
          -p drone_name:=drone${N} \
          -p px4_namespace:=/px4_${I}/fmu/ \
          -p mav_sys_id:=${N}
EOF

cd ~/ws_droneOS/docker/dev
docker compose -f docker-compose.drone${N}.yml up -d
```

**Example for drone4:**
```bash
cat > ~/ws_droneOS/docker/dev/docker-compose.drone4.yml << 'EOF'
services:
  drone_core4:
    build:
      context: .
      dockerfile: drone_core.dev.Dockerfile
    container_name: drone_core_node4
    network_mode: "host"
    restart: unless-stopped
    volumes:
      - ../../src:/root/ws_droneOS/src
      - ../../build:/root/ws_droneOS/build
      - ../../install:/root/ws_droneOS/install
      - ../../logs:/root/ws_droneOS/logs
      - ../../fastdds_config_dev_simple.xml:/root/ws_droneOS/fastdds_config.xml
    environment:
      - RMW_IMPLEMENTATION=rmw_fastrtps_cpp
      - ROS_LOG_SEVERITY_THRESHOLD=debug
      - ROS_DOMAIN_ID=0
      - FASTRTPS_DEFAULT_PROFILES_FILE=/root/ws_droneOS/fastdds_config.xml
    command:
      - bash
      - -c
      - |
        . /opt/ros/humble/setup.bash
        cd /root/ws_droneOS
        colcon build --packages-select drone_interfaces px4_msgs drone_core
        . install/setup.bash
        ros2 run drone_core drone_core --ros-args \
          -r __node:=drone4 \
          -p drone_name:=drone4 \
          -p px4_namespace:=/px4_3/fmu/ \
          -p mav_sys_id:=4
EOF

cd ~/ws_droneOS/docker/dev
docker compose -f docker-compose.drone4.yml up -d
```

**Wait ~10 seconds**, then verify:
```bash
docker ps | grep drone_core_node${N}
source ~/ws_droneOS/install/setup.bash
ros2 topic echo /drone${N}/drone_state --once
```

### Step 3: Add Camera Bridge

Edit `~/.config/systemd/user/ros-gz-bridge.service` and add the camera bridge entry for the new drone.

**Find this line in the ExecStart:**
```bash
ExecStart=/bin/bash -lc 'source /opt/ros/humble/setup.bash && ros2 run ros_gz_bridge parameter_bridge \
```

**Add this entry** (replace `${I}` and `${N}` with actual values):
```bash
/world/baylands/model/x500_mono_cam_${I}/link/camera_link/sensor/imager/image@sensor_msgs/msg/Image@gz.msgs.Image \
--remap /world/baylands/model/x500_mono_cam_${I}/link/camera_link/sensor/imager/image:=/drone${N}/camera \
```

**Example for drone4 (I=3, N=4):**
```bash
/world/baylands/model/x500_mono_cam_3/link/camera_link/sensor/imager/image@sensor_msgs/msg/Image@gz.msgs.Image \
--remap /world/baylands/model/x500_mono_cam_3/link/camera_link/sensor/imager/image:=/drone4/camera \
```

**Complete example of ros-gz-bridge.service with 4 drones:**
```ini
[Unit]
Description=ROS-Gazebo Bridge (Cameras)
After=px4-sitl.service
Requires=px4-sitl.service

[Service]
Type=simple
ExecStartPre=/bin/sleep 15
ExecStart=/bin/bash -lc 'source /opt/ros/humble/setup.bash && ros2 run ros_gz_bridge parameter_bridge \
  /world/baylands/model/x500_mono_cam_0/link/camera_link/sensor/imager/image@sensor_msgs/msg/Image@gz.msgs.Image \
  --remap /world/baylands/model/x500_mono_cam_0/link/camera_link/sensor/imager/image:=/drone1/camera \
  /world/baylands/model/x500_mono_cam_1/link/camera_link/sensor/imager/image@sensor_msgs/msg/Image@gz.msgs.Image \
  --remap /world/baylands/model/x500_mono_cam_1/link/camera_link/sensor/imager/image:=/drone2/camera \
  /world/baylands/model/x500_mono_cam_2/link/camera_link/sensor/imager/image@sensor_msgs/msg/Image@gz.msgs.Image \
  --remap /world/baylands/model/x500_mono_cam_2/link/camera_link/sensor/imager/image:=/drone3/camera \
  /world/baylands/model/x500_mono_cam_3/link/camera_link/sensor/imager/image@sensor_msgs/msg/Image@gz.msgs.Image \
  --remap /world/baylands/model/x500_mono_cam_3/link/camera_link/sensor/imager/image:=/drone4/camera'
Restart=on-failure
RestartSec=10

[Install]
WantedBy=default.target
```

**Reload and restart:**
```bash
systemctl --user daemon-reload
systemctl --user restart ros-gz-bridge
```

### Step 4: Restart web_video_server

The camera streaming service must be restarted to detect the new camera topic:

```bash
docker restart sim_camera_node
```

### Step 5: Verify Complete Setup

```bash
# 1. PX4 service running
systemctl --user status px4-drone${N}

# 2. Gazebo model exists
gz model --list | grep x500_mono_cam_${I}

# 3. drone_core publishing state
source ~/ws_droneOS/install/setup.bash
ros2 topic echo /drone${N}/drone_state --once

# 4. Camera topic publishing
ros2 topic hz /drone${N}/camera

# 5. Camera stream accessible
curl -I http://localhost:8080/stream?topic=/drone${N}/camera

# 6. Drone responds to commands (from VPS)
cd /root/ws_droneOS
python3 -c "import drone_control as dc; dc.set_drone_name('drone${N}'); print(dc.get_state())"
```

**Expected results:**
- PX4 service: `active (running)`
- Gazebo model: `x500_mono_cam_${I}` in list
- drone_state: Valid message with position/battery data
- Camera: Publishing at ~20-30 Hz
- Stream: HTTP 200 OK
- Commands: Returns drone state (armed, mode, position)

---

## Camera Setup Deep Dive

### Camera Pipeline Architecture

```
Gazebo sensor → ros_gz_bridge (systemd) → /droneX/camera (ROS2) → web_video_server (Docker :8080)
```

### Camera Model Naming Convention

PX4 multi-instance spawning follows this pattern:
- Instance 0 (`-i 0`): `x500_mono_cam_0` ✅ spawned automatically with camera
- Instance 1+ (`-i 1`, `-i 2`...): `x500_mono_cam_1`, `x500_mono_cam_2` ✅ spawned automatically with camera **when using the correct launch method**

**Critical:** The systemd service method shown in Step 1 uses:
- `PX4_GZ_MODEL_POSE` to position the drone
- `PX4_SIM_MODEL=gz_x500_mono_cam` to specify the camera-equipped model
- `./bin/px4 -i ${I}` to set the instance ID

This ensures PX4 spawns the model with the correct name pattern including the camera sensor.

### Verifying Camera Sensor

After spawning a new drone, verify the camera sensor exists:

```bash
# Check model exists
gz model --list | grep x500_mono_cam_${I}

# Verify camera sensor attached
gz model -m x500_mono_cam_${I} -l camera_link -s | grep 'Name:'
```

**Expected output:**
```
- Name: camera_link
    - Name: imager
```

If `imager` is missing, the model spawned without a camera. See Troubleshooting below.

### Camera Bridge Topic Pattern

The ros_gz_bridge uses this Gazebo topic pattern:
```
/world/{WORLD_NAME}/model/{MODEL_NAME}/link/camera_link/sensor/imager/image
```

**Key points:**
- `{WORLD_NAME}` = `baylands` (or whatever `PX4_GZ_WORLD` is set to)
- `{MODEL_NAME}` = `x500_mono_cam_{instance}`
- Topic name **includes the world name** — if you change worlds, you must update the bridge

**Remapping to ROS2:**
```bash
--remap /world/baylands/model/x500_mono_cam_0/link/camera_link/sensor/imager/image:=/drone1/camera
```

This creates the clean `/drone1/camera` topic that web_video_server and the frontend consume.

---

## Full Restart Procedure

After srv01 reboot or when services are broken:

```bash
# === STEP 1: Stop and clean PX4 ===
ssh rodrigo@<tailscale-ip> "systemctl --user stop px4-drone3 px4-drone2 px4-sitl"
ssh rodrigo@<tailscale-ip> "killall -9 px4 2>/dev/null; pkill -9 -f 'gz sim' 2>/dev/null"
ssh rodrigo@<tailscale-ip> "rm -f /tmp/px4-daemon-app-*.lock ~/PX4-Autopilot/build/px4_sitl_default/rootfs/*.lock ~/PX4-Autopilot/build/px4_sitl_default/rootfs/[0-9]/*.lock"

# === STEP 2: Start PX4 services (all drones) ===
ssh rodrigo@<tailscale-ip> "systemctl --user start px4-sitl"
# px4-drone2 and px4-drone3 auto-start after px4-sitl (After= dependency)
# Wait ~45s total for all to initialize
sleep 45
ssh rodrigo@<tailscale-ip> "systemctl --user is-active px4-sitl px4-drone2 px4-drone3"
# All should say "active"

# === STEP 3: Restart srv01 services (ORDER MATTERS) ===
ssh rodrigo@<tailscale-ip> "docker restart micro_agent_service"
sleep 5
ssh rodrigo@<tailscale-ip> "docker restart drone_core_node drone_core_node2 drone_core_node3"
sleep 3
ssh rodrigo@<tailscale-ip> "docker restart rosbridge_server"
ssh rodrigo@<tailscale-ip> "systemctl --user restart ros-gz-bridge"
sleep 3
ssh rodrigo@<tailscale-ip> "docker restart sim_camera_node"  # LAST — needs camera topics

# === STEP 4: Verify ===
ssh rodrigo@<tailscale-ip> "gz model --list | grep x500"
ssh rodrigo@<tailscale-ip> "source ~/ws_droneOS/install/setup.bash && ros2 topic list | grep -E 'drone[123]/camera'"
```

**Restart order is critical:**
1. PX4 instances (spawns Gazebo + drone models)
2. micro_agent (connects PX4 to ROS2)
3. drone_core nodes (SDK for each drone)
4. rosbridge (WebSocket bridge)
5. ros-gz-bridge (camera bridge)
6. sim_camera_node (web_video_server) — **MUST be last**, needs camera topics to exist

---

## Troubleshooting

### 1. Drone spawned without camera

**Symptom:** `gz model --list` shows `x500_1` instead of `x500_mono_cam_1`

**Cause:** PX4 multi-instance spawning didn't respect `PX4_GZ_MODEL=gz_x500_mono_cam`

**Solution:** Use the systemd service method shown in Step 1, which properly sets:
- `PX4_SIM_MODEL=gz_x500_mono_cam`
- `PX4_GZ_MODEL_POSE=0,{Y_OFFSET},0,0,0,0`

If the model already spawned incorrectly, delete it and restart:
```bash
systemctl --user restart px4-drone${N}
```

### 2. Camera topic exists but not publishing

**Symptom:** `ros2 topic list` shows `/droneN/camera` but `ros2 topic hz` times out

**Diagnosis:**
```bash
# Check if Gazebo sensor exists
gz model -m x500_mono_cam_${I} -l camera_link -s | grep imager

# Check ros_gz_bridge logs
journalctl --user -u ros-gz-bridge -f
```

**Solutions:**
- Verify bridge service includes the correct world name and model name
- Restart bridge: `systemctl --user restart ros-gz-bridge`
- Restart web_video_server: `docker restart sim_camera_node`

### 3. web_video_server won't stream new camera

**Symptom:** `/droneN/camera` topic publishes data (verified with `ros2 topic hz`), but `curl http://localhost:8080/stream?topic=/droneN/camera` hangs

**Cause:** web_video_server doesn't auto-detect topics added after startup

**Solution:**
```bash
docker restart sim_camera_node
```

Then verify both streams work:
```bash
curl -I http://localhost:8080/stream?topic=/drone1/camera
curl -I http://localhost:8080/stream?topic=/droneN/camera
```

### 4. PX4 service fails to start

**Symptom:** `systemctl --user status px4-droneN` shows `failed`

**Diagnosis:**
```bash
journalctl --user -u px4-droneN -n 50
```

**Common causes:**
- Lock file from previous instance: `rm -f /tmp/px4-daemon-app-${I}.lock`
- Gazebo not ready: Increase `ExecStartPre=/bin/sleep 25` delay
- Wrong working directory: Verify `WorkingDirectory=/home/rodrigo/PX4-Autopilot/build/px4_sitl_default`

### 5. drone_core can't connect to PX4

**Symptom:** `ros2 topic echo /droneN/drone_state` shows no data

**Diagnosis:**
```bash
# Check if PX4 is publishing
source ~/ws_droneOS/install/setup.bash
ros2 topic list | grep /px4_${I}/fmu/

# Check micro_agent logs
docker logs micro_agent_service | tail -20
```

**Solution:**
- Ensure `micro_agent_service` started **after** PX4 instances
- Verify namespace matches: drone_core uses `/px4_${I}/fmu/`, PX4 must publish there
- Restart in correct order: PX4 → micro_agent → drone_core

### 6. World name changed, cameras broken

**Symptom:** After changing `PX4_GZ_WORLD` from `baylands` to `lawn`, camera topics stop publishing

**Cause:** ros_gz_bridge topic paths include the world name (`/world/baylands/...`)

**Solution:**
Edit `~/.config/systemd/user/ros-gz-bridge.service` and replace all instances of `baylands` with the new world name, then:
```bash
systemctl --user daemon-reload
systemctl --user restart ros-gz-bridge
```

---

## Gazebo Worlds

Available worlds in PX4:
- `default` — Empty world with ground plane
- `baylands` — Outdoor environment with terrain (current default)
- `lawn` — Grassy area
- `windy` — World with wind effects

### Changing Worlds

Edit all PX4 systemd services (`px4-sitl.service`, `px4-drone2.service`, etc.) and update:
```ini
Environment=PX4_GZ_WORLD=lawn
```

Then update the ros-gz-bridge service to match (see Troubleshooting §6).

Restart everything:
```bash
systemctl --user daemon-reload
systemctl --user restart px4-sitl px4-drone2 px4-drone3
systemctl --user restart ros-gz-bridge
```

**World files location:** `~/PX4-Autopilot/Tools/simulation/gz/worlds/`

---

## Manual Drone Operations (Alternative to Systemd)

If you need to run a drone instance manually for testing:

```bash
cd ~/PX4-Autopilot
PX4_GZ_STANDALONE=1 \
  PX4_GZ_WORLD=baylands \
  PX4_GZ_MODEL_POSE="0,6,0,0,0,0" \
  PX4_SIM_MODEL=gz_x500_mono_cam \
  HEADLESS=1 \
  ./build/px4_sitl_default/bin/px4 -i 3
```

**Not recommended for production** — loses on reboot, harder to manage. Use systemd services instead.

---

## Frontend Integration

The DroneOS web frontend (`:3000`) automatically discovers and displays all drones publishing `/droneN/drone_state` topics.

**No frontend changes needed when adding drones** — it dynamically:
- Discovers drones via ROS topic scan
- Renders camera PiP feeds for each drone
- Routes commands to the correct drone based on selection

**Camera feed URLs:**
- drone1: `http://<tailscale-ip>:8080/stream?topic=/drone1/camera`
- drone2: `http://<tailscale-ip>:8080/stream?topic=/drone2/camera`
- droneN: `http://<tailscale-ip>:8080/stream?topic=/droneN/camera`

---

## Reference

### Service Startup Order (on boot)

1. **px4-sitl** starts → spawns Gazebo + drone1 PX4
2. **px4-drone2** starts 20s later → spawns drone2 in Gazebo
3. **px4-drone3** starts 25s later → spawns drone3 in Gazebo
4. **ros-gz-bridge** starts 15s after px4-sitl → camera topics appear
5. **Docker containers** auto-start with Docker daemon:
   - micro_agent_service
   - drone_core_node, drone_core_node2, drone_core_node3
   - rosbridge_server
   - sim_camera_node

**Total boot time:** ~60 seconds until all drones are fully operational.

### Key Files and Paths

- **Systemd services:** `~/.config/systemd/user/px4-*.service`, `ros-gz-bridge.service`
- **Docker compose:** `~/ws_droneOS/docker/dev/docker-compose*.yml`
- **PX4 build:** `~/PX4-Autopilot/build/px4_sitl_default/`
- **PX4 parameters:** `~/PX4-Autopilot/build/px4_sitl_default/etc/init.d-posix/px4-rc.params`
- **Gazebo worlds:** `~/PX4-Autopilot/Tools/simulation/gz/worlds/`
- **Gazebo models:** `~/PX4-Autopilot/Tools/simulation/gz/models/`

### PX4 Parameters (Critical)

These must be set for offboard control without RC:
- `COM_RC_IN_MODE = 4` — No RC input required
- `COM_RCL_EXCEPT = 4` — Allow offboard without RC
- `NAV_DLL_ACT = 0` — No action on datalink loss

**These are persisted** in `px4-rc.params` and apply automatically on every PX4 startup.

---

## See Also

- `PREFLIGHT_CHECKLIST.md` — Pre-flight verification steps
- `TROUBLESHOOTING.md` — Common issues and fixes
- `docs/COORDINATE_FRAMES.md` — Local vs global coordinates
- `docs/DISPATCH_ARCHITECTURE.md` — AI dispatch system architecture
