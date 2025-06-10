# Edge TPU Object Detector for DroneOS

This module provides real-time object detection capabilities using Google Coral Edge TPU USB Accelerator.

## Overview

The object detector service runs inference on the Edge TPU hardware accelerator, providing fast and efficient object detection for drone applications. It supports both image files and real-time camera streams.

## Available Scripts

### 1. `test_edge_tpu.py` - Basic Test Script
- **Purpose**: Tests Edge TPU with image classification following the exact setup instructions
- **Based on**: The parrot classification example from Edge TPU setup guide
- **Use case**: Verify Edge TPU is working correctly

### 2. `classify_image_example.py` - Simple Classification
- **Purpose**: Direct implementation of the PyCoral classification example
- **Based on**: PyCoral API documentation example code
- **Use case**: Basic image classification reference

### 3. `detect_image_example.py` - Object Detection Example  
- **Purpose**: Object detection with bounding boxes
- **Based on**: google-coral/pycoral detect_image.py example
- **Use case**: Standalone object detection testing

### 4. `edge_tpu_detector.py` - Reusable Detection Class
- **Purpose**: Class-based wrapper for easy integration
- **Based on**: PyCoral API patterns, custom implementation
- **Use case**: Building custom applications

### 5. `camera_object_detector.py` - ROS 2 Camera Integration
- **Purpose**: Real-time object detection on camera feed
- **Based on**: ROS 2 node pattern with PyCoral integration
- **Use case**: Drone camera object detection

## Prerequisites

### Hardware Requirements
- Google Coral USB Accelerator (Edge TPU)
- USB 3.0 port (recommended for best performance)
- Linux system (Ubuntu 18.04+ or Debian 10+)

### Software Requirements
- Python 3.6-3.9 (PyCoral compatibility requirement)
- Edge TPU Runtime
- PyCoral library
- TensorFlow Lite models compiled for Edge TPU

## Quick Start

### 1. Build and Start the Container

```bash
cd ws_droneOS
docker compose -f docker/dev/docker-compose.dev.yml up -d --build object_detector
```

### 2. Verify Edge TPU Connection

```bash
# Check if Edge TPU is detected
docker compose -f docker/dev/docker-compose.dev.yml exec object_detector bash -c "lsusb | grep Google"
```

Expected output:
```
Bus 002 Device 003: ID 1a6e:089a Global Unichip Corp. Google Coral
```

### 3. Run Test Scripts

```bash
# Enter the container
docker compose -f docker/dev/docker-compose.dev.yml exec object_detector bash

# First, download test data if not already present
cd /workspace/pycoral
bash examples/install_requirements.sh classify_image.py
bash examples/install_requirements.sh detect_image.py

# Test 1: Basic Edge TPU test (classification)
python3 /workspace/src/test_edge_tpu.py

# Test 2: Simple classification example
python3 /workspace/src/classify_image_example.py

# Test 3: Object detection with bounding boxes
python3 /workspace/src/detect_image_example.py

# Test 4: Class-based detector
python3 /workspace/src/edge_tpu_detector.py
```

## Using Custom Models

Place your Edge TPU models in the `models/` directory at the project root:

```bash
ws_droneOS/
├── models/
│   ├── ssd_mobilenet_v2_coco_quant_postprocess_edgetpu.tflite
│   └── coco_labels.txt
```

Then run with your custom model:

```bash
python3 /workspace/src/edge_tpu_detector.py \
  --model /workspace/models/your_model_edgetpu.tflite \
  --labels /workspace/models/your_labels.txt \
  --image /path/to/your/image.jpg
```

## Python API Usage

```python
from edge_tpu_detector import EdgeTPUDetector

# Initialize detector
detector = EdgeTPUDetector(
    model_path='/workspace/models/model_edgetpu.tflite',
    labels_path='/workspace/models/labels.txt',
    threshold=0.4
)

# Detect objects in an image file
results, inference_time = detector.detect_image('/path/to/image.jpg')

# Process results
for obj in results:
    print(f"Detected {obj['label']} with {obj['score']:.2%} confidence")
    print(f"Bounding box: {obj['bbox']}")

# Detect from numpy array (e.g., camera feed)
import cv2
image = cv2.imread('/path/to/image.jpg')
image_rgb = cv2.cvtColor(image, cv2.COLOR_BGR2RGB)
results, inference_time = detector.detect_from_array(image_rgb)
```

## Performance Benchmarks

Typical inference times on Edge TPU:
- SSD MobileNet V2: ~10-15ms
- YOLOv5 Nano: ~20-25ms
- EfficientDet-Lite: ~15-20ms

