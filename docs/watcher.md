# Download Monitoring (Watcher)

The watcher service monitors download folders for new video files and automatically processes them into the library.

## How It Works

### Architecture

The watcher uses [watchdog](https://python-watchdog.readthedocs.io/) with Linux inotify to detect filesystem events (file creation, moves, modifications) in configured download folders.

```
Download folder → inotify events → Pending tracker → Stability check → Processing pipeline
```

### Stability Checking

When a file is detected, it enters a pending state:

1. **File detected**: Record first-seen time and file size.
2. **Size monitoring**: Every 10 seconds, check if the file size has changed.
3. **Timer reset**: If the size changed, reset the stability timer.
4. **Stable**: Once 60 seconds pass with no size changes, the file is considered stable and processed.

This ensures files that are still being downloaded or extracted are not processed prematurely.

### Scan Lock Coordination

The watcher and manual scans share a processing lock to prevent conflicts:

- If a **manual scan** is running, newly stable files are **queued**.
- When the scan completes, queued files are processed one at a time.
- If the **watcher** is processing, manual scans wait for the lock.

### Startup Behavior

- On application startup, if the watcher was enabled before shutdown, it auto-starts.
- A **catchup sweep** runs on start: scans all download folders for files that arrived while the watcher was stopped, then processes them.

## Processing Pipeline

The watcher pipeline (`watcher_pipeline.py`) processes each stable file through a decision tree:

```
                     New stable file
                          │
                   ┌──────┴──────┐
                   │ Parse as TV │
                   │ (SxE found?)│
                   └──────┬──────┘
                    Yes   │   No
              ┌───────────┤
              ▼           ▼
        Match show   ┌───────────┐
        in library   │ Parse as  │
              │      │  movie    │
              │      └─────┬─────┘
              │       Yes  │  No
              │   ┌────────┤
              │   ▼        ▼
              │  Match   Move to
              │  movie   Issues
              │  in DB   (parse_failed)
              │   │
              ▼   ▼
        ┌─────────────┐
        │ Episode/file │
        │ already has  │
        │ a file?      │
        └──────┬───────┘
          No   │   Yes
        ┌──────┤
        ▼      ▼
      Move   Quality
      to     comparison
      library  │
              ┌┴─────────┐
              ▼           ▼
          New better   Existing better
          → upgrade    → Issues
```

### Step 1: TV Parsing

Parse the filename for season/episode patterns (S01E01, 1x01, etc.). See [Filename Parsing](filename-parsing.md) for pattern details.

### Step 2: Show Matching

If TV patterns are found, match the extracted show name against the library:

- Fuzzy match against all shows (threshold 0.7).
- Checks both show names and aliases.
- If no match found, attempts **auto-import** from TMDB/TVDB.

### Step 3: Auto-Import (TV)

If the show isn't in the library:

1. Search the primary provider (TMDB or TVDB) by show name.
2. Pick the best result using fuzzy matching with year bonus.
3. Fetch full show data and episodes.
4. Create the show in the database with a library folder.
5. Scan the new folder for any existing files.

If the primary provider fails, try the secondary provider.

### Step 4: Episode Processing

For each matched episode (single or multi-episode):

- **Missing episode**: Copy file to library with proper naming, update database.
- **Episode has file**: Run quality comparison.
- **Episode not in DB**: Still move to library (creates a placeholder path).

### Step 5: Movie Processing

If TV parsing found nothing, try movie parsing:

1. Parse filename for title and year.
2. Match against movies in the database (threshold 0.7).
3. If no DB match, auto-import from TMDB.
4. If the movie already has a file, run quality comparison.
5. Otherwise, copy to library.

## Quality Comparison

When a new file arrives for an episode/movie that already has one, ffprobe analyzes both files.

### Requirements

- **ffprobe** must be installed (part of the ffmpeg package).
- If ffprobe is unavailable, the new file is moved to Issues as a safety measure.

### Analysis

ffprobe extracts from each file:

| Factor | How Measured |
|--------|-------------|
| Resolution | Width x Height pixels |
| Bitrate | Overall bitrate (bits/sec) |
| Video codec | Canonical codec name |
| Audio codec | Best audio stream's codec |
| Audio channels | Best audio stream's channel count |
| Subtitle count | Number of subtitle streams |

### Comparison

Factors are compared in priority order (configurable):

| Factor | Default Points | Higher = Better |
|--------|---------------|-----------------|
| Resolution | 100 | More pixels |
| Bitrate | 80 | Higher bitrate |
| Video codec | 60 | See codec tiers below |
| Audio codec | 40 | See codec tiers below |
| Audio channels | 20 | More channels |
| Subtitles | 10 | More subtitle streams |

The first factor where the files differ determines the winner. If all factors are equal, the existing file wins.

### Video Codec Tiers (lowest to highest)

```
MPEG-2 → MPEG-4 → VC-1 → H.264 → H.265/HEVC → AV1
```

### Audio Codec Tiers (lowest to highest)

```
MP2 → MP3/WMA → AAC → AC3 → E-AC3 → DTS → DTS-HD MA → TrueHD → FLAC/PCM
```

### Upgrade Behavior

When the new file wins:

1. Old file is moved to Issues (prefixed with show/movie name).
2. New file is copied to the library location.
3. Database is updated with the new file path.

When the existing file wins:

1. New file is moved to Issues as a duplicate.

## Issues Folder

Files that can't be processed automatically are moved to the Issues folder.

### Organization Modes

| Mode | Structure | Example |
|------|-----------|---------|
| `date` | `Issues/YYYY-MM-DD/file.mkv` | `Issues/2026-02-07/Unknown.File.mkv` |
| `reason` | `Issues/reason/file.mkv` | `Issues/parse_failed/Unknown.File.mkv` |

### Issue Reasons

| Reason | Meaning |
|--------|---------|
| `parse_failed` | Filename couldn't be parsed as TV or movie |
| `show_not_found` | TV show not in library and auto-import failed |
| `no_episode` | Episode not found in the database |
| `duplicate_episode` | Episode already has a file of equal or better quality |
| `movie_not_found` | Movie not in library and auto-import failed |
| `duplicate_movie` | Movie already has a file of equal or better quality |
| `quality_check_failed` | ffprobe analysis failed on one or both files |

### Auto-Purge

Configurable automatic cleanup of old Issues files:

- Set `watcher_auto_purge_days` to enable (0 = disabled).
- Files older than the threshold are deleted.
- Checked periodically (hourly).

### Managing Issues

From the Issues tab in the UI:

- Browse files grouped by date or reason.
- Delete individual files.
- Delete all files at once.
- Text search to filter by filename.

## Safe File Operations

The watcher uses safe patterns for file operations:

1. **Temp file copy**: Files are copied to `destination.madmintmp` first.
2. **Atomic rename**: The temp file is renamed to the final name.
3. **Ownership inheritance**: New files inherit the owner/group of the parent directory.
4. **Source cleanup**: Original file is deleted after successful copy (configurable).
5. **Empty folder cleanup**: Optionally removes empty parent directories after move.
6. **Stale temp cleanup**: Old `.madmintmp` files are deleted before new copies.

## Watcher Settings

| Setting | Default | Description |
|---------|---------|-------------|
| `watcher_enabled` | `false` | Auto-start watcher on application startup |
| `watcher_monitor_subfolders` | `true` | Watch subdirectories recursively |
| `watcher_min_file_size_mb` | `50` | Ignore files smaller than this (MB) |
| `watcher_issues_organization` | `date` | Issues folder structure: `date` or `reason` |
| `watcher_auto_purge_days` | `0` | Delete Issues files older than N days (0 = disabled) |
| `watcher_delete_empty_folders` | `false` | Remove empty folders after moving files |
| `watcher_companion_types` | `.srt .sub .ass .ssa .vtt .idx .sup .nfo` | File extensions to move alongside video files |
| `watcher_quality_priorities` | See [Quality Comparison](#comparison) | Factor weights for quality comparison |
