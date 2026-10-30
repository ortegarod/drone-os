"""Fleet backend: the single connection to the drones.

Talks to drone_core over rosbridge. Discovers drones by their /<name>/drone_state
topic, keeps the latest state of each, and runs commands. Nothing else in the
command center should talk ROS; everything goes through this module.
"""

import json
import logging
import math
import threading
import time

import roslibpy

log = logging.getLogger("fleet")

STALE_AFTER = 3.0        # seconds without a state message before a drone counts as offline
DISCOVERY_INTERVAL = 5.0  # seconds between topic scans
SERVICE_TIMEOUT = 10.0


class CommandError(RuntimeError):
    """drone_core refused or failed a command."""


class RosFleet:
    """Live fleet over rosbridge."""

    def __init__(self, host, port):
        self.host, self.port = host, port
        self._ros = None
        self._lock = threading.Lock()
        self._states = {}   # name -> latest DroneState dict
        self._seen = {}     # name -> monotonic time of last message
        self._home_z = {}   # name -> local_z while landed (altitude reference)
        self._topics = {}   # name -> roslibpy.Topic
        self.target_alt = {}  # name -> last commanded altitude (m above home)
        self._event_topics = {}  # name -> /<name>/mode_completed subscription
        self.on_mode_completed = None  # callback(name, msg), set by the app
        self._last_completed = {}  # name -> ((mode, result), monotonic time) of the last mode_completed
        self._cap_topics = {}    # name -> /<name>/capabilities subscription (drone_core 1e42acf+)
        self._caps = {}          # name -> {"modes": [...], "drone_core_build": ...}
        self._det_topics = {}    # name -> /<name>/detections subscription (object detector)
        self._dets = {}          # name -> latest detections dict + "received"
        self._trackers = {}      # name -> DetectionTracker ("seen in N frames at the same spot")
        self._sightings = {}     # name -> Sightings (confirmed objects, one per spot)
        self._fence_pubs = {}    # name -> /<name>/geofence publisher (latched JSON for the drone's fence loader)
        self._fence_status = {}  # name -> latest /<name>/geofence_status {"hash", "error", ...}
        self.on_sighting = None  # callback(name, sighting dict) for each new sighting, set by the app
        self._stop = threading.Event()
        self._thread = None

    # -- lifecycle ---------------------------------------------------------

    def start(self):
        self._thread = threading.Thread(target=self._discovery_loop, name="fleet-discovery", daemon=True)
        self._thread.start()

    def stop(self):
        self._stop.set()
        if self._ros is not None:
            try:
                self._ros.close()
            except Exception:
                pass

    @property
    def connected(self):
        return self._ros is not None and self._ros.is_connected

    def _ensure_connected(self):
        if self.connected:
            return True
        try:
            if self._ros is not None:
                try:
                    self._ros.close()
                except Exception:
                    pass
            log.info("connecting to rosbridge %s:%s", self.host, self.port)
            ros = roslibpy.Ros(host=self.host, port=self.port)
            ros.run(timeout=10)
            self._ros = ros
            with self._lock:
                self._topics.clear()  # subscriptions died with the old connection
                self._event_topics.clear()
                self._cap_topics.clear()
                self._det_topics.clear()
            log.info("connected")
            return True
        except Exception as e:
            log.warning("rosbridge connect failed: %s", e)
            return False

    def _reconnect(self, why):
        """Drop the rosbridge link so the next _ensure_connected builds a new one.

        After a rosbridge restart roslibpy can come back half-alive: topic messages still arrive
        but service calls (including rosapi) never get a response. Seen 2026-10-28.
        """
        log.warning("reconnecting to rosbridge: %s", why)
        ros, self._ros = self._ros, None
        if ros is not None:
            try:
                ros.close()
            except Exception:
                pass

    def _discovery_loop(self):
        failures = 0
        while not self._stop.is_set():
            if self._ensure_connected():
                try:
                    topics = self._ros.get_topics()
                    names = sorted({t.split("/")[1] for t in topics
                                    if t.endswith("/drone_state") and t.count("/") == 2})
                    for name in names:
                        if name not in self._topics:
                            self._subscribe(name)
                        if name not in self._event_topics and f"/{name}/mode_completed" in topics:
                            self._subscribe_events(name)
                        if name not in self._cap_topics and f"/{name}/capabilities" in topics:
                            self._subscribe_caps(name)
                        if name not in self._det_topics and f"/{name}/detections" in topics:
                            self._subscribe_detections(name)
                    failures = 0
                except Exception as e:
                    failures += 1
                    log.warning("discovery failed (%d in a row): %s", failures, e)
                    if failures >= 3:
                        failures = 0
                        self._reconnect("rosapi calls keep failing")
            self._stop.wait(DISCOVERY_INTERVAL)

    def _subscribe(self, name):
        # 4 Hz per drone. The cloud-to-sim link carries only ~50 KB/s; at 10 Hz the (now larger) DroneState of
        # 3 drones filled it and service replies queued behind it for seconds (measured with ss -tni).
        topic = roslibpy.Topic(self._ros, f"/{name}/drone_state", "drone_interfaces/msg/DroneState",
                               throttle_rate=250, queue_length=1)
        topic.subscribe(lambda msg, n=name: self._on_state(n, msg))
        with self._lock:
            self._topics[name] = topic
        log.info("tracking %s", name)

    def _subscribe_events(self, name):
        # PX4 publishes mode_completed when Takeoff, Land, RTL or Mission finish on their own; not on
        # a user mode switch or a failsafe (px4_msgs ModeCompleted.msg, v1.15.4).
        topic = roslibpy.Topic(self._ros, f"/{name}/mode_completed", "drone_interfaces/msg/ModeCompleted", queue_length=10)
        topic.subscribe(lambda msg, n=name: self._on_mode_completed(n, msg))
        with self._lock:
            self._event_topics[name] = topic
        log.info("tracking %s mode_completed", name)

    def _subscribe_caps(self, name):
        # Which onboard modes (job plugins) the drone has: retained JSON, ~230 bytes every 5 s.
        topic = roslibpy.Topic(self._ros, f"/{name}/capabilities", "std_msgs/String", queue_length=1)
        topic.subscribe(lambda msg, n=name: self._on_caps(n, msg))
        with self._lock:
            self._cap_topics[name] = topic
        log.info("tracking %s capabilities", name)

    def _subscribe_detections(self, name):
        # Object detector output: std_msgs/String JSON {"stamp", "model", "fps", "objects": [...]}, ~1 KB,
        # published at <=5 Hz on the drone side; 2 Hz is plenty here and keeps the link budget (~50 KB/s).
        topic = roslibpy.Topic(self._ros, f"/{name}/detections", "std_msgs/String", throttle_rate=500, queue_length=1)
        topic.subscribe(lambda msg, n=name: self._on_detections(n, msg))
        with self._lock:
            self._det_topics[name] = topic
        log.info("tracking %s detections", name)

    def _on_detections(self, name, msg):
        try:
            d = json.loads(msg.get("data") or "{}")
        except ValueError:
            return
        if not isinstance(d, dict):
            return
        objs = []
        for o in (d.get("objects") or [])[:20]:
            try:
                box = [min(1.0, max(0.0, float(v))) for v in o.get("box", [])][:4]
                if len(box) == 4:
                    objs.append({"label": str(o.get("label", "?"))[:40], "score": round(float(o.get("score", 0)), 3), "box": box})
            except (TypeError, ValueError, AttributeError):
                continue
        cam = d.get("camera") if isinstance(d.get("camera"), dict) else None
        pose = d.get("pose") if isinstance(d.get("pose"), dict) else None
        now = time.time()
        with self._lock:
            state, home_z = self._states.get(name), self._home_z.get(name)
            tracker = self._trackers.setdefault(name, DetectionTracker())
        # Ground spot of each object, with the drone's position at the time the message arrived:
        # N/E/heading from the detector's time-matched pose when it sends one, altitude always ours.
        if cam:
            s = state or {}
            z = s.get("local_z")
            alt = home_z - z if _r(home_z, 2) is not None and _r(z, 2) is not None else None
            p = pose or {}
            gpose = {"north": p.get("north", s.get("local_x")), "east": p.get("east", s.get("local_y")),
                     "alt": alt, "heading_deg": p.get("heading_deg", s.get("compass_heading")),
                     # tilt: the detector's time-matched one if it sends it, else our latest telemetry
                     "roll_deg": p.get("roll_deg", s.get("roll_deg")), "pitch_deg": p.get("pitch_deg", s.get("pitch_deg"))}
            for o in objs:
                g = ground_point(o["box"], cam, gpose)
                o["ground"] = {"north": g[0], "east": g[1]} if g else None
            origin = (gpose["north"], gpose["east"])
        else:
            origin = (None, None)
        new = tracker.update(objs, now, origin)
        with self._lock:
            sightings = self._sightings.setdefault(name, Sightings(name))
        s = state or {}
        fresh = sightings.update(tracker, new, now, s.get("latitude"), s.get("longitude"),
                                 s.get("local_x"), s.get("local_y"), objs)
        for sighting in fresh:
            if self.on_sighting:
                try:
                    self.on_sighting(name, sighting)
                except Exception:
                    log.exception("sighting handler failed")
        with self._lock:
            self._dets[name] = {"objects": objs, "tracks": tracker.tracks(now), "model": d.get("model"),
                                "fps": d.get("fps"), "stamp": d.get("stamp"), "camera": cam, "pose": pose,
                                "received": now}

    def publish_geofence(self, name, msg):
        """The fence for the drone's onboard loader (drone side: MAVLink FENCE upload to PX4).
        {"fence": {"inclusion", "exclusions", "max_altitude_m"} | null, "hash"}; it answers on
        /<name>/geofence_status with the hash it loaded (or an error)."""
        if not self.connected:
            return
        with self._lock:
            pub = self._fence_pubs.get(name)
        if pub is None:
            pub = roslibpy.Topic(self._ros, f"/{name}/geofence", "std_msgs/String", latch=True)
            pub.advertise()
            st = roslibpy.Topic(self._ros, f"/{name}/geofence_status", "std_msgs/String", queue_length=1)
            st.subscribe(lambda m, n=name: self._on_fence_status(n, m))
            with self._lock:
                self._fence_pubs[name] = pub
        pub.publish(roslibpy.Message({"data": json.dumps(msg)}))

    def _on_fence_status(self, name, msg):
        try:
            s = json.loads(msg.get("data") or "{}")
        except ValueError:
            return
        if isinstance(s, dict):
            with self._lock:
                self._fence_status[name] = s

    def geofence_status(self, name):
        with self._lock:
            return self._fence_status.get(name)

    def sightings(self, name, since=0.0):
        """Sightings for the drone (newest last), optionally only those seen since a unix time."""
        with self._lock:
            s = self._sightings.get(name)
        return s.list(since) if s else []

    def detections(self, name, max_age=3.0):
        """Latest detections for the drone if fresher than max_age seconds, else None."""
        with self._lock:
            d = self._dets.get(name)
        if not d or time.time() - d["received"] > max_age:
            return None
        return {**d, "age": round(time.time() - d["received"], 2)}

    def _on_caps(self, name, msg):
        try:
            c = json.loads(msg.get("data") or "{}")
        except ValueError:
            return
        with self._lock:
            self._caps[name] = {"modes": c.get("modes") or [], "drone_core_build": c.get("drone_core_build"),
                                "received": time.time()}

    def capabilities(self, name):
        """{"modes": [{"name", "nav_state", "registered", "heartbeat_fresh", "version"}], ...} or None."""
        with self._lock:
            c = self._caps.get(name)
            return dict(c) if c else None

    def _on_mode_completed(self, name, msg):
        # drone_core can repeat the same completion for a couple of seconds (AUTO_LAND: ~40 copies
        # in 2 s after touchdown, 2026-10-29); one is the event, the rest would flood the log.
        key, now = (msg.get("mode"), msg.get("result")), time.monotonic()
        with self._lock:
            last = self._last_completed.get(name)
            self._last_completed[name] = (key, now)
        if last and last[0] == key and now - last[1] < MODE_COMPLETED_REPEAT_S:
            return
        log.info("%s mode_completed %s", name, msg)
        if self.on_mode_completed:
            try:
                self.on_mode_completed(name, msg)
            except Exception:
                log.exception("mode_completed handler failed")

    def _on_state(self, name, msg):
        with self._lock:
            self._states[name] = msg
            self._seen[name] = time.monotonic()
            # Altitude reference: wherever the drone sits while disarmed (i.e. on the ground).
            # drone_core reports landing_state as UNKNOWN, so arming state is the reliable signal.
            if msg.get("arming_state") != "ARMED":
                self._home_z[name] = msg.get("local_z", 0.0)

    # -- reads -------------------------------------------------------------

    def names(self):
        with self._lock:
            return sorted(self._states)

    def snapshot(self, name):
        """(raw_state, online, home_z) or None if never seen."""
        with self._lock:
            if name not in self._states:
                return None
            online = time.monotonic() - self._seen[name] < STALE_AFTER
            return dict(self._states[name]), online, self._home_z.get(name, 0.0)

    # -- commands ----------------------------------------------------------

    def _call(self, name, service, service_type, args=None):
        if not self.connected:
            raise CommandError("not connected to the drones")
        svc = roslibpy.Service(self._ros, f"/{name}/{service}", service_type)
        try:
            result = dict(svc.call(roslibpy.ServiceRequest(args or {}), timeout=SERVICE_TIMEOUT))
        except Exception as e:
            raise CommandError(f"{service}: {e}") from e
        if result.get("success") is False:
            raise CommandError(f"{service}: {result.get('message') or 'failed'}")
        return result.get("message", "")

    def call(self, name, service, service_type, args=None):
        """Like _call, but returns the whole response."""
        if not self.connected:
            raise CommandError("not connected to the drones")
        svc = roslibpy.Service(self._ros, f"/{name}/{service}", service_type)
        try:
            result = dict(svc.call(roslibpy.ServiceRequest(args or {}), timeout=SERVICE_TIMEOUT))
        except Exception as e:
            raise CommandError(f"{service}: {e}") from e
        if result.get("success") is False:
            raise CommandError(f"{service}: {result.get('message') or 'failed'}")
        return result

    def trigger(self, name, service):
        return self._call(name, service, "std_srvs/srv/Trigger")

    def set_position(self, name, x, y, z, yaw):
        return self._call(name, "set_position", "drone_interfaces/srv/SetPosition",
                          {"x": float(x), "y": float(y), "z": float(z), "yaw": float(yaw)})

    def upload_mission(self, name, items, cruise_speed=None):
        req = {"waypoints": items}
        if cruise_speed is not None:  # older drone_core builds don't have the field
            req["cruise_speed"] = cruise_speed
        return self._call(name, "upload_mission", "drone_interfaces/srv/UploadMission", req)

    def mission_control(self, name, command):
        return self._call(name, "mission_control", "drone_interfaces/srv/MissionControl",
                          {"command": command, "item_index": 0})

    def mission_status(self, name):
        if not self.connected:
            raise CommandError("not connected to the drones")
        svc = roslibpy.Service(self._ros, f"/{name}/get_mission_status", "drone_interfaces/srv/GetMissionStatus")
        try:
            return dict(svc.call(roslibpy.ServiceRequest({}), timeout=SERVICE_TIMEOUT))
        except Exception as e:
            raise CommandError(f"get_mission_status: {e}") from e


