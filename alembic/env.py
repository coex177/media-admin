"""Alembic environment: schema source of truth is src.models (Base.metadata); URL from DATABASE_URL."""

import sys
from logging.config import fileConfig
from pathlib import Path

from alembic import context
from sqlalchemy import engine_from_config, pool

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from src.database import Base, database_url  # noqa: E402
import src.models  # noqa: E402,F401  — registers every table

config = context.config
if config.config_file_name:
    fileConfig(config.config_file_name)
if not config.get_main_option("sqlalchemy.url"):
    config.set_main_option("sqlalchemy.url", database_url().replace("%", "%%"))

target_metadata = Base.metadata


def run_migrations_offline():
    context.configure(url=config.get_main_option("sqlalchemy.url"), target_metadata=target_metadata,
                      literal_binds=True, dialect_opts={"paramstyle": "named"})
    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online():
    connectable = engine_from_config(config.get_section(config.config_ini_section, {}),
                                     prefix="sqlalchemy.", poolclass=pool.NullPool)
    with connectable.connect() as connection:
        context.configure(connection=connection, target_metadata=target_metadata, render_as_batch=True)
        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
