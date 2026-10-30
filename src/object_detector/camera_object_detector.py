#!/usr/bin/env python3
"""DroneOS camera object detector.

Subscribes to /<drone>/camera (sensor_msgs/Image, rgb8), runs SSD MobileNet v2 (COCO) with tflite-runtime
(Edge TPU delegate when a Coral + libedgetpu are present, CPU otherwise) and publishes:
  /<drone>/detections        std_msgs/String JSON (<= 5 Hz, ~1 KB, no NaN):
      {"stamp", "model", "fps", "infer_ms", "objects": [{"label", "score", "box": [x1, y1, x2, y2]}]}
      box is normalized to the FULL camera frame (0..1, x right, y down).
  /<drone>/detected_objects  visualization_msgs/MarkerArray (one TEXT marker per object, image coordinates)
No annotated image is published.

Tiling: the model input is 300x300. Shrinking a 640x480 frame to 300x300 makes distant people a few pixels
tall, so besides the whole (shrunk) frame the lower part of the frame (where the ground is for a forward
camera) is cut into native-resolution 300x300 tiles. Detections from all passes are merged with NMS.
"""
import json
import math
import os
import threading
import time

import numpy as np
import rclpy
from rclpy.node import Node
from rclpy.qos import QoSProfile, ReliabilityPolicy, HistoryPolicy
from sensor_msgs.msg import Image as ImageMsg
from std_msgs.msg import String
from visualization_msgs.msg import Marker, MarkerArray

try:  # drone_core state for the pose at frame time (needs the ws install sourced)
    from drone_interfaces.msg import DroneState
except ImportError:
    DroneState = None

try:
    from tflite_runtime.interpreter import Interpreter, load_delegate
except ImportError:  # full TensorFlow as a fallback
    from tensorflow.lite.python.interpreter import Interpreter, load_delegate

EDGETPU_LIB = 'libedgetpu.so.1'


def make_interpreter(edgetpu_model, cpu_model, threads, use_edgetpu):
    """Edge TPU model + delegate when possible, else the CPU model. Returns (interpreter, model_file, backend)."""
    if use_edgetpu and os.path.exists(edgetpu_model):
        try:
            it = Interpreter(model_path=edgetpu_model, experimental_delegates=[load_delegate(EDGETPU_LIB)])
            return it, os.path.basename(edgetpu_model), 'edgetpu'
        except (ValueError, OSError, RuntimeError) as e:
            print(f'Edge TPU not available ({e}); using CPU', flush=True)
    return Interpreter(model_path=cpu_model, num_threads=threads), os.path.basename(cpu_model), 'cpu'


def resize_nearest(img, w, h):
    ys = (np.arange(h) * (img.shape[0] / h)).astype(np.int32)
    xs = (np.arange(w) * (img.shape[1] / w)).astype(np.int32)
    return img[ys][:, xs]


def overlap(a, b):
    """max(IoU, intersection / smaller area): also catches a small box inside or mostly inside a bigger one."""
    ix = max(0.0, min(a[2], b[2]) - max(a[0], b[0]))
    iy = max(0.0, min(a[3], b[3]) - max(a[1], b[1]))
    inter = ix * iy
    aa = (a[2] - a[0]) * (a[3] - a[1])
    ab = (b[2] - b[0]) * (b[3] - b[1])
    ua = aa + ab - inter
    small = min(aa, ab)
    return max(inter / ua if ua > 0 else 0.0, inter / small if small > 0 else 0.0)