# ---------------------------------------------------------------------------
# Operator-level commands, written once against any backend with trigger/set_position/snapshot
# ---------------------------------------------------------------------------

def _need(fleet, name):
    snap = fleet.snapshot(name)
    if snap is None:
        raise CommandError(f"unknown drone {name}")
    state, online, home_z = snap
    if not online:
        raise CommandError(f"{name} is offline")
    return state, home_z


def cmd_arm(fleet, name, args):
    _need(fleet, name)
    return fleet.trigger(name, "arm")


def cmd_disarm(fleet, name, args):
    _need(fleet, name)
    return fleet.trigger(name, "disarm")


def cmd_land(fleet, name, args):
    _need(fleet, name)
    fleet.target_alt.pop(name, None)
    return fleet.trigger(name, "land")


def cmd_return_home(fleet, name, args):
    _need(fleet, name)
    fleet.target_alt.pop(name, None)
    return fleet.trigger(name, "return_to_launch")


def cmd_kill(fleet, name, args):
    _need(fleet, name)
    fleet.target_alt.pop(name, None)
    return fleet.trigger(name, "flight_termination")


def _alt_arg(args, default=None):
    if args.get("altitude") is None:
        return default
    altitude = float(args["altitude"])
    if not 2.0 <= altitude <= 120.0:
        raise CommandError("altitude must be between 2 and 120 m")
    return altitude


