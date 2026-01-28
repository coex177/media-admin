"""API endpoints for scanning operations."""

from pathlib import Path
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, BackgroundTasks
from pydantic import BaseModel
from sqlalchemy.orm import Session

from ..database import get_db
from ..services.scanner import ScannerService, ScanResult

router = APIRouter(prefix="/api/scan", tags=["scan"])

# Global scan status
_scan_status = {
    "running": False,
    "type": None,
    "progress": 0,
    "message": "",
    "result": None,
}


class ScanFolderRequest(BaseModel):
    """Request model for scanning a specific folder."""

    path: str


def get_scanner(db: Session = Depends(get_db)) -> ScannerService:
    """Get scanner service."""
    return ScannerService(db)


def run_library_scan(db_session_maker, scan_mode: str = "full", recent_days: int = None):
    """Background task for library scan.

    Args:
        scan_mode: "full" for all shows, "ongoing" for non-canceled/ended, "quick" for recently aired.
        recent_days: Number of days back to check for recently aired episodes (only used when scan_mode="quick").
    """
    global _scan_status
    import time
    import json
    from datetime import datetime
    from ..models import AppSettings

    # Small delay to ensure any recent commits are visible
    time.sleep(0.5)

    SessionLocal = db_session_maker()
    db = SessionLocal()

    scan_type = scan_mode

    def update_progress(message, percent):
        """Callback to update scan status."""
        _scan_status["message"] = message
        _scan_status["progress"] = percent

    try:
        _scan_status["running"] = True
        _scan_status["type"] = scan_type
        _scan_status["progress"] = 0
        _scan_status["message"] = "Starting scan..."

        scanner = ScannerService(db)

        # Determine scan parameters based on mode
        if scan_mode == "quick" and recent_days is not None:
            result = scanner.scan_library(recent_days=recent_days, progress_callback=update_progress)
        elif scan_mode == "ongoing":
            result = scanner.scan_library(quick_scan=True, progress_callback=update_progress)
        else:
            result = scanner.scan_library(quick_scan=False, progress_callback=update_progress)

        # Ensure all changes are committed
        db.commit()

        scan_result = {
            "type": scan_type,
            "shows_found": result.shows_found,
            "episodes_matched": result.episodes_matched,
            "episodes_missing": result.episodes_missing,
            "pending_actions": len(result.pending_actions),
            "unmatched_files": result.unmatched_files[:50],  # Limit for response
            "errors": result.errors,
        }

        _scan_status["progress"] = 100
        _scan_status["message"] = "Scan complete"
        _scan_status["result"] = scan_result

        # Save last scan info to database
        _save_setting(db, "last_scan_time", datetime.utcnow().isoformat())
        _save_setting(db, "last_scan_result", json.dumps(scan_result))
        db.commit()
    except Exception as e:
        _scan_status["message"] = f"Scan failed: {str(e)}"
        _scan_status["result"] = {"error": str(e)}
        db.rollback()
    finally:
        _scan_status["running"] = False
        db.close()


def _save_setting(db: Session, key: str, value: str):
    """Save a setting to the database."""
    from ..models import AppSettings
    setting = db.query(AppSettings).filter(AppSettings.key == key).first()
    if setting:
        setting.value = value
    else:
        setting = AppSettings(key=key, value=value)
        db.add(setting)


def run_downloads_scan(db_session_maker):
    """Background task for downloads scan."""
    global _scan_status
    import time
    import json
    from datetime import datetime

    # Small delay to ensure any recent commits are visible
    time.sleep(0.5)

    SessionLocal = db_session_maker()
    db = SessionLocal()

    try:
        _scan_status["running"] = True
        _scan_status["type"] = "downloads"
        _scan_status["progress"] = 0
        _scan_status["message"] = "Scanning download folders..."

        scanner = ScannerService(db)
        result = scanner.scan_downloads()

        # Ensure all changes are committed
        db.commit()

        scan_result = {
            "type": "downloads",
            "shows_found": result.shows_found,
            "episodes_matched": result.episodes_matched,
            "pending_actions": len(result.pending_actions),
            "unmatched_files": result.unmatched_files[:50],
            "errors": result.errors,
        }

        _scan_status["progress"] = 100
        _scan_status["message"] = "Scan complete"
        _scan_status["result"] = scan_result

        # Save last scan info to database
        _save_setting(db, "last_scan_time", datetime.utcnow().isoformat())
        _save_setting(db, "last_scan_result", json.dumps(scan_result))
        db.commit()
    except Exception as e:
        _scan_status["message"] = f"Scan failed: {str(e)}"
        _scan_status["result"] = {"error": str(e)}
        db.rollback()
    finally:
        _scan_status["running"] = False
        db.close()