class CameraObjectDetector(Node):
    def __init__(self):
        super().__init__('object_detector')
        self.declare_parameter('drone_name', 'drone1')
        self.declare_parameter('camera_topic', '')                   # default /<drone>/camera
        self.declare_parameter('model_cpu', '/workspace/models/ssd_mobilenet_v2_coco_quant_postprocess.tflite')
        self.declare_parameter('model_edgetpu', '/workspace/models/ssd_mobilenet_v2_coco_quant_postprocess_edgetpu.tflite')
        self.declare_parameter('labels_path', '/workspace/models/coco_labels.txt')
        self.declare_parameter('use_edgetpu', True)
        self.declare_parameter('threads', 2)                         # CPU threads (sim shares the CPU with PX4/Gazebo)
        self.declare_parameter('threshold', 0.6)
        self.declare_parameter('labels_allowed', ['person', 'car', 'truck', 'bus', 'bicycle', 'motorcycle'])  # [] = all
        self.declare_parameter('max_box_area', 0.10)                 # drop boxes larger than this fraction of the frame
        self.declare_parameter('max_infer_hz', 5.0)                  # 0 = as fast as possible
        self.declare_parameter('publish_hz', 5.0)                    # hard cap 5 Hz
        self.declare_parameter('tiles', True)
        self.declare_parameter('tile_top', 0.2)                      # tiles cover the frame below this fraction
        self.declare_parameter('tile_bottom', 1.0)                   # ... and above this fraction
        self.declare_parameter('tile_size', 150)                     # px square, resized to the model input (300 = native)
        self.declare_parameter('whole_frame', True)                 # extra pass on the whole frame shrunk to the input
        self.declare_parameter('max_objects', 10)
        # camera mount, reported in the JSON (sim: x500_mono_cam with the 45 deg down mount, mono_cam HFOV 1.74 rad)
        self.declare_parameter('camera_pitch_deg', 45.0)             # positive = down
        self.declare_parameter('camera_hfov_deg', 99.7)
        self.declare_parameter('pose_max_age', 0.15)                 # s; pose omitted if the nearest state is older

        g = lambda n: self.get_parameter(n).value
        self.drone = g('drone_name')
        cam = g('camera_topic') or f'/{self.drone}/camera'
        self.threshold = float(g('threshold'))
        self.tiles_on = bool(g('tiles'))
        self.tile_top = float(g('tile_top'))
        self.tile_size = int(g('tile_size'))
        self.tile_bottom = float(g('tile_bottom'))
        self.frame_wh = (640, 480)
        self.whole_frame = bool(g('whole_frame'))
        self.max_objects = int(g('max_objects'))
        self.allowed = set(g('labels_allowed') or [])
        self.cam_pitch = float(g('camera_pitch_deg'))
        self.cam_hfov = float(g('camera_hfov_deg'))
        self.pose_max_age = float(g('pose_max_age'))
        self.states = []           # [(monotonic receive time, pose dict)], last ~1 s
        self.max_box_area = float(g('max_box_area'))
        mih = float(g('max_infer_hz'))
        self.min_infer_dt = 1.0 / mih if mih > 0 else 0.0
        self.publish_dt = 1.0 / min(5.0, max(0.1, float(g('publish_hz'))))

        self.interp, self.model_name, self.backend = make_interpreter(
            g('model_edgetpu'), g('model_cpu'), int(g('threads')), bool(g('use_edgetpu')))
        self.interp.allocate_tensors()
        inp = self.interp.get_input_details()[0]
        self.in_index = inp['index']
        self.in_h, self.in_w = int(inp['shape'][1]), int(inp['shape'][2])
        self.out_boxes, self.out_classes, self.out_scores, self.out_count, how = self.detection_outputs()
        self.get_logger().info(f'model input {self.in_w}x{self.in_h}, outputs from {how}: boxes={self.out_boxes} '
                               f'classes={self.out_classes} scores={self.out_scores} count={self.out_count}')
        with open(g('labels_path')) as f:
            self.labels = [l.strip() for l in f]

        self.lock = threading.Lock()
        self.frame = None          # (stamp, np.ndarray HxWx3 uint8)
        self.frame_seq = 0
        self.latest = None         # dict for /detections
        self.infer_times = []      # recent full-frame (all passes) inference times, s
        self.done_times = []       # recent completion times, for achieved fps

        qos = QoSProfile(reliability=ReliabilityPolicy.BEST_EFFORT, history=HistoryPolicy.KEEP_LAST, depth=1)
        self.create_subscription(ImageMsg, cam, self.on_image, qos)
        if DroneState is not None:
            self.create_subscription(DroneState, f'/{self.drone}/drone_state', self.on_state, qos)
        else:
            self.get_logger().warn('drone_interfaces not found: no pose in /detections')
        self.det_pub = self.create_publisher(String, f'/{self.drone}/detections', 10)
        self.marker_pub = self.create_publisher(MarkerArray, f'/{self.drone}/detected_objects', 10)
        self.create_timer(self.publish_dt, self.publish)
        self.create_timer(10.0, self.log_stats)
        self.worker = threading.Thread(target=self.run, daemon=True)
        self.worker.start()
        self.get_logger().info(f'{self.drone}: {cam} -> /{self.drone}/detections, model {self.model_name} '
                               f'({self.backend}), tiles={self.tiles_on}, threshold={self.threshold}')

    def detection_outputs(self):
        """Tensor indices (boxes, classes, scores, count) of a detection model, following pycoral
        adapters/detect.py get_objects(): models with a signature (TF2 / Model Maker exports such as
        EfficientDet-Lite) name them output_0 = count, output_1 = scores, output_2 = classes,
        output_3 = boxes; otherwise (TF1 TFLite_Detection_PostProcess, e.g. SSD MobileNet) use output order
        boxes, classes, scores, count. Output names are not reliable (EfficientDet: StatefulPartitionedCall:N)."""
        try:
            sigs = self.interp._get_full_signature_list()  # pylint: disable=protected-access
        except Exception:
            sigs = None
        if sigs and len(sigs) == 1:
            outs = next(iter(sigs.values())).get('outputs', {})
            if all(f'output_{i}' in outs for i in range(4)):
                return outs['output_3'], outs['output_2'], outs['output_1'], outs['output_0'], 'signature'
        od = sorted(self.interp.get_output_details(), key=lambda d: d['index'])
        if len(od) >= 4 and int(np.prod(od[3]['shape'])) == 1:
            return od[0]['index'], od[1]['index'], od[2]['index'], od[3]['index'], 'output order'
        raise RuntimeError('unsupported detection model outputs: ' + str([(d['name'], d['shape']) for d in od]))

    def on_state(self, msg):
        if not (msg.position_valid and all(math.isfinite(v) for v in (msg.local_x, msg.local_y, msg.local_z, msg.local_yaw))):
            return
        now = time.monotonic()
        pose = {'north': round(float(msg.local_x), 2), 'east': round(float(msg.local_y), 2),
                'alt': round(float(-msg.local_z), 2),                       # metres above the local origin (home)
                'heading_deg': round(math.degrees(float(msg.local_yaw)) % 360.0, 1)}
        # attitude from the same DroneState sample (drone_core vehicle_attitude, ZYX Euler of FRD->NED):
        # roll_deg + = right side down, pitch_deg + = nose up. Omitted (never NaN) until drone_core has a sample.
        for k in ('roll_deg', 'pitch_deg'):
            v = float(getattr(msg, k, float('nan')))
            if math.isfinite(v):
                pose[k] = round(v, 1)
        with self.lock:
            self.states = [s for s in self.states if now - s[0] <= 1.0] + [(now, pose)]

    def pose_at(self, t):
        """drone_core state (10 Hz) received closest to the image receive time t, if within pose_max_age."""
        with self.lock:
            if not self.states:
                return None
            ts, pose = min(self.states, key=lambda s: abs(s[0] - t))
        return dict(pose, age_ms=round(1000.0 * abs(ts - t))) if abs(ts - t) <= self.pose_max_age else None

    def on_image(self, msg):
        if msg.encoding not in ('rgb8', 'bgr8'):
            self.get_logger().warn(f'unsupported encoding {msg.encoding}', throttle_duration_sec=10.0)
            return
        img = np.frombuffer(msg.data, dtype=np.uint8).reshape(msg.height, msg.step)[:, :msg.width * 3]
        img = img.reshape(msg.height, msg.width, 3)
        if msg.encoding == 'bgr8':
            img = img[:, :, ::-1]
        with self.lock:
            self.frame = (msg.header.stamp.sec + msg.header.stamp.nanosec * 1e-9, img, time.monotonic())
            self.frame_seq += 1

    def windows(self, w, h):
        """(x0, y0, x1, y1) source windows in pixels: a grid of tile_size squares (evenly spread, slightly
        overlapping) over the frame below tile_top, each resized to the model input (200 px -> 300 = 1.5x
        upscale for small objects); plus the whole frame if whole_frame or tiling is off."""
        wins = []
        t = self.tile_size if self.tile_size > 0 else self.in_w
        bot = max(t, min(h, int(round(self.tile_bottom * h))))
        top = max(0, min(bot - t, int(self.tile_top * h)))
        if self.tiles_on and w >= t and bot - top >= t:
            nx = math.ceil(w / t)
            ny = math.ceil((bot - top) / t)
            for j in range(ny):
                y0 = top if ny == 1 else top + round(j * (bot - top - t) / (ny - 1))
                for i in range(nx):
                    x0 = 0 if nx == 1 else round(i * (w - t) / (nx - 1))
                    wins.append((x0, y0, x0 + t, y0 + t))
        if self.whole_frame or not wins:
            wins.insert(0, (0, 0, w, h))
        return wins

    def infer(self, img, win):
        x0, y0, x1, y1 = win
        crop = img[y0:y1, x0:x1]
        # aspect-preserving resize into the model input, padded right/bottom (letterbox)
        s = min(self.in_w / crop.shape[1], self.in_h / crop.shape[0])
        rw, rh = min(self.in_w, round(crop.shape[1] * s)), min(self.in_h, round(crop.shape[0] * s))
        if (rw, rh) != (crop.shape[1], crop.shape[0]):
            crop = resize_nearest(crop, rw, rh)
        if (rw, rh) != (self.in_w, self.in_h):
            pad = np.zeros((self.in_h, self.in_w, 3), dtype=np.uint8)
            pad[:rh, :rw] = crop
            crop = pad
        fx, fy = self.in_w / rw, self.in_h / rh   # input-normalized -> window-normalized
        self.interp.set_tensor(self.in_index, np.ascontiguousarray(crop)[np.newaxis])
        self.interp.invoke()
        boxes = self.interp.get_tensor(self.out_boxes)[0]
        classes = self.interp.get_tensor(self.out_classes)[0]
        scores = self.interp.get_tensor(self.out_scores)[0]
        count = int(self.interp.get_tensor(self.out_count)[0])
        h, w = img.shape[:2]
        out = []
        for i in range(min(count, len(scores))):
            s = float(scores[i])
            if not (s >= self.threshold):          # also drops NaN
                continue
            ymin, xmin, ymax, xmax = [float(v) for v in boxes[i]]
            ymin, ymax, xmin, xmax = ymin * fy, ymax * fy, xmin * fx, xmax * fx
            # window-normalized -> full-frame normalized
            b = [(x0 + xmin * (x1 - x0)) / w, (y0 + ymin * (y1 - y0)) / h,
                 (x0 + xmax * (x1 - x0)) / w, (y0 + ymax * (y1 - y0)) / h]
            if not all(math.isfinite(v) for v in b):
                continue
            b = [min(1.0, max(0.0, v)) for v in b]
            c = int(classes[i])
            label = self.labels[c] if 0 <= c < len(self.labels) else str(c)
            if self.allowed and label not in self.allowed:
                continue
            if (b[2] - b[0]) * (b[3] - b[1]) > self.max_box_area:
                continue
            out.append({'label': label, 'score': s, 'box': b})
        return out

    def run(self):
        last_seq = 0
        while rclpy.ok():
            t_start = time.monotonic()
            with self.lock:
                frame, seq = self.frame, self.frame_seq
            if frame is None or seq == last_seq:
                time.sleep(0.01)
                continue
            last_seq = seq
            stamp, img, t_rx = frame
            self.frame_wh = (img.shape[1], img.shape[0])
            t0 = time.monotonic()
            dets = []
            for win in self.windows(img.shape[1], img.shape[0]):
                dets.extend(self.infer(img, win))
            dt = time.monotonic() - t0
            # NMS per label across passes (tiles overlap the whole-frame pass)
            dets.sort(key=lambda d: -d['score'])
            kept = []
            for d in dets:
                if all(k['label'] != d['label'] or overlap(k['box'], d['box']) < 0.4 for k in kept):
                    kept.append(d)
            kept = kept[:self.max_objects]
            pose = self.pose_at(t_rx)
            now = time.monotonic()
            with self.lock:
                self.infer_times = (self.infer_times + [dt])[-20:]
                self.done_times = [t for t in self.done_times + [now] if now - t <= 2.0]
                fps = (len(self.done_times) - 1) / (self.done_times[-1] - self.done_times[0]) \
                    if len(self.done_times) > 1 and self.done_times[-1] > self.done_times[0] else 0.0
                self.latest = {
                    'stamp': round(stamp, 3),
                    'model': f'{self.model_name} ({self.backend})',
                    'fps': round(fps, 1),
                    'infer_ms': round(1000.0 * sum(self.infer_times) / len(self.infer_times), 1),
                    'camera': {'pitch_deg': self.cam_pitch, 'hfov_deg': self.cam_hfov,
                               'width': int(img.shape[1]), 'height': int(img.shape[0])},
                    'objects': [{'label': d['label'], 'score': round(d['score'], 2),
                                 'box': [round(v, 4) for v in d['box']]} for d in kept],
                }
                if pose is not None:
                    self.latest['pose'] = pose
            spare = self.min_infer_dt - (time.monotonic() - t_start)
            if spare > 0:
                time.sleep(spare)

    def publish(self):
        with self.lock:
            data = self.latest
            self.latest = None
        if data is None:
            return
        self.det_pub.publish(String(data=json.dumps(data, separators=(',', ':'), allow_nan=False)))
        ma = MarkerArray()
        clear = Marker()
        clear.action = Marker.DELETEALL
        ma.markers.append(clear)
        for i, o in enumerate(data['objects']):
            m = Marker()
            m.header.frame_id = f'{self.drone}/camera'
            m.header.stamp = self.get_clock().now().to_msg()
            m.ns = 'detections'
            m.id = i
            m.type = Marker.TEXT_VIEW_FACING
            m.action = Marker.ADD
            m.pose.position.x = (o['box'][0] + o['box'][2]) / 2.0   # normalized image coordinates
            m.pose.position.y = (o['box'][1] + o['box'][3]) / 2.0
            m.pose.orientation.w = 1.0
            m.scale.z = 0.05
            m.color.r, m.color.g, m.color.b, m.color.a = 1.0, 1.0, 0.0, 1.0
            m.text = f"{o['label']} {o['score']:.2f}"
            m.lifetime.nanosec = 500_000_000
            ma.markers.append(m)
        self.marker_pub.publish(ma)

    def log_stats(self):
        with self.lock:
            n = len(self.infer_times)
            ms = 1000.0 * sum(self.infer_times) / n if n else 0.0
            fps = (len(self.done_times) - 1) / max(1e-6, self.done_times[-1] - self.done_times[0]) if len(self.done_times) > 1 else 0.0
        self.get_logger().info(f'{self.backend}: {ms:.1f} ms per frame ({len(self.windows(*self.frame_wh))} passes, {self.frame_wh[0]}x{self.frame_wh[1]}), '
                               f'achieved {fps:.1f} fps')


def main(args=None):
    rclpy.init(args=args)
    node = CameraObjectDetector()
    try:
        rclpy.spin(node)
    except KeyboardInterrupt:
        pass
    finally:
        node.destroy_node()
        if rclpy.ok():
            rclpy.shutdown()


if __name__ == '__main__':
    main()
