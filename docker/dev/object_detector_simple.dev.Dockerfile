# Simplified Edge TPU + ROS 2 Object Detector
# Uses Ubuntu 20.04 with Python 3.8 for PyCoral compatibility
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

# Add ROS 2 Humble repository
RUN curl -sSL https://raw.githubusercontent.com/ros/rosdistro/master/ros.key -o /usr/share/keyrings/ros-archive-keyring.gpg
RUN echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/ros-archive-keyring.gpg] http://packages.ros.org/ros2/ubuntu $(. /etc/os-release && echo $UBUNTU_CODENAME) main" | tee /etc/apt/sources.list.d/ros2.list > /dev/null

# Install ROS 2 Core (minimal) with Python 3.8 compatibility
RUN apt-get update && apt-get install -y \
    ros-humble-ros-core \
    ros-humble-sensor-msgs \
    ros-humble-geometry-msgs \
    ros-humble-visualization-msgs \
    python3-rosdep \
    python3-colcon-common-extensions \
    && rm -rf /var/lib/apt/lists/*

# Add Edge TPU repository
RUN echo "deb https://packages.cloud.google.com/apt coral-edgetpu-stable main" | tee /etc/apt/sources.list.d/coral-edgetpu.list
RUN curl https://packages.cloud.google.com/apt/doc/apt-key.gpg | apt-key add -

# Install Edge TPU runtime (this works with Python 3.8)
RUN apt-get update && apt-get install -y \
    libedgetpu1-std \
    python3-pycoral \
    && rm -rf /var/lib/apt/lists/*

# Install additional Python packages
RUN python3 -m pip install --upgrade pip && \
    python3 -m pip install \
    opencv-python \
    numpy \
    Pillow

# Install cv_bridge separately (might need to build from source for Python 3.8)
RUN python3 -m pip install cv-bridge

# Create workspace
WORKDIR /workspace

# Clone PyCoral examples
RUN git clone https://github.com/google-coral/pycoral.git && \
    cd pycoral && \
    bash examples/install_requirements.sh classify_image.py && \
    bash examples/install_requirements.sh detect_image.py

# Setup ROS environment
RUN echo 'source /opt/ros/humble/setup.bash' >> ~/.bashrc

# Create entrypoint script
RUN echo '#!/bin/bash\n\
source /opt/ros/humble/setup.bash\n\
echo "Edge TPU + ROS 2 Object Detector Container"\n\
echo "Test Edge TPU: lsusb | grep Google"\n\
echo "Run detector: python3 /workspace/src/camera_object_detector.py"\n\
exec "$@"' > /entrypoint.sh && chmod +x /entrypoint.sh

ENTRYPOINT ["/entrypoint.sh"]
CMD ["bash"]