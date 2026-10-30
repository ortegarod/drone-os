"""High-level control of DroneOS drones through the fleet API.

    from droneos import Drone, fleet

    for d in fleet():
        print(d["name"], d["battery"]["percent"])

    with Drone("drone1") as d:
        d.takeoff(10)
        d.goto(20, 0)
        d.land()

Positions are meters north/east of home; altitude is meters above the ground the
drone took off from.
"""

import math
import time

from .client import Client, DroneError


def fleet(client=None):
    """All drones: position, battery, GPS, health, and who controls each."""
    return (client or Client()).request("GET", "/api/v1/drones")


class Drone:
    def __init__(self, name="drone1", client=None):
        self.name = name
        self._c = client or Client()
        self.state()  # fail fast on unknown drone / bad token

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        self.close()

    def close(self):
        """Release control so other operators can fly this drone."""
        try:
            self._c.request("DELETE", f"/api/v1/drones/{self.name}/control")
        except DroneError:
            pass

    # -- state -------------------------------------------------------------

    def state(self):
        """Operator view of the drone (position, battery, GPS, health, controller)."""
        return self._c.request("GET", f"/api/v1/drones/{self.name}")

    @property
    def position(self):
        """(north, east, altitude) in meters."""
        p = self.state()["position"]
        return p["north"], p["east"], p["altitude"]

    @property
    def armed(self):
        return self.state()["armed"]

    # -- flight ------------------------------------------------------------

    def _cmd(self, command, **args):
        return self._c.request("POST", f"/api/v1/drones/{self.name}/{command}", args)["message"]

    def takeoff(self, altitude=10.0, tolerance=1.0, timeout=60.0, wait=True):
        """Take off in place to `altitude` meters above home (PX4 Takeoff mode)."""
        self._cmd("takeoff", altitude=altitude)
        if wait:
            self._wait(lambda s: s["armed"] and abs(s["position"]["altitude"] - altitude) <= tolerance,
                       timeout, f"reach {altitude:g} m")

    def goto(self, north, east, altitude=None, heading=None, tolerance=1.0, timeout=120.0, wait=True, speed=None):
        """Fly to (north, east) and hold there (PX4 reposition). Altitude defaults to the last
        commanded one; heading in degrees; speed in m/s (1-10, default PX4 cruise)."""
        args = {"north": north, "east": east}
        if speed is not None:
            args["speed"] = speed
        if altitude is not None:
            args["altitude"] = altitude
        if heading is not None:
            args["heading"] = heading
        self._cmd("goto", **args)
        if wait:
            def arrived(s):
                p = s["position"]
                d = math.dist((p["north"], p["east"]), (north, east))
                return d <= tolerance and (altitude is None or abs(p["altitude"] - altitude) <= tolerance)
            self._wait(arrived, timeout, f"reach N{north:g} E{east:g}")

    def hold(self):
        """Stop and hover where it is (PX4 Hold). Ends a go-to, orbit or patrol."""
        return self._cmd("hold")

    def orbit(self, north, east, radius=20.0, speed=3.0, altitude=None, clockwise=True, face_center=True):
        """Circle (north, east) at `radius` m, nose to the centre (PX4 Orbit). Runs until hold(),
        return_home() or land(). PX4 caps speed at sqrt(2*radius) m/s."""
        args = dict(north=north, east=east, radius=radius, speed=speed, clockwise=clockwise, face_center=face_center)
        if altitude is not None:
            args["altitude"] = altitude
        return self._cmd("orbit", **args)

    def land(self, timeout=120.0, wait=True):
        """Land here. Blocks until disarmed, unless wait=False."""
        self._cmd("land")
        if wait:
            self._wait(lambda s: not s["armed"], timeout, "land")

    def return_home(self, timeout=300.0, wait=True):
        """Fly back to the takeoff point and land."""
        self._cmd("return_home")
        if wait:
            self._wait(lambda s: not s["armed"], timeout, "return home")

    def patrol(self, route=None, altitude=30.0, loops=1, hold=0.0, radius=2.0, wait=True, timeout=None, speed=None):
        """Start a Patrol job: fly `route` (list of (north, east) points; None = the drone's shared
        route, the one on the map) `loops` times, then return home and land.

        Runs as a job of the patrol plugin: the plugin holds the drone's control and records a report
        (a photo at every point). The flying happens onboard (PX4 PATROL mode), so it finishes even if
        this script exits or the link drops. Takes off first if needed. Stop it with land() or
        return_home(). With wait=True, blocks until the job has ended and returns it.
        """
        args = {"altitude": altitude, "loops": loops, "hold": hold, "radius": radius}
        if speed is not None:
            args["speed"] = speed
        if route is not None:
            args["route"] = [[float(n), float(e)] for n, e in route]
        job = self._c.request("POST", f"/api/v1/drones/{self.name}/job", {"plugin": "patrol", "args": args}, timeout=200)
        if not wait:
            return job
        deadline = time.time() + (timeout or 600.0 * loops)
        while time.time() < deadline:
            if (self.job() or {}).get("id") != job["id"]:
                return next((j for j in self._c.request("GET", f"/api/v1/jobs?drone={self.name}&limit=5") if j["id"] == job["id"]), None)
            time.sleep(2.0)
        raise DroneError(f"{self.name}: patrol still running after {timeout or 600.0 * loops:.0f} s")

    def dispatch(self, incident_id, altitude=50.0):
        """Start a Dispatch job: the dispatch plugin climbs to `altitude`, flies to the incident and
        sends the drone home once the incident is resolved. Returns the job right away."""
        return self._c.request("POST", f"/api/v1/drones/{self.name}/job",
                               {"plugin": "dispatch", "args": {"incident_id": str(incident_id), "altitude": altitude}}, timeout=200)

    def job(self):
        """The drone's current job (patrol, ...) or None."""
        return self._c.request("GET", f"/api/v1/drones/{self.name}/job")

    def route(self):
        """The drone's shared patrol route: {"points": [[north, east], ...], "operator", "updated"}.
        Everyone sees and edits the same one (the UI shows it as draggable points on the map)."""
        return self._c.request("GET", f"/api/v1/plugins/patrol/drones/{self.name}/route")

    def set_route(self, points):
        """Replace the shared route; points are (north, east) meters from home. [] clears it."""
        return self._c.request("PUT", f"/api/v1/plugins/patrol/drones/{self.name}/route",
                               {"points": [[float(n), float(e)] for n, e in points]})

    def patrol_status(self):
        """Onboard patrol progress: loaded, running, finished, item, items, progress."""
        return self._c.request("GET", f"/api/v1/drones/{self.name}/patrol")

    def arm(self):
        self._cmd("arm")

    def disarm(self):
        self._cmd("disarm")

    def kill(self):
        """EMERGENCY: cut the motors immediately. The drone will fall."""
        self._cmd("kill")

    # -- control -----------------------------------------------------------

    def take_control(self, force=False):
        self._c.request("POST", f"/api/v1/drones/{self.name}/control", {"force": force})

    def release_control(self):
        self._c.request("DELETE", f"/api/v1/drones/{self.name}/control")

    # -- internals ---------------------------------------------------------

    def _wait(self, done, timeout, what, interval=0.5):
        deadline = time.monotonic() + timeout
        while True:
            s = self.state()
            if not s["online"]:
                raise DroneError(f"{self.name} went offline while waiting to {what}")
            if done(s):
                return s
            if time.monotonic() > deadline:
                raise DroneError(f"{self.name}: timed out waiting to {what}")
            time.sleep(interval)
