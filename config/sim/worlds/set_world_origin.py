#!/usr/bin/env python3
"""Copy a gz-sim world SDF with a new world name and <spherical_coordinates> origin.

PX4 + gz (Harmonic/gz-sim 8): the simulated GPS comes from the gz NavSat sensor, which converts the vehicle's
world position using the world's <spherical_coordinates> (gz_bridge GZBridge::navSatCallback). PX4_HOME_LAT/LON/ALT
are only applied for SIH (px4-rc.simulator:11-17) and the Gazebo Classic plugin, not for gz.

  set_world_origin.py SRC.sdf DST.sdf --name NAME --lat LAT --lon LON --elev METRES_MSL

The location comes only from the arguments; keep DST out of git if the location is private.
"""
import argparse, re
ap = argparse.ArgumentParser()
ap.add_argument('src'); ap.add_argument('dst')
ap.add_argument('--name', required=True)
ap.add_argument('--lat', type=float, required=True); ap.add_argument('--lon', type=float, required=True)
ap.add_argument('--elev', type=float, required=True)
a = ap.parse_args()
s = open(a.src).read()
s, n = re.subn(r'<world name="[^"]*">', f'<world name="{a.name}">', s, count=1)
assert n == 1, 'no <world name=...> in source'
sc = (f'<spherical_coordinates>\n      <surface_model>EARTH_WGS84</surface_model>\n'
      f'      <world_frame_orientation>ENU</world_frame_orientation>\n'
      f'      <latitude_deg>{a.lat}</latitude_deg>\n      <longitude_deg>{a.lon}</longitude_deg>\n'
      f'      <elevation>{a.elev}</elevation>\n    </spherical_coordinates>')
s, n = re.subn(r'<spherical_coordinates>.*?</spherical_coordinates>', sc, s, count=1, flags=re.S)
if n == 0:
    s = s.replace('</world>', f'    {sc}\n  </world>', 1)
open(a.dst, 'w').write(s)
print(f'wrote {a.dst}: world {a.name}')
