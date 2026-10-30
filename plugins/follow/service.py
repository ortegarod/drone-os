"""Follow: keep a person in view from above. See docs/plugins.md.

Job: climb to a safe height, fly to a stand-off point looking at where the person is said to
be, drop to the follow height, lock on to the nearest confirmed person there, then keep them in
the middle of the camera like a camera operator would: always turn to face them, but only move
when they get too far (beyond `distance` + `slack`: the detector loses people past ~35 m) or
too close (under half of `distance`); then go to `distance` (default = the height, so with the
45-degree camera they sit mid-frame; the wide camera keeps them in frame much closer than that). Moving tilts the drone
and blurs where the person is; standing still keeps the fix sharp. Loses them for longer than
`lost_seconds`: the job ends and the drone goes home. Same after `minutes`.

Where the person is comes from the fleet API's view of the drone (detections: objects with a
ground spot, confirmed = seen in 3+ frames there), polled at 2 Hz, the rate the fleet API
relays them. Cloud-side control: fine for someone walking; a real drone would run this loop
onboard.

Run: uvicorn service:app --host 127.0.0.1 --port 8094
Env: FOLLOW_CONFIG (json {"api", "token"}), FOLLOW_REPORTS (dir), CAMERA_URL
"""

import math

from droneos.plugin import DroneError, Plugin, arg

GEOFENCE_M = 280.0   # PX4 keeps drones within 300 m of home; stay a bit inside
LOST_AFTER = 3.0     # s without a fix before it counts as losing them (the detector misses frames)

plugin = Plugin("follow")


def bearing(n0, e0, n1, e1):
    return math.degrees(math.atan2(e1 - e0, n1 - n0)) % 360


def angle_diff(a, b):
    return abs((a - b + 180) % 360 - 180)


class Target:
    """Where the person is and how they move: picks, each frame, the confirmed person nearest to
    where they should be by now; the spot is smoothed (each fix is off by a metre or two) and so
    is the velocity used to predict ahead."""

    def __init__(self, n, e, t):
        self.n, self.e, self.vn, self.ve, self.t = n, e, 0.0, 0.0, t
        self.seen = t
        self.bystanders = []   # [north, east, last seen]: other people seen while we had them

    def predict(self, t):
        dt = min(3.0, max(0.0, t - self.t))
        return self.n + self.vn * dt, self.e + self.ve * dt

    def note_bystanders(self, people, best, t):
        """Everyone else confirmed this frame, away from them: a bystander (remembered 2 min)."""
        for p in people:
            if p is not best and (len(p) < 3 or p[2]) and math.hypot(p[0] - best[0], p[1] - best[1]) > 4:
                hit = next((b for b in self.bystanders if math.hypot(p[0] - b[0], p[1] - b[1]) < 3.0), None)
                if hit:
                    hit[2] = t
                else:
                    self.bystanders.append([p[0], p[1], t])

    MAX_WALK = 2.0   # m/s: nobody we follow covers ground faster (a fix further than that is someone else)

    def update(self, people, t, gate=4.0, raw_gate=3.0):
        """people: [(north, east, confirmed), ...] this frame. A confirmed person may be up to
        `gate` m (+ a bit per second since the last fix) from where they should be; an unconfirmed
        one only `raw_gate` m (once locked on, a fresh box right where they should be is them; it
        fills the detector's gaps). Either way no further from the last fix than walking allows,
        so a gap doesn't hand the drone to someone standing nearby. Returns True if one is them."""
        pn, pe = self.predict(t)
        lost_for = t - self.seen
        reach = 3.0 + self.MAX_WALK * lost_for
        self.bystanders = [b for b in self.bystanders if t - b[2] < 120]

        def bystander(p):
            return any(math.hypot(p[0] - b[0], p[1] - b[1]) < 3.0 for b in self.bystanders)

        def ok(p):
            # never someone standing where a bystander stood, unless they themselves are right there
            # (walking past them): a gap at a corner next to them must not hand the drone over
            if bystander(p) and not bystander((self.n, self.e)):
                return False
            d = math.hypot(p[0] - pn, p[1] - pe)
            if len(p) < 3 or p[2]:
                # the longer they've been out of sight, the further from the prediction they may be
                # (they turn corners)
                g = min(reach, gate + 1.5 * lost_for)
            else:
                g = raw_gate
            return d <= g and math.hypot(p[0] - self.n, p[1] - self.e) <= reach
        cands = [p for p in people if ok(p)]
        best = min(cands, key=lambda p: math.hypot(p[0] - pn, p[1] - pe), default=None)
        if best is None:
            return False
        self.note_bystanders(people, best, t)
        dt = t - self.t
        n = pn + 0.5 * (best[0] - pn)    # halfway between the prediction and the new fix
        e = pe + 0.5 * (best[1] - pe)
        if dt > 0.2:
            vn, ve = (n - self.n) / dt, (e - self.e) / dt
            if math.hypot(vn, ve) < 3.0:   # nobody walks faster: a jump is noise, not speed
                self.vn += 0.3 * (vn - self.vn)
                self.ve += 0.3 * (ve - self.ve)
        self.n, self.e, self.t, self.seen = n, e, t, t
        return True


