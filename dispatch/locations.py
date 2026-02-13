"""
Location data for incident generation.
Represents a small urban area (~500m x 500m) with named landmarks.
Coordinates are in meters (NED-compatible: x=North, y=East).
"""

LANDMARKS = [
    {"name": "Baylands Park",         "x":  80, "y": -40},
    {"name": "Main St & 3rd Ave",     "x":  50, "y":  30},
    {"name": "Riverside Apartments",  "x": -30, "y":  60},
    {"name": "Lincoln Elementary",    "x": -60, "y": -20},
    {"name": "Downtown Plaza",        "x":  10, "y":  10},
    {"name": "Highway 101 Overpass",  "x": 100, "y":  50},
    {"name": "Willow Creek Trail",    "x": -80, "y": -70},
    {"name": "Eastside Shopping Ctr", "x":  40, "y":  80},
    {"name": "City Hall",             "x":   0, "y":  20},
    {"name": "Memorial Hospital",     "x":  60, "y": -60},
    {"name": "Oak St Residential",    "x": -40, "y":  40},
    {"name": "Industrial Park",       "x":  90, "y": -80},
]

ROADS = [
    "Highway 101",
    "Main Street",
    "Oak Boulevard",
    "Riverside Drive",
    "3rd Avenue",
]

INTERSECTIONS = [
    "Main St & 3rd Ave",
    "Oak Blvd & Riverside Dr",
    "Highway 101 & Industrial Way",
]
