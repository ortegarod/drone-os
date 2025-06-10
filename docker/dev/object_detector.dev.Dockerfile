# Edge TPU Object Detector Development Dockerfile
# Based on ROS 2 Humble for camera integration
FROM ros:humble

# Prevent interactive prompts during installation
ENV DEBIAN_FRONTEND=noninteractive

# Install system dependencies
RUN apt-get update && apt-get install -y \
    curl \
    gnupg \
    ca-certificates \
    python3-pip \
    git \
    wget \
    usbutils \
    libusb-1.0-0 \
    libc++1 \
    libc++abi1 \
    libunwind8 \
    libgcc1 \
    software-properties-common \
    && rm -rf /var/lib/apt/lists/*

# Add deadsnakes PPA for Python 3.9 (required for PyCoral)
RUN add-apt-repository ppa:deadsnakes/ppa && \
    apt-get update && \
    apt-get install -y python3.9 python3.9-dev python3.9-distutils && \
    rm -rf /var/lib/apt/lists/*

# Install pip for Python 3.9
RUN curl https://bootstrap.pypa.io/get-pip.py | python3.9

# Set Python 3.9 as default for PyCoral compatibility
RUN update-alternatives --install /usr/bin/python3 python3 /usr/bin/python3.9 1 && \
    update-alternatives --set python3 /usr/bin/python3.9

# Install ROS 2 packages for camera integration
RUN apt-get update && apt-get install -y \
    ros-humble-cv-bridge \
    ros-humble-sensor-msgs \
    ros-humble-visualization-msgs \
    ros-humble-geometry-msgs \
    python3-opencv \
    && rm -rf /var/lib/apt/lists/*

# Add Google Cloud package repository
RUN echo "deb https://packages.cloud.google.com/apt coral-edgetpu-stable main" | tee /etc/apt/sources.list.d/coral-edgetpu.list && \
    curl https://packages.cloud.google.com/apt/doc/apt-key.gpg | apt-key add -

# Install Edge TPU runtime
RUN apt-get update && apt-get install -y \
    libedgetpu1-std \
    python3-pycoral \
    && rm -rf /var/lib/apt/lists/*

# Install additional Python packages with Python 3.9
RUN python3.9 -m pip install --upgrade pip && \
    python3.9 -m pip install \
    numpy \
    Pillow \
    opencv-python

# Create workspace directory
WORKDIR /workspace

# Clone PyCoral examples repository for models and test data
RUN git clone https://github.com/google-coral/pycoral.git /workspace/pycoral && \
    cd /workspace/pycoral && \
    bash examples/install_requirements.sh classify_image.py && \
    bash examples/install_requirements.sh detect_image.py

# Models directory will be mounted as volume or downloaded in container

# Create a ROS-aware entrypoint script
RUN echo '#!/bin/bash\n\
source /opt/ros/humble/setup.bash\n\
echo "Edge TPU Object Detector Container Started"\n\
echo ""\n\
echo "Test Commands:"\n\
echo "  - Test Edge TPU: python3 /workspace/src/test_edge_tpu.py"\n\
echo "  - Run camera detector: ros2 run object_detector camera_object_detector"\n\
echo ""\n\
echo "To check if Edge TPU is connected:"\n\
echo "  lsusb | grep Google"\n\
echo ""\n\
exec "$@"' > /entrypoint.sh && chmod +x /entrypoint.sh

# Set the entrypoint
ENTRYPOINT ["/entrypoint.sh"]

# Default command - keep container running
CMD ["bash"]