def cmd_takeoff(fleet, name, args):
    """Take off in place to `altitude` m above home (PX4 Takeoff mode; drone_core arms)."""
    altitude = _alt_arg(args, 10.0)
    _need(fleet, name)
    fleet.call(name, "takeoff_to", "drone_interfaces/srv/Takeoff", {"altitude": altitude})
    fleet.target_alt[name] = altitude
    return f"taking off to {altitude:g} m"


def cmd_goto(fleet, name, args):
    """Fly to `north`/`east` m from home (PX4 reposition; holds there).
    Optional: `altitude` m above home (default: keep), `speed` m/s (1-10), `heading` degrees."""
    try:
        north, east = float(args["north"]), float(args["east"])
    except (KeyError, TypeError, ValueError):
        raise CommandError("goto needs numeric north and east")
    state, _ = _need(fleet, name)
    if state.get("arming_state") != "ARMED":
        raise CommandError(f"{name} is not flying; take off first")
    altitude = _alt_arg(args, fleet.target_alt.get(name))
    speed = float(args.get("speed") or 0.0)
    if speed and not 1.0 <= speed <= 10.0:
        raise CommandError("speed must be 1-10 m/s")
    heading = float(args["heading"]) % 360 if args.get("heading") is not None else -1.0
    r = fleet.call(name, "goto_location", "drone_interfaces/srv/GotoLocation",
                   {"frame": 1, "latitude": 0.0, "longitude": 0.0, "north": north, "east": east,
                    "altitude": altitude or 0.0, "speed": speed, "heading_deg": heading})
    if altitude:
        fleet.target_alt[name] = altitude
    dist = r.get("distance_m")
    return f"going to N{north:g} E{east:g}" + (f" at {altitude:g} m" if altitude else "") + \
        (f", {dist:.0f} m away" if isinstance(dist, (int, float)) else "")


