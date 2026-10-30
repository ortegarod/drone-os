#!/bin/bash
# Average Gazebo real-time factor over N s. Usage: rtf.sh [SIM_NAME] [N]
. "$HOME/.config/droneos-sim/state/${1:-main}.env" || exit 1
[ -n "$SIM_GZ_PARTITION" ] && export GZ_PARTITION=$SIM_GZ_PARTITION
N=${2:-20}
s(){ timeout 5 gz topic -e -n 1 -t /world/$SIM_WORLD/stats 2>/dev/null | awk '/^sim_time/{m="s"} /^real_time /{m="r"} /^iterations|^step_size|^pause_time/{m=""} /^  sec:/{if(m=="s")ss=$2; if(m=="r")rs=$2} /^  nsec:/{if(m=="s")sn=$2; if(m=="r")rn=$2} END{printf "%.3f %.3f\n", ss+sn/1e9, rs+rn/1e9}'; }
a=($(s)); sleep $N; b=($(s))
python3 -c "print('RTF over $N s: %.3f' % ((${b[0]}-${a[0]})/(${b[1]}-${a[1]})))"
