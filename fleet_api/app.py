"""DroneOS fleet API: the one door into the drones.

The web UI, the CLI, SDK scripts and the AI all use this. It is the only
thing in the command center that talks to drone_core.

Run:  uvicorn app:app --host 127.0.0.1 --port 8090
Env:  ROSBRIDGE_HOST / ROSBRIDGE_PORT   where drone_core's rosbridge is
      FLEET_API_TOKENS                  JSON file {"<token>": "<operator name>"}
      FLEET_API_LOG                     JSONL command log path
      FLEET_API_JOBS                    jobs state (active + history) JSON
      FLEET_API_PLUGINS                 dir of bundled plugins (<id>/droneos-plugin.json), re-read live
      FLEET_API_INSTALLED_PLUGINS       plugins installed through the API (manifests + token hashes)
      FLEET_API_ADMINS                  operators from the tokens file who are admins (comma list); the rest are pilots
      FLEET_API_OPERATORS               operator accounts added through the API (role + token hash)
      FLEET_API_GEOFENCE                the property geofence (polygons in lat/lon; private: mode 600)
"""

import asyncio
import calendar
import hashlib
import json
import logging
import os
import threading
import time
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import Body, Depends, FastAPI, Header, HTTPException, Query, Request, Response, WebSocket, WebSocketDisconnect
from fastapi.concurrency import run_in_threadpool

import accounts as accountsmod
import fleet as fleetmod
import geofence as geomod
import jobs as jobsmod

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(name)s %(levelname)s %(message)s")
log = logging.getLogger("fleet_api")

CONTROL_TIMEOUT = 15 * 60  # an idle hold expires after 15 minutes without commands
JOB_ORPHAN_S = 120          # a job whose drone has been landed this long, unended, is ended as failed
PLUGIN_LOST_S = 15          # a job whose plugin hasn't answered for this long is ended and the drone sent home
WATCH_EVERY_S = 5


# ---------------------------------------------------------------------------
# Operators (auth)
# ---------------------------------------------------------------------------

def load_tokens(path):
    p = Path(path).expanduser()
    tokens = json.loads(p.read_text())
    if not isinstance(tokens, dict) or not tokens:
        raise RuntimeError(f"{p}: expected a non-empty JSON object of token -> operator name")
    return tokens


# ---------------------------------------------------------------------------
# Control: one pilot per drone
# ---------------------------------------------------------------------------

class Control:
    """Who flies which drone. Saved to `path` (if given) so an API restart keeps the holds."""

    def __init__(self, path=None):
        self._lock = threading.Lock()
        self._holders = {}  # drone -> {"operator", "since", "last"}
        self.path = Path(path).expanduser() if path else None
        if self.path and self.path.exists():
            try:
                self._holders = json.loads(self.path.read_text())
            except (OSError, ValueError) as e:
                log.warning("ignoring unreadable control state %s: %s", self.path, e)

    def _save(self):
        """Call with the lock held."""
        if not self.path:
            return
        self.path.parent.mkdir(parents=True, exist_ok=True)
        tmp = self.path.with_suffix(".tmp")
        tmp.write_text(json.dumps(self._holders))
        tmp.replace(self.path)

    def holder(self, drone):
        with self._lock:
            h = self._holders.get(drone)
            if h and time.time() - h["last"] > CONTROL_TIMEOUT:
                del self._holders[drone]
                self._save()
                h = None
            return h["operator"] if h else None

    def claim(self, drone, operator, force=False):
        """Returns the previous holder (if taken over). Raises PermissionError if held by someone else."""
        current = self.holder(drone)
        with self._lock:
            if current and current != operator and not force:
                raise PermissionError(current)
            now = time.time()
            prev = self._holders.get(drone)
            since = prev["since"] if prev and current == operator else now
            self._holders[drone] = {"operator": operator, "since": since, "last": now}
            self._save()
            return current if current != operator else None

    def release(self, drone, operator, force=False):
        current = self.holder(drone)
        with self._lock:
            if current is None:
                return
            if current != operator and not force:
                raise PermissionError(current)
            self._holders.pop(drone, None)
            self._save()


# ---------------------------------------------------------------------------
# Command log
# ---------------------------------------------------------------------------

class EventHub:
    """Fan-out of events (every command-log entry: commands, job start/end, PX4 mode_completed)
    to WebSocket subscribers, so plugins react instead of polling. Thread-safe publish."""

    def __init__(self):
        self._lock = threading.Lock()
        self._subs = set()   # (loop, asyncio.Queue)

    def subscribe(self, loop):
        q = asyncio.Queue(maxsize=500)
        with self._lock:
            self._subs.add((loop, q))
        return q

    def unsubscribe(self, loop, q):
        with self._lock:
            self._subs.discard((loop, q))

    def publish(self, event):
        with self._lock:
            subs = list(self._subs)
        for loop, q in subs:
            def put(q=q):
                if not q.full():   # a slow subscriber misses events rather than blocking everyone
                    q.put_nowait(event)
            try:
                loop.call_soon_threadsafe(put)
            except RuntimeError:
                pass


