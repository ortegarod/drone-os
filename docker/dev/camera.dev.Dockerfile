# === camera.dev.Dockerfile ===
#
# Base Image: ubuntu:22.04
# - Builds libcamera and rpicam-apps from source
#

FROM ubuntu:22.04

ENV DEBIAN_FRONTEND=noninteractive

# Install libcamera dependencies
RUN apt-get update && apt-get install -y \
    libboost-dev \
    libgnutls28-dev openssl libtiff-dev pybind11-dev \
    qtbase5-dev libqt5core5a libqt5widgets5 \
    cmake \
    python3-yaml python3-ply \
    libglib2.0-dev libgstreamer-plugins-base1.0-dev \
    git ninja-build build-essential python3-pip

# Install latest Meson (>=0.63) via pip and remove apt version if present
RUN apt-get remove -y meson || true && \
    pip3 install --upgrade pip && \
    pip3 install 'meson>=0.63' jinja2 PyYAML

# Install ROS 2 Humble and colcon
RUN apt-get update && apt-get install -y software-properties-common curl && \
    curl -sSL https://raw.githubusercontent.com/ros/rosdistro/master/ros.key -o /usr/share/keyrings/ros-archive-keyring.gpg && \
    echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/ros-archive-keyring.gpg] http://packages.ros.org/ros2/ubuntu $(. /etc/os-release && echo $UBUNTU_CODENAME) main" | tee /etc/apt/sources.list.d/ros2.list > /dev/null && \
    apt-get update && apt-get install -y ros-humble-ros-base python3-colcon-common-extensions ros-humble-cv-bridge ros-humble-camera-info-manager ros-humble-ros2launch python3-rosdep

# Build and install libcamera from Raspberry Pi's fork
# Note: To modify libcamera source:
# 1. Fork the repository (e.g., https://github.com/raspberrypi/libcamera).
# 2. Make your changes in your fork.
# 3. Update the git clone command below to point to your fork and desired branch/commit.
# 4. Rebuild this Docker image.
WORKDIR /root
RUN git clone https://github.com/raspberrypi/libcamera.git
WORKDIR /root/libcamera
RUN meson setup build --buildtype=release -Dpipelines=rpi/vc4,rpi/pisp -Dipas=rpi/vc4,rpi/pisp -Dv4l2=true -Dgstreamer=enabled -Dtest=false -Dlc-compliance=disabled -Dcam=disabled -Dqcam=disabled -Ddocumentation=disabled -Dpycamera=enabled && \
    ninja -C build install

# Install rpicam-apps dependencies
RUN apt-get update && apt-get install -y \
    cmake libboost-program-options-dev libdrm-dev libexif-dev \
    meson ninja-build libpng-dev

# Build and install rpicam-apps from source
# Note: To modify rpicam-apps source:
# 1. Fork the repository (e.g., https://github.com/raspberrypi/rpicam-apps).
# 2. Make your changes in your fork.
# 3. Update the git clone command below to point to your fork and desired branch/commit.
# 4. Rebuild this Docker image.
WORKDIR /root
RUN git clone https://github.com/raspberrypi/rpicam-apps.git && \
    cd rpicam-apps && \
    meson setup build -Denable_libav=disabled -Denable_drm=enabled -Denable_egl=disabled -Denable_qt=disabled -Denable_opencv=disabled -Denable_tflite=disabled -Denable_hailo=disabled && \
    meson compile -C build && \
    meson install -C build && \
    ldconfig

# Create a ROS 2 workspace and build camera_ros
# Note: To modify camera_ros source:
# 1. Fork the repository (e.g., https://github.com/christianrauch/camera_ros).
# 2. Make your changes in your fork.
# 3. Update the git clone command below to point to your fork and desired branch/commit.
# 4. Rebuild this Docker image.
# Alternatively, for more active development on camera_ros:
#    a. Clone camera_ros to your host (e.g., ws_droneOS/src/camera_ros).
#    b. Comment out or remove the git clone line below.
#    c. In docker-compose.dev.yml, mount your local camera_ros source into this container (e.g., into /root/ros2_ws/src/camera_ros).
#    d. Then, colcon build will use your local, mounted source.
WORKDIR /root/ros2_ws/src
RUN git clone https://github.com/christianrauch/camera_ros.git
WORKDIR /root/ros2_ws
RUN . /opt/ros/humble/setup.sh && \
    rosdep init || true && \
    rosdep update && \
    echo "--- Listing /root/ros2_ws contents before build: ---" && \
    ls -la && \
    echo "--- Listing /root/ros2_ws/src contents before build: ---" && \
    ls -la src/ && \
    echo "--- Running rosdep install: ---" && \
    rosdep install --from-paths src --ignore-src -r -y --skip-keys=libcamera && \
    echo "--- Running colcon build: ---" && \
    colcon build --symlink-install --cmake-args -D CMAKE_BUILD_TYPE=Release

# Add sourcing to .bashrc for convenience in interactive shells
RUN echo "source /opt/ros/humble/setup.bash" >> /root/.bashrc && \
    echo "source /root/ros2_ws/install/setup.bash" >> /root/.bashrc

# Load necessary kernel modules for camera support
RUN apt-get update && apt-get install -y udev kmod && \
    modprobe vchiq && \
    modprobe bcm2835-v4l2 || true

# Set default workdir
WORKDIR /root

CMD ["bash"]
