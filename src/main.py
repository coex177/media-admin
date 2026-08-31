"""FastAPI application entry point for media-admin."""

import asyncio
import logging
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import Depends, FastAPI, Request
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, JSONResponse

from .database import init_database
from .routers import shows_router, scan_router, actions_router, settings_router, watcher_router, movies_router, feeds_router
from .services.agent_hub import router as agent_router
from .routers.auth import router as auth_router, require_user
from .routers.agents import router as agents_router

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
)
logger = logging.getLogger(__name__)


def run_migrations():
    """Run database migrations for new columns."""
    from .database import get_engine
    from sqlalchemy import text, inspect

    engine = get_engine()
    inspector = inspect(engine)

    with engine.connect() as conn:
        columns = [c["name"] for c in inspector.get_columns("shows")]

        # Add metadata_source column to shows table if missing
        if "metadata_source" not in columns:
            logger.info("Adding metadata_source column to shows table")
            conn.execute(text("ALTER TABLE shows ADD COLUMN metadata_source VARCHAR(10) DEFAULT 'tmdb' NOT NULL"))
            conn.commit()

        # Add tvdb_season_type column if missing
        if "tvdb_season_type" not in columns:
            logger.info("Adding tvdb_season_type column to shows table")
            conn.execute(text("ALTER TABLE shows ADD COLUMN tvdb_season_type VARCHAR(20) DEFAULT 'official'"))
            conn.commit()

        # Add aliases column if missing
        if "aliases" not in columns:
            logger.info("Adding aliases column to shows table")
            conn.execute(text("ALTER TABLE shows ADD COLUMN aliases TEXT"))
            conn.commit()

        # Make tmdb_id nullable: SQLite doesn't support ALTER COLUMN, so we recreate the table
        # Check if tmdb_id is currently NOT NULL by inspecting the column
        col_info = {c["name"]: c for c in inspector.get_columns("shows")}
        if col_info.get("tmdb_id", {}).get("nullable") is False:
            logger.info("Migrating shows table to make tmdb_id nullable")
            conn.execute(text("PRAGMA foreign_keys=OFF"))
            conn.execute(text("""
                CREATE TABLE shows_new (
                    id INTEGER NOT NULL PRIMARY KEY,
                    tmdb_id INTEGER,
                    tvdb_id INTEGER,
                    imdb_id VARCHAR(20),
                    metadata_source VARCHAR(10) NOT NULL DEFAULT 'tmdb',
                    name VARCHAR(255) NOT NULL,
                    overview TEXT,
                    poster_path VARCHAR(255),
                    backdrop_path VARCHAR(255),
                    folder_path VARCHAR(1024),
                    season_format VARCHAR(255) NOT NULL,
                    episode_format VARCHAR(255) NOT NULL,
                    do_rename BOOLEAN NOT NULL,
                    do_missing BOOLEAN NOT NULL,
                    status VARCHAR(50) NOT NULL,
                    first_air_date VARCHAR(10),
                    number_of_seasons INTEGER NOT NULL,
                    number_of_episodes INTEGER NOT NULL,
                    created_at DATETIME NOT NULL,
                    last_updated DATETIME NOT NULL,
                    genres TEXT,
                    networks TEXT,
                    next_episode_air_date VARCHAR(10),
                    UNIQUE (tmdb_id)
                )
            """))
            # Copy data - if metadata_source column didn't exist before, default to 'tmdb'
            existing_cols = [c["name"] for c in inspector.get_columns("shows")]
            if "metadata_source" in existing_cols:
                conn.execute(text("""
                    INSERT INTO shows_new SELECT id, tmdb_id, tvdb_id, imdb_id, metadata_source,
                        name, overview, poster_path, backdrop_path, folder_path,
                        season_format, episode_format, do_rename, do_missing, status,
                        first_air_date, number_of_seasons, number_of_episodes,
                        created_at, last_updated, genres, networks, next_episode_air_date
                    FROM shows
                """))
            else:
                conn.execute(text("""
                    INSERT INTO shows_new SELECT id, tmdb_id, tvdb_id, imdb_id, 'tmdb',
                        name, overview, poster_path, backdrop_path, folder_path,
                        season_format, episode_format, do_rename, do_missing, status,
                        first_air_date, number_of_seasons, number_of_episodes,
                        created_at, last_updated, genres, networks, next_episode_air_date
                    FROM shows
                """))
            conn.execute(text("DROP TABLE shows"))
            conn.execute(text("ALTER TABLE shows_new RENAME TO shows"))
            conn.execute(text("PRAGMA foreign_keys=ON"))
            conn.commit()
            logger.info("Shows table migration complete")

        # Migrate watcher_issues_folder setting → scan_folders row
        if "scan_folders" in inspector.get_table_names():
            result = conn.execute(text(
                "SELECT value FROM app_settings WHERE key = 'watcher_issues_folder'"
            ))
            row = result.fetchone()
            if row and row[0]:
                issues_path = row[0]
                existing = conn.execute(text(
                    "SELECT id FROM scan_folders WHERE folder_type = 'issues' AND path = :path"
                ), {"path": issues_path})
                if not existing.fetchone():
                    logger.info(f"Migrating watcher_issues_folder to scan_folders: {issues_path}")
                    conn.execute(text(
                        "INSERT INTO scan_folders (path, folder_type, enabled, created_at) VALUES (:path, 'issues', 1, datetime('now'))"
                    ), {"path": issues_path})
                    conn.commit()

        # Migrate scan_folders: rename folder_type 'download' → 'tv'
        if "scan_folders" in inspector.get_table_names():
            result = conn.execute(text("SELECT COUNT(*) FROM scan_folders WHERE folder_type = 'download'"))
            count = result.scalar()
            if count > 0:
                logger.info(f"Migrating {count} scan_folders from folder_type='download' to 'tv'")
                conn.execute(text("UPDATE scan_folders SET folder_type = 'tv' WHERE folder_type = 'download'"))
                conn.commit()

        # ── Movie support migrations ──

        # Add movie_id to pending_actions if missing
        if "pending_actions" in inspector.get_table_names():
            pa_columns = [c["name"] for c in inspector.get_columns("pending_actions")]
            if "movie_id" not in pa_columns:
                logger.info("Adding movie_id column to pending_actions table")
                conn.execute(text("ALTER TABLE pending_actions ADD COLUMN movie_id INTEGER REFERENCES movies(id) ON DELETE SET NULL"))
                conn.commit()

        # Add movie columns to library_log if missing
        if "library_log" in inspector.get_table_names():
            ll_columns = [c["name"] for c in inspector.get_columns("library_log")]
            if "movie_id" not in ll_columns:
                logger.info("Adding movie columns to library_log table")
                conn.execute(text("ALTER TABLE library_log ADD COLUMN movie_id INTEGER REFERENCES movies(id) ON DELETE SET NULL"))
                conn.execute(text("ALTER TABLE library_log ADD COLUMN movie_title VARCHAR(500)"))
                conn.execute(text("ALTER TABLE library_log ADD COLUMN media_type VARCHAR(20)"))
                conn.commit()

        # Tenancy: every business table gets tenant_id (default 1 = the pre-tenancy install).
        # ponytail: no REFERENCES clause — SQLite can't add a NOT NULL FK column in place;
        # the real constraint lives in the model and lands with the Postgres schema.
        insp = inspect(engine)
        for table in ("shows", "episodes", "movies", "scan_folders", "pending_actions", "app_settings",
                      "ignored_episodes", "watcher_log", "library_log", "rss_feeds"):
            if table in insp.get_table_names() and "tenant_id" not in [c["name"] for c in insp.get_columns(table)]:
                logger.info(f"Adding tenant_id column to {table}")
                conn.execute(text(f"ALTER TABLE {table} ADD COLUMN tenant_id INTEGER NOT NULL DEFAULT 1"))
                conn.execute(text(f"CREATE INDEX IF NOT EXISTS ix_{table}_tenant_id ON {table} (tenant_id)"))
                conn.commit()
        if "agent_id" not in [c["name"] for c in inspect(engine).get_columns("scan_folders")]:
            logger.info("Adding agent_id column to scan_folders")
            conn.execute(text("ALTER TABLE scan_folders ADD COLUMN agent_id INTEGER"))
            conn.commit()
        if conn.execute(text("SELECT COUNT(*) FROM tenants")).scalar() == 0:
            conn.execute(text("INSERT INTO tenants (id, name, created_at) VALUES (1, 'default', CURRENT_TIMESTAMP)"))
            conn.commit()

        # Add movie columns to watcher_log if missing
        if "watcher_log" in inspector.get_table_names():
            wl_columns = [c["name"] for c in inspector.get_columns("watcher_log")]
            if "movie_id" not in wl_columns:
                logger.info("Adding movie columns to watcher_log table")
                conn.execute(text("ALTER TABLE watcher_log ADD COLUMN movie_id INTEGER REFERENCES movies(id) ON DELETE SET NULL"))
                conn.execute(text("ALTER TABLE watcher_log ADD COLUMN movie_title VARCHAR(500)"))
                conn.execute(text("ALTER TABLE watcher_log ADD COLUMN media_type VARCHAR(20)"))
                conn.commit()


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Application lifespan events."""
    # Startup
    logger.info("Starting media-admin...")
    init_database()
    run_migrations()
    logger.info("Database initialized")

    # Resume every tenant's watcher that was enabled (agent folders attach as agents connect)
    from .services.watch_manager import watch_manager
    await asyncio.to_thread(watch_manager.auto_start_all)

    yield

    # Shutdown
    watch_manager.shutdown()
    logger.info("Shutting down media-admin...")


# Create FastAPI application
app = FastAPI(
    title="Media Admin",
    description="A Linux-native TV show organization tool with web UI",
    version="0.1.0",
    lifespan=lifespan,
)

# Include routers
# Every API router is behind require_user, which also scopes the ORM to the caller's tenant.
# tests/test_tenancy.py asserts no /api route slips through without it.
AUTHED = [Depends(require_user)]
app.include_router(auth_router)
app.include_router(agent_router)          # agents authenticate with their own token
for r in (shows_router, scan_router, actions_router, settings_router, watcher_router, movies_router, feeds_router, agents_router):
    app.include_router(r, dependencies=AUTHED)

# Static files directory
STATIC_DIR = Path(__file__).parent / "static"


# Mount static files
if STATIC_DIR.exists():
    app.mount("/static", StaticFiles(directory=str(STATIC_DIR)), name="static")


@app.get("/")
async def root():
    """Serve the main web UI."""
    index_path = STATIC_DIR / "index.html"
    if index_path.exists():
        return FileResponse(index_path)
    return JSONResponse(
        content={
            "message": "Media Admin API",
            "docs": "/docs",
            "version": "0.1.0",
        }
    )


@app.get("/health")
async def health_check():
    """Health check endpoint."""
    return {"status": "healthy"}


@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    """Global exception handler."""
    logger.error(f"Unhandled exception: {exc}", exc_info=True)
    return JSONResponse(
        status_code=500,
        content={"detail": "Internal server error"},
    )


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(
        "src.main:app",
        host="0.0.0.0",
        port=8095,
        reload=True,
    )
