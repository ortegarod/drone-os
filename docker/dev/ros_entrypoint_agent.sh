#!/bin/bash
set -e

# Source ROS 2 Humble setup
source /opt/ros/humble/setup.bash

# Source the workspace setup, if it exists
# The agent system itself doesn't have a colcon build workspace in the traditional sense
# for its Python scripts, but if it were part of a larger ROS 2 workspace build,
# this would be relevant. For now, this might not find a specific agent workspace setup.
if [ -f /root/ws_droneOS/install/setup.bash ]; then
  source /root/ws_droneOS/install/setup.bash
  echo "Sourced /root/ws_droneOS/install/setup.bash"
fi

# Execute the command passed to docker run (or the CMD in Dockerfile)
exec "$@"
