#!/usr/bin/env python3
"""
One-shot dispatch trace — measures time at every step from incident creation to drone takeoff.
"""

import asyncio
import json
import time
import sys
import os
import subprocess

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

DISPATCH_API = "http://localhost:8081"
BRIDGE_API = "http://localhost:8082"
REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

MAX_WAIT = 60  # seconds

def ts():
    return time.time()

def elapsed(t0):
    return f"{time.time() - t0:.2f}s"

def get_drone_states():
    """Get all drone states via drone_control.py"""
    try:
        result = subprocess.run(
            ["python3", "-u", "-c", f"""
import sys, json, os
sys.path.insert(0, {REPO_ROOT!r})
import drone_control as dc

drones = {{}}
for i in range(1, 4):
    name = f'drone{{i}}'
    try:
        dc.set_drone_name(name)
        s = dc.get_state()
        if s.get('nav_state') and s['nav_state'] != 'UNKNOWN':
            drones[name] = {{
                'arming_state': s.get('arming_state', 'UNKNOWN'),
                'nav_state': s.get('nav_state', 'UNKNOWN'),
                'x': round(s.get('local_x', 0), 1),
                'y': round(s.get('local_y', 0), 1),
                'z': round(s.get('local_z', 0), 1),
            }}
    except:
        pass
print(json.dumps(drones))
"""],
            capture_output=True, text=True, timeout=15
        )
        if result.returncode == 0 and result.stdout.strip():
            return json.loads(result.stdout.strip())
    except Exception as e:
        print(f"  [error] drone state query failed: {e}")
    return {}


