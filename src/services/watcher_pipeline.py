"""Watcher pipeline: detect → parse → match → rename → safe-copy → update DB."""

import asyncio
import json
import logging
import os
import shutil
from datetime import datetime
from pathlib import Path
from typing import Optional

from sqlalchemy.orm import Session

from ..config import settings, TVDB_API_KEY_DEFAULT
from ..models import Show, Episode, Movie, AppSettings, ScanFolder, WatcherLog
from .matcher import MatcherService
from .movie_matcher import MovieMatcherService
from .quality import QualityService
from .tmdb import TMDBService
from .tvdb import TVDBService
from .file_utils import sanitize_filename, LANGUAGE_CODES

logger = logging.getLogger(__name__)

# Temp extension used during safe copy
TEMP_EXTENSION = ".madmintmp"


class WatcherPipeline:
    """Processes stable video files detected by the watcher.

    Pipeline flow:
        1. Parse filename → extract show name, season, episode
        2. Match show name against DB shows (score >= 0.7)
        3a. Show found, episode missing → rename per user prefs, safe-copy to library, update DB
        3b. Show found, episode exists → move to Issues as "duplicate_episode"
        3c. Show not found → move to Issues as "show_not_found"

    Safe file operations:
        copy src → dest.madmintmp
        rename dest.madmintmp → dest
        delete src

    Recovery: If source still exists on restart, the pipeline will redo the copy,
    deleting any stale .madmintmp first.
    """

    def __init__(self, db: Session):
        self.db = db
        self.matcher = MatcherService()
        self.movie_matcher = MovieMatcherService()

    # ── Ownership helpers ─────────────────────────────────────────

    def _mkdir_inherit(self, path: Path):
        """Create directory (and parents) with ownership inherited from the
        deepest existing ancestor."""
        existing = path
        to_create = []
        while not existing.exists():
            to_create.append(existing)
            existing = existing.parent

        path.mkdir(parents=True, exist_ok=True)

        try:
            st = existing.stat()
            uid, gid = st.st_uid, st.st_gid
            for d in reversed(to_create):
                os.chown(str(d), uid, gid)
        except OSError:
            pass

    def _chown_inherit(self, file_path: Path):
        """Set file ownership to match its parent directory."""
        try:
            st = file_path.parent.stat()
            os.chown(str(file_path), st.st_uid, st.st_gid)
        except OSError:
            pass

    # ── Settings helpers ────────────────────────────────────────────

    def _get_setting(self, key: str, default: str = "") -> str:
        setting = self.db.query(AppSettings).filter(AppSettings.key == key).first()
        return setting.value if setting else default

    def _get_issues_folder(self) -> str:
        return self._get_setting("watcher_issues_folder", "")

    def _get_issues_organization(self) -> str:
        return self._get_setting("watcher_issues_organization", "date")

    def _get_companion_types(self) -> list[str]:
        raw = self._get_setting(
            "watcher_companion_types",
            json.dumps([".srt", ".sub", ".ass", ".ssa", ".vtt", ".idx", ".sup", ".nfo"]),
        )
        try:
            return json.loads(raw)
        except (json.JSONDecodeError, TypeError):
            return []

    def _should_delete_empty_folders(self) -> bool:
        return self._get_setting("watcher_delete_empty_folders", "false") == "true"

    def _get_quality_priorities(self) -> list[dict]:
        raw = self._get_setting(
            "watcher_quality_priorities",
            json.dumps([
                {"factor": "resolution", "points": 100},
                {"factor": "bitrate", "points": 80},
                {"factor": "video_codec", "points": 60},
                {"factor": "audio_codec", "points": 40},
                {"factor": "audio_channels", "points": 20},
                {"factor": "subtitles", "points": 10},
            ]),
        )
        try:
            return json.loads(raw)
        except (json.JSONDecodeError, TypeError):
            return []

    # ── Auto-import from providers ──────────────────────────────────

    def _auto_import_show(self, show_name: str, year: Optional[int] = None) -> Optional[Show]:
        """Search metadata providers for a show and auto-import it.

        Tries the user's primary provider first, then the secondary.
        Creates the Show + Episode records and a library folder.
        Returns the new Show or None.
        """
        primary_source = self._get_setting("default_metadata_source", "tmdb")
        tmdb_key = self._get_setting("tmdb_api_key", "")
        tvdb_key = self._get_setting("tvdb_api_key", TVDB_API_KEY_DEFAULT)

        providers_to_try = []
        if primary_source == "tvdb" and tvdb_key:
            providers_to_try.append(("tvdb", tvdb_key))
            if tmdb_key:
                providers_to_try.append(("tmdb", tmdb_key))
        else:
            if tmdb_key:
                providers_to_try.append(("tmdb", tmdb_key))
            if tvdb_key:
                providers_to_try.append(("tvdb", tvdb_key))

        if not providers_to_try:
            logger.warning("Pipeline: no API keys configured for auto-import")
            self._log(
                "error",
                result="failed",
                details=f"Auto-import failed for '{show_name}': no API keys configured",
            )
            return None

        for source, api_key in providers_to_try:
            show = self._try_provider_import(show_name, year, source, api_key)
            if show:
                return show

        logger.info(f"Pipeline: no provider match for '{show_name}'")
        self._log(
            "error",
            result="failed",
            details=f"Auto-import: no provider found a match for '{show_name}'",
        )
        return None

    def _try_provider_import(
        self, show_name: str, year: Optional[int], source: str, api_key: str
    ) -> Optional[Show]:
        """Search a single provider and import the show if found."""
        source_label = source.upper()
        logger.info(f"Pipeline: searching {source_label} for '{show_name}'")

        loop = asyncio.new_event_loop()
        try:
            if source == "tmdb":
                return self._import_from_tmdb(loop, show_name, year, api_key)
            else:
                return self._import_from_tvdb(loop, show_name, api_key)
        except Exception as e:
            logger.error(f"Pipeline: {source_label} search failed: {e}", exc_info=True)
            return None
        finally:
            try:
                loop.run_until_complete(loop.shutdown_asyncgens())
            except Exception:
                pass
            loop.close()

    def _import_from_tmdb(
        self, loop: asyncio.AbstractEventLoop, show_name: str, year: Optional[int], api_key: str
    ) -> Optional[Show]:
        """Search TMDB and import the best match."""
        tmdb = TMDBService(api_key=api_key)

        try:
            search_data = loop.run_until_complete(tmdb.search_shows(show_name, year=year))
            results = search_data.get("results", [])

            # Retry without year if no results
            if not results and year:
                search_data = loop.run_until_complete(tmdb.search_shows(show_name))
                results = search_data.get("results", [])

            if not results:
                return None

            # Use fuzzy matching to pick the best result
            best = self._pick_best_search_result(
                show_name, year, results, id_key="id", name_key="name"
            )
            if not best:
                return None

            tmdb_id = best["id"]

            # Check if this TMDB ID already exists in DB
            existing = self.db.query(Show).filter(Show.tmdb_id == tmdb_id).first()
            if existing:
                logger.info(f"Pipeline: TMDB ID {tmdb_id} already in DB as '{existing.name}'")
                return existing

            show_data = loop.run_until_complete(tmdb.get_show_with_episodes(tmdb_id))
            return self._create_show_from_data(show_data, "tmdb")
        finally:
            loop.run_until_complete(tmdb.close())

    def _import_from_tvdb(
        self, loop: asyncio.AbstractEventLoop, show_name: str, api_key: str
    ) -> Optional[Show]:
        """Search TVDB and import the best match."""
        tvdb = TVDBService(api_key=api_key)

        try:
            results = loop.run_until_complete(tvdb.search_shows(show_name))

            if not results:
                return None

            best = self._pick_best_search_result(
                show_name, None, results, id_key="tvdb_id", name_key="name"
            )
            if not best:
                return None

            tvdb_id = best.get("tvdb_id") or best.get("id")
            if not tvdb_id:
                return None

            # Check if this TVDB ID already exists in DB
            existing = self.db.query(Show).filter(Show.tvdb_id == tvdb_id).first()
            if existing:
                logger.info(f"Pipeline: TVDB ID {tvdb_id} already in DB as '{existing.name}'")
                return existing

            show_data = loop.run_until_complete(tvdb.get_show_with_episodes(tvdb_id))
            return self._create_show_from_data(show_data, "tvdb")
        finally:
            loop.run_until_complete(tvdb.close())

    def _pick_best_search_result(
        self,
        show_name: str,
        year: Optional[int],
        results: list[dict],
        id_key: str,
        name_key: str,
    ) -> Optional[dict]:
        """Pick the best search result using fuzzy matching and optional year filter."""
        # Build candidates list for the matcher
        candidates = []
        for r in results[:10]:
            rid = r.get(id_key)
            rname = r.get(name_key, "")
            if rid and rname:
                candidates.append({"id": rid, "name": rname, "_raw": r})

        if not candidates:
            return None

        # If year is known, prefer an exact year match
        if year:
            for c in candidates:
                raw = c["_raw"]
                air_date = raw.get("first_air_date", "")
                if air_date and air_date[:4].isdigit() and int(air_date[:4]) == year:
                    score = self.matcher.match_show_name(show_name, c["name"])
                    if score >= 0.5:
                        return c["_raw"]

        # Fall back to fuzzy match
        match = self.matcher.find_best_show_match(
            show_name, [{"id": c["id"], "name": c["name"]} for c in candidates]
        )
        if match:
            matched_dict, score = match
            if score >= 0.5:
                # Find the original raw result
                for c in candidates:
                    if c["id"] == matched_dict["id"]:
                        return c["_raw"]

        # Last resort: just take the first result if name is reasonably close
        first_score = self.matcher.match_show_name(show_name, candidates[0]["name"])
        if first_score >= 0.4:
            return candidates[0]["_raw"]

        return None

    def _create_show_from_data(self, show_data: dict, metadata_source: str) -> Optional[Show]:
        """Create Show + Episode DB records from provider data, and create the library folder."""
        show_name = show_data.get("name")
        if not show_name:
            return None

        # Find the first enabled library folder to create the show folder in
        library_folder = (
            self.db.query(ScanFolder)
            .filter(ScanFolder.folder_type == "library", ScanFolder.enabled == True)
            .first()
        )
        if not library_folder:
            logger.error("Pipeline: no library folder for auto-import")
            return None

        first_air = show_data.get("first_air_date", "")

        # Check if a folder for this show already exists in any library folder
        from types import SimpleNamespace
        from .scanner import ScannerService
        scanner = ScannerService(self.db)
        temp_show = SimpleNamespace(name=show_name, first_air_date=first_air)
        existing_folder = scanner.find_show_folder(temp_show)

        if existing_folder:
            show_folder = Path(existing_folder)
            logger.info(f"Pipeline: found existing library folder for '{show_name}': {show_folder}")
        else:
            # Create new folder in first library folder
            safe_name = sanitize_filename(show_name)
            if first_air and len(first_air) >= 4 and first_air[:4].isdigit():
                safe_name = f"{safe_name} ({first_air[:4]})"
            show_folder = Path(library_folder.path) / safe_name
            self._mkdir_inherit(show_folder)

        # Get user's default naming formats from settings
        season_fmt = self._get_setting("season_format", "Season {season}")
        episode_fmt = self._get_setting("episode_format", "{season}x{episode:02d} - {title}")

        show = Show(
            tmdb_id=show_data.get("tmdb_id"),
            tvdb_id=show_data.get("tvdb_id"),
            imdb_id=show_data.get("imdb_id"),
            metadata_source=metadata_source,
            name=show_name,
            overview=show_data.get("overview"),
            poster_path=show_data.get("poster_path"),
            backdrop_path=show_data.get("backdrop_path"),
            folder_path=str(show_folder),
            season_format=season_fmt,
            episode_format=episode_fmt,
            status=show_data.get("status", "Unknown"),
            first_air_date=first_air,
            number_of_seasons=show_data.get("number_of_seasons", 0),
            number_of_episodes=show_data.get("number_of_episodes", 0),
            genres=show_data.get("genres"),
            networks=show_data.get("networks"),
            next_episode_air_date=show_data.get("next_episode_air_date"),
        )
        self.db.add(show)
        self.db.commit()
        self.db.refresh(show)

        # Create episode records
        ep_count = 0
        for ep_data in show_data.get("episodes", []):
            episode = Episode(
                show_id=show.id,
                season=ep_data["season"],
                episode=ep_data["episode"],
                title=ep_data.get("title", f"Episode {ep_data['episode']}"),
                overview=ep_data.get("overview"),
                air_date=ep_data.get("air_date"),
                tmdb_id=ep_data.get("tmdb_id"),
                still_path=ep_data.get("still_path"),
                runtime=ep_data.get("runtime"),
            )
            self.db.add(episode)
            ep_count += 1

        self.db.commit()

        self._log(
            "auto_import",
            result="success",
            show_name=show.name,
            show_id=show.id,
            details=(
                f"Auto-imported '{show.name}' from {metadata_source.upper()} "
                f"with {ep_count} episodes. Folder: {show_folder}"
            ),
        )
        logger.info(
            f"Pipeline: auto-imported '{show.name}' ({metadata_source.upper()}) "
            f"with {ep_count} episodes → {show_folder}"
        )

        return show

    # ── Logging helper ──────────────────────────────────────────────

    def _log(
        self,
        action_type: str,
        result: str = "success",
        file_path: str = None,
        show_name: str = None,
        show_id: int = None,
        episode_code: str = None,
        details: str = None,
        movie_id: int = None,
        movie_title: str = None,
        media_type: str = None,
    ):
        entry = WatcherLog(
            action_type=action_type,
            file_path=file_path,
            show_name=show_name,
            show_id=show_id,
            episode_code=episode_code,
            movie_id=movie_id,
            movie_title=movie_title,
            media_type=media_type or ("movie" if movie_id else "tv" if show_id else None),
            result=result,
            details=details,
        )
        self.db.add(entry)
        self.db.commit()

    # ── Scan existing library files after auto-import ──────────────

    def _scan_existing_library_files(self, show: Show, exclude_path: str = None):
        """Scan a show's library folder for existing video files and match them.

        Called after auto-importing a show so that files already in the folder
        are matched against the newly created episode records.
        """
        folder = Path(show.folder_path)
        if not folder.is_dir():
            return

        video_exts = set(settings.video_extensions)
        matched = 0
        scanned = 0

        for video_file in folder.rglob("*"):
            if not video_file.is_file():
                continue
            if video_file.suffix.lower() not in video_exts:
                continue
            if str(video_file) == exclude_path:
                continue
            # Skip temp files
            if video_file.suffix.lower() == TEMP_EXTENSION.lower():
                continue

            scanned += 1
            parsed = self.matcher.parse_filename(video_file.name)
            if not parsed or parsed.season is None or parsed.episode is None:
                continue

            start_ep = parsed.episode
            end_ep = parsed.episode_end or parsed.episode

            # Check if file is in a Specials folder
            season = parsed.season
            for parent in video_file.parents:
                if parent.name.lower() in ("specials", "season 0", "season 00"):
                    season = 0
                    break
                if str(parent) == str(folder):
                    break

            for ep_num in range(start_ep, end_ep + 1):
                episode = (
                    self.db.query(Episode)
                    .filter(
                        Episode.show_id == show.id,
                        Episode.season == season,
                        Episode.episode == ep_num,
                    )
                    .first()
                )
                if episode and episode.file_status == "missing":
                    episode.file_path = str(video_file)
                    episode.file_status = "found"
                    episode.matched_at = datetime.utcnow()
                    matched += 1

        if matched > 0:
            self.db.commit()
            logger.info(
                f"Pipeline: scanned '{show.name}' folder — "
                f"{matched} existing episode(s) matched from {scanned} file(s)"
            )
            self._log(
                "library_scan",
                result="success",
                show_name=show.name,
                show_id=show.id,
                details=(
                    f"Scanned existing library folder: {matched} episode(s) "
                    f"matched from {scanned} file(s) in {show.folder_path}"
                ),
            )
        elif scanned > 0:
            logger.info(
                f"Pipeline: scanned '{show.name}' folder — "
                f"{scanned} file(s) found but no new matches"
            )

    # ── Main entry point ────────────────────────────────────────────

    def process_file(self, file_path: str):
        """Process a single stable video file through the pipeline."""
        path = Path(file_path)
        if not path.exists():
            logger.warning(f"Pipeline: file no longer exists: {file_path}")
            return

        logger.info(f"Pipeline: processing {path.name}")
        self._log("file_detected", file_path=file_path, details=path.name)

        # 1. Parse filename for TV (SxE pattern)
        parsed = self.matcher.parse_filename(path.name)
        if not parsed or not parsed.title:
            # No SxE pattern found — try movie detection
            movie_parsed = self.movie_matcher.parse_filename(path.name)
            if movie_parsed and movie_parsed.title:
                logger.info(f"Pipeline: no SxE pattern, trying movie pipeline for '{movie_parsed.title}'")
                self._process_movie_file(file_path, movie_parsed)
                return

            logger.info(f"Pipeline: could not parse filename: {path.name}")
            self._move_to_issues(file_path, "parse_failed", f"Could not parse: {path.name}")
            return

        filename_show_name = parsed.title
        season = parsed.season
        episode_num = parsed.episode
        episode_end = parsed.episode_end
        episode_code = f"S{season:02d}E{episode_num:02d}"
        if episode_end and episode_end != episode_num:
            episode_code += f"-E{episode_end:02d}"

        logger.info(f"Pipeline: parsed '{filename_show_name}' {episode_code}")

        # 2. Match show in DB
        shows = self.db.query(Show).all()
        show_dicts = [
            {"id": s.id, "name": s.name, "aliases": json.loads(s.aliases) if s.aliases else [],
             "year": int(s.first_air_date[:4]) if s.first_air_date and s.first_air_date[:4].isdigit() else None}
            for s in shows
        ]
        match_result = self.matcher.find_best_show_match(filename_show_name, show_dicts, filename_year=parsed.year)

        if not match_result:
            # Show not found in DB → try auto-import from providers
            logger.info(f"Pipeline: no DB match for '{filename_show_name}', attempting auto-import")
            self._log(
                "match_found",
                result="failed",
                file_path=file_path,
                details=f"No DB match for '{filename_show_name}', trying provider search",
            )

            show = self._auto_import_show(filename_show_name, parsed.year)
            if not show:
                self._move_to_issues(
                    file_path,
                    "show_not_found",
                    f"No match for '{filename_show_name}' in DB or providers",
                )
                return

            # Scan existing files in the library folder before processing the new file
            self._scan_existing_library_files(show, exclude_path=file_path)

            # Re-run from the matched-show point with the newly imported show
            logger.info(f"Pipeline: auto-imported '{show.name}', continuing pipeline")
            match_result = ({"id": show.id, "name": show.name}, 1.0)

        matched_dict, score = match_result
        show = self.db.query(Show).filter(Show.id == matched_dict["id"]).first()
        if not show:
            self._move_to_issues(file_path, "show_not_found", "Show disappeared from DB")
            return

        logger.info(f"Pipeline: matched '{filename_show_name}' → '{show.name}' (score={score:.2f})")
        self._log(
            "match_found",
            result="success",
            file_path=file_path,
            show_name=show.name,
            show_id=show.id,
            episode_code=episode_code,
            details=f"Matched '{filename_show_name}' → '{show.name}' (score={score:.2f})",
        )

        if not show.folder_path:
            self._move_to_issues(
                file_path,
                "show_no_folder",
                f"Show '{show.name}' has no library folder",
                show_name=show.name,
                show_id=show.id,
            )
            return

        # 3. Process each episode in range
        ep_start = episode_num
        ep_end = episode_end if episode_end else episode_num

        for ep_num in range(ep_start, ep_end + 1):
            ep_code = f"S{season:02d}E{ep_num:02d}"

            episode = (
                self.db.query(Episode)
                .filter(
                    Episode.show_id == show.id,
                    Episode.season == season,
                    Episode.episode == ep_num,
                )
                .first()
            )

            if not episode:
                # Episode record doesn't exist in DB — still move to library
                # (the episode might not be in metadata yet)
                logger.info(f"Pipeline: episode {ep_code} not in DB for '{show.name}', moving to library anyway")
                self._move_to_library_no_episode(file_path, show, season, ep_num, path.suffix)
                return

            if episode.file_status != "missing":
                # Episode already has a file — run quality comparison
                self._handle_quality_comparison(
                    file_path, show, episode, ep_code, path.suffix
                )
                return

            # Episode is missing → move to library
            self._move_to_library(file_path, show, episode, path.suffix)
            # For multi-episode files, only move the file once
            return

    # ── Move to library ─────────────────────────────────────────────

    def _move_to_library(self, file_path: str, show: Show, episode: Episode, extension: str):
        """Rename file per user prefs and safe-copy to library."""
        # Build destination path
        season_folder = show.season_format.format(season=episode.season)
        safe_title = sanitize_filename(episode.title or "TBA")
        new_filename = show.episode_format.format(
            season=episode.season,
            episode=episode.episode,
            title=safe_title,
        ) + extension

        dest_dir = Path(show.folder_path) / season_folder
        dest_path = dest_dir / new_filename
        ep_code = f"S{episode.season:02d}E{episode.episode:02d}"

        logger.info(f"Pipeline: moving {Path(file_path).name} → {dest_path}")

        try:
            self._safe_copy(file_path, str(dest_path))

            # Move companion files
            self._move_companions(file_path, str(dest_path))

            # Delete source
            self._safe_delete_source(file_path)

            # Update DB
            episode.file_path = str(dest_path)
            episode.file_status = "found"
            episode.matched_at = datetime.utcnow()
            self.db.commit()

            self._log(
                "moved_to_library",
                result="success",
                file_path=str(dest_path),
                show_name=show.name,
                show_id=show.id,
                episode_code=ep_code,
                details=f"Moved to {dest_path}",
            )
            logger.info(f"Pipeline: successfully moved to library: {dest_path}")

        except Exception as e:
            logger.error(f"Pipeline: failed to move to library: {e}", exc_info=True)
            self._log(
                "error",
                result="failed",
                file_path=file_path,
                show_name=show.name,
                show_id=show.id,
                episode_code=ep_code,
                details=f"Move to library failed: {e}",
            )
            # Try to move to issues instead
            self._move_to_issues(
                file_path,
                "move_failed",
                f"Failed to move to library: {e}",
                show_name=show.name,
                show_id=show.id,
            )

    def _move_to_library_no_episode(
        self, file_path: str, show: Show, season: int, episode_num: int, extension: str
    ):
        """Move file to library when episode record doesn't exist in DB."""
        season_folder = show.season_format.format(season=season)
        new_filename = show.episode_format.format(
            season=season,
            episode=episode_num,
            title="TBA",
        ) + extension

        dest_dir = Path(show.folder_path) / season_folder
        dest_path = dest_dir / new_filename
        ep_code = f"S{season:02d}E{episode_num:02d}"

        logger.info(f"Pipeline: moving {Path(file_path).name} → {dest_path} (no episode record)")

        try:
            self._safe_copy(file_path, str(dest_path))
            self._move_companions(file_path, str(dest_path))
            self._safe_delete_source(file_path)

            self._log(
                "moved_to_library",
                result="success",
                file_path=str(dest_path),
                show_name=show.name,
                show_id=show.id,
                episode_code=ep_code,
                details=f"Moved to {dest_path} (episode not in DB metadata)",
            )
        except Exception as e:
            logger.error(f"Pipeline: failed to move (no episode): {e}", exc_info=True)
            self._move_to_issues(
                file_path,
                "move_failed",
                f"Failed to move: {e}",
                show_name=show.name,
                show_id=show.id,
            )

    # ── Quality comparison ────────────────────────────────────────────

    def _handle_quality_comparison(
        self,
        new_file_path: str,
        show: Show,
        episode: Episode,
        ep_code: str,
        extension: str,
    ):
        """Compare new file quality against the existing episode file.

        - new_better   → move old file to Issues (prefixed with show name),
                         move new file into library
        - existing_better / equal → move new file to Issues
        - ffprobe unavailable or analysis fails → move new file to Issues
          as duplicate (safe fallback)
        """
        existing_path = episode.file_path
        if not existing_path or not Path(existing_path).exists():
            # Existing file is gone — treat as missing, move new file in
            logger.info(
                f"Pipeline: existing file missing for {ep_code}, treating as new"
            )
            self._move_to_library(new_file_path, show, episode, extension)
            return

        # Analyze both files
        if not QualityService.is_available():
            logger.warning("Pipeline: ffprobe unavailable, sending duplicate to Issues")
            self._move_to_issues(
                new_file_path,
                "duplicate_episode",
                f"Duplicate {ep_code} for '{show.name}' (ffprobe unavailable for comparison)",
                show_name=show.name,
                show_id=show.id,
            )
            return

        existing_quality = QualityService.analyze(existing_path)
        new_quality = QualityService.analyze(new_file_path)

        if not existing_quality or not new_quality:
            logger.warning(
                f"Pipeline: quality analysis failed, sending duplicate to Issues"
            )
            detail = "Quality analysis failed: "
            if not existing_quality:
                detail += f"could not probe existing ({existing_path})"
            if not new_quality:
                detail += f"could not probe new ({new_file_path})"
            self._move_to_issues(
                new_file_path,
                "duplicate_episode",
                f"Duplicate {ep_code} for '{show.name}' ({detail})",
                show_name=show.name,
                show_id=show.id,
            )
            return

        priorities = self._get_quality_priorities()
        verdict = QualityService.compare(existing_quality, new_quality, priorities)

        existing_summary = existing_quality.summary()
        new_summary = new_quality.summary()

        logger.info(
            f"Pipeline: quality comparison for {ep_code}: "
            f"existing=[{existing_summary}] vs new=[{new_summary}] → {verdict}"
        )

        if verdict == "new_better":
            self._upgrade_episode(
                new_file_path, show, episode, ep_code, extension,
                existing_path, existing_summary, new_summary,
            )
        else:
            # existing_better or equal → discard new file to Issues
            reason_label = "equal quality" if verdict == "equal" else "lower quality"
            self._log(
                "moved_to_issues",
                result="skipped",
                file_path=new_file_path,
                show_name=show.name,
                show_id=show.id,
                episode_code=ep_code,
                details=(
                    f"Keeping existing ({reason_label}): "
                    f"existing=[{existing_summary}], new=[{new_summary}]"
                ),
            )
            self._move_to_issues(
                new_file_path,
                "duplicate_episode",
                f"{reason_label.capitalize()} duplicate {ep_code} for '{show.name}'",
                show_name=show.name,
                show_id=show.id,
            )

    def _upgrade_episode(
        self,
        new_file_path: str,
        show: Show,
        episode: Episode,
        ep_code: str,
        extension: str,
        old_file_path: str,
        existing_summary: str,
        new_summary: str,
    ):
        """Replace existing episode file with a better-quality new file.

        1. Move old file to Issues (prefixed with show name)
        2. Move new file into library
        3. Update DB
        """
        # Build the library destination for the new file
        season_folder = show.season_format.format(season=episode.season)
        safe_title = sanitize_filename(episode.title or "TBA")
        new_filename = show.episode_format.format(
            season=episode.season,
            episode=episode.episode,
            title=safe_title,
        ) + extension
        dest_dir = Path(show.folder_path) / season_folder
        dest_path = dest_dir / new_filename

        # 1. Move old file to Issues with show-name prefix
        old_path = Path(old_file_path)
        safe_show = sanitize_filename(show.name)
        prefixed_name = f"{safe_show} - {old_path.name}"
        issues_root = self._get_issues_folder()
        organization = self._get_issues_organization()
        issues_dir = self._resolve_issues_dir(issues_root, organization, "quality_replaced")

        try:
            self._mkdir_inherit(issues_dir)
            old_issues_dest = issues_dir / prefixed_name
            # Avoid collision
            if old_issues_dest.exists():
                stem = Path(prefixed_name).stem
                ext = old_path.suffix
                counter = 1
                while old_issues_dest.exists():
                    old_issues_dest = issues_dir / f"{stem} ({counter}){ext}"
                    counter += 1

            self._safe_copy(old_file_path, str(old_issues_dest))
            old_path.unlink()
            logger.info(f"Pipeline: moved replaced file to Issues: {old_issues_dest}")
        except Exception as e:
            logger.error(f"Pipeline: failed to move old file to Issues: {e}", exc_info=True)
            # If we can't move the old file out, abort upgrade to avoid data loss
            self._log(
                "error",
                result="failed",
                file_path=new_file_path,
                show_name=show.name,
                show_id=show.id,
                episode_code=ep_code,
                details=f"Upgrade aborted: couldn't move old file to Issues: {e}",
            )
            self._move_to_issues(
                new_file_path,
                "upgrade_failed",
                f"Upgrade failed for {ep_code}: {e}",
                show_name=show.name,
                show_id=show.id,
            )
            return

        # 2. Move new file into library
        try:
            self._safe_copy(new_file_path, str(dest_path))
            self._move_companions(new_file_path, str(dest_path))
            self._safe_delete_source(new_file_path)

            # 3. Update DB
            episode.file_path = str(dest_path)
            episode.file_status = "found"
            episode.matched_at = datetime.utcnow()
            self.db.commit()

            self._log(
                "moved_to_library",
                result="success",
                file_path=str(dest_path),
                show_name=show.name,
                show_id=show.id,
                episode_code=ep_code,
                details=(
                    f"Upgraded: new=[{new_summary}] replaced existing=[{existing_summary}]. "
                    f"Old file moved to Issues."
                ),
            )
            logger.info(f"Pipeline: upgraded {ep_code} in library: {dest_path}")

        except Exception as e:
            logger.error(f"Pipeline: failed to move new file to library: {e}", exc_info=True)
            self._log(
                "error",
                result="failed",
                file_path=new_file_path,
                show_name=show.name,
                show_id=show.id,
                episode_code=ep_code,
                details=f"Upgrade move failed: {e}",
            )
            self._move_to_issues(
                new_file_path,
                "move_failed",
                f"Failed during upgrade for {ep_code}: {e}",
                show_name=show.name,
                show_id=show.id,
            )

    # ── Move to issues ──────────────────────────────────────────────

    def _move_to_issues(
        self,
        file_path: str,
        reason: str,
        details: str,
        show_name: str = None,
        show_id: int = None,
    ):
        """Move a file to the issues folder."""
        issues_root = self._get_issues_folder()
        if not issues_root:
            logger.error(f"Pipeline: issues folder not configured, cannot move: {file_path}")
            self._log(
                "error",
                result="failed",
                file_path=file_path,
                show_name=show_name,
                show_id=show_id,
                details="Issues folder not configured; file left in place",
            )
            return

        organization = self._get_issues_organization()
        issues_dir = self._resolve_issues_dir(issues_root, organization, reason)

        src = Path(file_path)
        if not src.exists():
            return

        dest = issues_dir / src.name
        # Avoid overwriting — append counter
        if dest.exists():
            stem = src.stem
            ext = src.suffix
            counter = 1
            while dest.exists():
                dest = issues_dir / f"{stem} ({counter}){ext}"
                counter += 1

        try:
            self._mkdir_inherit(issues_dir)
            self._safe_copy(file_path, str(dest))
            self._move_companions(file_path, str(dest))
            self._safe_delete_source(file_path)

            self._log(
                "moved_to_issues",
                result="success",
                file_path=str(dest),
                show_name=show_name,
                show_id=show_id,
                details=f"[{reason}] {details}",
            )
            logger.info(f"Pipeline: moved to issues ({reason}): {dest}")

        except Exception as e:
            logger.error(f"Pipeline: failed to move to issues: {e}", exc_info=True)
            self._log(
                "error",
                result="failed",
                file_path=file_path,
                show_name=show_name,
                show_id=show_id,
                details=f"Move to issues failed: {e}",
            )

    def _resolve_issues_dir(self, issues_root: str, organization: str, reason: str) -> Path:
        """Resolve the target subdirectory inside the issues folder."""
        root = Path(issues_root)
        if organization == "date":
            return root / datetime.utcnow().strftime("%Y-%m-%d")
        elif organization == "reason":
            return root / reason
        else:
            return root  # flat

    # ── Safe file operations ────────────────────────────────────────

    def _safe_copy(self, src: str, dest: str):
        """Safe copy: src → dest.madmintmp → rename to dest.

        If dest.madmintmp already exists (stale from a crash), delete it first.
        Handles: permission errors, disk full, files deleted mid-process.
        """
        src_path = Path(src)
        dest_path = Path(dest)
        temp_path = Path(dest + TEMP_EXTENSION)

        # Verify source still exists
        if not src_path.exists():
            raise FileNotFoundError(f"Source file no longer exists: {src}")

        # Create destination directory (inherit parent ownership)
        try:
            self._mkdir_inherit(dest_path.parent)
        except PermissionError:
            raise PermissionError(f"No write permission for directory: {dest_path.parent}")

        # Remove stale temp file if present
        if temp_path.exists():
            logger.info(f"Pipeline: removing stale temp file: {temp_path}")
            try:
                temp_path.unlink()
            except PermissionError:
                raise PermissionError(f"Cannot remove stale temp file: {temp_path}")

        # Copy to temp
        try:
            shutil.copy2(src, str(temp_path))
        except OSError as e:
            # Clean up partial temp file on failure (e.g. disk full)
            if temp_path.exists():
                try:
                    temp_path.unlink()
                except OSError:
                    pass
            if "No space left" in str(e) or e.errno == 28:
                raise OSError(f"Disk full — cannot copy to {dest_path.parent}")
            raise

        # Rename temp to final and inherit parent ownership
        temp_path.rename(dest_path)
        self._chown_inherit(dest_path)

    def _safe_delete_source(self, file_path: str):
        """Delete the source file, and optionally clean up empty parent dirs."""
        src = Path(file_path)
        if src.exists():
            try:
                src.unlink()
                logger.debug(f"Pipeline: deleted source: {file_path}")
            except PermissionError:
                logger.warning(f"Pipeline: permission denied deleting source: {file_path}")
            except OSError as e:
                logger.warning(f"Pipeline: error deleting source {file_path}: {e}")

        if self._should_delete_empty_folders():
            self._cleanup_empty_parents(src.parent)

    def _cleanup_empty_parents(self, directory: Path):
        """Remove empty parent directories up to (but not including) the TV folder roots."""
        # Get TV folder roots so we don't delete them
        tv_roots = set()
        folders = (
            self.db.query(ScanFolder)
            .filter(ScanFolder.folder_type == "tv", ScanFolder.enabled == True)
            .all()
        )
        for f in folders:
            tv_roots.add(f.path)

        current = directory
        while current and str(current) not in tv_roots:
            try:
                if current.is_dir() and not any(current.iterdir()):
                    logger.debug(f"Pipeline: removing empty directory: {current}")
                    current.rmdir()
                    current = current.parent
                else:
                    break
            except OSError:
                break

    # ── Companion file handling ─────────────────────────────────────

    def _move_companions(self, src_video: str, dest_video: str):
        """Move companion files (subtitles, nfo, etc.) alongside the video."""
        companion_types = self._get_companion_types()
        if not companion_types:
            return

        src_path = Path(src_video)
        dest_path = Path(dest_video)
        src_stem = src_path.stem
        dest_stem = dest_path.stem
        src_dir = src_path.parent
        dest_dir = dest_path.parent

        for ext in companion_types:
            # Direct match: video_name.ext
            companion = src_dir / f"{src_stem}{ext}"
            if companion.exists():
                dest_companion = dest_dir / f"{dest_stem}{ext}"
                try:
                    self._safe_copy(str(companion), str(dest_companion))
                    companion.unlink()
                except Exception as e:
                    logger.warning(f"Pipeline: failed to move companion {companion}: {e}")

            # Language-coded: video_name.en.ext, etc.
            for lang in LANGUAGE_CODES:
                companion = src_dir / f"{src_stem}.{lang}{ext}"
                if companion.exists():
                    dest_companion = dest_dir / f"{dest_stem}.{lang}{ext}"
                    try:
                        self._safe_copy(str(companion), str(dest_companion))
                        companion.unlink()
                    except Exception as e:
                        logger.warning(f"Pipeline: failed to move companion {companion}: {e}")

    # ── Movie pipeline ─────────────────────────────────────────────

    def _process_movie_file(self, file_path: str, parsed_movie):
        """Process a file detected as a movie (no SxE pattern)."""
        from .movie_matcher import ParsedMovie

        path = Path(file_path)
        title = parsed_movie.title
        year = parsed_movie.year

        logger.info(f"Pipeline: movie detected — '{title}' ({year or 'no year'})")
        self._log(
            "file_detected",
            file_path=file_path,
            details=f"Movie detected: '{title}' ({year or 'unknown year'})",
            media_type="movie",
        )

        # 1. Try to match against existing movies in DB
        movies = self.db.query(Movie).all()
        movie_dicts = [
            {"id": m.id, "title": m.title, "year": m.year}
            for m in movies
        ]
        match_result = self.movie_matcher.find_best_movie_match(title, year, movie_dicts)

        movie = None
        if match_result:
            matched_dict, score = match_result
            movie = self.db.query(Movie).filter(Movie.id == matched_dict["id"]).first()
            if movie:
                logger.info(f"Pipeline: matched movie '{title}' → '{movie.title}' (score={score:.2f})")
                self._log(
                    "match_found",
                    result="success",
                    file_path=file_path,
                    details=f"Matched movie '{title}' → '{movie.title}' (score={score:.2f})",
                    movie_title=movie.title,
                    movie_id=movie.id,
                    media_type="movie",
                )

        if not movie:
            # 2. Try TMDB lookup and auto-add
            logger.info(f"Pipeline: no DB match for movie '{title}', attempting TMDB lookup")
            movie = self._auto_import_movie(title, year)
            if not movie:
                self._move_to_issues(
                    file_path,
                    "movie_not_found",
                    f"No match for movie '{title}' ({year or 'no year'}) in DB or TMDB",
                )
                return

        # 3. Check if movie already has a file
        if movie.file_path and Path(movie.file_path).exists():
            # Quality comparison
            self._handle_movie_quality_comparison(file_path, movie, path.suffix)
            return

        # 4. Move to movie library
        self._move_movie_to_library(file_path, movie, path.suffix, parsed_movie.edition)

    def _auto_import_movie(self, title: str, year: int = None) -> Movie:
        """Search TMDB for a movie and auto-import it."""
        tmdb_key = self._get_setting("tmdb_api_key", "")
        if not tmdb_key:
            logger.warning("Pipeline: no TMDB API key for movie auto-import")
            return None

        loop = asyncio.new_event_loop()
        try:
            tmdb = TMDBService(api_key=tmdb_key)
            try:
                search_data = loop.run_until_complete(tmdb.search_movies(title, year=year))
                results = search_data.get("results", [])

                if not results and year:
                    search_data = loop.run_until_complete(tmdb.search_movies(title))
                    results = search_data.get("results", [])

                if not results:
                    return None

                # Pick best match
                best = results[0]
                for r in results[:5]:
                    r_title = r.get("title", "")
                    r_date = r.get("release_date", "")
                    r_year = int(r_date[:4]) if r_date and len(r_date) >= 4 else None
                    score = self.movie_matcher.match_movie_title(title, r_title, year, r_year)
                    best_date = best.get("release_date", "")
                    best_year = int(best_date[:4]) if best_date and len(best_date) >= 4 else None
                    if score > self.movie_matcher.match_movie_title(title, best.get("title", ""), year, best_year):
                        best = r

                tmdb_id = best.get("id")
                if not tmdb_id:
                    return None

                # Check if already in DB
                existing = self.db.query(Movie).filter(Movie.tmdb_id == tmdb_id).first()
                if existing:
                    logger.info(f"Pipeline: TMDB movie {tmdb_id} already in DB as '{existing.title}'")
                    return existing

                movie_data = loop.run_until_complete(tmdb.get_movie_with_details(tmdb_id))

                # Get first movie_library folder for folder_path
                library_folder = (
                    self.db.query(ScanFolder)
                    .filter(ScanFolder.folder_type == "movie_library", ScanFolder.enabled == True)
                    .first()
                )

                movie = Movie(
                    tmdb_id=movie_data.get("tmdb_id"),
                    imdb_id=movie_data.get("imdb_id"),
                    title=movie_data.get("title", "Unknown"),
                    original_title=movie_data.get("original_title"),
                    overview=movie_data.get("overview"),
                    tagline=movie_data.get("tagline"),
                    year=movie_data.get("year"),
                    release_date=movie_data.get("release_date"),
                    runtime=movie_data.get("runtime"),
                    poster_path=movie_data.get("poster_path"),
                    backdrop_path=movie_data.get("backdrop_path"),
                    genres=movie_data.get("genres"),
                    studio=movie_data.get("studio"),
                    vote_average=movie_data.get("vote_average"),
                    popularity=movie_data.get("popularity"),
                    status=movie_data.get("status", "Released"),
                    collection_id=movie_data.get("collection_id"),
                    collection_name=movie_data.get("collection_name"),
                    folder_path=library_folder.path if library_folder else None,
                )
                self.db.add(movie)
                self.db.commit()
                self.db.refresh(movie)

                self._log(
                    "auto_import",
                    result="success",
                    movie_title=movie.title,
                    movie_id=movie.id,
                    media_type="movie",
                    details=f"Auto-imported movie '{movie.title}' ({movie.year}) from TMDB",
                )
                logger.info(f"Pipeline: auto-imported movie '{movie.title}' ({movie.year}) from TMDB")
                return movie

            finally:
                loop.run_until_complete(tmdb.close())

        except Exception as e:
            logger.error(f"Pipeline: movie TMDB lookup failed: {e}", exc_info=True)
            return None
        finally:
            try:
                loop.run_until_complete(loop.shutdown_asyncgens())
            except Exception:
                pass
            loop.close()

    def _move_movie_to_library(self, file_path: str, movie: Movie, extension: str, edition: str = None):
        """Move a movie file to the library folder."""
        if not movie.folder_path:
            self._move_to_issues(
                file_path,
                "movie_no_folder",
                f"Movie '{movie.title}' has no library folder",
            )
            return

        # Generate destination path
        from .movie_renamer import MovieRenamerService
        renamer = MovieRenamerService(self.db)

        movie_format = self._get_setting("movie_format", "{title} ({year})/{title} ({year})")

        # Temporarily set edition for path generation
        orig_edition = movie.edition
        if edition and not movie.edition:
            movie.edition = edition

        dest_path_str = renamer.generate_movie_path(
            movie, movie.folder_path, extension, movie_format
        )
        dest_path = Path(dest_path_str)

        # Restore original edition if we changed it temporarily
        movie.edition = orig_edition

        logger.info(f"Pipeline: moving movie {Path(file_path).name} → {dest_path}")

        try:
            self._safe_copy(file_path, str(dest_path))
            self._move_companions(file_path, str(dest_path))
            self._safe_delete_source(file_path)

            # Update DB
            movie.file_path = str(dest_path)
            movie.file_status = "found"
            movie.matched_at = datetime.utcnow()
            if edition and not movie.edition:
                movie.edition = edition
            self.db.commit()

            self._log(
                "moved_to_library",
                result="success",
                file_path=str(dest_path),
                movie_title=movie.title,
                movie_id=movie.id,
                media_type="movie",
                details=f"Movie moved to {dest_path}",
            )
            logger.info(f"Pipeline: movie successfully moved to library: {dest_path}")

        except Exception as e:
            logger.error(f"Pipeline: failed to move movie to library: {e}", exc_info=True)
            self._move_to_issues(
                file_path,
                "move_failed",
                f"Failed to move movie to library: {e}",
            )

    def _handle_movie_quality_comparison(self, new_file_path: str, movie: Movie, extension: str):
        """Compare quality of incoming movie file vs existing."""
        existing_path = movie.file_path

        if not existing_path or not Path(existing_path).exists():
            self._move_movie_to_library(new_file_path, movie, extension)
            return

        if not QualityService.is_available():
            logger.warning("Pipeline: ffprobe unavailable for movie quality comparison")
            self._move_to_issues(
                new_file_path,
                "duplicate_movie",
                f"Duplicate movie '{movie.title}' (ffprobe unavailable)",
            )
            return

        existing_quality = QualityService.analyze(existing_path)
        new_quality = QualityService.analyze(new_file_path)

        if not existing_quality or not new_quality:
            self._move_to_issues(
                new_file_path,
                "duplicate_movie",
                f"Duplicate movie '{movie.title}' (quality analysis failed)",
            )
            return

        priorities = self._get_quality_priorities()
        verdict = QualityService.compare(existing_quality, new_quality, priorities)

        logger.info(
            f"Pipeline: movie quality comparison for '{movie.title}': "
            f"existing=[{existing_quality.summary()}] vs new=[{new_quality.summary()}] → {verdict}"
        )

        if verdict == "new_better":
            # Move old file to issues, new file to library
            old_path = Path(existing_path)
            issues_root = self._get_issues_folder()
            organization = self._get_issues_organization()
            issues_dir = self._resolve_issues_dir(issues_root, organization, "quality_replaced")

            try:
                self._mkdir_inherit(issues_dir)
                safe_title = sanitize_filename(movie.title)
                old_issues_dest = issues_dir / f"{safe_title} - {old_path.name}"
                self._safe_copy(existing_path, str(old_issues_dest))
                old_path.unlink()
            except Exception as e:
                logger.error(f"Pipeline: failed to move old movie to Issues: {e}")
                self._move_to_issues(
                    new_file_path,
                    "upgrade_failed",
                    f"Movie upgrade failed for '{movie.title}': {e}",
                )
                return

            self._move_movie_to_library(new_file_path, movie, extension)
        else:
            reason_label = "equal quality" if verdict == "equal" else "lower quality"
            self._move_to_issues(
                new_file_path,
                "duplicate_movie",
                f"{reason_label.capitalize()} duplicate of '{movie.title}'",
            )

    # ── Helpers ─────────────────────────────────────────────────────

