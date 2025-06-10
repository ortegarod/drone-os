# Edge TPU Object Detection Setup Guide

## Overview
This guide documents the Edge TPU object detection setup for DroneOS. The Edge TPU USB Accelerator must be physically connected to the computer running the detection service.

## Files Created

### 1. Docker Infrastructure

#### `/docker/dev/object_detector.dev.Dockerfile`
- Full-featured Dockerfile with ROS 2 integration
- Based on ROS Humble but requires Python 3.9 for PyCoral
- Includes camera integration dependencies
- **Status**: Complex build, not yet tested

#### `/docker/dev/edge_tpu_test.Dockerfile`
- Simplified Dockerfile for testing
- Based on Ubuntu 20.04 (has Python 3.8, compatible with PyCoral)
- Minimal dependencies, focused on Edge TPU functionality
- **Status**: Builds successfully

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

## Troubleshooting USB Passthrough

If Edge TPU not detected in container:
1. Check host detection: `lsusb | grep Google`
2. Ensure container has privileged mode
3. Check udev rules: `ls /etc/udev/rules.d/99-edgetpu-accelerator.rules`
4. Try unplugging and replugging Edge TPU after container starts