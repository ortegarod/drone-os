# Dispatch V2 — Fleet Commander + Drone Pilots

## Current Architecture (V1)

```
Incident → Bridge → Single AI Session → (arm, climb, fly, monitor, report) → Done
```

- One AI session handles everything sequentially
- Blocks on each incident until drone arrives on scene
- Second incident waits in queue
- Slow: full flight sequence ties up the AI

## Proposed Architecture (V2)

```
Incident → Bridge → Fleet Commander (main agent)
                         ↓
                    Assess situation (fleet status, priorities)
                    Pick best drone
                    Delegate to sub-agent
                         ↓
              ┌──────────┼──────────┐
              ▼          ▼          ▼
         Pilot:drone1  Pilot:drone2  Pilot:drone3
         (sub-agent)   (sub-agent)   (sub-agent)
         Owns flight   Owns flight   Owns flight
```

### Fleet Commander (main agent — Ada)
- Receives incident from bridge
- Has full situational awareness: all drone states, active incidents, priorities
- Decides which drone to dispatch
- Spawns or sends command to a drone pilot sub-agent
- Reports back immediately (sub-second decision time)
- Can handle multiple incidents concurrently
- Can re-prioritize and reroute drones mid-flight

### Drone Pilots (sub-agents — one per drone)
- Each pilot owns one drone
- Receives mission: "fly to (x, y), incident type, priority"
- Executes flight sequence: arm → climb → fly → monitor → report arrival
- Reports status back to fleet commander
- Can be given new orders mid-flight (reroute)

## Benefits
- **Parallel dispatch** — multiple incidents handled simultaneously
- **Faster response** — fleet commander decides in sub-seconds, delegates immediately
- **Cleaner separation** — decision making vs flight execution
- **Scalable** — add more drones, add more pilots
- **Accurate latency metrics** — decision time is genuinely fast

## Implementation Notes
- Use OpenClaw `sessions_spawn` for pilot sub-agents
- Bridge sends incidents to fleet commander (main session)
- Fleet commander uses `sessions_spawn` or `sessions_send` to delegate
- Pilot sub-agents have access to drone_control.py
- Status updates flow back via session messaging or incident API patches