@router.post("")
async def trigger_full_scan(
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
):
    """Trigger a full scan of all shows (library + downloads)."""
    global _scan_status

    if _scan_status["running"]:
        raise HTTPException(status_code=400, detail="Scan already in progress")

    from ..database import get_session_maker

    background_tasks.add_task(run_library_scan, get_session_maker, "full")

    return {"message": "Full scan started", "status": "running"}


@router.post("/quick")
async def trigger_quick_scan(
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
):
    """Trigger a quick scan of shows with recently aired episodes."""
    global _scan_status
    from ..models import AppSettings

    if _scan_status["running"]:
        raise HTTPException(status_code=400, detail="Scan already in progress")

    # Get recently_aired_days setting
    setting = db.query(AppSettings).filter(AppSettings.key == "recently_aired_days").first()
    recent_days = int(setting.value) if setting else 5

    from ..database import get_session_maker

    background_tasks.add_task(run_library_scan, get_session_maker, "quick", recent_days)

    return {"message": f"Quick scan started ({recent_days} days)", "status": "running", "days": recent_days}


@router.post("/ongoing")
async def trigger_ongoing_scan(
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
):
    """Trigger a scan of ongoing shows only (not canceled/ended)."""
    global _scan_status

    if _scan_status["running"]:
        raise HTTPException(status_code=400, detail="Scan already in progress")

    from ..database import get_session_maker

    background_tasks.add_task(run_library_scan, get_session_maker, "ongoing")

    return {"message": "Ongoing shows scan started", "status": "running"}


@router.post("/folder")
async def scan_specific_folder(
    data: ScanFolderRequest,
    scanner: ScannerService = Depends(get_scanner),
):
    """Scan a specific folder."""
    files = scanner.scan_folder(data.path)

    return {
        "path": data.path,
        "files_found": len(files),
        "files": [
            {
                "path": f.path,
                "filename": f.filename,
                "size": f.size,
                "parsed": {
                    "season": f.parsed.season if f.parsed else None,
                    "episode": f.parsed.episode if f.parsed else None,
                    "title": f.parsed.title if f.parsed else None,
                    "quality": f.parsed.quality if f.parsed else None,
                }
                if f.parsed
                else None,
            }
            for f in files[:100]  # Limit response size
        ],
    }


@router.get("/status")
async def get_scan_status():
    """Get current scan status."""
    return _scan_status


@router.post("/downloads")
async def scan_download_folders(
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
):
    """Scan download folders for new files."""
    global _scan_status

    if _scan_status["running"]:
        raise HTTPException(status_code=400, detail="Scan already in progress")

    from ..database import get_session_maker

    background_tasks.add_task(run_downloads_scan, get_session_maker)

    return {"message": "Download scan started", "status": "running"}


@router.post("/match")
async def match_filename(
    filename: str,
    scanner: ScannerService = Depends(get_scanner),
):
    """Match a filename to show/episode."""
    parsed = scanner.matcher.parse_filename(filename)

    if not parsed:
        return {"matched": False, "filename": filename}

    return {
        "matched": True,
        "filename": filename,
        "season": parsed.season,
        "episode": parsed.episode,
        "episode_end": parsed.episode_end,
        "title": parsed.title,
        "quality": parsed.quality,
        "source": parsed.source,
        "release_group": parsed.release_group,
        "year": parsed.year,
    }


