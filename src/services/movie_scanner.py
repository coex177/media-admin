"""Movie library scanner service."""

import json
import logging
import os
import re
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path
from typing import Optional

from sqlalchemy.orm import Session

from ..config import settings
from ..models import Movie, AppSettings, ScanFolder
from .movie_matcher import MovieMatcherService, ParsedMovie

# Scanner logger
_log_dir = Path(__file__).resolve().parent.parent.parent / "data"
os.makedirs(_log_dir, exist_ok=True)

logger = logging.getLogger("movie_scanner")
logger.setLevel(logging.INFO)
logger.propagate = False

if not logger.handlers:
    _fh = logging.FileHandler(str(_log_dir / "movie_scanner.log"))
    _fh.setLevel(logging.INFO)
    _fh.setFormatter(logging.Formatter(
        "%(asctime)s %(levelname)-5s %(message)s", datefmt="%Y-%m-%d %H:%M:%S"
    ))
    logger.addHandler(_fh)


@dataclass
class MovieScanResult:
    """Result of a movie scan operation."""

    movies_matched: int = 0
    movies_missing: int = 0
    unmatched_files: list[str] = field(default_factory=list)
    errors: list[str] = field(default_factory=list)
    rename_previews: list[dict] = field(default_factory=list)


@dataclass
class MovieFileInfo:
    """Information about a movie video file."""

    path: str
    filename: str
    size: int
    extension: str
    parsed: Optional[ParsedMovie] = None


