# Preflight Checklist (Hackathon)

**Context (Hackathon Setup):**
- **VPS = Fleet Command Center** (frontend + OpenClaw + relay/proxy services)
- **srv01 = Drone side** (PX4 + Gazebo SITL + drone_core stack)
- This checklist is for reliable preflight validation before attempting takeoff.

---

## 0) Mission Scope / Safety
- [ ] Confirm target drone (`drone1` or `drone2`)
- [ ] Confirm this is **simulation** (not real hardware)
- [ ] Confirm operator is ready to abort / land command immediately if behavior is abnormal

---

## 1) srv01 Core Services Healthy
On `srv01`, verify:
- [ ] PX4/Gazebo SITL process running for target drone instance
- [ ] `micro_agent_service` running
- [ ] `drone_core_node` (and `drone_core_node2` if needed) running
- [ ] `rosbridge_server` running
- [ ] `ros-gz-bridge` running (for camera topics)

Quick checks:
- [ ] `/drone1/drone_state` topic present
- [ ] `/drone2/drone_state` topic present (if multi-drone)
- [ ] `/drone1/camera` topic present
- [ ] `/drone2/camera` topic present (if multi-drone)

---

## 2) VPS Command Center Healthy
On VPS, verify:
- [ ] Frontend reachable (`:3000`)
- [ ] OpenClaw proxy reachable (`:3031`)
- [ ] rosbridge relay reachable (`:9090`)
- [ ] camera proxy reachable (`:8080`)

---

## 3) PX4 Offboard Preconditions (Critical)
For target PX4 instance, verify parameters:
- [ ] `COM_RC_IN_MODE = 4`
- [ ] `COM_RCL_EXCEPT = 4`

Recommended to inspect also:
- [ ] `COM_OF_LOSS_T`
- [ ] `COM_OBL_RC_ACT`

If changed:
- [ ] `param save`
- [ ] restart only necessary PX4 instance if required

---

## 4) Offboard Heartbeat Requirement (Critical)
Before arming/switching to offboard:
- [ ] Ensure Offboard heartbeat stream is active (>2Hz)
- [ ] Maintain heartbeat for at least ~1 second before arm/switch
- [ ] Keep heartbeat active continuously during offboard flight

If heartbeat drops, PX4 may exit offboard.

---

## 5) State Gates (Must Pass in Order)
Do not continue unless each gate passes:

1. [ ] Set target drone (name/namespace)
2. [ ] `set_offboard()`
   - Gate: `nav_state == OFFBOARD`
3. [ ] `arm()`
   - Gate: `arming_state == ARMED`
4. [ ] `takeoff()` — climbs 10m above current position via offboard position control
   - Gate: altitude increases ~10m within 15s

If any gate fails:
- [ ] Stop sequence immediately
- [ ] Read state/failsafe flags
- [ ] Fix root cause before retry

---

## 6) Known Failure Signature (Current Incident)
If you see:
- `nav_state: AUTO_LOITER`
- `arming_state: DISARMED`
- `can_arm: false`
- Set position rejected: "must be in OFFBOARD mode"

Then this is typically **offboard precondition / failsafe gating**, not UI routing.

---

## 7) Multi-Drone Launch Order (Gazebo GZ)
- [ ] Start first PX4 instance (starts gz-server) **without** `PX4_GZ_STANDALONE=1`
- [ ] Start additional PX4 instances with `PX4_GZ_STANDALONE=1`, unique `-i`, unique pose
- [ ] **All instances MUST set `PX4_GZ_WORLD=baylands`** (or matching world name) — without it, standalone instances fail to spawn silently
- [ ] Verify each instance has expected namespace routing (`/fmu`, `/px4_1/fmu`, ...)
- [ ] Verify camera topics are separate per drone (`/drone1/camera`, `/drone2/camera` should NOT share Gazebo publishers)

**Camera namespace fix (applied 2026-02-12):**
- Cherry-picked from PX4-gazebo-models PR #76 (commit `183cbee`)
- Without this fix, all drone cameras publish to the same `/camera` Gazebo topic → mixed frames
- Fix removes hardcoded `<topic>camera</topic>` from `mono_cam/model.sdf`, letting Gazebo auto-namespace per model instance
- New Gazebo topics: `/world/baylands/model/x500_mono_cam_N/link/camera_link/sensor/imager/image`
- ros-gz-bridge remaps these to `/drone1/camera` and `/drone2/camera`
- **If PX4-gazebo-models submodule is updated to latest, this fix is included and no cherry-pick is needed**