@router.get("/missing")
async def get_all_missing_episodes(
    db: Session = Depends(get_db),
    limit: int = 500,
):
    """Get all missing episodes across all shows, grouped by show."""
    from datetime import datetime
    from pathlib import Path
    from sqlalchemy import not_, exists, select
    from ..models import Show, Episode, IgnoredEpisode, SpecialEpisode

    today = datetime.utcnow().strftime("%Y-%m-%d")

    # Subqueries to find ignored and special episode IDs
    ignored_subquery = select(IgnoredEpisode.episode_id)
    specials_subquery = select(SpecialEpisode.episode_id)

    # Get missing episodes that have aired, excluding ignored and specials
    missing_episodes = (
        db.query(Episode, Show)
        .join(Show, Episode.show_id == Show.id)
        .filter(
            Episode.file_status == "missing",
            Episode.air_date <= today,
            Episode.air_date != None,
            ~Episode.id.in_(ignored_subquery),
            ~Episode.id.in_(specials_subquery),
        )
        .order_by(Show.name, Episode.season, Episode.episode)
        .limit(limit)
        .all()
    )

    # Group by show
    shows_dict = {}
    for episode, show in missing_episodes:
        if show.id not in shows_dict:
            shows_dict[show.id] = {
                "show_id": show.id,
                "show_name": show.name,
                "folder_path": show.folder_path,
                "episodes": []
            }

        # Generate expected filename
        safe_title = (episode.title or "TBA").replace("/", "-").replace("\\", "-").replace(":", " -")
        expected_filename = show.episode_format.format(
            season=episode.season,
            episode=episode.episode,
            title=safe_title,
        )

        # Generate expected folder
        season_folder = show.season_format.format(season=episode.season) if show.folder_path else ""
        full_path = str(Path(show.folder_path or "") / season_folder) if show.folder_path else ""

        shows_dict[show.id]["episodes"].append({
            "id": episode.id,
            "season": episode.season,
            "episode": episode.episode,
            "title": episode.title,
            "air_date": episode.air_date,
            "episode_code": f"S{episode.season:02d}E{episode.episode:02d}",
            "expected_filename": expected_filename,
            "expected_folder": full_path,
        })

    # Convert to list sorted by show name
    result = sorted(shows_dict.values(), key=lambda x: x["show_name"].lower())
    return result


# Library folder discovery scan status (separate from regular scan)
_library_folder_scan_status = {
    "running": False,
    "folder_id": None,
    "folder_path": "",
    "progress": 0,
    "message": "",
    "current_show": "",
    "shows_found": 0,
    "shows_added": 0,
    "shows_skipped": 0,
    "episodes_matched": 0,
    "console": [],  # List of log entries
    "result": None,
}


class LibraryFolderScanRequest(BaseModel):
    """Request model for scanning a library folder for new shows."""

    folder_id: int


