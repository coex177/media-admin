# Scanning & Import

## Library Folder Scanning

Library scanning matches video files on disk to shows/movies in the database.

### Scan Phases (TV)

A full TV library scan runs through 6 phases:

1. **File matching**: Scan each show's folder, parse filenames, match files to episodes using season/episode numbers.
2. **Metadata refresh**: Optionally refresh show metadata from the configured provider.
3. **Rename previews**: Compute rename previews for shows with `do_rename` enabled.
4. **Missing episodes**: Count missing episodes across all shows.
5. **Download scan**: Check download folders for files matching missing episodes.
6. **Summary**: Compile results (matched, missing, unmatched, errors).

### Quick Scan

A quick scan skips the metadata refresh phase, only matching files to episodes.

### Single Show Scan

Scan just one show's folder. Used after adding a show or refreshing its metadata.

### Movie Library Scan

Similar to TV scanning:
1. Auto-match movie folders in library.
2. Scan for video files and match to movies.
3. Compute rename previews.

### How File Matching Works

For each show folder:
1. Recursively find all video files.
2. Parse each filename for season/episode numbers.
3. Look up the matching episode in the database.
4. If found, set `file_path` and `file_status = "found"`.
5. Multi-episode files (e.g., S01E01-E03) mark all matched episodes as found.
6. Files in `Specials` or `Season 0` folders can auto-create missing Season 0 episodes.

### Show Folder Auto-Detection

When a show has no `folder_path`, the scanner tries to find it using a 5-pass approach:

1. **Exact + year**: `Show Name (2019)` in library folders.
2. **Exact + country**: `Show Name (US)` in library folders.
3. **Exact no suffix**: `Show Name` without any parenthetical.
4. **Exact any suffix**: `Show Name (anything)` — matches any year/country.
5. **Fuzzy**: Similarity score >= 0.85 against all folders.

Year and country codes (US, UK, AU, CA, NZ) are extracted from folder names for matching.

## Download Folder Scanning

Download folder scanning checks configured download folders for files matching missing episodes:

1. Scan all TV download folders for video files.
2. Parse filenames and match to shows in the library.
3. For matched files, create pending import actions.
4. Results appear in the scan results under "Download Matches."

**Note:** Download folder scanning only handles TV shows. The watcher pipeline handles both TV and movies. See [Download Monitoring](watcher.md) for movie handling.

## Managed Import (Library Folder Discovery)

Managed Import bulk-imports shows from a library folder that already contains show subfolders. It's designed for initial library setup or migrating from another media manager.

### How It Works

1. **Scan**: Lists all subfolders in the selected library folder.
2. **Match**: For each subfolder, searches TMDB (or TVDB) using the folder name.
   - Title similarity scoring with year bonus/penalty.
   - Minimum match score of 0.5 required.
   - Existing shows in search results are skipped during scoring.
3. **Add**: Creates the show, imports episodes, and sets the folder path.
4. **Scan**: Scans the show folder to match existing files to episodes.

### Secondary Provider Fallback

After a show is imported, if it has unmatched files (files on disk that don't match any episode):

1. The system counts how many files match episodes with the default provider.
2. It tries the secondary provider (TMDB ↔ TVDB).
3. If the secondary provider matches all files (`extra <= 0`), it switches:
   - Deletes all episodes.
   - Re-imports episodes from the secondary provider.
   - Updates show metadata and `metadata_source`.
4. If both providers have unmatched files, the default provider is kept.

This handles cases where TMDB and TVDB have different episode numbering (e.g., specials counted differently).

### Progress Tracking

Managed Import runs as a background task with:
- Per-show progress (show name, match result).
- Console log with details.
- Status endpoint for polling.

## Pending Actions

Pending actions are rename/import operations waiting for approval.

### Action Types

| Type | Description |
|------|-------------|
| `rename` | Rename a file in-place |
| `move` | Move a file to a new location |
| `copy` | Copy a file to a new location |
| `delete` | Delete a file |

### Status Flow

```
pending → approved → completed
                  → failed
        → rejected
```

### Approval Workflow

1. **View**: See all pending actions with source and destination paths.
2. **Approve one**: Execute a single action.
3. **Approve all**: Execute all pending actions at once.
4. **Reject**: Mark an action as rejected (no file operation performed).

### Logged Operations

All executed actions are logged in the Library Log with:
- Timestamp, action type, source/destination paths.
- Show/movie association.
- Success or failure result with error details.

## Missing Episode Reports

Available per-show and library-wide:

- Lists all episodes that have aired but have no file on disk.
- Excludes ignored episodes.
- Groups by show and season.
- Shows episode code, title, and air date.
