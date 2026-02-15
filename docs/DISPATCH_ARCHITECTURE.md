# AI Emergency Drone Dispatch — Architecture

## Concept

**911-style autonomous drone dispatch system** where AI acts as the dispatcher (not a chatbot).

When an emergency incident is reported, the AI:
1. Receives incident details via chat message
2. Evaluates priority and location
3. Dispatches available drone(s)
4. Monitors flight progress
5. Updates incident status

**Key principle:** The AI is the **fleet commander**, not a conversational assistant. It receives structured incident reports and autonomously coordinates the response.

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│                     VPS (Command Center)                     │
│                                                              │
│  ┌──────────────┐      ┌─────────────┐     ┌────────────┐  │
│  │   Frontend   │◄─────┤  OpenClaw   │◄────┤   Bridge   │  │
│  │   (3000)     │      │  Gateway    │     │   (8082)   │  │
│  └──────────────┘      └─────────────┘     └────────────┘  │
│         │                     ▲                    ▲         │
│         │ WebSocket           │ WebSocket          │ HTTP    │
│         ▼                     │                    │         │
│  ┌──────────────┐             │              ┌────────────┐ │
│  │  Rosbridge   │             │              │ Dispatch   │ │
│  │   Relay      │             │              │ Service    │ │
│  │   (9090)     │             │              │  (8081)    │ │
│  └──────────────┘             │              └────────────┘ │
│         │                     │                    │         │
│         │ Tailscale           │                    │         │
└─────────┼─────────────────────┼────────────────────┼─────────┘
          │                     │                    │
          ▼                     │                    │
┌─────────────────────────────────────────────────────────────┐
│                    srv01 (Simulation)                        │
│                                                              │
│  ┌──────────────┐      ┌─────────────┐     ┌────────────┐  │
│  │  Rosbridge   │      │ drone_core  │     │  Gazebo    │  │
│  │   Server     │◄─────┤   nodes     │◄────┤  + PX4     │  │
│  │   (9090)     │      │             │     │            │  │
│  └──────────────┘      └─────────────┘     └────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

---

## Components

### 1. Dispatch Service (`dispatch_service.py`)

**Purpose:** Minimal 911 CAD (Computer-Aided Dispatch) system that generates incidents

**Runs on:** VPS, port 8081  
**Language:** Python (asyncio + aiohttp)  
**Status:** ✅ Running (PID varies)

**Responsibilities:**
- Generate simulated emergency incidents every 2-3 minutes
- Maintain incident queue (max 4 active incidents)
- Expose REST API for incident retrieval and updates
- Publish incident state via rosbridge (for frontend)

**Key Features:**
- **Does NOT know about drones or AI** — just manages incidents
- Incidents have: ID, type, priority (1-3), description, location (X/Y coords)
- States: `new` → `dispatched` → `on_scene` → `resolved`

**API Endpoints:**
```
GET  /api/incidents        - All incidents (including resolved)
GET  /api/incidents/active - Only non-resolved incidents
PATCH /api/incidents/:id   - Update incident status
```

**Incident Types:**
- `medical_emergency` (P1) - heart attack, stroke, drowning, etc.
- `fire` (P2) - structure fire, vehicle fire, wildfire
- `property_damage` (P3) - vandalism, break-in

**Locations:**
Predefined landmarks with X/Y coordinates:
- City Park (50, 30)
- Highway 101 Overpass (100, 50)
- Baylands Park (80, -40)
- Willow Creek Trail (-80, -70)
- etc.

**ROS Integration:**
Publishes to `/dispatch/incidents` topic (JSON string of all incidents)

**Configuration:**
```python
ROSBRIDGE_HOST = "localhost"
ROSBRIDGE_PORT = 9090
INCIDENT_INTERVAL_MIN = 120  # seconds
INCIDENT_INTERVAL_MAX = 180
MAX_ACTIVE_INCIDENTS = 4
```

### 2. Bridge (`bridge.py`)