def run_library_folder_discovery(db_session_maker, folder_id: int, api_key: str):
    """Background task to scan a library folder and discover/add new shows."""
    global _library_folder_scan_status
    import time
    import asyncio
    import re
    from pathlib import Path
    from ..models import Show, Episode, ScanFolder
    from ..services.tmdb import TMDBService

    def log(message: str, level: str = "info"):
        """Add a log entry to the console."""
        _library_folder_scan_status["console"].append({
            "time": time.strftime("%H:%M:%S"),
            "level": level,
            "message": message
        })
        # Keep only last 200 entries
        if len(_library_folder_scan_status["console"]) > 200:
            _library_folder_scan_status["console"] = _library_folder_scan_status["console"][-200:]

    def update_status(message: str, progress: int = None, current_show: str = None):
        """Update scan status."""
        _library_folder_scan_status["message"] = message
        if progress is not None:
            _library_folder_scan_status["progress"] = progress
        if current_show is not None:
            _library_folder_scan_status["current_show"] = current_show

    # Small delay to ensure any recent commits are visible
    time.sleep(0.3)

    SessionLocal = db_session_maker()
    db = SessionLocal()

    # Create event loop for async operations
    loop = asyncio.new_event_loop()
    asyncio.set_event_loop(loop)

    try:
        _library_folder_scan_status["running"] = True
        _library_folder_scan_status["folder_id"] = folder_id
        _library_folder_scan_status["progress"] = 0
        _library_folder_scan_status["shows_found"] = 0
        _library_folder_scan_status["shows_added"] = 0
        _library_folder_scan_status["shows_skipped"] = 0
        _library_folder_scan_status["episodes_matched"] = 0
        _library_folder_scan_status["console"] = []
        _library_folder_scan_status["result"] = None

        # Get folder
        folder = db.query(ScanFolder).filter(ScanFolder.id == folder_id).first()
        if not folder:
            log("Folder not found", "error")
            _library_folder_scan_status["result"] = {"error": "Folder not found"}
            return

        folder_path = Path(folder.path)
        _library_folder_scan_status["folder_path"] = str(folder_path)

        if not folder_path.exists():
            log(f"Folder does not exist: {folder_path}", "error")
            _library_folder_scan_status["result"] = {"error": "Folder does not exist"}
            return

        update_status(f"Scanning {folder_path.name}...", 5)
        log(f"Starting scan of: {folder_path}")

        # Get list of subdirectories (each should be a show)
        show_dirs = []
        try:
            for item in folder_path.iterdir():
                if item.is_dir() and not item.name.startswith('.'):
                    show_dirs.append(item)
        except PermissionError as e:
            log(f"Permission denied: {e}", "error")
            _library_folder_scan_status["result"] = {"error": str(e)}
            return

        total_dirs = len(show_dirs)
        _library_folder_scan_status["shows_found"] = total_dirs
        log(f"Found {total_dirs} directories to scan")

        if total_dirs == 0:
            update_status("No show folders found", 100)
            _library_folder_scan_status["result"] = {
                "shows_found": 0,
                "shows_added": 0,
                "shows_skipped": 0,
                "episodes_matched": 0,
            }
            return

        # Create TMDB service
        tmdb = TMDBService(api_key=api_key)

        # Get existing shows to check for duplicates
        existing_shows = {s.tmdb_id: s for s in db.query(Show).all()}
        existing_folders = {s.folder_path: s for s in db.query(Show).all() if s.folder_path}

        scanner = ScannerService(db)

        for i, show_dir in enumerate(show_dirs):
            progress = 10 + int((i / total_dirs) * 80)  # 10-90%
            dir_name = show_dir.name

            update_status(f"Processing: {dir_name}", progress, dir_name)

            # Check if this folder is already assigned to a show
            if str(show_dir) in existing_folders:
                existing = existing_folders[str(show_dir)]
                log(f"Skipping '{dir_name}' - already assigned to '{existing.name}'", "skip")
                _library_folder_scan_status["shows_skipped"] += 1
                continue

            # Extract show name from folder
            show_name = scanner.detect_show_from_folder(str(show_dir))
            if not show_name:
                show_name = dir_name

            # Extract year from folder if present
            year_match = re.search(r'\(?(19|20)(\d{2})\)?$', dir_name)
            folder_year = int(year_match.group(1) + year_match.group(2)) if year_match else None

            log(f"Searching TMDB for: '{show_name}'" + (f" ({folder_year})" if folder_year else ""))

            try:
                # Search TMDB
                search_results = loop.run_until_complete(tmdb.search_shows(show_name))
                results = search_results.get("results", [])

                if not results:
                    log(f"No TMDB results for '{show_name}'", "warning")
                    continue

                # Find best match (prefer exact year match if folder has year)
                best_match = None
                for result in results[:5]:  # Check top 5 results
                    result_year = None
                    if result.get("first_air_date"):
                        try:
                            result_year = int(result["first_air_date"][:4])
                        except (ValueError, TypeError):
                            pass

                    # Check if already exists
                    if result["id"] in existing_shows:
                        existing = existing_shows[result["id"]]
                        # If it exists but has no folder, assign this folder
                        if not existing.folder_path:
                            log(f"Assigning folder to existing show: '{existing.name}'", "info")
                            existing.folder_path = str(show_dir)
                            db.commit()
                            _library_folder_scan_status["shows_skipped"] += 1
                            # Scan for episodes
                            matched = _scan_show_folder(scanner, existing, show_dir)
                            _library_folder_scan_status["episodes_matched"] += matched
                        else:
                            log(f"Skipping '{result['name']}' - already in library", "skip")
                            _library_folder_scan_status["shows_skipped"] += 1
                        best_match = None  # Don't add, already handled
                        break

                    # Prefer year match
                    if folder_year and result_year == folder_year:
                        best_match = result
                        break
                    elif not best_match:
                        best_match = result

                if not best_match:
                    continue

                # Check again if best match exists (might have been a different result)
                if best_match["id"] in existing_shows:
                    existing = existing_shows[best_match["id"]]
                    if not existing.folder_path:
                        existing.folder_path = str(show_dir)
                        db.commit()
                        log(f"Assigned folder to existing show: '{existing.name}'", "info")
                        matched = _scan_show_folder(scanner, existing, show_dir)
                        _library_folder_scan_status["episodes_matched"] += matched
                    else:
                        log(f"Skipping '{best_match['name']}' - already in library", "skip")
                    _library_folder_scan_status["shows_skipped"] += 1
                    continue

                # Add new show
                log(f"Adding show: '{best_match['name']}' (TMDB ID: {best_match['id']})")

                try:
                    show_data = loop.run_until_complete(tmdb.get_show_with_episodes(best_match["id"]))

                    # Create show
                    show = Show(
                        tmdb_id=show_data["tmdb_id"],
                        tvdb_id=show_data.get("tvdb_id"),
                        imdb_id=show_data.get("imdb_id"),
                        name=show_data["name"],
                        overview=show_data.get("overview"),
                        poster_path=show_data.get("poster_path"),
                        backdrop_path=show_data.get("backdrop_path"),
                        folder_path=str(show_dir),
                        status=show_data.get("status", "Unknown"),
                        first_air_date=show_data.get("first_air_date"),
                        number_of_seasons=show_data.get("number_of_seasons", 0),
                        number_of_episodes=show_data.get("number_of_episodes", 0),
                        genres=show_data.get("genres"),
                        networks=show_data.get("networks"),
                        next_episode_air_date=show_data.get("next_episode_air_date"),
                    )
                    db.add(show)
                    db.commit()
                    db.refresh(show)

                    # Add to existing shows dict to prevent duplicates in same scan
                    existing_shows[show.tmdb_id] = show
                    existing_folders[str(show_dir)] = show

                    # Create episodes
                    for ep_data in show_data.get("episodes", []):
                        episode = Episode(
                            show_id=show.id,
                            season=ep_data["season"],
                            episode=ep_data["episode"],
                            title=ep_data["title"],
                            overview=ep_data.get("overview"),
                            air_date=ep_data.get("air_date"),
                            tmdb_id=ep_data.get("tmdb_id"),
                            still_path=ep_data.get("still_path"),
                            runtime=ep_data.get("runtime"),
                        )
                        db.add(episode)
                    db.commit()

                    _library_folder_scan_status["shows_added"] += 1
                    log(f"Added '{show.name}' with {show_data.get('number_of_episodes', 0)} episodes", "success")

                    # Scan folder for existing files
                    matched = _scan_show_folder(scanner, show, show_dir)
                    _library_folder_scan_status["episodes_matched"] += matched
                    if matched > 0:
                        log(f"Matched {matched} episode files", "success")

                except Exception as e:
                    log(f"Error adding show '{best_match['name']}': {str(e)}", "error")
                    db.rollback()

                # Small delay to avoid TMDB rate limiting
                time.sleep(0.3)

            except Exception as e:
                log(f"Error searching for '{show_name}': {str(e)}", "error")

        # Final status
        update_status("Scan complete", 100, "")
        log(f"Scan complete: {_library_folder_scan_status['shows_added']} added, "
            f"{_library_folder_scan_status['shows_skipped']} skipped, "
            f"{_library_folder_scan_status['episodes_matched']} episodes matched", "success")

        _library_folder_scan_status["result"] = {
            "shows_found": _library_folder_scan_status["shows_found"],
            "shows_added": _library_folder_scan_status["shows_added"],
            "shows_skipped": _library_folder_scan_status["shows_skipped"],
            "episodes_matched": _library_folder_scan_status["episodes_matched"],
        }

    except Exception as e:
        log(f"Fatal error: {str(e)}", "error")
        _library_folder_scan_status["message"] = f"Scan failed: {str(e)}"
        _library_folder_scan_status["result"] = {"error": str(e)}
        db.rollback()
    finally:
        _library_folder_scan_status["running"] = False
        try:
            loop.run_until_complete(loop.shutdown_asyncgens())
        except Exception:
            pass
        loop.close()
        db.close()


