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