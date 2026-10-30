# PX4 sim model overrides

PX4 v1.15.4 `Tools/simulation/gz/models/` lives in the PX4-Autopilot tree (gz submodule), outside this repo.
Copies of the models we change are kept here.

- `x500_mono_cam/model.sdf`: camera pitched **45 deg down** (SDF pose pitch 0.785398 rad, nose-down in FLU) at
  .12 .03 .242 from base_link, both in the `mono_cam` include pose and the `CameraJoint` pose.
  Camera (from `mono_cam/model.sdf`): HFOV 1.74 rad = 99.7 deg, 640x480, update_rate 15 Hz (VFOV ~83.9 deg).
  `x500_mono_cam.patch` is the diff against stock PX4.

Install: `cp config/sim/px4_models/x500_mono_cam/model.sdf ~/PX4-Autopilot/Tools/simulation/gz/models/x500_mono_cam/`
then restart the sim (`~/sim/sim_up.sh`); the PATROL nodes must be restarted after PX4 restarts.

## drone1 HD camera (1280x960)

- `mono_cam_hd/`: copy of PX4 `mono_cam` with only the image size changed to **1280x960** (HFOV 99.7 deg, 15 Hz).
- `x500_mono_cam_hd/`: `x500_mono_cam` (45 deg down mount) including `mono_cam_hd`.
- drone1 only: `../systemd/px4-sitl.service.d-20-hd-camera.conf` -> `~/.config/systemd/user/px4-sitl.service.d/20-hd-camera.conf`
  (`PX4_SIM_MODEL=gz_x500_mono_cam_hd`, `PX4_SYS_AUTOSTART=4010` keeps the gz_x500_mono_cam airframe). PX4 spawns
  `<model>/model.sdf` named `<model>_<instance>` (GZBridge.cpp:75, px4-rc.simulator:117), so drone1 is `x500_mono_cam_hd_0`.
- `../systemd/ros-gz-bridge.service`: drone1 camera bridged from `/world/baylands/model/x500_mono_cam_hd_0/...` to `/drone1/camera`.
- Install: copy both model dirs into `~/PX4-Autopilot/Tools/simulation/gz/models/`, the two systemd files into place,
  `systemctl --user daemon-reload`, `~/sim/sim_up.sh`. Revert: remove the drop-in, restore the bridge unit, sim_up.
- Measured: RTF 0.952 (30 s) vs 0.973 before; /drone1/camera 10.7 Hz (12.5 before). web_video_server scales on request
  (`width=640&height=480` -> 640x480, 54 KB), so the VPS stream bandwidth is unchanged.

## HD camera on all three drones

- drone2/drone3 use the same `x500_mono_cam_hd` model: `../systemd/px4-drone{2,3}.service.d-20-hd-camera.conf` ->
  `~/.config/systemd/user/px4-drone{2,3}.service.d/20-hd-camera.conf`; the bridge unit maps
  `x500_mono_cam_hd_0/1/2` to `/drone1/2/3/camera`.
- RTF (120 s, on the ground, with the detectors of src/object_detector/README.md): 0.837 with all three HD; 0.899 (30 s)
  with all three HD and no CPU detectors; 0.912 with drone3 back on 640x480.
- Revert drone3 only: remove its drop-in, `sed -i 's#x500_mono_cam_hd_2/#x500_mono_cam_2/#'` the bridge unit,
  `systemctl --user daemon-reload`, sim_up.
