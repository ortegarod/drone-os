# Preflight Checklist

**Architecture:**
- **VPS** (207.148.9.142) — Fleet Command Center (frontend, OpenClaw, relay/proxy)
- **srv01** (<tailscale-ip>) — Simulation Server (PX4, Gazebo, drone_core)

**Quick Service Commands:**
```bash
# srv01 - Check all services
ssh rodrigo@<tailscale-ip> "systemctl --user status px4-sitl ros-gz-bridge"
ssh rodrigo@<tailscale-ip> "docker ps"

# srv01 - Restart specific service
ssh rodrigo@<tailscale-ip> "systemctl --user restart px4-sitl"
ssh rodrigo@<tailscale-ip> "docker restart sim_camera_node"

# VPS - Check all services
docker ps
systemctl status openclaw

# VPS - Restart specific service
docker restart camera_proxy_node
systemctl restart openclaw
```

---

## 0) Mission Scope
- [ ] Confirm target drone (`drone1` / `drone2`)
- [ ] Confirm simulation (not real hardware)
- [ ] Operator ready to abort if needed

## 1) srv01 Services

### Service Architecture

| Service | Type | User | Port | Purpose | Restart Command |
|---------|------|------|------|---------|-----------------|
| `px4-sitl` | systemd | rodrigo | — | PX4 drone1 + Gazebo (baylands) | `ssh rodrigo@<tailscale-ip> "systemctl --user restart px4-sitl"` |
| `ros-gz-bridge` | systemd | rodrigo | — | Camera bridge: Gazebo → `/droneX/camera` | `ssh rodrigo@<tailscale-ip> "systemctl --user restart ros-gz-bridge"` |
| `micro_agent_service` | Docker | root (in container) | UDP 8888 | XRCE-DDS bridge (PX4↔ROS2) | `ssh rodrigo@<tailscale-ip> "docker restart micro_agent_service"` |
| `drone_core_node` | Docker | root (in container) | — | drone1 SDK (ns: `/fmu/`, MAV_SYS_ID=1) | `ssh rodrigo@<tailscale-ip> "docker restart drone_core_node"` |
| `drone_core_node2` | Docker | root (in container) | — | drone2 SDK (ns: `/px4_1/fmu/`, MAV_SYS_ID=2) | `ssh rodrigo@<tailscale-ip> "docker restart drone_core_node2"` |
| `rosbridge_server` | Docker | root (in container) | TCP 9090 | WebSocket JSON→ROS2 bridge | `ssh rodrigo@<tailscale-ip> "docker restart rosbridge_server"` |
| `sim_camera_node` (web_video_server) | Docker | root (in container) | TCP 8080 | MJPEG camera streams | `ssh rodrigo@<tailscale-ip> "docker restart sim_camera_node"` |
| drone2 PX4 | manual (nohup) | rodrigo | — | PX4 instance 1 for drone2 | Kill & relaunch (see MULTI_DRONE_SETUP.md) |

**Notes:**
- All Docker containers use `network_mode: host` and `restart: unless-stopped`
- `px4-sitl` auto-starts on boot
- `ros-gz-bridge` auto-starts 15s after `px4-sitl`
- Docker containers auto-restart with Docker daemon
- drone2 PX4 is **not persistent** — must be manually launched after reboot

### Verification Checklist

- [ ] PX4/Gazebo SITL running for target drone
- [ ] `drone_core_node` running (+ `drone_core_node2` if multi-drone)
- [ ] `rosbridge_server` running
- [ ] `micro_agent_service` running
- [ ] `ros-gz-bridge` running
- [ ] `sim_camera_node` (web_video_server) running
- [ ] `/droneN/drone_state` topic present
- [ ] `/droneN/camera` topic present (graph-level check)
- [ ] Gazebo model exists for target camera (`x500_mono_cam_0`/`x500_mono_cam_1`)
- [ ] `/droneN/camera` actively publishing (`ros2 topic hz`, not just list)
- [ ] `ros-gz-bridge` remaps camera topics for all active drones

### Multi-Drone Camera Verification

For drone2+ with cameras, verify **both** Gazebo model AND camera bridge:

```bash
# 1. Check Gazebo models (on srv01)
ssh rodrigo@<tailscale-ip> "gz model --list | grep x500"
# Expected: x500_mono_cam_0, x500_mono_cam_1, ...

# 2. Verify camera sensors exist
ssh rodrigo@<tailscale-ip> "gz model -m x500_mono_cam_1 -l camera_link -s | grep 'Name:'"
# Expected: camera_link, imager

# 3. Check ROS camera topics
ssh rodrigo@<tailscale-ip> "source /opt/ros/humble/setup.bash && ros2 topic list | grep camera"
# Expected: /drone1/camera, /drone2/camera

# 4. Verify publishing rate
ssh rodrigo@<tailscale-ip> "source /opt/ros/humble/setup.bash && timeout 3 ros2 topic hz /drone1/camera"
ssh rodrigo@<tailscale-ip> "source /opt/ros/humble/setup.bash && timeout 3 ros2 topic hz /drone2/camera"
# Expected: ~20-30 Hz for both

# 5. Test camera proxy (from VPS)
timeout 3 curl -s "http://localhost:8080/stream?topic=/drone1/camera&type=mjpeg&width=100&height=100" | head -c 1000 | wc -c
timeout 3 curl -s "http://localhost:8080/stream?topic=/drone2/camera&type=mjpeg&width=100&height=100" | head -c 1000 | wc -c
# Expected: 1000 bytes for both (indicates stream is working)
```

**Common Issues:**

1. **drone2 spawned as `x500_1` (no camera) instead of `x500_mono_cam_1`**
   - **Solution:** See `docs/MULTI_DRONE_CAMERAS.md` for manual spawn procedure

2. **drone2 camera topic exists but web_video_server won't stream it**
   - **Symptom:** `/drone2/camera` publishes data, but `curl http://<tailscale-ip>:8080/stream?topic=/drone2/camera` hangs or times out
   - **Cause:** `web_video_server` doesn't auto-detect new topics after startup
   - **Solution:** Restart web_video_server on srv01:
     ```bash
     ssh rodrigo@<tailscale-ip> "docker restart sim_camera_node"
     ```
   - **Verification:** Both drone1 and drone2 streams should return image data immediately

```bash
ssh rodrigo@<tailscale-ip> "docker ps --format '{{.Names}}: {{.Status}}'"
```

```bash
# On srv01, verify simulation model presence and camera publish rate
ssh rodrigo@<tailscale-ip> "gz model --list"
ssh rodrigo@<tailscale-ip> "bash -lc 'source /opt/ros/humble/setup.bash; ros2 topic hz /drone2/camera'"

# For drone_state message inspection, source workspace interfaces too
ssh rodrigo@<tailscale-ip> "bash -lc 'source /opt/ros/humble/setup.bash; source ~/ws_droneOS/install/setup.bash; ros2 topic echo /drone2/drone_state --once'"
```

## 2) VPS Services

### Service Architecture

| Service | Type | User | Port | Purpose | Restart Command |
|---------|------|------|---------|---------|-----------------|
| Frontend | Docker | root (in container) | TCP 3000 | React web UI | `docker restart frontend` |
| rosbridge_relay | Docker | root (in container) | TCP 9090 | WebSocket relay: Frontend ↔ srv01 rosbridge | `docker restart rosbridge_relay` |
| camera_proxy_node | Docker | root (in container) | TCP 8080 | MJPEG proxy: Frontend ↔ srv01 web_video_server | `docker restart camera_proxy_node` |
| OpenClaw | native | root | TCP 3031 | AI agent backend | `systemctl restart openclaw` |

**Notes:**
- All services run on VPS (207.148.9.142)
- Frontend connects to local relays (`:9090`, `:8080`) which forward to srv01 over Tailscale
- OpenClaw runs as native systemd service, not Docker

### Verification Checklist

- [ ] Frontend (`:3000`) accessible
- [ ] rosbridge relay (`:9090`) forwarding to srv01
- [ ] camera proxy (`:8080`) streaming from srv01
- [ ] OpenClaw (`:3031`) responding

```bash
docker ps --format '{{.Names}}: {{.Status}}'
curl -I http://localhost:3000
curl -I http://localhost:8080
systemctl status openclaw
```

## 3) PX4 Parameters
- [ ] `COM_RC_IN_MODE = 4`
- [ ] `COM_RCL_EXCEPT = 4`
- [ ] `NAV_DLL_ACT = 0`

## 4) Flight Gates (in order)
1. [ ] `set_offboard()` → confirm `nav_state == OFFBOARD`
2. [ ] `arm()` → confirm `arming_state == ARMED`
3. [ ] `takeoff()` → altitude increases ~10m within 15s
4. [ ] Mission / waypoints
5. [ ] `land()` → vehicle disarms cleanly

**If any gate fails → STOP. See TROUBLESHOOTING.md.**

## 5) Post-Flight
- [ ] Log pass/fail and failure point
- [ ] Record any parameter or service changes made
