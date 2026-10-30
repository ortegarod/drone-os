"""Write a DroneOS plugin (a job type) as one Python function. Guide: docs/plugins.md.

    from droneos.plugin import Plugin, arg

    plugin = Plugin("inspect")

    @plugin.job
    def inspect(job, north: float, east: float, radius: float = arg(20, min=5, max=100)):
        job.climb(50)
        job.drone.orbit(north, east, radius)
        for _ in range(6):
            job.photo()
            job.sleep(10)
        job.home()
        return f"{len(job.report['photos'])} photos"

    app = plugin.app          # uvicorn service:app --host 127.0.0.1 --port 8092

The SDK does the rest: the three calls the fleet API makes (POST /jobs, GET /jobs/{id},
POST /jobs/{id}/stopped), checking the arguments against the function's signature (a bad start
is refused with 422 and why), running each job in its own thread, ending it (return = completed,
an exception = failed, and a drone still flying is sent home), the report (report.json + photos)
and the routes operators read it from (/reports, /reports/{id}, /reports/{id}/photos/{n}.jpg),
and serving ui/job.js next to the plugin's file.

When an operator steps in (land, return home, kill, takes control), the job's next job.* call
or command through job.drone raises Stopped. The function unwinds and the job is recorded as
stopped; the fleet API has already ended it. Stopped is not an Exception, so a broad
`except Exception` doesn't swallow it. Catch it only to clean up, never to keep flying.

Configuration (env): <ID>_CONFIG (json {"api", "token"}, default ~/.config/droneos/<id>_plugin.json;
falls back to DRONEOS_API/DRONEOS_TOKEN), <ID>_REPORTS (default ~/.local/state/droneos/<id>),
CAMERA_URL (snapshots, default http://127.0.0.1:8080).
"""

import inspect as _inspect
import json
import logging
import math
import os
import sys
import threading
import time
import typing
import urllib.parse
import urllib.request
from pathlib import Path

from .client import Client, DroneError
from .drone import Drone

__all__ = ["Plugin", "Job", "Stopped", "arg", "DroneError"]
log = logging.getLogger("droneos.plugin")
_REQUIRED = object()


def _now():
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())


class Stopped(BaseException):
    """An operator stepped in; the job is over. Raised by job.* calls and job.drone commands."""


class arg:
    """A job argument's default and limits: `radius: float = arg(20, min=5, max=100)`.
    No default = required. The annotation converts the value (float, int, bool, str, list, or any
    function that takes the raw value and returns it parsed, raising ValueError if it's wrong)."""

    def __init__(self, default=_REQUIRED, min=None, max=None, help=""):
        self.default, self.min, self.max, self.help = default, min, max, help

    def limits(self):
        if self.min is None and self.max is None:
            return ""
        lo = "" if self.min is None else f"{self.min:g}"
        hi = "" if self.max is None else f"{self.max:g}"
        return f"{lo}-{hi}"

    def describe(self, name):
        s = f"{name} {self.limits()}".strip()
        return s + ("" if self.default is _REQUIRED else f" (default {self.default})")


def _convert(kind, v):
    if kind is None or kind is typing.Any:
        return v
    if kind is bool:
        if isinstance(v, bool):
            return v
        if str(v).lower() in ("1", "true", "yes", "on"):
            return True
        if str(v).lower() in ("0", "false", "no", "off"):
            return False
        raise ValueError("must be true or false")
    if kind is float:
        f = float(v)
        if not math.isfinite(f):
            raise ValueError("must be a number")
        return f
    if kind is int:
        f = float(v)
        if f != int(f):
            raise ValueError("must be a whole number")
        return int(f)
    if kind in (list, dict):
        if not isinstance(v, kind):
            raise ValueError(f"must be a {kind.__name__}")
        return v
    return kind(v)


