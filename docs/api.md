# API Reference

Media Admin exposes a REST API on port 8095. Interactive documentation is available at:

- **Swagger UI**: [http://localhost:8095/docs](http://localhost:8095/docs)
- **ReDoc**: [http://localhost:8095/redoc](http://localhost:8095/redoc)

## Routers

| Router | Prefix | Description |
|--------|--------|-------------|
| Shows | `/api/shows` | TV show CRUD, search, metadata, rename |
| Movies | `/api/movies` | Movie CRUD, search, metadata |
| Scan | `/api/scan` | Scanning, managed import, logs, ignored episodes |
| Actions | `/api/actions` | Pending action management |
| Settings | `/api` | App settings, folders, dashboard data |
| Watcher | `/api` | Watcher controls, settings, log, issues |

## Shows (`/api/shows`)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/shows` | List all shows with pagination |
| GET | `/api/shows/{show_id}` | Get show by ID with episodes and extra files |
| POST | `/api/shows` | Add a new show from TMDB or TVDB |
| PUT | `/api/shows/{show_id}` | Update show settings |
| DELETE | `/api/shows/{show_id}` | Delete a show |
| POST | `/api/shows/{show_id}/refresh` | Refresh metadata from configured source |
| POST | `/api/shows/{show_id}/switch-source` | Switch between TMDB and TVDB |
| POST | `/api/shows/{show_id}/switch-season-type` | Change TVDB episode ordering |
| GET | `/api/shows/{show_id}/missing` | Get missing episodes |
| GET | `/api/shows/search/tmdb` | Search TMDB for shows |
| GET | `/api/shows/search/tvdb` | Search TVDB for shows |
| GET | `/api/shows/lookup/tmdb/{tmdb_id}` | Look up show by TMDB ID |
| GET | `/api/shows/lookup/tvdb/{tvdb_id}` | Look up show by TVDB ID |
| GET | `/api/shows/tvdb/{tvdb_id}/season-types` | Get TVDB season types |
| GET | `/api/shows/preview/{source}/{provider_id}` | Preview show data without adding |
| POST | `/api/shows/refresh-all` | Refresh all shows (background) |
| GET | `/api/shows/refresh-all/status` | Get bulk refresh progress |
| POST | `/api/shows/{show_id}/fix-match/preview` | Preview fix-match operations |
| POST | `/api/shows/{show_id}/fix-match` | Execute fix-match file transfer |

## Movies (`/api/movies`)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/movies` | List all movies with pagination |
| GET | `/api/movies/{movie_id}` | Get movie by ID |
| POST | `/api/movies` | Add a new movie from TMDB |
| PUT | `/api/movies/{movie_id}` | Update movie settings |
| DELETE | `/api/movies/{movie_id}` | Delete a movie |
| POST | `/api/movies/{movie_id}/refresh` | Refresh metadata from TMDB |
| POST | `/api/movies/refresh-all` | Refresh all movies (background) |
| GET | `/api/movies/refresh-all/status` | Get bulk refresh progress |
| GET | `/api/movies/search/tmdb` | Search TMDB for movies |
| GET | `/api/movies/lookup/tmdb/{tmdb_id}` | Look up movie by TMDB ID |
| GET | `/api/movies/preview/{tmdb_id}` | Preview movie data without adding |
| GET | `/api/movies/stats` | Get movie statistics |
| GET | `/api/movies/recently-added` | Recently added movies |
| GET | `/api/movies/recently-released` | Movies by release date |
| GET | `/api/movies/top-rated` | Highest-rated movies |
| GET | `/api/movies/lowest-rated` | Lowest-rated movies |
| GET | `/api/movies/genre-distribution` | Genre breakdown |
| GET | `/api/movies/studio-distribution` | Studio breakdown |
| GET | `/api/movies/collections` | Movies grouped by collection |

## Scan (`/api/scan`)

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/scan/scan` | Run library scan (background) |
| GET | `/api/scan/scan/status` | Get scan progress |
| GET | `/api/scan/scan/results` | Get last scan results |
| GET | `/api/scan/scan/downloads` | Get download folder matches |
| POST | `/api/scan/run-discovery` | Run Managed Import (background) |
| GET | `/api/scan/discovery/status` | Get Managed Import progress |
| POST | `/api/scan/folder/{folder_id}` | Scan a specific folder |
| GET | `/api/scan/log` | Get library log entries |
| DELETE | `/api/scan/log` | Clear all library log entries |
| DELETE | `/api/scan/log/{entry_id}` | Delete a single log entry |
| GET | `/api/scan/ignore-episodes` | Get ignored episodes |
| POST | `/api/scan/ignore-episodes` | Ignore episodes |
| DELETE | `/api/scan/ignore-episodes` | Bulk unignore episodes |
| DELETE | `/api/scan/ignore-episodes/{episode_id}` | Unignore single episode |

## Actions (`/api/actions`)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/actions` | List pending actions (filterable by status) |
| GET | `/api/actions/{action_id}` | Get a specific action |
| POST | `/api/actions/{action_id}/approve` | Approve and execute an action |
| POST | `/api/actions/approve-all` | Approve and execute all pending |
| POST | `/api/actions/{action_id}/reject` | Reject an action |
| DELETE | `/api/actions/{action_id}` | Delete an action |

## Settings (`/api`)

### Configuration

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/settings` | Get all settings |
| PUT | `/api/settings` | Update settings |
| GET | `/api/ui-prefs` | Get UI preferences |
| PUT | `/api/ui-prefs` | Merge UI preferences |
| GET | `/api/folders` | List scan folders |
| POST | `/api/folders` | Add a scan folder |
| DELETE | `/api/folders/{folder_id}` | Remove a scan folder |
| PUT | `/api/folders/{folder_id}/toggle` | Toggle folder enabled status |

### Dashboard Data

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/stats` | Library statistics |
| GET | `/api/recently-aired` | Recently aired episodes |
| GET | `/api/upcoming` | Upcoming episodes |
| GET | `/api/recently-added` | Recently added shows |
| GET | `/api/recently-ended` | Recently ended shows |
| GET | `/api/most-incomplete` | Most incomplete shows |
| GET | `/api/recently-matched` | Recently matched episodes |
| GET | `/api/returning-soon` | Shows returning soon |
| GET | `/api/genre-distribution` | Show genre distribution |
| GET | `/api/network-distribution` | Show network distribution |
| GET | `/api/extra-files` | Shows with extra files |
| GET | `/api/last-scan` | Last scan information |
| GET | `/api/storage-stats` | Storage statistics |

## Watcher (`/api`)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/watcher/status` | Watcher status and prerequisites |
| POST | `/api/watcher/start` | Start the watcher |
| POST | `/api/watcher/stop` | Stop the watcher |
| POST | `/api/watcher/validate-prerequisites` | Check watcher prerequisites |
| GET | `/api/watcher/settings` | Get watcher settings |
| PUT | `/api/watcher/settings` | Update watcher settings |
| GET | `/api/watcher/log` | Get watcher log entries |
| DELETE | `/api/watcher/log` | Clear all watcher log entries |
| DELETE | `/api/watcher/log/range/{start}/{end}` | Delete log entries in time range |
| DELETE | `/api/watcher/log/{entry_id}` | Delete single log entry |
| GET | `/api/watcher/issues` | List files in Issues folder |
| DELETE | `/api/watcher/issues` | Delete a specific Issues file |
| DELETE | `/api/watcher/issues/all` | Delete all Issues files |

## Utility Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/` | Serve the web UI |
| GET | `/health` | Health check |
