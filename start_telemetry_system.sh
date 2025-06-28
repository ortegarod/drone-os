#!/bin/bash

# Start Telemetry System - Complete rosbridge integration startup script
# This script starts all components needed for real-time drone telemetry

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WORKSPACE_DIR="$SCRIPT_DIR"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
DRONE_NAMESPACE=${1:-"px4_1"}
ROSBRIDGE_PORT=${2:-9090}
BUILD_FIRST=${3:-"false"}

echo -e "${BLUE}🚁 Starting Drone Telemetry System${NC}"
echo -e "${BLUE}======================================${NC}"
echo "Drone Namespace: $DRONE_NAMESPACE"
echo "Rosbridge Port: $ROSBRIDGE_PORT"
echo "Workspace: $WORKSPACE_DIR"
echo ""

# Function to check if a process is running
check_process() {
    if pgrep -f "$1" > /dev/null; then
        return 0
    else
        return 1
    fi
}

# Function to wait for a service to be available
wait_for_service() {
    local service_name="$1"
    local timeout="$2"
    local count=0
    
    echo -n "Waiting for $service_name..."
    while [ $count -lt $timeout ]; do
        if ros2 service list | grep -q "$service_name"; then
            echo -e " ${GREEN}✓${NC}"
            return 0
        fi
        sleep 1
        count=$((count + 1))
        echo -n "."
    done
    echo -e " ${RED}✗ Timeout${NC}"
    return 1
}

# Function to wait for a topic to be available
wait_for_topic() {
    local topic_name="$1"
    local timeout="$2"
    local count=0
    
    echo -n "Waiting for $topic_name..."
    while [ $count -lt $timeout ]; do
        if ros2 topic list | grep -q "$topic_name"; then
            echo -e " ${GREEN}✓${NC}"
            return 0
        fi
        sleep 1
        count=$((count + 1))
        echo -n "."
    done
    echo -e " ${RED}✗ Timeout${NC}"
    return 1
}

# Cleanup function for graceful shutdown
cleanup() {
    echo -e "\n${YELLOW}🛑 Shutting down telemetry system...${NC}"
    
    # Kill background processes
    if [ ! -z "$ROSBRIDGE_PID" ]; then
        echo "Stopping rosbridge server..."
        kill $ROSBRIDGE_PID 2>/dev/null || true
    fi
    
    if [ ! -z "$MOCK_PUBLISHER_PID" ]; then
        echo "Stopping mock publisher..."
        kill $MOCK_PUBLISHER_PID 2>/dev/null || true
    fi
    
    echo -e "${GREEN}✓ Cleanup complete${NC}"
    exit 0
}

# Set trap for cleanup on script exit
trap cleanup EXIT INT TERM

# Step 1: Check ROS2 environment
echo -e "${BLUE}📋 Checking ROS2 environment...${NC}"
if [ -z "$ROS_DISTRO" ]; then
    echo -e "${RED}✗ ROS2 not sourced. Please run: source /opt/ros/<distro>/setup.bash${NC}"
    exit 1
fi
echo -e "${GREEN}✓ ROS2 $ROS_DISTRO environment active${NC}"

# Step 2: Source workspace
echo -e "${BLUE}📦 Sourcing workspace...${NC}"
if [ -f "$WORKSPACE_DIR/install/setup.bash" ]; then
    source "$WORKSPACE_DIR/install/setup.bash"
    echo -e "${GREEN}✓ Workspace sourced${NC}"
else
    echo -e "${YELLOW}⚠ Workspace not built. Building now...${NC}"
    BUILD_FIRST="true"
fi

# Step 3: Build workspace if needed
if [ "$BUILD_FIRST" = "true" ]; then
    echo -e "${BLUE}🔨 Building workspace...${NC}"
    cd "$WORKSPACE_DIR"
    colcon build --packages-select drone_core drone_interfaces rosbridge_suite
    if [ $? -eq 0 ]; then
        echo -e "${GREEN}✓ Build successful${NC}"
        source install/setup.bash
    else
        echo -e "${RED}✗ Build failed${NC}"
        exit 1
    fi
fi

# Step 4: Check for rosbridge_suite
echo -e "${BLUE}🌐 Checking rosbridge installation...${NC}"
if [ -d "$WORKSPACE_DIR/rosbridge_suite" ]; then
    echo -e "${GREEN}✓ Rosbridge suite found in workspace${NC}"
    ROSBRIDGE_LAUNCH="$WORKSPACE_DIR/rosbridge_launch.py"
else
    echo -e "${YELLOW}⚠ Using system rosbridge${NC}"
    ROSBRIDGE_LAUNCH="ros2 run rosbridge_server rosbridge_websocket"
fi

# Step 5: Start rosbridge server
echo -e "${BLUE}🚀 Starting rosbridge WebSocket server...${NC}"
if check_process "rosbridge_websocket"; then
    echo -e "${YELLOW}⚠ Rosbridge already running${NC}"
