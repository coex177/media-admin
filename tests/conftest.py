import pytest
from sqlalchemy import create_engine
from sqlalchemy.pool import StaticPool

import src.database as database
from src.database import Base
import src.models  # noqa: F401  — registers all tables


@pytest.fixture
def db_engine():
    """Point the app's singleton engine at a fresh in-memory SQLite for one test."""
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(engine)
    database._engine, database._session_maker = engine, None
    yield engine
    database._engine, database._session_maker = None, None
    engine.dispose()


@pytest.fixture
def db(db_engine):
    session = database.get_session_maker()()
    yield session
    session.close()
