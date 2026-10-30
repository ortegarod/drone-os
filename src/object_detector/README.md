# object_detector

Camera object detection for DroneOS drones. One ROS 2 Humble node per drone (`camera_object_detector.py`):
it reads the drone camera, runs SSD MobileNet v2 (COCO) with `tflite_runtime`, and publishes a small JSON
message that the fleet API relays to the Command Center (boxes drawn on the camera view, people and cars
projected onto the map).

- **Edge TPU (Coral USB)** when the device and `libedgetpu.so.1` are present, **CPU fallback** otherwise (same image,
  chosen at startup and logged as `(edgetpu)` / `(cpu)`).
- PyCoral is **not** used: its last release (2.0.0, 2021-07-26) ships Linux wheels for Python <= 3.9 only, and Humble
  needs 3.10 (https://github.com/google-coral/pycoral/releases).
- Setup, Coral plug-in steps and troubleshooting: [SETUP_GUIDE.md](SETUP_GUIDE.md).

## Topics

| Topic | Type | Notes |
|---|---|---|
| `/<drone>/camera` (in) | `sensor_msgs/Image` | `rgb8` (`bgr8` also accepted); sim: 640x480 ~11-15 Hz; best effort, depth 1 |
| `/<drone>/drone_state` (in) | `drone_interfaces/DroneState` | drone_core 10 Hz state, used for `pose` |
| `/<drone>/detections` (out) | `std_msgs/String` (JSON) | <= 5 Hz, ~0.2-1 KB, never NaN |
| `/<drone>/detected_objects` (out) | `visualization_msgs/MarkerArray` | one TEXT marker per object, normalized image coords |

No annotated image is published (bandwidth).

### `/<drone>/detections` JSON

```json
{"stamp": 264.4,
 "model": "ssd_mobilenet_v2_coco_quant_postprocess.tflite (cpu)",
 "fps": 5.0, "infer_ms": 165.2,
 "camera": {"pitch_deg": 45.0, "hfov_deg": 99.7, "width": 640, "height": 480},
 "objects": [{"label": "person", "score": 0.84, "box": [0.4371, 0.5416, 0.4486, 0.5649]}],
 "pose": {"north": -0.05, "east": 0.12, "alt": 21.15, "heading_deg": 210.0, "roll_deg": -0.5, "pitch_deg": 0.2,
          "age_ms": 35}}
```

- `stamp`: camera header stamp (sim time in SITL), seconds.
- `fps`: frames actually processed per second (last 2 s); `infer_ms`: mean time per frame, all passes.
- `camera.pitch_deg`: mount pitch, **positive = down**. `hfov_deg`, `width`, `height`: of the full frame.
- `objects`: at most `max_objects` (10), highest score first. `box` = `[x1, y1, x2, y2]` **normalized to the full
  frame** (0..1, x right, y down), whatever tile it was found in.
- `pose` (optional): drone_core state received closest to the frame, PX4 local NED metres from the EKF origin
  (`north` = local_x, `east` = local_y, `alt` = -local_z, `heading_deg` 0 = north, clockwise). Omitted when no
  state was received within `pose_max_age` (150 ms) of the frame; `age_ms` is that gap. `alt` is relative to the
  EKF origin and can be off by a few metres (baro); prefer altitude above home from telemetry.
  `roll_deg` / `pitch_deg`: body attitude from the same DroneState sample (drone_core
  `vehicle_attitude`, ZYX Euler of FRD -> NED, same as DroneState): **roll + = right side down, pitch + = nose up**.
  Omitted until drone_core has an attitude sample (never NaN). The camera pitch relative to the ground is then
  `camera.pitch_deg - pose.pitch_deg` (down positive). DroneState is 10 Hz, so attitude is up to ~50 ms
  (`age_ms`) off the frame.

## How detection works

The model input is 300x300. Shrinking a 640x480 frame to 300x300 makes a person at 20-30 m only a few pixels tall,
so each frame is processed as:

1. a grid of `tile_size` (150 px) squares, evenly spread with slight overlap, covering the band between `tile_top`
   (20 %) and `tile_bottom` (100 %) of the frame height — 5x3 = 15 tiles on 640x480 — each scaled to the model input;
2. plus one pass on the whole frame (`whole_frame`), for large / near objects.

Results from all passes are mapped back to full-frame coordinates and merged per label (overlap >= 0.4 by IoU or
by intersection over the smaller box). Then the filters: `labels_allowed` (person, car, truck, bus, bicycle,
motorcycle), `threshold` 0.6, `max_box_area` 0.10 of the frame.

## Parameters

| Name | Default | |
|---|---|---|
| `drone_name` | `drone1` | topic prefix |
| `camera_topic` | `/<drone>/camera` | |
| `model_cpu` / `model_edgetpu` | `/workspace/models/ssd_mobilenet_v2_coco_quant_postprocess[_edgetpu].tflite` | |
| `labels_path` | `/workspace/models/coco_labels.txt` | |
| `use_edgetpu` | `true` | try the Edge TPU delegate first |
| `threads` | 2 (compose: 4) | CPU interpreter threads |
| `threshold` | 0.6 | |
| `labels_allowed` | person, car, truck, bus, bicycle, motorcycle | `[]` = all COCO labels |
| `max_box_area` | 0.10 | drop boxes larger than this fraction of the frame |
| `tiles` / `tile_size` / `tile_top` / `tile_bottom` / `whole_frame` | true / 150 / 0.2 / 1.0 / true | see above; compose overrides per drone (below) |
| `max_infer_hz` / `publish_hz` | 5 / 5 | publish is hard-capped at 5 Hz |
| `max_objects` | 10 | |
| `camera_pitch_deg` / `camera_hfov_deg` | 45 / 99.7 | reported in the JSON; set to the real mount |
| `pose_max_age` | 0.15 s | |

## Measured (sim host, Ryzen 9 3900X, 3 PX4 SITL + Gazebo running, CPU, 4 threads)

- tflite_runtime 2.17.1: 16 passes (15 tiles + whole frame) ~165 ms per frame, held at the 5 fps cap.
  (tflite-runtime 2.14.0 from PyPI needed 762 ms for 8 passes — use 2.17.1.)
- Baylands, camera 45 deg down, hovering at home facing the targets:
  - 20 m: person by the hatchback in 45/56 messages (max 0.84), SUV as `truck` 26/56 (0.77), far-group person 23/56
    (0.77); hatchback not detected; occasional tree false positives (1/56).
  - 30 m: one far person 3/60 (0.67), no cars, tree false positives up to 5/60. On CPU with this model use <= 20 m;
    the Coral with a larger model (EfficientDet-Lite) is the planned fix.

## Fleet setup in the sim (all three drones, 1280x960 camera)

All three sim drones use `x500_mono_cam_hd` (1280x960, HFOV 99.7 deg, 45 deg down; see
`../../config/sim/px4_models/README.md`). `../../docker/dev/docker-compose.object_detector.yml` runs one node per drone,
each publishing the same JSON on `/<drone>/detections`. There is one Coral on the sim host, so:

| Service / container | Drone | Backend | Passes | ms per frame | fps | CPU |
|---|---|---|---|---|---|---|
| `object_detector` / `object_detector_node` | drone1 | Edge TPU | 22: 7x3 tiles of 200 px at 25-80 % + whole | ~300 | 3.2 | ~60 % |
| `object_detector2` / `object_detector_node2` | drone2 | CPU, 1 thread | 8: 7 tiles of 200 px at y 400-600 + whole | ~262 | 2.5 (cap) | ~80 % |
| `object_detector3` / `object_detector_node3` | drone3 | CPU, 1 thread | same as drone2 | ~260 | 2.5 (cap) | ~84 % |

Gazebo RTF, 120 s, drones on the ground (the box is shared by Gazebo, 3x PX4, the detectors and the stack):

| Setup | RTF |
|---|---|
| drone1 HD + its detector, drone2/3 640x480 | 0.953 |
| all HD, drone2/3 detectors 2 threads x 22 passes | 0.750 (30 s) |
| all HD, drone2/3 detectors off | 0.899 (30 s) |
| **all HD, drone2/3 detectors 1 thread x 8 passes (this setup)** | **0.837; 0.809 on a second run (started ~80 s after a sim restart)** |
| drone1+drone2 HD + detectors, drone3 640x480 without detector | 0.912 |

PX4 SITL runs lockstep with Gazebo, so RTF < 1 only slows the sim; it does not change flight behaviour. drone2/3 run
the lighter setup only because this one sim box runs out of CPU: they prove the pipeline per drone, not drone1's hit
rate. Each real drone carries its own Coral and should use drone1's settings.

30 m results with drone1's settings (Edge TPU, heading 210, 60 s / 200 messages, 2026-10-29 20:59:48-21:00:48 UTC):
person by the hatchback 66/200, SUV 17/200, far people 150/200, hatchback 0; false positives 12/200, at two fixed
ground spots that flicker (longest run 2 consecutive messages), so an "N in a row at the same spot" filter removes them.

## Files

| File | |
|---|---|
| `camera_object_detector.py` | **the node** |
| `../../docker/dev/object_detector.dev.Dockerfile` | image `dev-object_detector:humble-coral` |
| `../../docker/dev/docker-compose.object_detector.yml` | drone1 instance |
| `../../models/` | model files (not in git; see SETUP_GUIDE) and `coco_labels.txt` |
| `../../config/udev/99-coral-edgetpu.rules` | host udev rule for the Coral |
| `../../config/sim/px4_models/` | sim camera mount (45 deg down) |
| `edge_tpu_detector.py`, `simple_ros_detector.py`, other `*.py` | legacy PyCoral standalone tests (Python 3.9, not run by the image) |
