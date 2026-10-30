"""Jobs and plugins: what a drone does beyond being flown by hand (patrol, dispatch, ...).

A plugin is a manifest (see docs/design/plugins.md) plus a service the fleet API reaches over
HTTP. Plugins come and go while the fleet API runs (PluginRegistry): bundled ones are folders
with a droneos-plugin.json, installed ones are added through the API and get their own token.
The fleet API starts jobs through the plugin's service, keeps one job per drone, and decides
how a job ended when someone else steps in.
"""

import hashlib
import json
import logging
import re
import secrets
import threading
import time
import urllib.error
import urllib.request
import uuid
from pathlib import Path

log = logging.getLogger("fleet_api.jobs")


def load_plugins(path):
    """{id: manifest} from <path>/*/droneos-plugin.json. A missing dir means no plugins."""
    out = {}
    root = Path(path).expanduser() if path else None
    if not root or not root.is_dir():
        return out
    for f in sorted(root.glob("*/droneos-plugin.json")):
        try:
            m = json.loads(f.read_text())
            assert m.get("id") and m.get("service_url")
            m.setdefault("operator", m["id"])
            m.setdefault("name", m["id"])
            out[m["id"]] = m
        except (OSError, ValueError, AssertionError) as e:
            log.warning("ignoring plugin manifest %s: %s", f, e)
    return out


ID_RE = re.compile(r"^[a-z][a-z0-9_-]{1,31}$")
MANIFEST_KEYS = ("id", "name", "version", "description", "operator", "service_url", "ui", "onboard_mode")


def _hash(token):
    return hashlib.sha256(token.encode()).hexdigest()


