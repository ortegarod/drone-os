# srv01 Services Reference

> **Machine:** srv01 (Tailscale: <tailscale-ip>)  
> **User:** rodrigo  
> **Role:** Simulation host (PX4 + Gazebo + ROS2)

---

## Service Architecture

```
┌─ systemd user services ─────────────────────────────┐
│  px4-sitl.service          → PX4 drone1 + Gazebo    │
│  ros-gz-bridge.service     → Camera bridge (baylands)│
└──────────────────────────────────────────────────────┘

┌─ Docker containers ──────────────────────────────────┐
│  micro_agent_service       → XRCE-DDS Agent (UDP:8888)│
│  drone_core_node           → drone1 SDK              │
│  drone_core_node2          → drone2 SDK              │
│  rosbridge_server          → WebSocket bridge (:9090)│
│  sim_camera_node           → web_video_server (:8080)│
└──────────────────────────────────────────────────────┘

┌─ Manual process (NOT auto-started) ──────────────────┐
│  drone2 PX4 (nohup)       → PX4 instance 1          │
└──────────────────────────────────────────────────────┘
```

---

## Systemd User Services

Located in `~/.config/systemd/user/`

### px4-sitl.service
- **What:** PX4 SITL drone1 + Gazebo server (baylands world)
- **Auto-start:** Yes (enabled)
- **Restart:** on-failure
- **Commands:**
  ```bash
  systemctl --user start|stop|restart|status px4-sitl
  journalctl --user -u px4-sitl -f
  ```

### ros-gz-bridge.service
- **What:** Bridges Gazebo camera topics → ROS2 `/drone1/camera` + `/drone2/camera`
- **World:** baylands (must match PX4_GZ_WORLD)
- **Auto-start:** Yes (enabled, 15s delay after px4-sitl)
- **Restart:** on-failure
- **Commands:**
  ```bash
  systemctl --user start|stop|restart|status ros-gz-bridge
  journalctl --user -u ros-gz-bridge -f
  ```

> ⚠️ **If you change PX4_GZ_WORLD**, you must also update the topic paths in ros-gz-bridge.service to match (`/world/<WORLD_NAME>/model/...`).

---

## Docker Containers

Started via docker-compose from `~/ws_droneOS/docker/dev/`

### Start all
```bash
cd ~/ws_droneOS
docker compose -f docker/dev/docker-compose.dev.yml up -d drone_core micro_agent sim_camera rosbridge
docker compose -f docker/dev/docker-compose.dev.yml -f docker/dev/docker-compose.drone2.yml up -d drone_core2
```

### Individual containers

| Container | Image | Port | Purpose |
|-----------|-------|------|---------|
| `micro_agent_service` | dev-micro_agent | UDP 8888 | XRCE-DDS bridge (PX4↔ROS2) |
| `drone_core_node` | dev-drone_core | — | drone1 SDK (ns: `/fmu/`, MAV_SYS_ID=1) |
| `drone_core_node2` | dev-drone_core2 | — | drone2 SDK (ns: `/px4_1/fmu/`, MAV_SYS_ID=2) |
| `rosbridge_server` | ros:humble | TCP 9090 | WebSocket JSON→ROS2 bridge |
| `sim_camera_node` | dev-sim_camera | TCP 8080 | MJPEG stream server (web_video_server) |

All use `network_mode: host`, `restart: unless-stopped`.

### Logs
```bash
docker logs -f <container_name>
```

---

## Drone2 PX4 (Manual Launch)

**Not managed by systemd or Docker.** Must be launched manually after drone1/Gazebo is up.

```bash
cd ~/PX4-Autopilot
PX4_GZ_STANDALONE=1 PX4_GZ_WORLD=baylands \
  PX4_GZ_MODEL_POSE="0,2,0,0,0,0" \
  PX4_SIM_MODEL=gz_x500_mono_cam \
  HEADLESS=1 \
  ./build/px4_sitl_default/bin/px4 -i 1
```

**Verify spawn:**
```bash
gz model --list | grep x500
# Should show: x500_mono_cam_0 AND x500_mono_cam_1
```

> ⚠️ **Lost on reboot.** Must re-run manually or create a systemd service.

---

## Ports Summary

| Port | Protocol | Service | Location |
|------|----------|---------|----------|
| 8888 | UDP | XRCE-DDS Agent | srv01 |
| 8080 | TCP | web_video_server (MJPEG) | srv01 |
| 9090 | TCP | rosbridge WebSocket | srv01 |

---

## Camera Pipeline

```
Gazebo sensor → ros_gz_bridge (systemd) → /droneX/camera (ROS2 topic) → web_video_server (Docker) → HTTP :8080
```

**Test locally:**
```bash
curl "http://localhost:8080/snapshot?topic=/drone1/camera" -o test.jpg && file test.jpg
curl "http://localhost:8080/snapshot?topic=/drone2/camera" -o test.jpg && file test.jpg
```

---

## Full Restart Procedure

After reboot:

1. `px4-sitl.service` auto-starts (drone1 + Gazebo)
2. `ros-gz-bridge.service` auto-starts (15s delay)
3. Docker containers auto-start (`restart: unless-stopped`)
4. **Manual:** Launch drone2 PX4 (see above)
5. **Verify:** `gz model --list | grep x500` shows both models

---

## Troubleshooting

**Camera not working?**
1. Check Gazebo models: `gz model --list | grep x500`
2. Check ROS topic: `source /opt/ros/humble/setup.bash && ros2 topic hz /drone1/camera`
3. Check web_video_server: `curl http://localhost:8080/snapshot?topic=/drone1/camera -o test.jpg`
4. Check bridge world name matches PX4_GZ_WORLD

**Duplicate processes?**
```bash
docker ps                                          # Docker containers
systemctl --user list-units --state=running        # Systemd services
pgrep -af "drone_core|web_video|rosbridge"         # Bare processes
```
Only Docker + systemd should be running. Kill any bare `nohup` stragglers.
