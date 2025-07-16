#!/bin/bash

# DroneOS Production Web Interface Entrypoint
# Starts nginx and Python backend services

set -e

echo "🚀 Starting DroneOS Production Web Interface..."

# Source ROS2 environment
source /opt/ros/humble/setup.bash
source /root/ws_droneOS/install/setup.bash

# Start nginx in background
echo "📦 Starting nginx web server..."
nginx

# Wait for rosbridge to be available
echo "⏳ Waiting for rosbridge connection..."
timeout=30
count=0
while ! curl -s http://localhost:9090 > /dev/null 2>&1; do
    if [ $count -ge $timeout ]; then
        echo "❌ Timeout waiting for rosbridge"
        exit 1
    fi
    sleep 1
    count=$((count + 1))
done

echo "✅ rosbridge connection established"

# Start Python backend
echo "🐍 Starting Python backend..."
cd /root/ws_droneOS/web_interface/backend
exec python3 ros2_web_bridge.py