def cmd_hold(fleet, name, args):
    """Stop and hover in place (PX4 Hold). Also ends a go-to, orbit or patrol."""
    _need(fleet, name)
    return fleet.trigger(name, "hold") or "holding position"


def cmd_orbit(fleet, name, args):
    """Circle `north`/`east` (m from home) at `radius` m and `speed` m/s, nose to the centre.
    Optional: `altitude`, `clockwise` (default true), `face_center` (default true). Stop with hold/home/land."""
    try:
        north, east = float(args["north"]), float(args["east"])
        radius = float(args.get("radius", 20.0))
        speed = float(args.get("speed", 3.0))
    except (KeyError, TypeError, ValueError):
        raise CommandError("orbit needs numeric north, east, radius and speed")
    if not 2.0 <= radius <= 300.0:
        raise CommandError("radius must be 2-300 m")
    if not 0.5 <= speed <= 10.0:
        raise CommandError("speed must be 0.5-10 m/s")
    state, _ = _need(fleet, name)
    if state.get("arming_state") != "ARMED":
        raise CommandError(f"{name} is not flying; take off first")
    altitude = _alt_arg(args, fleet.target_alt.get(name))
    r = fleet.call(name, "orbit", "drone_interfaces/srv/Orbit",
                   {"frame": 1, "latitude": 0.0, "longitude": 0.0, "north": north, "east": east,
                    "radius": radius, "speed": speed, "clockwise": bool(args.get("clockwise", True)),
                    "altitude": altitude or 0.0, "face_center": bool(args.get("face_center", True))})
    used = r.get("speed_used")
    note = f" (PX4 limits this radius to {used:.1f} m/s)" if isinstance(used, (int, float)) and used < speed - 0.05 else ""
    return f"orbiting N{north:g} E{east:g}, radius {radius:g} m{note}"