class _Spec:
    """The job function's arguments, read from its signature."""

    def __init__(self, fn):
        hints = typing.get_type_hints(fn)
        params = list(_inspect.signature(fn).parameters.values())[1:]   # the first one is the job
        self.args = {}
        for p in params:
            a = p.default if isinstance(p.default, arg) else arg(_REQUIRED if p.default is p.empty else p.default)
            self.args[p.name] = (hints.get(p.name), a)

    def usage(self):
        return ", ".join(a.describe(n) for n, (_, a) in self.args.items())

    def parse(self, raw):
        out, bad = {}, [f"unknown argument {k}" for k in raw if k not in self.args]
        for name, (kind, a) in self.args.items():
            if raw.get(name) is None:
                if a.default is _REQUIRED:
                    bad.append(f"{name} is required")
                else:
                    out[name] = a.default
                continue
            try:
                v = _convert(kind, raw[name])
                if (a.min is not None and v < a.min) or (a.max is not None and v > a.max):
                    raise ValueError(f"must be {a.limits()}")
                out[name] = v
            except (TypeError, ValueError) as e:
                bad.append(f"{name} {e}" if str(e) else f"{name}: bad value {raw[name]!r}")
        return out, bad


class _JobClient:
    """The plugin's fleet API client as one job sees it: no commands once the job is stopped."""

    def __init__(self, client, job):
        self._c, self._job = client, job
        self.api, self._token = client.api, getattr(client, "_token", None)

    def request(self, method, path, body=None, timeout=30, raw=False):
        if method != "GET":
            self._job._check()
        return self._c.request(method, path, body, timeout=timeout, raw=raw)


class _JobDrone(Drone):
    """A Drone whose waits end when the job is stopped. Control stays with the job."""

    def __init__(self, name, client, job):
        self.name, self._c, self._job = name, client, job

    def _wait(self, done, timeout, what, interval=0.5):
        s = self._job.wait_until(done, timeout, every=interval)
        if s is None:
            raise DroneError(f"{self.name}: timed out waiting to {what}")
        return s

    def close(self):
        pass


