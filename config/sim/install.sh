#!/bin/bash
# Install the DroneOS sim systemd --user unit templates for this checkout. Usage: install.sh [--prefix NAME]
# (a second checkout can install its own units with another prefix and run with SIM_UNIT_PREFIX=NAME).
P=droneos; [ "$1" = --prefix ] && P=$2
SIM_DIR=$(cd "$(dirname "$0")" && pwd)
U=$HOME/.config/systemd/user; mkdir -p "$U" "$HOME/.config/droneos-sim/state"
for t in "$SIM_DIR"/systemd/droneos-*.service; do
  b=$(basename "$t"); sed -e "s#@SIM_DIR@#$SIM_DIR#g" -e "s#@PREFIX@#$P#g" "$t" > "$U/$P-${b#droneos-}"; echo "installed $U/$P-${b#droneos-}"
done
chmod +x "$SIM_DIR"/scripts/*.sh
systemctl --user daemon-reload
miss=0
command -v gz >/dev/null || { echo "MISSING: gz (Gazebo Harmonic)"; miss=1; }
[ -f /opt/ros/humble/setup.bash ] || echo "note: /opt/ros/humble not found; set SIM_ROS_SETUP"
python3 -c "import pymavlink" 2>/dev/null || echo "note: pymavlink missing (geofence loader): pip install pymavlink"
python3 -c "import gz.transport13" 2>/dev/null || echo "note: python3-gz-transport13 missing (walker)"
exit $miss