def _scan_show_folder(scanner: ScannerService, show, show_dir: Path) -> int:
    """Scan a show's folder for video files and match to episodes."""
    from datetime import datetime
    from ..models import Episode

    matched_count = 0
    files = scanner.scan_folder(str(show_dir))

    for file_info in files:
        if file_info.parsed and file_info.parsed.season and file_info.parsed.episode:
            # Get episode range (for multi-episode files)
            start_ep = file_info.parsed.episode
            end_ep = file_info.parsed.episode_end or file_info.parsed.episode

            # Mark all episodes in range as found
            for ep_num in range(start_ep, end_ep + 1):
                episode = (
                    scanner.db.query(Episode)
                    .filter(
                        Episode.show_id == show.id,
                        Episode.season == file_info.parsed.season,
                        Episode.episode == ep_num,
                    )
                    .first()
                )

                if episode and episode.file_status == "missing":
                    episode.file_path = file_info.path
                    episode.file_status = "found"
                    episode.matched_at = datetime.utcnow()
                    matched_count += 1

    if matched_count > 0:
        scanner.db.commit()

    return matched_count


@router.post("/library-folder")
async def scan_library_folder_for_shows(
    data: LibraryFolderScanRequest,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
):
    """Scan a library folder to discover and add new shows."""
    global _library_folder_scan_status

    if _library_folder_scan_status["running"]:
        raise HTTPException(status_code=400, detail="Library folder scan already in progress")

    # Verify folder exists
    from ..models import ScanFolder, AppSettings

    folder = db.query(ScanFolder).filter(ScanFolder.id == data.folder_id).first()
    if not folder:
        raise HTTPException(status_code=404, detail="Folder not found")

    if folder.folder_type != "library":
        raise HTTPException(status_code=400, detail="Can only scan library folders")

    # Get API key
    api_key_setting = db.query(AppSettings).filter(AppSettings.key == "tmdb_api_key").first()
    if not api_key_setting or not api_key_setting.value:
        raise HTTPException(status_code=400, detail="TMDB API key not configured")

    from ..database import get_session_maker

    background_tasks.add_task(
        run_library_folder_discovery,
        get_session_maker,
        data.folder_id,
        api_key_setting.value
    )

    return {"message": "Library folder scan started", "status": "running", "folder_id": data.folder_id}


