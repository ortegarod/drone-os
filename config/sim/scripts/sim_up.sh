#!/bin/bash
# Start (or restart) a DroneOS sim: Gazebo world + SIM_DRONES PX4 SITL instances + camera bridge + targets/walker.
# Config: environment / ~/.config/droneos-sim/defaults.env, see config/sim/README.md. Units: install.sh first.
. "$(dirname "$0")/sim_env.sh" || exit 1
ts(){ date +%T; }
B=$PX4_DIR/build/px4_sitl_default/bin; P=$SIM_UNIT_PREFIX; N=$SIM_NAME
[ -x "$B/px4" ] || { echo "PX4 not built: cd $PX4_DIR && make px4_sitl" >&2; exit 1; }
[ -f "$WORLD_SDF" ] || { echo "world SDF not found: $WORLD_SDF" >&2; exit 1; }
systemctl --user cat "$P-gz@.service" >/dev/null 2>&1 || { echo "units not installed: $SIM_DIR/install.sh" >&2; exit 1; }
grep -q "baylands_fixed" "$WORLD_SDF" && [ ! -f "$SIM_DIR/models/baylands_fixed/media/baylands_01.DAE" ] && {
  echo "baylands_fixed media missing: run $SIM_DIR/scripts/prepare_assets.sh" >&2; exit 1; }
ST=$HOME/.config/droneos-sim/state; mkdir -p "$ST"
for v in $SIM_STATE_VARS; do printf '%s=%q\n' "$v" "${!v}"; done > "$ST/$N.env"
[ -n "$SIM_GZ_PARTITION" ] && export GZ_PARTITION=$SIM_GZ_PARTITION
export ROS_DOMAIN_ID
PX4U=; for d in $(seq 1 $SIM_DRONES); do PX4U="$PX4U $P-px4@$N-$d"; done
echo "[$(ts)] sim $N: world $SIM_WORLD ($WORLD_SDF), $SIM_DRONES x $SIM_MODEL, PX4 instances $SIM_INSTANCE_BASE..$((SIM_INSTANCE_BASE+SIM_DRONES-1)), gz partition '$SIM_GZ_PARTITION', ROS domain $ROS_DOMAIN_ID"
systemctl --user stop $P-gui@$N $P-walker@$N $P-bridge@$N $PX4U $P-gz@$N 2>/dev/null; sleep 2
systemctl --user reset-failed $P-gui@$N $P-walker@$N $P-bridge@$N $PX4U $P-gz@$N 2>/dev/null
systemctl --user start $P-gz@$N
for t in $(seq 1 120); do timeout 2 gz topic -e -n 1 -t /world/$SIM_WORLD/clock >/dev/null 2>&1 && break; sleep 1; done
timeout 2 gz topic -e -n 1 -t /world/$SIM_WORLD/clock >/dev/null 2>&1 || { echo "gz world $SIM_WORLD did not start (journalctl --user -u $P-gz@$N)" >&2; exit 1; }
echo "[$(ts)] gz clock up"
for d in $(seq 1 $SIM_DRONES); do
  i=$((SIM_INSTANCE_BASE + d - 1)); systemctl --user start $P-px4@$N-$d
  # "gz model --list" can come back empty on a busy server, so keep the first positive answer
  m="NOT SEEN in 90 s"
  for t in $(seq 1 90); do gz model --list 2>/dev/null | grep -q " ${SIM_MODEL}_$i\$" && { m=${SIM_MODEL}_$i; break; }; sleep 1; done
  echo "[$(ts)] drone$d: PX4 instance $i, model $m"
done
# DroneOS PX4 parameter baseline (px4_params.txt): set-default, so values a user/tool set (saved) still win.
for d in $(seq 1 $SIM_DRONES); do i=$((SIM_INSTANCE_BASE + d - 1))
  for t in $(seq 1 30); do timeout 3 "$B/px4-param" --instance $i show SYS_AUTOSTART >/dev/null 2>&1 && break; sleep 1; done
  grep -vE '^\s*(#|$)' "$SIM_DIR/px4_params.txt" | while read -r p v; do timeout 3 "$B/px4-param" --instance $i set-default "$p" "$v" >/dev/null; done
done
echo "[$(ts)] PX4 params applied"
systemctl --user start $P-bridge@$N $P-walker@$N
"$SIM_DIR/scripts/spawn_targets.sh" "$N"
[ "$SIM_GEOFENCE" = 1 ] && for d in $(seq 1 $SIM_DRONES); do systemctl --user restart $P-geofence@$N-$d; done
[ "$SIM_GUI" = 1 ] && systemctl --user start $P-gui@$N
[ -n "$SIM_POST_UP" ] && { echo "[$(ts)] post-up: $SIM_POST_UP"; bash -c "$SIM_POST_UP"; }
sleep 15
for d in $(seq 1 $SIM_DRONES); do i=$((SIM_INSTANCE_BASE + d - 1))
  echo "drone$d: $(timeout 4 "$B/px4-commander" --instance $i check 2>&1 | grep -o 'Preflight check: [A-Z]*' | head -1)" \
       "$(timeout 4 "$B/px4-listener" --instance $i sensor_gps -n 1 2>/dev/null | grep -E 'latitude_deg|longitude_deg' | tr -s ' \n' ' ')"
done
echo "[$(ts)] units: $(systemctl --user is-active $P-gz@$N $PX4U $P-bridge@$N | tr '\n' ' ')"
echo "[$(ts)] SIM UP DONE ($N)"
