"""HTTP client for the DroneOS fleet API. No dependencies beyond the standard library."""

import json
import os
import urllib.error
import urllib.request
from pathlib import Path

CONFIG_PATH = Path("~/.config/droneos/client.json").expanduser()


class DroneError(RuntimeError):
    """A drone command failed, was refused, or did not finish in time. `status`: the HTTP status, if any."""

    def __init__(self, message, status=None):
        super().__init__(message)
        self.status = status


def _config():
    """API URL and token: env vars win, then ~/.config/droneos/client.json."""
    cfg = {}
    if CONFIG_PATH.exists():
        cfg = json.loads(CONFIG_PATH.read_text())
    env = os.environ.get
    url = env("DRONEOS_API") or cfg.get("api") or "http://127.0.0.1:8090"
    key = env("DRONEOS_TOKEN") or cfg.get("token")
    if not key:
        raise DroneError(f"no API token: set DRONEOS_TOKEN or put {{\"token\": ...}} in {CONFIG_PATH}")
    return url.rstrip("/"), key


class Client:
    def __init__(self, api=None, key=None):
        url, tok = (api, key) if api and key else _config()
        self.api, self._token = url, tok

    def request(self, method, path, body=None, timeout=30, raw=False):
        data = json.dumps(body).encode() if body is not None else None
        req = urllib.request.Request(self.api + path, method=method, data=data, headers={
            "Authorization": f"Bearer {self._token}", "Content-Type": "application/json"})
        try:
            with urllib.request.urlopen(req, timeout=timeout) as r:
                out = r.read()
                return out if raw else json.loads(out or b"null")
        except urllib.error.HTTPError as e:
            try:
                detail = json.loads(e.read()).get("detail")
            except Exception:
                detail = e.reason
            raise DroneError(f"{detail}", e.code) from None
        except urllib.error.URLError as e:
            raise DroneError(f"cannot reach fleet API at {self.api}: {e.reason}", 503) from None
