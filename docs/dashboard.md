# Dashboard

The dashboard provides an overview of your library with stat cards and content cards.

## Stat Cards

7 stat cards displayed in a horizontal row at the top.

| Card | Shows | Style |
|------|-------|-------|
| **Total Shows** | Number of shows in library | Neutral (clickable → Shows page) |
| **Episodes Found** | Episodes with files on disk | Green |
| **Episodes Missing** | Aired episodes without files | Red |
| **Ignored** | Episodes marked as ignored | Gray |
| **Pending Actions** | Rename/import actions waiting | Yellow (clickable → Scan page) |
| **Collection Progress** | Percentage of episodes found | Green (>=90%), Yellow (>=70%), Red (<70%) |
| **Total Movies** | Number of movies in library | Neutral (clickable → Movies page) |

## Content Cards

18 content cards displayed in a responsive grid below the stats.

### TV Show Cards

| Card | Data | Details |
|------|------|---------|
| **Recently Aired** | Episodes that aired in the last N days | Episode code, air date, title, file status badge (Added/Missing) |
| **Recently Added Shows** | Most recently added shows | Poster, name, seasons, episode counts, missing/complete badges |
| **Upcoming** | Episodes airing within N days | Episode code, relative date (today/tomorrow/X days), title |
| **Recently Ended** | Shows with Ended/Canceled status | Poster, name, seasons, episode counts, status badge |
| **Most Incomplete** | Shows with the most missing episodes | Poster, name, found/aired episodes, completion percentage |
| **Recently Matched** | Episodes recently matched by scanner | Episode code, matched date, title |
| **Returning Soon** | Shows with upcoming `next_episode_air_date` | Poster, name, days until return |

### Utility/Stats Cards

| Card | Data | Details |
|------|------|---------|
| **Last Scan** | Information about the most recent scan | Scan type, episodes matched, unmatched files, errors |
| **Storage Stats** | Library storage information | Total size (GB), file count, average file size (MB) |
| **Genres** | Genre distribution across shows | Genre name, show count, expandable list of shows |
| **Networks** | Network distribution across shows | Network name, show count, expandable list of shows |
| **Extra Files on Disk** | Shows with more disk files than matched episodes | Show name, matched vs. disk file counts |

### Movie Cards

| Card | Data | Details |
|------|------|---------|
| **Recently Added Movies** | Most recently added movies | Poster, title, year, runtime, file status badge |
| **Recently Released Movies** | Movies sorted by release date | Poster, title, release date, runtime, file status badge |
| **Movie Genres** | Genre distribution across movies | Genre name, movie count, expandable list of movies |
| **Movie Studios** | Studio distribution across movies | Studio name, movie count, expandable list of movies |
| **Top Rated Movies** | Highest-rated movies by TMDB score | Poster, title, year, rating badge (green) |
| **Lowest Rated Movies** | Lowest-rated movies by TMDB score | Poster, title, year, rating badge (red) |

## Card Customization

### Drag and Drop

Both stat cards and content cards can be reordered by dragging. Stat cards reorder within the stats row; content cards reorder within the content grid. Card order is persisted.

### Hide and Restore

- Click the X button on any card to hide it.
- Use the "Restore Hidden Cards" button to open a modal showing hidden cards grouped by category (Shows/Movies).
- "Restore All" brings back all hidden cards.

### Expand and Collapse

- Each content card has a toggle to expand or collapse its content.
- "Collapse All" and "Expand All" buttons affect all content cards at once.
- Individual card states are persisted.

### Reset Layout

The "Reset Layout" button restores all defaults:
- Default stat card order.
- Default content card order.
- No hidden cards.
- All cards expanded.

## Lazy Loading

Content cards only fetch their data when they become visible (expanded and not hidden). This prevents unnecessary API calls for cards the user doesn't see.

## Configurable Card Counts

The number of items shown in each card is configurable in Settings:

| Setting | Default | Affects |
|---------|---------|---------|
| `recently_aired_days` | 5 | Recently Aired (days back) |
| `upcoming_days` | 5 | Upcoming (days ahead) |
| `recently_added_count` | 5 | Recently Added Shows |
| `recently_matched_count` | 5 | Recently Matched |
| `returning_soon_count` | 5 | Returning Soon |
| `recently_ended_count` | 5 | Recently Ended |
| `movie_recently_added_count` | 5 | Recently Added Movies |
| `movie_recently_released_count` | 5 | Recently Released Movies |
| `movie_top_rated_count` | 5 | Top Rated Movies |
| `movie_lowest_rated_count` | 5 | Lowest Rated Movies |

## Layout Persistence

All dashboard state is stored in the browser's localStorage and synced to the database via the `/api/ui-prefs` endpoint:

- Card order (stat cards and content cards separately).
- Hidden cards list.
- Expanded/collapsed state per card.
- Distribution item expand states (genres, networks, studios).