else
    if [ -f "$ROSBRIDGE_LAUNCH" ]; then
        python3 "$ROSBRIDGE_LAUNCH" --port $ROSBRIDGE_PORT &
        ROSBRIDGE_PID=$!
    else
        ros2 run rosbridge_server rosbridge_websocket --port $ROSBRIDGE_PORT &
        ROSBRIDGE_PID=$!
    fi
    
    # Wait for rosbridge to start
    sleep 3
    if check_process "rosbridge_websocket"; then
        echo -e "${GREEN}✓ Rosbridge server started on port $ROSBRIDGE_PORT${NC}"
    else
        echo -e "${RED}✗ Failed to start rosbridge server${NC}"
        exit 1
    fi
fi

# Step 6: Check for existing drone system
echo -e "${BLUE}🔍 Checking for drone system...${NC}"
DRONE_RUNNING=false
if wait_for_topic "/$DRONE_NAMESPACE/fmu/out/vehicle_status" 10; then
    echo -e "${GREEN}✓ Real drone system detected${NC}"
    DRONE_RUNNING=true
elif wait_for_topic "/$DRONE_NAMESPACE/drone_state" 5; then
    echo -e "${GREEN}✓ Existing drone state publisher detected${NC}"
    DRONE_RUNNING=true
else
    echo -e "${YELLOW}⚠ No drone system detected, starting mock publisher${NC}"
fi

# Step 7: Start mock publisher if needed
if [ "$DRONE_RUNNING" = false ]; then
    echo -e "${BLUE}🤖 Starting mock drone publisher...${NC}"
    python3 "$WORKSPACE_DIR/test_rosbridge_integration.py" \
        --drone-namespace "$DRONE_NAMESPACE" \
        --port "$ROSBRIDGE_PORT" \
        --test-duration 0 &  # 0 = run indefinitely
    MOCK_PUBLISHER_PID=$!
    
    # Wait for mock data to start flowing
    if wait_for_topic "/$DRONE_NAMESPACE/drone_state" 10; then
        echo -e "${GREEN}✓ Mock publisher started${NC}"
    else
        echo -e "${RED}✗ Failed to start mock publisher${NC}"
        exit 1
    fi
fi

# Step 8: Verify integration
echo -e "${BLUE}🧪 Verifying integration...${NC}"

# Check WebSocket connectivity
echo -n "Testing WebSocket connection..."
if timeout 5 bash -c "echo '' | nc -w 1 localhost $ROSBRIDGE_PORT" 2>/dev/null; then
    echo -e " ${GREEN}✓${NC}"
else
    echo -e " ${RED}✗${NC}"
    echo -e "${RED}WebSocket connection failed${NC}"
fi

# Check topic publishing
echo -n "Checking topic data flow..."
if timeout 5 ros2 topic echo "/$DRONE_NAMESPACE/drone_state" --once >/dev/null 2>&1; then
    echo -e " ${GREEN}✓${NC}"
else
    echo -e " ${RED}✗${NC}"
    echo -e "${RED}No data on drone_state topic${NC}"
fi

# Step 9: Display status and instructions
echo ""
echo -e "${GREEN}🎉 Telemetry system started successfully!${NC}"
echo -e "${BLUE}================================================${NC}"
echo ""
echo -e "${YELLOW}📡 System Status:${NC}"
echo "  • Rosbridge WebSocket: ws://localhost:$ROSBRIDGE_PORT"
echo "  • Drone Namespace: $DRONE_NAMESPACE"
echo "  • State Topic: /$DRONE_NAMESPACE/drone_state"
echo "  • Service: /$DRONE_NAMESPACE/get_state"
echo ""
echo -e "${YELLOW}🌐 Frontend Integration:${NC}"
echo "  1. Start your web interface:"
echo "     cd web_interface/frontend && npm start"
echo ""
echo "  2. Add status bar to your React app:"
echo "     import { RealTimeStatusBar } from './components/RealTimeStatusBar';"
echo "     <RealTimeStatusBar droneNamespace=\"$DRONE_NAMESPACE\" />"
echo ""
echo -e "${YELLOW}🔧 Testing:${NC}"
echo "  • WebSocket test: wscat -c ws://localhost:$ROSBRIDGE_PORT"
echo "  • Topic test: ros2 topic echo /$DRONE_NAMESPACE/drone_state"
echo "  • Service test: ros2 service call /$DRONE_NAMESPACE/get_state drone_interfaces/srv/GetState"
echo ""
echo -e "${YELLOW}📊 Monitoring:${NC}"
echo "  • View logs: ros2 topic echo /rosout"
echo "  • Check connections: lsof -i :$ROSBRIDGE_PORT"
echo ""

# Step 10: Keep running and monitor
echo -e "${BLUE}🔄 System running... Press Ctrl+C to stop${NC}"
echo ""

# Monitor system health
while true; do
    sleep 30
    
    # Check if rosbridge is still running
    if ! check_process "rosbridge_websocket"; then
        echo -e "${RED}⚠ Rosbridge server stopped unexpectedly${NC}"
        break
    fi
    
    # Check if we have recent data
    LAST_MSG=$(timeout 2 ros2 topic echo "/$DRONE_NAMESPACE/drone_state" --once 2>/dev/null || echo "")
    if [ -z "$LAST_MSG" ]; then
        echo -e "${YELLOW}⚠ No recent data on drone_state topic${NC}"
    else
        echo -e "${GREEN}✓ System healthy - $(date)${NC}"
    fi
done

echo -e "${RED}System monitoring stopped${NC}"