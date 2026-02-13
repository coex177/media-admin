# Media Admin - Project Context

## Server Documentation
At the start of each session, read the documentation files in `/home/coex/docs/` to understand the server configuration and setup.

## Key Paths
- Home directory: `/home/coex`
- Documentation: `/home/coex/docs/`
- Scripts: `/home/coex/scripts/`
- Project root: `/home/coex/media-admin`

## Server Context
This is Coex's home server running Ubuntu. Key services include:
- ZFS storage pools
- Plex Media Server
- Docker containers
- Cloudflare tunnels
- KVM/libvirt virtual machines

When working on this system, always check the docs directory first for relevant configuration details.

---

## Application Overview

Media Admin is a FastAPI + vanilla JS web app for managing TV shows and movies. It integrates with TMDB and TVDB APIs for metadata, scans local library and download folders, and manages file renaming/importing.

**Full documentation:** See `docs/` directory in the project root for comprehensive documentation:
- [Architecture](../docs/architecture.md) — tech stack, project structure, backend/frontend layers
- [TV Shows](../docs/shows.md) — show management, metadata refresh, source switching
- [Movies](../docs/movies.md) — movie management, collections, editions
- [File Organization](../docs/file-organization.md) — naming formats, renaming workflow, companion files
- [Scanning & Import](../docs/scanning.md) — library scanning, Managed Import, pending actions
- [Download Monitoring](../docs/watcher.md) — watcher pipeline, quality comparison, Issues folder
- [Filename Parsing](../docs/filename-parsing.md) — TV/movie patterns, matching algorithms
- [Dashboard](../docs/dashboard.md) — stat cards, content cards, customization
- [Configuration](../docs/settings.md) — all settings with defaults, environment variables
- [API Reference](../docs/api.md) — all 92 endpoints across 6 routers
- [Database Schema](../docs/database.md) — all 9 models, relationships, migrations

### Running the Service
- **Systemd service:** `media-admin.service` (enabled, starts on boot)
- Start: `systemctl start media-admin`
- Stop: `systemctl stop media-admin`
- Restart: `systemctl restart media-admin`
- Status: `systemctl status media-admin`
- Logs: `journalctl -u media-admin -f`
- Venv: `/home/coex/media-admin/venv`
- Port: 8095
- After code changes, restart the service: `systemctl restart media-admin`

### Git / GitHub
- Repo: `github.com/coex177/media-admin` (private)
- Branch: `main`
- `media_admin.db` is untracked (SQLite database, not code)

---

## Project Structure (Quick Reference)

```
src/
  main.py              - FastAPI app entry point
  config.py            - Settings/configuration
  database.py          - DB session management
  models/              - SQLAlchemy models (Show, Episode, Movie, ScanFolder, PendingAction, AppSettings, IgnoredEpisode, WatcherLog, LibraryLog)
  routers/
    shows.py           - TV show CRUD, search, preview, lookup endpoints
    movies.py          - Movie CRUD, search, preview, lookup endpoints
    scan.py            - Scanning, library folder discovery, import operations
    actions.py         - Pending action management (rename/import)
    settings.py        - App settings + dashboard data endpoints
    watcher.py         - File watcher control endpoints
  services/
    tmdb.py            - TMDB API client
    tvdb.py            - TVDB API client
    matcher.py         - TV filename parser (SxE patterns, title extraction)
    movie_matcher.py   - Movie filename parser (title, year, quality, edition)
    scanner.py         - Library and download folder scanner
    movie_scanner.py   - Movie library scanner
    renamer.py         - TV episode file renamer
    movie_renamer.py   - Movie file renamer
    watcher.py         - Filesystem watcher (inotify)
    watcher_pipeline.py - File processing pipeline (TV and movie matching)
    quality.py         - ffprobe quality comparison logic
    pagination.py      - Shared alphabetical pagination helpers
    file_utils.py      - Shared filename sanitization, companion file moves, patterns
  static/
    js/
      core.js          - Global search, navigation, API helper, setup wizard
      shows.js         - Shows list, show detail, Add Show modal, episode management
      movies.js        - Movies list, movie detail, Add Movie modal
      dashboard.js     - Dashboard cards and stats
      scan.js          - Scan UI, library folder discovery
      settings.js      - Settings page
      watcher.js       - Watcher log/controls
      issues.js        - Issues folder display
docs/                  - Full project documentation (see links above)
```

---

## Key Implementation Notes

