# Edge TPU Object Detector with ROS 2 Integration
# Based on our successful manual setup in edge_tpu_test container
FROM ubuntu:20.04

ENV DEBIAN_FRONTEND=noninteractive

# Install system dependencies
RUN apt-get update && apt-get install -y \
    curl \
    gnupg \
    ca-certificates \
    python3 \
    python3-pip \
    git \
    wget \
    usbutils \
    libusb-1.0-0 \
    software-properties-common \
    lsb-release \
    && rm -rf /var/lib/apt/lists/*

# Add ROS 2 Galactic repository (compatible with Ubuntu 20.04)
RUN curl -sSL https://raw.githubusercontent.com/ros/rosdistro/master/ros.key -o /usr/share/keyrings/ros-archive-keyring.gpg
RUN echo "deb [arch=arm64 signed-by=/usr/share/keyrings/ros-archive-keyring.gpg] http://packages.ros.org/ros2/ubuntu focal main" | tee /etc/apt/sources.list.d/ros2.list > /dev/null

# Add Edge TPU repository
RUN echo "deb https://packages.cloud.google.com/apt coral-edgetpu-stable main" | tee /etc/apt/sources.list.d/coral-edgetpu.list
RUN curl https://packages.cloud.google.com/apt/doc/apt-key.gpg | apt-key add -

# Install ROS 2 Galactic Core and Edge TPU runtime
RUN apt-get update && apt-get install -y \
    ros-galactic-ros-core \
    ros-galactic-sensor-msgs \
    ros-galactic-geometry-msgs \
    ros-galactic-visualization-msgs \
    python3-rosdep \
    libedgetpu1-std \
    python3-pycoral \
    python3-opencv \
    && rm -rf /var/lib/apt/lists/*

# Install Python packages
RUN python3 -m pip install --upgrade pip && \
    python3 -m pip install \
    opencv-python \
    numpy \
    Pillow \
    cv-bridge

# Create workspace
WORKDIR /workspace

# Clone PyCoral examples and install requirements
RUN git clone https://github.com/google-coral/pycoral.git && \
    cd pycoral && \
    bash examples/install_requirements.sh classify_image.py && \
    bash examples/install_requirements.sh detect_image.py

# Setup ROS environment in bashrc
RUN echo 'source /opt/ros/galactic/setup.bash' >> ~/.bashrc

# Create entrypoint script with all test commands
RUN echo '#!/bin/bash\n\
source /opt/ros/galactic/setup.bash\n\
echo "================================================"\n\
echo "Edge TPU + ROS 2 Object Detector Container"\n\
echo "================================================"\n\
echo ""\n\
echo "Hardware Status:"\n\
if lsusb | grep -E "(1a6e:089a|18d1:9302|Google|Coral)" > /dev/null; then\n\
    echo "✅ Edge TPU detected: $(lsusb | grep -E "(1a6e:089a|18d1:9302|Google|Coral)")"\n\
else\n\
    echo "❌ Edge TPU not detected"\n\
fi\n\
echo ""\n\
echo "Test Commands:"\n\
echo "  Basic Edge TPU:"\n\
echo "    python3 /workspace/src/test_edge_tpu.py"\n\
echo ""\n\
echo "  Object Detection:"\n\
echo "    python3 /workspace/pycoral/examples/detect_image.py --model /workspace/models/ssd_mobilenet_v2_coco_quant_postprocess_edgetpu.tflite --labels /workspace/models/coco_labels.txt --input /workspace/pycoral/test_data/grace_hopper.bmp"\n\
echo ""\n\
echo "  ROS 2 Integration Test:"\n\
echo "    python3 /workspace/src/simple_ros_test.py"\n\
echo ""\n\
echo "  Camera Object Detector:"\n\
echo "    python3 /workspace/src/camera_object_detector.py --ros-args -p drone_name:=drone1 -p camera_topic:=/image_raw -p threshold:=0.5"\n\
echo ""\n\
echo "================================================"\n\
exec "$@"' > /entrypoint.sh && chmod +x /entrypoint.sh

ENTRYPOINT ["/entrypoint.sh"]
CMD ["bash"]