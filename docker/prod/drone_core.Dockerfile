# === drone_core.Dockerfile ===
#
# - This is for deploying to a real drone (Raspberry Pi)
# - The container will have all dependencies AND the final code
# - No source code is mounted, uses the code built into the container
# - Optimized for deployment on Raspberry Pi
# - Used with real PX4 flight controller
#
# Stage 1: Build px4_msgs
# This stage builds the PX4 message definitions that are needed by both
# development and production environments. We separate this to avoid
# rebuilding these messages when only our application code changes.
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
# This stage creates the final image that can be used for both:
# 1. Development (SITL): Source code is mounted, allowing for quick rebuilds
# 2. Production (Real Drone): Code is built in, no source code needed
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
RUN mkdir -p /opt/px4_install
COPY --from=builder /ros2_ws/install /opt/px4_install

# Set up workspace directory
WORKDIR /root/ws_droneOS

# Copy application source code (excluding px4_msgs)
# Note: In development, these will be overlaid by volume mounts
# In production, these will be the final code
COPY src/drone_core /root/ws_droneOS/src/drone_core
COPY src/drone_interfaces /root/ws_droneOS/src/drone_interfaces

# Build application packages, sourcing the pre-built px4_msgs
# This ensures we have a working build in the container
# In development, these will be overlaid by volume mounts
RUN . /opt/ros/humble/setup.bash && \
    . /opt/px4_install/setup.bash && \
    rm -rf build install log && \
    colcon build --packages-select drone_core drone_interfaces

# Copy and set the entrypoint
COPY ros_entrypoint.sh /ros_entrypoint.sh
RUN chmod +x /ros_entrypoint.sh
ENTRYPOINT ["/ros_entrypoint.sh"]

# Default CMD (can be overridden by docker-compose)
# CMD ["ros2", "run", "drone_os", "drone_core"]