- **Watcher pipeline decision tree:** TV parse → show match → episode import; else movie parse → movie match → import; else Issues folder. See `docs/watcher.md` for full details.
- **3-digit fallback TV pattern** (`101` = S1E01) can cause false positives. Codec patterns like `H.265`, `x.264` are filtered out via `CODEC_FALSE_POSITIVE` in `matcher.py`.
- **Cross-module imports** (scanner↔shows, watcher↔scan) MUST stay inline to avoid circular dependencies. Standard library and model imports can safely be at module top level.
- **Shared utilities:** `services/pagination.py` (alphabetical pagination) and `services/file_utils.py` (sanitize_filename, move_accompanying_files, patterns) are shared across multiple modules.
- **Movie renamer** uses `sanitize_filename(name, replace_colon=True)`, TV renamer uses default (no colon replace).
- **`_scan_show_folder()`** counts per-episode matches (multi-ep files count multiple), not per-file. So `extra = total_files - matched` can be negative. Use `> 0` or `<= 0` checks, never `== 0`.
- **`existing_shows` dict** uses `tmdb_id` as key — shows with `tmdb_id = None` all collapse to key `None`.
- **Managed Import scoring loop:** existing shows in search results should be skipped during scoring, not used to break the loop early.

---

## Recent Changes

### Session: Feb 10, 2026

#### 3. Strip AKA alternate titles from filename parsing (commit `4142c75`)
- Both TV (`matcher.py`) and movie (`movie_matcher.py`) parsers now strip "A.K.A."/"AKA" and everything after it from extracted titles
- Pattern: `\s*\bA\s*K\s*A\b.*$` — handles dotted and plain forms
- Example: `The.Secret.Agent.A.K.A.O.Agente.Secreto.2025...` → title `"The Secret Agent"`, year `2025`

#### 2. Fix show matching word boundary logic (commit `f2ecf45`)
- Substring matching in `match_show_name()` now requires word boundaries (`\b` regex anchors)
- Prevents e.g. "Cross" matching "Crossbones" — both previously scored 0.9

#### 1. Fix missing `_move_accompanying_files` method (commit `92fd585`)
- Restored `_move_accompanying_files()` on `RenamerService` — removed during code cleanup in `7aafff3`
- Bug: `shutil.move` succeeded (file moved on disk) but `AttributeError` on the next line skipped the DB path update, causing all renamed files to appear as "Extra Files"

### Session: Feb 7, 2026

#### 5. Add comprehensive /docs documentation (commit `1f3ff78`)
- Simplified README to concise overview with links to docs/
- Created 12-page wiki-style documentation in docs/ covering all features, architecture, settings, API, and database schema

#### 4. Code review: consolidate duplicates, remove dead code, clean up imports (commit `7aafff3`)
- New shared modules: `services/pagination.py`, `services/file_utils.py`
- Dead code removed from quality.py, core.js, actions.py, dashboard.js, shows.py, watcher_pipeline.py
- Inline imports moved to top level in shows.py, scan.py, tmdb.py
- Net result: -249 lines across 16 files

#### 3. Rename show folder on metadata refresh when year is wrong
- `_rename_show_folder_if_year_wrong()` in shows.py compares folder year to metadata year and renames if different

#### 2. Fix Managed Import false "Already in library" matches
- Existing shows in search results now skipped during scoring instead of breaking the loop

#### 1. Secondary metadata provider fallback for Managed Import
- If a show has unmatched files with default provider, automatically tries secondary provider and switches if better

### Session: Feb 6, 2026

- Search and tag filters for watcher/library logs (commit `7534b40`)
- Unified rounded corner styling (commit `f9dbd62`)
- Bulk delete on Ignored tab + layout fixes (commit `9079f19`)

### Session: Feb 4, 2026

- Year-based search filtering (commit `24cbdc9`)
- TMDB ID lookup in global search (commit `b387293`)
- TMDB/TVDB ID lookup in Add Show modal (commit `54e1eaa`)
- Fix H.265/x.264 codec false positive (commit `5af6ca3`)

---

## Known Issues / Areas for Future Work

- **Download folder scanner (`scanner.py:_scan_download_folders`) only handles TV shows.** The watcher pipeline handles both TV and movies. If a movie is placed in a TV download folder and the watcher isn't running, the scanner won't detect it as a movie.
- The Korean drama "Black" (TMDB:73944) is difficult to find via text search — use ID lookup instead.
- `media_admin.db` should remain untracked in git (it's the live SQLite database).
