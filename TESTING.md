# DroneOS Testing Guide

## Overview

This document covers end-to-end testing procedures for DroneOS, including automated tests and manual verification steps.

---

## Quick Smoke Test

**Run before demos/hackathons to verify core functionality:**

```bash
cd /root/ws_droneOS
python3 test_frontend_commands.py
```

**Expected output:**
```
============================================================
  Testing DRONE1
============================================================
✅ PASS: get_state()
✅ PASS: set_offboard()
✅ PASS: arm()
✅ PASS: set_position(5, 0, -10, 0)
✅ PASS: land()
✅ PASS: disarm()

============================================================
  Testing DRONE2
============================================================
✅ PASS: get_state()
✅ PASS: set_offboard()
✅ PASS: arm()
✅ PASS: set_position(5, 0, -10, 0)
✅ PASS: land()
✅ PASS: disarm()
```

**Duration:** ~30 seconds per drone

---

## Automated Test Suite

### 1. Drone Control Commands (`test_frontend_commands.py`)

**What it tests:**
- All basic drone commands (arm, disarm, offboard, position, land)
- State retrieval
- Multi-drone command execution
- Command response validation

**Usage:**
```python
#!/usr/bin/env python3
"""
Frontend Command Test Suite
Tests all drone commands end-to-end via drone_control.py
"""

import time
import drone_control as dc

def test_header(msg):
    print(f"\n{'='*60}")
    print(f"  {msg}")
    print(f"{'='*60}")

def test_command(name, func, *args):
    print(f"\n[TEST] {name}")
    print(f"  Args: {args if args else 'none'}")
    try:
        result = func(*args) if args else func()
        success = result.get('success', False)
        message = result.get('message', 'no message')
        print(f"  {'✅ PASS' if success else '❌ FAIL'}: {message}")
        if not success:
            print(f"  Full response: {result}")
        return success
    except Exception as e:
        print(f"  ❌ ERROR: {e}")
        return False

def get_status_summary(drone_name):
    dc.set_drone_name(drone_name)
    state = dc.get_state()
    if state.get('success'):
        return (
            f"{drone_name}: {state['arming_state']}, "
            f"{state['nav_state']}, "
            f"alt={-state['local_z']:.1f}m, "
            f"bat={state['battery_remaining']*100:.0f}%"
        )
    return f"{drone_name}: STATE ERROR"

def main():
    test_header("DroneOS Frontend Command Test Suite")
    
    # Test both drones
    for drone_name in ['drone1', 'drone2']:
        test_header(f"Testing {drone_name.upper()}")
        dc.set_drone_name(drone_name)
        
        # Initial state
        print(f"\n[INITIAL STATE]")
        print(f"  {get_status_summary(drone_name)}")
        
        # Test 1: Get state
        test_command("get_state()", dc.get_state)
        
        # Test 2: Set offboard mode
        test_command("set_offboard()", dc.set_offboard)
        time.sleep(1)
        
        # Test 3: Arm
        test_command("arm()", dc.arm)
        time.sleep(1)
        
        # Test 4: Set position (small move)
        test_command(
            "set_position(5, 0, -10, 0)",
            dc.set_position, 5, 0, -10, 0
        )
        time.sleep(2)
        
        # Test 5: Check state after commands
        print(f"\n[STATE AFTER COMMANDS]")
        print(f"  {get_status_summary(drone_name)}")
        
        # Test 6: Land
        test_command("land()", dc.land)
        time.sleep(2)
        
        # Test 7: Disarm
        test_command("disarm()", dc.disarm)
        time.sleep(1)
        
        # Final state
        print(f"\n[FINAL STATE]")
        print(f"  {get_status_summary(drone_name)}")
    
    # Summary
    test_header("Test Complete")
    print(f"\ndrone1: {get_status_summary('drone1')}")
    print(f"drone2: {get_status_summary('drone2')}")

if __name__ == "__main__":
    main()
```

**Save and run:**
```bash
cd /root/ws_droneOS
python3 test_frontend_commands.py
```

### 2. Camera Feed Test

**Quick check:**
```bash
# Test drone1 camera
timeout 3 curl -s "http://localhost:8080/stream?topic=/drone1/camera&type=mjpeg&width=100&height=100" | head -c 1000 | wc -c

# Test drone2 camera
timeout 3 curl -s "http://localhost:8080/stream?topic=/drone2/camera&type=mjpeg&width=100&height=100" | head -c 1000 | wc -c
```

**Expected:** Both return `1000` (bytes received)

**Automated script:**
```bash
#!/bin/bash
# test_cameras.sh

echo "Testing camera feeds..."
echo ""

for drone in drone1 drone2; do
  echo -n "Testing /$drone/camera... "
  bytes=$(timeout 3 curl -s "http://localhost:8080/stream?topic=/$drone/camera&type=mjpeg&width=100&height=100" 2>/dev/null | head -c 1000 | wc -c)
  
  if [ "$bytes" -eq 1000 ]; then
    echo "✅ OK ($bytes bytes)"
  else
    echo "❌ FAIL ($bytes bytes)"
  fi
done
```

