"""Inspect: the example DroneOS plugin (see docs/plugins.md).

Job: circle a point with the camera on it (PX4's own orbit), take a photo every few seconds,
then go home. Cloud-only: no onboard part, it uses the fleet API's orbit command. If this
service dies mid-job, the fleet API notices within 15 s and sends the drone home.

Run: uvicorn service:app --host 127.0.0.1 --port 8092
Env: INSPECT_CONFIG (json {"api", "token"}), INSPECT_REPORTS (dir), CAMERA_URL
"""

from droneos.plugin import Plugin, arg

plugin = Plugin("inspect")


def started(a):
    return f"circle N{a['north']:g} E{a['east']:g}, r {a['radius']:g} m, {a['minutes']:g} min"


@plugin.job(text=started)
def inspect(job, north: float, east: float,
            radius: float = arg(20.0, min=5, max=100),
            speed: float = arg(3.0, min=1, max=8),
            altitude: float = arg(50.0, min=45, max=120),
            minutes: float = arg(2.0, min=0.2, max=30),
            photo_every: float = arg(10.0, min=3, max=120)):
    job.climb(altitude)   # trees reach ~40 m: be up there before moving sideways
    job.event(job.drone.orbit(north, east, radius=radius, speed=speed, altitude=altitude))
    job.sleep(min(15.0, 60 * minutes))   # let it get onto the circle first
    for _ in range(max(1, int(60 * minutes // photo_every))):
        job.photo()
        job.sleep(photo_every)
    job.home()
    return f"{len(job.report['photos'])} photos around N{north:g} E{east:g}; returning home"


app = plugin.app
