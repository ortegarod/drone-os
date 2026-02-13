# AI Emergency Drone Dispatch — Architecture

## Core Idea

911-style incidents come in → AI agent decides which drone to send → drone flies there autonomously → streams live video → returns home → repeat. Judges see this running live on the website.

---

## Components

### 1. Dispatch Service (Python, VPS)
Generates incidents and publishes state. Does NOT make decisions or fly drones.

- Generates simulated 911 incidents on a timer
- Tracks fleet state (drone availability, battery, position)
- Tracks incident state (new → dispatched → on_scene → resolved)
- Sends incidents to the AI agent via `chat.send`
- Publishes all state to frontend via rosbridge topics

### 2. AI Agent (OpenClaw, VPS)
The brain AND the hands. Makes decisions and flies the drones directly.

- Receives incident + fleet state from dispatch service
- Evaluates priority, proximity, availability
- Executes flight commands directly via `drone_control.py` (already has exec access)
- Reports actions back so dispatch service can update state
- Runs on the same VPS, accessed via gateway WebSocket

### 3. Frontend (React, VPS)
Pure display. Subscribes to rosbridge topics and shows everything.

### 4. Simulation (srv01)
PX4 SITL + Gazebo + drone_core. No changes needed.

---

## How the AI Integration Works

OpenClaw gateway runs on the VPS at `ws://localhost:18789`. It exposes:

| Method | Purpose |
|--------|---------|
| `chat.send` | Send a message to the AI, get a response |
| `chat.inject` | Append to transcript without triggering a run |
| `chat.history` | Get conversation history |

### The dispatch service talks to me like this:

```
dispatch_service → ws://localhost:18789 (OpenClaw gateway)

chat.send({
  message: "DISPATCH DECISION NEEDED:
    Incident: P1 medical emergency at (80, -40) — cardiac arrest, 45yo male
    Fleet:
      drone1: AVAILABLE, battery 85%, at base (0, 0)
      drone2: ON_SCENE at incident inc-038, battery 52%, at (-30, 60)
    Active incidents: inc-038 (P2 traffic accident, drone2 assigned)
    
    Which drone should respond? Respond with JSON: {action, drone, reasoning}"
})

AI responds → dispatch_service parses → executes decision
```

After executing, the service uses `chat.inject` to log what happened:
```
chat.inject("Executed: drone1 dispatched to inc-042. ETA 45 seconds.")
```

### Why this works
- No custom webhook needed — the gateway IS the API
- The AI sees the full conversation history (prior decisions, context)
- Any AI framework that speaks WebSocket could replace OpenClaw
- The gateway handles auth, sessions, rate limiting

---

## System Diagram

```
┌──────────────────────────────────────────────────────────────┐
│                      VPS (Vultr Cloud)                        │
│                                                               │
│  ┌────────────────────────────────────────────────────────┐   │
│  │              dispatch_service (Python)                  │   │
│  │                                                        │   │
│  │  Incident       Fleet                                  │   │
│  │  Generator  →   Manager                                │   │
│  │  (fake 911)     (tracks                                │   │
│  │                  drones)                                │   │
│  │                                                        │   │
│  │       │  "what should I do?"        ▲  decision         │   │
│  │       ▼                             │                  │   │
│  │  ┌──────────────────────────────────────┐              │   │
│  │  │  OpenClaw Gateway (ws://localhost:18789)            │   │
│  │  │  chat.send() → AI thinks → response                │   │
│  │  └──────────────────────────────────────┘              │   │
│  │                                                        │   │
│  │       │ publishes state (roslibpy)                     │   │
│  │       ▼                                                │   │
│  │  /dispatch/incidents                                   │   │
│  │  /dispatch/fleet_status                                │   │
│  │  /dispatch/activity_log                                │   │
│  └────────────────────────┬───────────────────────────────┘   │
│                           │                                    │
│                    rosbridge (:9090)                           │
│                     ▲            ▲                             │
│                     │            │                             │
│              ┌──────┘            └──────────┐                 │
│              │                              │ Tailscale       │
│     Frontend (:3000)                        │                 │
│     roslib.js subscribes to:                │                 │
│     • /dispatch/* (new)                     │                 │
│     • /droneN/drone_state (existing)        │                 │
│     • /droneN/camera (existing)             │                 │
│                                             │                 │
│     ┌─────────┐ ┌──────────┐ ┌──────────┐  │                 │
│     │  LEFT   │ │  CENTER  │ │  RIGHT   │  │                 │
│     │ Fleet + │ │ Camera   │ │  Map     │  │                 │
│     │ Incident│ │ Feed     │ │ (drones  │  │                 │
│     │ Queue   │ ├──────────┤ │ +markers)│  │                 │
│     │         │ │ AI       │ ├──────────┤  │                 │
│     │         │ │ Activity │ │ Controls │  │                 │
│     │         │ │ Log      │ │          │  │                 │
│     └─────────┘ └──────────┘ └──────────┘  │                 │
│     ┌────────────────────────────────────┐  │                 │
│     │ Console (footer)                   │  │                 │
│     └────────────────────────────────────┘  │                 │
└──────────────────────────────────────────────┼────────────────┘
                                               │
┌──────────────────────────────────────────────┴────────────────┐
│                      srv01 (Simulation)                        │
│                                                                │
│   PX4 SITL (drone1)    PX4 SITL (drone2)    Gazebo            │
│   drone_core (x2)      sim_camera            ros-gz-bridge     │
└───────────────────────────────────────────────────────────────┘
```

