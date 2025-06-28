#!/bin/bash

# Complete Telemetry System Launcher
# This script starts the full rosbridge + telemetry publishing stack for web-based drone monitoring

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
DRONE_NAMESPACES=${DRONE_NAMESPACES:-"px4_1"}
ROSBRIDGE_PORT=${ROSBRIDGE_PORT:-9090}
TELEMETRY_RATE=${TELEMETRY_RATE:-10}
WORKSPACE_DIR=${WORKSPACE_DIR:-"/home/rodrigo/ws_droneOS"}

echo -e "${BLUE}================================================================${NC}"
echo -e "${BLUE}          DroneOS Real-time Telemetry System Launcher          ${NC}"
echo -e "${BLUE}================================================================${NC}"
echo ""
echo -e "${GREEN}Configuration:${NC}"
echo -e "  Workspace: ${WORKSPACE_DIR}"
echo -e "  Drone Namespaces: ${DRONE_NAMESPACES}"
echo -e "  Rosbridge Port: ${ROSBRIDGE_PORT}"
echo -e "  Telemetry Rate: ${TELEMETRY_RATE} Hz"
echo ""

# Function to check if a command exists
command_exists() {
    command -v "$1" >/dev/null 2>&1
}

# Function to check if a ROS package exists
package_exists() {
    ros2 pkg list | grep -q "^$1$"
}

# Function to wait for rosbridge to be ready
wait_for_rosbridge() {
    echo -e "${YELLOW}Waiting for rosbridge to be ready...${NC}"
    local max_attempts=30
    local attempt=1
    
    while [ $attempt -le $max_attempts ]; do
        if netstat -tuln 2>/dev/null | grep -q ":${ROSBRIDGE_PORT} "; then
            echo -e "${GREEN}Rosbridge is ready on port ${ROSBRIDGE_PORT}${NC}"
            return 0
        fi
        echo -e "  Attempt ${attempt}/${max_attempts}..."
        sleep 1
        ((attempt++))
    done
    
    echo -e "${RED}ERROR: Rosbridge failed to start within ${max_attempts} seconds${NC}"
    return 1
}

# Function to cleanup background processes
cleanup() {
    echo ""
    echo -e "${YELLOW}Shutting down telemetry system...${NC}"
    
    # Kill all background jobs
    jobs -p | xargs -r kill -TERM 2>/dev/null || true
    
    # Wait a moment for graceful shutdown
    sleep 2
    
    # Force kill any remaining processes
    jobs -p | xargs -r kill -KILL 2>/dev/null || true
    
    echo -e "${GREEN}Telemetry system shut down complete${NC}"
    exit 0
}

# Set up signal handlers
trap cleanup SIGINT SIGTERM

# Validate environment
echo -e "${YELLOW}Validating environment...${NC}"

# Check if ROS2 is sourced
if ! command_exists ros2; then
    echo -e "${RED}ERROR: ROS2 not found. Please source your ROS2 installation.${NC}"
    exit 1
fi

# Check if workspace is built
if [ ! -f "${WORKSPACE_DIR}/install/setup.bash" ]; then
    echo -e "${RED}ERROR: Workspace not built. Please run 'colcon build' first.${NC}"
    exit 1
fi

# Source the workspace
echo -e "${YELLOW}Sourcing workspace...${NC}"
source "${WORKSPACE_DIR}/install/setup.bash"

# Check required packages
required_packages=("rosbridge_server" "drone_interfaces" "drone_core")
for package in "${required_packages[@]}"; do
    if ! package_exists "$package"; then
        echo -e "${RED}ERROR: Package '${package}' not found. Please build the workspace.${NC}"
        exit 1
    fi
done

echo -e "${GREEN}Environment validation complete${NC}"
echo ""

# Start rosbridge WebSocket server
echo -e "${YELLOW}Starting rosbridge WebSocket server...${NC}"
ros2 run rosbridge_server rosbridge_websocket --port ${ROSBRIDGE_PORT} &
ROSBRIDGE_PID=$!
echo -e "  Started rosbridge (PID: ${ROSBRIDGE_PID})"

# Wait for rosbridge to be ready
if ! wait_for_rosbridge; then
    cleanup
    exit 1
fi

# Start telemetry publisher
echo -e "${YELLOW}Starting telemetry publisher...${NC}"
ros2 run drone_core telemetry_publisher \
    --ros-args \
    -p drone_namespaces:="[${DRONE_NAMESPACES}]" \
    -p publish_rate_hz:=${TELEMETRY_RATE} \
    -p enable_rosbridge_topics:=true \
    -p enable_get_state_services:=true &
TELEMETRY_PID=$!
echo -e "  Started telemetry publisher (PID: ${TELEMETRY_PID})"

# Give services time to initialize
sleep 3

echo ""
echo -e "${GREEN}================================================================${NC}"
echo -e "${GREEN}            Telemetry System Successfully Started              ${NC}"
echo -e "${GREEN}================================================================${NC}"
echo ""
echo -e "${GREEN}Services running:${NC}"
echo -e "  📡 Rosbridge WebSocket: ws://localhost:${ROSBRIDGE_PORT}"
echo -e "  📊 Telemetry Publisher: Active (${TELEMETRY_RATE} Hz)"
echo ""
echo -e "${GREEN}Available topics:${NC}"
for ns in ${DRONE_NAMESPACES//,/ }; do
    echo -e "  🚁 /${ns}/drone_state (drone_interfaces/DroneState)"
    echo -e "  🔧 /${ns}/get_state (drone_interfaces/GetState)"
done
echo ""
echo -e "${GREEN}Frontend connection:${NC}"
echo -e "  const ros = new WebSocket('ws://localhost:${ROSBRIDGE_PORT}');"
echo ""
echo -e "${YELLOW}Press Ctrl+C to stop the telemetry system${NC}"
echo ""

# Monitor system status
while true; do
    sleep 10
    
    # Check if rosbridge is still running
    if ! kill -0 $ROSBRIDGE_PID 2>/dev/null; then
        echo -e "${RED}ERROR: Rosbridge process died${NC}"
        cleanup
        exit 1
    fi
    
    # Check if telemetry publisher is still running
    if ! kill -0 $TELEMETRY_PID 2>/dev/null; then
        echo -e "${RED}ERROR: Telemetry publisher process died${NC}"
        cleanup
        exit 1
    fi
    
    # Print periodic status
    echo -e "${BLUE}[$(date '+%H:%M:%S')] Telemetry system running - Rosbridge: ✓ Telemetry: ✓${NC}"
done