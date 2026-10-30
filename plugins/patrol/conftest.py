import os
import sys

import pytest

os.environ["PATROL_NO_AUTOSTART"] = "1"
sys.path.insert(0, os.path.dirname(__file__))

import recorder as recmod  # noqa: E402


class FakeFleet:
    """What the recorder reads: raw drone_core state + mission status."""

    def __init__(self):
        self.states = {"drone2": {"arming_state": "ARMED", "nav_state": "OFFBOARD", "local_x": 0.0, "local_y": 0.0,
                                  "local_z": -20.0, "battery_remaining": 0.5}}
        self.status = {}

    def snapshot(self, name):
        return (dict(self.states[name]), True, 0.0) if name in self.states else None

    def mission_status(self, name):
        return dict(self.status)


@pytest.fixture
def env(tmp_path):
    f = FakeFleet()
    finished = []
    rec = recmod.PatrolRecorder(f, str(tmp_path / "patrols"), lambda drone: b"\xff\xd8fake-jpeg", on_finish=finished.append)
    f.finished = finished
    return f, rec