@router.get("/library-folder/status")
async def get_library_folder_scan_status():
    """Get the status of the library folder discovery scan."""
    return _library_folder_scan_status


class IgnoreEpisodesRequest(BaseModel):
    """Request model for ignoring episodes."""

    episode_ids: list[int]
    reason: Optional[str] = None


class FixMatchRequest(BaseModel):
    """Request model for fixing episode matches."""

    episode_ids: list[int]
    new_show_id: int


@router.post("/ignore-episodes")
async def ignore_episodes(
    data: IgnoreEpisodesRequest,
    db: Session = Depends(get_db),
):
    """Add episodes to the ignore list."""
    from ..models import IgnoredEpisode, Episode

    added = 0
    already_ignored = 0

    for episode_id in data.episode_ids:
        # Check if episode exists
        episode = db.query(Episode).filter(Episode.id == episode_id).first()
        if not episode:
            continue

        # Check if already ignored
        existing = db.query(IgnoredEpisode).filter(IgnoredEpisode.episode_id == episode_id).first()
        if existing:
            already_ignored += 1
            continue

        # Add to ignored list
        ignored = IgnoredEpisode(
            episode_id=episode_id,
            reason=data.reason
        )
        db.add(ignored)
        added += 1

    db.commit()

    return {
        "message": f"Ignored {added} episodes",
        "added": added,
        "already_ignored": already_ignored
    }


