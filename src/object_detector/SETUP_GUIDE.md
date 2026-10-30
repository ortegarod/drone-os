# object_detector setup

ROS 2 Humble (Ubuntu 22.04, Python 3.10). Works on CPU out of the box; uses a Coral USB Accelerator automatically
when one is plugged in. The old Ubuntu 20.04 / ROS 2 Galactic / PyCoral setup is gone.

## 1. Models

Into `ws_droneOS/models/` (not in git), from google-coral/test_data:

```bash
cd ~/ws_droneOS/models
B=https://raw.githubusercontent.com/google-coral/test_data/master
curl -fLO $B/ssd_mobilenet_v2_coco_quant_postprocess.tflite          # CPU, 6.2 MB
curl -fLO $B/ssd_mobilenet_v2_coco_quant_postprocess_edgetpu.tflite  # Edge TPU, 6.9 MB
# coco_labels.txt is already in the repo
```

## 2. Image

```bash
cd ~/ws_droneOS
docker build -t dev-object_detector:humble-coral -f docker/dev/object_detector.dev.Dockerfile docker/dev
```

What it installs (`ros:humble` base):

- **libedgetpu** (Coral runtime): the official Coral apt repo
  (`packages.cloud.google.com/apt coral-edgetpu-stable`) returned **403 Forbidden** on 2026-10-29, so we use
  feranick's maintained builds of google-coral/libedgetpu: `libedgetpu1-std_16.0tf2.17.1-1.ubuntu22.04_amd64.deb`
  from https://github.com/feranick/libedgetpu/releases (tag `16.0TF2.17.1-1`). `std` = standard clock; `max`
  is faster but runs the Coral hot.
- **tflite_runtime 2.17.1** for cp310 from https://github.com/feranick/TFlite-builds/releases (`v2.17.1`).
  libedgetpu is built against one TensorFlow version, so keep the two versions matched (build args `TF_VER`,
  `EDGETPU_TAG`, `EDGETPU_DEB`).
- `numpy<2` (Humble's rclpy is built against numpy 1.x).

For another architecture (Raspberry Pi 64-bit: `arm64`, `linux_aarch64` wheel) change the deb/wheel names.

## 3. Run

```bash
cd ~/ws_droneOS
docker compose -f docker/dev/docker-compose.object_detector.yml up -d
docker logs -f object_detector_node
```

Expected log: `drone1: /drone1/camera -> /drone1/detections, model ... (cpu)` (or `(edgetpu)`), then every 10 s
`cpu: 165 ms per frame (16 passes), achieved 5.0 fps`. Without a Coral the log also shows
`Edge TPU not available (Failed to load delegate from libedgetpu.so.1); using CPU` and a harmless
`Delegate ... has no attribute '_library'` traceback from tflite_runtime — expected.

The compose file mounts the node source, `models/` and the workspace `install/` (read-only, for
`drone_interfaces` → `pose` in the JSON). For drone2/drone3 copy the service with `drone_name:=drone2` etc.

Check from any rosbridge client: subscribe to `/drone1/detections` (`std_msgs/String`).

## 4. Coral USB Accelerator (on the sim host or the drone)

1. Plug the Coral into a **USB 3** port (blue), with its own USB-C cable.
2. Install the udev rule (both USB ids the Coral uses):
   ```bash
   sudo cp ~/ws_droneOS/config/udev/99-coral-edgetpu.rules /etc/udev/rules.d/
   sudo udevadm control --reload-rules && sudo udevadm trigger
   ```
3. Unplug and re-plug the Coral.
4. Check: `lsusb | grep -iE '1a6e|18d1'` → `1a6e:089a Global Unichip Corp.` before first use; after the runtime
   loads its firmware it re-enumerates as `18d1:9302 Google Inc.`. This id change is why the container gets the
   whole `/dev/bus/usb` and the cgroup rule `c 189:* rmw` rather than a single device node.
5. `docker restart object_detector_node` → the log should say `(edgetpu)`. If anything fails the node falls back to
   CPU and keeps running.

Without a device the Edge TPU path cannot be tested: `load_delegate('libedgetpu.so.1')` fails when no Coral is found.

## 5. Camera mount

The detector, and the Command Center's projection of boxes onto the ground, assume the camera mount is reported
correctly (`camera_pitch_deg`, `camera_hfov_deg` parameters → `camera` in the JSON).

- **Sim**: PX4 `x500_mono_cam`, camera pitched **45 deg down**, HFOV **1.74 rad = 99.7 deg**, **640x480**,
  15 Hz (VFOV ~83.9 deg). At 45 deg down the image spans ~3 to ~87 deg below the horizon. Model files and install
  steps: `config/sim/px4_models/`.
- **Real drone**: Raspberry Pi camera via `camera_ros` (`docker/prod/docker-compose.yml`). Mount it 45 deg down to
  match, and set `camera_hfov_deg` to the module's real HFOV (a wide module is closest to the sim's ~100 deg).

## Troubleshooting

- `no pose` warning: `install/` not mounted or not built (`drone_interfaces`).
- No messages on `/detections`: check the camera topic is `rgb8`/`bgr8` and publishing
  (`ros2 topic hz /drone1/camera`).
- Too many false positives (trees in Gazebo fire as `person`): raise `threshold`; small objects at > 20 m on CPU
  are at the limit of SSD MobileNet v2.
