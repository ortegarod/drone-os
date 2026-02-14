# Multi-Drone Simulation Setup

## Overview

DroneOS supports running multiple simulated drones in Gazebo for fleet coordination, multi-agent missions, and demo scenarios.

## Service Architecture (srv01)

srv01 runs simulation services in two layers:

### Systemd User Services (`~/.config/systemd/user/`)

| Service | Description | Auto-start |
|---------|-------------|------------|
| `px4-sitl` | PX4 drone1 + Gazebo (baylands world) | ✅ on boot |
| `ros-gz-bridge` | Camera bridge: Gazebo → `/droneX/camera` ROS topics | ✅ 15s after px4-sitl |

```bash
systemctl --user start|stop|restart|status px4-sitl
systemctl --user start|stop|restart|status ros-gz-bridge
journalctl --user -u <service> -f
```

### Docker Containers (`docker/dev/docker-compose.dev.yml`)

| Container | Image | Port | Purpose |
|-----------|-------|------|---------|
| `micro_agent_service` | dev-micro_agent | UDP 8888 | XRCE-DDS bridge (PX4↔ROS2) |
| `drone_core_node` | dev-drone_core | — | drone1 SDK (ns: `/fmu/`, MAV_SYS_ID=1) |
| `drone_core_node2` | dev-drone_core2 | — | drone2 SDK (ns: `/px4_1/fmu/`, MAV_SYS_ID=2) |
| `rosbridge_server` | ros:humble | TCP 9090 | WebSocket JSON→ROS2 bridge |
| `sim_camera_node` | dev-sim_camera | TCP 8080 | web_video_server (MJPEG streams) |

All use `network_mode: host` and `restart: unless-stopped`.

```bash
cd ~/ws_droneOS

# Start drone1 stack
docker compose -f docker/dev/docker-compose.dev.yml up -d drone_core micro_agent sim_camera rosbridge

# Start drone2 core
docker compose -f docker/dev/docker-compose.dev.yml -f docker/dev/docker-compose.drone2.yml up -d drone_core2

# Logs
docker logs -f <container_name>
```

### Manual Process (drone2 PX4)

drone2 PX4 is **not** managed by systemd or Docker. Must be launched manually after Gazebo is up:

```bash
cd ~/PX4-Autopilot
PX4_GZ_STANDALONE=1 PX4_GZ_WORLD=baylands \
  PX4_GZ_MODEL_POSE="0,2,0,0,0,0" \
  PX4_SIM_MODEL=gz_x500_mono_cam \
  HEADLESS=1 \
  ./build/px4_sitl_default/bin/px4 -i 1
```

> ⚠️ **Lost on reboot.** Must re-run manually.

Verify: `gz model --list | grep x500` should show `x500_mono_cam_0` AND `x500_mono_cam_1`.

---

## Camera Pipeline

```
Gazebo sensor → ros_gz_bridge (systemd) → /droneX/camera (ROS2) → web_video_server (Docker :8080)
```

> ⚠️ **World name dependency:** ros-gz-bridge topic paths include the world name (`/world/baylands/model/...`). If you change `PX4_GZ_WORLD`, you **must** update the bridge service to match. See TROUBLESHOOTING.md §8.

Test cameras:
```bash
curl "http://localhost:8080/snapshot?topic=/drone1/camera" -o test.jpg && file test.jpg
curl "http://localhost:8080/snapshot?topic=/drone2/camera" -o test.jpg && file test.jpg
```

---

## Full Restart Procedure

After srv01 reboot:

1. `px4-sitl` auto-starts → drone1 + Gazebo
2. `ros-gz-bridge` auto-starts → camera bridge (15s delay)
3. Docker containers auto-restart → drone_core, rosbridge, web_video_server
4. **Manual:** Launch drone2 PX4 (see command above)
5. **Verify:** `gz model --list` shows both models, `ros2 topic hz /droneX/camera` shows data

---

## Drone Configuration

| Drone | PX4 Instance | MAV_SYS_ID | Namespace | Position | Management |
|-------|-------------|------------|-----------|----------|------------|
| drone1 | 0 | 1 | `/fmu/` | origin | systemd (px4-sitl) |
| drone2 | 1 | 2 | `/px4_1/fmu/` | (0, 2) | manual (nohup) |

### Adding drone3+

Same pattern — increment instance ID, MAV_SYS_ID, and namespace:

| Drone | Instance | MAV_SYS_ID | Namespace | Spawn Pose |
|-------|----------|------------|-----------|------------|
| drone3 | 2 | 3 | `/px4_2/fmu/` | "2,0,0,0,0,0" |

Requires: new drone_core container, PX4 launch, and bridge update for camera.

---

## Running drone_core for Each Drone

Each drone needs its own `drone_core` instance. drone1 and drone2 run in separate Docker containers (see above). For additional drones, either:

1. Create another docker-compose override (like `docker-compose.drone2.yml`)
2. Or run inside an existing container:

```bash
docker exec -it drone_core_node bash
source /opt/ros/humble/setup.bash && source ~/ws_droneOS/install/setup.bash
ros2 run drone_core drone_core --ros-args \
  -r __node:=drone3 -p drone_name:=drone3 \
  -p px4_namespace:=/px4_2/fmu/ -p mav_sys_id:=3
```

---

## Verifying Setup

```bash
# ROS2 services
ros2 service list | grep -E "drone[123]"

# Telemetry
ros2 topic list | grep -E "drone[123]"

# Camera feeds
ros2 topic hz /drone1/camera
ros2 topic hz /drone2/camera

# Gazebo models
gz model --list | grep x500
```

---

## Duplicate Process Prevention

Only Docker + systemd should manage processes. If you see bare `nohup` processes (other than drone2 PX4), kill them:

```bash
# Check for duplicates
docker ps
systemctl --user list-units --state=running | grep -E "(px4|ros-gz)"
pgrep -af "drone_core|web_video|rosbridge"
```

Docker containers run as root inside containers. Systemd services run as user `rodrigo`. Never start services both ways simultaneously.

---

## Troubleshooting

See `TROUBLESHOOTING.md` for common issues. Key ones:
- §3: Multi-drone spawning
- §5: Drone2 camera not publishing
- §8: Camera feeds broken after world change

## See Also

- `docs/MULTI_DRONE_CAMERAS.md` — Camera-specific setup details
- `PREFLIGHT_CHECKLIST.md` — Pre-flight verification
- `TROUBLESHOOTING.md` — Common issues and fixes
