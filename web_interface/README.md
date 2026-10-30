# DroneOS Command Center (web interface)

The operator's web UI: see every drone on the map, fly them, and run jobs (patrol, dispatch, inspect, any plugin). The browser talks **only to the fleet API**; it never touches ROS.

```
Browser ──HTTP + WebSocket──> frontend server (:3000) ──proxy /api/v1──> Fleet API (:8090) ──rosbridge──> drone_core
                                                                                   └── /api/v1/plugins/<id> → plugin services
                                         └── /camera → camera proxy (:8080) → web_video_server on the drone side
```

Only :3000 listens on the network; everything behind it binds to 127.0.0.1. Set `SIM_HOST` in `docker/vps/.env` (see `.env.example`). `dist/` is built on container start and isn't in git.

## Pieces
- `frontend/`: React + TypeScript, built with webpack into `dist/` and served by `server.js` (Express), which also proxies the APIs.
  - `src/api/fleet.ts`: login, HTTP commands, and one shared telemetry WebSocket (`/api/v1/telemetry`)
  - `src/command/`: the Command Center (fleet list, map, camera, menu with Fly/Status/Job/Reports/Dev, activity log)
  - `src/command/apps/`: jobs. Every job's UI ships with its plugin (`external.ts` loads them, re-checked every 10 s). See `docs/plugins.md`.
  - `src/command/PluginAdmin.tsx`, `OperatorAdmin.tsx`: the Dev tab's plugin and operator management (admins).
  - `src/components/LoginGate.tsx`: operator login (fleet API key; skipped when the server auto-logs in on a private network) and the name/role badge
- No AI chat in the page: your AI agent talks to you on your own channel and flies through the same fleet API (`droneos` CLI).

Operator keys and the API itself are documented in `fleet_api/README.md`.

## Develop
```bash
cd web_interface/frontend
npm install
npx webpack --mode production     # builds dist/bundle.js
node server.js                    # serves :3000 and proxies the APIs
```
On the VPS everything runs from `docker/vps/docker-compose.vps.yml` (`frontend` service): `docker restart frontend_node` rebuilds the bundle on start (~40 s).

## Layout (one page, `/`)
Fleet list top-left, big view centre (map, follows the selected drone), small view top-right (camera; swap, full screen), menu bottom-right (Fly / Status / Job / Reports / Dev, plus Hold, Return home, Kill always visible), activity log bottom-left.