def _wait_for(fleet, name, done, timeout, what):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        snap = fleet.snapshot(name)
        if snap and snap[1] and done(snap[0], snap[2]):
            return
        time.sleep(0.5)
    raise CommandError(f"{name}: timed out waiting to {what}")


def cmd_patrol(fleet, name, args):
    """Fly `route` ([[north, east], ...]) `loops` times at `altitude`, then return home and land.

    Runs ONBOARD in drone_core: once started it finishes even if this API, the VPS or the
    link goes away. Takes off first if needed. Abort with land or return_home.
    """
    route = args.get("route")
    try:
        route = [(float(n), float(e)) for n, e in route]
    except (TypeError, ValueError):
        raise CommandError("route must be a list of [north, east] points")
    if not 1 <= len(route) <= 100:
        raise CommandError("route needs 1 to 100 points")
    try:
        altitude = float(args.get("altitude", 15.0))
        loops = int(args.get("loops", 1))
        hold = float(args.get("hold", 0.0))
        radius = float(args.get("radius", 2.0))
        speed = float(args["speed"]) if args.get("speed") is not None else None
    except (TypeError, ValueError):
        raise CommandError("altitude, loops, hold, radius and speed must be numbers")
    # PX4 caps Goto at MPC_XY_CRUISE (10 on our drones), which is also the RTL speed.
    if speed is not None and not 1.0 <= speed <= 10.0:
        raise CommandError("speed must be 1-10 m/s")
    if not 2.0 <= altitude <= 120.0:
        raise CommandError("altitude must be between 2 and 120 m")
    if not 1 <= loops <= 50 or len(route) * loops > 500:
        raise CommandError("loops must be 1-50 (and at most 500 waypoints total)")
    if not 0 <= hold <= 300 or not 0.5 <= radius <= 20:
        raise CommandError("hold must be 0-300 s and radius 0.5-20 m")
    state, home_z = _need(fleet, name)
    # drone_core refuses a new mission while one is running or paused (one job per drone).
    # Running: refuse here too. Paused: it's a leftover (whoever paused it no longer has a job), so stop it.
    try:
        ms = fleet.mission_status(name)
    except CommandError:
        ms = {}
    if ms.get("mission_running") and not ms.get("mission_paused"):
        raise CommandError(f"a patrol is already running on {name}; hold, land or return home first")
    if ms.get("mission_paused"):
        fleet.mission_control(name, "STOP")
    if state.get("arming_state") != "ARMED":
        cmd_takeoff(fleet, name, {"altitude": altitude})
        _wait_for(fleet, name, lambda s, hz: s.get("arming_state") == "ARMED" and abs((hz - s["local_z"]) - altitude) <= 1.0,
                  60, f"reach {altitude:g} m")
        state, home_z = _need(fleet, name)
    # drone_core picks the flight mode itself on START: its PATROL external mode when that's
    # running, otherwise OFFBOARD. It refuses rather than fly a silent hover.
    z = home_z - altitude
    items = [{"command": 16, "frame": 1, "latitude": n, "longitude": e, "altitude": z, "yaw": 0.0,
              "acceptance_radius": radius, "hold_time": hold, "autocontinue": True}
             for _ in range(loops) for n, e in route]
    items.append({"command": 20, "frame": 1, "latitude": 0.0, "longitude": 0.0, "altitude": 0.0, "yaw": 0.0,
                  "acceptance_radius": 0.0, "hold_time": 0.0, "autocontinue": True})  # return home and land
    fleet.upload_mission(name, items, speed)
    fleet.mission_control(name, "START")
    fleet.target_alt[name] = altitude
    pace = f" at {speed:g} m/s" if speed is not None else ""
    return f"patrol started: {len(route)} points x {loops} at {altitude:g} m{pace}, then home"


def cmd_patrol_pause(fleet, name, args):
    """Hold where the drone is; the patrol keeps its place and RESUME continues it."""
    fleet.mission_control(name, "PAUSE")
    return "patrol paused: holding here"


def cmd_patrol_resume(fleet, name, args):
    fleet.mission_control(name, "RESUME")
    return "patrol resumed"