**Purpose:** Connects dispatch service to AI agent (OpenClaw)

**Runs on:** VPS, port 8082  
**Language:** Python (asyncio + websockets)  
**Status:** ✅ Running, **PAUSED by default**

**Responsibilities:**
- Poll dispatch service for new incidents (every 5 seconds)
- Send new incidents to AI via OpenClaw gateway (WebSocket)
- Parse AI responses for dispatch decisions
- Update incident status based on AI actions

**Control API:**
```
GET  /api/bridge/status  - Status + activity log
POST /api/bridge/pause   - Pause polling (save tokens)
POST /api/bridge/resume  - Resume polling
POST /api/bridge/toggle  - Toggle pause state
```

**Bridge State:**
```python
{
  "paused": true,           # Starts paused
  "running": true,          # Service is up
  "seen_count": 0,          # Number of incidents processed
  "activity_log": [...]     # Recent activity (last 50 entries)
}
```

**How It Works:**

1. **Poll for new incidents** (if not paused):
   ```python
   incidents = await get_active_incidents()
   new = [i for i in incidents if i["id"] not in seen and i["status"] == "new"]
   ```

2. **Send to AI via OpenClaw gateway WebSocket**:
   ```
   DISPATCH ALERT — NEW INCIDENT:
     ID: INC-ABC123
     Type: medical_emergency (Priority 1)
     Description: Heart attack at City Park
     Location: City Park (x=50, y=30)
   
   You are the AI dispatcher. Dispatch a drone to this incident:
   1. Pick an available drone (drone1 or drone2)
   2. Fly it to the location using drone_control.py: set_offboard, arm, set_position(x, y, -15, 0)
   3. After dispatching, include DISPATCHED:<drone_name> in your response
   4. Monitor the drone's arrival, then after ~30s on scene, land it and return
   ```

3. **Parse AI response** for dispatch tag:
   ```python
   if "DISPATCHED:" in response.upper():
       drone = extract_drone_name(response)
       update_incident(incident_id, "dispatched", assigned_to=drone)
   ```

4. **Log activity**:
   ```python
   self.log(f"🚨 Sending {inc_id} to AI: P{priority} {type}")
   self.log(f"🧠 AI responded for {inc_id}: {response[:300]}")
   self.log(f"🛸 Updated {inc_id} → dispatched to {drone}")
   ```

**Gateway Integration:**

Uses OpenClaw's WebSocket gateway (`ws://127.0.0.1:18789`):
1. Connect → receive challenge
2. Authenticate (if token configured)
3. Send `agent` request with incident message
4. Wait for lifecycle `end` event
5. Fetch last assistant message from history
6. Parse for `DISPATCHED:<drone>` tag

**Why Paused by Default:**

Each poll that finds a new incident costs tokens (AI agent turn). Starting paused prevents:
- Burning tokens during testing
- Accidental dispatch during development
- Runaway costs if incidents accumulate

Frontend includes PAUSE/RESUME button for controlled testing.

### 3. OpenClaw Agent (AI Brain)

**Purpose:** Autonomous AI dispatcher — makes decisions and flies drones

**Runs on:** VPS (OpenClaw gateway process)  
**Model:** anthropic/claude-sonnet-4-5 (configurable)  
**Session:** main (direct chat)

**Responsibilities:**
- Receive incident alerts from bridge
- Evaluate incident priority and location
- Select appropriate drone (drone1 or drone2)
- Execute flight commands via `drone_control.py`
- Monitor drone position and status
- Land and return after incident response
- Report back to bridge with `DISPATCHED:<drone>` tag

**Available Tools:**
- `exec` — Run `drone_control.py` commands
- `memory_search` / `memory_get` — Recall previous incidents
- `session_status` — Check drone states

**Workflow:**

1. **Receive incident message** (via bridge → gateway → agent):
   ```
   DISPATCH ALERT — NEW INCIDENT:
   ID: INC-ABC123
   Type: fire (Priority 2)
   Description: Structure fire at Baylands Park
   Location: Baylands Park (x=80, y=-40)
   ```

