# Walking person for Follow tests

A static Fuel person model (`Casual female`, spawned as `walker` by `~/sim/spawn_targets.sh`) is moved along a
closed loop near drone1's home in baylands by `walker_mover.py` (user unit `sim-walker.service`): set_pose on
`/world/baylands/set_pose` at ~20 Hz, position from **sim time** (`/world/baylands/clock`), so the speed is
1.2 m/s in sim time at any RTF. Yaw follows the direction of travel. It glides (no walking animation).

- Loop (N/E metres from drone1 home, NED): -12/-18 -> -28/-18 -> -28/-24 -> -12/-24 (44 m, ~37 s sim per lap).
  Centre N -20 E -21, ~29 m from home along heading 227; open ground, >= 4 m from the tree islands, >= 6 m from
  the parked SUV and the standing people. gz ENU = (0.98 + E, 0.01 + N). Edit `LOOP_NE` in walker_mover.py.
- Install: `cp sim-walker.service ~/.config/systemd/user/ && systemctl --user daemon-reload &&
  systemctl --user enable --now sim-walker`. It survives sim restarts on its own: while the world or the model is
  missing it waits (1 s retries) and resumes once sim_up has respawned the model.
- Do **not** add `After=`/`Wants=gz-baylands.service`: gz-baylands is a transient unit (systemd-run in sim_up);
  a reference keeps the stopped unit loaded and the next `systemd-run --unit gz-baylands` fails ("already exists").
- Env: WALKER_SPEED (1.2), WALKER_HZ (20), WALKER_YAW_OFFSET (rad), WALKER_WORLD, WALKER_MODEL.
- The first version was a gz `<actor>` (Fuel Mingfei/actor walk.dae); SSD found it in
  only 20 % of messages from 30 m, and gz-sim 8 /remove does not remove actors. Replaced by this.

Measured 2026-10-29 (drone1 straight up at home, 32 m, heading 227, Edge TPU SSD v2, 22 passes, 1280x960):
- 22:42:55-22:43:55 UTC: walker labelled `person` in **102/195 messages (52 %)**, score mean 0.73 (max 0.93),
  hits over the whole loop (N -29..-12, E -24..-17); 0 other person false positives. (Actor: 40/197, 20 %.)
- Speed: 0.90-1.02 m/s wall time at RTF ~0.8, i.e. ~1.2 m/s sim time.
- RTF 0.795 (120 s, on the ground, three HD cameras + three detectors + walker).
