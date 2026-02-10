#!/bin/bash
# VPS Setup Script - Run this on fresh Vultr Ubuntu 22.04 instance
# Usage: bash vps_setup.sh

set -e

echo "🚀 DroneOS VPS Setup - Cloud Command Center"
echo "==========================================="

# Update system
echo "📦 Updating system packages..."
sudo apt update && sudo apt upgrade -y

# Install base dependencies
echo "📦 Installing base dependencies..."
sudo apt install -y \
    git \
    curl \
    build-essential \
    ca-certificates \
    gnupg \
    lsb-release

# Install Node.js (for OpenClaw)
echo "📦 Installing Node.js..."
if ! command -v nvm &> /dev/null; then
    curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash
    export NVM_DIR="$HOME/.nvm"
    [ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"
fi
nvm install 22
nvm use 22
nvm alias default 22

# Install Docker
echo "🐳 Installing Docker..."
if ! command -v docker &> /dev/null; then
    curl -fsSL https://get.docker.com -o get-docker.sh
    sudo sh get-docker.sh
    sudo usermod -aG docker $USER
    echo "⚠️  Docker installed. Please log out and back in for group membership to take effect."
fi

# Install Docker Compose plugin (should come with Docker, but verify)
if ! docker compose version &> /dev/null; then
    echo "⚠️  Docker Compose plugin not found. Installing..."
    sudo apt install -y docker-compose-plugin
fi

# Install OpenClaw
echo "🤖 Installing OpenClaw..."
npm install -g openclaw

# Verify installations
echo ""
echo "✅ Installation Summary:"
node --version
npm --version
docker --version
docker compose version
openclaw --version || echo "⚠️  OpenClaw not in PATH yet - may need to restart shell"

# Initialize OpenClaw (will be overwritten by migration)
echo ""
echo "📋 Initializing OpenClaw (this will be replaced by srv01 state)..."
openclaw init || echo "⚠️  OpenClaw init failed - will be fixed by migration"

# Clone DroneOS repo (if not already done)
if [ ! -d "$HOME/ws_droneOS" ]; then
    echo "📂 Cloning DroneOS repository..."
    cd ~
    git clone https://github.com/ortegarod/ws_droneOS.git
    cd ws_droneOS
else
    echo "📂 DroneOS repository already exists at $HOME/ws_droneOS"
fi

# Set up firewall
echo "🔥 Configuring firewall..."
sudo ufw allow 22/tcp      # SSH
sudo ufw allow 3000/tcp    # Frontend
sudo ufw allow 9090/tcp    # rosbridge
sudo ufw allow 8000/tcp    # openclaw_proxy
sudo ufw allow 8080/tcp    # Camera feed (optional)
sudo ufw --force enable

echo ""
echo "✅ VPS setup complete!"
echo ""
echo "Next steps:"
echo "1. Log out and back in (or run: newgrp docker)"
echo ""
echo "2. Migrate OpenClaw from srv01:"
echo "   On srv01:"
echo "     openclaw gateway stop"
echo "     cd ~ && tar -czf openclaw-state.tgz .openclaw"
echo "     scp openclaw-state.tgz user@$(curl -s ifconfig.me):~/"
echo ""
echo "   On VPS:"
echo "     cd ~ && tar -xzf openclaw-state.tgz"
echo "     chown -R \$USER:\$USER ~/.openclaw"
echo "     openclaw doctor"
echo "     openclaw gateway start"
echo ""
echo "3. Start Docker services:"
echo "   cd ~/ws_droneOS && docker compose -f docker/vps/docker-compose.vps.yml up -d"
echo ""
echo "4. Verify:"
echo "   openclaw status"
echo "   Access frontend at: http://$(curl -s ifconfig.me):3000"
