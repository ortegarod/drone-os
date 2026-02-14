# Multi-Drone Camera Setup

## Problem Statement

When spawning multiple drones with camera models (e.g., `x500_mono_cam`), PX4's instance spawning with `-i 1`, `-i 2`, etc. does **not** respect `PX4_GZ_MODEL=x500_mono_cam`.

**What happens:**
- `PX4_GZ_MODEL=x500_mono_cam ./build/px4_sitl_default/bin/px4 -i 0` ✅ spawns `x500_mono_cam_0` (with camera)
- `PX4_GZ_MODEL=x500_mono_cam ./build/px4_sitl_default/bin/px4 -i 1` ❌ spawns `x500_1` (base model, no camera)

**Root cause:** PX4's multi-instance spawning logic for complex models doesn't properly handle camera variants beyond instance 0.

## Solution: Manual Gazebo Spawn + PX4 Attach

For camera-equipped drones beyond drone1, use a **two-step process**:

1. **Manually spawn the model in Gazebo** (with correct name)
2. **Start PX4 with `PX4_GZ_MODEL_NAME`** to attach to existing model

### Step-by-Step: drone2 with Camera

#### 1. Create Spawn SDF

```bash
cat > /tmp/spawn_drone2.sdf << 'EOF'
<?xml version="1.0" ?>
<sdf version="1.6">
  <include>
    <name>x500_mono_cam_1</name>
    <uri>x500_mono_cam</uri>
    <pose>3 0 0.5 0 0 0</pose>
  </include>
</sdf>
EOF
```

**Notes:**
- `<name>x500_mono_cam_1</name>` — Must end in `_1` for instance 1
- `<uri>x500_mono_cam</uri>` — References the camera model
- `<pose>3 0 0.5 0 0 0</pose>` — Position (X Y Z Roll Pitch Yaw)

#### 2. Spawn Model in Gazebo

```bash
gz service -s /world/baylands/create \
  --reqtype gz.msgs.EntityFactory \
  --reptype gz.msgs.Boolean \
  --timeout 5000 \
  --req 'sdf_filename: "/tmp/spawn_drone2.sdf"'
```

**Verify spawn:**
```bash
gz model --list | grep x500
```

Expected output:
```
- x500_mono_cam_0
    - x500_mono_cam_1
```

#### 3. Verify Camera Sensor

```bash
gz model -m x500_mono_cam_1 -l camera_link -s | grep 'Name:'
```

Expected output:
```
- Name: camera_link
    - Name: imager
```

#### 4. Start PX4 Instance 1

```bash
cd ~/PX4-Autopilot
nohup bash -c 'export DISPLAY=:99 \
  __NV_PRIME_RENDER_OFFLOAD=1 \
  __GLX_VENDOR_LIBRARY_NAME=nvidia \
  PX4_GZ_MODEL_NAME=x500_mono_cam_1 \
  PX4_SYS_AUTOSTART=4001 \
  PX4_GZ_WORLD=baylands \
  && ./build/px4_sitl_default/bin/px4 -i 1' \
  > /tmp/px4-drone2.log 2>&1 &
```

**Key difference:** `PX4_GZ_MODEL_NAME=x500_mono_cam_1` (not `PX4_GZ_MODEL`)

This tells PX4 to **attach** to the existing `x500_mono_cam_1` model instead of spawning a new one.

#### 5. Start Camera Bridge

```bash
source /opt/ros/humble/setup.bash
nohup ros2 run ros_gz_bridge parameter_bridge \
  /world/baylands/model/x500_mono_cam_1/link/camera_link/sensor/imager/image@sensor_msgs/msg/Image@gz.msgs.Image \
  --ros-args \
  --remap /world/baylands/model/x500_mono_cam_1/link/camera_link/sensor/imager/image:=/drone2/camera \
  > /tmp/gz_bridge_camera_drone2.log 2>&1 &
```

#### 6. Verify Camera Feed

```bash
# Check ROS topic exists
ros2 topic list | grep camera
# Output: /drone1/camera, /drone2/camera

# Check publishing rate
ros2 topic hz /drone2/camera
# Expected: average rate: 20-30 Hz
```

## Full Multi-Drone Camera Setup

### drone1 (Instance 0) — Simple Method

```bash
cd ~/PX4-Autopilot
HEADLESS=1 \
  PX4_GZ_MODEL=x500_mono_cam \
  PX4_GZ_WORLD=baylands \
  make px4_sitl gz_x500
```

Camera bridge:
```bash
ros2 run ros_gz_bridge parameter_bridge \
  /world/baylands/model/x500_mono_cam_0/link/camera_link/sensor/imager/image@sensor_msgs/msg/Image@gz.msgs.Image \
  --ros-args \
  --remap /world/baylands/model/x500_mono_cam_0/link/camera_link/sensor/imager/image:=/drone1/camera
```

### drone2 (Instance 1) — Manual Spawn Method

See steps above.

### drone3 (Instance 2) — Manual Spawn Method

