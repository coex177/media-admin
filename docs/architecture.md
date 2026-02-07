# Architecture Overview

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Backend | Python 3.10+, [FastAPI](https://fastapi.tiangolo.com/) |
| ORM | [SQLAlchemy](https://www.sqlalchemy.org/) 2.0 (mapped columns) |
| Database | SQLite (via `data/media-admin.db`) |
| HTTP Client | [httpx](https://www.python-httpx.org/) (async, for TMDB/TVDB API calls) |
| File Watcher | [watchdog](https://python-watchdog.readthedocs.io/) (inotify on Linux) |
| Settings | [pydantic-settings](https://docs.pydantic.dev/latest/concepts/pydantic_settings/) (env vars + `.env` file) |
| Frontend | Vanilla JavaScript SPA (no build step) |
| Routing | Hash-based (`#shows`, `#movies`, `#scan`, etc.) |
| Styling | Single CSS file with CSS custom properties for theming |

## Project Structure

```
media-admin/
├── src/
│   ├── main.py                  # FastAPI app, lifespan, migrations, static mount
│   ├── config.py                # Settings class (env prefix MEDIA_ADMIN_), paths
│   ├── database.py              # Engine/session singletons, init_database(), get_db()
│   ├── models/
│   │   ├── __init__.py          # Re-exports all models
│   │   ├── show.py              # Show model (TV series)
│   │   ├── episode.py           # Episode model (TV episodes)
│   │   ├── movie.py             # Movie model
│   │   ├── settings.py          # ScanFolder, PendingAction, AppSettings, IgnoredEpisode
│   │   ├── watcher_log.py       # WatcherLog model
│   │   └── library_log.py       # LibraryLog model
│   ├── routers/
│   │   ├── __init__.py          # Router instances with prefixes
│   │   ├── shows.py             # /api/shows — TV show CRUD, search, refresh, rename
│   │   ├── movies.py            # /api/movies — Movie CRUD, search, refresh
│   │   ├── scan.py              # /api/scan — Scanning, managed import, logs
│   │   ├── actions.py           # /api/actions — Pending action management
│   │   ├── settings.py          # /api — Settings, folders, dashboard data endpoints
│   │   └── watcher.py           # /api — Watcher controls, settings, log, issues
│   ├── services/
│   │   ├── tmdb.py              # TMDB API client (search, get show/movie, episodes)
│   │   ├── tvdb.py              # TVDB API client (search, get show, episodes)
│   │   ├── matcher.py           # TV filename parser (SxE patterns, fuzzy matching)
│   │   ├── movie_matcher.py     # Movie filename parser (title, year, edition)
│   │   ├── scanner.py           # TV library scanner (match files to episodes)
│   │   ├── movie_scanner.py     # Movie library scanner
│   │   ├── renamer.py           # TV episode file renamer
│   │   ├── movie_renamer.py     # Movie file renamer
│   │   ├── watcher.py           # Filesystem watcher service (inotify, stability)
│   │   ├── watcher_pipeline.py  # File processing pipeline (TV → movie → issues)
│   │   ├── quality.py           # ffprobe-based quality analysis and comparison
│   │   ├── pagination.py        # Alphabetical pagination (article stripping, pages)
│   │   └── file_utils.py        # Shared: sanitize_filename, companion files, patterns
│   └── static/
│       ├── index.html           # Single-page app shell
│       ├── style.css            # All styles with CSS custom property theming
│       ├── js/
│       │   ├── core.js          # Global search, navigation, API helpers, setup wizard
│       │   ├── shows.js         # Shows list, show detail, Add Show modal
│       │   ├── movies.js        # Movies list, movie detail, Add Movie modal
│       │   ├── dashboard.js     # Dashboard cards and stats
│       │   ├── scan.js          # Scan UI, library folder discovery
│       │   ├── settings.js      # Settings page
│       │   ├── watcher.js       # Watcher log and controls
│       │   └── issues.js        # Issues folder display
│       └── images/              # Static images (icons, placeholders)
├── data/
│   └── media-admin.db           # SQLite database (created on first run)
├── requirements.txt
└── README.md
```

## Backend Layers

```
HTTP Request
    │
    ▼
┌─────────┐     ┌──────────┐     ┌──────────┐     ┌──────────┐
│ Routers │ ──▶ │ Services │ ──▶ │  Models  │ ──▶ │ Database │
│ (API)   │     │ (Logic)  │     │  (ORM)   │     │ (SQLite) │
└─────────┘     └──────────┘     └──────────┘     └──────────┘
                     │
                     ▼
              ┌──────────────┐
              │ External APIs │
              │ (TMDB, TVDB)  │
              └──────────────┘
```

- **Routers** define API endpoints, validate requests, and return responses.
- **Services** contain business logic: scanning, matching, renaming, API calls, quality analysis.
- **Models** are SQLAlchemy ORM classes mapped to SQLite tables.
- **Database** is managed through a singleton engine with `get_db()` dependency injection.

## Frontend

The frontend is a single-page application with no build step:

- **`index.html`** loads all JS files and defines the page shell.
- **Hash routing** (`window.onhashchange`) switches between pages (`#shows`, `#movies`, `#scan`, `#settings`, `#watcher`).
- **`core.js`** provides the global search bar, navigation, API helper (`apiGet`, `apiPost`, etc.), and setup wizard.
- Each page module (`shows.js`, `movies.js`, etc.) registers an `init` function called when its hash is active.
- UI preferences (card order, hidden cards, view modes, expand states) are stored both in `localStorage` and synced to the database via `/api/ui-prefs`.

## Application Lifecycle

1. **Startup** (`main.py:lifespan`):
   - `init_database()` creates tables from model definitions.
   - `run_migrations()` adds any missing columns via `ALTER TABLE`.
   - `auto_start_watcher()` restarts the watcher if it was enabled before shutdown.

2. **Runtime**:
   - FastAPI serves the API and static files on port 8095.
   - The watcher service runs in background threads monitoring download folders.
   - Manual scans run as background tasks in FastAPI.

3. **Shutdown**:
   - The watcher service is stopped gracefully.

## Database Migrations

Migrations run automatically on startup in `run_migrations()`. They use SQLAlchemy's `inspect()` to check for missing columns and add them with `ALTER TABLE`. For more complex changes (like making a column nullable), the table is recreated. See [Database Schema](database.md) for details.