@router.delete("/ignore-episodes/{episode_id}")
async def unignore_episode(
    episode_id: int,
    db: Session = Depends(get_db),
):
    """Remove an episode from the ignore list."""
    from ..models import IgnoredEpisode

    ignored = db.query(IgnoredEpisode).filter(IgnoredEpisode.episode_id == episode_id).first()
    if not ignored:
        raise HTTPException(status_code=404, detail="Episode not in ignore list")

    db.delete(ignored)
    db.commit()

    return {"message": "Episode removed from ignore list"}


@router.get("/ignored-episodes")
async def get_ignored_episodes(
    db: Session = Depends(get_db),
):
    """Get all ignored episodes."""
    from ..models import IgnoredEpisode, Episode, Show

    ignored = (
        db.query(IgnoredEpisode, Episode, Show)
        .join(Episode, IgnoredEpisode.episode_id == Episode.id)
        .join(Show, Episode.show_id == Show.id)
        .all()
    )

    return [
        {
            "id": ig.id,
            "episode_id": ig.episode_id,
            "reason": ig.reason,
            "created_at": ig.created_at.isoformat() if ig.created_at else None,
            "show_id": show.id,
            "show_name": show.name,
            "season": ep.season,
            "episode": ep.episode,
            "title": ep.title,
        }
        for ig, ep, show in ignored
    ]


class MarkSpecialsRequest(BaseModel):
    """Request model for marking episodes as specials."""

    episode_ids: list[int]
    notes: Optional[str] = None


@router.post("/special-episodes")
async def mark_special_episodes(
    data: MarkSpecialsRequest,
    db: Session = Depends(get_db),
):
    """Mark episodes as specials for separate handling."""
    from ..models import SpecialEpisode, Episode

    added = 0
    already_marked = 0

    for episode_id in data.episode_ids:
        # Check if episode exists
        episode = db.query(Episode).filter(Episode.id == episode_id).first()
        if not episode:
            continue

        # Check if already marked as special
        existing = db.query(SpecialEpisode).filter(SpecialEpisode.episode_id == episode_id).first()
        if existing:
            already_marked += 1
            continue

        # Add to specials list
        special = SpecialEpisode(
            episode_id=episode_id,
            notes=data.notes
        )
        db.add(special)
        added += 1

    db.commit()

    return {
        "message": f"Marked {added} episodes as specials",
        "added": added,
        "already_marked": already_marked
    }


@router.delete("/special-episodes/{episode_id}")
async def unmark_special_episode(
    episode_id: int,
    db: Session = Depends(get_db),
):
    """Remove an episode from the specials list."""
    from ..models import SpecialEpisode

    special = db.query(SpecialEpisode).filter(SpecialEpisode.episode_id == episode_id).first()
    if not special:
        raise HTTPException(status_code=404, detail="Episode not in specials list")

    db.delete(special)
    db.commit()

    return {"message": "Episode removed from specials list"}


@router.get("/special-episodes")
async def get_special_episodes(
    db: Session = Depends(get_db),
):
    """Get all episodes marked as specials."""
    from ..models import SpecialEpisode, Episode, Show

    specials = (
        db.query(SpecialEpisode, Episode, Show)
        .join(Episode, SpecialEpisode.episode_id == Episode.id)
        .join(Show, Episode.show_id == Show.id)
        .order_by(Show.name, Episode.season, Episode.episode)
        .all()
    )

    return [
        {
            "id": sp.id,
            "episode_id": sp.episode_id,
            "notes": sp.notes,
            "created_at": sp.created_at.isoformat() if sp.created_at else None,
            "show_id": show.id,
            "show_name": show.name,
            "season": ep.season,
            "episode": ep.episode,
            "title": ep.title,
        }
        for sp, ep, show in specials
    ]