class Job:
    """One running job. `job.drone` flies it (a droneos.Drone); the rest is below."""

    def __init__(self, plugin, info, args):
        self.plugin, self.id, self.args = plugin, info["id"], args
        self.operator = info.get("operator")
        self.stopped = threading.Event()
        self.stop_reason = ""
        self._lock = threading.RLock()
        self._listeners = []
        self._c = plugin.client
        self.client = _JobClient(self._c, self)   # for any other fleet API call
        self.drone = _JobDrone(info["drone"], self.client, self)
        self.started = time.time()
        self.dir = plugin.reports / Path(self.id).name
        self.dir.mkdir(parents=True, exist_ok=True)
        self.report = {"id": self.id, "plugin": plugin.id, "drone": self.drone.name, "operator": self.operator,
                       "started": _now(), "ended": None, "status": "running", "summary": "", "args": args,
                       "photos": [], "events": []}
        self.save()

    # -- the report ------------------------------------------------------------------------------
    def save(self):
        """Write the report (job.report: add your own keys, then save)."""
        with self._lock:
            tmp = self.dir / "report.json.tmp"
            tmp.write_text(json.dumps(self.report, indent=1))
            tmp.replace(self.dir / "report.json")

    def event(self, what):
        """A line in the report's event list."""
        with self._lock:
            self.report["events"].append({"time": _now(), "what": str(what)})
            self.save()

    def photo(self, **extra):
        """Take a photo now and add it to the report with where the drone was (+ `extra`).
        Returns the photo's entry ({"n", "time", "north", "east", "altitude", ...}), or None if
        the camera failed (noted in the events; the job goes on)."""
        self._check()
        try:
            data = self.plugin.fetch_photo(self.drone.name)
            p = self.state()["position"]
        except Exception as e:
            self.event(f"photo failed: {e}")
            return None
        with self._lock:
            n = len(self.report["photos"]) + 1
            (self.dir / f"{n}.jpg").write_bytes(data)
            entry = {"n": n, "time": _now(), "north": p.get("north"), "east": p.get("east"),
                     "altitude": p.get("altitude"), **extra}
            self.report["photos"].append(entry)
            self.save()
        return entry

    def status(self, text):
        """The short text operators see for this job (fleet list, Job tab). Sent only when it changes."""
        self._check()
        if text == getattr(self, "_status", None):
            return
        self._status = text
        try:
            self._c.request("PATCH", f"/api/v1/drones/{self.drone.name}/job", {"text": text}, timeout=5)
        except DroneError:
            pass

    # -- the drone -------------------------------------------------------------------------------
    def state(self):
        """The drone's state from the fleet API: position, armed, battery, heading, detections..."""
        return self._c.request("GET", f"/api/v1/drones/{self.drone.name}", timeout=5)

    def sleep(self, seconds):
        """Wait; raises Stopped as soon as an operator steps in."""
        self._check()
        self.plugin.sleep(self, seconds)
        self._check()

    def wait_until(self, pred, timeout, every=1.0):
        """Poll the drone's state until pred(state) is true: returns that state, or None after
        `timeout` s. A failed read is retried. Raises Stopped."""
        t0 = self.plugin.clock()
        while True:
            self._check()
            try:
                s = self.state()
                if pred(s):
                    return s
            except DroneError:
                pass
            if self.plugin.clock() - t0 >= timeout:
                return None
            self.sleep(every)

    def climb(self, altitude, timeout=120):
        """Take off (or climb) to `altitude` m above home and wait until it's there. Do this before
        moving sideways: trees reach ~40 m in the sim and the drone has no obstacle sensors."""
        s = self.state()
        if s["armed"] and (s["position"]["altitude"] or 0) >= altitude - 5:
            return s
        self.event(self.drone._cmd("takeoff", altitude=altitude))
        s = self.wait_until(lambda s: (s["position"]["altitude"] or 0) >= altitude - 2, timeout)
        if s is None:
            raise DroneError(f"didn't reach {altitude:g} m within {timeout:g} s")
        return s

    def home(self):
        """Send the drone home (it lands there). Doesn't wait."""
        self.event(self.drone._cmd("return_home"))

    def detections(self):
        """What the drone's object detector sees right now (~2 Hz): objects with `label`, `score`,
        `confirmed` (seen in 3+ frames there) and `ground` ({north, east} from home, if known)."""
        return ((self.state().get("detections") or {}).get("objects")) or []

    def clock(self):
        """Seconds, for timing a job (monotonic; tests replace it)."""
        return self.plugin.clock()

    def sightings(self, since=None):
        """Objects the drone has seen since `since` (unix time, default the job's start): id, label,
        score, north, east, lat, lon, box, first_seen, last_seen. Includes ones first seen before the
        job (an object seen again within 10 min is the same sighting, and on_sighting isn't called
        for it again), so a job that wants everything it saw should check this at the end."""
        t = self.started if since is None else since
        return self._c.request("GET", f"/api/v1/drones/{self.drone.name}/sightings?since={t:.0f}", timeout=5)

    def on_sighting(self, fn):
        """Call fn(sighting) for every new object the detector confirms while the job runs (the fleet
        API's "detected" events; same fields as sightings()). Runs in its own thread until the job
        ends. Objects the drone saw in the 10 min before the job don't come again, and a dropped
        socket can miss some: check sightings() at the end."""
        listener = self.plugin.listen(self, fn)
        self._listeners.append(listener)
        listener.start()
        return listener

    # -- internals -------------------------------------------------------------------------------
    def _check(self):
        if self.stopped.is_set():
            raise Stopped(self.stop_reason or "stopped")

    def _stop(self, reason):
        self.stop_reason = reason or "stopped by an operator"
        self.event(f"stopped: {self.stop_reason}")
        self.stopped.set()


class EventStream(threading.Thread):
    """The fleet API's event stream for one drone; calls fn(sighting) for each "detected" event.
    Reconnects until .stop is set."""

    def __init__(self, job, fn, connect=None):
        super().__init__(daemon=True, name=f"events-{job.id}")
        q = urllib.parse.urlencode({"token": job._c._token, "drone": job.drone.name})
        self.url = job._c.api.replace("https://", "wss://").replace("http://", "ws://") + "/api/v1/events?" + q
        self.fn, self.stop, self._connect = fn, threading.Event(), connect

    def run(self):
        if self._connect is None:
            from websockets.sync.client import connect
            self._connect = connect
        while not self.stop.is_set():
            try:
                with self._connect(self.url, open_timeout=5) as ws:
                    while not self.stop.is_set():
                        try:
                            e = json.loads(ws.recv(timeout=1))
                        except TimeoutError:
                            continue
                        if e.get("command") == "detected" and e.get("sighting"):
                            try:
                                self.fn(e["sighting"])
                            except Stopped:
                                return
                            except Exception:
                                log.exception("on_sighting")
            except Exception as e:   # socket dropped or the fleet API restarting: try again
                if not self.stop.is_set():
                    log.warning("event stream: %s; reconnecting", e)
                    self.stop.wait(2)


