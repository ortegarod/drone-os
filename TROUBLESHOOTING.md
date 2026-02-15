# Troubleshooting Guide

> 📖 **Setting up multi-drone?** See [`docs/MULTI_DRONE_SETUP.md`](docs/MULTI_DRONE_SETUP.md) for complete setup instructions and troubleshooting.

## Table of Contents
1. [Offboard Won't Engage](#1-offboard-wont-engage)
2. [Arm Fails After Offboard](#2-arm-fails-after-offboard)
3. [Multi-Drone Spawning](#3-multi-drone-spawning)
4. [Frontend: Camera Feed Won't Switch](#4-frontend-camera-feed-wont-switch)
5. [Drone2 Camera Not Publishing](#5-drone2-camera-not-publishing)
6. [Frontend: Unclear Active Drone](#6-frontend-unclear-active-drone)
7. [PX4 Startup Failures](#7-px4-startup-failures)

---

## 1) Offboard Won't Engage

**Symptom:** `set_offboard()` called but `nav_state` stays `AUTO_LOITER`.

### Check PX4 is running
```bash
# On srv01
pgrep -af "px4|px4_sitl"
systemctl --user is-active px4-sitl
source /opt/ros/humble/setup.bash
ros2 topic list | egrep '^/fmu/|^/px4_1/fmu/'
```
- Process + FMU topics present → PX4 is running
- Both missing → PX4 is down, relaunch first

### Check PX4 parameters
```bash
# In PX4 shell
param show COM_RC_IN_MODE    # Must be 4
param show COM_RCL_EXCEPT    # Must be 4
param show NAV_DLL_ACT       # Must be 0
```
Fix if wrong:
```bash
param set COM_RC_IN_MODE 4
param set COM_RCL_EXCEPT 4
param set NAV_DLL_ACT 0
param save
```

### Check offboard heartbeat
Offboard requires active setpoint stream (>2Hz) for at least ~1s before transition. Ensure heartbeat is running before calling `set_offboard()`.

### Validate FMU health
```bash
# On srv01
ros2 topic info /fmu/out/vehicle_local_position   # Publisher count > 0
timeout 8s ros2 topic echo --once /fmu/out/vehicle_status
timeout 8s ros2 topic echo --once /fmu/out/failsafe_flags
```

---

## 2) Arm Fails After Offboard

**Symptom:** `nav_state == OFFBOARD` but `arm()` rejected, `can_arm: false`.

- Check `NAV_DLL_ACT = 0` (datalink-loss action blocks arm in no-GCS sim)
- Check `pre_flight_checks_pass` in failsafe flags
- Check `estimator_status_flags`
- Retry arm immediately after confirming OFFBOARD still active

---

## 3) Multi-Drone Spawning

> 📖 **For complete multi-drone setup instructions, see [`docs/MULTI_DRONE_SETUP.md`](docs/MULTI_DRONE_SETUP.md)**  
> This includes step-by-step drone addition, camera setup, and troubleshooting.

### Current setup (as of 2026-02-14)
- **drone1:** Managed by `px4-sitl.service` (systemd user) — runs `./bin/px4` directly, starts Gazebo
- **drone2:** Managed by `px4-drone2.service` (systemd user) — starts 20s after px4-sitl
- **drone3:** Managed by `px4-drone3.service` (systemd user) — starts 25s after px4-sitl
- **Docker:** `drone_core_node`, `drone_core_node2`, `drone_core_node3`, `rosbridge_server`, `sim_camera_node`, `micro_agent_service`

### Launch order
1. **Drone1** (auto via systemd `px4-sitl`): starts Gazebo + PX4 instance 0
2. **Drone2** (auto via systemd `px4-drone2`): starts 20s after drone1, attaches to existing Gazebo

```bash
# Restart both
systemctl --user restart px4-sitl px4-drone2
```

### Critical notes
- **All instances MUST set `PX4_GZ_WORLD=baylands`** — without it, standalone instances fail silently
- Both drones are systemd-managed and auto-start on boot
- Verify namespace routing: drone1 = `/fmu/`, drone2 = `/px4_1/fmu/`
- **Don't mix Docker and systemd/nohup for the same service** — causes duplicates

### Camera namespace fix
- Cherry-picked from PX4-gazebo-models PR #76 (commit `183cbee`)
- Without fix: all cameras publish to same `/camera` Gazebo topic → mixed frames
- Fix removes hardcoded `<topic>camera</topic>` from `mono_cam/model.sdf`
- Result: separate Gazebo topics per model instance
- ros-gz-bridge remaps to `/drone1/camera` and `/drone2/camera`

### Checking for duplicate processes
```bash
docker ps                                          # Docker containers
systemctl --user list-units --state=running        # Systemd services
pgrep -af "drone_core|web_video|rosbridge"         # Should only show Docker/systemd PIDs
```

---

## 4) Frontend: Camera Feed Won't Switch

**Symptom:** Click drone2 → camera stays on drone1 or shows "stream loading" forever. Going back to drone1 shows "stream live".

**Root cause:** `SimpleCameraFeed.tsx` mutates `<img src>` when drone changes, but browsers don't reliably tear down an active MJPEG connection on the same DOM element.

**Fix (applied 2026-02-12):** Added `key={streamUrl}` to the `<img>` tag and wrapped in `{streamUrl && ...}` guard in `SimpleCameraFeed.tsx`. Forces React to destroy/recreate the element on drone switch, guaranteeing a fresh MJPEG connection. Also prevents rendering with empty/invalid stream URL before discovery completes.

**File:** `web_interface/frontend/src/components/SimpleCameraFeed.tsx`

---

## 5) Drone2 Camera Not Publishing

> 📖 **For camera setup details, see [`docs/MULTI_DRONE_SETUP.md`](docs/MULTI_DRONE_SETUP.md) § Camera Setup Deep Dive**

**Symptom:** `/drone2/camera` topic exists but `ros2 topic hz` shows zero messages.

**Likely cause:** `ros-gz-bridge` only bridges drone1's camera. Drone2's Gazebo camera sensor has no bridge rule.

**Troubleshooting:**
```bash
# On srv01 — check bridge config
systemctl --user cat ros-gz-bridge

# Check Gazebo camera topics exist
gz topic -l | grep camera
# Expected: /world/baylands/model/x500_mono_cam_1/link/camera_link/sensor/imager/image

# Add drone2 camera to bridge config, then restart
systemctl --user restart ros-gz-bridge
```

**Status:** Fixed (2026-02-14). ros-gz-bridge systemd service configured for baylands world with both drones. PR #76 model.sdf fix enables proper per-instance Gazebo topics. Both `/drone1/camera` and `/drone2/camera` confirmed publishing (~28Hz and ~12Hz respectively).

**Previous bug (2026-02-14):** ros-gz-bridge service had `/world/default/` in topic paths while PX4 used `PX4_GZ_WORLD=baylands`. Bridge subscribed to nonexistent topics → no camera data. Fix: update bridge service to use `/world/baylands/`.

---

## 6) Frontend: Unclear Active Drone

**Symptom:** Controls work but it's not obvious which drone is selected.

**Check:** `TARGET:` label at bottom of console should show current drone name. If it says "none", discovery hasn't completed or drone selection isn't wired up.

**Possible fixes:**
- Stronger visual highlight on selected drone card
- Prominent drone name in camera overlay
- Flash/animate on drone switch

**Status:** Needs design review. (2026-02-12)

---

## 7) PX4 Startup Failures

### `gz_bridge timed out waiting for clock message` / return code 256

This is the most common PX4 startup failure. Multiple possible causes:

**Cause 1: Stale PX4/Gazebo processes or lock files**

PX4 uses lock files to prevent duplicate instances. If a previous PX4 crashed, stale locks prevent restart.

**Fix:**
```bash
# Stop services, kill stale processes, clean locks
systemctl --user stop px4-drone2 px4-sitl
killall -9 px4 2>/dev/null
pkill -9 -f 'gz sim' 2>/dev/null
rm -f /tmp/px4-daemon-app-*.lock
rm -f ~/PX4-Autopilot/build/px4_sitl_default/rootfs/*.lock
rm -f ~/PX4-Autopilot/build/px4_sitl_default/rootfs/1/*.lock

# Restart services
systemctl --user start px4-sitl   # drone1 + Gazebo
# px4-drone2 auto-starts 20s after px4-sitl
sleep 40
systemctl --user is-active px4-sitl px4-drone2  # Both should say "active"
```

**Cause 2: Missing `HEADLESS=1`** on headless servers (no GPU/display). Already set in systemd service.

**Cause 3: Stale Gazebo process** from a previous run holding resources. Kill it first.

**Note on history:** The original `px4-sitl.service` used `make px4_sitl gz_x500_mono_cam` which called `cmake → ninja` to run PX4. Ninja would sometimes hang (zombie child shell), preventing PX4 from starting. The service was updated (2026-02-14) to run `./bin/px4` directly, bypassing make/ninja entirely. A separate `px4-drone2.service` was also created so drone2 is no longer a manual nohup step.

### Restart order after PX4 relaunch

After relaunching PX4 instances, services must be restarted in this order:

```bash
# On srv01
docker restart micro_agent_service    # Must reconnect to new PX4 instances
sleep 5
docker restart drone_core_node        # Reconnects to drone1 PX4
docker restart drone_core_node2       # Reconnects to drone2 PX4
docker restart rosbridge_server       # Picks up new ROS2 topics
systemctl --user restart ros-gz-bridge  # Camera bridge
docker restart sim_camera_node        # Must restart AFTER cameras are publishing

# On VPS
docker restart rosbridge_relay_node camera_proxy_node
```

**Critical:** `micro_agent_service` must be restarted BEFORE `drone_core_node*`. If drone_core starts before micro_agent sees PX4, it won't receive telemetry data (all UNKNOWN states, position 0,0,0).

**Critical:** `sim_camera_node` must restart LAST — it doesn't auto-detect new camera topics.

### `can_arm: false` with "Manual control signal lost" / "GCS connection lost"

```
nav_state: AUTO_LOITER
arming_state: DISARMED
can_arm: false
"Manual control signal lost"
"GCS connection lost"
```

These flags are **expected** in remote-offboard sim with no RC/GCS. They **don't block flight** if PX4 params are set correctly:

```
COM_RC_IN_MODE = 4    # No RC input required
COM_RCL_EXCEPT = 4    # Allow offboard without RC
NAV_DLL_ACT = 0       # No action on datalink loss
```

These params are persisted in `px4-rc.params` (see below). Even with `can_arm: false` reported, the drone WILL arm and fly in offboard mode.

### PX4 parameter persistence

Params are set via `~/PX4-Autopilot/build/px4_sitl_default/etc/init.d-posix/px4-rc.params`:
```bash
param set COM_RC_IN_MODE 4
param set COM_RCL_EXCEPT 4
param set NAV_DLL_ACT 0
```

**Note:** Use `param set` (not `param set-default`). `set-default` only applies when `parameters.bson` doesn't exist. `param set` always applies, overriding saved values.

If params seem to not take effect, delete the saved param files and restart PX4:
```bash
rm ~/PX4-Autopilot/build/px4_sitl_default/rootfs/parameters.bson
rm ~/PX4-Autopilot/build/px4_sitl_default/rootfs/parameters_backup.bson
rm ~/PX4-Autopilot/build/px4_sitl_default/rootfs/1/parameters.bson
rm ~/PX4-Autopilot/build/px4_sitl_default/rootfs/1/parameters_backup.bson
# Then restart PX4
```

### drone_core_node shows UNKNOWN state / position (0,0,0)

**Symptom:** `get_state()` returns `arming_state: UNKNOWN`, `nav_state: UNKNOWN`, `local_x/y/z: 0.0`.

**Cause:** drone_core_node can't receive PX4 DDS topics. Usually means:
1. PX4 isn't running (check with `pgrep -la px4`)
2. `micro_agent_service` was restarted after PX4 started — PX4's XRCE-DDS client lost connection and hasn't reconnected
3. DDS discovery mismatch between Docker container and PX4 process

**Fix:** Restart PX4 instance, then micro_agent, then drone_core_node (in that order). Check `docker logs micro_agent_service` for `client_key: 0x00000001` (drone1) and `client_key: 0x00000002` (drone2) — both must appear.

---

## 8) Camera Feeds Broken After World Change

**Symptom:** Switched Gazebo world (e.g., `default` → `lawn` → `windy`), camera feeds won't load in frontend.

**Root cause:** `ros_gz_bridge` topic paths include the world name. When you change worlds, the bridge is still subscribed to camera topics from the old world.

**Example:**
- Started with `default` world → bridge listens to `/world/default/model/x500_mono_cam_0/.../image`
- Switched to `lawn` world → Gazebo now publishes to `/world/lawn/model/x500_mono_cam_0/.../image`
- Bridge still listening to `/world/default/...` → no data flow → cameras frozen

**Fix:**

1. **Kill the old bridge:**
   ```bash
   ssh rodrigo@<tailscale-ip> 'pkill -f ros_gz_bridge'
   ```

2. **Start bridge with correct world name:**
   ```bash
   ssh rodrigo@<tailscale-ip> 'bash -c "source /opt/ros/humble/setup.bash && nohup ros2 run ros_gz_bridge parameter_bridge /world/WORLDNAME/model/x500_mono_cam_0/link/camera_link/sensor/imager/image@sensor_msgs/msg/Image@gz.msgs.Image /world/WORLDNAME/model/x500_mono_cam_1/link/camera_link/sensor/imager/image@sensor_msgs/msg/Image@gz.msgs.Image --ros-args --remap /world/WORLDNAME/model/x500_mono_cam_0/link/camera_link/sensor/imager/image:=/drone1/camera --remap /world/WORLDNAME/model/x500_mono_cam_1/link/camera_link/sensor/imager/image:=/drone2/camera > /tmp/camera_bridge.log 2>&1 &"'
   ```
   Replace `WORLDNAME` with your world (e.g., `lawn`, `windy`, `baylands`).

3. **Verify:**
   ```bash
   ssh rodrigo@<tailscale-ip> 'source /opt/ros/humble/setup.bash && timeout 2 ros2 topic echo /drone1/camera --once'
   ```

**Fixed:** 2026-02-13. Documented after switching from `default` to `lawn` broke camera feeds.

---

## 9) Drone Flipped / Upside Down or Drifting

**Symptom:** Drone is upside down, drifting, or showing impossible altitude (e.g., 1000m+).

**Fix:** Restart `px4-sitl` to reset Gazebo and all drone models. Restarting individual PX4 services (e.g., `px4-drone3`) does NOT reliably respawn a corrupted Gazebo model — it reconnects to the existing broken model.

```bash
# On srv01 — this is the fix
systemctl --user restart px4-sitl
# px4-drone2 and px4-drone3 auto-restart after px4-sitl (After= dependency)
# Wait ~45s for all to initialize
```

Then restart the Docker SDK nodes so they reconnect:
```bash
docker restart drone_core_node drone_core_node2 drone_core_node3
```

**Do NOT use `gz service set_pose`** — it resets the Gazebo model position but desyncs PX4's internal state, causing the drone to drift uncontrollably.

---

## Lessons Learned

### Don't touch simulation to fix frontend bugs (2026-02-12)
Restarting PX4/Gazebo while debugging a camera UI issue broke a working sim. **Diagnose the correct layer first.**

### Document infrastructure before modifying it
When multi-drone spawning broke, recovery was hard because the process wasn't documented. **Write it down before you touch it.**

### Rosbridge relay must use persistent upstream connection
Per-client upstream connections cause race conditions — service call responses get lost when the client disconnects before the response arrives.

### DDS Discovery Server over Tailscale doesn't work
Abandoned in favor of WebSocket relay through rosbridge.
