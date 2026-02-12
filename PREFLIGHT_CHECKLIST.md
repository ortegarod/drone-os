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
