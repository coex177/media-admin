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

## Project Structure

```
src/
  main.py              - FastAPI app entry point
  config.py            - Settings/configuration
  models.py            - SQLAlchemy models
  database.py          - DB session management
  routers/
    shows.py           - TV show CRUD, search, preview, lookup endpoints
    movies.py          - Movie CRUD, search, preview, lookup endpoints
    scan.py            - Scanning, library folder discovery, import operations
    actions.py         - Pending action management (rename/import)
    settings.py        - App settings endpoints
    watcher.py         - File watcher control endpoints
  services/
    tmdb.py            - TMDB API client (search, get show/movie, episodes)
    tvdb.py            - TVDB API client (search, get show, episodes)
    matcher.py         - TV filename parser (SxE patterns, title extraction)
    movie_matcher.py   - Movie filename parser (title, year, quality)
    scanner.py         - Library and download folder scanner
    watcher.py         - Filesystem watcher (inotify)
    watcher_pipeline.py - File processing pipeline (TV and movie matching)
    renamer.py         - TV episode file renamer
    movie_renamer.py   - Movie file renamer
    movie_scanner.py   - Movie library scanner
    quality.py         - Quality comparison logic
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
```

---

## File Processing Pipeline (watcher_pipeline.py)

**Decision tree for new files in download folders:**
1. Parse filename with TV matcher (looks for SxE patterns: S01E01, 1x03, etc.)
2. If TV pattern found → match to show in DB → match episode → import
3. If no TV pattern → parse with movie matcher (title + year extraction)
4. If movie parsed → match to movie in DB or auto-import from TMDB
5. If nothing matches → move to Issues folder

**Important:** The 3-digit fallback TV pattern (`101` = S1E01) can cause false positives. Codec patterns like `H.265`, `x.264` are filtered out via `CODEC_FALSE_POSITIVE` in `matcher.py`.

---

## Recent Changes

### Session: Feb 7, 2026

#### 1. Secondary metadata provider fallback for Managed Import
- During `run_library_folder_discovery()` in `scan.py`, if a newly added show has extra (unmatched) files with the default provider, the system now automatically tries the secondary provider.
- Added `_count_file_matches()` helper that counts file-to-episode matches against an episode list without touching the DB — used to evaluate the secondary provider cheaply.
- TMDB → TVDB fallback: requires TVDB service configured and `tvdb_id` available from TMDB external IDs.
- TVDB → TMDB fallback: searches TMDB by show name and uses the top result.
- If the secondary provider produces `extra <= 0` (all files match; `<0` accounts for multi-episode files counting multiple matches per file), the show's episodes are deleted and recreated from the secondary provider, metadata is updated, and `metadata_source` is switched.
- If both providers have extras, the default provider is kept unchanged.
- Wrapped in try/except so API failures don't break the import.

#### 2. Fix Managed Import false "Already in library" matches
- **Bug:** The TMDB results scoring loop in `run_library_folder_discovery()` checked every search result against existing shows and broke on the first match. If TMDB returned an existing show (e.g. "Borgen - Power & Glory") before the correct match (e.g. "Borgen") for a folder, the wrong show would steal the match, logging "Already in library" and skipping the folder entirely.
- **Fix:** Existing shows in search results are now skipped (`continue`) during scoring instead of breaking the loop. The existing-show check after the best match is selected (by score) still correctly handles the case where the best-scoring result is already in the library.

#### 3. Rename show folder on metadata refresh when year is wrong
- Added `_rename_show_folder_if_year_wrong()` in `shows.py`, called during `refresh_show()`.
- Compares the year in the folder name (e.g. `Into the Dark (2021)`) against `first_air_date` from metadata (e.g. `2018`).
- If they differ, renames the folder on disk, updates `show.folder_path`, and updates all episode `file_path` references.
- Runs before episode file renaming so paths stay consistent.
- Safely skips if: no year in folder name, destination already exists, or folder doesn't exist.

### Session: Feb 6, 2026

#### 1. Search and tag filters for logs (commit `7534b40`)
- **Watcher Log:** Added text search input and 8 toggleable tag filter buttons (Detected, Matched, Library, Issues, Error, Imported, Started, Stopped). Tags use OR logic, combined with AND for search and date range. All client-side filtering.
- **Library Log:** Same pattern with 4 tag types (Rename, Import, Rename Failed, Import Failed).
- **Issues tab:** Added text search input to filter by filename.
- Clear Filters button resets all filters (tags, search, and date range).

#### 2. Unified rounded corner styling (commit `f9dbd62`)
- Added `.wlog-year-group` wrapper with `border-radius: 8px` to Watcher Log, Library Log, and Issues tabs for consistent rounded year group headers.
- Added `border-radius: 8px` to Settings > Folders tables (`.folders-table`).
- Wrapped Ignored tab content in `<div class="card">` for consistent card background.

#### 3. Bulk delete on Ignored tab + layout fixes (commit `9079f19`)
- Added bulk delete buttons on Ignored tab show headers and season headers (trash icon).
- Added `DELETE /api/scan/ignore-episodes` bulk endpoint with `BulkUnignoreRequest` model.
- Fixed goto arrow positioning: rightmost on Ignored tab show headers, using `.wlog-header-actions` span.
- Fixed Missing Episodes season header width: wrapped content in `<div>` inside `<td colspan="5">` to prevent `display: flex` from breaking colspan.

### Session: Feb 4, 2026

#### 1. Year-based search filtering (commit `24cbdc9`)
- Global search extracts year from queries (e.g., "Black 2017") and passes to TMDB API
- Added `year` parameter to `/shows/search/tmdb` endpoint
- Improved library folder discovery scoring: title similarity + year bonus/penalty
- Minimum match score of 0.5 required to avoid false positives

#### 2. TMDB ID lookup in global search (commit `b387293`)
- Typing a numeric ID (4+ digits) in the global search box fetches show/movie directly by TMDB ID
- Added `/shows/lookup/tmdb/{id}` endpoint
- Added `/movies/lookup/tmdb/{id}` endpoint
- Solves issue where shows with common/non-English names (e.g., Korean drama "Black" TMDB:73944) couldn't be found via text search

#### 3. TMDB/TVDB ID lookup in Add Show modal (commit `54e1eaa`)
- Add Show modal search box now supports numeric ID search
- Added `/shows/lookup/tvdb/{id}` endpoint
- Updated placeholder text and added tip explaining ID search
- Works with both TMDB and TVDB source selection

#### 4. Fix H.265/x.264 codec false positive (commit `5af6ca3`)
- `H.265` in filenames (dot-separated) was being parsed as Season 2 Episode 65
- Root cause: `CODEC_FALSE_POSITIVE` pattern only matched `H265` (no dot), not `H.265`
- Fix: Updated pattern from `[xXhH](\d{3})` to `[xXhH]\.?(\d{3})`
- Movie files like `The.Thing.1982.1080p.AMZN.WEB-DL.DDP2.0.SDR.H.265-GRiMM.mkv` now correctly fall through to movie pipeline

---

## Known Issues / Areas for Future Work

- **Download folder scanner (`scanner.py:_scan_download_folders`) only handles TV shows.** It does not attempt movie matching for unmatched files. The watcher pipeline (`watcher_pipeline.py:process_file`) does handle both TV and movies correctly. If a movie is placed in a TV download folder and the watcher isn't running, the scanner won't detect it as a movie.
- The Korean drama "Black" (TMDB:73944) is difficult to find via text search because the title is too generic and results are dominated by shows with "Black" in longer titles. The ID lookup feature was added to work around this.
- `media_admin.db` should remain untracked in git (it's the live SQLite database).
