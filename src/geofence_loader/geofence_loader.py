#!/usr/bin/env python3
"""DroneOS geofence loader: ROS 2 /<drone>/geofence -> PX4 fence via the MAVLink mission protocol.

drone_core talks to PX4 over uXRCE-DDS only, and PX4 has no uORB/DDS input for fence points: the navigator reads
them from dataman, which only the MAVLink mission manager (mission_type FENCE) and etc/geofence.txt write.
So this node opens a MAVLink link to the vehicle just for the fence + two GF_* params.

In : /<drone>/geofence (std_msgs/String, transient_local) JSON
       {"fence": {"inclusion": [[lat, lon], ...], "exclusions": [[[lat, lon], ...], ...], "max_altitude_m": 60}
                 | null, "hash": "..."}
Out: /<drone>/geofence_status (std_msgs/String, transient_local) JSON {"hash": h, "error": null | "...", "points": N}
     after every attempt and every STATUS_PERIOD s. "hash" is the hash PX4 verifiably holds (read back) or null.

PX4 references (PX4-Autopilot v1.15, src/modules/mavlink/mavlink_mission.cpp):
  - FENCE upload/download/clear: MISSION_COUNT / MISSION_REQUEST_INT / MISSION_ITEM_INT / MISSION_ACK with
    mission_type = MAV_MISSION_TYPE_FENCE (:742, :940-968, :1174-1200), MISSION_CLEAR_ALL (:1306-1340)
  - polygon vertices: MAV_CMD_NAV_FENCE_POLYGON_VERTEX_INCLUSION / _EXCLUSION, param1 = vertex count, >= 3
    (:1498-1501, :1181-1188); lat/lon int32 deg*1e7 (MISSION_ITEM_INT)
  - at most DM_KEY_FENCE_POINTS_MAX items (src/modules/dataman/dataman.h:85 = 64; 16 on MEMORY_CONSTRAINED boards :74)
  - navigator reloads the fence when the fence CRC changes (navigator_main.cpp:204-206), rejects a DO_REPOSITION
    outside it (navigator_main.cpp:405, commander still ACKs it), and runs GF_ACTION on a breach (:906-1000)
  - polygon altitude is not used by PX4; the ceiling is GF_MAX_VER_DIST above home (geofence.cpp:368-375)
Fence coordinates are kept in memory only (private); logs show the hash and point counts, never coordinates.

  geofence_loader.py --drone drone1 --mavlink udpout:127.0.0.1:14580 --sysid 1
  SITL: instance i -> udpout:127.0.0.1:(14580+i) (px4-rc.mavlink:4, onboard link), sysid i+1.
"""
import argparse, json, threading, time
from pymavlink import mavutil
import rclpy
from rclpy.node import Node
from rclpy.qos import QoSProfile, DurabilityPolicy, ReliabilityPolicy, HistoryPolicy
from std_msgs.msg import String

M = mavutil.mavlink
FENCE = M.MAV_MISSION_TYPE_FENCE
INC, EXC = M.MAV_CMD_NAV_FENCE_POLYGON_VERTEX_INCLUSION, M.MAV_CMD_NAV_FENCE_POLYGON_VERTEX_EXCLUSION
MAX_ITEMS = 64
VER_DEFAULT = 120.0
STATUS_PERIOD = 10.0
VERIFY_PERIOD = 30.0          # re-read PX4's fence; re-upload if it changed (e.g. PX4 restarted with a fresh dataman)


class FenceError(Exception):
    pass


