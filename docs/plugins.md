# Writing a DroneOS plugin

A plugin adds a **job**: something a drone does beyond being flown by hand. Patrol, Dispatch,
Inspect, Search and Follow are the first five. A drone does at most one job at a time. Design and rules:
[design/plugins.md](design/plugins.md).

The smallest complete example is **plugins/inspect** (circle a point and take photos, ~250
lines of Python and ~100 of JS). Copy it.

## The pieces

```
plugins/<id>/
  droneos-plugin.json   manifest: the fleet API finds the plugin by this
  service.py            the plugin's service (any language; it's just HTTP)
  ui/job.js             optional: the plugin's screens in the Command Center
  (onboard part)        optional: a ROS 2 node / PX4 external mode on the drone (see patrol)
```

### 1. Manifest

```json
{
  "id": "inspect",
  "name": "Inspect",
  "version": "0.1.0",
  "description": "Circle a point and take photos.",
  "operator": "inspect",                    // the name it flies under (needs a fleet API token)
  "service_url": "http://127.0.0.1:8092",   // where the fleet API reaches the service
  "ui": "/ui/job.js"                        // path on the service, or "builtin:<id>", or omit
}
```

Two ways in, both live (no restart of anything):

- **Bundled:** a folder `$FLEET_API_PLUGINS/<id>/droneos-plugin.json` (the repo's `plugins/`). The fleet
  API notices new, changed or deleted folders within a second.
- **Installed:** send the manifest to the fleet API (`droneos plugins install droneos-plugin.json`, the
  Dev tab's "Install a plugin", or `POST /api/v1/plugins`). Only admins (`FLEET_API_ADMINS`) can.
  The plugin's service can run anywhere the fleet API reaches. Same id again = update.

### 2. Service

It answers three calls from the fleet API (they carry `X-DroneOS-Caller: fleet-api`):

| Call | When | Reply |
|---|---|---|
| `POST /jobs` `{"job": {"id", "drone", "operator"}, "args": {...}}` | someone starts the job | 200 `{"text": "short status", "links": {...}}`, or 4xx `{"detail": "why not"}` (the job is then marked failed) |
| `GET /jobs/{id}` | every 5 s while the job runs | 200 while you're running it; 404 if you don't know it (e.g. you restarted) |
| `POST /jobs/{id}/stopped` `{"reason"}` | an operator stepped in (land, return home, kill, took control) | 200; stop flying, keep your report |

**If the plugin stops answering** `GET /jobs/{id}` (down, erroring, or 404) for 15 s, the fleet API ends
the job as failed and sends the drone home. A blip shorter than that is ignored. Exception: a plugin
with an `onboard_mode` whose onboard part is flying the drone right now (e.g. Patrol): that finishes on
its own, so the fleet API only logs it. So keep the job's state somewhere that survives a restart if you
want a restart not to end your jobs.

While the job runs **the plugin holds the drone's control** under its operator name. It flies with
the normal fleet API commands (`POST /api/v1/drones/{name}/takeoff|goto|orbit|hold|return_home...`)
using its own token. When it's done it ends the job:

```
DELETE /api/v1/drones/{name}/job   {"id": "<job id>", "result": "completed"|"failed", "reason": "...", "links": {...}}
```

Anything else it serves (reports, photos, settings) is reachable by operators through the fleet API at
`/api/v1/plugins/<id>/<path>`; the plugin sees who's asking in `X-DroneOS-Operator`. Keep the service on
localhost: the fleet API is the only door.

Useful from the fleet API:
- `GET /api/v1/drones/{name}?raw=1`: state (position, altitude, battery, mode, capabilities...).
- WebSocket `/api/v1/events?token=...[&drone=]`: every command, job start/end and PX4 "finished" event as it happens.
- `GET /api/v1/drones/{name}/job`: the drone's current job.
- `GET /api/v1/geofence`: the property fence (inclusion/exclusion polygons in lat/lon, height limit) and which drones
  it applies to. Goto/orbit/patrol/takeoff outside it are refused with 422 and a reason; plan inside it.
- **What the drone sees** (its object detector): on the events socket, `"command": "detected"` arrives once per
  object and spot, when the fleet API has seen it in 3+ frames at the same place (one-frame false positives never
  get there). The event's `sighting` has `id`, `label` (person, car, truck, ...), `score`, `north`/`east` (m from
  home), `lat`/`lon`, `box` (in the frame that confirmed it) and `first_seen`/`last_seen`. The same object seen
  again later (track lost and found, drone turned away and back) within 8 m and 10 min is not a new event.
  `GET /api/v1/drones/{name}/sightings[?since=<unix time>]` lists them, for anything a dropped socket missed.
  **plugins/search** uses both. For where something is *right now* (following it), read `detections` in
  `GET /api/v1/drones/{name}` (objects with `ground` and `confirmed`, ~2 Hz): **plugins/follow** does.

### 3. UI (optional)

One plain ES module, no build step. React and helpers come from `window.DroneOS`:

```js
const { React, h } = window.DroneOS;          // h = React.createElement
function Planner({ ctx }) { ... }             // shown in the Job tab when the drone is free
function Live({ ctx }) { ... }                // while the drone is doing your job
function Report({ ctx, job }) { ... }         // Reports tab: one finished job of yours, opened from the jobs list
function overlay(ctx) { return [...] }        // shapes on the map while the drone is on your job (plain function)
function status(ctx) { return 'point 2/4' }   // short status (plain function)
export default { Planner, Live, Report, overlay, status };
```

`ctx` has: `drone`, `d` (live state), `job` (current job or null), `home`, `busy`,
`run(label, fn)` (runs a call with a toast + log refresh), `api(method, path, body)` (fleet API),
`mission` (the drone's onboard mission progress), `map.pick(prompt)` (operator clicks a point → `{north, east}`),
`map.draw(shapes, handlers)` (what the open screen shows on the map), `returnHome()`.

Shapes (position as `north`/`east` meters from the drone's home, or `lat`/`lon`):
`{type: 'circle', radius}`, `{type: 'line', points: [[n, e], ...], closed?, dashed?}`, `{type: 'marker', clickable?}`,
`{type: 'photo', n}` (a clickable photo spot), `{type: 'route', points, editable?, kind?: 'draft'|'active'}` (numbered points;
editable ones can be dragged and right-click removes a point). Each takes optional `id`, `color`, `label`.

Handlers: `onShape(shape, ev)` with `ev.kind` `'click'` or `'edit'` (`ev.points` = the edited route), and
`onClick({north, east})` + `clickHint` to listen for map clicks (e.g. "click to add points").
Also export `status(ctx)` for the short text in the job header and tab badge.

All three plugins are written this way: plugins/patrol/ui/job.js (editable route, live report, photo viewer),
dispatch/ui/job.js (incident pins), plugins/inspect/ui/job.js (the smallest).
Start your job from the Planner with
`ctx.api('POST', '/drones/' + ctx.drone + '/job', {plugin: '<id>', args: {...}})`.

### 4. Run it

- **Installed plugins** get their own operator token from the install (printed once; the fleet API only
  keeps its hash). Put it in the plugin's config. `--rotate-token` issues a new one; removing the plugin
  (`droneos plugins remove <id>`) revokes it. Removal is refused while one of its jobs runs.
- **Bundled plugins** use a token from the fleet API tokens file (`fleet_api_tokens.json`), like any operator.
- Run the service however you like: a container next to the others (`docker/vps/docker-compose.vps.yml`,
  see `inspect_plugin`) or a plain process. The fleet API calls `service_url` from its own network.
- Open Command Centers pick the plugin up within 10 s (its UI too); a new version reloads the UI.

From the CLI/SDK any job can be started the same way: `POST /api/v1/drones/{name}/job {"plugin": "<id>", "args": {...}}`.

## Rules that keep it safe

- Fly only through the fleet API. No ROS from the cloud side.
- Climb to 50 m before moving sideways in the sim (trees reach ~40 m, no obstacle sensors).
- Assume your service can die mid-job: if the drone must not depend on you, put that part onboard
  (patrol does: its PATROL mode finishes and returns home on its own).
- Hold pauses a job; land, return home, kill or a takeover end it. Don't fight it.
