#!/bin/bash
# Spawn the world's detection targets / walker (TARGETS file of the world env). Usage: spawn_targets.sh [SIM_NAME]
# TARGETS lines: spawn NAME FUEL_URI N E YAW_ENU   (N/E metres from drone1 home; gz x = HOME_GZ_X + E, y = HOME_GZ_Y + N)
. "$HOME/.config/droneos-sim/state/${1:-main}.env" || exit 1
[ -n "$SIM_GZ_PARTITION" ] && export GZ_PARTITION=$SIM_GZ_PARTITION
export GZ_SIM_RESOURCE_PATH=$GZ_RES
[ -z "$TARGETS" ] && { echo "world $SIM_WORLD: no targets"; exit 0; }
F=https://fuel.gazebosim.org/1.0/OpenRobotics/models
spawn(){
  local x y qz qw
  read -r x y qz qw < <(python3 -c "import math;print(round($HOME_GZ_X+$4,2),round($HOME_GZ_Y+$3,2),math.sin($5/2),math.cos($5/2))")
  printf 'spawn %-14s N=%s E=%s: ' "$1" "$3" "$4"
  gz service -s /world/$SIM_WORLD/create --reqtype gz.msgs.EntityFactory --reptype gz.msgs.Boolean --timeout 120000 \
    --req "sdf_filename: \"$2\", name: \"$1\", pose: {position: {x: $x, y: $y, z: -0.1}, orientation: {z: $qz, w: $qw}}, allow_renaming: false" | tr -d '\n'; echo
}
. "$TARGETS"
