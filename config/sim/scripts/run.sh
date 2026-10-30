#!/bin/bash
# Entry point of the <prefix>-<component>@<instance> units (systemd/*.service). <instance> = SIM_NAME, or
# SIM_NAME-N for per-drone units (N = 1..SIM_DRONES). Reads the state written by sim_up.sh.
comp=$1; arg=$2; name=$arg; n=
case $comp in px4|geofence) name=${arg%-*}; n=${arg##*-} ;; esac
st=$HOME/.config/droneos-sim/state/$name.env
[ -f "$st" ] || { echo "no $st: run sim_up.sh first" >&2; exit 1; }
. "$st"
if [ -n "$SIM_GZ_PARTITION" ]; then export GZ_PARTITION=$SIM_GZ_PARTITION; else unset GZ_PARTITION; fi
export GZ_SIM_RESOURCE_PATH=$GZ_RES ROS_DOMAIN_ID
i=$(( SIM_INSTANCE_BASE + ${n:-1} - 1 ))
case $comp in
  gz)  exec /usr/bin/gz sim --verbose=1 -r -s "$WORLD_SDF" ;;
  gui) export DISPLAY=$SIM_DISPLAY; [ -n "$SIM_XAUTHORITY" ] && export XAUTHORITY=$SIM_XAUTHORITY; exec /usr/bin/gz sim -g ;;
  px4)
    # PX4 standalone mode: we run gz ourselves (docs.px4.io sim_gazebo_gz "Standalone Mode"); PX4 spawns
    # <SIM_MODEL>/model.sdf as <SIM_MODEL>_<instance> at PX4_GZ_MODEL_POSE (px4-rc.simulator, GZBridge.cpp:75).
    eval pose=\$POSE_$n
    cd "$PX4_DIR/build/px4_sitl_default" || exit 1
    rm -f /tmp/px4-daemon-app-$i.lock /tmp/px4_lock-$i /tmp/px4-sock-$i
    export PX4_GZ_STANDALONE=1 PX4_GZ_WORLD=$SIM_WORLD PX4_SIM_MODEL=gz_$SIM_MODEL PX4_SYS_AUTOSTART=$SIM_AIRFRAME \
      PX4_GZ_MODEL_POSE=$pose PX4_UXRCE_DDS_PORT=$SIM_DDS_PORT PX4_GZ_MODELS=$PX4_DIR/Tools/simulation/gz/models HEADLESS=1
    exec ./bin/px4 -i $i ;;
  bridge)
    . "$SIM_ROS_SETUP"
    topics=(); remaps=()
    for d in $(seq 1 $SIM_DRONES); do
      t=/world/$SIM_WORLD/model/${SIM_MODEL}_$((SIM_INSTANCE_BASE + d - 1))/link/camera_link/sensor/imager/image
      topics+=("$t@sensor_msgs/msg/Image@gz.msgs.Image"); remaps+=(--remap "$t:=/drone$d/camera")
    done
    exec ros2 run ros_gz_bridge parameter_bridge "${topics[@]}" --ros-args "${remaps[@]}" ;;
  walker)
    [ -z "$WALKER_LOOP_NE" ] && { echo "world $SIM_WORLD has no WALKER_LOOP_NE: no walker"; exit 0; }
    export WALKER_WORLD=$SIM_WORLD WALKER_HOME_GZ=$HOME_GZ_X,$HOME_GZ_Y WALKER_LOOP_NE PYTHONUNBUFFERED=1
    exec python3 "$SIM_DIR/walker/walker_mover.py" ;;
  geofence)
    # SITL: onboard MAVLink link of instance i is UDP 14580+i (px4-rc.mavlink), MAV_SYS_ID = i+1
    . "$SIM_ROS_SETUP"
    exec python3 -u "$REPO_DIR/src/geofence_loader/geofence_loader.py" --drone drone$n \
      --mavlink udpout:127.0.0.1:$((14580 + i)) --sysid $((i + 1)) ;;
  *) echo "unknown component $comp" >&2; exit 2 ;;
esac
