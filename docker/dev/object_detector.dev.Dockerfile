# === object_detector.dev.Dockerfile ===
#
# Base Image: ros:humble-ros-base
# - Installs Google Coral Edge TPU libraries
# - Builds the object_detector_coral ROS 2 package
#

FROM ros:humble-ros-base

ENV DEBIAN_FRONTEND=noninteractive

# Install system dependencies for Coral and Python
RUN apt-get update && apt-get install -y \
    curl \
    gnupg \
    python3-pip \
    python3-opencv \
    # Add any other system dependencies your object detector node might need
    && rm -rf /var/lib/apt/lists/*

# Install Google Coral Edge TPU libraries
RUN curl https://packages.cloud.google.com/apt/doc/apt-key.gpg | apt-key add - && \
    echo "deb https://packages.cloud.google.com/apt coral-edgetpu-stable main" | tee /etc/apt/sources.list.d/coral-edgetpu.list && \
    apt-get update && apt-get install -y \
    libedgetpu1-std \
    python3-pycoral \
    && rm -rf /var/lib/apt/lists/*

# Install Python dependencies for the object detector node
# Add packages like tflite_runtime if not using pycoral's internal one,
# or specific versions of numpy, etc.
# RUN pip3 install --no-cache-dir <python-package-1> <python-package-2>

# Create a ROS 2 workspace
WORKDIR /root/ros2_ws/src

# Copy the object detector node source code
# This assumes the new node is in src/object_detector_coral relative to the Docker build context
COPY src/object_detector_coral /root/ros2_ws/src/object_detector_coral

# Install dependencies for the ROS 2 workspace and build
WORKDIR /root/ros2_ws
RUN . /opt/ros/humble/setup.sh && \
    apt-get update && rosdep init || true && \
    rosdep update && \
    # Install dependencies, skipping keys for system-installed libraries like libedgetpu
    rosdep install --from-paths src --ignore-src -r -y --skip-keys="libedgetpu1-std python3-pycoral python3-opencv" && \
    colcon build --symlink-install --cmake-args -D CMAKE_BUILD_TYPE=Release && \
    rm -rf /var/lib/apt/lists/*

# Add sourcing to .bashrc for convenience in interactive shells
RUN echo "source /opt/ros/humble/setup.bash" >> /root/.bashrc && \
    echo "source /root/ros2_ws/install/setup.bash" >> /root/.bashrc

# Set default workdir
WORKDIR /root

CMD ["bash"]
