# === drone_core.Dockerfile ===
#
# Base Image: ros:humble
# - This is an Ubuntu 22.04 image with ROS 2 Humble pre-installed
# - We use this instead of plain Ubuntu because we need ROS 2 for the drone_core node
#
# This Dockerfile builds the drone_core ROS 2 node, but how it's used depends
# on which docker-compose file you run:
#
# If you run docker-compose.dev.yml:
# - This is for development with PX4 SITL
# - The container will have all dependencies (ROS 2, PX4 msgs, etc.)
# - Your local source code will be mounted into the container
# - You can edit code and rebuild without rebuilding the container
# - Used for testing with PX4 SITL simulation
# - Note: If you change px4_msgs, you'll need to rebuild the container
#
# The key difference is in the volume mounts in the docker-compose files:
# - docker-compose.dev.yml: Mounts src/, build/, install/, log/ directories
# - docker-compose.yml: Only mounts logs/ directory
#
# Note about px4_msgs:
# - In development: If you change px4_msgs, you need to rebuild the container
#   because it's built in Stage 1 and copied to the final image
# - In production: px4_msgs is built into the container and doesn't change
#
# Why this approach is reasonable:
# 1. px4_msgs changes are rare - they're message definitions that don't change often
# 2. When they do change, rebuilding the container ensures everything is consistent
# 3. It's simpler than having multiple Dockerfiles or complex volume mounts
#

FROM ros:humble

ENV DEBIAN_FRONTEND=noninteractive

SHELL ["/bin/bash", "-c"]

# Install dependencies
RUN apt-get update && apt-get install -y \
    python3-colcon-common-extensions \
    ros-humble-rmw-fastrtps-cpp \
    build-essential \
    git \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /root/ws_droneOS

# Always source ROS 2 and workspace overlays in every shell
RUN echo 'source /opt/ros/humble/setup.bash' >> /root/.bashrc \
 && echo 'if [ -f /root/ws_droneOS/install/setup.bash ]; then source /root/ws_droneOS/install/setup.bash; fi' >> /root/.bashrc

CMD ["bash"]
