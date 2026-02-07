# Media Admin

A Linux-native media library manager for TV shows and movies with a web UI. Manages metadata from TMDB and TVDB, tracks missing episodes, organizes and renames files, and monitors download folders for automatic processing. Written in Python with a FastAPI backend and vanilla JavaScript frontend.

## Features

### TV Show Management
- Search and add shows from **TMDB** and **TVDB** with automatic cross-referencing of TMDB, TVDB, and IMDB IDs
- Switch metadata source per show at any time (episodes re-imported and files rescanned)
- TVDB episode order selection — choose between aired, DVD, absolute, or alternate orderings
- Single-show and bulk metadata refresh with progress tracking
- Track show status, genres, networks, air dates, and episode counts
- Folder year correction — metadata refresh renames show folders when the year doesn't match (e.g. `Show (2021)` → `Show (2018)`)

### Movie Management
- Search and add movies from **TMDB** with automatic metadata
- Collection grouping (movies grouped by TMDB collection)
- Edition support (Director's Cut, Extended, etc.)
- Single-movie and bulk metadata refresh
- Genre and studio distribution tracking

### Episode & File Tracking
- Track episodes with season/episode numbers, titles, overviews, air dates, and runtime
- Detect missing, found, not-yet-aired, ignored, and special episodes
- Mark episodes as ignored (excluded from missing counts), with bulk ignore/unignore per show or season
- Per-show and library-wide missing episode reports
- Multi-episode file support (e.g., S01E01-E03)

### File Organization
- Scan library folders to match existing files to episodes/movies
- Customizable naming formats for season folders, episode files, and movie files
- Automatic renaming based on metadata (with companion file handling for subtitles, images, etc.)
- Preview rename operations before execution
- Show folder auto-discovery across library folders

### Download Monitoring (Watcher)
- Watch download folders for new video files with stability checking
- Automatic TV and movie matching using filename parsing
- Decision tree: parse as TV → match show/episode → import; else parse as movie → match/auto-import; else move to Issues
- Auto-import unmatched files from TMDB/TVDB when a confident match is found
- Auto-rename, copy to library, and update database
- Quality-based duplicate resolution using ffprobe (resolution, bitrate, codecs, audio channels)
- Issues folder for unmatched or duplicate files with configurable organization
- Safe file operations (copy to temp, rename to final, verify, clean up)
- Move accompanying files (subtitles, metadata sidecar files)

### Managed Import
- Bulk-import shows by scanning a library folder of show folders
- Auto-match folder names to TMDB/TVDB metadata with title similarity + year scoring
- Secondary provider fallback — if a show has unmatched files with the default provider, automatically tries the other provider and switches if it produces a clean match
- Progress tracking with per-show results and live console log

### Dashboard
- 9 stat cards: Total Shows, Episodes Found, Episodes Missing, Ignored, Pending Actions, Collection Progress, Total Movies, Movies Found, Movies Missing
- 15 content cards: Recently Aired, Upcoming, Recently Added Shows, Recently Ended, Most Incomplete, Recently Matched Episodes, Returning Soon, Last Scan, Storage Stats, Genre Distribution, Network Distribution, Extra Files on Disk, Recently Added Movies, Recently Matched Movies
- Drag-and-drop card reordering with persistent layout
- Hide/restore cards, expand/collapse all, reset to defaults
- Lazy-loading — only visible cards fetch data

### Search
- Global search across library and providers (TMDB/TVDB)
- Numeric ID lookup — type a TMDB or TVDB ID (4+ digits) to fetch directly
- Year extraction from queries (e.g. "Black 2017" filters by year)
- Add Show modal supports both text and ID search with source selection

### UI
- Three view modes for shows and movies: cards, compact tiles, and expandable list
- Library-style alphabetical pagination with article-stripped sorting
- Show detail view with season/episode accordion and episode preview images
- Configurable themes (Midnight, Light, Sunset)

### Logs & Filtering
- **Watcher Log** — file detection events with 8 tag filters (Detected, Matched, Library, Issues, Error, Imported, Started, Stopped)
- **Library Log** — rename/import history with 4 tag filters (Rename, Import, Rename Failed, Import Failed)
- All logs support text search, date range filtering, and year-based grouping
- Tag filters use OR logic, combined with AND for search and date range

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
4. Optionally add a movie library folder
5. Optionally add download folders to monitor for new files
6. Optionally configure the watcher for automatic download processing

## API Documentation

Once running, interactive API documentation is available at:
- Swagger UI: http://localhost:8095/docs
- ReDoc: http://localhost:8095/redoc

## Configuration

Settings are stored in the SQLite database (`data/media-admin.db`) and managed through the web UI Settings page across five tabs: General, Dashboard, Library, Folders, and Watcher.

### Naming Formats

Episode format variables:
- `{season}` - Season number
- `{episode}` - Episode number (use `{episode:02d}` for zero-padded)
- `{title}` - Episode title

Season folder variables:
- `{season}` - Season number

Movie format variables:
- `{title}` - Movie title
- `{year}` - Release year

Default formats:
- Episode: `{season}x{episode:02d} - {title}`
- Season folder: `Season {season}`
- Movie: `{title} ({year})`

## Project Structure

```
media-admin/
├── src/
│   ├── main.py              # FastAPI application entry point
│   ├── config.py            # Configuration
│   ├── database.py          # SQLite database setup
│   ├── models/              # SQLAlchemy models (Show, Episode, Movie, etc.)
│   ├── services/            # Business logic
│   │   ├── tmdb.py          # TMDB API client
│   │   ├── tvdb.py          # TVDB API client
│   │   ├── scanner.py       # Library and download folder scanner
│   │   ├── movie_scanner.py # Movie library scanner
│   │   ├── renamer.py       # TV episode file renamer
│   │   ├── movie_renamer.py # Movie file renamer
│   │   ├── matcher.py       # TV filename parser
│   │   ├── movie_matcher.py # Movie filename parser
│   │   ├── watcher.py       # Filesystem watcher (inotify)
│   │   ├── watcher_pipeline.py # File processing pipeline
│   │   └── quality.py       # Quality comparison logic
│   ├── routers/             # API endpoints
│   │   ├── shows.py         # TV show CRUD, search, refresh, rename
│   │   ├── movies.py        # Movie CRUD, search, refresh
│   │   ├── scan.py          # Scanning, managed import, logs
│   │   ├── actions.py       # Pending action management
│   │   ├── settings.py      # App settings
│   │   └── watcher.py       # Watcher controls
│   └── static/              # Web UI (HTML, CSS, JavaScript)
├── data/
│   └── media-admin.db       # SQLite database (created on first run)
├── requirements.txt
└── README.md
```

## License

MIT
