# File Organization & Renaming

## Naming Formats

### Episode Format

Controls how episode files are named. Set globally in Settings and overridden per-show.

**Variables:**

| Variable | Description | Example |
|----------|-------------|---------|
| `{season}` | Season number (no padding) | `1`, `2`, `10` |
| `{season:02d}` | Season number (zero-padded) | `01`, `02`, `10` |
| `{episode}` | Episode number (no padding) | `1`, `5`, `12` |
| `{episode:02d}` | Episode number (zero-padded) | `01`, `05`, `12` |
| `{title}` | Episode title | `Pilot`, `The One Where...` |

**Default:** `{season}x{episode:02d} - {title}`

**Examples:**

| Format | Result |
|--------|--------|
| `{season}x{episode:02d} - {title}` | `1x01 - Pilot.mkv` |
| `S{season:02d}E{episode:02d} - {title}` | `S01E01 - Pilot.mkv` |
| `{season}x{episode:02d}` | `1x01.mkv` |

### Season Folder Format

Controls how season subfolders are named.

**Variables:**

| Variable | Description | Example |
|----------|-------------|---------|
| `{season}` | Season number (no padding) | `1`, `2`, `10` |
| `{season:02d}` | Season number (zero-padded) | `01`, `02`, `10` |

**Default:** `Season {season}`

**Examples:**

| Format | Result |
|--------|--------|
| `Season {season}` | `Season 1` |
| `Season {season:02d}` | `Season 01` |
| `S{season:02d}` | `S01` |

### Movie Format

Controls how movie files and folders are named. A `/` in the format creates folder structure.

**Variables:**

| Variable | Description | Example |
|----------|-------------|---------|
| `{title}` | Movie title | `The Matrix` |
| `{year}` | Release year | `1999` |
| `{edition}` | Edition tag (if set) | `Director's Cut` |

**Default:** `{title} ({year})/{title} ({year})`

**Examples:**

| Format | Result |
|--------|--------|
| `{title} ({year})/{title} ({year})` | `The Matrix (1999)/The Matrix (1999).mkv` |
| `{title} ({year})` | `The Matrix (1999).mkv` (flat) |
| `{year}/{title} ({year})` | `1999/The Matrix (1999).mkv` |

Edition appending: If a movie has an edition and `{edition}` is not in the format string, it is automatically appended in curly braces: `The Matrix (1999) {Director's Cut}.mkv`.

### Multi-Episode Files

Multi-episode files combine episode codes with a dash separator:

```
6x15-6x16 - Title A + Title B.mkv
S01E01-S01E03 - Pilot + Part 2 + Part 3.mkv
```

The separator between the episode code and title is detected from the format string dynamically.

## Format Preview

The Settings page shows a live preview of each naming format as you type, using sample data (Season 1, Episode 1, "Pilot").

## Rename Workflow

### Pending Actions

When a scan detects files that don't match their expected name, it creates **pending actions**:

1. **Scan** runs and compares current filenames to expected filenames.
2. **Pending actions** are created for files that need renaming.
3. **Preview** shows source path and destination path for each action.
4. **Approve** individual actions or approve all at once.
5. **Reject** actions you don't want to execute.

Action types: `rename`, `move`, `copy`, `delete`.

### Execution

When an action is approved:

1. The file is moved/renamed to the destination path.
2. Season folders are created if they don't exist.
3. Companion files are moved alongside the main file.
4. The episode/movie database record is updated with the new path.
5. A library log entry is created.

## Companion File Handling

When a video file is moved or renamed, accompanying files are moved with it:

**Subtitle extensions:** `.srt`, `.sub`, `.ass`, `.ssa`, `.vtt`, `.idx`, `.sup`

**Metadata extensions:** `.nfo`

**Image extensions:** `.jpg`, `.jpeg`, `.png`, `.tbn`

Companion files are matched by stem (filename without extension):

```
Movie.mkv          → moved
Movie.srt          → moved (subtitle)
Movie.en.srt       → moved (English subtitle)
Movie.ja.srt       → moved (Japanese subtitle)
Movie.nfo          → moved (metadata)
Movie.jpg          → moved (image)
```

Supported language codes for subtitles: `en`, `eng`, `es`, `spa`, `fr`, `fra`, `de`, `deu`, `ja`, `jpn`, `pt`, `por`, `it`, `ita`, `ko`, `kor`, `zh`, `zho`.

## Filename Sanitization

Invalid filename characters (`< > " / \ | ? *`) are always removed.

**Colon handling differs by media type:**
- **TV episodes**: Colons are removed (`Title: Subtitle` becomes `Title Subtitle`).
- **Movies**: Colons are replaced with ` -` (`Title: Subtitle` becomes `Title - Subtitle`).

Multiple consecutive spaces are collapsed to a single space.
