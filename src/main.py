"""FastAPI application entry point for media-admin."""

import logging
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, JSONResponse
from fastapi.middleware.cors import CORSMiddleware

from .database import init_database
from .routers import shows_router, scan_router, actions_router, settings_router, watcher_router

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

        # Migrate scan_folders: rename folder_type 'download' → 'tv'
        if "scan_folders" in inspector.get_table_names():
            result = conn.execute(text("SELECT COUNT(*) FROM scan_folders WHERE folder_type = 'download'"))
            count = result.scalar()
            if count > 0:
                logger.info(f"Migrating {count} scan_folders from folder_type='download' to 'tv'")
                conn.execute(text("UPDATE scan_folders SET folder_type = 'tv' WHERE folder_type = 'download'"))
                conn.commit()


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Application lifespan events."""
    # Startup
    logger.info("Starting media-admin...")
    init_database()
    run_migrations()
    logger.info("Database initialized")

    # Auto-start watcher if previously enabled
    try:
        from .database import get_session_maker
        from .routers.watcher import auto_start_watcher
        SessionLocal = get_session_maker()
        db = SessionLocal()
        try:
            auto_start_watcher(db)
        finally:
            db.close()
    except Exception as e:
        logger.error(f"Watcher auto-start failed: {e}", exc_info=True)

    yield

    # Shutdown
    from .services.watcher import watcher_service
    if watcher_service.is_running:
        logger.info("Stopping media watcher...")
        watcher_service.stop()
    logger.info("Shutting down media-admin...")


# Create FastAPI application
app = FastAPI(
    title="Media Admin",
    description="A Linux-native TV show organization tool with web UI",
    version="0.1.0",
    lifespan=lifespan,
)

# Add CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Include routers
app.include_router(shows_router)
app.include_router(scan_router)
app.include_router(actions_router)
app.include_router(settings_router)
app.include_router(watcher_router)

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
