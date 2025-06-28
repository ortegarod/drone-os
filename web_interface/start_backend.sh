#!/bin/bash

# DroneOS Command Center - Backend Startup Script

echo "🚁 Starting DroneOS Command Center Backend..."

# Check if we're in the right directory
if [ ! -f "backend/ros2_web_bridge.py" ]; then
    echo "❌ Error: Must run from web_interface directory"
    echo "Usage: cd web_interface && ./start_backend.sh"
    exit 1
fi

# Source ROS2 environment
echo "🔧 Sourcing ROS2 environment..."
source /opt/ros/humble/setup.bash
source ~/ws_droneOS/install/setup.bash

# Check if ROS2 environment is properly sourced
if [ -z "$ROS_DISTRO" ]; then
    echo "❌ Error: ROS2 environment not properly sourced"
    echo "Please make sure ROS2 is installed and your workspace is built"
    exit 1
fi

echo "✅ ROS2 environment sourced: $ROS_DISTRO"

# Install Python dependencies globally (no venv needed for ROS2)
echo "📦 Installing Python dependencies..."
pip3 install --user fastapi uvicorn websockets pydantic

echo "🐍 Using system Python with ROS2 environment..."

# Start the ROS2-Web bridge
echo "🌐 Starting ROS2-Web Bridge on http://localhost:8000"
echo "📡 WebSocket endpoint: ws://localhost:8000/ws"
echo ""
echo "Press Ctrl+C to stop..."

cd backend
python3 ros2_web_bridge.py