"""Tenant isolation is enforced by the ORM, and every /api route is behind require_user."""

from sqlalchemy import func
from fastapi.testclient import TestClient

from src.models import Show, Tenant, User, current_tenant_id


def _two_tenants(db):
    db.add_all([Tenant(id=1, name="a"), Tenant(id=2, name="b")])
    db.commit()
    for tid, name in ((1, "A-show"), (2, "B-show")):
        current_tenant_id.set(tid)
        db.add(Show(name=name, tmdb_id=100))   # same tmdb_id in both tenants is legal
        db.commit()
    current_tenant_id.set(None)


def test_orm_scope_filters_and_stamps(db):
    _two_tenants(db)
    assert db.query(Show).count() == 2                     # no tenant → legacy/unscoped
    current_tenant_id.set(1)
    assert [s.name for s in db.query(Show).all()] == ["A-show"]
    assert db.query(func.count(Show.id)).scalar() == 1
    assert db.query(Show).filter(Show.id == 2).first() is None   # B's row by id → invisible
    assert db.query(Show).filter(Show.name == "B-show").update({"name": "hacked"}) == 0
    assert db.query(Show).delete() == 1                    # bulk delete only touches tenant 1
    current_tenant_id.set(None)
    assert [s.name for s in db.query(Show).all()] == ["B-show"]


def test_every_api_route_requires_auth(db_engine):
    from src.main import app
    from src.routers.auth import require_user

    public = {"/api/auth/login", "/api/auth/signup", "/api/auth/logout", "/api/agent/ws"}
    unguarded = []
    for route in app.routes:
        path = getattr(route, "path", "")
        if not path.startswith("/api/") or path in public:
            continue
        deps = [d.call for d in route.dependant.dependencies]
        if require_user not in deps:
            unguarded.append(path)
    assert unguarded == []


def test_auth_flow_and_agent_pairing(db_engine):
    from src.main import app

    c = TestClient(app)
    assert c.get("/api/auth/me").status_code == 401
    assert c.get("/api/shows").status_code == 401

    r = c.post("/api/auth/signup", json={"email": "Me@Example.com", "password": "hunter22"})
    assert r.status_code == 200 and r.json()["email"] == "me@example.com"
    assert c.get("/api/auth/me").status_code == 200

    r = c.post("/api/agents", json={"name": "nas"})
    token = r.json()["token"]
    assert r.status_code == 200 and len(token) > 30
    listed = c.get("/api/agents").json()
    assert listed[0]["name"] == "nas" and listed[0]["online"] is False and "token" not in listed[0]

    # the second signup gets its own tenant and cannot see the first tenant's agent
    c2 = TestClient(app)
    c2.post("/api/auth/signup", json={"email": "other@example.com", "password": "hunter22"})
    assert c2.get("/api/agents").json() == []
    assert c2.delete("/api/agents/1").status_code == 404

    assert c.post("/api/auth/logout").status_code == 200
    assert c.get("/api/auth/me").status_code == 401
    assert c.post("/api/auth/login", json={"email": "me@example.com", "password": "wrong"}).status_code == 401
    assert c.post("/api/auth/login", json={"email": "me@example.com", "password": "hunter22"}).status_code == 200
    assert c.get("/api/auth/me").json()["tenant_id"] == 1
