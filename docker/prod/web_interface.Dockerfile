# === Production Web Interface Dockerfile ===
#
# Multi-stage build for optimized production deployment
# Builds React frontend and serves via nginx + Python backend
#

# Stage 1: Build React frontend
FROM node:18-alpine AS frontend-build

WORKDIR /app
COPY web_interface/frontend/package*.json ./
RUN npm ci --only=production

COPY web_interface/frontend/ ./
RUN npm run build

# Stage 2: Production runtime with ROS2 and nginx
FROM ros:humble

# Install system dependencies
RUN apt-get update && apt-get install -y \
    nginx \
    python3-pip \
    python3-colcon-common-extensions \
    ros-humble-rmw-fastrtps-cpp \
    build-essential \
    git \
    && rm -rf /var/lib/apt/lists/*

# Install Python dependencies
RUN pip3 install fastapi uvicorn websockets pydantic

# Set up nginx configuration
COPY docker/prod/nginx.conf /etc/nginx/nginx.conf

# Copy frontend build
COPY --from=frontend-build /app/dist /var/www/html/

# Set up DroneOS workspace
WORKDIR /root/ws_droneOS

# Copy source code
COPY src/ src/
COPY web_interface/ web_interface/

# Build ROS2 packages
RUN source /opt/ros/humble/setup.bash && \
    colcon build --packages-select drone_interfaces px4_msgs

# Set up entrypoint
COPY docker/prod/web_entrypoint.sh /usr/local/bin/
RUN chmod +x /usr/local/bin/web_entrypoint.sh

# Expose ports
EXPOSE 80 8000

# Source ROS2 setup
RUN echo 'source /opt/ros/humble/setup.bash' >> /root/.bashrc && \
    echo 'source /root/ws_droneOS/install/setup.bash' >> /root/.bashrc

ENTRYPOINT ["/usr/local/bin/web_entrypoint.sh"]