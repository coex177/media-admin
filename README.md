# Media Admin

A Linux-native media library manager for TV shows and movies with a web UI. Manages metadata from TMDB and TVDB, tracks missing episodes, organizes and renames files, and monitors download folders for automatic processing.

Built with Python (FastAPI) and vanilla JavaScript.

## Features

- **TV show management** — search and add from TMDB/TVDB, track episodes, switch providers, multiple episode orderings
- **Movie management** — TMDB search, collections, editions, file tracking
- **File organization** — customizable naming formats, rename preview and approval, companion file handling
- **Library scanning** — match files to episodes/movies, detect missing content, Managed Import for bulk setup
- **Download monitoring** — watch folders for new files, auto-import with TV and movie matching, quality-based duplicate resolution via ffprobe
- **Dashboard** — 7 stat cards and 18 content cards with drag-and-drop customization
- **Search** — global search, year filtering, direct TMDB/TVDB ID lookup
- **Logs** — watcher and library logs with tag filters, text search, and date ranges

For full documentation, see the **[docs/](docs/)** directory.

## Requirements

- Python 3.10+
- TMDB API key (free from [themoviedb.org](https://www.themoviedb.org/settings/api))
- TVDB API key (optional, from [thetvdb.com](https://thetvdb.com/api-information))
- ffprobe (optional, for quality-based duplicate resolution — part of the ffmpeg package)

## Installation

```bash
git clone https://github.com/coex177/media-admin.git
cd media-admin
python -m venv venv
source venv/bin/activate
pip install -r requirements.txt
```

## Running

```bash
# Development mode with auto-reload
uvicorn src.main:app --reload --port 8095

# Or run directly
python -m src.main
```

Access the web UI at http://localhost:8095

### Production (systemd)

Create `/etc/systemd/system/media-admin.service`:

```ini
[Unit]
Description=Media Admin
After=network.target

[Service]
Type=simple
User=your-user
WorkingDirectory=/path/to/media-admin
ExecStart=/path/to/media-admin/venv/bin/uvicorn src.main:app --host 0.0.0.0 --port 8095
Restart=always

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable media-admin
sudo systemctl start media-admin
```

## First-Time Setup

1. Open http://localhost:8095
2. Enter your TMDB API key in Settings
3. Add at least one library folder (where your TV shows are stored)
4. Optionally add movie library folders, download folders, and configure the watcher

## Documentation

Full documentation is in the **[docs/](docs/)** directory:

- [Architecture](docs/architecture.md) — tech stack and project structure
- [TV Shows](docs/shows.md) — show management features
- [Movies](docs/movies.md) — movie management features
- [File Organization](docs/file-organization.md) — naming formats and renaming
- [Scanning & Import](docs/scanning.md) — library scanning and Managed Import
- [Download Monitoring](docs/watcher.md) — watcher service and auto-import
- [Filename Parsing](docs/filename-parsing.md) — pattern matching details
- [Dashboard](docs/dashboard.md) — dashboard cards and customization
- [Configuration](docs/settings.md) — all settings with defaults
- [API Reference](docs/api.md) — endpoint listing
- [Database Schema](docs/database.md) — models and relationships

Interactive API docs are also available at `/docs` (Swagger) and `/redoc` when the server is running.

## License

MIT