COMMANDS = {
    "arm": cmd_arm,
    "disarm": cmd_disarm,
    "takeoff": cmd_takeoff,
    "goto": cmd_goto,
    "hold": cmd_hold,
    "orbit": cmd_orbit,
    "land": cmd_land,
    "return_home": cmd_return_home,
    "kill": cmd_kill,
    "patrol": cmd_patrol,
    "patrol_pause": cmd_patrol_pause,
    "patrol_resume": cmd_patrol_resume,
}

# Anyone logged in may send these, even if another operator holds the drone.
SAFETY_COMMANDS = {"land", "return_home", "kill", "hold", "patrol_pause"}


def _r(v, n):
    """Round a number; None for missing or non-numeric values (rosbridge sends NaN as null)."""
    return round(v, n) if isinstance(v, (int, float)) and v == v else None



def ground_point(box, cam, pose):
    """Where a detection stands: the bottom-centre of its box projected onto flat ground.

    box [x1,y1,x2,y2] normalized to the frame; cam {"pitch_deg" (down), "hfov_deg", "width", "height"};
    pose {"north", "east", "alt" (m above home), "heading_deg", optional "roll_deg"/"pitch_deg" (PX4 FRD:
    roll + = right side down, pitch + = nose up)}. Without roll/pitch the drone is taken as level: fine
    hovering, but a moving drone tilts a few degrees and at 45 degrees down from 30 m each degree moves
    the spot ~1 m. Ground at home height. Returns (north, east) or None (ray above the horizon / too far).
    """
    try:
        w, h = float(cam.get("width") or 640), float(cam.get("height") or 480)
        th = math.radians(abs(float(cam["pitch_deg"])))   # degrees down; either sign accepted (no upward cameras)
        tan_h = math.tan(math.radians(float(cam["hfov_deg"])) / 2)
        tan_v = tan_h * h / w
        alt, psi = float(pose["alt"]), math.radians(float(pose["heading_deg"]))
        n0, e0 = float(pose["north"]), float(pose["east"])
    except (KeyError, TypeError, ValueError):
        return None
    if alt < 1:
        return None
    try:
        phi = math.radians(float(pose.get("roll_deg") or 0.0))
        theta = math.radians(float(pose.get("pitch_deg") or 0.0))
    except (TypeError, ValueError):
        phi = theta = 0.0
    u, v = (box[0] + box[2]) / 2, box[3]
    right, down = (u - 0.5) * 2 * tan_h, (v - 0.5) * 2 * tan_v   # ray in the camera frame, forward = 1
    x = math.cos(th) - math.sin(th) * down                       # body frame (FRD), camera pitched down by th
    y = right
    z = math.sin(th) + math.cos(th) * down
    y, z = y * math.cos(phi) - z * math.sin(phi), y * math.sin(phi) + z * math.cos(phi)          # roll
    x, z = x * math.cos(theta) + z * math.sin(theta), -x * math.sin(theta) + z * math.cos(theta)  # pitch
    if z <= 0.02:
        return None
    t = alt / z
    f, r = t * x, t * y
    if math.hypot(f, r) > 400:
        return None
    return (round(n0 + f * math.cos(psi) - r * math.sin(psi), 1), round(e0 + f * math.sin(psi) + r * math.cos(psi), 1))


# Detector false positives (mostly trees as "person") flicker: one frame here, one there. Real
# objects keep showing up at the same ground spot. An object is only "confirmed" once it was
# seen CONFIRM_HITS times within CONFIRM_WINDOW seconds at (about) the same spot; its track lives
# on until it hasn't been seen for TRACK_TTL seconds. Messages arrive at ~2 Hz (our throttle).
CONFIRM_HITS = 3
MODE_COMPLETED_REPEAT_S = 5.0   # same mode_completed again within this: a repeat, ignored
CONFIRM_WINDOW = 4.0
TRACK_TTL = 3.0
_GROUPS = {"car": "vehicle", "truck": "vehicle", "bus": "vehicle", "motorcycle": "vehicle"}


