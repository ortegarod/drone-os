# === sim_camera.dev.Dockerfile ===
#
# Lightweight Dockerfile for bridging Gazebo simulated camera to ROS2
# and serving it as MJPEG stream via web_video_server.
#
# This replaces camera_service when running in simulation mode.
# No physical camera dependencies (libcamera, rpicam, etc.)
#

FROM ros:humble

ENV DEBIAN_FRONTEND=noninteractive

# Add the OSRF Gazebo repository (required for Gazebo Harmonic + ROS Humble bridge)
# Reference: https://gazebosim.org/docs/latest/ros_installation/
RUN apt-get update && apt-get install -y \
    curl \
    gnupg \
    lsb-release \
    && curl -sSL https://packages.osrfoundation.org/gazebo.gpg -o /usr/share/keyrings/gazebo-archive-keyring.gpg \
    && echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/gazebo-archive-keyring.gpg] http://packages.osrfoundation.org/gazebo/ubuntu-stable $(lsb_release -cs) main" | tee /etc/apt/sources.list.d/gazebo-stable.list > /dev/null

# Install the Gazebo-ROS2 bridge and web video server
# ros-humble-ros-gzharmonic provides bridge packages for Gazebo Harmonic
RUN apt-get update && apt-get install -y \
    ros-humble-ros-gzharmonic \
    ros-humble-web-video-server \
    && rm -rf /var/lib/apt/lists/*

# Add sourcing to .bashrc for convenience
RUN echo "source /opt/ros/humble/setup.bash" >> /root/.bashrc

WORKDIR /root

CMD ["bash"]
