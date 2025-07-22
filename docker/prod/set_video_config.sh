#!/bin/bash

# === Drone Video Configuration Script ===
# Quick script to switch between video quality presets

ENV_FILE="/home/rodrigo/ws_droneOS/docker/prod/.env"

show_usage() {
    echo "Usage: $0 [ultra-low|low|medium|high|custom]"
    echo ""
    echo "Presets:"
    echo "  ultra-low  - 1fps @ 320p   (2-7MB/hr)   - 4G optimized"
    echo "  low        - 5fps @ 480p   (10-35MB/hr) - 4G limited use"  
    echo "  medium     - 10fps @ 720p  (50-150MB/hr) - WiFi only"
    echo "  high       - 15fps @ 1080p (200-500MB/hr) - WiFi demos"
    echo "  custom     - Edit .env file manually"
    echo ""
    echo "Current config:"
    grep "VIDEO_" "$ENV_FILE" | grep -v "^#"
}

set_config() {
    local preset=$1
    
    # Backup current config
    cp "$ENV_FILE" "$ENV_FILE.backup"
    
    case $preset in
        "ultra-low")
            sed -i 's/^VIDEO_WIDTH=.*/VIDEO_WIDTH=320/' "$ENV_FILE"
            sed -i 's/^VIDEO_HEIGHT=.*/VIDEO_HEIGHT=240/' "$ENV_FILE"
            sed -i 's/^VIDEO_FRAMERATE=.*/VIDEO_FRAMERATE=1/' "$ENV_FILE"
            sed -i 's/^VIDEO_QUALITY=.*/VIDEO_QUALITY=30/' "$ENV_FILE"
            echo "✅ Set to ultra-low bandwidth (1fps @ 320p)"
            echo "💰 Estimated cost: 40-100 flight hours per month"
            ;;
        "low")
            sed -i 's/^VIDEO_WIDTH=.*/VIDEO_WIDTH=640/' "$ENV_FILE"
            sed -i 's/^VIDEO_HEIGHT=.*/VIDEO_HEIGHT=480/' "$ENV_FILE" 
            sed -i 's/^VIDEO_FRAMERATE=.*/VIDEO_FRAMERATE=5/' "$ENV_FILE"
            sed -i 's/^VIDEO_QUALITY=.*/VIDEO_QUALITY=50/' "$ENV_FILE"
            echo "✅ Set to low bandwidth (5fps @ 480p)"
            echo "💰 Estimated cost: 14-50 flight hours per month"
            ;;
        "medium")
            sed -i 's/^VIDEO_WIDTH=.*/VIDEO_WIDTH=1280/' "$ENV_FILE"
            sed -i 's/^VIDEO_HEIGHT=.*/VIDEO_HEIGHT=720/' "$ENV_FILE"
            sed -i 's/^VIDEO_FRAMERATE=.*/VIDEO_FRAMERATE=10/' "$ENV_FILE"
            sed -i 's/^VIDEO_QUALITY=.*/VIDEO_QUALITY=60/' "$ENV_FILE"
            echo "✅ Set to medium bandwidth (10fps @ 720p)"
            echo "⚠️  WiFi recommended - 3-10 flight hours per month on 4G"
            ;;
        "high")
            sed -i 's/^VIDEO_WIDTH=.*/VIDEO_WIDTH=1920/' "$ENV_FILE"
            sed -i 's/^VIDEO_HEIGHT=.*/VIDEO_HEIGHT=1080/' "$ENV_FILE"
            sed -i 's/^VIDEO_FRAMERATE=.*/VIDEO_FRAMERATE=15/' "$ENV_FILE"
            sed -i 's/^VIDEO_QUALITY=.*/VIDEO_QUALITY=80/' "$ENV_FILE"
            echo "✅ Set to high bandwidth (15fps @ 1080p)"
            echo "⚠️  WiFi ONLY - 1-2.5 flight hours per month on 4G"
            ;;
        "custom")
            echo "Opening .env file for manual editing..."
            nano "$ENV_FILE"
            ;;
        *)
            show_usage
            exit 1
            ;;
    esac
    
    if [ "$preset" != "custom" ]; then
        echo ""
        echo "🔄 Restart docker-compose to apply changes:"
        echo "   cd /home/rodrigo/ws_droneOS/docker/prod"
        echo "   docker-compose down && docker-compose up -d"
    fi
}

if [ $# -eq 0 ]; then
    show_usage
    exit 1
fi

set_config "$1"