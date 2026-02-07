# Movie Management

## Adding Movies

### Search by Name

Search for movies using the global search bar or the Add Movie modal. All movie searches query TMDB.

- **Global search**: Returns both library matches and TMDB results.
- **Add Movie modal**: Dedicated search with preview step.

### Search by ID

Type a numeric TMDB ID (4+ digits) to look up a movie directly. Useful for movies with generic titles or non-English names.

### Preview and Add

Preview a movie's full metadata before adding it to the library. When a movie is added:

1. The movie record is created with TMDB metadata.
2. TMDB and IMDB IDs are stored.
3. Collection information is saved if the movie belongs to a TMDB collection.
4. A library folder is auto-detected or set manually.
5. The library is scanned to match an existing file.

## Movie Detail View

The movie detail page displays:

- **Header**: Poster, backdrop, title, year, tagline, runtime, rating.
- **Metadata**: Genres, studios, release date, status, overview.
- **File info**: File path, file status, matched date.
- **Settings**: Folder path, rename toggle, edition.

## Metadata Refresh

### Single Movie

Refresh a movie's metadata from TMDB:

1. Fetches updated metadata (title, year, overview, poster, genres, studios, ratings).
2. Updates collection information if applicable.
3. Rescans to match file if the movie is missing one.

### Bulk Refresh

Refresh all movies at once. Runs as a background task with progress tracking.

## Collections

Movies that belong to a TMDB collection are automatically grouped. The collections view shows:

- Collection name.
- All movies in the collection with their status (found/missing).
- Collection completion progress.

## Editions

Movies can have an edition tag that appears in the filename:

- Director's Cut
- Extended Edition
- Unrated
- Theatrical
- IMAX
- Remastered
- Criterion Collection
- Custom text

Editions are detected from filenames during scanning (via Plex-style `{edition-Name}` tags or common keywords) and can be set manually. When renaming, the edition is appended to the filename.

## File Status

| Status | Meaning |
|--------|---------|
| `found` | A matching file exists on disk |
| `missing` | No file found |
| `renamed` | File has been renamed to the expected format |

## Browse and Filter

- **Three view modes**: Cards (poster grid), compact tiles, expandable list.
- **Alphabetical pagination**: Library-style pages broken at letter boundaries, with article stripping (The, A, An).
- **Collection grouping**: View movies grouped by collection.
