# Filename Parsing

Media Admin parses video filenames to extract metadata (show name, season, episode, movie title, year, quality, etc.). This page documents the patterns and matching algorithms used.

## TV Filename Parsing

The TV parser (`services/matcher.py`) extracts season/episode numbers, show name, quality, source, and release group from filenames.

### Episode Patterns

Patterns are tried in order. The first match wins.

| Priority | Pattern | Example Matches |
|----------|---------|-----------------|
| 1 | `S##E##` (multi-ep: `S##E##-E##`, `S##E##E##`) | `S01E01`, `s01e01`, `S01E01-E02`, `S01E01E02` |
| 2 | `##x## - ##x##` (cross-season multi-ep) | `1x01-1x02` |
| 3 | `##x##-##` (same-season multi-ep) | `1x01-02` |
| 4 | `##x##` (standard) | `1x01`, `2x10` |
| 5 | `Season # Episode #` (spelled out) | `Season 1 Episode 1` |
| 6 | `S##.E##` or `S##_E##` (dot/underscore) | `s01.e01`, `s01_e01` |
| 7 | `###` (3-digit fallback: first digit = season, last two = episode) | `101` → S1E01, `213` → S2E13 |

### False Positive Filters

The 3-digit fallback pattern (pattern 7) can cause false positives. Two filters prevent common mismatches:

**Codec filter**: Rejects matches that are actually codec identifiers.
- Pattern: `[xXhH].?(\d{3})`
- Blocks: `H.265`, `H264`, `x.265`, `x264`, `h265`

**Resolution filter**: Rejects matches that are actually resolution indicators.
- Pattern: `(\d{3,4})[pPiI]`
- Blocks: `720p`, `1080i`, `480p`, `2160p`

### Title Extraction

The show title is everything in the filename before the first episode pattern match:

```
The.Good.Place.S01E01.720p.WEB-DL.mkv
^^^^^^^^^^^^^^^^
     title
```

Title cleanup:
1. Replace dots, underscores, and dashes with spaces.
2. Strip AKA alternate titles — everything from "A.K.A." or "AKA" onward is removed (e.g., `Show A.K.A. Other Name` → `Show`).
3. Remove trailing year (e.g., `Show Name 2019` → `Show Name`).
4. Collapse multiple spaces.

### Quality and Source Extraction

**Quality patterns** (resolution):

| Pattern | Matches |
|---------|---------|
| `2160p`, `4K` | 4K / UHD |
| `1080p`, `1080i` | Full HD |
| `720p`, `720i` | HD |
| `480p`, `480i` | SD |

**Source patterns**:

| Pattern | Matches |
|---------|---------|
| `AMZN`, `ATVP`, `NF`, `DSNP`, `HMAX`, `PCOK`, `PMTP` | Streaming services |
| `WEB`, `WEB-DL`, `WEB-Rip` | Web sources |
| `HDTV`, `BluRay`, `BDRip`, `DVDRip`, `PDTV` | Traditional sources |

### Release Group

The release group is extracted from the end of the filename:

```
Show.S01E01.720p.WEB-DL-GROUP.mkv
                          ^^^^^
                       release group
```

Pattern: `-([A-Za-z0-9]+)` before the file extension.

### Year Extraction

Years (1900-2099) are extracted from filenames when surrounded by separators:

```
Show.Name.2019.S01E01.mkv
          ^^^^
          year
```

## Movie Filename Parsing

The movie parser (`services/movie_matcher.py`) extracts title, year, quality, source, edition, and release group.

### TV Rejection

Before parsing as a movie, the parser checks for TV episode patterns. If any are found, the file is rejected (returns `None`):

- `S##E##` patterns
- `##x##` patterns
- `Season # Episode #` patterns

This ensures TV episodes aren't incorrectly processed as movies.

### Title Extraction

The movie title is extracted differently depending on whether a year is found:

**With year:**
```
The.Thing.1982.1080p.BluRay.mkv
^^^^^^^^^
  title (everything before year)
```

**Without year:**
```
Inception.1080p.BluRay.mkv
^^^^^^^^^
  title (everything before first quality/source indicator)
```

**AKA stripping:** Alternate titles are removed before further processing. Everything from "A.K.A." or "AKA" onward is stripped, preserving the primary title. Example:
```
The.Secret.Agent.A.K.A.O.Agente.Secreto.2025.720p.mkv
^^^^^^^^^^^^^^^^^^                        ^^^^
     title                                year (extracted from full filename)
```

### Edition Detection

Editions are detected from the filename using these patterns:

| Pattern | Matches |
|---------|---------|
| `{edition-...}` | Plex-style edition tag |
| `Director's Cut`, `Directors Cut` | Director's Cut |
| `Extended`, `Extended Edition`, `Extended Cut` | Extended |
| `Unrated`, `Unrated Edition`, `Unrated Cut` | Unrated |
| `Theatrical`, `Theatrical Edition`, `Theatrical Cut` | Theatrical |
| `Ultimate`, `Ultimate Edition`, `Ultimate Cut` | Ultimate |
| `Special Edition` | Special Edition |
| `Remastered` | Remastered |
| `IMAX`, `IMAX Edition` | IMAX |
| `Criterion`, `Criterion Collection` | Criterion |

### Parsed Output

```
The.Thing.1982.Directors.Cut.1080p.AMZN.WEB-DL.DDP2.0.H.265-GRiMM.mkv

ParsedMovie:
  title: "The Thing"
  year: 1982
  quality: "1080p"
  source: "AMZN"
  edition: "Director's Cut"
  release_group: "GRiMM"
```

## Matching Algorithms

### Show Name Matching

Matching a parsed show name to a show in the library uses a tiered scoring system:

| Tier | Condition | Score |
|------|-----------|-------|
| Exact | Normalized names are identical | 1.0 |
| Contains (long) | One name contains the other and overlap >= 50% of longer name | 0.9 |
| Contains (short) | One name contains the other but overlap < 50% | 0.6 |
| Word-based | Jaccard similarity of word sets | 0.0 - 1.0 |

**Normalization**: Lowercase, replace `&` with `and`, remove special characters, collapse whitespace.

**Minimum threshold**: 0.7 (matches below this are rejected).

**Alias support**: Each show's aliases are also checked. The highest score across the name and all aliases is used.

### Movie Title Matching

Similar to show matching, with an additional year component:

| Tier | Condition | Score |
|------|-----------|-------|
| Exact | Normalized titles are identical | 1.0 |
| Contains (long) | Overlap >= 50% of longer title | 0.9 |
| Contains (short) | Overlap < 50% | 0.6 |
| Word-based | Jaccard similarity of word sets | 0.0 - 1.0 |

**Year adjustment**:
- Years match: +0.1 bonus.
- Years differ: -0.3 penalty.
- Scores are clamped to 0.0 - 1.0.

**Minimum threshold**: 0.7.

### Managed Import Scoring

During Managed Import (library folder discovery), folder names are matched to TMDB/TVDB search results using:

- Title similarity score (same algorithm as above).
- Year bonus: +0.1 if folder year matches result year.
- Year penalty: -0.3 if years differ.
- Minimum score: 0.5 (lower than normal matching, since folder names are usually accurate).
- Existing shows in search results are skipped during scoring.
