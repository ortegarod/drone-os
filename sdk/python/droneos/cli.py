"""droneos: command-line control of DroneOS drones (operators and the AI agent use this).

  droneos drones                         fleet overview
  droneos status drone1 [--json]         one drone
  droneos takeoff drone1 [--alt 10]      arm and climb, waits until there
  droneos goto drone1 N E [--alt A] [--heading DEG] [--speed S]   PX4 flies there and holds
  droneos hold drone1                    stop and hover (ends go-to / orbit / patrol)
  droneos orbit drone1 N E [--radius 20] [--speed 3] [--alt A] [--ccw]   circle a point, nose in
  droneos land drone1 | home drone1      waits until disarmed
  droneos patrol drone1 "40,0 40,30 -10,30" [--alt 30] [--loops 2] [--speed 5]   onboard; waits until landed
  droneos patrol drone1 map [...]        fly the drone's shared route (the points on the map)
  droneos dispatch drone1 INCIDENT [--alt 50]   Dispatch job: fly to the incident (climbs first)
  droneos start drone1 PLUGIN [key=value ...]   start any plugin's job, e.g. start drone1 inspect north=20 east=30
  droneos plugins                        installed plugins (job types)
  droneos plugins install MANIFEST.json  install/update a plugin live; prints its token once
  droneos plugins remove ID              remove an installed plugin
  droneos me                             who you are (operator name, role)
  droneos operators                      everyone with access (admins)
  droneos operators add NAME [--role R]  new account (admin|pilot|viewer); prints its token once
  droneos operators role NAME R | token NAME | remove NAME
  droneos job drone1                     the drone's current job (patrol, dispatch, ...)
  droneos jobs [--drone drone1] [-n 10]  finished jobs and how they ended
  droneos route drone1 ["40,0 40,30 -10,30" | clear]   show or set the shared route (operator drags it on the map)
  droneos arm|disarm drone1
  droneos kill drone1 --yes              EMERGENCY motor cut
  droneos control drone1 take [--force] | release
  droneos log [--drone drone1] [-n 20]

Add --no-wait to return as soon as the command is accepted.
Config: DRONEOS_API / DRONEOS_TOKEN, or ~/.config/droneos/client.json {"api": ..., "token": ...}
"""

import argparse
import json
import sys

from .client import Client, DroneError
from .drone import Drone, fleet


def _row(d):
    p, b = d["position"], d["battery"]
    status = "OFFLINE" if not d["online"] else ("ARMED" if d["armed"] else "landed")
    ctl = d["controller"] or "-"
    f = lambda v, w, n=1: f"{v:>{w}.{n}f}" if isinstance(v, (int, float)) else f"{'-':>{w}}"
    fs = "  FAILSAFE: " + ", ".join(d.get("failsafe_reasons") or []) if d.get("failsafe") else ""
    return (f"{d['name']:<8} {status:<8} {str(d['mode']):<12} N{f(p['north'], 7)} E{f(p['east'], 7)} "
            f"alt {f(p['altitude'], 5)} m  bat {f(b['percent'], 3, 0)}%  control {ctl}{fs}")


def _points(text):
    try:
        route = [tuple(float(v) for v in pt.split(",")) for pt in text.split()]
        assert route and all(len(p) == 2 for p in route)
        return route
    except (ValueError, AssertionError):
        sys.exit('route must look like "40,0 40,30 -10,30" (north,east in meters)')


