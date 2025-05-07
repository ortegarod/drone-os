#!/bin/bash
set -e

# Source ROS 2
source /opt/ros/humble/setup.bash

# Source our workspace
source /root/ws_droneOS/install/setup.bash

# Execute the command passed to docker run
exec "$@" 