2. **Evaluate and decide**:
   - Check which drones are available (query state)
   - Pick closest or least-busy drone
   - Calculate flight path

3. **Execute dispatch**:
   ```python
   import drone_control as dc
   dc.set_drone_name('drone1')
   dc.set_offboard()
   dc.arm()
   dc.set_position(80, -40, -15, 0)  # Location from incident
   ```

4. **Report dispatch**:
   ```
   Dispatching drone1 to Baylands Park for structure fire.
   
   DISPATCHED:drone1
   
   ETA: ~30 seconds to reach (80, -40) at 15m altitude.
   Will monitor arrival and land after assessment.
   ```

5. **Monitor and land**:
   - Wait ~30s for arrival
   - Call `dc.land()`
   - Update memory with incident response

**AI Constraints:**

The agent is **not** a chatbot. It:
- Does NOT ask questions
- Does NOT wait for human approval
- Acts autonomously based on incident data
- Only interacts via structured reports

### 4. Drone Control (`drone_control.py`)

**Purpose:** Unified Python interface for drone commands

**Location:** `/root/ws_droneOS/drone_control.py`  
**Language:** Python (roslibpy)  
**Connection:** rosbridge WebSocket (localhost:9090 on VPS)

**Functions:**
```python
# Mode control
set_offboard()      # Enable offboard mode (required before flight)
arm()               # Arm motors
disarm()            # Disarm motors
land()              # Land at current position
return_to_launch()  # RTL mode

# Position control
set_position(x, y, z, yaw)  # NED coordinates, Z negative = up
takeoff()                    # Autonomous takeoff to 10m

# State retrieval
get_state()  # Returns full drone state dict

# Drone selection
set_drone_name('drone1')  # Switch active drone
get_drone_name()          # Get current drone
```

**Rosbridge Relay:**

Commands flow: `VPS (drone_control.py)` → `rosbridge_relay (9090)` → `Tailscale` → `srv01 (rosbridge_server)` → `drone_core` → `PX4`

This allows AI on VPS to control drones on srv01 as if they were local.

### 5. Frontend (`web_interface/frontend/`)

**Purpose:** Real-time command center UI

**Runs on:** VPS, port 3000  
**Stack:** React + TypeScript + rosbridge WebSocket  
**Build:** Vite

**Key Components:**

**FleetDashboard:**
- Left sidebar: Fleet list + Incident queue
- Center: Dual camera feeds + Activity feed
- Right: MiniMap + DroneMenu controls
- Footer: Console (command line)

**ActivityFeed:**
- Displays bridge activity log in real-time
- PAUSE/RESUME button for bridge control
- Auto-scrolls to latest activity
- Color-coded messages (🚨 incident, 🧠 AI, 🛸 dispatch)

**IncidentQueue:**
- Polls dispatch service every 3 seconds
- Shows active incidents with priority colors
- Updates status in real-time
- Sorts by: active first, then priority, then time

**SimpleCameraFeed:**
- Dual camera support (drone1/drone2)
- Switches feed when changing active drone
- Command overlay (shows current mode/state)
- Connects to camera_proxy on VPS

**MiniMap:**
- Displays drone positions from telemetry
- Click-to-navigate (sends position commands)
- Shows incident locations (future feature)
- Altitude control slider

**Console:**
- Command-line interface for direct drone control
- History (arrow keys)
- Commands: `arm`, `disarm`, `offboard`, `pos X Y Z`, `land`, `state`, `help`, `clear`

**Data Flow:**

```
Frontend (browser)
  ↓ WebSocket
Rosbridge Relay (VPS:9090)
  ↓ Tailscale
Rosbridge Server (srv01:9090)
  ↓ ROS2 topics/services
drone_core nodes
  ↓ ROS2 topics
PX4 (SITL)
```

Camera feeds: `srv01:8080` → `camera_proxy (VPS:8080)` → `Frontend`

---

## Data Flow: Incident → Dispatch

