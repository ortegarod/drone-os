# DroneOS

Open-source framework for autonomous drone control, built on ROS 2 and PX4 Autopilot.

## What It Does

DroneOS provides the software layer between you and PX4. Instead of publishing raw DDS topics, you get:

- **C++ SDK** (`drone_core`) — High-level drone control as ROS 2 services
- **Fleet API** (`fleet_api/`) — the one gateway to the drones: operator login, one pilot per drone, command log, live telemetry
- **Python client + CLI** (`droneos`, `sdk/python/`) — script or fly drones through the fleet API; the AI agent uses the same CLI
- **Command center** (`web_interface/`) — web UI on the same API
- **Jobs as plugins** (`plugins/`, [docs/plugins.md](docs/plugins.md)) — what a drone does beyond hand flying: Patrol, Inspect, Dispatch (demo); install your own while everything runs

Works in simulation (PX4 SITL + Gazebo) and on real hardware (Pixhawk + Raspberry Pi over 4G/VPN).

## Quick Start (Simulation)

This gets you from zero to a drone flying in simulation on a single machine. One simulated drone, one computer, no physical drone hardware required.

### 1. Clone

```bash
# Clone PX4 Autopilot (in your workspace)
git clone https://github.com/PX4/PX4-Autopilot.git

# Clone DroneOS (with px4-ros2-interface-lib, a submodule)
git clone --recurse-submodules https://github.com/ortegarod/drone-os.git
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

Start the fleet API (it reaches `drone_core` through rosbridge), then fly with the `droneos` CLI:

```bash
mkdir -p ~/.config/droneos
KEY=$(python3 -c 'import secrets; print(secrets.token_urlsafe(24))')
echo "{\"$KEY\": \"me\"}" > ~/.config/droneos/fleet_api_tokens.json      # operator keys
echo "{\"api\": \"http://127.0.0.1:8090\", \"token\": \"$KEY\"}" > ~/.config/droneos/client.json

cd fleet_api && python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
.venv/bin/uvicorn app:app --port 8090 &
cd .. && pip install ./sdk/python

droneos takeoff drone1 --alt 50      # arm and climb to 50 m
droneos goto drone1 80 -40           # 80 m north, 40 m west
droneos land drone1
```

That's it. You just flew a drone. `droneos -h` lists everything (patrol, return home, control, log).

### 6. Cleanup

```bash
docker compose -f docker/dev/docker-compose.dev.yml down
```

Then `CTRL+C` in the PX4 terminal.

## Program Your Drone (Python client + CLI)

The `droneos` Python package and CLI fly drones through the **fleet API** (`fleet_api/`), the same API the command center uses. Tested in simulation (PX4 SITL); not yet tested on real hardware.

```bash
pip install ./sdk/python
droneos drones
droneos patrol drone1 "40,0 40,30 -10,30" --alt 15 --loops 2   # runs onboard, survives disconnects
```

```python
from droneos import Drone

with Drone("drone1") as d:
    d.takeoff(10)                      # arm and climb to 10 m
    for n, e in [(20, 0), (20, 20), (0, 20), (0, 0)]:
        d.goto(n, e)                   # meters north, east of home; waits until arrival
    d.land()
```

Setup and all commands: `sdk/python/README.md`. API: `fleet_api/README.md`.

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
| Remote Control | Fleet API (FastAPI) + `droneos` Python client/CLI |
| Deployment | Docker |

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for how to get started.

## Documentation & More Info

For thorough documentation, roadmaps, multi-drone setups, camera configurations, and the full system architecture, please visit the official website:

**[aerisrobotics.com/docs](https://aerisrobotics.com/docs)**

## License

Open source. See [LICENSE](LICENSE) for details.
