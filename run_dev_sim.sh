#!/bin/bash

# Script to launch a 2-drone SITL simulation environment for DroneOS development.
# Uses tmux to manage multiple processes in one terminal.

# --- Configuration --- 
# !!! EDIT THIS PATH to your PX4-Autopilot directory !!!
PX4_AUTOPILOT_DIR="~/PX4-Autopilot"

# Workspace directory (assuming script is run from workspace root)
WORKSPACE_DIR=$(pwd)

# ROS 2 Distribution
ROS_DISTRO=humble

# tmux session name
SESSION_NAME="droneos_sim"

# --- Check for tmux --- 
if ! command -v tmux &> /dev/null
then
    echo "tmux could not be found. Please install it (e.g., sudo apt install tmux) and try again."
    exit 1
fi

# --- Environment Setup --- 

echo "Sourcing ROS 2 and workspace..."
source /opt/ros/$ROS_DISTRO/setup.bash
if [ -f "$WORKSPACE_DIR/install/setup.bash" ]; then
    source "$WORKSPACE_DIR/install/setup.bash"
else
    echo "Workspace setup file not found. Please build the workspace first ('colcon build')."
    exit 1
fi

# --- Expand PX4 Path --- 
PX4_AUTOPILOT_DIR=$(eval echo $PX4_AUTOPILOT_DIR)
if [ ! -d "$PX4_AUTOPILOT_DIR" ]; then
    echo "PX4 Autopilot directory not found at: $PX4_AUTOPILOT_DIR"
    echo "Please edit the PX4_AUTOPILOT_DIR variable in this script."
    exit 1
fi

# --- tmux Setup --- 

echo "Starting tmux session: $SESSION_NAME"

tmux kill-session -t $SESSION_NAME 2>/dev/null # Kill existing session if any
tmux new-session -d -s $SESSION_NAME

# Configure tmux panes (example layout: one main pane, others below)
tmux split-window -v -p 66 # Split main window vertically (66% top)
tmux split-window -h -p 50 # Split bottom pane horizontally

tmux select-pane -t 0 # Select top pane
tmux split-window -h -p 66 # Split top pane horizontally
tmux split-window -h -p 50 # Split right part of top pane

tmux select-pane -t 2 # Select bottom-left pane
tmux split-window -h -p 50 # Split bottom-left pane

# Pane Index Reference (Approximate visual):
#  -----------------
# |   0   | 1 |  3  |
# |-------|---|-----|
# | 2 | 4 |   5   |
#  -----------------

# --- Launch Processes in tmux Panes --- 

# Pane 0: PX4 SITL Instance 0 (Drone 1)
echo "Launching Drone 1 SITL (MAV_SYS_ID=1)..."
tmux send-keys -t $SESSION_NAME:0.0 "cd $PX4_AUTOPILOT_DIR && echo '--- PX4 DRONE 1 (Instance 0) ---' && PX4_SYS_AUTOSTART=4001 PX4_SIM_MODEL=gz_x500 ./build/px4_sitl_default/bin/px4 -i 0" C-m

# Pane 1: PX4 SITL Instance 1 (Drone 2)
echo "Launching Drone 2 SITL (MAV_SYS_ID=2)..."
tmux send-keys -t $SESSION_NAME:0.1 "cd $PX4_AUTOPILOT_DIR && echo '--- PX4 DRONE 2 (Instance 1) ---' && PX4_SYS_AUTOSTART=4001 PX4_GZ_MODEL_POSE=\"0,1\" PX4_SIM_MODEL=gz_x500 ./build/px4_sitl_default/bin/px4 -i 1" C-m

# Pane 2: Micro XRCE-DDS Agent
echo "Launching Micro XRCE-DDS Agent..."
tmux send-keys -t $SESSION_NAME:0.2 "echo '--- MICRO XRCE-DDS AGENT ---' && source $WORKSPACE_DIR/install/setup.bash && MicroXRCEAgent udp4 -p 8888" C-m

# Pane 3: Drone 1 Controller
echo "Launching Drone 1 Controller Node..."
tmux send-keys -t $SESSION_NAME:0.3 "echo '--- DRONE 1 CORE NODE ---' && source $WORKSPACE_DIR/install/setup.bash && ros2 run drone_core drone_core --ros-args -r __node:=drone1 -p drone_name:=drone1 -p px4_namespace:=/fmu/ -p mav_sys_id:=1" C-m

# Pane 4: Drone 2 Controller
echo "Launching Drone 2 Controller Node..."
tmux send-keys -t $SESSION_NAME:0.4 "echo '--- DRONE 2 CORE NODE ---' && source $WORKSPACE_DIR/install/setup.bash && ros2 run drone_core drone_core --ros-args -r __node:=drone2 -p drone_name:=drone2 -p px4_namespace:=/px4_1/fmu/ -p mav_sys_id:=2" C-m

# Pane 5: GCS CLI
echo "Launching GCS CLI..."
tmux send-keys -t $SESSION_NAME:0.5 "echo '--- GCS CLI ---' && source $WORKSPACE_DIR/install/setup.bash && sleep 5 && ros2 run drone_gcs_cli gcs" C-m # Add sleep to allow nodes to start

# --- Attach to Session --- 

echo "Setup complete. Attaching to tmux session '$SESSION_NAME'."
echo "(Use 'Ctrl+b' then 'd' to detach, 'tmux attach-session -t $SESSION_NAME' to reattach)"
sleep 2 # Give user time to read messages

tmux attach-session -t $SESSION_NAME 