@router.post("/fix-match")
async def fix_episode_match(
    data: FixMatchRequest,
    db: Session = Depends(get_db),
):
    """Reassign episodes to a different show.

    This is useful when episodes were matched to the wrong show.
    It moves the episodes to the new show and updates their metadata.
    """
    from ..models import Show, Episode

    # Get the new show
    new_show = db.query(Show).filter(Show.id == data.new_show_id).first()
    if not new_show:
        raise HTTPException(status_code=404, detail="Target show not found")

    updated = 0
    errors = []

    for episode_id in data.episode_ids:
        episode = db.query(Episode).filter(Episode.id == episode_id).first()
        if not episode:
            errors.append(f"Episode {episode_id} not found")
            continue

        old_show_id = episode.show_id

        # Check if an episode with same season/episode already exists in the new show
        existing = (
            db.query(Episode)
            .filter(
                Episode.show_id == new_show.id,
                Episode.season == episode.season,
                Episode.episode == episode.episode,
            )
            .first()
        )

        if existing:
            # Update the existing episode with the file info from this episode
            if episode.file_path and not existing.file_path:
                existing.file_path = episode.file_path
                existing.file_status = episode.file_status
                existing.matched_at = episode.matched_at
            # Delete the old episode since we merged it
            db.delete(episode)
        else:
            # Move the episode to the new show
            episode.show_id = new_show.id

        updated += 1

    db.commit()

    return {
        "message": f"Reassigned {updated} episodes to '{new_show.name}'",
        "updated": updated,
        "errors": errors,
        "new_show_id": new_show.id,
        "new_show_name": new_show.name
    }


class ScanSelectedRequest(BaseModel):
    """Request model for scanning selected episodes."""

    episode_ids: list[int]


@router.post("/selected-episodes")
async def scan_selected_episodes(
    data: ScanSelectedRequest,
    db: Session = Depends(get_db),
):
    """Scan for specific episodes by looking in their show folders.

    This is useful for re-scanning specific missing episodes without
    running a full library scan.
    """
    from datetime import datetime
    from ..models import Show, Episode

    scanner = ScannerService(db)

    found = 0
    not_found = 0
    errors = []
    results = []

    # Group episodes by show for efficiency
    episodes_by_show = {}
    for episode_id in data.episode_ids:
        episode = db.query(Episode).filter(Episode.id == episode_id).first()
        if not episode:
            errors.append(f"Episode ID {episode_id} not found")
            continue

        if episode.show_id not in episodes_by_show:
            episodes_by_show[episode.show_id] = []
        episodes_by_show[episode.show_id].append(episode)

    # Scan each show's folder
    for show_id, episodes in episodes_by_show.items():
        show = db.query(Show).filter(Show.id == show_id).first()
        if not show:
            for ep in episodes:
                errors.append(f"Show not found for episode {ep.id}")
            continue

        if not show.folder_path:
            for ep in episodes:
                results.append({
                    "episode_id": ep.id,
                    "show_name": show.name,
                    "episode_code": f"S{ep.season:02d}E{ep.episode:02d}",
                    "status": "no_folder",
                    "message": "Show has no folder path configured"
                })
                not_found += 1
            continue

        # Scan the show's folder
        files = scanner.scan_folder(show.folder_path)

        # Try to match each episode
        for episode in episodes:
            matched = False

            for file_info in files:
                if not file_info.parsed:
                    continue

                # Check if this file matches the episode
                if file_info.parsed.season != episode.season:
                    continue

                # Check single episode or range
                start_ep = file_info.parsed.episode
                end_ep = file_info.parsed.episode_end or file_info.parsed.episode

                if start_ep <= episode.episode <= end_ep:
                    # Found a match!
                    episode.file_path = file_info.path
                    episode.file_status = "found"
                    episode.matched_at = datetime.utcnow()
                    matched = True

                    results.append({
                        "episode_id": episode.id,
                        "show_name": show.name,
                        "episode_code": f"S{episode.season:02d}E{episode.episode:02d}",
                        "status": "found",
                        "message": f"Matched to: {file_info.filename}"
                    })
                    found += 1
                    break

            if not matched:
                results.append({
                    "episode_id": episode.id,
                    "show_name": show.name,
                    "episode_code": f"S{episode.season:02d}E{episode.episode:02d}",
                    "status": "not_found",
                    "message": "No matching file found"
                })
                not_found += 1

    db.commit()

    return {
        "message": f"Scanned {len(data.episode_ids)} episodes: {found} found, {not_found} not found",
        "found": found,
        "not_found": not_found,
        "errors": errors,
        "results": results
    }