MAX_TILT = 6.0   # degrees: a drone tilted more than this is manoeuvring; its fixes are worth less


def people_in(view, confirmed_only=True):
    """People with a ground spot in the drone view's latest detections, as (north, east, confirmed);
    only confirmed ones unless asked. None (not "nobody") while the drone is tilted hard: its fixes
    then aren't trusted, and that isn't losing them."""
    att = (view or {}).get("attitude") or {}
    if max(abs(att.get("roll") or 0.0), abs(att.get("pitch") or 0.0)) > MAX_TILT:
        return None
    d = (view or {}).get("detections") or {}
    out = []
    for o in d.get("objects") or []:
        g = o.get("ground")
        c = o.get("confirmed", True)
        if o.get("label") == "person" and g and (c or not confirmed_only):
            out.append((g["north"], g["east"], bool(c)))
    return out


def started(a):
    return f"person near N{a['north']:g} E{a['east']:g}, from {a['altitude']:g} m"


def check(a):
    if math.hypot(a["north"], a["east"]) > GEOFENCE_M:
        raise ValueError(f"north, east must be within {GEOFENCE_M:g} m of home")


@plugin.job(text=started, check=check)
def follow(job, north: float, east: float,
           altitude: float = arg(30.0, min=20, max=60),
           transit_altitude: float = arg(50.0, min=45, max=120),
           distance: float = arg(None, min=10, max=80, help="default = altitude"),
           minutes: float = arg(5.0, min=0.5, max=30),
           lost_seconds: float = arg(30.0, min=5, max=120),
           speed: float = arg(6.0, min=2, max=10),
           slack: float = arg(5.0, min=2, max=30)):
    distance = distance or altitude
    job.report.update(path=[], followed_s=0.0, lost_count=0, walked_m=0.0)
    job.status(f"climbing to {transit_altitude:g} m")
    p = job.climb(transit_altitude)["position"]
    # stand-off point: `distance` short of the person, on the line from here
    n0, e0 = p["north"] or 0.0, p["east"] or 0.0
    hd = bearing(n0, e0, north, east)
    sn = round(north - distance * math.cos(math.radians(hd)), 1)
    se = round(east - distance * math.sin(math.radians(hd)), 1)
    if math.hypot(sn, se) > GEOFENCE_M:
        raise DroneError("stand-off point outside the geofence", 422)
    job.status("flying to the person")
    job.drone.goto(sn, se, altitude=transit_altitude, heading=round(hd, 1), speed=speed, wait=False)
    job.wait_until(lambda s: math.hypot((s["position"]["north"] or 0) - sn, (s["position"]["east"] or 0) - se) < 3,
                   math.hypot(sn - n0, se - e0) / speed * 2 + 60)
    job.drone.goto(sn, se, altitude=altitude, heading=round(hd, 1), wait=False)
    job.wait_until(lambda s: abs((s["position"]["altitude"] or 0) - altitude) < 1.5, 60)
    # lock on: a confirmed person within 15 m of where they were said to be
    target, t_end = None, job.clock() + 30
    job.status("looking for the person")
    while job.clock() < t_end and target is None:
        ppl = people_in(job.state()) or []
        near = [q for q in ppl if math.hypot(q[0] - north, q[1] - east) <= 15]
        if near:
            q = min(near, key=lambda q: math.hypot(q[0] - north, q[1] - east))
            target = Target(q[0], q[1], job.clock())
            target.note_bystanders(ppl, q, target.t)   # the others in view at lock-on
        else:
            job.sleep(0.5)
    if target is None:
        raise DroneError(f"no person seen within 15 m of N{north:g} E{east:g}", 404)
    job.event(f"locked on: person at N{target.n:.1f} E{target.e:.1f}")
    why = keep_in_view(job, target, altitude, distance, minutes, lost_seconds, speed, slack)
    r = job.report
    job.home()
    return (f"{why}: followed {r['followed_s'] / 60:.1f} min, person walked {r['walked_m']:.0f} m, "
            f"lost {r['lost_count']}x; returning home")


