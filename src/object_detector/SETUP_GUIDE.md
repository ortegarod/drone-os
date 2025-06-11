# Edge TPU Object Detection Setup Guide

## Overview
This guide documents the Edge TPU object detection setup for DroneOS. The Edge TPU USB Accelerator must be physically connected to the computer running the detection service.

## Files Created

### 1. Docker Infrastructure

#### `/docker/dev/object_detector_ros2.dev.Dockerfile` ✅ WORKING
- **NEW**: Based on successful manual setup
- Ubuntu 20.04 + Python 3.8 + ROS 2 Galactic + PyCoral
- Full ROS 2 integration with camera support
- **Status**: Fully tested and working

#### `/docker/dev/object_detector.dev.Dockerfile` (Legacy)
- Original attempt with ROS Humble + Python 3.9
- **Status**: Build failed due to PyCoral compatibility

#### `/docker/dev/edge_tpu_test.Dockerfile` ✅ WORKING
- Simplified test container (used for initial development)
- Ubuntu 20.04 + Python 3.8 + PyCoral only
- **Status**: Working, used for development and testing

#### `/docker/dev/docker-compose.edge_tpu_test.yml`
- Simple docker-compose for testing Edge TPU
- Mounts USB devices and source code
- **Status**: Ready to use

#### Docker-compose entry in `/docker/dev/docker-compose.dev.yml`
- Added `object_detector` service
- Configured for ROS 2 integration
- **Status**: Not yet tested due to build complexity

### 2. Python Scripts

#### `/src/object_detector/test_edge_tpu.py`
- Basic test following Edge TPU setup instructions exactly
- Tests classification with parrot image
- Measures inference time

#### `/src/object_detector/classify_image_example.py`
- Direct implementation of PyCoral classification example
- Reference implementation from documentation

#### `/src/object_detector/detect_image_example.py`
- Object detection with bounding boxes
- Based on PyCoral detect_image.py example

#### `/src/object_detector/edge_tpu_detector.py`
- Class-based wrapper for reusable detection
- Provides simple API for integration

#### `/src/object_detector/camera_object_detector.py`
- ROS 2 node for real-time camera object detection
- Subscribes to camera topics, publishes detection results
- **Note**: Requires ROS 2 environment

### 3. Documentation

#### `/src/object_detector/README.md`
- Comprehensive documentation
- Usage examples for all scripts
- Troubleshooting guide
- Camera integration instructions

## Current Status

### What Works
- Simple Edge TPU test container builds successfully
- All Python scripts are ready for testing
- Documentation is complete

### What Needs Testing
- Edge TPU USB device detection (requires physical Edge TPU)
- Actual inference on Edge TPU hardware
- ROS 2 integration with camera feed

## Required Model Files
You already have:
- `models/ssd_mobilenet_v2_coco_quant_postprocess_edgetpu.tflite`
- `models/coco_labels.txt`

## Next Steps on Drone Computer

1. **Connect Edge TPU USB Accelerator**
   ```bash
   # Verify connection
   lsusb | grep Google
   # Should show: Bus XXX Device XXX: ID 1a6e:089a Global Unichip Corp. Google Coral
   ```

2. **Run Simple Test**
   ```bash
   # Build and start test container
   cd ws_droneOS
   docker compose -f docker/dev/docker-compose.edge_tpu_test.yml up -d
   
   # Enter container
   docker exec -it edge_tpu_test bash
   
   # Run test
   python3 /workspace/test_edge_tpu.py
   ```

3. **Test Object Detection**
   ```bash
   # Inside container
   python3 /workspace/src/detect_image_example.py \
     --model /workspace/models/ssd_mobilenet_v2_coco_quant_postprocess_edgetpu.tflite \
     --labels /workspace/models/coco_labels.txt
   ```

## Important Notes

- **Edge TPU must be physically connected** to the computer running the container
- First inference is slow (~100ms) as model loads into Edge TPU memory
- Subsequent inferences should be 10-30ms
- Use USB 3.0 port for best performance
- PyCoral requires Python 3.6-3.9 (not compatible with Python 3.10+)

## Deployment Architecture

### Development/Testing
- Use `edge_tpu_test.Dockerfile` for initial testing
- Run on any computer with Edge TPU connected

### Production on Drone
- Edge TPU connected to Raspberry Pi companion computer
- Run alongside `drone_core` and `micro_agent`
- Can integrate with camera feed via ROS 2 topics

## SUCCESSFUL SETUP COMPLETED ✅

### Edge TPU Working Configuration
- **Date**: June 10, 2025
- **Hardware**: Google Coral USB Accelerator on ARM64 (Raspberry Pi)
- **Container**: Ubuntu 20.04 + ROS 2 Galactic + PyCoral
- **Performance**: ~12.3ms object detection inference time
- **Test Result**: ✅ **REAL-TIME OBJECT DETECTION ON CAMERA FEED**

### 🎯 **FINAL SUCCESS: Complete AI Vision Pipeline Working**
- ✅ **Edge TPU**: Detected and functional (1a6e:089a → 18d1:9302)
- ✅ **Camera**: IMX708 streaming 1280x720 @ 30fps via ROS 2
- ✅ **Object Detection**: Real-time inference with bounding boxes
- ✅ **ROS 2 Integration**: Publishing detection markers to `/drone1/detected_objects`
- ✅ **Docker Production**: New Dockerfile builds successfully
- ✅ **Performance**: 80+ FPS capability (12.3ms per frame)

**Live Detection Example:**
```
text: 'person: 0.50'  # 50% confidence human detection
text: 'cat: 0.56'     # 56% confidence (sometimes misclassifies humans)
position: x: 1134.5, y: 220.5  # Pixel coordinates in image
```

