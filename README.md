# Media Admin

A Linux-native TV show organization tool with a web UI. Manages metadata, tracks missing episodes, organizes files, and monitors download folders for automatic processing. Written in Python with a FastAPI backend and vanilla JavaScript frontend.

## Features

### Metadata & Library Management
- Search and add shows from **TMDB** and **TVDB** with automatic cross-referencing
- Intelligent source selection — compares episode counts and picks the more complete provider
- Switch metadata source per show at any time (episodes re-imported and files rescanned)
- TVDB episode order selection — choose between aired, DVD, absolute, or alternate orderings
- Bulk metadata refresh for all shows with progress tracking
- Track show status, genres, networks, air dates, and episode counts
- Cross-reference TMDB, TVDB, and IMDB IDs automatically

### Episode Tracking
- Track episodes with season/episode numbers, titles, overviews, air dates, and runtime
- Detect missing, found, not-yet-aired, ignored, and special episodes
- Mark episodes as ignored or special (excluded from missing counts)
- Per-show and library-wide missing episode reports

### File Organization
- Scan library folders to match existing files to episodes
- Customizable naming formats for season folders and episode files
- Automatic renaming based on metadata (with companion file handling for subtitles, images, etc.)
- Preview and approve rename/move operations before execution
- Multi-episode file support (e.g., S01E01-E03)

### Download Monitoring (Watcher)
- Watch download folders for new video files with stability checking
- Automatic show/episode matching using filename parsing
- Auto-rename, copy to library, and update database
- Quality-based duplicate resolution using ffprobe (resolution, bitrate, codecs, audio channels)
- Issues folder for unmatched or duplicate files with configurable organization
- Activity logging with full history

### Managed Import
- Bulk-import shows by scanning a folder of show folders
- Auto-match folder names to TMDB/TVDB metadata
- Progress tracking with per-show results

### Dashboard
- Drag-and-drop card layout with collapsible sections
- Cards: Recently Aired, Upcoming, Recently Added, Recently Ended, Most Incomplete, Recently Matched, Returning Soon, Last Scan, Storage Stats, Genre Distribution, Network Distribution, Extra Files on Disk
- Persistent card ordering and collapse state

### UI
- Three view modes for the show library: cards, compact tiles, and expandable list
- Library-style alphabetical pagination (article-stripped sorting)
- Show detail view with season/episode accordion and episode preview images
- Responsive web interface with configurable theme

## Requirements

- Python 3.10+
- TMDB API key (free from [themoviedb.org](https://www.themoviedb.org/settings/api))
- TVDB API key (optional, from [thetvdb.com](https://thetvdb.com/api-information))
- ffprobe (optional, for quality-based duplicate resolution — part of the ffmpeg package)

## Installation

### Development Setup

```bash
git clone https://github.com/coex177/media-admin.git
cd media-admin
python -m venv venv
source venv/bin/activate
pip install -r requirements.txt
```

### Running the Server

```bash
# Development mode with auto-reload
uvicorn src.main:app --reload --port 8095

# Or run directly
python -m src.main
```

Access the web UI at http://localhost:8095

### Production Deployment (systemd)

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

Then:

```bash
sudo systemctl daemon-reload
sudo systemctl enable media-admin
sudo systemctl start media-admin
```

## First-Time Setup

1. Open http://localhost:8095
2. Go to Settings and enter your TMDB API key (and optionally TVDB API key)
3. Add at least one library folder (where your TV shows are stored)
4. Optionally add download folders to monitor for new files
5. Optionally configure the watcher for automatic download processing

## API Documentation

Once running, interactive API documentation is available at:
- Swagger UI: http://localhost:8095/docs
- ReDoc: http://localhost:8095/redoc

## Configuration

Settings are stored in the SQLite database (`data/media-admin.db`) and managed through the web UI Settings page.

### Naming Formats

Episode format variables:
- `{season}` - Season number
- `{episode}` - Episode number (use `{episode:02d}` for zero-padded)
- `{title}` - Episode title

Season folder variables:
- `{season}` - Season number

Default formats:
- Episode: `{season}x{episode:02d} - {title}`
- Season folder: `Season {season}`

## Project Structure

```
media-admin/
├── src/
│   ├── main.py              # FastAPI application entry point
│   ├── config.py            # Configuration
│   ├── database.py          # SQLite database setup
│   ├── models/              # SQLAlchemy models (Show, Episode, etc.)
│   ├── services/            # Business logic (TMDB, TVDB, scanner, renamer, watcher)
│   ├── routers/             # API endpoints (shows, scan, actions, settings, watcher)
│   └── static/              # Web UI (HTML, CSS, JavaScript)
├── data/
│   └── media-admin.db       # SQLite database (created on first run)
├── requirements.txt
└── README.md
```

## License

MIT