def camera_snapshot(base):
    def fetch(drone):
        url = f"{base}/snapshot?topic=/{drone}/camera&width=640&height=480&quality=75"
        with urllib.request.urlopen(url, timeout=12) as r:   # HD frames: ~2 s per snapshot
            data = r.read()
        if not data.startswith(b"\xff\xd8"):
            raise ValueError("not a JPEG")
        return data
    return fetch


class Plugin:
    """A plugin: its id (as in droneos-plugin.json), one job function, and the service around it."""

    def __init__(self, id, root=None):
        self.id = id
        self.root = Path(root) if root else Path(sys._getframe(1).f_globals.get("__file__", "x")).resolve().parent
        self._fn = self._spec = self._text = self._check = None
        self._app = None
        self.configure()
        logging.basicConfig(level=logging.INFO, format="%(asctime)s %(name)s %(levelname)s %(message)s")

    def configure(self, client=None, reports=None, fetch_photo=None, sleep=None, clock=None, listen=None):
        """Defaults come from the environment; tests pass fakes. Forgets running jobs."""
        env = os.environ.get
        self._client = client
        self.reports = Path(reports or env(f"{self.id.upper()}_REPORTS") or f"~/.local/state/droneos/{self.id}").expanduser()
        self.fetch_photo = fetch_photo or camera_snapshot(env("CAMERA_URL", "http://127.0.0.1:8080"))
        self.sleep = sleep or (lambda job, s: job.stopped.wait(s))
        self.clock = clock or time.monotonic
        self.listen = listen or EventStream
        self.running = {}   # job id -> (Job, thread)
        return self

    @property
    def client(self):
        if self._client is None:
            p = Path(os.environ.get(f"{self.id.upper()}_CONFIG", f"~/.config/droneos/{self.id}_plugin.json")).expanduser()
            if p.is_file():
                cfg = json.loads(p.read_text())
                self._client = Client(cfg.get("api", "http://127.0.0.1:8090"), cfg["token"])
            else:
                self._client = Client()
        return self._client

    def job(self, fn=None, *, text=None, check=None):
        """Decorator for the job function: fn(job, **args). Its return value is the job's summary.
        text(args): the short status shown when it starts. check(args): raise ValueError(why) to
        refuse a start (for rules across arguments; single ones go in arg(...))."""
        def register(fn):
            self._fn, self._spec, self._text, self._check = fn, _Spec(fn), text, check
            return fn
        return register(fn) if fn else register

    # -- running a job ---------------------------------------------------------------------------
    def start(self, info, raw_args):
        args, bad = self._spec.parse(raw_args or {})
        if not bad and self._check:
            try:
                self._check(args)
            except (TypeError, ValueError) as e:
                bad.append(str(e))
        if bad:
            raise ValueError("; ".join(bad) + f". Arguments: {self._spec.usage()}")
        job = Job(self, info, args)
        t = threading.Thread(target=self._run, args=(job,), daemon=True, name=f"{self.id}-{job.id}")
        self.running[job.id] = (job, t)
        t.start()
        return job

    def _run(self, job):
        result, reason = "completed", ""
        try:
            out = self._fn(job, **job.args)
            reason = "" if out is None else str(out)
            job._check()
        except Stopped:
            result, reason = "stopped", job.stop_reason
        except Exception as e:
            result, reason = "failed", str(e) or type(e).__name__
            log.exception("%s job %s failed", self.id, job.id)
            job.event(f"failed: {reason}")
            if self._send_home(job):
                reason += "; sent home"
        finally:
            for listener in job._listeners:
                listener.stop.set()
        with job._lock:
            job.report.update(status=result, ended=_now(), summary=reason)
            job.save()
        if result != "stopped" and not job.stopped.is_set():   # a stopped job was ended by the fleet API
            try:
                self.client.request("DELETE", f"/api/v1/drones/{job.drone.name}/job",
                                    {"id": job.id, "result": result, "reason": reason, "links": {"report": job.id}})
            except DroneError as e:
                log.warning("ending job %s: %s", job.id, e)

    def _send_home(self, job):
        """A failed job must not leave the drone hovering with nobody flying it. Only when it's in
        the air and not already coming down (on the ground there's nothing to do)."""
        try:
            s = job.state()
            if job.stopped.is_set() or not s.get("armed") or s.get("landed_state") != "AIRBORNE" \
                    or s.get("mode") in ("AUTO_RTL", "AUTO_LAND"):
                return False
            job.event(job.client.request("POST", f"/api/v1/drones/{job.drone.name}/return_home", {}).get("message"))
            return True
        except (Exception, Stopped) as e:
            job.event(f"couldn't send it home: {e}")
            return False

    # -- the HTTP service ------------------------------------------------------------------------
    @property
    def app(self):
        if self._app is None:
            self._app = self._make_app()
        return self._app

    def _make_app(self):
        from fastapi import Body, FastAPI, Header, HTTPException
        from fastapi.responses import FileResponse

        app = FastAPI(title=f"DroneOS {self.id} plugin")
        app.state.plugin = self

        def load(rid):
            p = self.reports / Path(rid).name / "report.json"
            return json.loads(p.read_text()) if p.is_file() else None

        @app.post("/jobs")
        def start(job: dict = Body(...), args: dict = Body(default={}), x_droneos_caller: str = Header(default="")):
            if x_droneos_caller != "fleet-api":
                raise HTTPException(403, "jobs are started through the fleet API")
            if self._fn is None:
                raise HTTPException(500, "plugin has no @plugin.job function")
            if job.get("id") in self.running:
                return {"text": "already running", "links": {"report": job["id"]}}
            try:
                j = self.start(job, args)
            except ValueError as e:
                raise HTTPException(422, str(e))
            text = self._text(j.args) if self._text else f"{self.id} started"
            return {"text": text, "links": {"report": j.id}}

        @app.get("/jobs/{jid}")
        def alive(jid: str):
            """The fleet API checks running jobs here: 200 while we run it, 404 if we don't know it."""
            if jid not in self.running:
                raise HTTPException(404, f"no job {jid}")
            j, t = self.running[jid]
            return {"id": jid, "running": t.is_alive(), "photos": len(j.report["photos"])}

        @app.post("/jobs/{jid}/stopped")
        def stopped(jid: str, reason: str = Body("", embed=True), x_droneos_caller: str = Header(default="")):
            if x_droneos_caller != "fleet-api":
                raise HTTPException(403, "fleet API only")
            j = self.running.get(jid)
            if j:
                j[0]._stop(reason)
            return {"ok": bool(j)}

        @app.get("/args")
        def args():
            """What a job takes (for help texts)."""
            spec = self._spec.args.items() if self._spec else []
            return {n: {"type": getattr(k, "__name__", None), "required": a.default is _REQUIRED,
                        "default": None if a.default is _REQUIRED else a.default,
                        "min": a.min, "max": a.max, "help": a.help} for n, (k, a) in spec}

        @app.get("/reports")
        def reports(drone: str | None = None, limit: int = 10):
            if not self.reports.is_dir():
                return []
            out = [r for r in (load(d.name) for d in self.reports.iterdir() if d.is_dir())
                   if r and (drone is None or r["drone"] == drone)]
            out.sort(key=lambda r: r["started"], reverse=True)
            return out[:limit]

        @app.get("/reports/{rid}")
        def report(rid: str):
            r = load(rid)
            if r is None:
                raise HTTPException(404, "no such report")
            return r

        @app.get("/reports/{rid}/photos/{n}.jpg")
        def photo(rid: str, n: int):
            p = self.reports / Path(rid).name / f"{n}.jpg"
            if not p.is_file():
                raise HTTPException(404, "no such photo")
            return FileResponse(p, media_type="image/jpeg")

        @app.get("/ui/job.js")
        def ui():
            p = self.root / "ui" / "job.js"
            if not p.is_file():
                raise HTTPException(404, "this plugin has no UI")
            return FileResponse(p, media_type="text/javascript")

        @app.get("/health")
        def health():
            return {"ok": True, "running": sum(1 for _, t in self.running.values() if t.is_alive())}

        return app
