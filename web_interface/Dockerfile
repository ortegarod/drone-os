# === Development Web Interface Dockerfile ===
#
# NOTE: This is a MONOLITHIC container that bundles frontend + backend + ROS2
# together for local development. It is NOT suitable for separate deployment
# of frontend and backend services.
#
# For separate microservice deployment:
# - Frontend-only: Create a Node.js container that builds and serves React app
# - Backend-only: Create a ROS2 container that runs just the Python FastAPI server
#
# This container is used by docker-compose.web.yml for integrated local development.
#

FROM ros:humble

# Install Python dependencies and Node.js
RUN apt-get update && apt-get install -y \
    python3-pip \
    nodejs \
    npm \
    && rm -rf /var/lib/apt/lists/*

# Install Python packages
RUN pip3 install fastapi uvicorn websockets pydantic

# Set working directory
WORKDIR /root/ws_droneOS

# Expose ports
EXPOSE 8000 3000

# Default command will be overridden by docker-compose
CMD ["bash"]