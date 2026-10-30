"""Patrol a property-sized loop twice, then return home and land.

The patrol runs onboard: once it starts, this script can exit and the drone still
finishes the route and comes home.
"""

from droneos import Drone

ROUTE = [(40, 0), (40, 30), (-10, 30), (-10, 0)]  # meters north/east of home

with Drone("drone1") as d:
    d.patrol(ROUTE, altitude=15, loops=2)
