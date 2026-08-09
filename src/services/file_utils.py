"""Shared file utility functions and constants."""

import logging
import re
import shutil
from pathlib import Path
from typing import Optional

logger = logging.getLogger(__name__)

# Language codes for subtitle/companion file detection
LANGUAGE_CODES = [
    "en", "eng", "es", "spa", "fr", "fra", "de", "deu",
    "ja", "jpn", "pt", "por", "it", "ita", "ko", "kor", "zh", "zho",
]

# Quality patterns (shared between TV and movie matchers)
QUALITY_PATTERNS = [
    r"(2160[pi]|4[Kk])",
    r"(1080[pi])",
    r"(720[pi])",
    r"(480[pi])",
    r"(HDTV|WEB-?DL|WEB-?Rip|BluRay|BDRip|DVDRip|PDTV)",
]

# Source patterns (shared between TV and movie matchers)
SOURCE_PATTERNS = [
    r"(AMZN|ATVP|NF|DSNP|HMAX|PCOK|PMTP)",  # Streaming services
    r"(WEB|HDTV|BluRay|DVD)",
]

# Release group pattern (usually at the end, after a dash)
RELEASE_GROUP_PATTERN = r"-([A-Za-z0-9]+)(?:\.[a-z]{3,4})?$"

# Filenames Plex silently refuses to scan. A correct metadata title can collide
# with either rule and hide a file from the library forever, with no error
# anywhere — e.g. Mrs. Fletcher "1x02 - Free Sample.mkv" (sample rule) and
# Truth Be Told "2x07 - Lanterman-Petris-Short.mkv" (local-extras rule).
PLEX_EXTRA_SUFFIXES = (
    "behindthescenes", "deleted", "featurette",
    "interview", "scene", "short", "trailer", "other",
)
_PLEX_EXTRA_RE = re.compile(
    r"-(" + "|".join(PLEX_EXTRA_SUFFIXES) + r")$", re.IGNORECASE
)
# Plex treats 'sample' as a whole word; 'Samples' / 'Sampler' are fine.
_PLEX_SAMPLE_RE = re.compile(r"(?:^|[^a-z0-9])sample(?:[^a-z0-9]|$)", re.IGNORECASE)


def plex_safe_stem(stem: str, fallback: Optional[str] = None) -> str:
    """Keep a filename stem out of Plex's skip rules.

    A trailing extras suffix is de-hyphenated ('Petris-Short' -> 'Petris Short'),
    which keeps every word and satisfies Plex. A 'sample' token can't be reworded
    without lying about the title, so fall back to the bare episode code when the
    caller supplies one — Plex shows the real title from metadata regardless.

    ponytail: no config knob, these two rules are Plex's and don't vary per user.
    """
    stem = _PLEX_EXTRA_RE.sub(r" \1", stem)
    if fallback and _PLEX_SAMPLE_RE.search(stem):
        return fallback
    return stem


def make_plex_readable(path):
    """Grant group/other read so Plex — which runs as a different user — can scan the file.

    shutil.move/copy2 preserve the source mode, so a file that arrives in a drop
    folder as 0600 lands in the library as 0600 and Plex skips it silently: no
    error, no log, just permanently absent from the library.

    ponytail: OR the bits in, never assign a mode — a 0600 source becomes 0664
    like the rest of the library and nothing already granted is taken away.
    """
    path = Path(path)
    try:
        path.chmod(path.stat().st_mode | 0o064)
    except OSError as e:
        # Don't fail an otherwise-good import; a warning is what was missing before.
        logger.warning(f"Could not make {path} readable by Plex: {e}")


def extract_quality(filename: str) -> Optional[str]:
    """Extract video quality from a filename (shared by TV and movie matchers)."""
    for pattern in QUALITY_PATTERNS:
        match = re.search(pattern, filename, re.IGNORECASE)
        if match:
            return match.group(1).upper()
    return None


def extract_source(filename: str) -> Optional[str]:
    """Extract video source from a filename (shared by TV and movie matchers)."""
    for pattern in SOURCE_PATTERNS:
        match = re.search(pattern, filename, re.IGNORECASE)
        if match:
            return match.group(1).upper()
    return None


def extract_release_group(filename: str) -> Optional[str]:
    """Extract release group from a filename (shared by TV and movie matchers)."""
    match = re.search(RELEASE_GROUP_PATTERN, filename)
    if match:
        return match.group(1)
    return None


def sanitize_filename(name: str, replace_colon: bool = False) -> str:
    """Remove invalid characters from a filename.

    Args:
        name: The filename to sanitize.
        replace_colon: If True, replace ':' with ' -' instead of removing it.
    """
    if replace_colon:
        name = name.replace(":", " -")
        invalid_chars = '<>"/\\|?*'
    else:
        invalid_chars = '<>:"/\\|?*'
    for char in invalid_chars:
        name = name.replace(char, "")
    name = " ".join(name.split())
    return name.strip()


def move_accompanying_files(
    source: Path,
    dest: Path,
    subtitle_extensions: set,
    metadata_extensions: set,
    image_extensions: set,
):
    """Move accompanying files (subtitles, nfo, images) along with the main file."""
    source_stem = source.stem
    source_dir = source.parent
    dest_stem = dest.stem
    dest_dir = dest.parent

    for ext in subtitle_extensions:
        sub_source = source_dir / f"{source_stem}{ext}"
        if sub_source.exists():
            sub_dest = dest_dir / f"{dest_stem}{ext}"
            shutil.move(str(sub_source), str(sub_dest))
            make_plex_readable(sub_dest)

        for lang in LANGUAGE_CODES:
            sub_source = source_dir / f"{source_stem}.{lang}{ext}"
            if sub_source.exists():
                sub_dest = dest_dir / f"{dest_stem}.{lang}{ext}"
                shutil.move(str(sub_source), str(sub_dest))
                make_plex_readable(sub_dest)

    for ext in metadata_extensions:
        meta_source = source_dir / f"{source_stem}{ext}"
        if meta_source.exists():
            meta_dest = dest_dir / f"{dest_stem}{ext}"
            shutil.move(str(meta_source), str(meta_dest))
            make_plex_readable(meta_dest)

    for ext in image_extensions:
        img_source = source_dir / f"{source_stem}{ext}"
        if img_source.exists():
            img_dest = dest_dir / f"{dest_stem}{ext}"
            shutil.move(str(img_source), str(img_dest))
            make_plex_readable(img_dest)
