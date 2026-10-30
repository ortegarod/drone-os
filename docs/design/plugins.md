# DroneOS jobs: plugin design

Status: built. Jobs, the plugin registry and the plugin proxy live in the fleet API; Patrol, Dispatch, Inspect, Search and Follow are plugins. Every job UI ships with its plugin (a plain ES module using window.DroneOS), plugins install live, and the fleet API checks that each running job's plugin still answers. Developer guide: [../plugins.md](../plugins.md).

## The idea
A **job** is what a drone is doing beyond being flown by hand: patrol a route, respond to an incident, inspect a roof, follow a vehicle... We can't write them all, so job types are **plugins**. Patrol and dispatch are the first two.

**One job per drone at a time.** A drone on patrol is not also on a dispatch. The fleet API enforces it, the same way it enforces one pilot per drone.

## What a plugin is
A manifest plus up to three parts. Each part is optional.

| Part | Runs | Job | Example |
|---|---|---|---|
| Cloud service | its own process on the command center | the job's logic: decides, sequences, records | dispatch: incidents → pick the closest drone; patrol: route, photos, report |
| Onboard part | on the drone, as its **own ROS 2 node in its own container** next to drone_core (usually a PX4 external mode via px4-ros2-interface-lib); drone_core only selects the mode and relays its status | whatever must keep working if the link drops | patrol: the PATROL mode flies the loop and goes home on its own |
| UI part | in the command center, Job tab + map | start it (planner), watch it (live), look back (history) | patrol: draw route, progress, photo report |

Manifest (`droneos-plugin.json`): id, name, version, which parts it has, the UI bundle URL, the service URL, and the onboard capability it needs (e.g. external mode "PATROL").

## Rules (same for every plugin)
- **A plugin flies drones only through the fleet API**, with its own operator name (e.g. "patrol", "dispatch"). No ROS from the cloud side. Everything it does lands in the activity log.
- **Starting a job takes the drone's control** under the plugin's name. A human or agent can take over at any time (force take control). That **ends or pauses the job**, and the plugin is told.
- **Safety commands always win:** land, return home and kill from anyone **end** the job; **hold pauses it** (resume continues from the current point, as patrol does today). PX4 failsafes and the geofence apply as always; a plugin can't switch them off.
- **Onboard parts must be safe alone:** if the cloud service or the link dies mid-job, the drone finishes or holds/returns home by itself (patrol already does: process dies → PX4 RTL in ~1 s).

## Fleet API additions
- `GET /api/v1/plugins`: the plugins, bundled (folders in a plugins dir, re-read when it changes) and installed (`POST /api/v1/plugins` with a manifest, admins only; each gets its own operator token, shown once, stored hashed; `DELETE /api/v1/plugins/{id}` revokes it, refused while its job runs).
- `GET /api/v1/drones/{name}/job`: the active job or null: {plugin, id, started, operator, status text ("point 3 of 4"), progress 0-1, links}.
- `POST /api/v1/drones/{name}/job` (plugin starts a job; refused if the drone already has one), `PATCH` (plugin adds status text / links), `DELETE` (ends it, with a result: completed / stopped / failed + a link to its report).
- **Progress comes from the drone**, not from the plugin: drone_core already reports it (mission status / PatrolStatus), so a dead cloud service doesn't freeze what operators see.
- **How a job ended** is decided by the fleet API: control taken by someone → "stopped by operator"; PX4 failsafe set → "failsafe"; landed + disarmed after the plan finished → "completed"; otherwise "failed". (On PX4 1.15.4 an RTL that ends in a landing sends no mode_completed, so landed + disarmed is the signal.)
- `GET /api/v1/jobs?drone=&plugin=`: history (the "Reports" view lists every job, any plugin).
- **Event stream** (WebSocket `/api/v1/events`): mode_completed, control taken/released, job started/updated/ended, failsafe on/off, so plugins react instead of polling.
- **Capabilities per drone:** drone_core publishes a retained `/<drone>/capabilities` topic: for each onboard mode its name, nav_state, plugin version and whether its heartbeat is fresh. The UI only offers jobs the drone can do. Always refer to modes **by name**: nav_state numbers depend on registration order (PATROL is 24 on drone1, 23 on drone2/3).

## UI contract
The command center loads a plugin's UI bundle (an ES module from its manifest URL) and gives it: the drone, its live state, a command runner (fleet API), and a small map API (draw a route/markers, ask for map clicks, show photo spots). It renders in the Job tab (planner when idle, live view while its job runs) and in Reports (history entries). Trusted plugins only for now; third-party ones would go in an iframe later.

## Migration
1. **Patrol becomes plugin #1:** move the route store and the report recorder (patrols.py) out of the fleet API into a patrol service; the onboard PATROL mode stays as it is.
2. **Dispatch:** already a separate service (dispatch_service + bridge). Make it use the job API; fold the useful bits of the /dispatch page (incident queue) into its UI part, then delete the old page.
3. Write the plugin SDK docs + a tiny example plugin (e.g. "orbit a point for N minutes and take photos").

## Onboard rules
- **One container per plugin**, all from one image: a crash takes out only its own mode, and PX4 drops a dead mode by itself.
- **drone_core also refuses a second job** while one is running or paused (STOP first). The fleet API stays the main check.
- **PX4 1.15.4 limits:** at most 8 external modes (EXTERNAL1-8) and 5 executors per drone; new registrations only take effect **while disarmed** (no installing/restarting a plugin mid-flight); a dead mode that is still selected blocks arming (drone_core switches to Hold after 3 s to clear it). px4-ros2-interface-lib pinned at 1.4.0.
- Today a manual mode change mid-job only shows onboard as "deactivated"; QGC/RC switches look the same. Hence the fleet API rule above for how a job ended.

## Questions we asked (answered above)
1. Packaging onboard parts: one container per plugin (like patrol_node today) or one shared plugin host node?
2. Capabilities: is listening to PX4's registered external modes (register_ext_component / vehicle_status nav states) enough to say "this drone can PATROL", or should drone_core publish an explicit capabilities topic?
3. Job arbitration onboard: should drone_core also refuse a second job (defence in depth), or is the fleet API enough?
4. Taking over mid-job: a manual command during PATROL switches PX4 out of the mode; does the onboard part reliably notice and report "stopped by operator" vs "failed"?
5. Limits of external modes on 1.15.4 we should design around (number of modes, the dead-mode can_arm catch, etc.).
