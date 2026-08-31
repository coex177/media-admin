"""Against a real Postgres (TEST_DATABASE_URL): Alembic schema, per-tenant uniqueness, auth flow.

    docker run -d --rm --name pg -e POSTGRES_PASSWORD=pg -e POSTGRES_DB=media_admin -p 127.0.0.1:54329:5432 postgres:16-alpine
    TEST_DATABASE_URL=postgresql+psycopg://postgres:pg@127.0.0.1:54329/media_admin pytest tests/test_postgres.py
"""

import os

import pytest
from sqlalchemy import create_engine, text
from sqlalchemy.exc import IntegrityError

import src.database as database
from src.models import Show, current_tenant_id

URL = os.environ.get("TEST_DATABASE_URL")
pytestmark = pytest.mark.skipif(not URL, reason="TEST_DATABASE_URL not set")


@pytest.fixture
def pg(monkeypatch):
    monkeypatch.setenv("DATABASE_URL", URL)
    engine = create_engine(URL)
    with engine.begin() as c:
        c.execute(text("DROP SCHEMA public CASCADE; CREATE SCHEMA public;"))
    engine.dispose()
    database._engine, database._session_maker = None, None
    database.init_database()          # alembic upgrade head
    yield
    database._engine, database._session_maker = None, None


def test_schema_and_tenant_uniqueness(pg):
    from fastapi.testclient import TestClient
    from src.main import app

    with database.get_engine().connect() as c:
        assert c.execute(text("SELECT version_num FROM alembic_version")).scalar()
        tables = {r[0] for r in c.execute(text("SELECT tablename FROM pg_tables WHERE schemaname='public'"))}
    assert {"tenants", "users", "agents", "shows", "episodes", "scan_folders", "app_settings"} <= tables

    a, b = TestClient(app), TestClient(app)
    assert a.post("/api/auth/signup", json={"email": "a@x.com", "password": "hunter22"}).status_code == 200
    assert b.post("/api/auth/signup", json={"email": "b@x.com", "password": "hunter22"}).status_code == 200
    assert a.get("/api/shows").status_code == 200

    db = database.get_session_maker()()
    try:
        for tid in (1, 2):                                  # same tmdb_id in two tenants: allowed
            current_tenant_id.set(tid)
            db.add(Show(name=f"t{tid}", tmdb_id=42))
            db.commit()
        current_tenant_id.set(1)
        db.add(Show(name="dup", tmdb_id=42))                # same tenant: refused
        with pytest.raises(IntegrityError):
            db.commit()
        db.rollback()
        assert [s.name for s in db.query(Show).all()] == ["t1"]
    finally:
        current_tenant_id.set(None)
        db.close()