```bash
# 1. Spawn model
cat > /tmp/spawn_drone3.sdf << 'EOF'
<?xml version="1.0" ?>
<sdf version="1.6">
  <include>
    <name>x500_mono_cam_2</name>
    <uri>x500_mono_cam</uri>
    <pose>0 3 0.5 0 0 0</pose>
  </include>
</sdf>
EOF

gz service -s /world/baylands/create \
  --reqtype gz.msgs.EntityFactory \
  --reptype gz.msgs.Boolean \
  --timeout 5000 \
  --req 'sdf_filename: "/tmp/spawn_drone3.sdf"'

# 2. Start PX4
cd ~/PX4-Autopilot
PX4_GZ_MODEL_NAME=x500_mono_cam_2 \
  PX4_SYS_AUTOSTART=4001 \
  ./build/px4_sitl_default/bin/px4 -i 2

# 3. Start camera bridge
ros2 run ros_gz_bridge parameter_bridge \
  /world/baylands/model/x500_mono_cam_2/link/camera_link/sensor/imager/image@sensor_msgs/msg/Image@gz.msgs.Image \
  --ros-args \
  --remap /world/baylands/model/x500_mono_cam_2/link/camera_link/sensor/imager/image:=/drone3/camera
```

## Troubleshooting

### Camera topic not publishing

**Symptom:** `ros2 topic list` shows `/droneN/camera` but `ros2 topic hz` times out

**Diagnosis:**
```bash
# Check if Gazebo model has camera sensor
gz model -m x500_mono_cam_1 -l camera_link -s | grep imager

# Check ros_gz_bridge logs
ps aux | grep ros_gz_bridge
```

**Solutions:**
- Verify model spawned with correct `<uri>x500_mono_cam</uri>` (not `x500`)
- Check camera bridge command matches model name
- Restart bridge if Gazebo topic exists but ROS topic doesn't

### Model name mismatch

**Symptom:** PX4 connects but camera bridge fails

**Solution:** Model name in Gazebo must match pattern:
- Instance 0: `x500_mono_cam_0`
- Instance 1: `x500_mono_cam_1`
- Instance 2: `x500_mono_cam_2`

### PX4 fails to attach

**Symptom:** PX4 starts but shows "model not found"

**Diagnosis:**
```bash
gz model --list | grep x500_mono_cam_1
```

**Solution:** Ensure Gazebo model was spawned **before** starting PX4 with `PX4_GZ_MODEL_NAME`

## Automated Spawn Script

Save as `spawn_drone_with_camera.sh`:

```bash
#!/bin/bash
set -e

INSTANCE=$1
X_POS=$2
Y_POS=$3

if [ -z "$INSTANCE" ] || [ -z "$X_POS" ] || [ -z "$Y_POS" ]; then
  echo "Usage: $0 <instance> <x_pos> <y_pos>"
  echo "Example: $0 1 3 0"
  exit 1
fi

MODEL_NAME="x500_mono_cam_${INSTANCE}"
SDF_FILE="/tmp/spawn_drone${INSTANCE}.sdf"

# Create spawn SDF
cat > "$SDF_FILE" << EOF
<?xml version="1.0" ?>
<sdf version="1.6">
  <include>
    <name>${MODEL_NAME}</name>
    <uri>x500_mono_cam</uri>
    <pose>${X_POS} ${Y_POS} 0.5 0 0 0</pose>
  </include>
</sdf>
EOF

# Spawn in Gazebo
echo "Spawning ${MODEL_NAME} at (${X_POS}, ${Y_POS})..."
gz service -s /world/baylands/create \
  --reqtype gz.msgs.EntityFactory \
  --reptype gz.msgs.Boolean \
  --timeout 5000 \
  --req "sdf_filename: \"${SDF_FILE}\""

# Verify
sleep 1
if gz model --list | grep -q "${MODEL_NAME}"; then
  echo "✅ ${MODEL_NAME} spawned successfully"
  
  # Start camera bridge
  echo "Starting camera bridge for drone$((INSTANCE+1))..."
  source /opt/ros/humble/setup.bash
  nohup ros2 run ros_gz_bridge parameter_bridge \
    "/world/baylands/model/${MODEL_NAME}/link/camera_link/sensor/imager/image@sensor_msgs/msg/Image@gz.msgs.Image" \
    --ros-args \
    --remap "/world/baylands/model/${MODEL_NAME}/link/camera_link/sensor/imager/image:=/drone$((INSTANCE+1))/camera" \
    > "/tmp/gz_bridge_camera_drone$((INSTANCE+1)).log" 2>&1 &
  
  echo "✅ Camera bridge started for /drone$((INSTANCE+1))/camera"
  echo ""
  echo "Next: Start PX4 with:"
  echo "cd ~/PX4-Autopilot && PX4_GZ_MODEL_NAME=${MODEL_NAME} PX4_SYS_AUTOSTART=4001 ./build/px4_sitl_default/bin/px4 -i ${INSTANCE}"
else
  echo "❌ Failed to spawn ${MODEL_NAME}"
  exit 1
fi
```

**Usage:**
```bash
chmod +x spawn_drone_with_camera.sh

# Spawn drone2 at (3, 0)
./spawn_drone_with_camera.sh 1 3 0

# Spawn drone3 at (0, 3)
./spawn_drone_with_camera.sh 2 0 3
```

## Reference

- **Gazebo Model Names:** Must match PX4 instance pattern (`modelname_N`)
- **PX4 Instance IDs:** 0, 1, 2, ... (corresponds to `-i` flag)
- **Camera Model:** `x500_mono_cam` (defined in `PX4-Autopilot/Tools/simulation/gz/models/`)
- **Bridge Topic Pattern:** `/world/<world>/model/<model_name>/link/camera_link/sensor/imager/image`

## See Also

- `docs/MULTI_DRONE_SETUP.md` — Multi-drone control without cameras
- `PREFLIGHT_CHECKLIST.md` — Camera verification steps
- `TROUBLESHOOTING.md` — Camera feed debugging
