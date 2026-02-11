"""Movie filename pattern matching service."""

import re
from dataclasses import dataclass
from pathlib import Path
from typing import Optional

from .file_utils import QUALITY_PATTERNS, SOURCE_PATTERNS


@dataclass
class ParsedMovie:
    """Parsed movie information from a filename."""

    title: Optional[str] = None
    year: Optional[int] = None
    quality: Optional[str] = None       # 2160p, 1080p, 720p, etc.
    source: Optional[str] = None        # WEB-DL, BluRay, etc.
    release_group: Optional[str] = None
    edition: Optional[str] = None       # Director's Cut, Extended, etc.


class MovieMatcherService:
    """Service for parsing movie information from filenames."""

    QUALITY_PATTERNS = QUALITY_PATTERNS
    SOURCE_PATTERNS = SOURCE_PATTERNS

    # Release group pattern (usually at the end, after a dash)
    RELEASE_GROUP_PATTERN = r"-([A-Za-z0-9]+)(?:\.[a-z]{3,4})?$"

    # Year pattern
    YEAR_PATTERN = r"(?:^|[.\s_\-\[(])((19|20)\d{2})(?:[.\s_\-\])]|$)"

    # Edition patterns
    EDITION_PATTERNS = [
        r"\{edition-([^}]+)\}",                          # Plex {edition-Directors Cut}
        r"(?:Director'?s?\s*Cut)",
        r"(?:Extended\s*(?:Edition|Cut)?)",
        r"(?:Unrated(?:\s*(?:Edition|Cut))?)",
        r"(?:Theatrical(?:\s*(?:Edition|Cut))?)",
        r"(?:Ultimate\s*(?:Edition|Cut)?)",
        r"(?:Special\s*Edition)",
        r"(?:Remastered)",
        r"(?:IMAX(?:\s*Edition)?)",
        r"(?:Criterion(?:\s*Collection)?)",
    ]

    # SxE patterns that indicate TV content (used to reject non-movies)
    TV_EPISODE_PATTERNS = [
        r"[Ss]\d{1,2}[Ee]\d{1,3}",
        r"\d{1,2}[xX]\d{1,3}",
        r"[Ss]eason\s*\d+\s*[Ee]pisode\s*\d+",
    ]

    def __init__(self):
        self._tv_patterns = [re.compile(p) for p in self.TV_EPISODE_PATTERNS]

    def is_likely_tv(self, filename: str) -> bool:
        """Check if a filename looks like a TV episode (has SxE pattern)."""
        name = Path(filename).stem
        for pattern in self._tv_patterns:
            if pattern.search(name):
                return True
        return False

    def parse_filename(self, filename: str) -> Optional[ParsedMovie]:
        """Parse a filename to extract movie information.

        Returns None if the filename looks like a TV episode.
        """
        name = Path(filename).stem

        # Reject if it looks like a TV episode
        if self.is_likely_tv(filename):
            return None

        year = self._extract_year(name)
        title = self._extract_title(name, year)

        if not title:
            return None

        return ParsedMovie(
            title=title,
            year=year,
            quality=self._extract_quality(name),
            source=self._extract_source(name),
            release_group=self._extract_release_group(name),
            edition=self._extract_edition(name),
        )

    def _extract_title(self, filename: str, year: Optional[int]) -> Optional[str]:
        """Extract the movie title from the filename."""
        name = filename

        # If we found a year, title is everything before it
        if year:
            # Find the year position
            match = re.search(
                rf"(?:^|[.\s_\-\[(]){year}(?:[.\s_\-\])]|$)", name
            )
            if match:
                title_part = name[:match.start()].strip()
            else:
                title_part = name
        else:
            # No year found — try to find title before quality/source indicators
            # Cut at the first quality/source indicator
            cut_point = len(name)
            for pattern in self.QUALITY_PATTERNS + self.SOURCE_PATTERNS:
                m = re.search(pattern, name, re.IGNORECASE)
                if m and m.start() < cut_point:
                    cut_point = m.start()
            title_part = name[:cut_point].strip()

        # Clean up common separators
        title = re.sub(r"[._]", " ", title_part)
        title = re.sub(r"\s+", " ", title)

        # Strip AKA (also known as) and everything after it
        title = re.sub(r"\s*\bA\s*K\s*A\b.*$", "", title, flags=re.IGNORECASE)

        # Remove trailing separators and whitespace
        title = title.strip(" -")

        # Remove Plex edition tags from title
        title = re.sub(r"\s*\{edition-[^}]+\}\s*", " ", title).strip()

        return title.strip() if title.strip() else None

    def _extract_year(self, filename: str) -> Optional[int]:
        """Extract year from filename."""
        match = re.search(self.YEAR_PATTERN, filename)
        if match:
            year = int(match.group(1))
            # Sanity check: must be a plausible movie year
            if 1900 <= year <= 2099:
                return year
        return None

    def _extract_quality(self, filename: str) -> Optional[str]:
        """Extract video quality from filename."""
        for pattern in self.QUALITY_PATTERNS:
            match = re.search(pattern, filename, re.IGNORECASE)
            if match:
                return match.group(1).upper()
        return None

    def _extract_source(self, filename: str) -> Optional[str]:
        """Extract video source from filename."""
        for pattern in self.SOURCE_PATTERNS:
            match = re.search(pattern, filename, re.IGNORECASE)
            if match:
                return match.group(1).upper()
        return None

    def _extract_release_group(self, filename: str) -> Optional[str]:
        """Extract release group from filename."""
        match = re.search(self.RELEASE_GROUP_PATTERN, filename)
        if match:
            return match.group(1)
        return None

    def _extract_edition(self, filename: str) -> Optional[str]:
        """Extract edition info from filename."""
        # Check Plex {edition-...} tag first
        plex_match = re.search(r"\{edition-([^}]+)\}", filename, re.IGNORECASE)
        if plex_match:
            return plex_match.group(1).strip()

        # Check other edition patterns
        for pattern in self.EDITION_PATTERNS[1:]:  # Skip the Plex pattern
            match = re.search(pattern, filename, re.IGNORECASE)
            if match:
                return match.group(0).strip()

        return None

    def normalize_title(self, name: str) -> str:
        """Normalize a movie title for comparison."""
        normalized = name.lower()
        normalized = normalized.replace("&", "and")
        normalized = re.sub(r"[^a-z0-9\s]", "", normalized)
        normalized = re.sub(r"\s+", " ", normalized)
        return normalized.strip()

    def match_movie_title(
        self,
        filename_title: str,
        movie_title: str,
        year: Optional[int] = None,
        movie_year: Optional[int] = None,
    ) -> float:
        """Calculate similarity between filename title and movie title.

        Returns a score from 0.0 to 1.0, with year match bonus.
        """
        norm_filename = self.normalize_title(filename_title)
        norm_movie = self.normalize_title(movie_title)

        if not norm_filename or not norm_movie:
            return 0.0

        # Exact match
        if norm_filename == norm_movie:
            score = 1.0
        else:
            # Check if one contains the other
            shorter = norm_filename if len(norm_filename) <= len(norm_movie) else norm_movie
            longer = norm_movie if len(norm_filename) <= len(norm_movie) else norm_filename
            if len(shorter) >= 4 and shorter in longer:
                if len(shorter) / len(longer) >= 0.5:
                    score = 0.9
                else:
                    score = 0.6
            else:
                # Word-based matching
                filename_words = set(norm_filename.split())
                movie_words = set(norm_movie.split())
                if not filename_words or not movie_words:
                    return 0.0
                common_words = filename_words & movie_words
                total_words = filename_words | movie_words
                score = len(common_words) / len(total_words)

        # Year match bonus/penalty
        if year and movie_year:
            if year == movie_year:
                score = min(score + 0.1, 1.0)
            else:
                score = max(score - 0.3, 0.0)

        return score

    def find_best_movie_match(
        self,
        filename_title: str,
        year: Optional[int],
        movies: list[dict],
    ) -> Optional[tuple[dict, float]]:
        """Find the best matching movie from a list.

        Each movie dict should have 'id', 'title', and optionally 'year'.
        Returns (movie_dict, score) or None if no good match.
        """
        best_match = None
        best_score = 0.0

        for movie in movies:
            score = self.match_movie_title(
                filename_title,
                movie.get("title", ""),
                year,
                movie.get("year"),
            )
            if score > best_score:
                best_score = score
                best_match = movie

        if best_match and best_score >= 0.7:
            return (best_match, best_score)

        return None
