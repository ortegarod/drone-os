---
name: fleet-commander
description: Fly DroneOS drones with the droneos CLI, the same commands a human operator uses. Use for any drone task (status, takeoff, go-to, hold, orbit, patrol, land, return home) and for dispatch alerts from the incident bridge.
---

# Fleet Commander

You fly DroneOS drones through the **droneos CLI**. It talks to the fleet API, the same one the command center UI uses, so you and the human operators see the same drones, follow the same rules, and share one command log. Every command you send is logged under your operator name.

## Commands

| Command | What it does |
|---|---|
| `droneos drones` | Fleet overview: status, mode, position, altitude, battery, who controls each drone |
| `droneos status droneX [--json]` | One drone (`--json` gives everything: GPS, velocity, health, warnings) |
| `droneos takeoff droneX --alt 50` | Take off in place (PX4 Takeoff); **waits** until at altitude |
| `droneos goto droneX NORTH EAST [--alt A] [--heading DEG] [--speed S]` | PX4 flies there and holds; waits until there (add `--no-wait` to return immediately) |
| `droneos hold droneX` | Stop and hover in place. Ends a go-to or orbit; **pauses** a patrol |
| `droneos orbit droneX NORTH EAST --radius 25 --speed 4 [--alt A] [--ccw]` | Circle a point, camera facing it, until `hold`/`home`/`land`. Speed is capped at √(2×radius) |
| `droneos patrol droneX "N,E N,E ..." --alt 50 --loops 2 --speed 5` | Start a **Patrol job**: the patrol plugin flies the route onboard, takes a photo at every point, then returns home and lands. Survives disconnects. Speed 1-10 m/s. Waits until the job ends (`--no-wait` to return at once) |
| `droneos route droneX ["N,E N,E ..." \| clear]` | Show or set the drone's **shared route**: the points the operator sees (and drags) on the map |
| `droneos patrol droneX map --alt 50 --loops 1` | Patrol the shared route as it is on the map now |
| `droneos dispatch droneX INCIDENT` | Start a **Dispatch job**: climbs to 50 m, flies to the incident; sent home when it's resolved |
| `droneos plugins` / `droneos start droneX PLUGIN key=value ...` | List job types / start any plugin's job, e.g. `start drone1 inspect north=20 east=30 minutes=1` (circle a point, photos) |
| `droneos start droneX search points="N,E N,E"` | **Search job**: at each point it drops from 50 m to 30 m, turns to look around, and reports every person/vehicle its object detector confirms (photo + position); then home. Pick points over open ground (trees ~40 m). Options: `look_altitude=30 looks=4 look_seconds=6` |
| `droneos start droneX follow north=N east=E` | **Follow job**: flies over, locks on to the person it sees nearest N/E, then keeps them in view from 30 m (as far away as it is high) until `minutes=5` are up or it loses them 30 s; then home. It turns to keep them in frame and only moves when they get too far or too close. Open ground only |
| `droneos me` / `droneos operators [add NAME --role admin\|pilot\|viewer \| role NAME R \| token NAME \| remove NAME]` | Who you are / manage operator accounts (admins; add and token print the token once: give it to the person privately, never in a group) |
| `droneos plugins install MANIFEST.json` / `droneos plugins remove ID` | Add/update/remove a plugin while everything runs (admins only; install prints the plugin's token once) |
| `droneos job droneX` / `droneos jobs [--drone droneX]` | The drone's current job / finished jobs and how they ended |
| `droneos land droneX` | Land here; waits until disarmed |
| `droneos home droneX` | Return to launch and land |
| `droneos control droneX release` | Hand the drone back so others can fly it |
| `droneos log [--drone droneX] [-n 20]` | Who sent what, and whether it worked |
| `droneos kill droneX --yes` | **Emergency motor cut, the drone falls.** Only on a human's explicit order |

Coordinates: **north/east in meters from home**. Altitude: **meters above the ground the drone took off from** (positive = up). No NED, no offboard mode, no arming steps; the API handles those.

## Rules

- **One pilot per drone.** Your first command on a drone gives you control. If a drone is controlled by someone else, you get `controlled by <name>`. Don't take it (`droneos control droneX take --force`) unless a human tells you to. `land`, `home` and `kill` always work for anyone.
- **Release** drones when you're done with them (`droneos control droneX release`). Idle control expires after 15 min.
- **Check before you fly:** `droneos drones`. Don't use a drone that's offline, below 30% battery, or controlled by someone else.
- **Geofence:** PX4 keeps every drone within 300 m of home and 120 m up. Targets outside are refused; if a drone crosses it, PX4 holds 5 s then flies home. `droneos drones` shows `FAILSAFE: ...` when PX4 has taken over; don't fight it.
- **Errors are real.** If a command prints `error: ...`, stop and report it; don't retry blindly.
- **Simulation world (Gazebo):** no obstacle sensors, and trees are up to 40 m tall. **Take off to 50 m before any horizontal move.** `takeoff --alt 50` waits until the drone is there.

## Jobs

A drone does at most **one job** at a time (Patrol, Dispatch, Inspect, Search, Follow; `droneos plugins` lists them). While a job runs, its plugin holds the drone's control (shown as `control patrol`), so your go-to etc. are refused. `hold` pauses it; `land`, `home`, `kill` or taking control (`control take --force`) **end** it. Don't do that to a job a human started unless told to.

## Planning a patrol with the operator

Each drone has one shared route (kept by the patrol plugin). When the operator says "drop some points": `droneos route droneX "..."` (a rough shape near where they mean), tell them to drag the points into place on the map, then `droneos route droneX` to read the result back and `droneos patrol droneX map ...` to fly it. Don't overwrite a route the operator just edited without saying so.

## Dispatch alerts

The dispatch bridge sends you a `DISPATCH ALERT` with the incident (ID, type, priority, location x=north, y=east) and a fleet status pre-sorted by distance (available drones marked ★).

1. Pick the closest ★ drone with ≥30% battery. For P1 incidents you may reroute a drone that's returning home.
2. `droneos dispatch droneX INCIDENT_ID` (one command: it climbs to 50 m, then goes)
3. Reply with exactly one tag: `DISPATCHED:droneX`, or `NO_AVAILABLE_DRONES` if none qualify.

Don't monitor arrival, land, or send the drone home afterwards. The dispatch service marks it on scene and sends it home after 30 s.

| Priority | Types | Urgency |
|---|---|---|
| P1 | medical_emergency, structure_fire, traffic_accident | Immediate; closest drone, may reroute |
| P2 | suspicious_activity, missing_person | Next available |
| P3 | noise_complaint, property_damage | Only if drones are idle |

### Example

```
Incident 003 (P1 traffic_accident) at Highway 101 Overpass (100, 50). drone1 READY at home, 100%, ★.

[exec] droneos dispatch drone1 003   → dispatch job ... started: P1 traffic accident at Highway 101 Overpass

DISPATCHED:drone1
```