**Drone2 launch command (example):**
```bash
cd ~/PX4-Autopilot
PX4_GZ_STANDALONE=1 PX4_GZ_WORLD=baylands PX4_GZ_MODEL_POSE="0,2,0,0,0,0" \
  PX4_SIM_MODEL=gz_x500_mono_cam HEADLESS=1 \
  ./build/px4_sitl_default/bin/px4 -i 1
```

---

## 8) Definition of Done (Preflight Pass)
Preflight is considered passed only if:
- [ ] `set_offboard()` accepted (`nav_state == OFFBOARD`)
- [ ] `arm()` successful (`arming_state == ARMED`)
- [ ] `takeoff()` climbs ~10m above starting position
- [ ] `land()` works and vehicle disarms cleanly

---

## 9) Gate-1 Troubleshooting (OFFBOARD not engaging)
Use this exact order when Gate 1 fails.

### A) Is PX4 actually running on srv01?
Run on `srv01`:
```bash
# 1) PX4 process check
pgrep -af "px4|px4_sitl"

# 2) Managed service check
systemctl --user is-active px4-sitl

# 3) FMU topic evidence
source /opt/ros/humble/setup.bash
ros2 topic list | egrep '^/fmu/|^/px4_1/fmu/'
```
Interpretation:
- If process + FMU topics are present, PX4 is running (even if systemd is inactive).
- If both are missing, PX4 is down and must be relaunched before continuing.

### B) Bring PX4 back (if down)
```bash
# Drone1 / first instance (starts gz-server)
cd ~/PX4-Autopilot
HEADLESS=1 PX4_GZ_WORLD=baylands make px4_sitl gz_x500_mono_cam
```
Optional drone2 after drone1 is up:
```bash
cd ~/PX4-Autopilot
PX4_GZ_STANDALONE=1 PX4_GZ_WORLD=baylands PX4_GZ_MODEL_POSE="0,2,0,0,0,0" \
  PX4_SIM_MODEL=gz_x500_mono_cam HEADLESS=1 \
  ./build/px4_sitl_default/bin/px4 -i 1
```

**Critical service-file pitfall (srv01):**
- Do **not** set `GZ_SIM_RESOURCE_PATH` in `~/.config/systemd/user/px4-sitl.service` for this setup.
- It caused: `gz_bridge Service call timed out`, `gz_bridge failed to start and spawn model`, and PX4 startup return `256`.
- If present, remove it, then:
```bash
systemctl --user daemon-reload
systemctl --user restart px4-sitl
```

### C) Verify critical PX4 params (drone1)
In PX4 shell:
```bash
param show COM_RC_IN_MODE
param show COM_RCL_EXCEPT
param show COM_OF_LOSS_T
param show COM_OBL_RC_ACT
param show NAV_DLL_ACT
```
Expected for current hackathon remote-offboard profile:
- `COM_RC_IN_MODE = 4`
- `COM_RCL_EXCEPT = 4`
- `NAV_DLL_ACT = 0` (avoid datalink-loss action blocking arm in no-GCS sim flow)

If needed:
```bash
param set COM_RC_IN_MODE 4
param set COM_RCL_EXCEPT 4
param set NAV_DLL_ACT 0
param save
```

### D) Validate FMU output health before Gate retry
On `srv01`:
```bash
source /opt/ros/humble/setup.bash
# vehicle_local_position must have publisher count > 0
ros2 topic info /fmu/out/vehicle_local_position
# should return at least one message quickly
timeout 8s ros2 topic echo --once /fmu/out/vehicle_status
timeout 8s ros2 topic echo --once /fmu/out/failsafe_flags
```
If `/fmu/out/vehicle_local_position` shows `Publisher count: 0` or `echo --once` hangs, PX4 startup is still unhealthy (fix startup before flight commands).

### E) Retry Gate 1 only
- Send offboard request
- Wait ~2s
- Confirm `nav_state == OFFBOARD`

If still failing, inspect failsafe flags and offboard heartbeat rate before attempting arm.

### F) If Gate 1 passes but Arm fails (Gate 2)
- Re-check `NAV_DLL_ACT` (must be 0 for this sim profile)
- Re-check `pre_flight_checks_pass`, `failsafe_flags`, `estimator_status_flags`
- Retry arm immediately after confirming OFFBOARD

---

## 10) Post-Flight Notes
- [ ] Log pass/fail and exact failure point
- [ ] Record any parameter change made
- [ ] Record any service restart made
