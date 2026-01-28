"""File system scanner service."""

import os
import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Optional

from sqlalchemy.orm import Session

from ..config import settings
from ..models import Show, Episode, ScanFolder, PendingAction
from .matcher import MatcherService, ParsedEpisode


@dataclass
class ScanResult:
    """Result of a scan operation."""

    shows_found: int = 0
    episodes_matched: int = 0
    episodes_missing: int = 0
    unmatched_files: list[str] = field(default_factory=list)
    errors: list[str] = field(default_factory=list)
    pending_actions: list[dict] = field(default_factory=list)


@dataclass
class FileInfo:
    """Information about a video file."""

    path: str
    filename: str
    size: int
    extension: str
    parsed: Optional[ParsedEpisode] = None


class ScannerService:
    """Service for scanning file system for TV shows."""

    def __init__(self, db: Session):
        self.db = db
        self.matcher = MatcherService()
        self.video_extensions = set(settings.video_extensions)

    def is_video_file(self, path: Path) -> bool:
        """Check if a file is a video file."""
        return path.suffix.lower() in self.video_extensions

    def scan_folder(self, folder_path: str) -> list[FileInfo]:
        """Scan a folder for video files."""
        files = []
        folder = Path(folder_path)

        if not folder.exists():
            return files

        for item in folder.rglob("*"):
            if item.is_file() and self.is_video_file(item):
                parsed = self.matcher.parse_filename(item.name)
                files.append(
                    FileInfo(
                        path=str(item),
                        filename=item.name,
                        size=item.stat().st_size,
                        extension=item.suffix,
                        parsed=parsed,
                    )
                )

        return files

    def find_show_folder(self, show: Show) -> Optional[str]:
        """Find a matching folder for a show in library folders."""
        # Get all library folders
        folders = (
            self.db.query(ScanFolder)
            .filter(ScanFolder.folder_type == "library", ScanFolder.enabled == True)
            .all()
        )

        show_name_normalized = self.matcher.normalize_show_name(show.name)

        for folder in folders:
            folder_path = Path(folder.path)
            if not folder_path.exists():
                continue

            # Look for subfolders that match the show name
            try:
                for subfolder in folder_path.iterdir():
                    if not subfolder.is_dir():
                        continue

                    # Normalize folder name for comparison
                    folder_name = subfolder.name
                    # Remove year suffix like "(2021)" or "2021"
                    folder_name_clean = re.sub(r'\s*\(?\d{4}\)?\s*$', '', folder_name)
                    folder_name_normalized = self.matcher.normalize_show_name(folder_name_clean)

                    # Check for match
                    if folder_name_normalized == show_name_normalized:
                        return str(subfolder)

                    # Also check similarity score for close matches
                    score = self.matcher.match_show_name(folder_name_clean, show.name)
                    if score >= 0.85:
                        return str(subfolder)
            except PermissionError:
                continue

        return None

    def auto_match_show_folder(self, show: Show) -> bool:
        """Auto-detect and set folder path for a show."""
        if show.folder_path:
            # Already has a folder path
            return True

        folder_path = self.find_show_folder(show)
        if folder_path:
            show.folder_path = folder_path
            self.db.commit()
            return True

        return False

    def scan_library(self, quick_scan: bool = False, progress_callback=None) -> ScanResult:
        """Scan library folders and match files to episodes.

        Args:
            quick_scan: If True, only scan ongoing shows (not Canceled/Ended).
                       If False, scan all shows.
            progress_callback: Optional callback function(message, progress_percent) for status updates.
        """
        result = ScanResult()

        def report_progress(message, percent):
            if progress_callback:
                progress_callback(message, percent)

        report_progress("Initializing scan...", 0)

        # Get all library folders
        library_folders = (
            self.db.query(ScanFolder)
            .filter(ScanFolder.folder_type == "library", ScanFolder.enabled == True)
            .all()
        )

        # Get shows based on scan type
        if quick_scan:
            # Only ongoing shows (not Canceled or Ended)
            shows = (
                self.db.query(Show)
                .filter(~Show.status.in_(["Canceled", "Ended"]))
                .all()
            )
        else:
            # All shows
            shows = self.db.query(Show).all()

        total_shows = len(shows)
        report_progress(f"Found {total_shows} shows to scan", 5)

        # Auto-match folders for shows without folder_path
        for show in shows:
            if not show.folder_path:
                self.auto_match_show_folder(show)

        # Refresh shows list after potential folder updates
        if quick_scan:
            shows = (
                self.db.query(Show)
                .filter(~Show.status.in_(["Canceled", "Ended"]))
                .all()
            )
        else:
            shows = self.db.query(Show).all()

        # Scan each show's folder
        for i, show in enumerate(shows):
            progress_percent = 10 + int((i / max(total_shows, 1)) * 70)  # 10-80%
            report_progress(f"Scanning: {show.name}", progress_percent)

            if show.folder_path:
                files = self.scan_folder(show.folder_path)
                for file_info in files:
                    if file_info.parsed:
                        matched_count = self._match_file_to_show(file_info, [show])
                        if matched_count > 0:
                            result.episodes_matched += matched_count
                        else:
                            result.unmatched_files.append(file_info.path)
                    else:
                        result.unmatched_files.append(file_info.path)

        # Count missing episodes
        report_progress("Counting missing episodes...", 82)
        for show in shows:
            if show.do_missing:
                missing = self._count_missing_episodes(show)
                result.episodes_missing += missing

        # Scan download folders for pending actions
        report_progress("Scanning downloads folder...", 85)
        download_result = self._scan_download_folders(shows, progress_callback)
        result.pending_actions.extend(download_result.pending_actions)

        report_progress("Finalizing...", 98)
        result.shows_found = len(shows)
        return result

    def _scan_download_folders(self, shows: list[Show], progress_callback=None) -> ScanResult:
        """Scan download folders and create pending actions for matching files."""
        result = ScanResult()

        def report_progress(message, percent):
            if progress_callback:
                progress_callback(message, percent)

        # Get all download folders
        folders = (
            self.db.query(ScanFolder)
            .filter(ScanFolder.folder_type == "download", ScanFolder.enabled == True)
            .all()
        )

        total_folders = len(folders)
        for i, folder in enumerate(folders):
            # Calculate progress within downloads phase (85-95%)
            folder_name = Path(folder.path).name
            progress_percent = 85 + int((i / max(total_folders, 1)) * 10)
            report_progress(f"Scanning downloads: {folder_name}", progress_percent)

            files = self.scan_folder(folder.path)

            for file_info in files:
                if file_info.parsed and file_info.parsed.title:
                    # Try to match to a show
                    match = self.matcher.find_best_show_match(
                        file_info.parsed.title,
                        [{"id": s.id, "name": s.name} for s in shows],
                    )

                    if match:
                        show_info, score = match
                        show = next((s for s in shows if s.id == show_info["id"]), None)
                        if not show:
                            continue

                        # Find the episode
                        episode = (
                            self.db.query(Episode)
                            .filter(
                                Episode.show_id == show.id,
                                Episode.season == file_info.parsed.season,
                                Episode.episode == file_info.parsed.episode,
                            )
                            .first()
                        )

                        if episode and show.folder_path:
                            # Check if action already exists
                            existing = (
                                self.db.query(PendingAction)
                                .filter(PendingAction.source_path == file_info.path)
                                .first()
                            )
                            if not existing:
                                # Create pending action
                                dest_path = self._generate_destination_path(
                                    show, episode, file_info
                                )
                                action = self._create_pending_action(
                                    file_info, show, episode, dest_path
                                )
                                result.pending_actions.append(action.to_dict())
                                result.episodes_matched += 1
                        else:
                            result.unmatched_files.append(file_info.path)
                    else:
                        result.unmatched_files.append(file_info.path)
                else:
                    result.unmatched_files.append(file_info.path)

        return result

    def _match_file_to_show(
        self, file_info: FileInfo, shows: list[Show]
    ) -> int:
        """Try to match a file to a show and episode(s).

        Returns the number of episodes matched (handles multi-episode files).
        """
        if not file_info.parsed:
            return 0

        # Determine episode range (for multi-episode files like 1x23-1x24)
        start_episode = file_info.parsed.episode
        end_episode = file_info.parsed.episode_end or file_info.parsed.episode

        # First, try to match by folder structure
        file_path = Path(file_info.path)

        for show in shows:
            if not show.folder_path:
                continue

            show_folder = Path(show.folder_path)
            if str(show_folder) in str(file_path):
                # File is in show folder - mark all episodes in range
                matched_count = self._mark_episodes_found(
                    show.id,
                    file_info.parsed.season,
                    start_episode,
                    end_episode,
                    file_info.path
                )
                if matched_count > 0:
                    return matched_count

        # Try to match by show name in filename
        if file_info.parsed.title:
            for show in shows:
                score = self.matcher.match_show_name(file_info.parsed.title, show.name)
                if score >= 0.7:
                    matched_count = self._mark_episodes_found(
                        show.id,
                        file_info.parsed.season,
                        start_episode,
                        end_episode,
                        file_info.path
                    )
                    if matched_count > 0:
                        return matched_count

        return 0

    def _mark_episodes_found(
        self,
        show_id: int,
        season: int,
        start_episode: int,
        end_episode: int,
        file_path: str
    ) -> int:
        """Mark one or more episodes as found with the given file path.

        Returns the number of episodes marked as found.
        """
        from datetime import datetime

        matched_count = 0

        for ep_num in range(start_episode, end_episode + 1):
            episode = (
                self.db.query(Episode)
                .filter(
                    Episode.show_id == show_id,
                    Episode.season == season,
                    Episode.episode == ep_num,
                )
                .first()
            )

            if episode:
                # Only set matched_at if this is a new match
                was_missing = episode.file_status == "missing"
                episode.file_path = file_path
                episode.file_status = "found"
                if was_missing:
                    episode.matched_at = datetime.utcnow()
                matched_count += 1

        if matched_count > 0:
            self.db.commit()

        return matched_count

    def _count_missing_episodes(self, show: Show) -> int:
        """Count missing episodes for a show."""
        from datetime import datetime

        missing = (
            self.db.query(Episode)
            .filter(
                Episode.show_id == show.id,
                Episode.file_status == "missing",
            )
            .all()
        )

        # Only count episodes that have aired
        count = 0
        today = datetime.utcnow().strftime("%Y-%m-%d")
        for ep in missing:
            if ep.air_date and ep.air_date <= today:
                count += 1

        return count

    def scan_downloads(self) -> ScanResult:
        """Scan download folders for new files to process.

        Note: This is now a convenience method. The main scan_library()
        method includes download scanning automatically.
        """
        shows = self.db.query(Show).all()
        return self._scan_download_folders(shows)

    def _generate_destination_path(
        self, show: Show, episode: Episode, file_info: FileInfo
    ) -> str:
        """Generate the destination path for a file."""
        # Build season folder
        season_folder = show.season_format.format(season=episode.season)

        # Build episode filename
        safe_title = self._sanitize_filename(episode.title)
        episode_name = show.episode_format.format(
            season=episode.season,
            episode=episode.episode,
            title=safe_title,
        )

        # Add extension
        episode_name += file_info.extension

        return str(Path(show.folder_path) / season_folder / episode_name)

    def _sanitize_filename(self, name: str) -> str:
        """Remove invalid characters from a filename."""
        # Characters not allowed in filenames
        invalid_chars = '<>:"/\\|?*'
        for char in invalid_chars:
            name = name.replace(char, "")
        return name.strip()

    def _create_pending_action(
        self,
        file_info: FileInfo,
        show: Show,
        episode: Episode,
        dest_path: str,
    ) -> PendingAction:
        """Create a pending action for a file."""
        # Check if action already exists
        existing = (
            self.db.query(PendingAction)
            .filter(
                PendingAction.source_path == file_info.path,
                PendingAction.status == "pending",
            )
            .first()
        )

        if existing:
            return existing

        action = PendingAction(
            action_type="move",
            source_path=file_info.path,
            dest_path=dest_path,
            show_id=show.id,
            episode_id=episode.id,
            status="pending",
        )

        self.db.add(action)
        self.db.commit()
        self.db.refresh(action)

        return action

    def get_show_files(self, show: Show) -> list[FileInfo]:
        """Get all video files for a show."""
        if not show.folder_path:
            return []

        return self.scan_folder(show.folder_path)

    def detect_show_from_folder(self, folder_path: str) -> Optional[str]:
        """Try to detect show name from folder structure."""
        folder = Path(folder_path)

        # The folder name is usually the show name
        folder_name = folder.name

        # Clean up common patterns
        import re

        # Remove year
        name = re.sub(r"\s*\(?(19|20)\d{2}\)?", "", folder_name)
        # Remove quality indicators
        name = re.sub(r"\s*(720p|1080p|2160p|4K|HDTV|WEB-DL|BluRay)", "", name, flags=re.IGNORECASE)

        return name.strip() if name.strip() else None
