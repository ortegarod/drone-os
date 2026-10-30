# DroneOS sim: resolve the configuration (sourced by sim_up.sh). Everything can be overridden from the environment;
# per-machine defaults go in ~/.config/droneos-sim/defaults.env (not in git), written as VAR=${VAR:-value}.
SIM_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
REPO_DIR=$(cd "$SIM_DIR/../.." && pwd)
[ -f "$HOME/.config/droneos-sim/defaults.env" ] && . "$HOME/.config/droneos-sim/defaults.env"
SIM_NAME=${SIM_NAME:-main}                  # one name per running sim (unit instance names, state file)
SIM_WORLD=${SIM_WORLD:-baylands}            # worlds/<w>.env (in git) or worlds/local/<w>.env (gitignored)
PX4_DIR=${PX4_DIR:-$HOME/PX4-Autopilot}     # PX4-Autopilot checkout, built with "make px4_sitl" (v1.15.4 tested)
SIM_DRONES=${SIM_DRONES:-3}
SIM_INSTANCE_BASE=${SIM_INSTANCE_BASE:-0}   # PX4 instance of drone1 (MAVLink/sysid/model name follow it)
SIM_MODEL=${SIM_MODEL:-x500_mono_cam_hd}    # gz model (config/sim/models or PX4's models)
SIM_AIRFRAME=${SIM_AIRFRAME:-4010}          # PX4_SYS_AUTOSTART (4010 = gz_x500_mono_cam)
SIM_GZ_PARTITION=${SIM_GZ_PARTITION:-}      # GZ_PARTITION: isolates gz transport of parallel sims
SIM_DDS_PORT=${SIM_DDS_PORT:-8888}          # uXRCE-DDS agent UDP port
ROS_DOMAIN_ID=${ROS_DOMAIN_ID:-0}
SIM_ROS_SETUP=${SIM_ROS_SETUP:-/opt/ros/humble/setup.bash}
SIM_UNIT_PREFIX=${SIM_UNIT_PREFIX:-droneos} # systemd --user unit prefix (install.sh --prefix)
SIM_GUI=${SIM_GUI:-0}; SIM_DISPLAY=${SIM_DISPLAY:-:0}; SIM_XAUTHORITY=${SIM_XAUTHORITY:-}
SIM_GEOFENCE=${SIM_GEOFENCE:-0}             # 1: (re)start the geofence loaders with the sim
SIM_POST_UP=${SIM_POST_UP:-}                # shell command run at the end of sim_up (e.g. restart containers)
if [ -f "$SIM_DIR/worlds/local/$SIM_WORLD.env" ]; then WORLD_ENV=$SIM_DIR/worlds/local/$SIM_WORLD.env
elif [ -f "$SIM_DIR/worlds/$SIM_WORLD.env" ]; then WORLD_ENV=$SIM_DIR/worlds/$SIM_WORLD.env
else echo "unknown SIM_WORLD=$SIM_WORLD (no worlds/$SIM_WORLD.env or worlds/local/$SIM_WORLD.env)" >&2; return 1 2>/dev/null || exit 1; fi
WORLD_DIR=$(dirname "$WORLD_ENV")
POSE_1=; POSE_2=; POSE_3=; HOME_GZ_X=0; HOME_GZ_Y=0; TARGETS=; WALKER_LOOP_NE=; WORLD_SDF=
. "$WORLD_ENV"
[ -z "$WORLD_SDF" ] && { [ -f "$WORLD_DIR/sdf/$SIM_WORLD.sdf" ] && WORLD_SDF=$WORLD_DIR/sdf/$SIM_WORLD.sdf || WORLD_SDF=$WORLD_DIR/$SIM_WORLD.sdf; }
[ -n "$TARGETS" ] && [ "${TARGETS#/}" = "$TARGETS" ] && TARGETS=$WORLD_DIR/$TARGETS
GZ_RES=$SIM_DIR/models:$PX4_DIR/Tools/simulation/gz/models:$PX4_DIR/Tools/simulation/gz/worlds:$(dirname "$WORLD_SDF")
SIM_STATE_VARS="SIM_DIR REPO_DIR SIM_NAME SIM_WORLD PX4_DIR SIM_DRONES SIM_INSTANCE_BASE SIM_MODEL SIM_AIRFRAME
 SIM_GZ_PARTITION SIM_DDS_PORT ROS_DOMAIN_ID SIM_ROS_SETUP SIM_UNIT_PREFIX SIM_DISPLAY SIM_XAUTHORITY WORLD_SDF WORLD_DIR
 POSE_1 POSE_2 POSE_3 HOME_GZ_X HOME_GZ_Y TARGETS WALKER_LOOP_NE GZ_RES"
