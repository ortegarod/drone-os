# Base image with ROS 2 Humble
FROM ros:humble

# Prevent interactive prompts
ENV DEBIAN_FRONTEND=noninteractive

# Install dependencies
RUN apt-get update && apt-get install -y \
    python3-colcon-common-extensions \
    ros-humble-rmw-fastrtps-cpp \
    build-essential \
    git \
    && rm -rf /var/lib/apt/lists/*

# Set up workspace
WORKDIR /root/ws_droneOS
COPY . /root/ws_droneOS

# Clean and build ROS 2 packages, skipping microxrcedds_agent (now external)
RUN . /opt/ros/humble/setup.sh && \
    rm -rf build install log && \
    colcon build --packages-ignore microxrcedds_agent

# Source setup and run main ROS node
CMD ["bash", "-c", "source /opt/ros/humble/setup.bash && source install/setup.bash && ros2 run drone_os drone_core"]