async def main():
    import aiohttp

    t0 = ts()
    print(f"{'='*70}")
    print(f"DISPATCH TRACE — {time.strftime('%Y-%m-%d %H:%M:%S UTC', time.gmtime())}")
    print(f"{'='*70}")

    # Step 0: Snapshot initial drone states
    print(f"\n[T+{elapsed(t0)}] STEP 0: Initial drone states")
    initial_states = get_drone_states()
    for name, state in initial_states.items():
        print(f"  {name}: {state['arming_state']} | {state['nav_state']} | pos=({state['x']}, {state['y']}, {state['z']})")

    # Step 1: Capture bridge state before
    print(f"\n[T+{elapsed(t0)}] STEP 1: Checking bridge status")
    async with aiohttp.ClientSession() as session:
        async with session.get(f"{BRIDGE_API}/api/bridge/status") as resp:
            bridge_before = await resp.json()
    bridge_log_count_before = len(bridge_before.get("activity_log", []))
    bridge_seen_before = bridge_before["seen_count"]
    print(f"  Bridge paused={bridge_before['paused']}, seen_count={bridge_seen_before}, log_entries={bridge_log_count_before}")
    print(f"  Session mode: {bridge_before.get('session_mode')}, model: {bridge_before.get('model')}")

    if bridge_before["paused"]:
        print(f"  ⚠️  Bridge is PAUSED — resuming...")
        async with aiohttp.ClientSession() as session:
            await session.post(f"{BRIDGE_API}/api/bridge/resume")
        print(f"  [T+{elapsed(t0)}] Bridge resumed")

    # Step 2: Trigger incident
    t_trigger = ts()
    print(f"\n[T+{elapsed(t0)}] STEP 2: Triggering incident via POST /api/dispatch/trigger")
    async with aiohttp.ClientSession() as session:
        async with session.post(f"{DISPATCH_API}/api/dispatch/trigger") as resp:
            incident = await resp.json()
    t_created = ts()
    inc_id = incident["id"]
    print(f"  Incident created in {t_created - t_trigger:.3f}s")
    print(f"  ID: {inc_id}")
    print(f"  Type: {incident['type']} (P{incident['priority']})")
    print(f"  Location: {incident['location']['name']} ({incident['location']['x']}, {incident['location']['y']})")
    print(f"  Description: {incident['description']}")

    # Step 3: Wait for bridge to pick it up (seen_count increments)
    print(f"\n[T+{elapsed(t0)}] STEP 3: Waiting for bridge to detect incident (polls every 2s)...")
    t_bridge_detect = None
    t_bridge_ai_response = None
    t_dispatched = None
    t_armed = None
    t_airborne = None
    dispatched_drone = None
    last_log_count = bridge_log_count_before

    deadline = ts() + MAX_WAIT
    poll_count = 0

    while ts() < deadline:
        await asyncio.sleep(0.5)
        poll_count += 1

        # Check bridge status for new activity
        try:
            async with aiohttp.ClientSession() as session:
                async with session.get(f"{BRIDGE_API}/api/bridge/status") as resp:
                    bridge_now = await resp.json()
        except:
            continue

        new_seen = bridge_now["seen_count"]
        logs = bridge_now.get("activity_log", [])

        # Detect when bridge sees the incident
        if t_bridge_detect is None and new_seen > bridge_seen_before:
            t_bridge_detect = ts()
            print(f"  [T+{elapsed(t0)}] Bridge detected incident (seen_count {bridge_seen_before} → {new_seen})")
            print(f"    ⏱️  Time from creation to bridge detection: {t_bridge_detect - t_created:.2f}s")

        # Check for new log entries (AI response)
        if len(logs) > last_log_count:
            for entry in logs[last_log_count:]:
                msg = entry.get("message", "")
                entry_time = entry.get("time", 0)
                print(f"  [T+{elapsed(t0)}] Bridge log: {msg[:200]}")

                # Check for dispatch
                if "dispatched" in msg.lower() or "DISPATCHED" in msg:
                    if t_dispatched is None:
                        t_dispatched = ts()
                        # Try to extract drone name
                        import re
                        m = re.search(r'drone\d+', msg.lower())
                        if m:
                            dispatched_drone = m.group(0)
                        print(f"    ⏱️  Time from creation to AI dispatch decision: {t_dispatched - t_created:.2f}s")
                        if dispatched_drone:
                            print(f"    Drone assigned: {dispatched_drone}")
            last_log_count = len(logs)

        # Check incident status directly
        try:
            async with aiohttp.ClientSession() as session:
                async with session.get(f"{DISPATCH_API}/api/incidents/active") as resp:
                    active = await resp.json()
            for inc in active:
                if inc["id"] == inc_id:
                    if inc["status"] != "new" and t_dispatched is None:
                        t_dispatched = ts()
                        dispatched_drone = inc.get("assigned_to")
                        print(f"  [T+{elapsed(t0)}] Incident status changed to '{inc['status']}' (assigned: {dispatched_drone})")
                        print(f"    ⏱️  Time from creation to status change: {t_dispatched - t_created:.2f}s")
        except:
            pass

        # Check drone states for arm/takeoff
        if dispatched_drone or t_bridge_detect:
            states = get_drone_states()
            for name, state in states.items():
                was_disarmed = initial_states.get(name, {}).get("arming_state") != "ARMED"
                is_armed = state["arming_state"] == "ARMED"
                alt = -state["z"]

                if is_armed and was_disarmed and t_armed is None:
                    t_armed = ts()
                    if not dispatched_drone:
                        dispatched_drone = name
                    print(f"  [T+{elapsed(t0)}] {name} ARMED!")
                    print(f"    ⏱️  Time from creation to arm: {t_armed - t_created:.2f}s")

                if is_armed and alt > 3.0 and t_airborne is None:
                    # Check it wasn't already in flight
                    was_airborne = initial_states.get(name, {})
                    if was_airborne.get("arming_state") != "ARMED" or (-was_airborne.get("z", 0)) < 3.0:
                        t_airborne = ts()
                        print(f"  [T+{elapsed(t0)}] {name} AIRBORNE at {alt:.1f}m!")
                        print(f"    ⏱️  Time from creation to airborne: {t_airborne - t_created:.2f}s")

        # Done if airborne
        if t_airborne:
            break

    # Summary
    print(f"\n{'='*70}")
    print(f"TRACE SUMMARY")
    print(f"{'='*70}")
    print(f"  Incident ID:        {inc_id}")
    print(f"  Incident type:      {incident['type']} (P{incident['priority']})")
    print(f"  Location:           {incident['location']['name']}")
    print(f"  Drone:              {dispatched_drone or 'NONE'}")
    print(f"")
    print(f"  TIMING BREAKDOWN:")
    print(f"  {'─'*50}")
    if t_bridge_detect:
        print(f"  Incident created → Bridge detects:   {t_bridge_detect - t_created:6.2f}s  (bridge polls every 2s)")
    else:
        print(f"  Incident created → Bridge detects:   NEVER (within {MAX_WAIT}s)")

    if t_bridge_detect and t_dispatched:
        print(f"  Bridge detects → AI dispatch:        {t_dispatched - t_bridge_detect:6.2f}s  (AI processing)")
    elif t_dispatched:
        print(f"  Created → AI dispatch:               {t_dispatched - t_created:6.2f}s")
    else:
        print(f"  Bridge detects → AI dispatch:        NEVER")

    if t_dispatched and t_armed:
        print(f"  AI dispatch → Drone armed:           {t_armed - t_dispatched:6.2f}s  (command execution)")
    elif t_armed:
        print(f"  Created → Drone armed:               {t_armed - t_created:6.2f}s")
    else:
        print(f"  AI dispatch → Drone armed:           NEVER")

    if t_armed and t_airborne:
        print(f"  Drone armed → Airborne (>3m):        {t_airborne - t_armed:6.2f}s  (PX4 takeoff)")
    else:
        print(f"  Drone armed → Airborne:              NEVER")

    print(f"  {'─'*50}")
    if t_airborne:
        print(f"  TOTAL (creation → airborne):         {t_airborne - t_created:6.2f}s")
    elif t_armed:
        print(f"  TOTAL (creation → armed, no takeoff):{t_armed - t_created:6.2f}s")
    else:
        print(f"  TOTAL: Drone never took off within {MAX_WAIT}s")

    # Final drone states
    print(f"\n  Final drone states:")
    final_states = get_drone_states()
    for name, state in final_states.items():
        print(f"    {name}: {state['arming_state']} | {state['nav_state']} | pos=({state['x']}, {state['y']}, {state['z']})")

    print(f"\n  Total trace time: {elapsed(t0)}")
    print(f"  Polls made: {poll_count}")


if __name__ == "__main__":
    asyncio.run(main())
