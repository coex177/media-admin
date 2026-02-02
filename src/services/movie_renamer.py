"""Movie file renaming service."""

import os
import shutil
from dataclasses import dataclass
from pathlib import Path
from typing import Optional

from sqlalchemy.orm import Session

from ..config import settings
from ..models import Movie


@dataclass
class MovieRenameResult:
    """Result of a movie rename operation."""

    success: bool
    source_path: str
    dest_path: str
    error: Optional[str] = None


class MovieRenamerService:
    """Service for renaming and moving movie files."""

    def __init__(self, db: Session):
        self.db = db
        self.subtitle_extensions = set(settings.subtitle_extensions)
        self.image_extensions = set(settings.image_extensions)
        self.metadata_extensions = set(settings.metadata_extensions)

    def generate_movie_filename(self, movie: Movie, extension: str, movie_format: str = None) -> str:
        """Generate the proper filename for a movie.

        Default format: {title} ({year})
        Edition support: {title} ({year}) {edition}
        """
        if not movie_format:
            movie_format = "{title} ({year})"

        safe_title = self.sanitize_filename(movie.title)
        year_str = str(movie.year) if movie.year else "Unknown"

        filename = movie_format.format(
            title=safe_title,
            year=year_str,
        )

        # Append edition if present
        if movie.edition:
            safe_edition = self.sanitize_filename(movie.edition)
            filename += f" {{{safe_edition}}}"

        return filename + extension

    def generate_movie_path(
        self,
        movie: Movie,
        library_folder: str,
        extension: str,
        movie_format: str = None,
    ) -> str:
        """Generate the full path for a movie file.

        The format string supports `/` to create folder structure:
            - "{title} ({year})/{title} ({year})" → Title (2024)/Title (2024).mkv
            - "{year}/{title} ({year})"            → 2024/Title (2024).mkv
            - "{title} ({year})"                   → Title (2024).mkv  (flat)
        """
        if not movie_format:
            movie_format = "{title} ({year})/{title} ({year})"

        safe_title = self.sanitize_filename(movie.title)
        year_str = str(movie.year) if movie.year else "Unknown"

        # Apply substitutions on the full format string (including /)
        formatted = movie_format.replace("{title}", safe_title).replace("{year}", year_str)

        # Handle {edition} in the format
        if "{edition}" in formatted:
            edition_str = self.sanitize_filename(movie.edition) if movie.edition else ""
            formatted = formatted.replace("{edition}", edition_str)
            # Clean up double spaces if edition was empty
            formatted = " ".join(formatted.split())

        # Split on / to get path segments
        segments = [s.strip() for s in formatted.split("/") if s.strip()]

        if not segments:
            segments = [safe_title]

        # Last segment is the filename
        filename = segments[-1]
        dir_segments = segments[:-1]

        # Auto-append edition to filename if {edition} was NOT in the original format
        if "{edition}" not in (movie_format or "") and movie.edition:
            safe_edition = self.sanitize_filename(movie.edition)
            filename += f" {{{safe_edition}}}"

        filename += extension

        # Build full path
        result = Path(library_folder)
        for seg in dir_segments:
            result = result / seg
        result = result / filename

        return str(result)

    def sanitize_filename(self, name: str) -> str:
        """Remove or replace invalid characters from a filename."""
        # Replace colon with dash (common convention)
        name = name.replace(":", " -")
        # Remove other invalid chars
        invalid_chars = '<>"/\\|?*'
        for char in invalid_chars:
            name = name.replace(char, "")
        # Collapse multiple spaces
        name = " ".join(name.split())
        return name.strip()

    def move_movie_file(self, source: str, dest: str) -> MovieRenameResult:
        """Move a movie file to a new location, including companion files."""
        source_path = Path(source)
        dest_path = Path(dest)

        if not source_path.exists():
            return MovieRenameResult(
                success=False,
                source_path=source,
                dest_path=dest,
                error="Source file does not exist",
            )

        try:
            # Create destination directory
            dest_path.parent.mkdir(parents=True, exist_ok=True)

            # Move the main file
            shutil.move(str(source_path), str(dest_path))

            # Move accompanying files
            self._move_accompanying_files(source_path, dest_path)

            return MovieRenameResult(
                success=True,
                source_path=source,
                dest_path=dest,
            )

        except Exception as e:
            return MovieRenameResult(
                success=False,
                source_path=source,
                dest_path=dest,
                error=str(e),
            )

    def _move_accompanying_files(self, source: Path, dest: Path):
        """Move accompanying files (subtitles, nfo, images) along with the main file."""
        source_stem = source.stem
        source_dir = source.parent
        dest_stem = dest.stem
        dest_dir = dest.parent

        for ext in self.subtitle_extensions:
            sub_source = source_dir / f"{source_stem}{ext}"
            if sub_source.exists():
                sub_dest = dest_dir / f"{dest_stem}{ext}"
                shutil.move(str(sub_source), str(sub_dest))

            # Language-coded subtitles
            for lang in ["en", "eng", "es", "spa", "fr", "fra", "de", "deu"]:
                sub_source = source_dir / f"{source_stem}.{lang}{ext}"
                if sub_source.exists():
                    sub_dest = dest_dir / f"{dest_stem}.{lang}{ext}"
                    shutil.move(str(sub_source), str(sub_dest))

        for ext in self.metadata_extensions:
            meta_source = source_dir / f"{source_stem}{ext}"
            if meta_source.exists():
                meta_dest = dest_dir / f"{dest_stem}{ext}"
                shutil.move(str(meta_source), str(meta_dest))

        for ext in self.image_extensions:
            img_source = source_dir / f"{source_stem}{ext}"
            if img_source.exists():
                img_dest = dest_dir / f"{dest_stem}{ext}"
                shutil.move(str(img_source), str(img_dest))

    def compute_movie_rename_preview(self, movie: Movie, movie_format: str = None) -> Optional[dict]:
        """Compute rename preview for a single movie.

        Returns a dict with current_path/expected_path if a rename is needed, or None.
        """
        if not movie.file_path or not movie.folder_path:
            return None

        current_path = Path(movie.file_path)
        if not current_path.exists():
            return None

        extension = current_path.suffix
        expected_path_str = self.generate_movie_path(
            movie, movie.folder_path, extension, movie_format
        )
        expected_path = Path(expected_path_str)

        if str(current_path) == str(expected_path):
            return None

        return {
            "movie_id": movie.id,
            "movie_title": movie.title,
            "year": movie.year,
            "current_path": str(current_path),
            "current_filename": current_path.name,
            "expected_path": str(expected_path),
            "expected_filename": expected_path.name,
        }
