#!/bin/bash
# Stop a DroneOS sim started by sim_up.sh. Usage: sim_down.sh [SIM_NAME]
. "$(dirname "$0")/sim_env.sh" || exit 1
N=${1:-$SIM_NAME}; P=$SIM_UNIT_PREFIX
. "$HOME/.config/droneos-sim/state/$N.env" 2>/dev/null
U=; for d in $(seq 1 $SIM_DRONES); do U="$U $P-px4@$N-$d $P-geofence@$N-$d"; done
systemctl --user stop $P-gui@$N $P-walker@$N $P-bridge@$N $U $P-gz@$N
echo "sim $N stopped"