class CommandLog:
    def __init__(self, path, hub=None):
        self.path = Path(path).expanduser()
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self._lock = threading.Lock()
        self.hub = hub

    def write(self, **entry):
        entry = {"time": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), **entry}
        with self._lock, self.path.open("a") as f:
            f.write(json.dumps(entry) + "\n")
        log.info("%s", entry)
        if self.hub:
            self.hub.publish(entry)
        return entry

    def tail(self, limit=100, drone=None):
        if not self.path.exists():
            return []
        with self._lock:
            lines = self.path.read_text().splitlines()
        entries = [json.loads(l) for l in lines if l.strip()]
        if drone:
            entries = [e for e in entries if e.get("drone") == drone]
        return entries[-limit:][::-1]


# ---------------------------------------------------------------------------
# App
# ---------------------------------------------------------------------------

def create_app(fleet=None, tokens=None, log_path=None, control_path=None, jobs_path=None, plugins=None, plugin_call=None,
               installed_plugins_path=None, admins=None, operators_path=None, geofence_path=None):
    """Build the API. Tests inject a fake fleet; production uses rosbridge."""
    own_fleet = fleet is None
    if fleet is None:
        fleet = fleetmod.RosFleet(os.environ.get("ROSBRIDGE_HOST", "localhost"),
                                  int(os.environ.get("ROSBRIDGE_PORT", "9090")))
    if tokens is None:
        tokens = load_tokens(os.environ.get("FLEET_API_TOKENS", "~/.config/droneos/fleet_api_tokens.json"))
    hub = EventHub()
    commands_log = CommandLog(log_path or os.environ.get("FLEET_API_LOG", "~/.local/state/droneos/fleet_api_log.jsonl"), hub)
    control = Control(control_path or os.environ.get("FLEET_API_CONTROL", "~/.local/state/droneos/fleet_api_control.json"))
    jobs = jobsmod.JobStore(jobs_path or os.environ.get("FLEET_API_JOBS", "~/.local/state/droneos/fleet_api_jobs.json"))
    if plugins is None:
        plugins = jobsmod.PluginRegistry(
            os.environ.get("FLEET_API_PLUGINS", ""),
            installed_plugins_path or os.environ.get("FLEET_API_INSTALLED_PLUGINS", "~/.local/state/droneos/fleet_api_plugins.json"))
    elif isinstance(plugins, dict):
        plugins = jobsmod.PluginRegistry(static=plugins, state_path=installed_plugins_path)
    if admins is None:
        admins = os.environ.get("FLEET_API_ADMINS", "admin")
    if isinstance(admins, str):
        admins = {a.strip() for a in admins.split(",") if a.strip()}
    plugin_call = plugin_call or jobsmod.call_plugin
    log.info("plugins: %s; admins: %s", sorted(plugins), sorted(admins))

    accounts = accountsmod.Accounts(operators_path or os.environ.get("FLEET_API_OPERATORS", "~/.local/state/droneos/fleet_api_operators.json"))

    def who(token):
        """Operator name for a token: from the tokens file, or an installed plugin's own token."""
        return tokens.get(token) or accounts.lookup(token) or plugins.operator_for_token(token)

    def role_of(name):
        """admin / pilot / viewer. File operators: admin if in FLEET_API_ADMINS, else pilot (plugins fly)."""
        if name in admins:
            return "admin"
        return accounts.role(name) or "pilot"

    def taken_names():
        """Operator names in use: people, services and plugins."""
        return set(tokens.values()) | accounts.names() | {m["operator"] for m in plugins.values()}

    stop_watch = threading.Event()

    fence = geomod.Geofence(geofence_path or os.environ.get("FLEET_API_GEOFENCE", "~/.local/state/droneos/fleet_api_geofence.json"))

    def fence_home(name):
        snap = fleet.snapshot(name)
        return geomod.home_of(snap[0]) if snap else None

    def fence_message(name):
        """What the drone's fence loader gets on /<drone>/geofence: the fence if it's this drone's
        site, else null (PX4 keeps only its cylinder). hash = what /<drone>/geofence_status echoes."""
        f = fence.get()
        applies = bool(f) and fence.applies(fence_home(name))
        body = {k: f[k] for k in ("inclusion", "exclusions", "max_altitude_m")} if applies else None
        h = hashlib.sha256(json.dumps(body, sort_keys=True).encode()).hexdigest()[:12]
        return {"fence": body, "hash": h}

    def push_fences():
        pub = getattr(fleet, "publish_geofence", None)
        if not pub:
            return
        for n in fleet.names():
            msg = fence_message(n)
            st = (getattr(fleet, "geofence_status", lambda n: None)(n) or {})
            if st.get("hash") != msg["hash"]:
                pub(n, msg)

    def watch_jobs():
        """A job whose drone sits landed and disarmed for JOB_ORPHAN_S, with nobody ending it
        (plugin down, or it forgot), is ended as failed so the drone isn't stuck.
        Also keeps each drone's onboard fence in step with the fleet API's."""
        landed_since, lost_since = {}, {}
        while not stop_watch.wait(WATCH_EVERY_S):
            try:
                push_fences()
            except Exception:
                log.exception("geofence push failed")
            for check, state in ((check_orphans, landed_since), (check_plugins, lost_since)):
                try:
                    check(state, time.time())
                except Exception:
                    log.exception("job watchdog failed")

    def check_orphans(landed_since, now):
        for drone, j in jobs.all_active().items():
            snap = fleet.snapshot(drone)
            started = calendar.timegm(time.strptime(j["started"], "%Y-%m-%dT%H:%M:%SZ"))
            if snap is None or snap[0].get("arming_state") == "ARMED" or now - started < JOB_ORPHAN_S:
                landed_since.pop(j["id"], None)
                continue
            t0 = landed_since.setdefault(j["id"], now)
            if now - t0 >= JOB_ORPHAN_S:
                landed_since.pop(j["id"], None)
                m = plugins.get(j["plugin"])
                jobs.end(drone, "failed", f"drone landed and the {j['plugin']} plugin never ended the job")
                if m and control.holder(drone) == m["operator"]:
                    control.release(drone, m["operator"], force=True)
                commands_log.write(operator="fleet-api", drone=drone, command="job_end", args={"plugin": j["plugin"]},
                                   ok=False, message=f"{j['plugin']} job failed: drone landed, plugin never ended it")

    starting = set()   # job ids whose plugin hasn't answered POST /jobs yet (takeoff can take a while)
    told_onboard = set()

    def plugin_alive(m, j):
        """(True, "") if the plugin answers GET /jobs/{id} with 2xx, else (False, why)."""
        if m is None:
            return False, "the plugin is gone"
        try:
            status, _, _ = plugin_call(m, "GET", f"/jobs/{j['id']}", timeout=3)
        except jobsmod.PluginError:
            return False, "its service doesn't answer"
        if status == 404:
            return False, "it doesn't know the job any more (restarted?)"
        if status >= 500:
            return False, f"its service fails (HTTP {status})"
        return True, ""

    def onboard_flying(m, drone):
        """True if the plugin's onboard part is flying the drone right now (it doesn't need the cloud part)."""
        mode = (m or {}).get("onboard_mode")
        if not mode:
            return False
        snap = fleet.snapshot(drone)
        cur = str(snap[0].get("nav_state")) if snap else ""
        # drone_core names an external mode by its name ("PATROL"); right after a drone_core restart,
        # until the mode's status arrives (200 ms), it reports "EXTERNALn".
        if cur.upper() == mode.upper():
            return True
        caps = getattr(fleet, "capabilities", lambda n: None)(drone) or {}
        nav = next((x.get("nav_state") for x in caps.get("modes", []) if x.get("name") == mode), None)
        if nav is not None and cur in {str(nav), f"EXTERNAL{int(nav) - 22}"}:
            return True
        # drone_core's own mission state. Not "paused": that's PX4 Hold, and nothing onboard ends it,
        # so with the cloud part gone the drone would hover until the battery failsafe.
        try:
            ms = fleet.mission_status(drone) or {}
            return bool(ms.get("mission_running"))
        except Exception:
            return False

    def check_plugins(lost_since, now):
        """Every running job's plugin must keep answering. One that stops for PLUGIN_LOST_S loses its
        job and the drone goes home, unless the plugin's onboard part is flying it (it finishes on its own)."""
        active = jobs.all_active()
        for jid in list(lost_since):
            if jid not in {j["id"] for j in active.values()}:
                lost_since.pop(jid)
        for drone, j in active.items():
            if j["id"] in starting:
                continue
            m = plugins.get(j["plugin"])
            ok, why = plugin_alive(m, j)
            if ok:
                if lost_since.pop(j["id"], None) is not None:
                    log.info("%s plugin answers again (job %s)", j["plugin"], j["id"])
                told_onboard.discard(j["id"])
                continue
            t0 = lost_since.setdefault(j["id"], (now, why))[0]
            if now - t0 < PLUGIN_LOST_S:
                continue
            if onboard_flying(m, drone):
                if j["id"] not in told_onboard:
                    told_onboard.add(j["id"])
                    commands_log.write(operator="fleet-api", drone=drone, command="plugin_lost", args={"plugin": j["plugin"]}, ok=False,
                                       message=f"{j['plugin']} plugin not answering ({why}); its onboard part keeps flying the job")
                continue
            lost_since.pop(j["id"], None)
            snap = fleet.snapshot(drone)
            armed = bool(snap and snap[0].get("arming_state") == "ARMED")
            reason = f"{j['plugin']} plugin stopped answering ({why})" + ("; drone sent home" if armed else "")
            if jobs.end(drone, "failed", reason, job_id=j["id"]) is None:
                continue
            if m and control.holder(drone) == m["operator"]:
                control.release(drone, m["operator"], force=True)
            commands_log.write(operator="fleet-api", drone=drone, command="job_end", args={"plugin": j["plugin"]}, ok=False,
                               message=f"{j['plugin']} job failed: {reason}")
            if armed:
                try:
                    msg = fleetmod.COMMANDS["return_home"](fleet, drone, {})
                    commands_log.write(operator="fleet-api", drone=drone, command="return_home", args={}, ok=True,
                                       message=f"{msg} (its {j['plugin']} job's plugin stopped answering)")
                except fleetmod.CommandError as e:
                    commands_log.write(operator="fleet-api", drone=drone, command="return_home", args={}, ok=False, message=str(e))
            if m:
                try:   # if it's alive but lost the job, it should know
                    plugin_call(m, "POST", f"/jobs/{j['id']}/stopped", {"reason": reason}, timeout=3)
                except jobsmod.PluginError:
                    pass

    app_check_orphans = check_orphans

    @asynccontextmanager
    async def lifespan(app):
        if own_fleet:
            fleet.start()
        threading.Thread(target=watch_jobs, name="job-watchdog", daemon=True).start()
        yield
        stop_watch.set()
        if own_fleet:
            fleet.stop()

    app = FastAPI(title="DroneOS Fleet API", version="1.0", lifespan=lifespan)
    app.state.fleet, app.state.control, app.state.log = fleet, control, commands_log
    app.state.check_orphans = app_check_orphans
    app.state.check_plugins = check_plugins

    MODE_WORDS = {"AUTO_TAKEOFF": "takeoff", "AUTO_LAND": "landing", "AUTO_RTL": "return home", "AUTO_MISSION": "mission"}

    def on_mode_completed(name, msg):
        """PX4 says a mode finished on its own: goes in the activity log (plugins read it from there)."""
        mode, result = msg.get("mode") or "?", msg.get("result") or "?"
        ok = result == "SUCCESS"
        text = f"PX4: {MODE_WORDS.get(mode, mode)} " + ("finished" if ok else f"failed ({result})")
        commands_log.write(operator="px4", drone=name, command="mode_completed", args={"mode": mode}, ok=ok, message=text)

    app.state.on_mode_completed = on_mode_completed
    fleet.on_mode_completed = on_mode_completed

    def on_sighting(name, s):
        """The drone's object detector confirmed something at a new spot: an event for plugins (WS
        /api/v1/events, command "detected"). Not in the command log: it isn't a command, and a
        search finds many."""
        hub.publish({"time": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), "operator": "detector",
                     "drone": name, "command": "detected", "ok": True,
                     "message": f"{s['label']} at N{s['north']:g} E{s['east']:g} ({round(100 * s['score'])}%)",
                     "sighting": s})

    app.state.on_sighting = on_sighting
    if hasattr(fleet, "on_sighting"):
        fleet.on_sighting = on_sighting

    def operator(authorization: str = Header(default="")):
        token = authorization.removeprefix("Bearer ").strip()
        name = who(token) if token else None
        if not token or name is None:
            raise HTTPException(401, "missing or invalid token")
        return name

    def drone_view(name):
        snap = fleet.snapshot(name)
        if snap is None:
            raise HTTPException(404, f"unknown drone {name}")
        state, online, home_z = snap
        view = fleetmod.summarize(name, state, online, home_z, control.holder(name))
        caps = getattr(fleet, "capabilities", None)
        view["capabilities"] = caps(name) if caps else None
        dets = getattr(fleet, "detections", None)
        # object detector, if one runs for this drone; objects get a ground position when the camera geometry is known
        view["detections"] = fleetmod.place_detections(dets(name), view) if dets else None
        view["job"] = (jobs.active(name) or {}).get("plugin")
        return view, state

    def all_drones(raw=False):
        out = []
        for n in fleet.names():
            view, state = drone_view(n)
            if raw:
                view["raw"] = state
            out.append(view)
        return out

    # -- reads -------------------------------------------------------------

    @app.get("/api/v1/health")
    def health():
        return {"ok": True, "connected": fleet.connected, "drones": len(fleet.names())}

    @app.get("/api/v1/config")
    def config(op: str = Depends(operator)):
        # Mirrors the PX4 geofence params set on the drones (GF_MAX_HOR_DIST / GF_MAX_VER_DIST);
        # the API can't read PX4 params over ROS 2 on 1.15, so they're configured here too.
        return {"geofence": {"radius_m": float(os.environ.get("FLEET_GEOFENCE_RADIUS_M", "300")),
                             "max_altitude_m": float(os.environ.get("FLEET_GEOFENCE_MAX_ALT_M", "120"))},
                "max_speed_mps": 10.0}

    def pilot(op: str = Depends(operator)):
        """Anyone who may fly: admins and pilots (viewers only watch)."""
        if role_of(op) not in ("admin", "pilot"):
            raise HTTPException(403, f"{op} is a viewer: read-only")
        return op

    def admin(op: str = Depends(operator)):
        if role_of(op) != "admin":
            raise HTTPException(403, f"{op} is not an admin")
        return op

    @app.get("/api/v1/geofence")
    def get_geofence(op: str = Depends(operator)):
        """The property fence (or null) and, per drone: does it apply (home inside), is it loaded onboard."""
        f = fence.get()
        drones = {}
        for n in fleet.names():
            msg = fence_message(n)
            st = getattr(fleet, "geofence_status", lambda n: None)(n)
            drones[n] = {"applies": msg["fence"] is not None,
                         "onboard": None if st is None else (st.get("hash") == msg["hash"] and not st.get("error")),
                         "onboard_error": (st or {}).get("error")}
        return {"fence": f, "drones": drones}

    @app.put("/api/v1/geofence")
    def put_geofence(body: dict = Body(...), op: str = Depends(admin)):
        try:
            f = fence.set(body, op)
        except geomod.FenceError as e:
            raise HTTPException(422, str(e))
        applies = [n for n in fleet.names() if fence.applies(fence_home(n))]
        commands_log.write(operator=op, drone=None, command="geofence_set", args={"points": len(f["inclusion"]),
                           "exclusions": len(f["exclusions"]), "max_altitude_m": f["max_altitude_m"]}, ok=True,
                           message=f"geofence set: {len(f['inclusion'])} corners, {len(f['exclusions'])} no-fly areas, "
                                   f"{f['max_altitude_m']:g} m; applies to {', '.join(applies) or 'no drone yet'}")
        try:
            push_fences()
        except Exception:
            log.exception("geofence push failed")
        return get_geofence(op)

    @app.delete("/api/v1/geofence")
    def delete_geofence(op: str = Depends(admin)):
        fence.clear()
        commands_log.write(operator=op, drone=None, command="geofence_clear", args={}, ok=True,
                           message="geofence removed: drones keep only PX4's cylinder")
        try:
            push_fences()
        except Exception:
            log.exception("geofence push failed")
        return get_geofence(op)

    @app.get("/api/v1/me")
    def me(op: str = Depends(operator)):
        return {"operator": op, "role": role_of(op)}

    # -- operators -----------------------------------------------------------

    @app.get("/api/v1/operators")
    def list_operators(op: str = Depends(admin)):
        """Everyone with access: accounts (managed here) plus the tokens file and plugins (read-only here)."""
        out = [{**a, "source": "account"} for a in accounts.list()]
        out += [{"name": n, "role": role_of(n), "source": "file"} for n in sorted(set(tokens.values()))]
        out += [{"name": m["operator"], "role": "pilot", "source": "plugin", "plugin": m["id"]}
                for m in plugins.values() if plugins.source(m["id"]) == "installed"]
        return out

    @app.post("/api/v1/operators")
    def add_operator(name: str = Body(...), role: str = Body("pilot"), op: str = Depends(admin)):
        """New operator account. Its token is in this reply only; hand it to the person."""
        try:
            token = accounts.create(name, role, op, taken=taken_names())
        except ValueError as e:
            raise HTTPException(422, str(e))
        commands_log.write(operator=op, drone="", command="operator_add", args={"name": name, "role": role}, ok=True,
                           message=f"added operator {name} ({role})")
        return {"name": name, "role": role, "token": token}

    @app.patch("/api/v1/operators/{name}")
    def change_operator(name: str, role: str = Body(..., embed=True), op: str = Depends(admin)):
        if name == op and role != "admin":
            raise HTTPException(409, "you can't take admin away from yourself")
        try:
            accounts.set_role(name, role)
        except KeyError:
            raise HTTPException(404, f"no account {name} (file operators change in the tokens file)")
        except ValueError as e:
            raise HTTPException(422, str(e))
        if role == "viewer":
            release_all(name, op)
        commands_log.write(operator=op, drone="", command="operator_role", args={"name": name, "role": role}, ok=True,
                           message=f"{name} is now {role}")
        return {"name": name, "role": role}

    @app.post("/api/v1/operators/{name}/token")
    def new_operator_token(name: str, op: str = Depends(admin)):
        """New token for an account (lost or leaked); the old one stops working now."""
        try:
            token = accounts.new_token(name)
        except KeyError:
            raise HTTPException(404, f"no account {name}")
        commands_log.write(operator=op, drone="", command="operator_token", args={"name": name}, ok=True,
                           message=f"new token for {name}; the old one no longer works")
        return {"name": name, "token": token}

    @app.delete("/api/v1/operators/{name}")
    def remove_operator(name: str, op: str = Depends(admin)):
        if name == op:
            raise HTTPException(409, "you can't remove yourself")
        try:
            accounts.remove(name)
        except KeyError:
            raise HTTPException(404, f"no account {name} (file operators are removed from the tokens file)")
        release_all(name, op)
        commands_log.write(operator=op, drone="", command="operator_remove", args={"name": name}, ok=True,
                           message=f"removed operator {name}; their token no longer works")
        return {"removed": name}

    def release_all(name, by):
        """Drop every drone control hold `name` has (removed, or made a viewer)."""
        for d in fleet.names():
            if control.holder(d) == name:
                control.release(d, name, force=True)
                commands_log.write(operator=by, drone=d, command="release_control", args={"of": name}, ok=True,
                                   message=f"released {name}'s control")

    @app.get("/api/v1/drones")
    def list_drones(op: str = Depends(operator)):
        return all_drones()

    @app.get("/api/v1/drones/{name}")
    def get_drone(name: str, raw: bool = False, op: str = Depends(operator)):
        view, state = drone_view(name)
        if raw:
            view["raw"] = state
            view["home_z"] = fleet.snapshot(name)[2]
        return view

    @app.get("/api/v1/drones/{name}/sightings")
    def get_sightings(name: str, since: float = 0.0, op: str = Depends(operator)):
        """What the drone's object detector confirmed, one entry per object and spot (last 10 min):
        id, label, score, north/east (m from home), lat/lon, box (in the frame that confirmed it),
        first_seen/last_seen (unix time), frames. since: only those seen since that unix time."""
        drone_view(name)
        fn = getattr(fleet, "sightings", None)
        return fn(name, since) if fn else []

    @app.get("/api/v1/drones/{name}/patrol")
    async def patrol_status(name: str, raw: bool = False, op: str = Depends(operator)):
        """The onboard mission (patrol) state, straight from drone_core."""
        drone_view(name)
        try:
            s = await run_in_threadpool(fleet.mission_status, name)
        except fleetmod.CommandError as e:
            raise HTTPException(422, str(e))
        if raw:
            return s
        return {"drone": name, "loaded": s.get("mission_valid", False), "running": s.get("mission_running", False),
                "finished": s.get("mission_finished", False), "item": s.get("current_item", 0),
                "items": s.get("total_items", 0), "progress": round(s.get("mission_progress", 0.0), 3),
                "failed": s.get("mission_failed", False), "failure_reason": s.get("failure_reason", ""),
                "paused": s.get("mission_paused", False)}

    @app.get("/api/v1/log")
    def get_log(limit: int = Query(100, ge=1, le=1000), drone: str | None = None, op: str = Depends(operator)):
        return commands_log.tail(limit, drone)

    # -- control -----------------------------------------------------------

    @app.post("/api/v1/drones/{name}/control")
    def take_control(name: str, force: bool = Body(False, embed=True), op: str = Depends(pilot)):
        drone_view(name)
        try:
            previous = control.claim(name, op, force)
        except PermissionError as e:
            raise HTTPException(409, f"{name} is controlled by {e}; use force to take over")
        if previous:
            stop_job(name, op, f"{op} took control")
        commands_log.write(operator=op, drone=name, command="take_control", ok=True,
                           message=f"took over from {previous}" if previous else "")
        return {"drone": name, "controller": op}

    @app.delete("/api/v1/drones/{name}/control")
    def release_control(name: str, force: bool = False, op: str = Depends(pilot)):
        try:
            control.release(name, op, force)
        except PermissionError as e:
            raise HTTPException(409, f"{name} is controlled by {e}")
        commands_log.write(operator=op, drone=name, command="release_control", ok=True)
        return {"drone": name, "controller": None}

    # -- plugins and jobs --------------------------------------------------
    # One job per drone. A job is started here, run by its plugin (which flies as its own
    # operator and holds control), and ended by the plugin with a result, or by the fleet API
    # when someone else lands it, sends it home, kills it or takes control.

    JOB_ENDING = {"land", "return_home", "kill"}   # hold pauses a job, it doesn't end it

    def plugin_of(pid):
        m = plugins.get(pid)
        if m is None:
            raise HTTPException(404, f"no plugin {pid}; installed: {sorted(plugins)}")
        return m

    def stop_job(drone, op, reason):
        """Someone other than the job's plugin stepped in: end the job as stopped, tell the plugin."""
        j = jobs.active(drone)
        if not j:
            return
        m = plugins.get(j["plugin"])
        if m and op == m["operator"]:
            return
        jobs.end(drone, "stopped", reason)
        if m and control.holder(drone) == m["operator"]:
            control.release(drone, m["operator"], force=True)   # the drone is free again
        commands_log.write(operator=op, drone=drone, command="job_end", args={"plugin": j["plugin"]}, ok=True,
                           message=f"{j['plugin']} job stopped: {reason}")
        if m:
            try:
                plugin_call(m, "POST", f"/jobs/{j['id']}/stopped", {"reason": reason})
            except jobsmod.PluginError as e:
                log.warning("telling %s its job stopped failed: %s", j["plugin"], e)

    def plugin_info(m):
        return {**{k: m.get(k) for k in ("id", "name", "version", "description", "onboard_mode", "ui", "operator")},
                "source": plugins.source(m["id"])}

    @app.get("/api/v1/plugins")
    def list_plugins(op: str = Depends(operator)):
        return [plugin_info(m) for m in plugins.values()]

    @app.post("/api/v1/plugins")
    def install_plugin(manifest: dict = Body(...), rotate_token: bool = False, op: str = Depends(admin)):
        """Install (or update) a plugin while everything runs. A new plugin gets its own operator
        token: it's in this reply only (only a hash is kept). Give it to the plugin's service."""
        try:
            m, token, created = plugins.install(manifest, op, taken_operators=set(tokens.values()) | accounts.names(), rotate_token=rotate_token)
        except ValueError as e:
            raise HTTPException(422, str(e))
        try:   # is the service there? Any HTTP answer counts; a plugin may also start after this.
            status, _, _ = plugin_call(m, "GET", m["ui"] if m.get("ui", "").startswith("/") else "/", caller=False, timeout=3)
            reachable = True
        except jobsmod.PluginError:
            reachable = False
        commands_log.write(operator=op, drone="", command="plugin_install", args={"plugin": m["id"], "version": m.get("version")},
                           ok=True, message=f"{'installed' if created else 'updated'} plugin {m['name']} ({m['id']})"
                           + ("" if reachable else "; its service isn't answering yet"))
        return {"plugin": plugin_info(m), "created": created, "reachable": reachable, "token": token}

    @app.delete("/api/v1/plugins/{pid}")
    def remove_plugin(pid: str, op: str = Depends(admin)):
        """Remove an installed plugin. Refused while one of its jobs runs (end it first)."""
        busy = [d for d, j in jobs.all_active().items() if j["plugin"] == pid]
        if busy:
            raise HTTPException(409, f"{pid} has a job running on {', '.join(busy)}; end it first")
        try:
            m = plugins.remove(pid)
        except KeyError:
            raise HTTPException(404, f"no installed plugin {pid}")
        except ValueError as e:
            raise HTTPException(409, str(e))
        commands_log.write(operator=op, drone="", command="plugin_remove", args={"plugin": pid}, ok=True,
                           message=f"removed plugin {m['name']} ({pid})")
        return {"removed": pid}

    @app.get("/api/v1/jobs")
    def job_history(drone: str | None = None, plugin: str | None = None, limit: int = Query(50, ge=1, le=500), op: str = Depends(operator)):
        return jobs.history(drone, plugin, limit)

    @app.get("/api/v1/jobs/active")
    def active_jobs(op: str = Depends(operator)):
        return jobs.all_active()

    @app.get("/api/v1/drones/{name}/job")
    def get_job(name: str, op: str = Depends(operator)):
        drone_view(name)
        return jobs.active(name)

    @app.post("/api/v1/drones/{name}/job")
    def start_job(name: str, plugin: str = Body(...), args: dict = Body(default={}), op: str = Depends(pilot)):
        """Start a job: the plugin takes the drone's control and flies it."""
        drone_view(name)
        m = plugin_of(plugin)
        holder = control.holder(name)
        if holder not in (None, op, m["operator"]):
            raise HTTPException(409, f"{name} is controlled by {holder}; take control first")
        try:
            job = jobs.begin(name, plugin, op, args)
        except ValueError as e:
            raise HTTPException(409, str(e))
        control.claim(name, m["operator"], force=True)
        starting.add(job["id"])
        try:
            status, _, body = plugin_call(m, "POST", "/jobs", {"job": job, "args": args}, timeout=180)
        except jobsmod.PluginError as e:
            status, body = e.status, json.dumps({"detail": str(e)}).encode()
        finally:
            starting.discard(job["id"])
        try:
            res = json.loads(body or b"{}")
        except ValueError:
            res = {"detail": body[:200].decode(errors="replace")}
        if status >= 300:
            jobs.end(name, "failed", str(res.get("detail", status)))
            control.release(name, m["operator"], force=True)
            commands_log.write(operator=op, drone=name, command="job_start", args={"plugin": plugin, **args}, ok=False,
                               message=str(res.get("detail", status)))
            raise HTTPException(status if status in (409, 422, 503) else 502, str(res.get("detail", status)))
        job = jobs.update(name, text=res.get("text", ""), links=res.get("links")) or job
        commands_log.write(operator=op, drone=name, command="job_start", args={"plugin": plugin, **args}, ok=True,
                           message=f"{m['name']} job started" + (f": {res['text']}" if res.get("text") else ""))
        return job

    @app.patch("/api/v1/drones/{name}/job")
    def update_job(name: str, body: dict = Body(...), op: str = Depends(pilot)):
        j = jobs.active(name)
        if not j:
            raise HTTPException(404, f"{name} has no job")
        if op != plugin_of(j["plugin"])["operator"]:
            raise HTTPException(403, "only the job's plugin updates it")
        return jobs.update(name, text=body.get("text", j.get("text", "")), links=body.get("links"))

    @app.delete("/api/v1/drones/{name}/job")
    def end_job(name: str, body: dict = Body(default={}), op: str = Depends(pilot)):
        """The plugin ends its job with a result; anyone else ending it means 'stopped'."""
        j = jobs.active(name)
        if not j or (body.get("id") and body["id"] != j["id"]):
            raise HTTPException(404, f"{name} has no such job")
        m = plugins.get(j["plugin"])
        if m and op == m["operator"]:
            ended = jobs.end(name, body.get("result") or "completed", body.get("reason", ""), body.get("links"))
            if control.holder(name) == m["operator"]:
                control.release(name, m["operator"])
            commands_log.write(operator=op, drone=name, command="job_end", args={"plugin": j["plugin"]}, ok=ended["result"] == "completed",
                               message=f"{j['plugin']} job {ended['result']}" + (f": {ended['reason']}" if ended["reason"] else ""))
            return ended
        stop_job(name, op, body.get("reason") or f"stopped by {op}")
        return jobs.history(name, limit=1)[0]

    @app.api_route("/api/v1/plugins/{pid}/{path:path}", methods=["GET", "POST", "PUT", "PATCH", "DELETE"])
    async def plugin_proxy(pid: str, path: str, request: Request, op: str = Depends(operator)):
        """Operators reach a plugin's own endpoints through here; the plugin sees who they are."""
        m = plugin_of(pid)
        if path.split("/")[0] == "jobs":
            raise HTTPException(403, "jobs are started and ended through /api/v1/drones/{name}/job")
        if request.method != "GET" and role_of(op) not in ("admin", "pilot"):
            raise HTTPException(403, f"{op} is a viewer: read-only")
        body = await request.body()
        q = ("?" + request.url.query) if request.url.query else ""
        try:
            status, ctype, data = await run_in_threadpool(
                plugin_call, m, request.method, "/" + path + q, None, op, False, body or None,
                request.headers.get("content-type", "application/json"))
        except jobsmod.PluginError as e:
            raise HTTPException(e.status, str(e))
        return Response(content=data, status_code=status, media_type=ctype or None)

    # -- commands ----------------------------------------------------------

    @app.post("/api/v1/drones/{name}/{command}")
    async def run_command(name: str, command: str, args: dict = Body(default={}), op: str = Depends(pilot)):
        fn = fleetmod.COMMANDS.get(command)
        if fn is None:
            raise HTTPException(404, f"unknown command {command}; valid: {sorted(fleetmod.COMMANDS)}")
        drone_view(name)
        if command in ("takeoff", "goto", "orbit", "patrol"):
            snap = fleet.snapshot(name)
            try:
                st = snap[0]
                here = (float(st.get("local_x") or 0.0), float(st.get("local_y") or 0.0))
                pts, legs, alt = geomod.command_shape(command, args, here)
                fence.check(geomod.home_of(st), pts, legs, alt)
            except geomod.FenceError as e:
                commands_log.write(operator=op, drone=name, command=command, args=args, ok=False, message=f"refused: {e}")
                raise HTTPException(422, f"refused: {e}")
            except (KeyError, TypeError, ValueError):
                pass   # malformed args: the command itself says what's wrong
        holder = control.holder(name)
        if command in fleetmod.SAFETY_COMMANDS:
            if holder in (None, op):
                control.claim(name, op)
        else:
            try:
                control.claim(name, op)
            except PermissionError:
                commands_log.write(operator=op, drone=name, command=command, args=args, ok=False,
                                   message=f"refused: controlled by {holder}")
                raise HTTPException(409, f"{name} is controlled by {holder}; take control first")
        try:
            message = await run_in_threadpool(fn, fleet, name, args)
        except fleetmod.CommandError as e:
            commands_log.write(operator=op, drone=name, command=command, args=args, ok=False, message=str(e))
            raise HTTPException(422, str(e))
        commands_log.write(operator=op, drone=name, command=command, args=args, ok=True, message=message)
        if command in JOB_ENDING:
            stop_job(name, op, f"{op}: {command.replace('_', ' ')}")
        return {"drone": name, "command": command, "ok": True, "message": message}

    # -- events --------------------------------------------------------------

    @app.websocket("/api/v1/events")
    async def events(ws: WebSocket, token: str = Query(""), drone: str | None = None):
        """Every command-log entry as it happens: {"time", "operator", "drone", "command", "ok", "message", ...}.
        Job start/end are commands "job_start"/"job_end"; PX4 events are operator "px4"."""
        if not token or who(token) is None:
            await ws.close(code=4401)
            return
        await ws.accept()
        loop = asyncio.get_running_loop()
        q = hub.subscribe(loop)
        try:
            while True:
                e = await q.get()
                if drone is None or e.get("drone") == drone:
                    await ws.send_json(e)
        except (WebSocketDisconnect, RuntimeError):
            pass
        finally:
            hub.unsubscribe(loop, q)

    # -- live telemetry ----------------------------------------------------

    @app.websocket("/api/v1/telemetry")
    async def telemetry(ws: WebSocket, token: str = Query(""), hz: float = Query(5.0, gt=0, le=10), raw: bool = False):
        if not token or who(token) is None:
            await ws.close(code=4401)
            return
        await ws.accept()
        try:
            while True:
                await ws.send_json({"type": "fleet", "time": time.time(), "connected": fleet.connected,
                                    "drones": all_drones(raw)})
                await asyncio.sleep(1.0 / hz)
        except (WebSocketDisconnect, RuntimeError):
            pass

    return app


if os.environ.get("FLEET_API_NO_AUTOSTART") != "1":
    app = create_app()