class Px4Link:
    def __init__(self, url, sysid, log):
        self.url, self.sysid, self.log = url, sysid, log
        self.m = None
        self.lock = threading.Lock()

    def connect(self):
        if self.m is None:
            self.m = mavutil.mavlink_connection(self.url, source_system=245, source_component=190)
        self.m.mav.heartbeat_send(M.MAV_TYPE_ONBOARD_CONTROLLER, M.MAV_AUTOPILOT_INVALID, 0, 0, 0)
        hb = self.m.recv_match(type='HEARTBEAT', blocking=True, timeout=5,
                               condition=f'HEARTBEAT.get_srcSystem() == {self.sysid}')
        if hb is None:
            raise FenceError(f'no heartbeat from sysid {self.sysid} on {self.url}')

    def _recv(self, types, timeout):
        end = time.time() + timeout
        while time.time() < end:
            msg = self.m.recv_match(type=types, blocking=True, timeout=max(0.05, end - time.time()))
            if msg is not None and msg.get_srcSystem() == self.sysid:
                return msg
        return None

    def upload(self, items):
        n = len(items)
        for attempt in range(3):
            self.m.mav.mission_count_send(self.sysid, 1, n, FENCE)
            sent, deadline = set(), time.time() + 10 + n
            while time.time() < deadline:
                msg = self._recv(['MISSION_REQUEST_INT', 'MISSION_REQUEST', 'MISSION_ACK'], 2.0)
                if msg is None:
                    break
                if msg.get_type() == 'MISSION_ACK':
                    if getattr(msg, 'mission_type', FENCE) != FENCE:
                        continue
                    if msg.type == M.MAV_MISSION_ACCEPTED and len(sent) == n:
                        return
                    raise FenceError(f'PX4 refused the fence: {mavutil.mavlink.enums["MAV_MISSION_RESULT"][msg.type].name}')
                s = msg.seq
                if s >= n:
                    raise FenceError(f'PX4 asked for item {s} of {n}')
                cmd, lat, lon, cnt = items[s]
                self.m.mav.mission_item_int_send(self.sysid, 1, s, M.MAV_FRAME_GLOBAL, cmd, 0, 1, float(cnt), 0, 0, 0,
                                                 int(round(lat * 1e7)), int(round(lon * 1e7)), 0.0, FENCE)
                sent.add(s)
            self.log.warn(f'fence upload attempt {attempt + 1} timed out')
        raise FenceError('fence upload timed out (no MISSION_ACK)')

    def download(self):
        for attempt in range(3):
            self.m.mav.mission_request_list_send(self.sysid, 1, FENCE)
            c = self._recv(['MISSION_COUNT'], 3.0)
            if c is None or getattr(c, 'mission_type', FENCE) != FENCE:
                continue
            out = []
            for s in range(c.count):
                it = None
                for _ in range(3):
                    self.m.mav.mission_request_int_send(self.sysid, 1, s, FENCE)
                    it = self._recv(['MISSION_ITEM_INT'], 2.0)
                    if it is not None and it.seq == s:
                        break
                    it = None
                if it is None:
                    raise FenceError(f'fence read-back: no item {s}')
                out.append((it.command, it.x / 1e7, it.y / 1e7, int(round(it.param1))))
            self.m.mav.mission_ack_send(self.sysid, 1, M.MAV_MISSION_ACCEPTED, FENCE)
            return out
        raise FenceError('fence read-back timed out (no MISSION_COUNT)')

    def clear(self):
        for _ in range(3):
            self.m.mav.mission_clear_all_send(self.sysid, 1, FENCE)
            a = self._recv(['MISSION_ACK'], 3.0)
            if a is not None and a.type == M.MAV_MISSION_ACCEPTED:
                return
        raise FenceError('fence clear not acknowledged')

    def set_param(self, name, value):
        for _ in range(3):
            self.m.mav.param_set_send(self.sysid, 1, name.encode(), float(value), M.MAV_PARAM_TYPE_REAL32)
            end = time.time() + 3
            while time.time() < end:
                p = self._recv(['PARAM_VALUE'], end - time.time())
                if p is not None and p.param_id == name and abs(p.param_value - value) < 1e-3:
                    return
        raise FenceError(f'could not set {name}')


def to_items(fence):
    inc = fence.get('inclusion') or []
    exc = fence.get('exclusions') or []
    polys = [(INC, inc)] + [(EXC, p) for p in exc]
    items = []
    for cmd, poly in polys:
        if len(poly) >= 2 and list(poly[0]) == list(poly[-1]):
            poly = poly[:-1]                          # closed ring -> PX4 closes it itself
        if len(poly) < 3:
            raise FenceError(f'polygon with {len(poly)} vertices (PX4 needs >= 3)')
        for lat, lon in poly:
            if not (-90 <= lat <= 90 and -180 <= lon <= 180):
                raise FenceError('vertex out of range')
            items.append((cmd, float(lat), float(lon), len(poly)))
    if not inc:
        raise FenceError('no inclusion polygon')
    if len(items) > MAX_ITEMS:
        raise FenceError(f'{len(items)} vertices > {MAX_ITEMS} (PX4 dataman DM_KEY_FENCE_POINTS_MAX)')
    return items


def same(a, b):
    return len(a) == len(b) and all(x[0] == y[0] and x[3] == y[3] and abs(x[1] - y[1]) < 2e-7 and abs(x[2] - y[2]) < 2e-7
                                    for x, y in zip(a, b))


