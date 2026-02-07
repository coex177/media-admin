# TV Show Management

## Adding Shows

### Search by Name

Use the global search bar or the Add Show modal to search for TV shows. Searches query TMDB or TVDB depending on the selected source.

- **Global search**: Type a show name and results appear across both library and providers.
- **Add Show modal**: Opens from the Shows page with dedicated search, source selection (TMDB/TVDB), and a preview step.
- **Year filtering**: Include a year in the query (e.g., "Black 2017") to filter results by year. The year is extracted and passed to the TMDB API's `first_air_date_year` parameter.

### Search by ID

Type a numeric ID (4+ digits) to look up a show directly:

- In the **global search bar**: Fetches from TMDB by ID.
- In the **Add Show modal**: Fetches from the currently selected source (TMDB or TVDB).

This is useful for shows with generic or non-English names that are hard to find via text search.

### Preview and Add

Before adding a show, you can preview its full metadata (seasons, episode count, genres, networks, poster). The preview fetches episodes from the selected provider and displays season breakdowns.

When a show is added:
1. The show record is created with metadata from the provider.
2. All episodes are imported into the database.
3. TMDB, TVDB, and IMDB IDs are cross-referenced (TMDB provides external IDs).
4. A library folder is auto-detected or can be set manually.
5. The library is scanned to match existing files to episodes.

## Show Detail View

The show detail page displays:

- **Header**: Poster, backdrop, name, year, status, genres, networks, overview.
- **Season accordion**: Expandable seasons with episode lists.
- **Episode rows**: Episode number, title, air date, runtime, file status badge, still image.
- **File status badges**: Found (green), Missing (red), Not Aired (gray), Ignored (yellow).
- **Settings**: Folder path, season/episode naming formats, rename toggle, missing episode tracking toggle.

## Metadata Refresh

### Single Show

Refresh a show's metadata from its configured source (TMDB or TVDB). This:

1. Fetches updated show metadata (name, status, poster, genres, networks, air dates).
2. Adds any new episodes, updates existing episode metadata.
3. Renames the show folder if the year in the folder name doesn't match `first_air_date` (e.g., `Show (2021)` becomes `Show (2018)` and all episode file paths are updated).
4. Rescans the show folder to match files to any new episodes.

### Bulk Refresh

Refresh all shows at once. Runs as a background task with progress tracking (current show name and count).

## Source Switching

Switch a show's metadata provider between TMDB and TVDB:

1. Fetches the show from the new provider.
2. Deletes all existing episodes.
3. Imports episodes from the new provider.
4. Updates show metadata (name, overview, poster, etc.).
5. Rescans the library folder to match files.

The TVDB ID is obtained from TMDB's external IDs. If switching to TVDB, the show must have a valid `tvdb_id`.

## Season Type Selection

For TVDB-sourced shows, you can choose the episode ordering:

- **Aired** (official): Episodes ordered by original air date.
- **DVD**: Episodes ordered by DVD release.
- **Absolute**: Sequential numbering without seasons.
- **Alternate**: Provider-specific alternate orderings.

Changing the season type re-imports all episodes and rescans.

## Episode Tracking

### File Status

Each episode has one of these statuses:

| Status | Meaning |
|--------|---------|
| `found` | A matching file exists on disk |
| `missing` | No file found and episode has aired |
| `not_aired` | No file found but episode hasn't aired yet |
| `renamed` | File has been renamed to the expected format |
| `skipped` | File exists but was skipped during processing |

### Missing Episodes

The missing episodes view shows all episodes that have aired but have no file on disk, excluding ignored episodes. Available per-show and library-wide.

### Ignoring Episodes

Mark episodes as ignored to exclude them from missing episode counts and reports. Useful for specials, bonus content, or episodes you don't want to track.

- **Single**: Ignore/unignore individual episodes.
- **Bulk by show**: Ignore/unignore all episodes for a show.
- **Bulk by season**: Ignore/unignore all episodes in a season.

### Multi-Episode Files

A single file can match multiple episodes (e.g., `S01E01-E03` matches episodes 1, 2, and 3). All matched episodes share the same `file_path` and are marked as found.

## Fix Match

If a show was matched to the wrong provider entry, use Fix Match to transfer files to a different show:

1. **Preview**: Shows which files would be moved and to which episodes.
2. **Execute**: Moves files from the source show's episodes to the target show's matching episodes.

## Aliases

Shows can have aliases (alternative names) stored as a JSON array. Aliases are used during filename matching to improve fuzzy match accuracy. They can be edited from the show detail page.
