"""Patrol plugin: reports, a photo at every patrol point plus what happened on the way.

The patrol itself flies onboard (the PATROL mode next to drone_core + PX4). This recorder only
watches it from the cloud, through the fleet API: when the drone reaches a point (the mission item advances) it grabs a camera frame and
the drone's position, and it notes mode changes and PX4 failsafes until the drone lands.
If this service is down for part of a patrol, the flight is unaffected; the report just misses
the points reached meanwhile (they're listed as missed).

Reports live in <root>/<id>/report.json with photos next to it as <n>.jpg.
"""

import json
import logging
import math
import os
import threading
import time
import urllib.request
import uuid
from datetime import datetime, timezone

log = logging.getLogger("patrol.recorder")

POLL_S = 0.5
# A point only counts as reached if the drone was actually near it when the mission moved on.
REACHED_WITHIN_M = 8.0
STALE_AFTER_S = 3 * 3600


def _now_iso(t):
    return datetime.fromtimestamp(t, timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def http_snapshot(base_url):
    """Return fetch(drone) -> JPEG bytes from web_video_server's /snapshot (via the camera proxy)."""
    def fetch(drone):
        url = f"{base_url}/snapshot?topic=/{drone}/camera&width=640&height=480&quality=75"
        with urllib.request.urlopen(url, timeout=6) as r:
            data = r.read()
        if not data.startswith(b"\xff\xd8"):
            raise ValueError("not a JPEG")
        return data
    return fetch


class PatrolRecorder:
    def __init__(self, fleet, root, fetch_photo, clock=time.time, on_finish=None):
        """fleet: anything with snapshot(drone) -> (raw_state, online, home_z) | None and mission_status(drone).
        on_finish(report): called (outside the lock, from tick) when a report ends."""
        self.fleet, self.root, self.fetch_photo, self.clock = fleet, os.path.expanduser(root), fetch_photo, clock
        self.on_finish = on_finish
        self._finished = []
        os.makedirs(self.root, exist_ok=True)
        self._lock = threading.Lock()
        self._active = {}          # id -> report dict (running only)
        self._stop = threading.Event()
        self._thread = None
        # Resume reports that were running when the API stopped.
        for rep in self._load_all():
            if rep["status"] == "running":
                rep["events"].append(self._event("patrol service restarted; points reached meanwhile have no photo"))
                self._active[rep["id"]] = rep

    # -- lifecycle ---------------------------------------------------------

    def start_thread(self):
        self._thread = threading.Thread(target=self._run, name="patrol-recorder", daemon=True)
        self._thread.start()

    def stop_thread(self):
        self._stop.set()

    def _run(self):
        while not self._stop.wait(POLL_S):
            try:
                self.tick()
            except Exception:
                log.exception("patrol recorder tick failed")

    # -- API ---------------------------------------------------------------

    def start(self, drone, operator, route, altitude, loops, speed=None, job=None):
        with self._lock:
            for rep in list(self._active.values()):
                if rep["drone"] == drone:
                    self._finish(rep, "replaced", "a new patrol was started on this drone")
            t = self.clock()
            rid = datetime.fromtimestamp(t, timezone.utc).strftime("%Y%m%d-%H%M%S-") + uuid.uuid4().hex[:6]
            points = [{"n": i + 1, "loop": i // len(route) + 1, "point": i % len(route) + 1,
                       "target": {"north": n, "east": e}, "status": "pending"}
                      for i, (n, e) in enumerate(list(route) * loops)]
            rep = {"id": rid, "drone": drone, "operator": operator, "started": _now_iso(t), "ended": None,
                   "status": "running", "summary": "", "altitude": altitude, "loops": loops, "speed": speed,
                   "route": [[n, e] for n, e in route], "points": points, "events": [],
                   "landed": None, "job": job, "_item": 0, "_mode": None, "_failsafe": False, "_t0": t}
            os.makedirs(os.path.join(self.root, rid), exist_ok=True)
            self._active[rid] = rep
            self._save(rep)
            return rid

    def list(self, drone=None, limit=20):
        reps = [r for r in self._load_all() if drone is None or r["drone"] == drone]
        reps.sort(key=lambda r: r["started"], reverse=True)
        return [self._summary(r) for r in reps[:limit]]

    def get(self, rid):
        with self._lock:
            if rid in self._active:
                return self._public(self._active[rid])
        rep = self._load(rid)
        return self._public(rep) if rep else None

    def photo_path(self, rid, n):
        p = os.path.join(self.root, os.path.basename(rid), f"{int(n)}.jpg")
        return p if os.path.isfile(p) else None

    def note(self, drone, what):
        """Add an event (e.g. a PX4 mode_completed) to the drone's running report, if any."""
        with self._lock:
            reps = [r for r in self._active.values() if r["drone"] == drone]
        snap = self.fleet.snapshot(drone)
        for rep in reps:
            rep["events"].append(self._event(what, snap[0], snap[2]) if snap else self._event(what))
            self._save(rep)

    # -- watching ----------------------------------------------------------

    def active_for(self, drone):
        with self._lock:
            return next((self._public(r) for r in self._active.values() if r["drone"] == drone), None)

    def tick(self):
        with self._lock:
            active = list(self._active.values())
        for rep in active:
            self._watch(rep)
        self.flush()

    def flush(self):
        """Hand finished reports to on_finish, outside the lock."""
        with self._lock:
            done, self._finished = self._finished, []
        for rep in done:
            if self.on_finish:
                try:
                    self.on_finish(rep)
                except Exception:
                    log.exception("on_finish failed for %s", rep.get("id"))

    def _watch(self, rep):
        drone = rep["drone"]
        snap = self.fleet.snapshot(drone)
        if snap is None or not snap[1]:
            return
        state, _, home_z = snap
        t = self.clock()
        age = t - rep.get("_t0", t)
        if age > STALE_AFTER_S:
            with self._lock:
                self._finish(rep, "unknown", "stopped watching after 3 h")
            return

        mode = state.get("nav_state")
        armed = state.get("arming_state") == "ARMED"
        if mode != rep["_mode"]:
            # On disarm PX4 restores the last user-chosen mode (OFFBOARD after a patrol), which isn't
            # a flight event [commander/UserModeIntention.cpp:88-91 on v1.15.4].
            if rep["_mode"] is not None and armed:
                rep["events"].append(self._event(f"mode {rep['_mode']} -> {mode}", state, home_z))
            rep["_mode"] = mode
        fs = bool(state.get("failsafe"))
        if fs and not rep["_failsafe"]:
            reasons = [r for r in (state.get("failsafe_reasons") or []) if r != "gcs_connection_lost"]
            rep["events"].append(self._event("PX4 failsafe: " + (", ".join(reasons) or "active"), state, home_z))
        rep["_failsafe"] = fs

        try:
            ms = self.fleet.mission_status(drone)
        except Exception:
            ms = None
        if ms and ms.get("mission_valid"):
            # Closest approach to the point being flown to. drone_core can report the advance seconds
            # late, so where the drone is *now* isn't proof.
            cur = rep["_item"]
            if cur < len(rep["points"]):
                tgt = rep["points"][cur]["target"]
                here = self._where(state, home_z)
                dist = math.dist((here["north"], here["east"]), (tgt["north"], tgt["east"]))
                best = rep.setdefault("_closest", {}).get(str(cur))
                if best is None or dist < best["d"]:
                    rep["_closest"][str(cur)] = {"d": dist, "where": here, "time": _now_iso(self.clock())}
            item = int(ms.get("current_item", 0))
            # Items 0..N-1 are the patrol points; reaching point i moves current_item to i+1.
            for i in range(rep["_item"], min(item, len(rep["points"]))):
                self._reached(rep, i, state, home_z)
            rep["_item"] = max(rep["_item"], item)
        # a timeout or lost OFFBOARD fails the mission (the drone holds) instead of
        # advancing. Older drone_core doesn't send these fields.
        if ms and ms.get("mission_failed") and not rep.get("_mission_failed"):
            rep["_mission_failed"] = ms.get("failure_reason") or "mission failed"
            rep["events"].append(self._event("mission failed: " + rep["_mission_failed"], state, home_z))

        if not armed and (rep["_item"] > 0 or age > 15):
            with self._lock:
                self._landed(rep, state)
        else:
            self._save(rep)

    def _reached(self, rep, i, state, home_z):
        pt = rep["points"][i]
        pt.update(time=_now_iso(self.clock()), **self._where(state, home_z))
        pt["off_target_m"] = round(math.dist((pt["north"], pt["east"]),
                                             (pt["target"]["north"], pt["target"]["east"])), 1)
        best = rep.get("_closest", {}).get(str(i))
        if best and best["d"] < pt["off_target_m"]:
            # Report where and when the drone was closest; the photo is still from the moment we heard.
            late = pt["off_target_m"]
            pt.update(time=best["time"], **best["where"])
            pt["off_target_m"] = round(best["d"], 1)
            if late - best["d"] > REACHED_WITHIN_M:
                pt["photo_note"] = f"photo taken late, {late:.0f} m past the point"
        pt["status"] = "reached" if pt["off_target_m"] <= REACHED_WITHIN_M else "off_target"
        if pt["status"] == "off_target":
            rep["events"].append(self._event(f"point {pt['n']} skipped: drone was {pt['off_target_m']} m away", state, home_z))
        try:
            data = self.fetch_photo(rep["drone"])
            with open(os.path.join(self.root, rep["id"], f"{pt['n']}.jpg"), "wb") as f:
                f.write(data)
            pt["photo"] = True
        except Exception as e:
            pt["photo"] = False
            pt["photo_error"] = str(e)[:120]
        self._save(rep)

    def _landed(self, rep, state):
        snap = self.fleet.snapshot(rep["drone"])
        home_z = snap[2] if snap else 0.0
        rep["landed"] = self._where(state, home_z)
        rep["landed"]["from_home_m"] = round(math.hypot(rep["landed"]["north"], rep["landed"]["east"]), 1)
        reached = sum(p["status"] == "reached" for p in rep["points"])
        total = len(rep["points"])
        for p in rep["points"]:
            if p["status"] == "pending":
                p["status"] = "missed"
        photos = sum(bool(p.get("photo")) for p in rep["points"])
        fs = [e["what"] for e in rep["events"] if e["what"].startswith("PX4 failsafe")]
        off = sum(p["status"] == "off_target" for p in rep["points"])
        failed = rep.get("_mission_failed")
        if reached == total and not fs and not failed:
            status, why = "completed", ""
        elif failed:
            status, why = "failed", "mission failed: " + failed
        elif fs:
            status, why = "aborted", fs[0]
        elif off:
            status, why = "failed", f"{off} points were never actually reached"
        else:
            status, why = "aborted", "stopped before the last point (hold, land or return home)"
        summary = f"{reached}/{total} points, {photos} photos, landed {rep['landed']['from_home_m']} m from home"
        self._finish(rep, status, (why + ". " if why else "") + summary)

    def _finish(self, rep, status, summary):
        rep["status"], rep["summary"], rep["ended"] = status, summary, _now_iso(self.clock())
        self._active.pop(rep["id"], None)
        self._save(rep)
        self._finished.append(self._public(rep))

    # -- helpers -----------------------------------------------------------

    @staticmethod
    def _where(state, home_z):
        z = state.get("local_z")
        return {"north": round(state.get("local_x") or 0.0, 1), "east": round(state.get("local_y") or 0.0, 1),
                "altitude": round(home_z - z, 1) if isinstance(z, (int, float)) else None,
                "lat": state.get("latitude"), "lon": state.get("longitude"),
                "battery": round(100 * state["battery_remaining"]) if isinstance(state.get("battery_remaining"), (int, float)) else None}

    def _event(self, what, state=None, home_z=0.0):
        e = {"time": _now_iso(self.clock()), "what": what}
        if state:
            e.update(self._where(state, home_z))
        return e

    def _save(self, rep):
        path = os.path.join(self.root, rep["id"], "report.json")
        tmp = path + ".tmp"
        with open(tmp, "w") as f:
            json.dump(rep, f, indent=1)
        os.replace(tmp, path)

    def _load(self, rid):
        try:
            with open(os.path.join(self.root, os.path.basename(rid), "report.json")) as f:
                return json.load(f)
        except (OSError, ValueError):
            return None

    def _load_all(self):
        out = []
        for d in os.listdir(self.root):
            rep = self._load(d)
            if rep:
                out.append(rep)
        return out

    @staticmethod
    def _public(rep):
        return {k: v for k, v in rep.items() if not k.startswith("_")}

    @staticmethod
    def _summary(rep):
        pts = rep["points"]
        return {"id": rep["id"], "drone": rep["drone"], "operator": rep["operator"], "started": rep["started"],
                "ended": rep["ended"], "status": rep["status"], "summary": rep["summary"],
                "points": len(pts), "reached": sum(p["status"] == "reached" for p in pts),
                "photos": sum(bool(p.get("photo")) for p in pts)}