### 3. Multi-Drone Coordination Test

**Formation flight test:**
```python
#!/usr/bin/env python3
"""Test multi-drone formation flying"""
import time
import drone_control as dc

def command_drone(name, x, y, z):
    dc.set_drone_name(name)
    dc.set_offboard()
    time.sleep(0.5)
    dc.arm()
    time.sleep(0.5)
    dc.set_position(x, y, z, 0)
    print(f"✅ {name} commanded to ({x}, {y}, {z})")

# Command formation: triangle at 15m altitude
print("Commanding triangle formation at 15m altitude...")
command_drone('drone1', 0, 0, -15)
time.sleep(1)
command_drone('drone2', 3, 0, -15)

print("\n✅ Formation commanded. Check Gazebo for positions.")
```

---

## Manual Testing Procedures

### Frontend UI Testing

**Cannot be automated (requires browser):**

1. **Access frontend:** http://207.148.9.142:3000

2. **Fleet List (Left Sidebar)**
   - [ ] Both drones visible in list
   - [ ] Click drone1 → active indicator shows
   - [ ] Click drone2 → switches active drone
   - [ ] Active drone shows armed state + altitude

3. **Camera Feeds (Center Viewport)**
   - [ ] drone1 selected → camera feed displays
   - [ ] drone2 selected → camera feed switches
   - [ ] Camera overlay shows command state
   - [ ] Feed updates in real-time

4. **Map (Right Panel)**
   - [ ] Both drone markers visible
   - [ ] Markers update with drone movement
   - [ ] Click map → sends position command
   - [ ] Altitude slider adjusts target altitude

5. **Console (Footer)**
   - [ ] Type `state` → displays current drone state
   - [ ] Type `arm` → arms current drone
   - [ ] Type `pos 10 0 -15` → sends position command
   - [ ] Arrow up → recalls previous command
   - [ ] `clear` → clears console output

6. **Incident Queue (Left Sidebar, Bottom)**
   - [ ] Active incidents display
   - [ ] Incidents update from dispatch service
   - [ ] Priority colors visible (P1 red, P2 orange, P3 yellow)

7. **Activity Feed (Center, Below Camera)**
   - [ ] Shows AI dispatch activity log
   - [ ] PAUSE/RESUME button visible
   - [ ] Log auto-scrolls
   - [ ] Timestamp format correct

### Dispatch System Testing

**Prerequisites:**
- dispatch_service.py running (port 8081)
- bridge.py running (port 8082)

**Test procedure:**

1. **Verify dispatch service:**
```bash
curl http://localhost:8081/api/incidents/active
```

Expected: JSON array of incidents

2. **Check bridge status:**
```bash
curl http://localhost:8082/api/bridge/status
```

Expected:
```json
{
  "paused": true,
  "running": true,
  "seen_count": 0,
  "activity_log": [...]
}
```

3. **Resume bridge (controlled test):**
```bash
curl -X POST http://localhost:8082/api/bridge/resume
```

4. **Monitor activity:**
```bash
# Watch bridge logs in real-time
docker logs -f dispatch_bridge_node  # if containerized
# OR
tail -f /tmp/bridge_activity.log
```

5. **Verify AI dispatch:**
   - [ ] Bridge detects new incident
   - [ ] Sends incident to OpenClaw
   - [ ] OpenClaw responds with dispatch decision
   - [ ] Drone flies to incident location
   - [ ] Status updates to "dispatched"

6. **Pause bridge:**
```bash
curl -X POST http://localhost:8082/api/bridge/pause
```

---

## Pre-Demo Checklist

**Run this 30 minutes before hackathon/demo:**

### 1. Service Health Check

```bash
# srv01 (simulation server)
ssh rodrigo@<tailscale-ip> "docker ps --format '{{.Names}}: {{.Status}}'"

# VPS (command center)
docker ps --format '{{.Names}}: {{.Status}}'
```

**Expected services running:**
- srv01: rosbridge_server, micro_agent, drone_core_node(s)
- VPS: rosbridge_relay, camera_proxy, frontend_node, openclaw_proxy

### 2. Camera Verification

```bash
# On srv01
ssh rodrigo@<tailscale-ip> "gz model --list | grep x500"
# Expected: x500_mono_cam_0, x500_mono_cam_1

ssh rodrigo@<tailscale-ip> "source /opt/ros/humble/setup.bash && ros2 topic list | grep camera"
# Expected: /drone1/camera, /drone2/camera

# From VPS
bash test_cameras.sh
# Expected: ✅ OK for both drones
```

