#!/usr/bin/env python3
"""Move the "walker" person model along a closed loop near drone1's home (baylands) at a constant speed.

Fuel person models are static meshes, so the walker glides: this calls /world/<world>/set_pose at ~20 Hz (wall time)
with the position computed from *sim* time (/world/<world>/clock), so the speed is 1.2 m/s in sim time whatever the
real-time factor. Yaw follows the direction of travel (+ YAW_OFFSET for the mesh's forward axis).
Runs forever as the user unit sim-walker.service; while the world or the model is missing (sim restart) it waits
and retries, so it picks the walker up again after sim_up respawns it (~/sim/spawn_targets.sh).

Env: WALKER_WORLD (baylands), WALKER_LOOP_NE (JSON [[n,e],..]), WALKER_HOME_GZ ("x,y"), WALKER_MODEL (walker), WALKER_SPEED (1.2), WALKER_HZ (20), WALKER_YAW_OFFSET (rad, 0).
"""
import math, os, sys, time
os.environ.setdefault("PROTOCOL_BUFFERS_PYTHON_IMPLEMENTATION", "python")   # gz msgs10 vs pip protobuf 4.x
from gz.transport13 import Node, SubscribeOptions
from gz.msgs10.pose_pb2 import Pose
from gz.msgs10.boolean_pb2 import Boolean
from gz.msgs10.clock_pb2 import Clock

WORLD = os.environ.get("WALKER_WORLD", "baylands")
MODEL = os.environ.get("WALKER_MODEL", "walker")
SPEED = float(os.environ.get("WALKER_SPEED", "1.2"))
HZ = float(os.environ.get("WALKER_HZ", "20"))
YAW_OFFSET = float(os.environ.get("WALKER_YAW_OFFSET", "0"))
Z = -0.1                       # same ground height as the static targets (spawn_targets.sh)
# drone1 home in gz ENU (baylands: x = 0.98 + E, y = 0.01 + N); WALKER_HOME_GZ="x,y" for other worlds
HOME_GZ = tuple(float(v) for v in os.environ.get("WALKER_HOME_GZ", "0.98,0.01").split(","))
# Loop corners, N/E metres from drone1 home: ~29 m along heading 227, open ground (config/sim/walker/README.md)
LOOP_NE = [(-12.0, -18.0), (-28.0, -18.0), (-28.0, -24.0), (-12.0, -24.0)]
if os.environ.get("WALKER_LOOP_NE"):   # JSON [[n, e], ...], set per world by sim_up
    import json
    LOOP_NE = [tuple(map(float, p)) for p in json.loads(os.environ["WALKER_LOOP_NE"])]

PTS = [(HOME_GZ[0] + e, HOME_GZ[1] + n) for n, e in LOOP_NE]
SEGS = []
for i in range(len(PTS)):
    (x0, y0), (x1, y1) = PTS[i], PTS[(i + 1) % len(PTS)]
    SEGS.append((x0, y0, x1, y1, math.hypot(x1 - x0, y1 - y0), math.atan2(y1 - y0, x1 - x0)))
PERIM = sum(s[4] for s in SEGS)


def at(dist):
    d = dist % PERIM
    for x0, y0, x1, y1, L, yaw in SEGS:
        if d <= L:
            u = d / L
            return x0 + u * (x1 - x0), y0 + u * (y1 - y0), yaw
        d -= L
    x0, y0, _, _, _, yaw = SEGS[0]
    return x0, y0, yaw


# /world/<w>/clock is published every physics step (~250 Hz). Unthrottled, the pure-python protobuf callbacks fall
# behind (measured: 2 s of sim time seen in 21 s wall) and starve the set_pose replies, so the walker stalled and
# jumped. Take it at 10 Hz and extrapolate between ticks with the last measured rate (sim s per wall s).
clk = {"sim": None, "wall": None, "rate": 1.0}
def on_clock(msg):
    s, w = msg.sim.sec + msg.sim.nsec * 1e-9, time.monotonic()
    if clk["sim"] is not None and w > clk["wall"] and s >= clk["sim"]:
        clk["rate"] = 0.8 * clk["rate"] + 0.2 * min(2.0, (s - clk["sim"]) / (w - clk["wall"]))
    elif clk["sim"] is not None and s < clk["sim"]:
        clk["rate"] = 1.0           # world restarted
    clk["sim"], clk["wall"] = s, w

def sim_now():
    if clk["sim"] is None or time.monotonic() - clk["wall"] > 2.0:   # no clock for 2 s: world gone/paused
        return None
    return clk["sim"] + clk["rate"] * (time.monotonic() - clk["wall"])

node = Node()
opts = SubscribeOptions()
opts.msgs_per_sec = 10
node.subscribe(Clock, f"/world/{WORLD}/clock", on_clock, opts)
sim_t = [None]
svc = f"/world/{WORLD}/set_pose"
print(f"walker_mover: {MODEL} in {WORLD}, loop {LOOP_NE} (N/E), perimeter {PERIM:.1f} m, {SPEED} m/s, {HZ} Hz",
      flush=True)
period, ok_state, last_log, fails, n_fail = 1.0 / HZ, None, 0.0, 0, 0
while True:
    t0 = time.monotonic()
    ok = False
    sim_t[0] = sim_now()
    if sim_t[0] is not None:
        x, y, yaw = at(sim_t[0] * SPEED)
        req = Pose()
        req.name = MODEL
        req.position.x, req.position.y, req.position.z = x, y, Z
        h = (yaw + YAW_OFFSET) / 2
        req.orientation.z, req.orientation.w = math.sin(h), math.cos(h)
        try:
            res, rep = node.request(svc, req, Pose, Boolean, 500)
            ok = bool(res and rep.data)
        except Exception as e:      # world gone during a restart
            ok = False
    # A single set_pose can time out under load (~0.5 % of calls); only >= 20 failures in a row (1 s) mean the
    # world/model is gone. Until then keep the 20 Hz rate so the walker doesn't stall for a second.
    fails = 0 if ok else fails + 1
    n_fail += not ok
    up = fails < 20
    if up != ok_state or (not up and time.monotonic() - last_log > 30):
        print(f"walker_mover: {'moving' if up else 'waiting for world/model'} (sim t={sim_t[0]}, "
              f"failed calls so far {n_fail})", flush=True)
        ok_state, last_log = up, time.monotonic()
    time.sleep(max(0.0, period - (time.monotonic() - t0)) if up else 1.0)
