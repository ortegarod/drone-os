# === Frontend Development Dockerfile ===
#
# Runs the React frontend with hot reload for development.
# Connects to rosbridge_server (port 9090) for ROS2 communication.
#

FROM node:18-slim

WORKDIR /app

# Install dependencies first (cached layer)
COPY web_interface/frontend/package*.json ./
RUN npm install

# Source is mounted at runtime for hot reload
# No COPY of source here - that would break hot reload

EXPOSE 3000

CMD ["npm", "start"]
