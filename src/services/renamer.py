"""File renaming service."""

import os
import shutil
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Optional

from sqlalchemy.orm import Session

from ..config import settings
from ..models import Show, Episode, PendingAction
from .file_utils import sanitize_filename, move_accompanying_files


@dataclass
class RenameResult:
    """Result of a rename operation."""

    success: bool
    source_path: str
    dest_path: str
    error: Optional[str] = None


class RenamerService:
    """Service for renaming and moving TV show files."""

    def __init__(self, db: Session):
        self.db = db
        self.subtitle_extensions = set(settings.subtitle_extensions)
        self.image_extensions = set(settings.image_extensions)
        self.metadata_extensions = set(settings.metadata_extensions)

    def _move_accompanying_files(self, source: Path, dest: Path):
        """Move accompanying subtitle, metadata, and image files."""
        move_accompanying_files(
            source, dest,
            self.subtitle_extensions,
            self.metadata_extensions,
            self.image_extensions,
        )

    def generate_episode_filename(
        self, show: Show, episode: Episode, extension: str
    ) -> str:
        """Generate the proper filename for an episode."""
        safe_title = sanitize_filename(episode.title)

        filename = show.episode_format.format(
            season=episode.season,
            episode=episode.episode,
            title=safe_title,
        )

        return filename + extension

    def generate_multi_episode_filename(
        self, show: Show, episodes: list[Episode], extension: str
    ) -> str:
        """Generate a filename for a multi-episode file.

        Produces e.g. '6x15-6x16 - Title A + Title B.mkv' by building the
        primary episode code, appending '-NxNN' suffixes for each additional
        episode, and joining all titles with ' + '.
        """
        eps = sorted(episodes, key=lambda e: (e.season, e.episode))
        primary = eps[0]

        # Build the episode number portion: "6x15-6x16"
        fmt = show.episode_format  # e.g. "{season}x{episode:02d} - {title}"
        primary_code = fmt.format(
            season=primary.season,
            episode=primary.episode,
            title="",
        )
        # Strip the separator and empty title to get just the episode code
        # e.g. "6x15 - " -> "6x15"
        primary_code = primary_code.rstrip(" -–")

        suffixes = []
        for ep in eps[1:]:
            ep_code = fmt.format(season=ep.season, episode=ep.episode, title="")
            ep_code = ep_code.rstrip(" -–")
            suffixes.append(ep_code)

        episode_code = "-".join([primary_code] + suffixes)

        # Build the combined title
        titles = [sanitize_filename(ep.title) for ep in eps]
        combined_title = " + ".join(titles)

        # Reconstruct: find separator between episode code and title in format
        # by rendering with a sentinel title
        sentinel = "\x00TITLE\x00"
        rendered = fmt.format(
            season=primary.season,
            episode=primary.episode,
            title=sentinel,
        )
        if sentinel in rendered:
            separator = rendered.split(primary_code)[1].split(sentinel)[0] if primary_code in rendered else " - "
        else:
            separator = " - "

        filename = episode_code + separator + combined_title
        return filename + extension

    def generate_episode_path(
        self, show: Show, episode: Episode, extension: str
    ) -> str:
        """Generate the full path for an episode file."""
        if not show.folder_path:
            raise ValueError(f"Show {show.name} has no folder path configured")

        # Season folder
        season_folder = show.season_format.format(season=episode.season)

        # Episode filename
        filename = self.generate_episode_filename(show, episode, extension)

        return str(Path(show.folder_path) / season_folder / filename)

    def generate_multi_episode_path(
        self, show: Show, episodes: list[Episode], extension: str
    ) -> str:
        """Generate the full path for a multi-episode file."""
        if not show.folder_path:
            raise ValueError(f"Show {show.name} has no folder path configured")

        primary = min(episodes, key=lambda e: (e.season, e.episode))
        season_folder = show.season_format.format(season=primary.season)
        filename = self.generate_multi_episode_filename(show, episodes, extension)

        return str(Path(show.folder_path) / season_folder / filename)

    def preview_rename(self, action: PendingAction) -> dict:
        """Preview what a rename action would do."""
        return {
            "action_id": action.id,
            "action_type": action.action_type,
            "source_path": action.source_path,
            "dest_path": action.dest_path,
            "source_exists": Path(action.source_path).exists() if action.source_path else False,
            "dest_exists": Path(action.dest_path).exists() if action.dest_path else False,
        }

    def execute_action(self, action: PendingAction, dry_run: bool = False) -> RenameResult:
        """Execute a pending action."""
        source = Path(action.source_path)
        dest = Path(action.dest_path) if action.dest_path else None

        # Validate source exists
        if not source.exists():
            return RenameResult(
                success=False,
                source_path=action.source_path,
                dest_path=action.dest_path or "",
                error="Source file does not exist",
            )

        if dry_run:
            return RenameResult(
                success=True,
                source_path=action.source_path,
                dest_path=action.dest_path or "",
            )

        try:
            if action.action_type == "move":
                result = self._move_file(source, dest)
            elif action.action_type == "rename":
                result = self._rename_file(source, dest)
            elif action.action_type == "copy":
                result = self._copy_file(source, dest)
            elif action.action_type == "delete":
                result = self._delete_file(source)
            else:
                return RenameResult(
                    success=False,
                    source_path=action.source_path,
                    dest_path=action.dest_path or "",
                    error=f"Unknown action type: {action.action_type}",
                )

            if result.success:
                # Update action status
                action.status = "completed"
                action.completed_at = datetime.utcnow()

                # Update episode file_path if applicable
                if action.episode_id and dest:
                    episode = self.db.query(Episode).get(action.episode_id)
                    if episode:
                        episode.file_path = str(dest)
                        episode.file_status = "renamed"

                self.db.commit()

            return result

        except Exception as e:
            action.status = "failed"
            action.error_message = str(e)
            self.db.commit()

            return RenameResult(
                success=False,
                source_path=action.source_path,
                dest_path=action.dest_path or "",
                error=str(e),
            )

    def _move_file(self, source: Path, dest: Path) -> RenameResult:
        """Move a file to a new location."""
        # Create destination directory if needed
        dest.parent.mkdir(parents=True, exist_ok=True)

        # Move the main file
        shutil.move(str(source), str(dest))

        # Move accompanying files (subtitles, nfo, etc.)
        move_accompanying_files(
            source, dest,
            self.subtitle_extensions,
            self.metadata_extensions,
            self.image_extensions,
        )

        return RenameResult(
            success=True,
            source_path=str(source),
            dest_path=str(dest),
        )

    def _rename_file(self, source: Path, dest: Path) -> RenameResult:
        """Rename a file (same as move but typically in same directory)."""
        return self._move_file(source, dest)

    def _copy_file(self, source: Path, dest: Path) -> RenameResult:
        """Copy a file to a new location."""
        # Create destination directory if needed
        dest.parent.mkdir(parents=True, exist_ok=True)

        # Copy the main file
        shutil.copy2(str(source), str(dest))

        return RenameResult(
            success=True,
            source_path=str(source),
            dest_path=str(dest),
        )

    def _delete_file(self, source: Path) -> RenameResult:
        """Delete a file."""
        source.unlink()

        return RenameResult(
            success=True,
            source_path=str(source),
            dest_path="",
        )

    def approve_action(self, action_id: int) -> Optional[RenameResult]:
        """Approve and execute a pending action."""
        action = self.db.query(PendingAction).get(action_id)
        if not action:
            return None

        if action.status != "pending":
            return RenameResult(
                success=False,
                source_path=action.source_path,
                dest_path=action.dest_path or "",
                error=f"Action is not pending (status: {action.status})",
            )

        action.status = "approved"
        self.db.commit()

        return self.execute_action(action)

    def reject_action(self, action_id: int) -> bool:
        """Reject a pending action."""
        action = self.db.query(PendingAction).get(action_id)
        if not action:
            return False

        action.status = "rejected"
        self.db.commit()

        return True

    def approve_all_pending(self) -> list[RenameResult]:
        """Approve and execute all pending actions."""
        actions = (
            self.db.query(PendingAction)
            .filter(PendingAction.status == "pending")
            .all()
        )

        results = []
        for action in actions:
            action.status = "approved"
            self.db.commit()
            result = self.execute_action(action)
            results.append(result)

        return results

    def get_pending_actions(self) -> list[PendingAction]:
        """Get all pending actions."""
        return (
            self.db.query(PendingAction)
            .filter(PendingAction.status == "pending")
            .all()
        )
