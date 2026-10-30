# Dispatch (demo plugin)

A small simulated 911 dispatch, kept as a demo of DroneOS jobs. It is the **Dispatch plugin**
(manifest `plugins/dispatch`): send a drone to an incident, it climbs to 50 m, flies there, and goes
home when the incident is resolved. Its UI (incident pins, Resolve) ships in `ui/job.js`.

- `dispatch_service.py` (:8081, localhost): makes up incidents and runs Dispatch jobs. Flies only
  through the fleet API, as operator `dispatch`.
- `bridge.py` (:8082, localhost): hands each new incident to an AI dispatcher (the operator's
  OpenClaw agent, `DISPATCH_AGENT`, one session per incident) with `dispatch-prompt.md`. The agent
  sends a drone with `droneos dispatch <drone> <incident>`.

Operators reach the service through the fleet API: `/api/v1/plugins/dispatch/<path>`.

## Incidents

Starts **paused, manual**: nothing happens until you ask.

| Method | Path (on the service) | |
|---|---|---|
| GET | `/api/incidents`, `/api/incidents/active` | all / not resolved |
| POST | `/api/dispatch/trigger` | make one incident now |
| POST | `/api/dispatch/mode` `{"mode": "auto"}` | auto: a new incident every so often (with `resume`) |
| POST | `/api/dispatch/pause`, `/api/dispatch/resume` | stop / start auto incidents |
| POST | `/api/dispatch/resolve/{id}` | resolve: the drone goes home, the job completes |
| POST | `/api/dispatch/clear` | drop all incidents |
| GET | `/api/dispatch/status` | paused, mode, counts |

Statuses: `new` → `dispatched` → `on_scene` → `resolved`.

Example: `curl -X POST -H "Authorization: Bearer <token>" http://127.0.0.1:8090/api/v1/plugins/dispatch/api/dispatch/trigger`

Bridge control (localhost): `GET /api/bridge/status`, `POST /api/bridge/pause|resume`.

## Run

On the VPS: the `dispatch` and `bridge` services in `docker/vps/docker-compose.vps.yml`.