class PluginRegistry:
    """The plugins the fleet API knows, kept current without a restart.

    - bundled: <bundled_dir>/*/droneos-plugin.json, re-read whenever that folder changes
      (drop a plugin folder in, it shows up; delete it, it's gone). Their operator tokens
      live in the fleet API tokens file like any operator's.
    - installed: added with install() (POST /api/v1/plugins), kept in <state_path>. Each one
      gets its own operator token, generated here and shown once; only its hash is stored.
    - static: a fixed {id: manifest} (tests).
    A bundled plugin wins over an installed one with the same id (install refuses that).
    """

    RESCAN_S = 1.0

    def __init__(self, bundled_dir=None, state_path=None, static=None):
        self.bundled_dir = Path(bundled_dir).expanduser() if bundled_dir else None
        self.state_path = Path(state_path).expanduser() if state_path else None
        self._lock = threading.RLock()
        self._static = dict(static or {})
        self._bundled, self._sig, self._scanned = {}, None, None
        self._installed = {}   # id -> {"manifest", "token_sha256", "installed", "updated", "by"}
        if self.state_path and self.state_path.exists():
            try:
                self._installed = json.loads(self.state_path.read_text()).get("plugins", {})
            except (OSError, ValueError) as e:
                log.warning("ignoring unreadable installed plugins %s: %s", self.state_path, e)

    # -- reading ------------------------------------------------------------

    def _rescan(self):
        now = time.monotonic()
        if not self.bundled_dir or (self._scanned is not None and now - self._scanned < self.RESCAN_S):
            return
        first = self._scanned is None
        self._scanned = now
        files = sorted(self.bundled_dir.glob("*/droneos-plugin.json")) if self.bundled_dir.is_dir() else []
        sig = []
        for f in files:
            try:
                st = f.stat()
                sig.append((str(f), st.st_mtime_ns, st.st_size))
            except OSError:
                pass
        if sig != self._sig:
            self._sig = sig
            before = set(self._bundled)
            self._bundled = load_plugins(self.bundled_dir)
            if not first and before != set(self._bundled):
                log.info("bundled plugins now: %s", sorted(self._bundled))

    def all(self):
        """{id: manifest}, current."""
        with self._lock:
            self._rescan()
            out = {**self._static, **self._bundled}   # bundled first, then installed (bundled wins a clash)
            for pid, rec in self._installed.items():
                out.setdefault(pid, rec["manifest"])
            return {k: dict(v) for k, v in out.items()}

    def source(self, pid):
        with self._lock:
            self._rescan()
            if pid in self._static or pid in self._bundled:
                return "bundled"
            return "installed" if pid in self._installed else None

    def get(self, pid, default=None):
        return self.all().get(pid, default)

    def values(self):
        return self.all().values()

    def __iter__(self):
        return iter(self.all())

    def __contains__(self, pid):
        return pid in self.all()

    def __len__(self):
        return len(self.all())

    def operator_for_token(self, token):
        """The operator name an installed plugin's token stands for, or None."""
        if not token:
            return None
        h = _hash(token)
        with self._lock:
            for rec in self._installed.values():
                if secrets.compare_digest(rec.get("token_sha256", ""), h):
                    return rec["manifest"]["operator"]
        return None

    # -- changing -----------------------------------------------------------

    def _save(self):
        if not self.state_path:
            return
        self.state_path.parent.mkdir(parents=True, exist_ok=True)
        tmp = self.state_path.with_suffix(".tmp")
        tmp.write_text(json.dumps({"plugins": self._installed}, indent=1))
        tmp.chmod(0o600)
        tmp.replace(self.state_path)

    @staticmethod
    def validate(manifest):
        """A clean manifest (known keys only) or ValueError saying what's wrong."""
        if not isinstance(manifest, dict):
            raise ValueError("manifest must be a JSON object")
        m = {k: manifest[k] for k in MANIFEST_KEYS if manifest.get(k) not in (None, "")}
        for k, v in m.items():
            if not isinstance(v, str):
                raise ValueError(f"{k} must be a string")
        if not ID_RE.match(m.get("id", "")):
            raise ValueError("id: 2-32 chars, lowercase letters, digits, - or _, starting with a letter")
        m.setdefault("operator", m["id"])
        m.setdefault("name", m["id"])
        if not ID_RE.match(m["operator"]):
            raise ValueError("operator: same rules as id")
        if not re.match(r"^https?://[^/\s]+", m.get("service_url", "")):
            raise ValueError("service_url: http(s)://host:port where the fleet API reaches the plugin's service")
        if "ui" in m and not (m["ui"].startswith("/") or m["ui"].startswith("builtin:")):
            raise ValueError("ui: a path on the plugin's service, like /ui/job.js")
        return m

    def install(self, manifest, by, taken_operators=(), rotate_token=False):
        """Add or update an installed plugin. Returns (manifest, token or None, created).
        A token comes back for a new plugin, when its operator changes, or with rotate_token;
        otherwise an update keeps the old token.
        taken_operators: operator names that belong to people or other services."""
        m = self.validate(manifest)
        with self._lock:
            self._rescan()
            if m["id"] in self._bundled or m["id"] in self._static:
                raise ValueError(f"{m['id']} is a bundled plugin (a folder in the plugins dir); change it there")
            others = {pid: x["operator"] for pid, x in self.all().items() if pid != m["id"]}
            for pid, o in others.items():
                if o == m["operator"]:
                    raise ValueError(f"operator {o} is already used by plugin {pid}")
            if m["operator"] in set(taken_operators):
                raise ValueError(f"operator {m['operator']} is already someone's name; pick another")
            old = self._installed.get(m["id"])
            token = None
            if old is None or rotate_token or old["manifest"]["operator"] != m["operator"]:
                token = "dpl_" + secrets.token_urlsafe(32)
            now = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
            self._installed[m["id"]] = {
                "manifest": m,
                "token_sha256": _hash(token) if token else old["token_sha256"],
                "installed": (old or {}).get("installed") or now,
                "updated": now,
                "by": by,
            }
            self._save()
            return dict(m), token, old is None

    def remove(self, pid):
        """Remove an installed plugin (its token stops working). Returns its manifest."""
        with self._lock:
            self._rescan()
            if pid in self._bundled or pid in self._static:
                raise ValueError(f"{pid} is a bundled plugin; remove its folder from the plugins dir instead")
            rec = self._installed.pop(pid, None)
            if rec is None:
                raise KeyError(pid)
            self._save()
            return rec["manifest"]