### 3. Drone Command Test

```bash
python3 test_frontend_commands.py | grep -E "PASS|FAIL|ERROR"
```

**Expected:** All ✅ PASS

### 4. Frontend Load Test

```bash
curl -I http://207.148.9.142:3000
```

**Expected:** `HTTP/1.1 200 OK`

### 5. Dispatch System Check

```bash
# Check dispatch service
curl http://localhost:8081/api/incidents/active | jq length
# Expected: Number of active incidents (0-4)

# Check bridge status
curl http://localhost:8082/api/bridge/status | jq '.paused, .running'
# Expected: true (paused), true (running)
```

### 6. Full Integration Test

**Option A: Automated (safe, no token cost)**
```bash
# Keep bridge paused, manually send test command
cd /root/ws_droneOS
python3 << 'EOF'
import drone_control as dc

print("🧪 Integration Test: Multi-Drone Dispatch Simulation")

# drone1 to incident at (50, 0)
dc.set_drone_name('drone1')
dc.set_offboard()
dc.arm()
dc.set_position(50, 0, -15, 0)
print("✅ drone1 dispatched to (50, 0, -15)")

# drone2 to incident at (0, 50)
dc.set_drone_name('drone2')
dc.set_offboard()
dc.arm()
dc.set_position(0, 50, -15, 0)
print("✅ drone2 dispatched to (0, 50, -15)")

print("\n✅ Integration test complete")
EOF
```

**Option B: Live AI Dispatch (uses tokens)**
```bash
# Resume bridge for 60 seconds, then pause
curl -X POST http://localhost:8082/api/bridge/resume
sleep 60
curl -X POST http://localhost:8082/api/bridge/pause

# Check activity log
curl http://localhost:8082/api/bridge/status | jq '.activity_log[-5:]'
```

---

## Test Result Template

**Copy this template for test runs:**

```markdown
# Test Run: YYYY-MM-DD HH:MM

## Environment
- Location: [ ] VPS  [ ] srv01  [ ] Local
- Drones active: [ ] 1  [ ] 2  [ ] 3+
- Services: [ ] All running  [ ] Partial  [ ] Degraded

## Automated Tests
- [ ] drone_control commands (test_frontend_commands.py)
- [ ] Camera feeds (test_cameras.sh)
- [ ] Multi-drone coordination

## Manual Tests
- [ ] Frontend UI (all sections)
- [ ] Dispatch system (if applicable)
- [ ] Camera switching
- [ ] Console commands

## Results
**Pass:** X / Y tests
**Fail:** List failures

## Issues Discovered
1. Issue description → resolution/workaround

## Notes
- Any anomalies, performance issues, or observations

## Sign-off
Tested by: [Name]
Ready for demo: [ ] Yes  [ ] No (reason: ___)
```

---

## Troubleshooting Test Failures

### Command Test Fails

**Symptom:** `test_frontend_commands.py` shows ❌ FAIL

**Diagnosis:**
```python
import drone_control as dc
dc.set_drone_name('drone1')
result = dc.get_state()
print(result)
```

**Common causes:**
- rosbridge_relay not connected
- drone_core not running
- PX4 not in correct mode

**Solution:** See `TROUBLESHOOTING.md`

### Camera Test Fails

**Symptom:** `test_cameras.sh` returns 0 bytes

**Diagnosis:**
```bash
# Check Gazebo model
ssh rodrigo@<tailscale-ip> "gz model -m x500_mono_cam_1 -l camera_link -s | grep imager"

# Check ROS topic
ssh rodrigo@<tailscale-ip> "source /opt/ros/humble/setup.bash && timeout 2 ros2 topic hz /drone2/camera"
```

**Solution:** See `docs/MULTI_DRONE_CAMERAS.md`

### Frontend Not Loading

**Symptom:** `curl http://207.148.9.142:3000` fails

**Diagnosis:**
```bash
docker logs frontend_node | tail -30
```

**Common causes:**
- Node server crashed
- Port 3000 not exposed
- Build failed

**Solution:** Restart frontend container

---

## Continuous Testing

### Pre-Commit Checks

Before committing changes, run:
```bash
cd /root/ws_droneOS
python3 test_frontend_commands.py && echo "✅ Ready to commit"
```

### Nightly Tests (Optional)

Setup cron job for nightly testing:
```bash
0 2 * * * cd /root/ws_droneOS && python3 test_frontend_commands.py > /tmp/nightly_test_$(date +\%Y\%m\%d).log 2>&1
```

---

## See Also

- `PREFLIGHT_CHECKLIST.md` — Pre-flight verification steps
- `TROUBLESHOOTING.md` — Issue diagnosis and resolution
- `docs/MULTI_DRONE_CAMERAS.md` — Camera-specific testing
- `FRONTEND_TEST_REPORT.md` — Example test report
