# DroneOS

Open-source framework for autonomous drone control, built on ROS 2 and PX4 Autopilot.

## What It Does

DroneOS provides the software layer between you and PX4. Instead of publishing raw DDS topics, you get:

- **C++ SDK** (`drone_core`) — High-level drone control as ROS 2 services
- **Python API** (`drone_control.py`) — Remote control via rosbridge from anywhere
- **CLI** (`droneos`) — Quick operations and AI agent interface

Works in simulation (PX4 SITL + Gazebo) and on real hardware (Pixhawk + Raspberry Pi over 4G/VPN).

## Quick Start (Simulation)

This gets you from zero to a drone flying in simulation on a single machine. One simulated drone, one computer, no physical drone hardware required.

### 1. Clone

```bash
# Clone PX4 Autopilot (in your workspace)
git clone https://github.com/PX4/PX4-Autopilot.git

# Clone DroneOS
git clone https://github.com/ortegarod/drone-os.git
```

### 2. Start PX4 Simulation

```bash
cd PX4-Autopilot
HEADLESS=1 make px4_sitl gz_x500
```

Wait for `Ready for takeoff!` in the terminal. This runs PX4 with Gazebo — a full drone simulator.

### 3. Start DroneOS

In a new terminal:

```bash
cd drone-os
docker compose -f docker/dev/docker-compose.dev.yml up -d --build drone_core micro_agent
```

This starts:
- **`drone_core`** — the SDK node that exposes drone control services
- **`micro_agent`** — the DDS bridge between PX4 and ROS 2

### 4. Verify

```bash
docker logs -f drone_core_node
```

You should see services registering: `/drone1/arm`, `/drone1/takeoff`, `/drone1/set_position`, etc. If you see those, you're good.

### 5. Fly

```bash
python3 drone_control.py --drone drone1 --set-offboard
python3 drone_control.py --drone drone1 --arm
python3 drone_control.py --drone drone1 --set-position 0 0 -50
```

The drone is now 50 meters up. The coordinate system is NED (North-East-Down), so **negative Z = altitude**. `-50` means 50 meters above the takeoff point.

```bash
python3 drone_control.py --drone drone1 --set-position 80 -40 -50
```

Now it's flying 80m north and 40m west at 50m altitude.

```bash
python3 drone_control.py --drone drone1 --land
```

That's it. You just flew a drone.

### 6. Cleanup

```bash
docker compose -f docker/dev/docker-compose.dev.yml down
```

Then `CTRL+C` in the PX4 terminal.

## Real Hardware Deployment

Same codebase, different Docker Compose file:

```bash
# On Raspberry Pi with Pixhawk connected
docker compose -f docker/prod/docker-compose.yml up -d --build drone_core micro_agent
```

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Flight Controller | PX4 Autopilot |
| Simulation | Gazebo |
| Middleware | ROS 2 Humble + Micro XRCE-DDS |
| SDK | C++ (`drone_core`) |
| Remote Control | Python (`drone_control.py`) via rosbridge |
| Deployment | Docker |

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for how to get started.

## Documentation & More Info

For thorough documentation, roadmaps, multi-drone setups, camera configurations, and the full system architecture, please visit the official website:

**[aerisrobotics.com/docs](https://aerisrobotics.com/docs)**

## License

Open source. See [LICENSE](LICENSE) for details.