**Full flow from incident creation to drone flight:**

1. **Dispatch service generates incident**:
   ```
   INC-ABC123: medical_emergency (P1) at City Park (50, 30)
   Status: new
   ```

2. **Bridge polls and detects new incident**:
   ```python
   🚨 NEW: INC-ABC123 — P1 medical_emergency: Heart attack at City Park
   ```

3. **Bridge sends to AI via OpenClaw gateway**:
   ```
   WebSocket message:
   {
     "type": "req",
     "method": "agent",
     "params": {
       "message": "DISPATCH ALERT — NEW INCIDENT: ...",
       "sessionKey": "main"
     }
   }
   ```

4. **AI agent receives message** (in main session chat):
   - Parses incident data
   - Checks drone availability
   - Decides on drone1

5. **AI executes commands** (via `exec` tool):
   ```python
   import drone_control as dc
   dc.set_drone_name('drone1')
   dc.set_offboard()
   dc.arm()
   dc.set_position(50, 30, -15, 0)
   ```

6. **Commands flow through rosbridge**:
   ```
   VPS drone_control.py
     ↓ localhost:9090
   rosbridge_relay
     ↓ Tailscale
   srv01 rosbridge_server
     ↓ ROS2 service calls
   drone_core (drone1)
     ↓ ROS2 topics
   PX4 (/fmu/in/trajectory_setpoint)
   ```

7. **drone1 flies to location** (Gazebo + PX4 autopilot)

8. **AI responds to bridge**:
   ```
   Dispatching drone1 to City Park.
   
   DISPATCHED:drone1
   
   ETA 30s. Will monitor and land after assessment.
   ```

9. **Bridge parses response**:
   ```python
   if "DISPATCHED:" in response:
       update_incident("INC-ABC123", "dispatched", "drone1")
   ```

10. **Frontend updates**:
    - Incident queue shows "dispatched" status
    - Activity feed shows dispatch log
    - Map shows drone1 moving to (50, 30)
    - Camera switches to drone1 feed

**Total latency:** ~5-15 seconds from incident creation to drone dispatch

---

## Configuration

### Dispatch Service

**File:** `/root/ws_droneOS/dispatch/dispatch_service.py`

```python
ROSBRIDGE_HOST = "localhost"
ROSBRIDGE_PORT = 9090
INCIDENT_INTERVAL_MIN = 120  # 2 min
INCIDENT_INTERVAL_MAX = 180  # 3 min
MAX_ACTIVE_INCIDENTS = 4
```

**Systemd Service:** `dispatch-service.service`
```bash
systemctl restart dispatch-service   # Restart
systemctl status dispatch-service    # Check status
journalctl -u dispatch-service -f    # Live logs
```

### Bridge

**File:** `/root/ws_droneOS/dispatch/bridge.py`

```python
DISPATCH_API = "http://localhost:8081"
POLL_INTERVAL = 2  # seconds
```

**Gateway config:**
- Auto-loads from `~/.openclaw/openclaw.json`
- Falls back to `OPENCLAW_GATEWAY_TOKEN` env var
- WebSocket: `ws://127.0.0.1:18789`

**Systemd Service:** `dispatch-bridge.service` (depends on dispatch-service)
```bash
systemctl restart dispatch-bridge    # Restart
systemctl status dispatch-bridge     # Check status
journalctl -u dispatch-bridge -f     # Live logs
```

**Control:**
```bash
# Pause (default state)
curl -X POST http://localhost:8082/api/bridge/pause

# Resume (start dispatching)
curl -X POST http://localhost:8082/api/bridge/resume

# Toggle
curl -X POST http://localhost:8082/api/bridge/toggle

# Status
curl http://localhost:8082/api/bridge/status | jq
```

### OpenClaw Agent

**Config:** `~/.openclaw/openclaw.json`

**Relevant settings:**
- `agent.model` — Default model (claude-sonnet-4-5)
- `gateway.auth.token` — Gateway auth token
- `thinking` — Reasoning mode (low/med/high/off)