class Loader(Node):
    def __init__(self, a):
        super().__init__(f'geofence_loader_{a.drone}')
        self.drone = a.drone
        self.link = Px4Link(a.mavlink, a.sysid, self.get_logger())
        qos = QoSProfile(depth=1, history=HistoryPolicy.KEEP_LAST, reliability=ReliabilityPolicy.RELIABLE,
                         durability=DurabilityPolicy.TRANSIENT_LOCAL)
        self.pub = self.create_publisher(String, f'/{a.drone}/geofence_status', qos)
        self.create_subscription(String, f'/{a.drone}/geofence', self.on_fence, qos)
        self.want = None              # (hash, items | None, max_alt)
        self.status = {'hash': None, 'error': None, 'points': 0}
        self.loaded_items = None
        self.cv = threading.Condition()
        self.dirty = False
        threading.Thread(target=self.worker, daemon=True).start()
        self.create_timer(STATUS_PERIOD, self.publish)
        self.get_logger().info(f'{a.drone}: MAVLink {a.mavlink} sysid {a.sysid}')

    def publish(self):
        self.pub.publish(String(data=json.dumps(self.status)))

    def on_fence(self, msg):
        try:
            d = json.loads(msg.data)
            h = str(d.get('hash'))
            f = d.get('fence')
            want = (h, None, VER_DEFAULT) if f is None else (h, to_items(f), float(f.get('max_altitude_m') or 0))
            if want[1] is not None and not (0 < want[2] <= 10000):
                raise FenceError('max_altitude_m must be > 0')
        except (ValueError, TypeError, KeyError, FenceError) as e:
            self.status = {'hash': self.status['hash'], 'error': f'bad /geofence message: {e}', 'points': self.status['points']}
            self.get_logger().error(self.status['error'])
            self.publish()
            return
        with self.cv:
            self.want, self.dirty = want, True
            self.cv.notify()

    def apply(self, want):
        h, items, alt = want
        self.link.connect()
        if items is None:
            self.link.clear()
            back = self.link.download()
            if back:
                raise FenceError(f'fence still has {len(back)} items after clear')
            self.link.set_param('GF_MAX_VER_DIST', VER_DEFAULT)
        else:
            self.link.upload(items)
            back = self.link.download()
            if not same(items, back):
                raise FenceError(f'read-back mismatch ({len(back)} items vs {len(items)} sent)')
            self.link.set_param('GF_MAX_VER_DIST', alt)
        self.loaded_items = back
        return len(back)

    def worker(self):
        last_verify = 0.0
        while rclpy.ok():
            with self.cv:
                self.cv.wait(timeout=5.0)
                want, dirty = self.want, self.dirty
                self.dirty = False
            if want is None:
                continue
            if not dirty and time.time() - last_verify > VERIFY_PERIOD and self.status['hash'] == want[0]:
                last_verify = time.time()
                try:
                    with self.link.lock:
                        self.link.connect()
                        back = self.link.download()
                    if same(back, self.loaded_items or []):
                        continue
                    self.get_logger().warn('PX4 fence differs from the loaded one (PX4 restart?): re-applying')
                except FenceError as e:
                    self.get_logger().warn(f'verify failed: {e}')
                    continue
            elif not dirty and self.status['hash'] == want[0]:
                continue
            elif not dirty and self.status['error'] and time.time() - last_verify < 15:
                continue                                  # retry failed attempts every ~15 s
            last_verify = time.time()
            try:
                with self.link.lock:
                    n = self.apply(want)
                self.status = {'hash': want[0], 'error': None, 'points': n}
                self.get_logger().info(f'{self.drone}: fence {want[0]} loaded and verified, {n} points'
                                       + ('' if want[1] is None else f', GF_MAX_VER_DIST {want[2]:g}'))
            except FenceError as e:
                self.status = {'hash': None, 'error': str(e), 'points': 0}
                self.get_logger().error(f'{self.drone}: fence {want[0]}: {e}')
            except Exception as e:                        # socket errors etc.
                self.status = {'hash': None, 'error': f'{type(e).__name__}: {e}', 'points': 0}
                self.get_logger().error(f'{self.drone}: fence {want[0]}: {self.status["error"]}')
            self.publish()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--drone', required=True)
    ap.add_argument('--mavlink', required=True)
    ap.add_argument('--sysid', type=int, required=True)
    a, ros_args = ap.parse_known_args()
    rclpy.init(args=ros_args)
    rclpy.spin(Loader(a))


if __name__ == '__main__':
    main()