def main(argv=None):
    ap = argparse.ArgumentParser(prog="droneos", description="Control DroneOS drones through the fleet API.")
    sub = ap.add_subparsers(dest="cmd", required=True)

    s = sub.add_parser("drones", help="fleet overview")
    s.add_argument("--json", action="store_true")
    s = sub.add_parser("status", help="one drone")
    s.add_argument("drone"); s.add_argument("--json", action="store_true")
    s = sub.add_parser("takeoff", help="take off in place (PX4 Takeoff)")
    s.add_argument("drone"); s.add_argument("--alt", type=float, default=10.0)
    s = sub.add_parser("goto", help="fly to N/E meters from home")
    s.add_argument("drone"); s.add_argument("north", type=float); s.add_argument("east", type=float)
    s.add_argument("--alt", type=float); s.add_argument("--heading", type=float); s.add_argument("--speed", type=float)
    s = sub.add_parser("hold", help="stop and hover in place (PX4 Hold)")
    s.add_argument("drone")
    s = sub.add_parser("orbit", help="circle a point N/E meters from home, nose to the centre")
    s.add_argument("drone"); s.add_argument("north", type=float); s.add_argument("east", type=float)
    s.add_argument("--radius", type=float, default=20.0); s.add_argument("--speed", type=float, default=3.0)
    s.add_argument("--alt", type=float); s.add_argument("--ccw", action="store_true", help="counter-clockwise")
    s = sub.add_parser("patrol", help="fly a route onboard, then return home and land")
    s.add_argument("drone"); s.add_argument("route", help='points "north,east north,east ..." in meters from home, or "map" for the shared route')
    s.add_argument("--alt", type=float, default=30.0); s.add_argument("--loops", type=int, default=1)
    s.add_argument("--speed", type=float, help="m/s, 1-10 (default 5)")
    s.add_argument("--hold", type=float, default=0.0, help="seconds to hover at each point")
    s = sub.add_parser("route", help="show or set the drone's shared patrol route (the points on the map)")
    s.add_argument("drone"); s.add_argument("points", nargs="?", help='"north,east north,east ..." or "clear"')
    for name, h in [("land", "land here"), ("home", "return home and land"), ("arm", "arm"), ("disarm", "disarm")]:
        sub.add_parser(name, help=h).add_argument("drone")
    s = sub.add_parser("kill", help="EMERGENCY: cut motors, drone falls")
    s.add_argument("drone"); s.add_argument("--yes", action="store_true", help="confirm")
    s = sub.add_parser("control", help="take or release control of a drone")
    s.add_argument("drone"); s.add_argument("action", choices=["take", "release"]); s.add_argument("--force", action="store_true")
    s = sub.add_parser("dispatch", help="send the drone to an incident (Dispatch job)")
    s.add_argument("drone"); s.add_argument("incident"); s.add_argument("--alt", type=float, default=50.0)
    s = sub.add_parser("start", help="start a job of any plugin")
    s.add_argument("drone"); s.add_argument("plugin"); s.add_argument("args", nargs="*", help="key=value (numbers become numbers)")
    s = sub.add_parser("plugins", help="installed plugins (job types); install/remove one live")
    s.add_argument("action", nargs="?", choices=["list", "install", "remove"], default="list")
    s.add_argument("what", nargs="?", help="install: manifest file (droneos-plugin.json); remove: plugin id")
    s.add_argument("--rotate-token", action="store_true", help="install: issue a new token (the old one stops working)")
    sub.add_parser("me", help="who you are")
    s = sub.add_parser("operators", help="operator accounts (admins): list, add, role, token, remove")
    s.add_argument("action", nargs="?", choices=["list", "add", "role", "token", "remove"], default="list")
    s.add_argument("name", nargs="?")
    s.add_argument("new_role", nargs="?", help="role: the new role")
    s.add_argument("--role", default="pilot", choices=["admin", "pilot", "viewer"], help="add: the role")
    s = sub.add_parser("job", help="the drone's current job")
    s.add_argument("drone")
    s = sub.add_parser("jobs", help="finished jobs and how they ended")
    s.add_argument("--drone"); s.add_argument("-n", type=int, default=10)
    s = sub.add_parser("log", help="command log")
    s.add_argument("--drone"); s.add_argument("-n", type=int, default=20)
    for p in sub.choices.values():
        if p.prog.split()[-1] in ("takeoff", "goto", "land", "home", "patrol"):
            p.add_argument("--no-wait", action="store_true")

    a = ap.parse_args(argv)
    try:
        c = Client()
        if a.cmd == "drones":
            ds = fleet(c)
            print(json.dumps(ds, indent=2) if a.json else "\n".join(_row(d) for d in ds) or "no drones")
        elif a.cmd == "status":
            d = Drone(a.drone, c).state()
            print(json.dumps(d, indent=2) if a.json else _row(d))
        elif a.cmd == "me":
            m = c.request("GET", "/api/v1/me")
            print(f"{m['operator']} ({m.get('role', '?')})")
        elif a.cmd == "operators":
            if a.action != "list" and not a.name:
                ap.error(f"operators {a.action} needs a name")
            if a.action == "list":
                for o in c.request("GET", "/api/v1/operators"):
                    src = {"account": f"added by {o.get('by')}", "file": "tokens file"}.get(o["source"], f"plugin {o.get('plugin')}")
                    print(f"{o['name']:<12} {o['role']:<7} {src}")
            elif a.action == "add":
                r = c.request("POST", "/api/v1/operators", {"name": a.name, "role": a.role})
                print(f"added {r['name']} ({r['role']})\ntoken (shown once; give it to them privately): {r['token']}")
            elif a.action == "role":
                if a.new_role not in ("admin", "pilot", "viewer"):
                    ap.error("operators role NAME admin|pilot|viewer")
                r = c.request("PATCH", f"/api/v1/operators/{a.name}", {"role": a.new_role})
                print(f"{r['name']} is now {r['role']}")
            elif a.action == "token":
                r = c.request("POST", f"/api/v1/operators/{a.name}/token")
                print(f"new token for {r['name']} (the old one no longer works): {r['token']}")
            else:
                c.request("DELETE", f"/api/v1/operators/{a.name}")
                print(f"removed {a.name}")
        elif a.cmd == "plugins" and a.action == "install":
            if not a.what:
                ap.error("plugins install needs a manifest file")
            r = c.request("POST", "/api/v1/plugins" + ("?rotate_token=true" if a.rotate_token else ""),
                          json.loads(open(a.what).read()))
            p = r["plugin"]
            print(f"{'installed' if r['created'] else 'updated'} {p['id']} ({p['name']}), flies as {p['operator']}"
                  + ("" if r["reachable"] else "; its service isn't answering yet"))
            if r.get("token"):
                print(f"token (shown once; put it in the plugin's config): {r['token']}")
        elif a.cmd == "plugins" and a.action == "remove":
            if not a.what:
                ap.error("plugins remove needs a plugin id")
            c.request("DELETE", f"/api/v1/plugins/{a.what}")
            print(f"removed {a.what}")
        elif a.cmd == "plugins":
            for p in c.request("GET", "/api/v1/plugins"):
                print(f"{p['id']:<10} {p.get('name', ''):<12} {p.get('version') or '':<7} {p.get('source') or '':<9} "
                      f"{p.get('description') or ''}")
        elif a.cmd == "jobs":
            q = f"?limit={a.n}" + (f"&drone={a.drone}" if a.drone else "")
            for j in c.request("GET", "/api/v1/jobs" + q):
                print(f"{j['ended']}  {j['drone']:<8} {j['plugin']:<9} {j['result']:<10} by {j['operator']:<8} {j.get('reason','')}")
        elif a.cmd == "log":
            q = f"?limit={a.n}" + (f"&drone={a.drone}" if a.drone else "")
            for e in reversed(c.request("GET", "/api/v1/log" + q)):
                args = " " + json.dumps(e["args"]) if e.get("args") else ""
                print(f"{e['time']}  {e['operator']:<8} {e.get('drone') or '':<8} {e['command']}{args}  "
                      f"{'ok' if e['ok'] else 'FAILED'}  {e.get('message','')}")
        else:
            d = Drone(a.drone, c)
            wait = not getattr(a, "no_wait", False)
            if a.cmd == "takeoff":
                d.takeoff(a.alt, wait=wait)
            elif a.cmd == "goto":
                d.goto(a.north, a.east, a.alt, a.heading, wait=wait, speed=a.speed)
            elif a.cmd == "hold":
                print(d.hold())
            elif a.cmd == "orbit":
                print(d.orbit(a.north, a.east, a.radius, a.speed, a.alt, clockwise=not a.ccw))
            elif a.cmd == "patrol":
                route = None if a.route == "map" else _points(a.route)
                j = d.patrol(route, a.alt, a.loops, a.hold, wait=wait, speed=a.speed)
                if wait and j:
                    print(f"patrol {j['result']}: {j.get('reason', '')}")
                elif j:
                    print(f"patrol job {j['id']} started: {j.get('text', '')}")
            elif a.cmd == "dispatch":
                j = d.dispatch(a.incident, a.alt)
                print(f"dispatch job {j['id']} started: {j.get('text', '')}")
            elif a.cmd == "start":
                args = {}
                for kv in a.args:
                    k, _, v = kv.partition("=")
                    try:
                        args[k] = float(v) if "." in v or v.lstrip("-").isdigit() else v
                    except ValueError:
                        args[k] = v
                j = c.request("POST", f"/api/v1/drones/{a.drone}/job", {"plugin": a.plugin, "args": args}, timeout=200)   # may wait for a takeoff
                print(f"{a.plugin} job {j['id']} started: {j.get('text', '')}")
            elif a.cmd == "job":
                j = d.job()
                print(f"{a.drone}: no job" if not j else f"{a.drone}: {j['plugin']} job since {j['started']} by {j['operator']}  {j.get('text', '')}")
                return
            elif a.cmd == "route":
                if a.points:
                    d.set_route([] if a.points == "clear" else _points(a.points))
                r = d.route()
                pts = " ".join(f"{n:g},{e:g}" for n, e in r["points"])
                print(f"{a.drone} route: {len(r['points'])} points  {pts or '(none)'}"
                      + (f"  (by {r['operator']} {r['updated']})" if r.get("operator") else ""))
                return
            elif a.cmd == "land":
                d.land(wait=wait)
            elif a.cmd == "home":
                d.return_home(wait=wait)
            elif a.cmd == "arm":
                d.arm()
            elif a.cmd == "disarm":
                d.disarm()
            elif a.cmd == "kill":
                if not a.yes:
                    sys.exit("kill cuts the motors and the drone falls. Re-run with --yes to confirm.")
                d.kill()
            elif a.cmd == "control":
                d.take_control(a.force) if a.action == "take" else d.release_control()
            print(_row(d.state()))
    except DroneError as e:
        sys.exit(f"error: {e}")
    except KeyboardInterrupt:
        sys.exit("interrupted (the drone keeps its last command)")


if __name__ == "__main__":
    main()
