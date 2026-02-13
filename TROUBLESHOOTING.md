# Troubleshooting Guide

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

### Launch order
1. **Drone1** (starts gz-server): `HEADLESS=1 PX4_GZ_WORLD=baylands make px4_sitl gz_x500_mono_cam`
2. **Drone2** (joins existing server):
```bash
cd ~/PX4-Autopilot
PX4_GZ_STANDALONE=1 PX4_GZ_WORLD=baylands PX4_GZ_MODEL_POSE="0,2,0,0,0,0" \
  PX4_SIM_MODEL=gz_x500_mono_cam HEADLESS=1 \
  ./build/px4_sitl_default/bin/px4 -i 1
```

### Critical notes
- **All instances MUST set `PX4_GZ_WORLD=baylands`** — without it, standalone instances fail silently
- Drone2 is NOT managed by systemd — must be launched manually
- Verify namespace routing: drone1 = `/fmu/`, drone2 = `/px4_1/fmu/`

### Camera namespace fix
- Cherry-picked from PX4-gazebo-models PR #76 (commit `183cbee`)
- Without fix: all cameras publish to same `/camera` Gazebo topic → mixed frames
- Fix removes hardcoded `<topic>camera</topic>` from `mono_cam/model.sdf`
- Result: separate Gazebo topics per model instance
- ros-gz-bridge remaps to `/drone1/camera` and `/drone2/camera`

---

## 4) Frontend: Camera Feed Won't Switch

**Symptom:** Click drone2 → camera stays on drone1 or shows "stream loading" forever. Going back to drone1 shows "stream live".

**Root cause:** `SimpleCameraFeed.tsx` mutates `<img src>` when drone changes, but browsers don't reliably tear down an active MJPEG connection on the same DOM element.

**Fix (applied 2026-02-12):** Added `key={streamUrl}` to the `<img>` tag and wrapped in `{streamUrl && ...}` guard in `SimpleCameraFeed.tsx`. Forces React to destroy/recreate the element on drone switch, guaranteeing a fresh MJPEG connection. Also prevents rendering with empty/invalid stream URL before discovery completes.

**File:** `web_interface/frontend/src/components/SimpleCameraFeed.tsx`

---

## 5) Drone2 Camera Not Publishing

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

**Status:** Fixed (2026-02-12). ros-gz-bridge service already configured for both drones. PR #76 model.sdf fix enables proper per-instance Gazebo topics. Both `/drone1/camera` and `/drone2/camera` confirmed publishing at ~10-18 Hz.

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

### `gz_bridge Service call timed out` / return code 256
**Cause:** `GZ_SIM_RESOURCE_PATH` set in `~/.config/systemd/user/px4-sitl.service`

**Fix:** Remove it, then:
```bash
systemctl --user daemon-reload
systemctl --user restart px4-sitl
```

### `gz_bridge timed out waiting for clock message`
**Cause:** Missing `HEADLESS=1` in service file for headless servers.

**Fix:** Add `HEADLESS=1` to service Environment, then:
```bash
systemctl --user daemon-reload
systemctl --user restart px4-sitl
```

### Known failure signature
```
nav_state: AUTO_LOITER
arming_state: DISARMED
can_arm: false
"Manual control signal lost"
"GCS connection lost"
```
These flags are **expected** in remote-offboard sim with no RC/GCS. They don't block flight if PX4 params are set correctly (see Section 1).

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
