# DroneOS

Open-source framework for autonomous drone control, built on ROS 2 and PX4 Autopilot.

> **[Full Documentation →](https://aerisrobotics.com/docs)**

## What It Does

DroneOS provides the software layer between you and PX4. Instead of publishing raw DDS topics, you get:

- **C++ SDK** (`drone_core`) — High-level drone control as ROS 2 services
- **Python API** (`drone_control.py`) — Remote control via rosbridge from anywhere
- **CLI** (`droneos`) — Quick operations and AI agent interface
- **AI Fleet Dispatch** — Autonomous multi-drone dispatch in simulation
- **Web Command Center** — Real-time dashboard with telemetry, cameras, and AI chat

Works in simulation (PX4 SITL + Gazebo) and on real hardware (Pixhawk + Raspberry Pi over 4G/VPN).

## AI Fleet Dispatch

An AI agent receives incidents, evaluates fleet status, picks the best drone, and flies it to the scene — no human pilot.

```
Incident → Dispatch Service (:8081)
                ↓ polled by
           Bridge (:8082) → queries fleet, builds prompt
                ↓ POST /hooks/agent
           OpenClaw AI → picks drone, arms, climbs, flies
                ↓
           Dispatch Service monitors → on_scene → auto-RTL → resolved
```

**~10 seconds** from incident to drone airborne.

| Metric | Measured |
|--------|----------|
| Incident-to-Dispatch | ~10-12s |
| AI Decision Time | ~3-4s |
| Command Execution | ~2.5s (over Tailscale VPN) |

## Architecture

```
┌──────────────────────────────────────────────────────────┐
│                   VPS (Command Center)                    │
│                                                           │
│  Frontend (:3000)  ·  OpenClaw AI  ·  Bridge (:8082)     │
│  Dispatch Service (:8081)  ·  droneos CLI                │
│                        │ Tailscale VPN                    │
└────────────────────────┼──────────────────────────────────┘
                         ▼
┌──────────────────────────────────────────────────────────┐
│              Drone / Simulation Server                     │
│                                                           │
│  PX4 SITL + Gazebo  ·  drone_core  ·  rosbridge (:9090) │
│  Micro-XRCE-DDS Agent  ·  Camera feeds                   │
└──────────────────────────────────────────────────────────┘
```

## Quick Start

```bash
# Clone PX4 Autopilot
git clone https://github.com/PX4/PX4-Autopilot.git
cd PX4-Autopilot
HEADLESS=1 make px4_sitl gz_x500

# Clone DroneOS (in another terminal)
git clone https://github.com/ortegarod/drone-os.git
cd drone-os
docker compose -f docker/dev/docker-compose.dev.yml up -d --build drone_core micro_agent

# Fly
python3 drone_control.py --drone drone1 --set-offboard
python3 drone_control.py --drone drone1 --arm
python3 drone_control.py --drone drone1 --set-position 0 0 -50
python3 drone_control.py --drone drone1 --land
```

See [Prerequisites](https://aerisrobotics.com/docs/getting-started/prerequisites) and [Quick Start Guide](https://aerisrobotics.com/docs/getting-started/quick-start) for full setup.

## CLI Reference

```bash
droneos --fleet-status                           # All drones
droneos --drone drone1 --get-state               # Full telemetry (JSON)
droneos --drone drone1 --set-offboard            # Enter offboard mode
droneos --drone drone1 --arm                     # Arm motors
droneos --drone drone1 --set-position 60 -60 -50 # Fly to position (NED)
droneos --drone drone1 --land                    # Land
droneos --drone drone1 --rtl                     # Return to launch
```

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Flight Controller | PX4 Autopilot |
| Simulation | Gazebo |
| Middleware | ROS 2 Humble + Micro XRCE-DDS |
| SDK | C++ (`drone_core`) |
| Remote Control | Python (`drone_control.py`) via rosbridge |
| AI | OpenClaw + Claude |
| Frontend | React + TypeScript |
| Networking | Tailscale VPN |
| Deployment | Docker |

## Real Hardware

Same codebase, different Docker Compose file:

```bash
# On Raspberry Pi with Pixhawk connected
docker compose -f docker/prod/docker-compose.yml up -d --build drone_core micro_agent
```

Build the camera service separately when you need camera support. It compiles Raspberry Pi camera components from source, so it can take much longer than the control stack.

```bash
docker compose -f docker/prod/docker-compose.yml build camera_service
docker compose -f docker/prod/docker-compose.yml up -d camera_service
```

After the images are built, start all services without rebuilding:

```bash
docker compose -f docker/prod/docker-compose.yml up -d drone_core micro_agent camera_service
```

X500 airframe · Pixhawk · Raspberry Pi 5 · 4G + Tailscale VPN

See [Real Hardware Setup](https://aerisrobotics.com/docs/getting-started/pixhawk_drone_deployment).

## Documentation

Full docs at **[aerisrobotics.com/docs](https://aerisrobotics.com/docs)**

- [SDK Reference](https://aerisrobotics.com/docs/sdk-reference/drone-core) — C++ SDK, Python API, CLI, MCP Server
- [Architecture](https://aerisrobotics.com/docs/architecture/system-overview) — System overview, AI dispatch, coordinate frames
- [Operations](https://aerisrobotics.com/docs/operations/multi-drone) — Multi-drone, cameras, preflight, troubleshooting

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for how to get started.

## License

Open source. See [LICENSE](LICENSE) for details.
