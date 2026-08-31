"""Status globals are per tenant: one tenant's scan progress never shows up for another."""

import pytest
from fastapi.testclient import TestClient

from src.models import current_tenant_id
from src.services.tenant_state import TenantList, TenantState


def test_tenant_state_isolation():
    st = TenantState({"running": False, "console": []})
    lst = TenantList()
    with pytest.raises(RuntimeError):
        st["running"]
    current_tenant_id.set(1)
    st["running"] = True
    st["console"].append("hi")          # nested mutation sticks (live dict, not a copy)
    lst.set([{"a": 1}])
    current_tenant_id.set(2)
    assert dict(st) == {"running": False, "console": []} and lst.get() == []
    current_tenant_id.set(1)
    assert dict(st) == {"running": True, "console": ["hi"]} and lst.get() == [{"a": 1}]
    st.reset(running=True)
    assert dict(st) == {"running": True, "console": []}
    current_tenant_id.set(None)


def test_scan_status_is_per_tenant(db_engine):
    from src.main import app
    from src.routers import scan

    a, b = TestClient(app), TestClient(app)
    a.post("/api/auth/signup", json={"email": "a@x.com", "password": "hunter22"})
    b.post("/api/auth/signup", json={"email": "b@x.com", "password": "hunter22"})
    current_tenant_id.set(1)
    scan._scan_status["running"] = True
    scan._scan_status["message"] = "tenant 1 scanning"
    current_tenant_id.set(None)
    assert a.get("/api/scan/status").json()["message"] == "tenant 1 scanning"
    assert b.get("/api/scan/status").json() == {"running": False, "type": None, "progress": 0, "message": "", "result": None}
