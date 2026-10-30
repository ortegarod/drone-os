"""Operator accounts: people (and scripts) who use the fleet API, each with a role and a token.

Two kinds:
  - file operators: the tokens file (FLEET_API_TOKENS, {"<token>": "<name>"}). Bootstrap and
    services (the first admin, the bundled plugins). Changed by editing the file.
  - accounts: added through the API by an admin (POST /api/v1/operators). The token is generated
    here and shown once; only its sha256 is stored (FLEET_API_OPERATORS).

Roles: admin (everything, incl. operators and plugins), pilot (fly, start/stop jobs), viewer
(read only: watch the fleet, the log, reports).
"""

import hashlib
import json
import logging
import re
import secrets
import threading
import time
from pathlib import Path

log = logging.getLogger("fleet_api.accounts")

ROLES = ("admin", "pilot", "viewer")
NAME_RE = re.compile(r"^[a-z][a-z0-9_-]{1,31}$")
RESERVED = {"fleet-api", "px4", "admin", "system"}


def _hash(token):
    return hashlib.sha256(token.encode()).hexdigest()


def now():
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())


class Accounts:
    def __init__(self, path=None):
        self.path = Path(path).expanduser() if path else None
        self._lock = threading.Lock()
        self._acc = {}   # name -> {"role", "token_sha256", "created", "by", "token_issued"}
        if self.path and self.path.exists():
            try:
                self._acc = json.loads(self.path.read_text()).get("operators", {})
            except (OSError, ValueError) as e:
                log.warning("ignoring unreadable operators file %s: %s", self.path, e)

    def _save(self):
        if not self.path:
            return
        self.path.parent.mkdir(parents=True, exist_ok=True)
        tmp = self.path.with_suffix(".tmp")
        tmp.write_text(json.dumps({"operators": self._acc}, indent=1))
        tmp.chmod(0o600)
        tmp.replace(self.path)

    @staticmethod
    def _new_token():
        return "dop_" + secrets.token_urlsafe(32)

    def lookup(self, token):
        """Account name for a token, or None."""
        if not token:
            return None
        h = _hash(token)
        with self._lock:
            for name, a in self._acc.items():
                if secrets.compare_digest(a["token_sha256"], h):
                    return name
        return None

    def role(self, name):
        with self._lock:
            a = self._acc.get(name)
            return a["role"] if a else None

    def names(self):
        with self._lock:
            return set(self._acc)

    def list(self):
        with self._lock:
            return [{"name": n, "role": a["role"], "created": a["created"], "by": a["by"],
                     "token_issued": a.get("token_issued")} for n, a in sorted(self._acc.items())]

    def create(self, name, role, by, taken=()):
        """New account -> its token (shown once)."""
        if not NAME_RE.match(name or "") or name in RESERVED:
            raise ValueError("name: 2-32 chars, lowercase letters, digits, - or _, starting with a letter")
        if role not in ROLES:
            raise ValueError(f"role must be one of {', '.join(ROLES)}")
        with self._lock:
            if name in self._acc or name in set(taken):
                raise ValueError(f"{name} already exists")
            token = self._new_token()
            self._acc[name] = {"role": role, "token_sha256": _hash(token), "created": now(), "by": by,
                               "token_issued": now()}
            self._save()
            return token

    def set_role(self, name, role):
        if role not in ROLES:
            raise ValueError(f"role must be one of {', '.join(ROLES)}")
        with self._lock:
            if name not in self._acc:
                raise KeyError(name)
            self._acc[name]["role"] = role
            self._save()

    def new_token(self, name):
        """Replace an account's token (the old one stops working) -> the new token."""
        with self._lock:
            if name not in self._acc:
                raise KeyError(name)
            token = self._new_token()
            self._acc[name].update(token_sha256=_hash(token), token_issued=now())
            self._save()
            return token

    def remove(self, name):
        with self._lock:
            if self._acc.pop(name, None) is None:
                raise KeyError(name)
            self._save()