class MovieScannerService:
    """Service for scanning file system for movies."""

    def __init__(self, db: Session):
        self.db = db
        self.matcher = MovieMatcherService()
        self.video_extensions = set(settings.video_extensions)

    def _get_setting(self, key: str, default: str = "") -> str:
        setting = self.db.query(AppSettings).filter(AppSettings.key == key).first()
        return setting.value if setting else default

    def is_video_file(self, path: Path) -> bool:
        """Check if a file is a video file."""
        return path.suffix.lower() in self.video_extensions

    def scan_movie_folder(self, folder_path: str) -> list[MovieFileInfo]:
        """Scan a folder for movie video files."""
        files = []
        folder = Path(folder_path)

        if not folder.exists():
            logger.debug(f"  scan_movie_folder: path does not exist: {folder_path}")
            return files

        logger.debug(f"  scan_movie_folder: walking {folder_path}")
        for item in folder.rglob("*"):
            if item.is_file() and self.is_video_file(item):
                parsed = self.matcher.parse_filename(item.name)
                files.append(
                    MovieFileInfo(
                        path=str(item),
                        filename=item.name,
                        size=item.stat().st_size,
                        extension=item.suffix,
                        parsed=parsed,
                    )
                )

        logger.debug(f"  scan_movie_folder: found {len(files)} video files")
        return files

    def scan_movie_library(self, progress_callback=None) -> MovieScanResult:
        """Scan movie library folders and match files to movies in the DB."""
        result = MovieScanResult()

        def report_progress(message, percent):
            if progress_callback:
                progress_callback(message, percent)

        report_progress("Initializing movie scan...", 0)

        # Get all movie library folders
        library_folders = (
            self.db.query(ScanFolder)
            .filter(ScanFolder.folder_type == "movie_library", ScanFolder.enabled == True)
            .all()
        )

        # Get all movies
        movies = self.db.query(Movie).all()
        total_movies = len(movies)
        report_progress(f"Found {total_movies} movies to scan", 5)
        logger.info(f"scan_movie_library: {total_movies} movies, {len(library_folders)} library folders")

        # Auto-match folders for movies without folder_path
        for movie in movies:
            if not movie.folder_path and library_folders:
                self._auto_match_movie_folder(movie, library_folders)

        # Refresh movies list
        movies = self.db.query(Movie).all()

        # Scan each movie's folder
        for i, movie in enumerate(movies):
            progress_percent = 10 + int((i / max(total_movies, 1)) * 70)
            report_progress(f"Scanning: {movie.title}", progress_percent)

            if movie.file_path and Path(movie.file_path).exists():
                # File already tracked and exists
                if movie.file_status == "missing":
                    movie.file_status = "found"
                    movie.matched_at = datetime.utcnow()
                    self.db.commit()
                result.movies_matched += 1
                continue

            # Try to find the file
            found = False
            if movie.folder_path:
                found = self._scan_for_movie_file(movie)
                if found:
                    result.movies_matched += 1
                    continue

            # Try scanning library folders
            for folder in library_folders:
                found = self._search_library_for_movie(movie, folder.path)
                if found:
                    result.movies_matched += 1
                    break

            if not found:
                result.movies_missing += 1

        # Compute rename previews
        report_progress("Computing rename previews...", 85)
        movie_format = self._get_setting("movie_format", "{title} ({year})/{title} ({year})")
        result.rename_previews = self.compute_movie_rename_previews(movie_format)

        report_progress("Complete", 100)
        logger.info(f"scan_movie_library complete: {result.movies_matched} matched, "
                     f"{result.movies_missing} missing, {len(result.rename_previews)} rename previews")
        return result

    def scan_single_movie(self, movie: Movie, progress_callback=None) -> MovieScanResult:
        """Scan for a single movie's file."""
        result = MovieScanResult()

        def report(msg, pct):
            if progress_callback:
                progress_callback(msg, pct)

        logger.info(f"scan_single_movie: '{movie.title}' (id={movie.id})")

        # Get library folders
        library_folders = (
            self.db.query(ScanFolder)
            .filter(ScanFolder.folder_type == "movie_library", ScanFolder.enabled == True)
            .all()
        )

        # Auto-match folder if needed
        if not movie.folder_path and library_folders:
            report(f"Finding folder for: {movie.title}", 10)
            self._auto_match_movie_folder(movie, library_folders)

        # Check existing file
        if movie.file_path and Path(movie.file_path).exists():
            if movie.file_status == "missing":
                movie.file_status = "found"
                movie.matched_at = datetime.utcnow()
                self.db.commit()
            result.movies_matched = 1
            report("Complete", 100)
            return result

        # Try scanning movie's folder
        report(f"Scanning: {movie.title}", 30)
        found = False
        if movie.folder_path:
            found = self._scan_for_movie_file(movie)

        # Try library folders
        if not found:
            report("Searching library folders...", 60)
            for folder in library_folders:
                found = self._search_library_for_movie(movie, folder.path)
                if found:
                    break

        if found:
            result.movies_matched = 1
        else:
            result.movies_missing = 1

        report("Complete", 100)
        return result

    def _auto_match_movie_folder(self, movie: Movie, library_folders: list):
        """Try to auto-detect a folder for a movie in library folders."""
        safe_title = self._sanitize_folder_name(movie.title)
        year_str = str(movie.year) if movie.year else None

        for folder_entry in library_folders:
            folder_path = Path(folder_entry.path)
            if not folder_path.exists():
                continue

            # Try direct path lookups
            # Individual: /library/Title (Year)/
            if year_str:
                candidate = folder_path / f"{safe_title} ({year_str})"
                if candidate.is_dir():
                    movie.folder_path = str(folder_path)
                    self.db.commit()
                    logger.info(f"  auto_match_movie: found folder for '{movie.title}': {candidate}")
                    return

            # Year-based: /library/Year/
            if year_str:
                candidate = folder_path / year_str
                if candidate.is_dir():
                    movie.folder_path = str(folder_path)
                    self.db.commit()
                    logger.info(f"  auto_match_movie: found year folder for '{movie.title}': {candidate}")
                    return

            # Default: use first available library folder
            movie.folder_path = str(folder_path)
            self.db.commit()

    def _scan_for_movie_file(self, movie: Movie) -> bool:
        """Scan a movie's folder_path for matching video files."""
        if not movie.folder_path:
            return False

        folder = Path(movie.folder_path)
        if not folder.is_dir():
            return False

        safe_title = self._sanitize_folder_name(movie.title)
        year_str = str(movie.year) if movie.year else None

        # Look for files in various locations (most specific first)
        search_dirs = []

        if year_str:
            # Check individual movie folder first (most specific)
            individual_folder = folder / f"{safe_title} ({year_str})"
            if individual_folder.is_dir():
                search_dirs.append(individual_folder)

            # Check year-based folder next
            year_folder = folder / year_str
            if year_folder.is_dir():
                search_dirs.append(year_folder)

        # Base folder last (broadest search)
        search_dirs.append(folder)

        best_score = 0.0
        best_item = None
        best_parsed = None

        for search_dir in search_dirs:
            for item in search_dir.iterdir():
                if not item.is_file() or not self.is_video_file(item):
                    continue

                parsed = self.matcher.parse_filename(item.name)
                if not parsed or not parsed.title:
                    continue

                score = self.matcher.match_movie_title(
                    parsed.title, movie.title, parsed.year, movie.year
                )
                if score > best_score:
                    best_score = score
                    best_item = item
                    best_parsed = parsed
                    # Perfect score — no need to keep looking
                    if score >= 1.0:
                        break

            # If we found a perfect match in this dir, stop searching
            if best_score >= 1.0:
                break

            # Also check subdirectories (one level deep)
            for subdir in search_dir.iterdir():
                if not subdir.is_dir():
                    continue
                for item in subdir.iterdir():
                    if not item.is_file() or not self.is_video_file(item):
                        continue

                    parsed = self.matcher.parse_filename(item.name)
                    if not parsed or not parsed.title:
                        continue

                    score = self.matcher.match_movie_title(
                        parsed.title, movie.title, parsed.year, movie.year
                    )
                    if score > best_score:
                        best_score = score
                        best_item = item
                        best_parsed = parsed
                        if score >= 1.0:
                            break
                if best_score >= 1.0:
                    break

            if best_score >= 1.0:
                break

        if best_item and best_score >= 0.7:
            movie.file_path = str(best_item)
            movie.file_status = "found"
            movie.matched_at = datetime.utcnow()
            if best_parsed.edition and not movie.edition:
                movie.edition = best_parsed.edition
            self.db.commit()
            logger.info(f"  _scan_for_movie_file: matched '{best_item.name}' → '{movie.title}' (score={best_score:.2f})")
            return True

        return False

    def _search_library_for_movie(self, movie: Movie, library_path: str) -> bool:
        """Search a library folder path for a movie file by walking subdirectories."""
        folder = Path(library_path)
        if not folder.is_dir():
            return False

        safe_title = self._sanitize_folder_name(movie.title)
        year_str = str(movie.year) if movie.year else None

        # Check specific expected folder names first
        if year_str:
            # Try individual folder
            candidate = folder / f"{safe_title} ({year_str})"
            if candidate.is_dir():
                for item in candidate.iterdir():
                    if item.is_file() and self.is_video_file(item):
                        movie.file_path = str(item)
                        movie.file_status = "found"
                        movie.matched_at = datetime.utcnow()
                        self.db.commit()
                        logger.info(f"  _search_library: found '{movie.title}' at {item}")
                        return True

            # Try year folder — use best match in case multiple similar titles exist
            year_folder = folder / year_str
            if year_folder.is_dir():
                best_score = 0.0
                best_item = None
                for item in year_folder.iterdir():
                    if not item.is_file() or not self.is_video_file(item):
                        continue
                    parsed = self.matcher.parse_filename(item.name)
                    if parsed and parsed.title:
                        score = self.matcher.match_movie_title(
                            parsed.title, movie.title, parsed.year, movie.year
                        )
                        if score > best_score:
                            best_score = score
                            best_item = item
                if best_item and best_score >= 0.7:
                    movie.file_path = str(best_item)
                    movie.file_status = "found"
                    movie.matched_at = datetime.utcnow()
                    self.db.commit()
                    logger.info(f"  _search_library: found '{movie.title}' in year folder at {best_item} (score={best_score:.2f})")
                    return True

        return False

    def discover_movie_folder(self, folder_path: str, tmdb_service=None, event_loop=None, progress_callback=None) -> list[dict]:
        """Discover movies from a folder (scan for files and look up on TMDB).

        Returns list of dicts with movie info ready to be added to DB.
        """
        discovered = []
        folder = Path(folder_path)
        if not folder.is_dir():
            return discovered

        files = self.scan_movie_folder(folder_path)
        total = len(files)

        for i, file_info in enumerate(files):
            if progress_callback:
                progress_callback(f"Processing: {file_info.filename}", int((i / max(total, 1)) * 100))

            if not file_info.parsed or not file_info.parsed.title:
                continue

            # Check if already in DB by file path
            existing = self.db.query(Movie).filter(Movie.file_path == file_info.path).first()
            if existing:
                continue

            discovered.append({
                "filename": file_info.filename,
                "path": file_info.path,
                "parsed_title": file_info.parsed.title,
                "parsed_year": file_info.parsed.year,
                "quality": file_info.parsed.quality,
                "edition": file_info.parsed.edition,
                "size": file_info.size,
            })

        return discovered

    def compute_movie_rename_previews(self, movie_format: str = None) -> list[dict]:
        """Compute file rename previews for all movies with do_rename enabled."""
        from .movie_renamer import MovieRenamerService

        renamer = MovieRenamerService(self.db)
        previews = []

        movies = (
            self.db.query(Movie)
            .filter(
                Movie.do_rename == True,
                Movie.file_path.isnot(None),
                Movie.file_status.in_(["found", "renamed"]),
            )
            .all()
        )

        for movie in movies:
            preview = renamer.compute_movie_rename_preview(movie, movie_format)
            if preview:
                previews.append(preview)

        return previews

    def _sanitize_folder_name(self, name: str) -> str:
        """Sanitize a name for use as a folder name."""
        name = name.replace(":", " -")
        invalid_chars = '<>"/\\|?*'
        for char in invalid_chars:
            name = name.replace(char, "")
        name = " ".join(name.split())
        return name.strip()