class DetectionTracker:
    """Ties one drone's detections together across frames, by ground spot (or, with no ground
    position, e.g. landed, by box centre in the image). Not thread-safe; one per drone, fed from the
    detections subscription."""

    def __init__(self):
        self._tracks = []
        self._next = 1
        self._new = []

    @staticmethod
    def _gate(t, o, origin):
        """Distance from track t to object o, or None if o can't belong to t."""
        if _GROUPS.get(o["label"], o["label"]) != t["group"]:
            return None
        g = o.get("ground")
        if g and t["space"] == "ground":
            d = math.hypot(g["north"] - t["north"], g["east"] - t["east"])
            # projection error grows with range (flat-ground + level-drone assumptions): 3 m + 10 %
            try:
                rng = math.hypot(g["north"] - float(origin[0]), g["east"] - float(origin[1]))
            except (TypeError, ValueError):
                rng = 0.0
            return d if d <= 3.0 + 0.1 * rng else None
        if not g and t["space"] == "image":
            b = o["box"]
            d = math.hypot((b[0] + b[2]) / 2 - t["u"], (b[1] + b[3]) / 2 - t["v"])
            return d if d <= 0.06 else None
        return None

    def update(self, objs, now, origin=(None, None)):
        """Match this frame's objects to tracks (nearest first, one object per track); sets
        o["track"] and o["confirmed"] on each object. Returns the tracks confirmed by this frame."""
        self._new = []
        self._tracks = [t for t in self._tracks if now - t["last"] <= TRACK_TTL]
        pairs = []
        for i, o in enumerate(objs):
            for j, t in enumerate(self._tracks):
                d = self._gate(t, o, origin)
                if d is not None:
                    pairs.append((d, i, j))
        used_o, used_t = set(), set()
        for d, i, j in sorted(pairs):
            if i in used_o or j in used_t:
                continue
            used_o.add(i); used_t.add(j)
            self._hit(self._tracks[j], objs[i], now)
        for i, o in enumerate(objs):
            if i not in used_o:
                g = o.get("ground")
                b = o["box"]
                t = {"id": self._next, "group": _GROUPS.get(o["label"], o["label"]), "labels": {},
                     "space": "ground" if g else "image", "north": g["north"] if g else None,
                     "east": g["east"] if g else None, "u": (b[0] + b[2]) / 2, "v": (b[1] + b[3]) / 2,
                     "hits": [], "first": now, "last": now, "score": 0.0, "confirmed": False}
                self._next += 1
                self._tracks.append(t)
                self._hit(t, o, now, first=True)
        return self._new

    def track(self, tid):
        return next((t for t in self._tracks if t["id"] == tid), None)

    def _hit(self, t, o, now, first=False):
        g, b = o.get("ground"), o["box"]
        if not first:   # smooth the spot (the projection jitters by a metre or two)
            a = 0.3
            if g and t["space"] == "ground":
                t["north"] += a * (g["north"] - t["north"]); t["east"] += a * (g["east"] - t["east"])
            t["u"] += a * ((b[0] + b[2]) / 2 - t["u"]); t["v"] += a * ((b[1] + b[3]) / 2 - t["v"])
        t["hits"] = [h for h in t["hits"] if now - h <= CONFIRM_WINDOW] + [now]
        t["last"] = now
        t["score"] = max(t["score"], o["score"])
        t["labels"][o["label"]] = t["labels"].get(o["label"], 0) + 1
        t["seen"] = t.get("seen", 0) + 1
        t["box"] = b
        if len(t["hits"]) >= CONFIRM_HITS and not t["confirmed"]:
            t["confirmed"] = True
            self._new.append(t)
        o["track"], o["confirmed"] = t["id"], t["confirmed"]

    def tracks(self, now):
        """Confirmed tracks still alive: what the map shows."""
        out = []
        for t in self._tracks:
            if t["confirmed"] and now - t["last"] <= TRACK_TTL:
                out.append({"id": t["id"], "label": max(t["labels"], key=t["labels"].get),
                            "score": round(t["score"], 3), "seen": t["seen"],
                            "ground": {"north": round(t["north"], 1), "east": round(t["east"], 1)}
                            if t["space"] == "ground" else None,
                            "since": round(now - t["first"], 1), "last_seen": round(now - t["last"], 1)})
        return out


# A sighting is one confirmed object at one spot: what a job wants to hear about ("a person at
# N-33 E-15"). Tracks come and go (the object drops out for a few frames, the drone turns away
# and back); a newly confirmed track within SIGHTING_RADIUS of a sighting of the same kind seen in
# the last SIGHTING_MEMORY seconds is that sighting again, not a new one.
SIGHTING_RADIUS = 8.0
SIGHTING_MEMORY = 600.0
M_PER_DEG = 111320.0


class Sightings:
    """One drone's sightings (not thread-safe; fed from the detections subscription)."""

    def __init__(self, drone):
        self.drone = drone
        self._list = []
        self._by_track = {}   # track id -> sighting
        self._next = 1

    def update(self, tracker, new_tracks, now, lat, lon, x, y, objs):
        """Returns the sightings that are new with this frame."""
        fresh = []
        for t in new_tracks:
            if t["space"] != "ground":
                continue   # no ground spot (drone on the ground, ray above the horizon): not a place
            group = t["group"]
            near = [s for s in self._list if s["group"] == group and now - s["last_seen"] <= SIGHTING_MEMORY
                    and math.hypot(s["north"] - t["north"], s["east"] - t["east"]) <= SIGHTING_RADIUS]
            if near:
                self._by_track[t["id"]] = near[0]
                continue
            label = max(t["labels"], key=t["labels"].get)
            s = {"id": f"{self.drone}-{self._next}", "drone": self.drone, "label": label, "group": group,
                 "score": round(t["score"], 3), "north": round(t["north"], 1), "east": round(t["east"], 1),
                 "lat": None, "lon": None, "box": [round(v, 3) for v in t.get("box", [])],
                 "first_seen": round(now, 2), "last_seen": round(now, 2), "frames": t.get("seen", 0)}
            try:   # the spot in lat/lon, from where the drone is (GPS) and its local position
                lat0, lon0 = float(lat), float(lon)
                dn, de = t["north"] - float(x), t["east"] - float(y)
                s["lat"] = round(lat0 + dn / M_PER_DEG, 7)
                s["lon"] = round(lon0 + de / (M_PER_DEG * math.cos(math.radians(lat0))), 7)
            except (TypeError, ValueError):
                pass
            self._next += 1
            self._list.append(s)
            self._by_track[t["id"]] = s
            fresh.append(dict(s))
        # confirmed objects in this frame keep their sighting fresh
        for o in objs:
            s = self._by_track.get(o.get("track"))
            if s and o.get("confirmed"):
                s["last_seen"] = round(now, 2)
                s["frames"] += 1
                s["score"] = max(s["score"], o["score"])
        self._list = [s for s in self._list if now - s["last_seen"] <= SIGHTING_MEMORY][-200:]
        live = {id(s) for s in self._list}
        self._by_track = {k: v for k, v in self._by_track.items() if id(v) in live and tracker.track(k)}
        return fresh

    def list(self, since=0.0):
        return [dict(s) for s in self._list if s["last_seen"] >= since]


