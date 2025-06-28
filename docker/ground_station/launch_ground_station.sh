#!/bin/bash

# Ground Station Telemetry System Launcher
# Starts rosbridge + telemetry publisher in Docker containers

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}================================================================${NC}"
echo -e "${BLUE}              DroneOS Ground Station Launcher                  ${NC}"
echo -e "${BLUE}================================================================${NC}"
echo ""

# Function to check if Docker is running
check_docker() {
    if ! docker info >/dev/null 2>&1; then
        echo -e "${RED}ERROR: Docker is not running. Please start Docker first.${NC}"
        exit 1
    fi
}

# Function to check if workspace is built
check_workspace() {
    if [ ! -f "../../install/setup.bash" ]; then
        echo -e "${RED}ERROR: Workspace not built. Please run 'colcon build' first.${NC}"
        exit 1
    fi
}

# Function to cleanup containers
cleanup() {
    echo ""
    echo -e "${YELLOW}Stopping ground station containers...${NC}"
    docker compose -f docker-compose.ground.yml down
    echo -e "${GREEN}Ground station stopped${NC}"
    exit 0
}

# Set up signal handlers
trap cleanup SIGINT SIGTERM

echo -e "${YELLOW}Validating environment...${NC}"
check_docker
check_workspace

echo -e "${YELLOW}Building and starting ground station containers...${NC}"
docker compose -f docker-compose.ground.yml up --build -d

echo ""
echo -e "${GREEN}================================================================${NC}"
echo -e "${GREEN}            Ground Station Successfully Started                 ${NC}"
echo -e "${GREEN}================================================================${NC}"
echo ""
echo -e "${GREEN}Services running:${NC}"
echo -e "  📡 Rosbridge WebSocket: ws://localhost:9090"
echo -e "  📊 Telemetry Publisher: Active"
echo ""
echo -e "${GREEN}Available topics:${NC}"
echo -e "  🚁 /px4_1/drone_state (drone_interfaces/DroneState)"
echo -e "  🔧 /px4_1/get_state (drone_interfaces/GetState)"
echo ""
echo -e "${GREEN}Frontend connection:${NC}"
echo -e "  const ros = new WebSocket('ws://localhost:9090');"
echo ""
echo -e "${GREEN}Container logs:${NC}"
echo -e "  docker logs -f rosbridge_server"
echo -e "  docker logs -f telemetry_publisher"
echo ""
echo -e "${YELLOW}Press Ctrl+C to stop the ground station${NC}"

# Follow logs
docker compose -f docker-compose.ground.yml logs -f