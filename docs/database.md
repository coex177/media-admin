# Database Schema

Media Admin uses SQLite with SQLAlchemy ORM. The database is stored at `data/media-admin.db` and created automatically on first run.

## Models

### Show

TV series metadata and configuration.

**Table:** `shows`

| Column | Type | Nullable | Default | Description |
|--------|------|----------|---------|-------------|
| `id` | INTEGER | No | Auto | Primary key |
| `tmdb_id` | INTEGER | Yes | - | TMDB show ID (unique) |
| `tvdb_id` | INTEGER | Yes | - | TVDB show ID |
| `imdb_id` | VARCHAR(20) | Yes | - | IMDB ID (e.g., tt1234567) |
| `metadata_source` | VARCHAR(10) | No | `"tmdb"` | Active provider: `tmdb` or `tvdb` |
| `tvdb_season_type` | VARCHAR(20) | Yes | `"official"` | TVDB episode ordering type |
| `name` | VARCHAR(255) | No | - | Show name |
| `overview` | TEXT | Yes | - | Show description |
| `poster_path` | VARCHAR(255) | Yes | - | TMDB poster image path |
| `backdrop_path` | VARCHAR(255) | Yes | - | TMDB backdrop image path |
| `folder_path` | VARCHAR(1024) | Yes | - | Absolute path to show folder on disk |
| `season_format` | VARCHAR(255) | No | `"Season {season}"` | Season folder naming template |
| `episode_format` | VARCHAR(255) | No | `"{season}x{episode:02d} - {title}"` | Episode file naming template |
| `do_rename` | BOOLEAN | No | `true` | Enable automatic file renaming |
| `do_missing` | BOOLEAN | No | `true` | Include in missing episode reports |
| `status` | VARCHAR(50) | No | `"Unknown"` | Show status (Returning Series, Ended, Canceled, etc.) |
| `first_air_date` | VARCHAR(10) | Yes | - | First air date (YYYY-MM-DD) |
| `number_of_seasons` | INTEGER | No | `0` | Total season count |
| `number_of_episodes` | INTEGER | No | `0` | Total episode count |
| `genres` | TEXT | Yes | - | JSON array of genre names |
| `networks` | TEXT | Yes | - | JSON array of network names |
| `aliases` | TEXT | Yes | - | JSON array of alternative names |
| `next_episode_air_date` | VARCHAR(10) | Yes | - | Next episode air date (YYYY-MM-DD) |
| `created_at` | DATETIME | No | Now | Record creation time |
| `last_updated` | DATETIME | No | Now | Last update time (auto-updated) |

**Relationships:** Has many Episodes (cascade delete).

---

### Episode

Individual TV episodes.

**Table:** `episodes`

| Column | Type | Nullable | Default | Description |
|--------|------|----------|---------|-------------|
| `id` | INTEGER | No | Auto | Primary key |
| `show_id` | INTEGER | No | - | Foreign key → `shows.id` (cascade delete) |
| `season` | INTEGER | No | - | Season number |
| `episode` | INTEGER | No | - | Episode number within season |
| `title` | VARCHAR(255) | No | - | Episode title |
| `overview` | TEXT | Yes | - | Episode description |
| `air_date` | VARCHAR(10) | Yes | - | Air date (YYYY-MM-DD) |
| `tmdb_id` | INTEGER | Yes | - | TMDB episode ID |
| `still_path` | VARCHAR(255) | Yes | - | TMDB still image path |
| `file_path` | VARCHAR(1024) | Yes | - | Absolute path to file on disk |
| `file_status` | VARCHAR(50) | No | `"missing"` | File status: `missing`, `found`, `renamed`, `skipped` |
| `matched_at` | DATETIME | Yes | - | When file was matched to this episode |
| `runtime` | INTEGER | Yes | - | Episode runtime in minutes |
| `created_at` | DATETIME | No | Now | Record creation time |
| `last_updated` | DATETIME | No | Now | Last update time (auto-updated) |

**Relationships:** Belongs to Show.

**Computed properties:**
- `episode_code`: Returns formatted code like `S01E01`.
- `has_aired`: Returns `true` if `air_date` is in the past.
- Effective status in API: If `file_status` is `missing` and `has_aired` is `false`, the API returns `not_aired`.

---

### Movie

Movie metadata and file tracking.

**Table:** `movies`

