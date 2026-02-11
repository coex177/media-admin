"""Filename pattern matching service."""

import re
from dataclasses import dataclass
from pathlib import Path
from typing import Optional

from .file_utils import QUALITY_PATTERNS, SOURCE_PATTERNS


@dataclass
class ParsedEpisode:
    """Parsed episode information from a filename."""

    season: int
    episode: int
    episode_end: Optional[int] = None  # For multi-episode files
    title: Optional[str] = None
    quality: Optional[str] = None
    source: Optional[str] = None
    release_group: Optional[str] = None
    year: Optional[int] = None


class MatcherService:
    """Service for parsing episode information from filenames."""

    # Patterns for episode detection (ordered by specificity)
    EPISODE_PATTERNS = [
        # S01E01E02 or S01E01-E02 or S01E01-02 (multi-episode with S##E## format)
        r"[Ss](\d{1,2})[Ee](\d{1,3})(?:[Ee-](?:[Ee])?(\d{1,3}))?",
        # 1x01-1x02 (multi-episode with full season prefix)
        r"(\d{1,2})[xX](\d{1,3})-\d{1,2}[xX](\d{1,3})",
        # 1x01-02 (multi-episode without repeating season)
        r"(\d{1,2})[xX](\d{1,3})-(\d{1,3})",
        # 1x01 (single episode)
        r"(\d{1,2})[xX](\d{1,3})",
        # Season 1 Episode 1
        r"[Ss]eason\s*(\d{1,2})\s*[Ee]pisode\s*(\d{1,3})",
        # s01.e01 or s01_e01
        r"[Ss](\d{1,2})[\._][Ee](\d{1,3})",
        # 101, 102 (3 digit, first digit is season) - be careful with this one
        r"(?:^|[^0-9])(\d)(\d{2})(?:[^0-9]|$)",
    ]

    QUALITY_PATTERNS = QUALITY_PATTERNS
    SOURCE_PATTERNS = SOURCE_PATTERNS

    # Release group pattern (usually at the end, after a dash)
    RELEASE_GROUP_PATTERN = r"-([A-Za-z0-9]+)(?:\.[a-z]{3,4})?$"

    # Codec patterns that look like episode numbers (e.g. x264, x265, h264, h265, H.265)
    CODEC_FALSE_POSITIVE = re.compile(r"[xXhH]\.?(\d{3})(?:[^0-9]|$)")

    # Resolution patterns that look like episode numbers (e.g. 720p, 480i)
    RESOLUTION_FALSE_POSITIVE = re.compile(r"(\d{3,4})[pPiI]")

    # Year pattern
    YEAR_PATTERN = r"(?:^|[.\s_\-\[])((19|20)\d{2})(?:[.\s_\-\]]|$)"

    def __init__(self):
        self._compiled_patterns = [
            re.compile(p) for p in self.EPISODE_PATTERNS
        ]

    def parse_filename(self, filename: str) -> Optional[ParsedEpisode]:
        """Parse a filename to extract episode information."""
        # Get just the filename without extension
        name = Path(filename).stem

        # Try each pattern
        for pattern in self._compiled_patterns:
            match = pattern.search(name)
            if match:
                # Reject codec false positives (x264, x265, h264, h265)
                match_str = name[max(0, match.start() - 1):match.end()]
                if self.CODEC_FALSE_POSITIVE.search(match_str):
                    continue

                # Reject resolution false positives (720p, 480i, etc.)
                match_plus = name[match.start():match.end() + 1] if match.end() < len(name) else name[match.start():match.end()]
                if self.RESOLUTION_FALSE_POSITIVE.search(match_plus):
                    continue

                groups = match.groups()
                season = int(groups[0])
                episode = int(groups[1])
                episode_end = int(groups[2]) if len(groups) > 2 and groups[2] else None

                return ParsedEpisode(
                    season=season,
                    episode=episode,
                    episode_end=episode_end,
                    title=self._extract_title(name, match),
                    quality=self._extract_quality(name),
                    source=self._extract_source(name),
                    release_group=self._extract_release_group(name),
                    year=self._extract_year(name),
                )

        return None

    def _extract_title(self, filename: str, episode_match: re.Match) -> Optional[str]:
        """Extract the show title from the filename."""
        # Get everything before the episode info
        title_part = filename[: episode_match.start()].strip()

        # Clean up common separators
        title = re.sub(r"[._]", " ", title_part)
        title = re.sub(r"\s+", " ", title)

        # Strip AKA (also known as) and everything after it
        title = re.sub(r"\s*\bA\s*K\s*A\b.*$", "", title, flags=re.IGNORECASE)

        # Remove year if present at the end of title
        title = re.sub(r"\s*\(?(19|20)\d{2}\)?\s*$", "", title)

        return title.strip() if title.strip() else None

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

    def _extract_year(self, filename: str) -> Optional[int]:
        """Extract year from filename."""
        match = re.search(self.YEAR_PATTERN, filename)
        if match:
            return int(match.group(1))
        return None

    def normalize_show_name(self, name: str) -> str:
        """Normalize a show name for comparison."""
        # Lowercase
        normalized = name.lower()
        # Treat & and "and" as equivalent
        normalized = normalized.replace("&", "and")
        # Remove special characters
        normalized = re.sub(r"[^a-z0-9\s]", "", normalized)
        # Collapse whitespace
        normalized = re.sub(r"\s+", " ", normalized)
        return normalized.strip()

    def match_show_name(self, filename_title: str, show_name: str) -> float:
        """Calculate similarity between filename title and show name."""
        norm_filename = self.normalize_show_name(filename_title)
        norm_show = self.normalize_show_name(show_name)

        if not norm_filename or not norm_show:
            return 0.0

        # Exact match
        if norm_filename == norm_show:
            return 1.0

        # Check if one contains the other as a significant substring
        # Require the shorter string to be at least 4 chars and at least 50% of the longer
        # Must match at word boundaries to avoid e.g. "Cross" matching "Crossbones"
        shorter = norm_filename if len(norm_filename) <= len(norm_show) else norm_show
        longer = norm_show if len(norm_filename) <= len(norm_show) else norm_filename
        if len(shorter) >= 4 and re.search(r'\b' + re.escape(shorter) + r'\b', longer):
            # Ensure it's a significant match (at least 50% of the longer string)
            if len(shorter) / len(longer) >= 0.5:
                return 0.9

        # Word-based matching
        filename_words = set(norm_filename.split())
        show_words = set(norm_show.split())

        if not filename_words or not show_words:
            return 0.0

        common_words = filename_words & show_words
        total_words = filename_words | show_words

        return len(common_words) / len(total_words)

    def find_best_show_match(
        self, filename_title: str, shows: list[dict]
    ) -> Optional[tuple[dict, float]]:
        """Find the best matching show from a list."""
        best_match = None
        best_score = 0.0

        for show in shows:
            score = self.match_show_name(filename_title, show.get("name", ""))
            for alias in show.get("aliases", []):
                alias_score = self.match_show_name(filename_title, alias)
                if alias_score > score:
                    score = alias_score
            if score > best_score:
                best_score = score
                best_match = show

        if best_match and best_score >= 0.7:
            return (best_match, best_score)

        return None
