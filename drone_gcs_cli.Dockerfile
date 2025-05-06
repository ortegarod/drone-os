FROM ros:humble

# Prevent interactive prompts
ENV DEBIAN_FRONTEND=noninteractive

# Use bash for RUN commands
SHELL ["/bin/bash", "-c"]

# Install runtime dependencies
RUN apt-get update && apt-get install -y \
    python3-colcon-common-extensions \
    ros-humble-rmw-fastrtps-cpp \
    && rm -rf /var/lib/apt/lists/*

# Set up workspace
WORKDIR /root/ws_droneOS

# Copy only the necessary packages
COPY src/drone_interfaces /root/ws_droneOS/src/drone_interfaces
COPY src/drone_gcs_cli /root/ws_droneOS/src/drone_gcs_cli

# Build packages and verify installation
RUN . /opt/ros/humble/setup.bash && \
    rm -rf build install log && \
    colcon build --packages-select drone_interfaces drone_gcs_cli && \
    . install/setup.bash && \
    # Verify the package is installed
    ros2 pkg list | grep drone_gcs_cli && \
    # Verify the executable exists
    ls -l install/drone_gcs_cli/lib/drone_gcs_cli/

# Copy and set the entrypoint
COPY ros_entrypoint.sh /ros_entrypoint.sh
RUN chmod +x /ros_entrypoint.sh

ENTRYPOINT ["/ros_entrypoint.sh"]

# Default CMD (can be overridden by docker-compose)
CMD ["ros2", "run", "drone_gcs_cli", "drone_gcs_cli"] 