def place_detections(det, view):
    """Add "ground": {"north","east"} to each detected object when the camera geometry is known.
    The pose comes from the detector's message if it sent one, else from the drone's telemetry."""
    if not det or not det.get("camera"):
        return det
    if "tracks" in det:   # already placed (and tracked) when the message arrived
        return det
    p = det.get("pose") or {}
    pos = view.get("position") or {}
    # N/E/heading from the detector's time-matched pose if it sent one; altitude always ours (above
    # home), since the detector's is above the PX4 local origin and carries the baro offset.
    att = view.get("attitude") or {}
    pose = {"north": p.get("north", pos.get("north")), "east": p.get("east", pos.get("east")),
            "alt": pos.get("altitude"), "heading_deg": p.get("heading_deg", pos.get("heading")),
            "roll_deg": p.get("roll_deg", att.get("roll")), "pitch_deg": p.get("pitch_deg", att.get("pitch"))}
    objs = []
    for o in det.get("objects", []):
        g = ground_point(o["box"], det["camera"], pose)
        objs.append({**o, "ground": {"north": g[0], "east": g[1]} if g else None})
    return {**det, "objects": objs}

def summarize(name, state, online, home_z, controller=None):
    """Operator view of a drone: what the map and fleet list need."""
    s = state
    z = s.get("local_z")
    bat = s.get("battery_remaining")
    return {
        "name": name,
        "online": online,
        "armed": s.get("arming_state") == "ARMED",
        "mode": s.get("nav_state"),
        "landed_state": s.get("landing_state"),
        "failsafe": bool(s.get("failsafe", False)),
        "failsafe_reasons": s.get("failsafe_reasons") or [],
        "position": {
            "north": _r(s.get("local_x"), 2),
            "east": _r(s.get("local_y"), 2),
            "altitude": _r(home_z - z, 2) if _r(home_z, 2) is not None and _r(z, 2) is not None else None,
            "heading": _r(s.get("compass_heading"), 1),
            "valid": s.get("position_valid", False),
        },
        "gps": {
            "lat": s.get("latitude"),
            "lon": s.get("longitude"),
            "alt_msl": s.get("altitude"),
            "valid": s.get("global_position_valid", False),
            "fix": s.get("gps_fix_type"),
            "satellites": s.get("gps_satellites_used"),
        },
        "velocity": {"north": s.get("velocity_x"), "east": s.get("velocity_y"), "down": s.get("velocity_z")},
        "battery": {
            "percent": _r(100 * bat, 0) if _r(bat, 3) is not None else None,
            "voltage": s.get("battery_voltage"),
            "warning": s.get("battery_warning"),
            "low_remaining_time": bool(s.get("battery_low_remaining_time", False)),
        },
        "home_valid": s.get("home_position_valid"),
        # Where PX4 itself is flying to (position_setpoint_triplet). None in OFFBOARD (patrol) and in
        # modes without a target.
        "target": ({"lat": s.get("target_lat"), "lon": s.get("target_lon"), "alt_msl": s.get("target_alt"),
                    "type": s.get("target_type"), "loiter_radius": s.get("target_loiter_radius")}
                   if s.get("target_valid") and s.get("target_type") != "IDLE" else None),
        "next": ({"lat": s.get("next_lat"), "lon": s.get("next_lon")} if s.get("next_valid") else None),
        # attitude (vehicle_attitude) and PX4's own trust in its position
        # (estimator_status_flags). None/[] on older builds.
        "attitude": {"roll": _r(s.get("roll_deg"), 1), "pitch": _r(s.get("pitch_deg"), 1)},
        "position_health": {"trusted": s.get("position_trusted"), "warnings": s.get("estimator_warnings") or []},
        "health": {
            "score": s.get("system_health_score"),
            "warnings": s.get("active_warnings", []),
            "failures": s.get("critical_failures", []),
            "can_arm": s.get("can_arm"),
        },
        "controller": controller,
    }