**Files loaded on startup:**
- `AGENTS.md` — Agent operating instructions
- `SOUL.md` — Personality/tone
- `USER.md` — About Rodrigo
- `MEMORY.md` — Long-term memory (main session only)
- `memory/YYYY-MM-DD.md` — Daily logs

**Key instructions for dispatch:**

From `AGENTS.md`:
> "When someone says 'remember this' → update memory/YYYY-MM-DD.md or relevant file"
> "Text > Brain 📝 — if you want to remember something, WRITE IT TO A FILE"

The agent logs all dispatches to daily memory files for continuity.

---

## Troubleshooting

### Bridge Not Sending to AI

**Symptom:** Activity log shows no incidents sent

**Diagnosis:**
```bash
curl http://localhost:8082/api/bridge/status | jq '.paused'
```

**Solution:** Resume bridge (`POST /api/bridge/resume`)

### AI Not Responding

**Symptom:** Activity log shows "❌ No AI response"

**Diagnosis:**
```bash
# Check OpenClaw gateway
openclaw status

# Check gateway logs
tail -f ~/.openclaw/logs/gateway.log
```

**Common causes:**
- Gateway not running
- Token authentication failed
- Main session overloaded

**Solution:** Restart OpenClaw gateway

### Drone Commands Failing

**Symptom:** AI says "dispatched" but drone doesn't move

**Diagnosis:**
```python
import drone_control as dc
dc.set_drone_name('drone1')
print(dc.get_state())
```

**Common causes:**
- rosbridge_relay disconnected
- drone_core not running
- PX4 not in OFFBOARD mode

**Solution:** See `TROUBLESHOOTING.md`

### Incidents Not Appearing

**Symptom:** Incident queue empty, no activity

**Diagnosis:**
```bash
# Check dispatch service
curl http://localhost:8081/api/incidents/active

# Check dispatch logs
ps aux | grep dispatch_service
```

**Solution:** Restart dispatch service

---

## Demo Operation

**Pre-Demo:**
1. ✅ Verify all services running (preflight checklist)
2. ✅ Verify both cameras working
3. ✅ Verify bridge is **PAUSED**
4. ✅ Open frontend in browser (full screen)

**During Demo:**

1. **Show incident queue** (incidents accumulating, status "new")

2. **Resume bridge** (click RESUME button in Activity Feed)

3. **Watch AI dispatch** in real-time:
   - Activity feed shows incident detection
   - AI response appears
   - Drone command execution
   - Status updates to "dispatched"

4. **Show multi-drone coordination** (if 2+ incidents):
   - drone1 dispatched to incident A
   - drone2 dispatched to incident B
   - Both visible on map + cameras

5. **Show autonomy** (no human intervention):
   - Point out: "I didn't tell it what to do"
   - "It decided which drone, calculated path, flew it there"
   - "This is autonomous dispatch, not chatbot control"

6. **Pause bridge** when demo window complete

**Post-Demo:**
- Pause bridge to prevent token burn
- Check memory files for incident logs
- Review activity feed for any errors

---

## Future Enhancements

### Planned
- [ ] Incident map overlay (show locations on MiniMap)
- [ ] Multi-drone collision avoidance
- [ ] Real-time ETA calculation
- [ ] Voice dispatch alerts (TTS)
- [ ] Incident resolution workflow (AI lands drone, marks resolved)

### Under Consideration
- [ ] Real 911 API integration (not simulation)
- [ ] Live camera object detection (detect fire/person)
- [ ] Fleet optimization (nearest drone, fuel level)
- [ ] Incident priority override (human operator can intervene)

---

## See Also

- `TESTING.md` — End-to-end testing procedures
- `PREFLIGHT_CHECKLIST.md` — Pre-demo verification
- `TROUBLESHOOTING.md` — Common issues
- `docs/MULTI_DRONE_CAMERAS.md` — Camera setup for demos
- `FRONTEND_TEST_REPORT.md` — Latest test results
