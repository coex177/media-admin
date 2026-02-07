"""Shared file utility functions and constants."""

import shutil
from pathlib import Path

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

        for lang in LANGUAGE_CODES:
            sub_source = source_dir / f"{source_stem}.{lang}{ext}"
            if sub_source.exists():
                sub_dest = dest_dir / f"{dest_stem}.{lang}{ext}"
                shutil.move(str(sub_source), str(sub_dest))

    for ext in metadata_extensions:
        meta_source = source_dir / f"{source_stem}{ext}"
        if meta_source.exists():
            meta_dest = dest_dir / f"{dest_stem}{ext}"
            shutil.move(str(meta_source), str(meta_dest))

    for ext in image_extensions:
        img_source = source_dir / f"{source_stem}{ext}"
        if img_source.exists():
            img_dest = dest_dir / f"{dest_stem}{ext}"
            shutil.move(str(img_source), str(img_dest))