def keep_in_view(job, target, altitude, distance, minutes, lost_seconds, speed, slack):
    """The camera operator loop. Returns why it ended."""
    r = job.report
    t0 = job.clock()
    t_stop = t0 + 60 * minutes
    last_sent, last_cmd, last_path, last_photo = None, 0.0, 0.0, -1e9
    lost_since, lost_counted = None, False
    prev = (target.n, target.e, t0)
    while True:
        t = job.clock()
        if t >= t_stop:
            return f"followed for {minutes:g} min"
        try:
            s = job.state()
        except DroneError:
            job.sleep(0.5)
            continue
        p = s["position"]
        dn, de = p["north"] or 0.0, p["east"] or 0.0
        ppl = people_in(s, confirmed_only=False)
        if ppl is not None and target.update(ppl, t):
            if lost_since is not None and t - lost_since >= LOST_AFTER:
                job.event(f"found again after {t - lost_since:.0f} s")
            lost_since = None
            if t - prev[2] >= 2:   # distance walked from 2 s steps (each fix jitters)
                r["walked_m"] += math.hypot(target.n - prev[0], target.e - prev[1])
                prev = (target.n, target.e, t)
            r["followed_s"] = round(t - t0, 1)
        elif ppl is not None or lost_since is not None:
            if lost_since is None:
                lost_since = target.seen
            if t - lost_since >= LOST_AFTER and not lost_counted:
                lost_counted = True
                r["lost_count"] += 1
            if t - lost_since > lost_seconds:
                return f"lost the person for {lost_seconds:g} s"
        if lost_since is None:
            lost_counted = False
        out_of_sight = lost_since is not None and t - lost_since >= LOST_AFTER
        if t - last_path >= 2:
            last_path = t
            r["path"] = (r["path"] + [[round(target.n, 1), round(target.e, 1)]])[-600:]
            job.save()
        if lost_since is None and t - last_photo >= 15:
            last_photo = t
            job.photo(north=round(target.n, 1), east=round(target.e, 1))   # where the person is
        rng_now = math.hypot(target.n - dn, target.e - de)
        if out_of_sight:
            job.status(f"lost sight of the person ({t - lost_since:.0f} s), holding")
        else:
            job.status(f"following · {rng_now:.0f} m away")
        # Camera operator: always face them; move only when they're out of distance +- slack,
        # then go to `distance` short of where they'll be in a second, on the line from here.
        if not out_of_sight and t - last_cmd >= 1.0:
            pn, pe = target.predict(t + 1.0)
            hd = bearing(dn, de, pn, pe)
            rng = math.hypot(pn - dn, pe - de)
            wn, we = (last_sent[0], last_sent[1]) if last_sent else (dn, de)
            if rng > distance + slack or (rng > 1 and rng < distance / 2):
                wn = pn - distance * (pn - dn) / rng
                we = pe - distance * (pe - de) / rng
                if math.hypot(wn, we) > GEOFENCE_M:   # they walked off the fence: watch from the edge
                    k = GEOFENCE_M / math.hypot(wn, we)
                    wn, we = wn * k, we * k
                r["moves"] = r.get("moves", 0) + 1
            if last_sent is None or math.hypot(wn - last_sent[0], we - last_sent[1]) > 0.5 \
                    or angle_diff(hd, last_sent[2]) > 6:
                job.drone.goto(round(wn, 1), round(we, 1), altitude=altitude, heading=round(hd, 1), speed=speed, wait=False)
                last_sent, last_cmd = (wn, we, hd), t
        job.sleep(0.5)


app = plugin.app
