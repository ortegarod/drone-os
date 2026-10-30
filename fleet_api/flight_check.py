#!/usr/bin/env python3
"""Smoke-test a real flight through the fleet API (sim only!).

Takes off to ALT, flies HOP meters north, returns over the start, lands, and checks
each step against telemetry. Usage:
  FLEET_API=http://127.0.0.1:8090 FLEET_TOKEN=... python3 flight_check.py drone1
"""
import json, os, sys, time, urllib.request

API = os.environ.get("FLEET_API", "http://127.0.0.1:8090")
TOKEN = os.environ["FLEET_TOKEN"]
DRONE = sys.argv[1] if len(sys.argv) > 1 else "drone1"
ALT, HOP = 10.0, 15.0


def call(method, path, body=None):
    req = urllib.request.Request(API + path, method=method, data=json.dumps(body or {}).encode(),
                                 headers={"Authorization": f"Bearer {TOKEN}", "Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return json.loads(r.read())
    except urllib.error.HTTPError as e:
        raise SystemExit(f"FAIL {method} {path}: {e.code} {e.read().decode()}")


def drone():
    return call("GET", f"/api/v1/drones/{DRONE}")


def wait(what, ok, timeout):
    t0 = time.time()
    while time.time() - t0 < timeout:
        d = drone()
        p = d["position"]
        if ok(d):
            print(f"  ok   {what} in {time.time()-t0:.0f}s  (N{p['north']:.1f} E{p['east']:.1f} alt {p['altitude']:.1f} {d['mode']})")
            return d
        time.sleep(1)
    raise SystemExit(f"FAIL {what}: timed out; last N{p['north']:.1f} E{p['east']:.1f} alt {p['altitude']:.1f} {d['mode']} armed={d['armed']}")


d = drone()
assert d["online"] and not d["armed"], f"{DRONE} must be online and on the ground: {d}"
n0, e0 = d["position"]["north"], d["position"]["east"]
print(f"start {DRONE}: N{n0:.1f} E{e0:.1f} bat {d['battery']['percent']}%")

print("takeoff", call("POST", f"/api/v1/drones/{DRONE}/takeoff", {"altitude": ALT})["message"])
wait(f"reach {ALT:g} m", lambda d: d["armed"] and abs(d["position"]["altitude"] - ALT) < 1.0, 60)

print("goto", call("POST", f"/api/v1/drones/{DRONE}/goto", {"north": n0 + HOP, "east": e0})["message"])
wait(f"move {HOP:g} m north", lambda d: abs(d["position"]["north"] - (n0 + HOP)) < 1.0 and abs(d["position"]["east"] - e0) < 1.0, 60)

print("goto", call("POST", f"/api/v1/drones/{DRONE}/goto", {"north": n0, "east": e0})["message"])
wait("back over start", lambda d: abs(d["position"]["north"] - n0) < 1.0 and abs(d["position"]["east"] - e0) < 1.0, 60)

print("land", call("POST", f"/api/v1/drones/{DRONE}/land")["message"])
wait("landed and disarmed", lambda d: not d["armed"], 90)

call("DELETE", f"/api/v1/drones/{DRONE}/control")
log = call("GET", f"/api/v1/log?limit=6&drone={DRONE}")
print("log:", [(e["operator"], e["command"], e["ok"]) for e in reversed(log)])
print("PASS")
