# Preflight Checklist

**Architecture:**
- **VPS** (207.148.9.142) — Fleet Command Center (frontend, OpenClaw, relay/proxy)
- **srv01** (<tailscale-ip>) — Simulation Server (PX4, Gazebo, drone_core)

---

## 0) Mission Scope
- [ ] Confirm target drone (`drone1` / `drone2`)
- [ ] Confirm simulation (not real hardware)
- [ ] Operator ready to abort if needed

## 1) srv01 Services
- [ ] PX4/Gazebo SITL running for target drone
- [ ] `drone_core_node` running (+ `drone_core_node2` if multi-drone)
- [ ] `rosbridge_server` running
- [ ] `micro_agent_service` running
- [ ] `ros-gz-bridge` running
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

**Common Issue:** drone2 spawned as `x500_1` (no camera) instead of `x500_mono_cam_1`
- **Solution:** See `docs/MULTI_DRONE_CAMERAS.md` for manual spawn procedure

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
- [ ] Frontend (`:3000`)
- [ ] rosbridge relay (`:9090`)
- [ ] camera proxy (`:8080`)
- [ ] OpenClaw proxy (`:3031`)

```bash
docker ps --format '{{.Names}}: {{.Status}}'
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