### Critical Issue Resolved: Device ID Changes

**Problem**: Edge TPU changes device ID during initialization:
- Before: `1a6e:089a` (Global Unichip Corp)
- After: `18d1:9302` (Google Inc)

**Solution**: Container restart after device ID change
```bash
# Check current device ID
lsusb | grep -E "(1a6e:089a|18d1:9302|Google|Coral)"

# If device ID changed, restart container
docker compose -f docker/dev/docker-compose.edge_tpu_test.yml restart
```

### Installed udev Rules

Created `/etc/udev/rules.d/99-coral-edgetpu.rules` to handle both device IDs:
```bash
# Install the rules (already done)
sudo cp /home/rodrigo/ws_droneOS/99-coral-edgetpu.rules /etc/udev/rules.d/
sudo udevadm control --reload-rules
sudo udevadm trigger
```

### Working Test Commands

```bash
# 1. Start container
docker compose -f docker/dev/docker-compose.edge_tpu_test.yml up -d

# 2. Test classification (WORKING)
docker exec edge_tpu_test python3 /workspace/pycoral/examples/classify_image.py \
  --model /workspace/pycoral/test_data/mobilenet_v2_1.0_224_inat_bird_quant_edgetpu.tflite \
  --labels /workspace/pycoral/test_data/inat_bird_labels.txt \
  --input /workspace/pycoral/test_data/parrot.jpg

# Expected output:
# ----INFERENCE TIME----
# 23.9ms (first inference)
# 4.7ms (subsequent inferences)
# -------RESULTS--------
# Ara macao (Scarlet Macaw): 0.75781

# 3. Test object detection (WORKING)
docker exec edge_tpu_test python3 /workspace/pycoral/examples/detect_image.py \
  --model /workspace/models/ssd_mobilenet_v2_coco_quant_postprocess_edgetpu.tflite \
  --labels /workspace/models/coco_labels.txt \
  --input /workspace/pycoral/test_data/grace_hopper.bmp

# Expected output:
# ----INFERENCE TIME----
# 34.69ms (first inference)
# 12.81ms (subsequent inferences) 
# -------RESULTS--------
# tie: score 0.83984375, bbox (227,419,292,541)
# person: score 0.8046875, bbox (2,4,513,595)

# 4. Test custom EdgeTPUDetector class (WORKING)
docker exec edge_tpu_test python3 /workspace/src/edge_tpu_detector.py \
  --model /workspace/models/ssd_mobilenet_v2_coco_quant_postprocess_edgetpu.tflite \
  --labels /workspace/models/coco_labels.txt \
  --image /workspace/pycoral/test_data/grace_hopper.bmp

# Expected output:
# Inference time: 34.73 ms
# Detected 2 objects:
# 1. tie - Score: 80.47%
# 2. person - Score: 80.47%

# 5. Test ROS 2 integration (WORKING)
docker exec edge_tpu_test bash -c "source /opt/ros/galactic/setup.bash && python3 /workspace/src/simple_ros_test.py"

# Expected output:
# ✅ ROS 2 imports successful
# ✅ PyCoral imports successful  
# ✅ ROS 2 node creation successful
# ✅ Edge TPU model loading successful
#    Model input size: (300, 300)
# ✅ All tests passed! Ready for camera integration
```

### ROS 2 Camera Integration Ready ✅

The Edge TPU container now has full ROS 2 Galactic integration:
- **ROS 2 Core**: Installed and functional
- **PyCoral**: Working with Edge TPU  
- **cv_bridge**: Available for camera image conversion
- **All message types**: sensor_msgs, geometry_msgs, visualization_msgs

**Production Deployment (Updated Dockerfile):**
```bash
# Build and start with main DroneOS stack
cd ws_droneOS
docker compose -f docker/dev/docker-compose.dev.yml up -d --build object_detector

# Check status
docker logs object_detector_node

# Test object detection
docker exec object_detector_node python3 /workspace/src/simple_ros_test.py
```

**Development/Testing (Simple Container):**
```bash
# Using the test container we built
docker exec -it edge_tpu_test bash

# Inside container, source ROS 2 and run detector
source /opt/ros/galactic/setup.bash
python3 /workspace/src/camera_object_detector.py --ros-args \
  -p drone_name:=drone1 \
  -p camera_topic:=/image_raw \
  -p threshold:=0.5
```

**Key Files Created/Updated:**
- `docker/dev/object_detector_ros2.dev.Dockerfile` - ✅ **PRODUCTION READY** Dockerfile
- `docker/dev/docker-compose.dev.yml` - Updated to use new Dockerfile
- `99-coral-edgetpu.rules` - udev rules for both device IDs (installed)
- `src/object_detector/camera_object_detector.py` - ROS 2 object detection node
- `src/object_detector/simple_ros_test.py` - Integration test script
- Complete documentation with all working commands

### 🚀 **Ready for Production Deployment**
```bash
# Start complete DroneOS + AI vision stack
docker compose -f docker/dev/docker-compose.dev.yml up -d --build

# Services running:
# - drone_core (flight control)
# - micro_agent (PX4 bridge) 
# - camera_service (video streaming)
# - object_detector (AI vision) ← NEW!
```

## Troubleshooting USB Passthrough

If Edge TPU not detected in container:
1. Check host detection: `lsusb | grep -E "(Google|Coral|1a6e:089a|18d1:9302)"`
2. Ensure container has privileged mode and USB passthrough
3. Check udev rules: `ls /etc/udev/rules.d/99-coral-edgetpu.rules`
4. **KEY FIX**: If getting "Failed to load delegate" error, restart container after device ID change
5. Try unplugging and replugging Edge TPU if needed