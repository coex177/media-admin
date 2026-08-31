"""SQLite database setup and session management."""

import os

from sqlalchemy import create_engine, event
from sqlalchemy.orm import DeclarativeBase, sessionmaker, Session
from sqlalchemy.engine import Engine

from .config import get_database_path, get_project_root


class Base(DeclarativeBase):
    """Base class for all database models."""
    pass


# Singleton engine and session maker to ensure consistent database access
_engine = None
_session_maker = None


def database_url() -> str:
    """DATABASE_URL (e.g. postgresql+psycopg://user:pw@host/db) or the local SQLite file."""
    return os.environ.get("DATABASE_URL") or f"sqlite:///{get_database_path()}"


def _sqlite_pragmas(dbapi_connection, _record):
    cursor = dbapi_connection.cursor()
    cursor.execute("PRAGMA foreign_keys=ON")
    cursor.execute("PRAGMA journal_mode=WAL")      # readers don't block the writer (scans + watcher + UI)
    cursor.execute("PRAGMA busy_timeout=30000")    # wait instead of 'database is locked'
    cursor.close()


def get_engine():
    """Get or create the singleton database engine."""
    global _engine
    if _engine is None:
        url = database_url()
        if url.startswith("sqlite"):
            _engine = create_engine(url, connect_args={"check_same_thread": False, "timeout": 30})
            event.listen(_engine, "connect", _sqlite_pragmas)
        else:
            _engine = create_engine(url, pool_pre_ping=True)
    return _engine


def get_session_maker():
    """Get or create the singleton session maker."""
    global _session_maker
    if _session_maker is None:
        engine = get_engine()
        _session_maker = sessionmaker(autocommit=False, autoflush=False, bind=engine)
    return _session_maker


def init_database():
    """SQLite: create_all + the legacy in-app migrations (main.run_migrations).
    Anything else (Postgres): Alembic owns the schema — upgrade to head."""
    engine = get_engine()
    if engine.dialect.name == "sqlite":
        Base.metadata.create_all(bind=engine)
        return
    from alembic import command
    from alembic.config import Config
    cfg = Config(str(get_project_root() / "alembic.ini"))
    cfg.set_main_option("sqlalchemy.url", database_url().replace("%", "%%"))
    command.upgrade(cfg, "head")


def get_db():
    """Dependency to get a database session."""
    SessionLocal = get_session_maker()
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
