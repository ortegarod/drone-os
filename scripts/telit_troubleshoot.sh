#!/bin/bash

# Telit Cellular Module Troubleshooting Script
# This script runs AT commands to diagnose cellular connectivity issues

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Function to print colored output
print_status() {
    local color=$1
    local message=$2
    echo -e "${color}${message}${NC}"
}

# Function to run AT command and show result
run_at_command() {
    local command=$1
    local description=$2
    local expected=$3

    echo
    print_status $YELLOW "Testing: $description"
    echo "Command: $command"

    # Device to use for AT commands
    local device="/dev/ttyUSB3"

    if [ ! -e "$device" ]; then
        print_status $RED "ERROR: Device $device not found!"
        echo "Available USB devices:"
        ls /dev/ttyUSB* 2>/dev/null || echo "None found"
        return 1
    fi

    # Configure serial port and send AT command
    print_status $YELLOW "Sending command to $device..."

    # Configure port properly for AT commands
    stty -F $device 115200 -echo -ixon -ixoff -icrnl -opost 2>/dev/null || {
        print_status $RED "Cannot configure $device - may be busy"
        echo "  Try: sudo fuser -k $device"
        return 1
    }

    # Send AT command with carriage return (required for modems)
    printf "${command}\r" > $device

    # Wait and read response
    sleep 0.5
    response=$(timeout 2 cat $device 2>/dev/null | tr -d '\0')

    if [ ! -z "$response" ]; then
        print_status $GREEN "Response received:"
        echo "$response" | sed 's/^/  /'
    else
        print_status $RED "No response or timeout"
        echo "  Device may be busy with ModemManager"
        echo "  Try: sudo systemctl stop ModemManager (temporarily)"
    fi

    if [ ! -z "$expected" ]; then
        echo "Expected: $expected"
    fi

    echo "----------------------------------------"
    sleep 1
}

echo "==================================================="
echo "Telit Cellular Module Troubleshooting Script"
echo "==================================================="

print_status $YELLOW "PRELIMINARY CHECKS"
echo

# Check if wwan0 interface exists
if ip addr show wwan0 >/dev/null 2>&1; then
    print_status $GREEN "✓ wwan0 interface exists"
    ip addr show wwan0 | grep -E "(inet|state)"
else
    print_status $RED "✗ wwan0 interface not found"
    echo "Try: sudo dhclient -v wwan0"
    echo "Or reboot system and check SIM/antenna/module/USB"
fi

echo

# Check if nameserver is configured
if grep -q "8.8.8.8" /etc/resolv.conf 2>/dev/null; then
    print_status $GREEN "✓ DNS server 8.8.8.8 configured"
else
    print_status $YELLOW "! Consider adding 'nameserver 8.8.8.8' to /etc/resolv.conf"
fi

echo
echo "==================================================="
print_status $YELLOW "AT COMMAND DIAGNOSTICS"
echo "==================================================="

print_status $GREEN "AUTOMATED AT COMMAND TESTING"
print_status $YELLOW "Using device: /dev/ttyUSB3"
echo

# USB Configuration Check
run_at_command "AT#USBCFG?" "Check USB configuration" "Should return 3 or 4"

# ECM Context Check
run_at_command "AT#ECM?" "Check TCP context activation" "Should return 0,1 (if 0,0 run AT#ECM=1,0,\"\",\"\",0)"

# SIM Detection
run_at_command "AT+CPIN?" "Check SIM detection" "Should return READY"

# Network Registration
run_at_command "AT+CREG?" "Check network registration" "Should return 0,1 or 0,5"

# APN Configuration
run_at_command "AT+CGDCONT?" "Check APN configuration and IP" "Should show APN details and IP address"

echo
echo "==================================================="
print_status $YELLOW "ADDITIONAL USEFUL COMMANDS"
echo "==================================================="

echo "If ECM returns 0,0, run this to activate:"
echo "  AT#ECM=1,0,\"\",\"\",0"
echo

echo "To manually configure DHCP for wwan0:"
echo "  sudo dhclient -v wwan0"
echo

echo "To add DNS server:"
echo "  echo 'nameserver 8.8.8.8' | sudo tee -a /etc/resolv.conf"
echo

echo "To check interface status:"
echo "  ip addr show wwan0"
echo "  ip route show dev wwan0"
echo

print_status $GREEN "Troubleshooting script completed!"