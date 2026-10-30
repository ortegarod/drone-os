"""Fly a 20 m square at 10 m altitude, then land.

Run against PX4 SITL first:  python3 square.py
"""

from droneos import Drone

with Drone("drone1") as d:
    d.takeoff(10)
    for x, y in [(20, 0), (20, 20), (0, 20), (0, 0)]:
        d.goto(x, y)
    d.land()
