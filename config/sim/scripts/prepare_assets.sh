#!/bin/bash
# One-time asset setup (no changes to the PX4 tree): build models/baylands_fixed/media from the Fuel Baylands v3
# model + our DAE patches (leaf/branch alpha from the texture, for ogre2), and check the PX4 build.
. "$(dirname "$0")/sim_env.sh" || exit 1
set -e
FU=https://fuel.gazebosim.org/1.0/OpenRobotics/models/baylands/3
SRC=$HOME/.gz/fuel/fuel.gazebosim.org/openrobotics/models/baylands/3/media
[ -f "$SRC/baylands_01.DAE" ] || { echo "downloading $FU (~300 MB)"; gz fuel download -u "$FU"; }
DST=$SIM_DIR/models/baylands_fixed/media
rm -rf "$DST"; cp -r "$SRC" "$DST"
for p in "$SIM_DIR"/models/baylands_fixed/patches/*.DAE.patch; do f=$(basename "$p" .patch); patch -s "$DST/$f" < "$p"; echo "patched $f"; done
if [ -x "$PX4_DIR/build/px4_sitl_default/bin/px4" ]; then echo "PX4: $(git -C "$PX4_DIR" describe --tags 2>/dev/null) built"
else echo "PX4 not built yet: cd $PX4_DIR && make px4_sitl"; fi
