# Stage 1: Build px4_msgs
FROM ros:humble AS builder

# Prevent interactive prompts
ENV DEBIAN_FRONTEND=noninteractive

# Use bash for RUN commands
SHELL ["/bin/bash", "-c"]

# Install build dependencies
RUN apt-get update && apt-get install -y \
    python3-colcon-common-extensions \
    ros-humble-rmw-fastrtps-cpp \
    build-essential \
    git \
    && rm -rf /var/lib/apt/lists/*

# Set up temporary build workspace
WORKDIR /ros2_ws
COPY src/px4_msgs /ros2_ws/src/px4_msgs

# Build only px4_msgs
RUN . /opt/ros/humble/setup.bash && \
    colcon build --packages-select px4_msgs

# Stage 2: Final application image
FROM ros:humble

# Prevent interactive prompts
ENV DEBIAN_FRONTEND=noninteractive

# Use bash for RUN commands
SHELL ["/bin/bash", "-c"]

# Install runtime dependencies (same as builder for now)
RUN apt-get update && apt-get install -y \
    python3-colcon-common-extensions \
    ros-humble-rmw-fastrtps-cpp \
    build-essential \
    git \
    && rm -rf /var/lib/apt/lists/*

# Copy pre-built px4_msgs from builder stage
COPY --from=builder /ros2_ws/install /opt/px4_install

# Set up final workspace
WORKDIR /root/ws_droneOS
# Copy application source code (excluding px4_msgs)
COPY src/drone_core /root/ws_droneOS/src/drone_core
COPY src/drone_interfaces /root/ws_droneOS/src/drone_interfaces
COPY src/drone_gcs_cli /root/ws_droneOS/src/drone_gcs_cli

# Build application packages, sourcing the pre-built px4_msgs
RUN . /opt/ros/humble/setup.bash && \
    . /opt/px4_install/setup.bash && \
    rm -rf build install log && \
    colcon build --packages-ignore px4_msgs microxrcedds_agent

# Copy and set the entrypoint
COPY ros_entrypoint.sh /ros_entrypoint.sh
RUN chmod +x /ros_entrypoint.sh
ENTRYPOINT ["/ros_entrypoint.sh"]

# Default CMD (can be overridden by docker-compose)
# CMD ["ros2", "run", "drone_os", "drone_core"]
