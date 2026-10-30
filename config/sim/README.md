# DroneOS simulation (PX4 SITL + Gazebo Harmonic, 3 drones)

## Run the sim

Requirements: Ubuntu 22.04, Gazebo Harmonic (`gz sim`), ROS 2 Humble (camera bridge, geofence loader),
`python3-gz-transport13` (walker), `pymavlink` (geofence loader). Tested with PX4 v1.15.4.

1. PX4 (unmodified checkout; docs.px4.io "Building the Code"):
   `git clone --recursive --branch v1.15.4 https://github.com/PX4/PX4-Autopilot ~/PX4-Autopilot && cd ~/PX4-Autopilot && make px4_sitl`
   With a shallow clone (`--depth 1`) the build fails in px_update_git_header.py (no tags): fetch the tag
   (`git fetch --depth 1 origin tag v1.15.4`) and tag NuttX (`git -C platforms/nuttx/NuttX/nuttx tag nuttx-10.3.0`).
2. This repo, cloned with `--recurse-submodules` (or `git submodule update --init`): `config/sim/install.sh` (systemd --user unit templates), `config/sim/scripts/prepare_assets.sh`
   (Fuel Baylands + our ogre2 patches -> `models/baylands_fixed/media`, ~300 MB, gitignored).
3. Start: `config/sim/scripts/sim_up.sh` (default world `baylands`). Stop: `config/sim/scripts/sim_down.sh`.
   Then the DroneOS containers (micro agent, drone_core x3, rosbridge): `docker/dev` compose files.

Settings (environment or `~/.config/droneos-sim/defaults.env`, see `scripts/sim_env.sh`): `SIM_WORLD`, `PX4_DIR`
(default `~/PX4-Autopilot`), `SIM_DRONES` (3), `SIM_INSTANCE_BASE` (0), `SIM_MODEL` (x500_mono_cam_hd: 1280x960
camera pitched 45 deg down), `SIM_GZ_PARTITION`, `SIM_DDS_PORT` (8888), `ROS_DOMAIN_ID`, `SIM_GUI`, `SIM_GEOFENCE`,
`SIM_POST_UP`, `SIM_UNIT_PREFIX` (droneos). A second sim on the same machine (e.g. a second checkout) needs its own
SIM_NAME, SIM_GZ_PARTITION, SIM_INSTANCE_BASE, SIM_DDS_PORT and ROS_DOMAIN_ID, and its own units:
`install.sh --prefix NAME` + `SIM_UNIT_PREFIX=NAME`. Tested: SIM_NAME=proof SIM_UNIT_PREFIX=proof
SIM_GZ_PARTITION=droneos_proof SIM_INSTANCE_BASE=10 SIM_DDS_PORT=8899 ROS_DOMAIN_ID=42 next to a running main sim.

How it maps to PX4: we run `gz sim` ourselves and PX4 in standalone mode (docs.px4.io sim_gazebo_gz, "Standalone
Mode": `PX4_GZ_STANDALONE=1`, `PX4_GZ_WORLD`, `PX4_GZ_MODEL_POSE`, `PX4_SIM_MODEL`). PX4 spawns `<model>_<instance>`
(gz_bridge GZBridge.cpp:75). Models are found through `GZ_SIM_RESOURCE_PATH` = config/sim/models + PX4's
Tools/simulation/gz/models (PX4 itself only builds that path from `PX4_GZ_MODELS`/`PX4_GZ_WORLDS` when it starts gz,
px4-rc.simulator:70-82; not documented on the sim_gazebo_gz page). Headless params (no RC/GCS) are in
`px4_params.txt`, applied with `param set-default` after start, instead of editing PX4 airframes.

## Your own location

The simulated GPS comes from the world's `<spherical_coordinates>` (gz NavSat -> GZBridge::navSatCallback);
`PX4_HOME_LAT/LON/ALT` only applies to SIH / Gazebo Classic (px4-rc.simulator:7-17). One command makes a world:

    config/sim/worlds/set_world_origin.py config/sim/worlds/sdf/default.sdf config/sim/worlds/local/mysite.sdf \
        --name mysite --lat LAT --lon LON --elev GROUND_MSL_M
    printf 'POSE_2=0,-4,0,0,0,0\nPOSE_3=4,0,0,0,0,0\n' > config/sim/worlds/local/mysite.env
    SIM_WORLD=mysite config/sim/scripts/sim_up.sh

`worlds/local/` is gitignored: keep real locations there, never in git. (Use any world SDF as the source, e.g.
`$PX4_DIR/Tools/simulation/gz/worlds/default.sdf`.) World env keys: POSE_1..3, HOME_GZ_X/Y, TARGETS, WALKER_LOOP_NE,
WORLD_SDF (see `worlds/baylands.env`).

## Layout

- `scripts/`: sim_up / sim_down / run.sh (unit entry point) / spawn_targets / rtf / prepare_assets
- `systemd/`: unit templates `droneos-{gz,gui,px4,bridge,walker,geofence}@.service` (installed by install.sh)
- `models/`: x500_mono_cam_hd + mono_cam_hd (HD 45 deg camera), baylands_fixed (sdf + DAE patches)
- `worlds/`: `*.env` per world, `sdf/baylands.sdf`, `set_world_origin.py`, `local/` (gitignored)
- `walker/`: walking person for Follow tests; `px4_models/`: 640x480 camera patch for PX4's x500_mono_cam (optional)
