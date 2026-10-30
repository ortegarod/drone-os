# DroneOS Python SDK + CLI

Python package and `droneos` command for flying DroneOS drones. Everything goes through the **fleet API** (`fleet_api/`); nothing here talks ROS. Operators, scripts and the AI agent all use the same commands.

## Setup
```bash
pip install ./sdk/python
mkdir -p ~/.config/droneos && echo '{"api": "http://127.0.0.1:8090", "token": "<your token>"}' > ~/.config/droneos/client.json && chmod 600 ~/.config/droneos/client.json
```
(or set `DRONEOS_API` / `DRONEOS_TOKEN`)

## CLI
```
droneos drones                          # fleet overview
droneos takeoff drone1 --alt 10         # waits until at altitude
droneos goto drone1 20 0                # meters north, east of home
droneos patrol drone1 "40,0 40,30 -10,30" --alt 15 --loops 2   # runs onboard
droneos land drone1                     # or: droneos home drone1
droneos control drone1 release          # let someone else fly it
droneos log -n 20
```
Run `droneos -h` for everything.

## Python
```python
from droneos import Drone, fleet

with Drone("drone1") as d:      # releases control on exit
    d.takeoff(10)
    d.goto(20, 0)
    d.land()
    d.patrol([(40, 0), (40, 30)], altitude=15, loops=2)   # onboard; survives script exit
```

## Plugins
`droneos.plugin` turns one function into a plugin (a job type operators can start from the Command Center, the CLI or
Python): `pip install './sdk/python[plugin]'`. Guide: [docs/plugins.md](../../docs/plugins.md); example: `plugins/inspect/service.py`.