Note: First inference includes model loading and is slower (~100ms+)

## Model Resources

### Pre-trained Models
Download Edge TPU models from:
- [Coral Model Zoo](https://coral.ai/models/)
- [TensorFlow Hub](https://tfhub.dev/s?deployment-format=lite&q=coral)

### Model Requirements
- Models must be quantized and compiled for Edge TPU
- Use `.tflite` format with `_edgetpu` suffix
- Maximum model size: 64MB (Edge TPU memory limit)

### Converting Custom Models
To convert your own TensorFlow model for Edge TPU:

1. Train/export model in TensorFlow
2. Convert to TensorFlow Lite with quantization
3. Compile for Edge TPU using Edge TPU Compiler

See [Coral documentation](https://coral.ai/docs/edgetpu/models-intro/) for detailed instructions.

## Troubleshooting

### Edge TPU Not Detected
1. Ensure USB device is connected properly
2. Check USB permissions:
   ```bash
   # On host machine
   sudo usermod -a -G plugdev $USER
   # Logout and login again
   ```
3. Verify udev rules are installed:
   ```bash
   # Should exist after installing Edge TPU runtime
   ls /etc/udev/rules.d/99-edgetpu-accelerator.rules
   ```
4. Try unplugging and replugging the Edge TPU after container starts

### Common Errors and Solutions

#### "Failed to load delegate from libedgetpu.so.1"
- Edge TPU runtime not properly installed
- Solution: Rebuild container or manually install runtime inside container

#### "ValueError: Failed to load model"
- Model file not compiled for Edge TPU
- Solution: Ensure model filename ends with `_edgetpu.tflite`

#### ImportError with PyCoral
- Python version mismatch (PyCoral needs 3.6-3.9)
- Solution: Container sets Python 3.9 as default, but verify with `python3 --version`

#### Slow First Inference
- This is normal - first inference loads model into Edge TPU memory
- Subsequent inferences will be much faster (typically 10-30ms)

### Performance Issues
- Use USB 3.0 port for best performance (USB 2.0 is ~10x slower)
- Ensure proper cooling (Edge TPU can throttle when hot)
- Check model is compiled for Edge TPU (has `_edgetpu` suffix)
- Monitor inference times in logs

### Python Version Conflicts
PyCoral requires Python 3.6-3.9. The container uses Python 3.9 by default.

## Camera Integration with DroneOS

### Running Object Detection on Camera Feed

The `camera_object_detector.py` script integrates with the DroneOS camera service for real-time object detection.

#### Prerequisites
1. Camera service must be running and publishing images
2. Edge TPU must be connected and detected
3. Both services must be on the same ROS 2 network

#### Launch Camera Object Detector

```bash
# Method 1: From within container
docker compose -f docker/dev/docker-compose.dev.yml exec object_detector bash
source /opt/ros/humble/setup.bash
python3 /workspace/src/camera_object_detector.py --ros-args \
  -p drone_name:=drone1 \
  -p camera_topic:=/image_raw \
  -p model_path:=/workspace/models/ssd_mobilenet_v2_coco_quant_postprocess_edgetpu.tflite \
  -p labels_path:=/workspace/models/coco_labels.txt

# Method 2: As a ROS 2 node (after building)
ros2 run object_detector camera_object_detector --ros-args \
  -p drone_name:=drone1 \
  -p threshold:=0.5 \
  -p publish_rate:=10.0
```

#### ROS 2 Topics

**Subscriptions:**
- `/image_raw` - Raw camera images (default, configurable)

**Publications:**
- `/<drone_name>/detected_objects` - MarkerArray with detection labels
- `/<drone_name>/annotated_image` - Image with bounding boxes drawn

#### View Results

```bash
# View detection markers
ros2 topic echo /drone1/detected_objects

# View annotated images (requires image viewer)
ros2 run rqt_image_view rqt_image_view /drone1/annotated_image
```

### Testing with Simulated Camera

If you don't have a physical camera, you can test with a simulated image publisher:

```bash
# In one terminal, publish test images
ros2 run image_publisher image_publisher_node \
  /workspace/pycoral/test_data/grace_hopper.bmp \
  --ros-args -r __node:=test_camera -r image_raw:=/image_raw

# In another terminal, run the detector
python3 /workspace/src/camera_object_detector.py
```

## Development

To develop custom detection logic:

1. Mount your development directory:
   ```yaml
   volumes:
     - ./src/object_detector:/workspace/src
   ```

2. Edit code in `src/object_detector/` on host
3. Changes are immediately reflected in container

## License

This module uses the PyCoral library which is licensed under Apache 2.0.
Edge TPU runtime is proprietary Google software.