class PluginError(Exception):
    def __init__(self, status, detail):
        super().__init__(detail)
        self.status = status


def call_plugin(manifest, method, path, body=None, operator=None, caller=True, raw_body=None,
                content_type="application/json", timeout=30):
    """HTTP to a plugin's service. Returns (status, content_type, bytes)."""
    data = raw_body if raw_body is not None else (json.dumps(body).encode() if body is not None else None)
    headers = {"Content-Type": content_type}
    if caller:
        headers["X-DroneOS-Caller"] = "fleet-api"
    if operator:
        headers["X-DroneOS-Operator"] = operator
    req = urllib.request.Request(manifest["service_url"].rstrip("/") + path, method=method, data=data, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.status, r.headers.get("Content-Type", ""), r.read()
    except urllib.error.HTTPError as e:
        return e.code, e.headers.get("Content-Type", ""), e.read()
    except urllib.error.URLError as e:
        raise PluginError(503, f"plugin {manifest['id']} unreachable: {e.reason}") from None


class JobStore:
    """Active job per drone + history, kept on disk."""

    def __init__(self, path=None):
        self.path = Path(path).expanduser() if path else None
        self._lock = threading.Lock()
        self._active, self._history = {}, []
        if self.path and self.path.exists():
            try:
                d = json.loads(self.path.read_text())
                self._active, self._history = d.get("active", {}), d.get("history", [])
            except (OSError, ValueError) as e:
                log.warning("ignoring unreadable jobs %s: %s", self.path, e)

    def _save(self):
        if not self.path:
            return
        self.path.parent.mkdir(parents=True, exist_ok=True)
        tmp = self.path.with_suffix(".tmp")
        tmp.write_text(json.dumps({"active": self._active, "history": self._history[-500:]}))
        tmp.replace(self.path)

    def active(self, drone):
        with self._lock:
            j = self._active.get(drone)
            return dict(j) if j else None

    def all_active(self):
        with self._lock:
            return {k: dict(v) for k, v in self._active.items()}

    def begin(self, drone, plugin, operator, args):
        with self._lock:
            if drone in self._active:
                raise ValueError(f"{drone} already has a job ({self._active[drone]['plugin']})")
            t = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
            j = {"id": time.strftime("%Y%m%d-%H%M%S-", time.gmtime()) + uuid.uuid4().hex[:6], "drone": drone,
                 "plugin": plugin, "operator": operator, "args": args, "started": t, "ended": None,
                 "status": "running", "result": None, "reason": "", "text": "", "links": {}}
            self._active[drone] = j
            self._save()
            return dict(j)

    def update(self, drone, **fields):
        with self._lock:
            j = self._active.get(drone)
            if not j:
                return None
            if "links" in fields:
                j["links"] = {**j.get("links", {}), **(fields.pop("links") or {})}
            j.update({k: v for k, v in fields.items() if k in ("text",)})
            self._save()
            return dict(j)

    def end(self, drone, result, reason="", links=None, job_id=None):
        with self._lock:
            j = self._active.get(drone)
            if not j or (job_id and j["id"] != job_id):
                return None
            del self._active[drone]
            j.update(status="ended", result=result, reason=reason,
                     ended=time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()))
            if links:
                j["links"] = {**j.get("links", {}), **links}
            self._history.append(j)
            self._save()
            return dict(j)

    def history(self, drone=None, plugin=None, limit=50):
        with self._lock:
            h = [j for j in self._history if (drone is None or j["drone"] == drone) and (plugin is None or j["plugin"] == plugin)]
            return [dict(j) for j in reversed(h[-limit:])]
