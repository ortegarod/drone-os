"""
Incident type definitions for the dispatch system.
These mirror real police CAD (Computer-Aided Dispatch) categories.
"""

INCIDENT_TYPES = [
    {
        "type": "medical_emergency",
        "priority": 1,
        "templates": [
            "Cardiac arrest, {age}yo {gender}",
            "Unconscious person at {location}",
            "Severe allergic reaction, child",
            "Drowning reported at {location}",
        ],
    },
    {
        "type": "structure_fire",
        "priority": 1,
        "templates": [
            "Residential fire, smoke visible from {location}",
            "Commercial building fire, possible occupants trapped",
            "Kitchen fire spreading to adjacent units",
        ],
    },
    {
        "type": "traffic_accident",
        "priority": 1,
        "templates": [
            "Multi-vehicle collision on {road}",
            "Pedestrian struck by vehicle at {intersection}",
            "Rollover accident, occupants trapped",
            "Hit and run, victim injured at {location}",
        ],
    },
    {
        "type": "suspicious_activity",
        "priority": 2,
        "templates": [
            "Armed individual reported near {location}",
            "Suspicious vehicle circling {location}",
            "Trespasser on commercial property at {location}",
            "Possible break-in in progress at {location}",
        ],
    },
    {
        "type": "missing_person",
        "priority": 2,
        "templates": [
            "Child missing from {location}, last seen 20 min ago",
            "Elderly person with dementia wandered from {location}",
            "Hiker overdue, last known position near {location}",
        ],
    },
    {
        "type": "noise_complaint",
        "priority": 3,
        "templates": [
            "Loud party at {location}",
            "Construction noise outside permitted hours at {location}",
        ],
    },
    {
        "type": "property_damage",
        "priority": 3,
        "templates": [
            "Vandalism at {location}",
            "Broken storefront window at {location}",
            "Graffiti reported on {location}",
        ],
    },
]