---

## Incident Lifecycle (Sequence)

```
dispatch_service              OpenClaw AI                   srv01
      │                           │                            │
  [generate incident]             │                            │
  P1 medical @ (80,-40)          │                            │
      │                           │                            │
      ├── chat.send ─────────────▶│                            │
      │   "P1 medical at (80,-40) │                            │
      │    drone1 AVAILABLE       │                            │
      │    drone2 ON_SCENE        │                            │
      │    What do?"              │                            │
      │                           │ thinks...                  │
      │                           │ drone1 closer + free       │
      │                           │                            │
      │                           ├── set_offboard("drone1") ─▶│
      │                           ├── arm("drone1") ──────────▶│
      │                           ├── set_position(80,-40) ───▶│
      │                           │                            │
      │◀── chat.inject ──────────┤                            │
      │   "Dispatched drone1      │                            │
      │    to P1 medical.         │                            │
      │    Reasoning: closest,    │                            │
      │    85% battery"           │                            │
      │                           │                            │
      ├── publish /dispatch/activity_log                       │
      ├── publish /dispatch/fleet_status: EN_ROUTE             │
      │                           │                            │
      │                           │ [polls get_state()...]     │
      │                           │ [drone approaching...]     │
      │                           │                            │
      │◀── chat.inject ──────────┤                            │
      │   "drone1 on scene"       │                            │
      ├── publish: ON_SCENE       │                            │
      │                           │                            │
      │                           │ [dwell ~30s]               │
      │                           │                            │
      │                           ├── land("drone1") ─────────▶│
      │◀── chat.inject ──────────┤                            │
      │   "drone1 returning"      │                            │
      ├── publish: RETURNING → CHARGING                        │
      │                           │                            │
      │ [charge timer ~60s]       │                            │
      ├── publish: AVAILABLE      │                            │
```

---

## ROS Topics

### Existing (no changes)
| Topic | Source | Description |
|-------|--------|-------------|
| `/droneN/drone_state` | drone_core (srv01) | Drone telemetry |
| `/droneN/camera` | sim_camera (srv01) | Camera feed |

### New (dispatch_service publishes via roslibpy)
| Topic | Type | Content |
|-------|------|---------|
| `/dispatch/incidents` | std_msgs/String | JSON array of active incidents |
| `/dispatch/fleet_status` | std_msgs/String | JSON object of per-drone state |
| `/dispatch/activity_log` | std_msgs/String | JSON array of AI decisions/events |

---

## Drone State Machine

```
    ┌──────────┐
    │AVAILABLE │◀────────────────────┐
    └────┬─────┘                     │
         │ AI: DISPATCH         charge complete
         ▼                           │
    ┌──────────┐               ┌─────┴────┐
    │ EN_ROUTE │               │ CHARGING  │
    └────┬─────┘               └─────▲────┘
         │ arrived                   │ landed
         ▼                           │
    ┌──────────┐               ┌─────┴────┐
    │ ON_SCENE │──────────────▶│RETURNING │
    └──────────┘  resolved     └──────────┘
```

---

## Incident Types

| Type | Priority | Example |
|------|----------|---------|
| `medical_emergency` | P1 | "Cardiac arrest, 45yo male" |
| `structure_fire` | P1 | "Residential fire, smoke visible" |
| `traffic_accident` | P1/P2 | "Multi-vehicle collision" |
| `suspicious_activity` | P2 | "Armed individual near school" |
| `missing_person` | P2 | "Child missing from park" |
| `noise_complaint` | P3 | "Loud party" |
| `property_damage` | P3 | "Vandalism at strip mall" |

---

## Files to Create

```
dispatch/
├── dispatch_service.py     # Main loop (generates incidents, asks AI, publishes state)
├── fleet_manager.py        # Drone state tracking + battery simulation
├── incident_generator.py   # Fake 911 call generator
└── config.py               # Timers, area bounds, incident types
```

Frontend changes:
- `FleetDashboard.tsx` — add incident queue + AI activity log
- `MiniMap.tsx` — add incident markers
- New: `useDispatchState.ts` hook — subscribe to /dispatch/* topics