| Column | Type | Nullable | Default | Description |
|--------|------|----------|---------|-------------|
| `id` | INTEGER | No | Auto | Primary key |
| `tmdb_id` | INTEGER | Yes | - | TMDB movie ID (unique) |
| `imdb_id` | VARCHAR(20) | Yes | - | IMDB ID |
| `title` | VARCHAR(500) | No | - | Movie title |
| `original_title` | VARCHAR(500) | Yes | - | Original language title |
| `overview` | TEXT | Yes | - | Movie description |
| `tagline` | VARCHAR(500) | Yes | - | Movie tagline |
| `year` | INTEGER | Yes | - | Release year |
| `release_date` | VARCHAR(10) | Yes | - | Release date (YYYY-MM-DD) |
| `runtime` | INTEGER | Yes | - | Runtime in minutes |
| `poster_path` | VARCHAR(255) | Yes | - | TMDB poster image path |
| `backdrop_path` | VARCHAR(255) | Yes | - | TMDB backdrop image path |
| `genres` | TEXT | Yes | - | JSON array of genre names |
| `studio` | TEXT | Yes | - | JSON array of production companies |
| `vote_average` | FLOAT | Yes | - | TMDB rating (0-10) |
| `popularity` | FLOAT | Yes | - | TMDB popularity score |
| `status` | VARCHAR(50) | No | `"Released"` | Movie status |
| `file_path` | VARCHAR(1024) | Yes | - | Absolute path to file on disk |
| `folder_path` | VARCHAR(1024) | Yes | - | Absolute path to movie folder |
| `file_status` | VARCHAR(50) | No | `"missing"` | File status: `missing`, `found`, `renamed` |
| `matched_at` | DATETIME | Yes | - | When file was matched |
| `edition` | VARCHAR(255) | Yes | - | Edition (Director's Cut, Extended, etc.) |
| `collection_id` | INTEGER | Yes | - | TMDB collection ID |
| `collection_name` | VARCHAR(255) | Yes | - | TMDB collection name |
| `do_rename` | BOOLEAN | No | `true` | Enable automatic file renaming |
| `created_at` | DATETIME | No | Now | Record creation time |
| `last_updated` | DATETIME | No | Now | Last update time (auto-updated) |

---

### ScanFolder

Configured scan folder paths.

**Table:** `scan_folders`

| Column | Type | Nullable | Default | Description |
|--------|------|----------|---------|-------------|
| `id` | INTEGER | No | Auto | Primary key |
| `path` | VARCHAR(1024) | No | - | Absolute folder path (unique) |
| `folder_type` | VARCHAR(50) | No | - | Type: `library`, `tv`, `movie_library`, `issues` |
| `enabled` | BOOLEAN | No | `true` | Whether folder is active |
| `created_at` | DATETIME | No | Now | Record creation time |

---

### PendingAction

Queued file operations waiting for approval.

**Table:** `pending_actions`

| Column | Type | Nullable | Default | Description |
|--------|------|----------|---------|-------------|
| `id` | INTEGER | No | Auto | Primary key |
| `action_type` | VARCHAR(50) | No | - | Type: `rename`, `move`, `copy`, `delete` |
| `source_path` | VARCHAR(1024) | No | - | Current file path |
| `dest_path` | VARCHAR(1024) | Yes | - | Target file path |
| `show_id` | INTEGER | Yes | - | Foreign key → `shows.id` (SET NULL on delete) |
| `episode_id` | INTEGER | Yes | - | Foreign key → `episodes.id` (SET NULL on delete) |
| `movie_id` | INTEGER | Yes | - | Foreign key → `movies.id` (SET NULL on delete) |
| `status` | VARCHAR(50) | No | `"pending"` | Status: `pending`, `approved`, `completed`, `rejected`, `failed` |
| `error_message` | TEXT | Yes | - | Error details if failed |
| `created_at` | DATETIME | No | Now | Record creation time |
| `completed_at` | DATETIME | Yes | - | When action was executed |

---

### AppSettings

Key-value application settings.

**Table:** `app_settings`

| Column | Type | Nullable | Default | Description |
|--------|------|----------|---------|-------------|
| `id` | INTEGER | No | Auto | Primary key |
| `key` | VARCHAR(255) | No | - | Setting name (unique) |
| `value` | TEXT | No | - | Setting value (stored as string; JSON for complex values) |
| `updated_at` | DATETIME | No | Now | Last update time (auto-updated) |

See [Configuration Reference](settings.md) for all setting keys and defaults.

---

### IgnoredEpisode

Episodes excluded from missing episode reports.

**Table:** `ignored_episodes`

| Column | Type | Nullable | Default | Description |
|--------|------|----------|---------|-------------|
| `id` | INTEGER | No | Auto | Primary key |
| `episode_id` | INTEGER | No | - | Foreign key → `episodes.id` (cascade delete, unique) |
| `reason` | VARCHAR(255) | Yes | - | Why the episode is ignored |
| `created_at` | DATETIME | No | Now | Record creation time |

---

### WatcherLog

Log entries for watcher activity.

**Table:** `watcher_log`

| Column | Type | Nullable | Default | Description |
|--------|------|----------|---------|-------------|
| `id` | INTEGER | No | Auto | Primary key |
| `timestamp` | DATETIME | No | Now | Event time |
| `action_type` | VARCHAR(50) | No | - | Event type (see below) |
| `file_path` | VARCHAR(1024) | Yes | - | Related file path |
| `show_name` | VARCHAR(255) | Yes | - | Related show name |
| `show_id` | INTEGER | Yes | - | Foreign key → `shows.id` (SET NULL on delete) |
| `episode_code` | VARCHAR(20) | Yes | - | Episode code (e.g., S01E01) |
| `movie_id` | INTEGER | Yes | - | Foreign key → `movies.id` (SET NULL on delete) |
| `movie_title` | VARCHAR(500) | Yes | - | Related movie title |
| `media_type` | VARCHAR(20) | Yes | - | `tv` or `movie` |
| `result` | VARCHAR(50) | Yes | - | `success`, `skipped`, `failed`, `pending` |
| `details` | TEXT | Yes | - | Additional details |

**Action types:** `file_detected`, `match_found`, `moved_to_library`, `moved_to_issues`, `auto_import`, `error`, `library_scan`, `watcher_started`, `watcher_stopped`, `watcher_paused`, `watcher_resumed`.

---

### LibraryLog

Log entries for library file operations.

**Table:** `library_log`

| Column | Type | Nullable | Default | Description |
|--------|------|----------|---------|-------------|
| `id` | INTEGER | No | Auto | Primary key |
| `timestamp` | DATETIME | No | Now | Operation time |
| `action_type` | VARCHAR(50) | No | - | Operation type (see below) |
| `file_path` | VARCHAR(1024) | Yes | - | Source file path |
| `dest_path` | VARCHAR(1024) | Yes | - | Destination file path |
| `show_name` | VARCHAR(255) | Yes | - | Related show name |
| `show_id` | INTEGER | Yes | - | Foreign key → `shows.id` (SET NULL on delete) |
| `episode_code` | VARCHAR(20) | Yes | - | Episode code (e.g., S01E01) |
| `movie_id` | INTEGER | Yes | - | Foreign key → `movies.id` (SET NULL on delete) |
| `movie_title` | VARCHAR(500) | Yes | - | Related movie title |
| `media_type` | VARCHAR(20) | Yes | - | `tv` or `movie` |
| `result` | VARCHAR(50) | Yes | - | `success` or `failed` |
| `details` | TEXT | Yes | - | Error details or additional info |

**Action types:** `rename`, `import`, `rename_failed`, `import_failed`.

## Relationships

```
Show ──< Episode
  │         │
  │         ▼
  │    IgnoredEpisode
  │
  ├──< PendingAction (show_id)
  │         │
  │    Episode ──< PendingAction (episode_id)
  │
  ├──< WatcherLog (show_id)
  └──< LibraryLog (show_id)

Movie ──< PendingAction (movie_id)
  ├──< WatcherLog (movie_id)
  └──< LibraryLog (movie_id)
```

- **Show → Episode**: One-to-many with cascade delete. Deleting a show removes all its episodes.
- **Episode → IgnoredEpisode**: One-to-one with cascade delete.
- **Show/Episode/Movie → PendingAction**: SET NULL on delete (actions aren't removed when media is deleted).
- **Show/Movie → WatcherLog/LibraryLog**: SET NULL on delete (logs are preserved).

## Auto-Migration

On startup, `run_migrations()` in `main.py` inspects the database schema and applies any needed changes:

- Adds missing columns to existing tables.
- Recreates tables when column constraints need changing (e.g., making `tmdb_id` nullable).
- Migrates legacy settings to new formats (e.g., `watcher_issues_folder` to `scan_folders`).
- Renames folder types (e.g., `download` to `tv`).

This ensures the database schema stays in sync with the model definitions without requiring external migration tools.

## Backup

The database is a single SQLite file at `data/media-admin.db`. To back up:

```bash
cp data/media-admin.db data/media-admin.db.backup
```

Or use SQLite's online backup:

```bash
sqlite3 data/media-admin.db ".backup 'data/media-admin.db.backup'"
```
