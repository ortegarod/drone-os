#!/bin/bash

# DroneOS Command Center - Frontend Startup Script

echo "🖥️  Starting DroneOS Command Center Frontend..."

# Check if we're in the right directory
if [ ! -f "frontend/package.json" ]; then
    echo "❌ Error: Must run from web_interface directory"
    echo "Usage: cd web_interface && ./start_frontend.sh"
    exit 1
fi

cd frontend

# Install dependencies if needed
if [ ! -d "node_modules" ]; then
    echo "📦 Installing Node.js dependencies..."
    npm install
fi

# Start the React development server
echo "🚀 Starting React development server on http://localhost:3000"
echo ""
echo "The browser should open automatically."
echo "If not, navigate to: http://localhost:3000"
echo ""
echo "Press Ctrl+C to stop..."

npm start