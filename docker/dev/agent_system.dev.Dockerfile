# Dockerfile for the AI Drone Agent System (Development)

FROM ros:humble-ros-base

# Set shell to bash
SHELL ["/bin/bash", "-c"]

# Set up working directory
WORKDIR /root/ws_droneOS

# Install Python, pip, and other dependencies
RUN apt-get update && apt-get install -y \
    python3-pip \
    python3-venv \
    git \
    && rm -rf /var/lib/apt/lists/*

# Install OpenAI Agents SDK and other Python dependencies
# We can also use a requirements.txt if it grows
RUN pip3 install openai-agents

# Copy all source code
COPY src /root/ws_droneOS/src

# Remove px4_msgs and drone_core to speed up build as they are not directly used by the agent_system_service
RUN rm -rf /root/ws_droneOS/src/px4_msgs && \
    rm -rf /root/ws_droneOS/src/drone_core

# Build the ROS 2 workspace
# This will build packages like drone_interfaces, making them available.
RUN source /opt/ros/humble/setup.bash && \
    cd /root/ws_droneOS && \
    colcon build --symlink-install

# Setup entrypoint
COPY docker/dev/ros_entrypoint_agent.sh /ros_entrypoint_agent.sh
RUN chmod +x /ros_entrypoint_agent.sh
ENTRYPOINT ["/ros_entrypoint_agent.sh"]

# Default command to run the basic agent
CMD ["python3", "src/drone_agent_system/run_basic_agent.py"]
