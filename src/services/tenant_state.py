"""Per-tenant replacements for module-level status globals.

    _scan_status = TenantState({"running": False, "progress": 0})
    _scan_status["progress"] = 50          # only this tenant's copy changes
    dict(_scan_status)                      # this tenant's snapshot

Call sites keep their dict/list syntax; the tenant comes from the request
context (or the background task that inherited it).

ponytail: in-memory, so one worker process. When the app runs multiple
workers, back this with a jobs table — the API surface stays the same.
"""

import copy
from collections.abc import MutableMapping

from ..models import current_tenant_id


def _tenant() -> int:
    tid = current_tenant_id.get()
    if tid is None:
        raise RuntimeError("tenant state used outside a tenant context")
    return tid


class TenantState(MutableMapping):
    def __init__(self, default: dict):
        self._default = default
        self._by_tenant: dict[int, dict] = {}

    def _d(self) -> dict:
        return self._by_tenant.setdefault(_tenant(), copy.deepcopy(self._default))

    def __getitem__(self, k):
        return self._d()[k]

    def __setitem__(self, k, v):
        self._d()[k] = v

    def __delitem__(self, k):
        del self._d()[k]

    def __iter__(self):
        return iter(self._d())

    def __len__(self):
        return len(self._d())

    def reset(self, **overrides):
        """Back to the default shape (what `_x = {...}` reassignment used to do)."""
        self._by_tenant[_tenant()] = {**copy.deepcopy(self._default), **overrides}


class TenantList:
    """A per-tenant list. get() returns the live list; set() replaces it."""

    def __init__(self):
        self._by_tenant: dict[int, list] = {}

    def get(self) -> list:
        return self._by_tenant.setdefault(_tenant(), [])

    def set(self, items: list):
        self._by_tenant[_tenant()] = list(items)
