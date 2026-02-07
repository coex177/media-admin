# Configuration Reference

All settings are stored in the SQLite database and managed through the web UI Settings page.

## Settings Tabs

The Settings page is organized into five tabs:

| Tab | Contents |
|-----|----------|
| **General** | API keys, metadata source, episode/movie naming formats, theme |
| **Dashboard** | Card counts for each dashboard content card |
| **Library** | Shows per page, movies per page, display episode format |
| **Folders** | Library folders, download folders, movie library folders, issues folder |
| **Watcher** | Watcher toggle, file size threshold, subfolder monitoring, companion types, quality priorities, issues organization, auto-purge |

## General Settings

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `tmdb_api_key` | string | `""` | TMDB API key ([get one here](https://www.themoviedb.org/settings/api)) |
| `tvdb_api_key` | string | *(built-in)* | TVDB API key (pre-seeded with a project key) |
| `default_metadata_source` | string | `"tmdb"` | Primary metadata provider: `tmdb` or `tvdb` |
| `episode_format` | string | `"{season}x{episode:02d} - {title}"` | Default episode filename format |
| `season_format` | string | `"Season {season}"` | Default season folder format |
| `movie_format` | string | `"{title} ({year})/{title} ({year})"` | Movie filename format (use `/` for folder nesting) |
| `theme` | string | `"midnight"` | UI theme: `midnight`, `light`, or `sunset` |
| `setup_completed` | boolean | `false` | Set to `true` automatically when TMDB key is provided |

## Dashboard Settings

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `recently_aired_days` | integer | `5` | Days back for Recently Aired card |
| `upcoming_days` | integer | `5` | Days ahead for Upcoming card |
| `recently_added_count` | integer | `5` | Shows in Recently Added Shows card |
| `recently_matched_count` | integer | `5` | Episodes in Recently Matched card |
| `returning_soon_count` | integer | `5` | Shows in Returning Soon card |
| `recently_ended_count` | integer | `5` | Shows in Recently Ended card |
| `movie_recently_added_count` | integer | `5` | Movies in Recently Added Movies card |
| `movie_recently_released_count` | integer | `5` | Movies in Recently Released Movies card |
| `movie_top_rated_count` | integer | `5` | Movies in Top Rated Movies card |
| `movie_lowest_rated_count` | integer | `5` | Movies in Lowest Rated Movies card |

## Library Settings

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `shows_per_page` | integer | `0` | Shows per page (0 = all on one page) |
| `shows_per_page_options` | JSON array | `[100,300,500,1000,1500]` | Available page size options |
| `movies_per_page` | integer | `0` | Movies per page (0 = all on one page) |
| `movies_per_page_options` | JSON array | `[100,300,500,1000,1500]` | Available page size options |
| `display_episode_format` | string | `"{season}x{episode:02d}"` | Episode code format in UI display |
| `timezone` | string | `""` | User timezone (optional) |
| `slow_import_count` | integer | `10` | Batch size for slow import processing |

## Folder Configuration

Folders are managed through the Folders tab. Each folder has a type:

| Folder Type | Purpose |
|-------------|---------|
| `library` | TV show library root (contains show subfolders) |
| `tv` | TV download folder (monitored for new episodes) |
| `movie_library` | Movie library root (contains movie files/folders) |
| `issues` | Issues folder for unmatched/duplicate files (only one active at a time) |

Add, remove, and toggle (enable/disable) folders from the Settings page.

## Watcher Settings

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `watcher_enabled` | boolean | `false` | Auto-start watcher on app startup |
| `watcher_monitor_subfolders` | boolean | `true` | Watch subdirectories recursively |
| `watcher_min_file_size_mb` | integer | `50` | Minimum file size in MB (smaller files ignored) |
| `watcher_issues_organization` | string | `"date"` | Issues folder structure: `date` or `reason` |
| `watcher_auto_purge_days` | integer | `0` | Delete Issues files older than N days (0 = disabled) |
| `watcher_delete_empty_folders` | boolean | `false` | Remove empty folders after moving files |
| `watcher_companion_types` | JSON array | See below | File extensions moved alongside video files |
| `watcher_quality_priorities` | JSON array | See below | Quality comparison factor weights |

**Default companion types:**
```json
[".srt", ".sub", ".ass", ".ssa", ".vtt", ".idx", ".sup", ".nfo"]
```

**Default quality priorities:**
```json
[
  {"factor": "resolution", "points": 100},
  {"factor": "bitrate", "points": 80},
  {"factor": "video_codec", "points": 60},
  {"factor": "audio_codec", "points": 40},
  {"factor": "audio_channels", "points": 20},
  {"factor": "subtitles", "points": 10}
]
```

## Environment Variables

Settings from `config.py` can be overridden with environment variables using the `MEDIA_ADMIN_` prefix:

| Variable | Default | Description |
|----------|---------|-------------|
| `MEDIA_ADMIN_DATABASE_URL` | `sqlite:///./data/media-admin.db` | Database connection string |
| `MEDIA_ADMIN_TMDB_API_KEY` | `""` | TMDB API key |
| `MEDIA_ADMIN_TVDB_API_KEY` | *(built-in key)* | TVDB API key |
| `MEDIA_ADMIN_HOST` | `0.0.0.0` | Server bind address |
| `MEDIA_ADMIN_PORT` | `8095` | Server port |
| `MEDIA_ADMIN_DEBUG` | `false` | Debug mode |

Environment variables can also be set in a `.env` file in the project root.

## Naming Format Reference

### Episode Format Variables

| Variable | Description | Example Output |
|----------|-------------|----------------|
| `{season}` | Season number | `1` |
| `{season:02d}` | Season number, zero-padded | `01` |
| `{episode}` | Episode number | `5` |
| `{episode:02d}` | Episode number, zero-padded | `05` |
| `{title}` | Episode title | `The Pilot` |

### Season Folder Variables

| Variable | Description | Example Output |
|----------|-------------|----------------|
| `{season}` | Season number | `1` |
| `{season:02d}` | Season number, zero-padded | `01` |

### Movie Format Variables

| Variable | Description | Example Output |
|----------|-------------|----------------|
| `{title}` | Movie title | `The Matrix` |
| `{year}` | Release year | `1999` |
| `{edition}` | Edition tag | `Director's Cut` |

Use `/` in the movie format to create folder structure:
- `{title} ({year})/{title} ({year})` → one folder per movie
- `{year}/{title} ({year})` → year-based folders
- `{title} ({year})` → flat (no subfolders)

## Themes

Three built-in themes selectable from Settings:

| Theme | Description |
|-------|-------------|
| `midnight` | Dark theme (default) |
| `light` | Light theme |
| `sunset` | Warm dark theme |

Themes are implemented with CSS custom properties. The selected theme class is applied to the document body.
