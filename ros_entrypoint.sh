#!/bin/bash
set -e

# Source ROS 2 environment
source /opt/ros/humble/setup.bash

# Source pre-built px4_msgs environment if it exists
if [ -f /opt/px4_install/setup.bash ]; then
  source /opt/px4_install/setup.bash
fi

# Source local workspace environment if it exists
if [ -f /root/ws_droneOS/install/setup.bash ]; then
  source /root/ws_droneOS/install/setup.bash
fi

# Execute the command passed into the container
exec "$@" 