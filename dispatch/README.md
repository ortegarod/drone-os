# Dispatch Service

A minimal 911 CAD (Computer-Aided Dispatch) system.

Generates simulated emergency incidents and exposes them via:
- **REST API** on `:8081` — for consumers (AI agent, other services)
- **rosbridge** — publishes to `/dispatch/incidents` for the frontend

**Service starts PAUSED by default.** Click RESUME in the frontend or call `/api/dispatch/resume` to begin incident generation.

## This service does NOT know about drones or AI.

It just manages incidents. Consumers decide what to do with them.

## API

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/incidents` | All incidents |
| GET | `/api/incidents/active` | Non-resolved incidents |
| PATCH | `/api/incidents/{id}` | Update status: `{"status": "dispatched", "assigned_to": "drone1"}` |
| GET | `/api/dispatch/status` | Service status (paused, running, incident counts) |
| POST | `/api/dispatch/pause` | Pause incident generation |
| POST | `/api/dispatch/resume` | Resume incident generation |

## Incident Statuses

`new` → `dispatched` → `on_scene` → `resolved`

## Quick Start

```bash
pip install -r requirements.txt
python dispatch_service.py
```

## rosbridge Topic

`/dispatch/incidents` — JSON string array of all incidents, published on every state change.
