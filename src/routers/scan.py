"""API endpoints for scanning operations."""

from pathlib import Path
from typing import Optional

from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, BackgroundTasks, Query
from pydantic import BaseModel
from sqlalchemy.orm import Session

from ..database import get_db
from ..models.library_log import LibraryLog
from ..services.scanner import ScannerService, ScanResult

router = APIRouter(prefix="/api/scan", tags=["scan"])


def log_library_event(
    db: Session,
    action_type: str,
    result: str = "success",
    file_path: str = None,
    dest_path: str = None,
    show_name: str = None,
    show_id: int = None,
    episode_code: str = None,
    details: str = None,
    movie_id: int = None,
    movie_title: str = None,
    media_type: str = None,
):
    """Write an entry to the library_log table."""
    entry = LibraryLog(
        action_type=action_type,
        file_path=file_path,
        dest_path=dest_path,
        show_name=show_name,
        show_id=show_id,
        episode_code=episode_code,
        movie_id=movie_id,
        movie_title=movie_title,
        media_type=media_type,
        result=result,
        details=details,
    )
    db.add(entry)

# Global scan status
_scan_status = {
    "running": False,
    "type": None,
    "progress": 0,
    "message": "",
    "result": None,
}

# Scan result data for new sections
_metadata_updates: list[dict] = []
_download_matches: list[dict] = []


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
    global _scan_status, _metadata_updates, _download_matches
    import time
    import json
    import asyncio
    from datetime import datetime
    from ..models import AppSettings
    from ..services.watcher import watcher_service
    from ..services.tmdb import TMDBService
    from ..services.tvdb import TVDBService

    # Small delay to ensure any recent commits are visible
    time.sleep(0.5)

    # Acquire scan lock so watcher queues files while we scan
    watcher_service.acquire_scan_lock()

    SessionLocal = db_session_maker()
    db = SessionLocal()

    # Create event loop for async metadata operations
    loop = asyncio.new_event_loop()
    asyncio.set_event_loop(loop)

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

        # Get API keys for metadata services
        tmdb_key_setting = db.query(AppSettings).filter(AppSettings.key == "tmdb_api_key").first()
        tvdb_key_setting = db.query(AppSettings).filter(AppSettings.key == "tvdb_api_key").first()
        tmdb_key = tmdb_key_setting.value if tmdb_key_setting else ""
        tvdb_key = tvdb_key_setting.value if tvdb_key_setting else ""

        tmdb = TMDBService(api_key=tmdb_key) if tmdb_key else None
        tvdb = TVDBService(api_key=tvdb_key) if tvdb_key else None

        # Determine scan parameters based on mode
        if scan_mode == "quick" and recent_days is not None:
            result = scanner.scan_library(
                recent_days=recent_days, progress_callback=update_progress,
                tmdb_service=tmdb, tvdb_service=tvdb, event_loop=loop,
            )
        elif scan_mode == "ongoing":
            result = scanner.scan_library(
                quick_scan=True, progress_callback=update_progress,
                tmdb_service=tmdb, tvdb_service=tvdb, event_loop=loop,
            )
        else:
            result = scanner.scan_library(
                quick_scan=False, progress_callback=update_progress,
                tmdb_service=tmdb, tvdb_service=tvdb, event_loop=loop,
            )

        # Ensure all changes are committed
        db.commit()

        # Store results for new endpoints
        _metadata_updates = result.rename_previews
        _download_matches = result.download_matches

        scan_result = {
            "type": scan_type,
            "shows_found": result.shows_found,
            "episodes_matched": result.episodes_matched,
            "episodes_missing": result.episodes_missing,
            "pending_actions": len(result.pending_actions),
            "unmatched_files": result.unmatched_files[:50],  # Limit for response
            "errors": result.errors,
            "metadata_refreshed": result.metadata_refreshed,
            "metadata_errors": result.metadata_errors,
            "rename_count": len(result.rename_previews),
            "download_match_count": len(result.download_matches),
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
        try:
            loop.run_until_complete(loop.shutdown_asyncgens())
        except Exception:
            pass
        loop.close()
        db.close()
        watcher_service.release_scan_lock()


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
    from ..services.watcher import watcher_service

    # Small delay to ensure any recent commits are visible
    time.sleep(0.5)

    # Acquire scan lock so watcher queues files while we scan
    watcher_service.acquire_scan_lock()

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
        watcher_service.release_scan_lock()


def run_single_show_scan(db_session_maker, show_id: int):
    """Background task for scanning a single show only."""
    global _scan_status
    import time
    import json
    import logging
    from datetime import datetime
    from ..models import Show
    from ..services.watcher import watcher_service

    logger = logging.getLogger("scanner")

    time.sleep(0.3)
    watcher_service.acquire_scan_lock()

    SessionLocal = db_session_maker()
    db = SessionLocal()

    def update_progress(message, percent):
        _scan_status["message"] = message
        _scan_status["progress"] = percent

    try:
        _scan_status["running"] = True
        _scan_status["type"] = "single"
        _scan_status["progress"] = 0
        _scan_status["message"] = "Starting single-show scan..."

        show = db.query(Show).filter(Show.id == show_id).first()
        if not show:
            logger.error(f"Single-show scan: show id={show_id} not found")
            _scan_status["message"] = "Show not found"
            _scan_status["result"] = {"error": "Show not found"}
            return

        logger.info(f"Single-show scan started for '{show.name}' (id={show_id})")

        scanner = ScannerService(db)
        result = scanner.scan_single_show(show, progress_callback=update_progress)

        db.commit()

        scan_result = {
            "type": "single",
            "show_name": show.name,
            "shows_found": 1,
            "episodes_matched": result.episodes_matched,
            "episodes_missing": result.episodes_missing,
            "pending_actions": len(result.pending_actions),
            "unmatched_files": result.unmatched_files[:50],
            "errors": result.errors,
        }

        _scan_status["progress"] = 100
        _scan_status["message"] = "Scan complete"
        _scan_status["result"] = scan_result

        _save_setting(db, "last_scan_time", datetime.utcnow().isoformat())
        _save_setting(db, "last_scan_result", json.dumps(scan_result))
        db.commit()

        logger.info(f"Single-show scan finished for '{show.name}'")
    except Exception as e:
        logger.error(f"Single-show scan failed: {e}", exc_info=True)
        _scan_status["message"] = f"Scan failed: {str(e)}"
        _scan_status["result"] = {"error": str(e)}
        db.rollback()
    finally:
        _scan_status["running"] = False
        db.close()
        watcher_service.release_scan_lock()


@router.post("/show/{show_id}")
async def trigger_single_show_scan(
    show_id: int,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
):
    """Trigger a scan for a single show only (folder match + episode scan + downloads)."""
    global _scan_status
    from ..models import Show

    if _scan_status["running"]:
        raise HTTPException(status_code=400, detail="Scan already in progress")

    show = db.query(Show).filter(Show.id == show_id).first()
    if not show:
        raise HTTPException(status_code=404, detail="Show not found")

    from ..database import get_session_maker

    background_tasks.add_task(run_single_show_scan, get_session_maker, show_id)

    return {"message": f"Single-show scan started: {show.name}", "status": "running"}


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
    from ..models import Show, Episode, IgnoredEpisode

    today = datetime.utcnow().strftime("%Y-%m-%d")

    # Subquery to find ignored episode IDs
    ignored_subquery = select(IgnoredEpisode.episode_id)

    # Get missing episodes that have aired, excluding ignored and season 0
    missing_episodes = (
        db.query(Episode, Show)
        .join(Show, Episode.show_id == Show.id)
        .filter(
            Episode.file_status == "missing",
            Episode.air_date <= today,
            Episode.air_date != None,
            Episode.season != 0,
            ~Episode.id.in_(ignored_subquery),
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


@router.get("/metadata-updates")
async def get_metadata_updates():
    """Get computed rename previews from the last scan."""
    return _metadata_updates


@router.get("/download-matches")
async def get_download_matches():
    """Get download matches for missing episodes from the last scan."""
    return _download_matches


class ApplyRenamesRequest(BaseModel):
    """Request model for applying file renames."""

    rename_indices: list[int]


@router.post("/apply-renames")
async def apply_renames(data: ApplyRenamesRequest, db: Session = Depends(get_db)):
    """Execute selected file renames from the metadata updates list."""
    import shutil
    from ..models import Episode
    from ..services.renamer import RenamerService

    global _metadata_updates

    renamer = RenamerService(db)
    success = 0
    failed = 0
    errors = []
    completed_indices = set()

    for idx in data.rename_indices:
        if idx < 0 or idx >= len(_metadata_updates):
            errors.append(f"Invalid index: {idx}")
            failed += 1
            continue

        preview = _metadata_updates[idx]
        source = Path(preview["current_path"])
        dest = Path(preview["expected_path"])

        if not source.exists():
            errors.append(f"Source not found: {source.name}")
            failed += 1
            continue

        if dest.exists() and str(source) != str(dest):
            errors.append(f"Destination already exists: {dest.name}")
            failed += 1
            continue

        try:
            # Create destination directory
            dest.parent.mkdir(parents=True, exist_ok=True)

            # Move the main file
            shutil.move(str(source), str(dest))

            # Move accompanying files
            renamer._move_accompanying_files(source, dest)

            # Update episode records
            for ep_id in preview["episode_ids"]:
                episode = db.query(Episode).filter(Episode.id == ep_id).first()
                if episode:
                    episode.file_path = str(dest)
                    episode.file_status = "renamed"

            log_library_event(
                db, action_type="rename", result="success",
                file_path=str(source), dest_path=str(dest),
                show_name=preview.get("show_name", ""),
                show_id=preview.get("show_id"),
                episode_code=preview.get("episode_code", ""),
                details=f"Renamed: {source.name} \u2192 {dest.name}",
            )
            db.commit()
            success += 1
            completed_indices.add(idx)

        except Exception as e:
            errors.append(f"Failed to rename {source.name}: {str(e)}")
            failed += 1
            db.rollback()
            log_library_event(
                db, action_type="rename", result="failed",
                file_path=str(source), dest_path=str(dest),
                show_name=preview.get("show_name", ""),
                show_id=preview.get("show_id"),
                episode_code=preview.get("episode_code", ""),
                details=f"Failed: {str(e)}",
            )
            try:
                db.commit()
            except Exception:
                db.rollback()

    # Remove completed renames from the global list so the UI refreshes correctly
    if completed_indices:
        _metadata_updates = [
            item for i, item in enumerate(_metadata_updates)
            if i not in completed_indices
        ]

    return {"success": success, "failed": failed, "errors": errors}


class ImportDownloadsRequest(BaseModel):
    """Request model for importing download matches."""

    match_indices: list[int]


@router.post("/import-downloads")
async def import_downloads(data: ImportDownloadsRequest, db: Session = Depends(get_db)):
    """Import matched files from downloads to library."""
    global _download_matches
    import shutil
    from ..models import Episode
    from ..services.renamer import RenamerService

    renamer = RenamerService(db)
    success = 0
    failed = 0
    errors = []
    completed_indices = set()

    for idx in data.match_indices:
        if idx < 0 or idx >= len(_download_matches):
            errors.append(f"Invalid index: {idx}")
            failed += 1
            continue

        match = _download_matches[idx]
        source = Path(match["source_path"])
        dest = Path(match["dest_path"])

        if not source.exists():
            errors.append(f"Source not found: {source.name}")
            failed += 1
            continue

        if dest.exists():
            errors.append(f"Destination already exists: {dest.name}")
            failed += 1
            continue

        try:
            # Create destination directory
            dest.parent.mkdir(parents=True, exist_ok=True)

            # Move the file
            shutil.move(str(source), str(dest))

            # Move accompanying files
            renamer._move_accompanying_files(source, dest)

            # Update episode record
            episode = db.query(Episode).filter(Episode.id == match["episode_id"]).first()
            if episode:
                episode.file_path = str(dest)
                episode.file_status = "found"
                episode.matched_at = datetime.utcnow()

            log_library_event(
                db, action_type="import", result="success",
                file_path=str(source), dest_path=str(dest),
                show_name=match.get("show_name", ""),
                show_id=match.get("show_id"),
                episode_code=match.get("episode_code", ""),
                details=f"Imported: {source.name} \u2192 {dest.name}",
            )
            db.commit()
            success += 1
            completed_indices.add(idx)

        except Exception as e:
            errors.append(f"Failed to import {source.name}: {str(e)}")
            failed += 1
            db.rollback()
            log_library_event(
                db, action_type="import", result="failed",
                file_path=str(source), dest_path=str(dest),
                show_name=match.get("show_name", ""),
                show_id=match.get("show_id"),
                episode_code=match.get("episode_code", ""),
                details=f"Failed: {str(e)}",
            )
            try:
                db.commit()
            except Exception:
                db.rollback()

    # Remove completed imports from the global list so the UI refreshes correctly
    if completed_indices:
        _download_matches = [
            item for i, item in enumerate(_download_matches)
            if i not in completed_indices
        ]

    return {"success": success, "failed": failed, "errors": errors}


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
    "shows_processed": [],  # Per-show results for summary table
    "result": None,
}


class LibraryFolderScanRequest(BaseModel):
    """Request model for scanning a library folder for new shows."""

    folder_id: int
    limit: Optional[int] = None  # Limit number of shows to scan


def run_library_folder_discovery(db_session_maker, folder_id: int, api_key: str, limit: int = None, metadata_source: str = "tmdb", tvdb_api_key: str = ""):
    """Background task to scan a library folder and discover/add new shows.

    Args:
        limit: If provided, only scan this many show folders.
        metadata_source: Which provider to use for new shows ("tmdb" or "tvdb").
        tvdb_api_key: TVDB API key (used when metadata_source is "tvdb").
    """
    global _library_folder_scan_status
    import time
    import asyncio
    import re
    from pathlib import Path
    from ..models import Show, Episode, ScanFolder
    from ..services.tmdb import TMDBService
    from ..services.tvdb import TVDBService

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

    def record_show(folder_name: str, show_name: str, status: str, episodes_matched: int = 0, total_episodes: int = 0, total_files: int = 0, detail: str = ""):
        """Record a per-show result for the summary table."""
        _library_folder_scan_status["shows_processed"].append({
            "folder": folder_name,
            "name": show_name,
            "status": status,  # added, existing, not_found, error
            "episodes_matched": episodes_matched,
            "total_episodes": total_episodes,
            "total_files": total_files,
            "detail": detail,
        })

    from ..services.watcher import watcher_service

    # Small delay to ensure any recent commits are visible
    time.sleep(0.3)

    # Acquire scan lock so watcher queues files while we scan
    watcher_service.acquire_scan_lock()

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
        _library_folder_scan_status["shows_processed"] = []
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

        # Get existing shows to check for duplicates (before filtering)
        existing_shows = {s.tmdb_id: s for s in db.query(Show).all()}
        existing_folders = {s.folder_path: s for s in db.query(Show).all() if s.folder_path}

        # Separate already-imported folders from new ones
        new_dirs = []
        skipped_count = 0
        for d in show_dirs:
            if str(d) in existing_folders:
                skipped_count += 1
            else:
                new_dirs.append(d)

        total_dirs = len(show_dirs)
        _library_folder_scan_status["shows_found"] = total_dirs
        _library_folder_scan_status["shows_skipped"] = skipped_count

        # Apply limit to new (non-imported) directories only
        if limit and limit > 0:
            new_dirs = new_dirs[:limit]
            log(f"Found {total_dirs} directories ({skipped_count} already imported), scanning {len(new_dirs)} new")
        else:
            log(f"Found {total_dirs} directories ({skipped_count} already imported), scanning {len(new_dirs)} new")

        if len(new_dirs) == 0:
            update_status("No new show folders to scan", 100)
            _library_folder_scan_status["result"] = {
                "shows_found": total_dirs,
                "shows_added": 0,
                "shows_skipped": skipped_count,
                "episodes_matched": 0,
            }
            log(f"All {skipped_count} directories already imported, nothing to do")
            return

        # Create metadata services
        tmdb = TMDBService(api_key=api_key)
        tvdb = TVDBService(api_key=tvdb_api_key) if tvdb_api_key else None
        use_tvdb = metadata_source == "tvdb" and tvdb is not None

        scanner = ScannerService(db)

        scan_total = len(new_dirs)
        for i, show_dir in enumerate(new_dirs):
            progress = 10 + int((i / scan_total) * 80)  # 10-90%
            dir_name = show_dir.name

            update_status(f"Processing: {dir_name}", progress, dir_name)

            # Extract show name from folder
            show_name = scanner.detect_show_from_folder(str(show_dir))
            if not show_name:
                show_name = dir_name

            # Extract year from folder if present
            year_match = re.search(r'\(?(19|20)(\d{2})\)?$', dir_name)
            folder_year = int(year_match.group(1) + year_match.group(2)) if year_match else None

            source_label = "TVDB" if use_tvdb else "TMDB"
            log(f"Searching {source_label} for: '{show_name}'" + (f" ({folder_year})" if folder_year else ""))

            try:
                # Search using configured provider
                if use_tvdb:
                    tvdb_results = loop.run_until_complete(tvdb.search_shows(show_name))
                    results = tvdb_results
                else:
                    search_results = loop.run_until_complete(
                        tmdb.search_shows(show_name, year=folder_year)
                    )
                    results = search_results.get("results", [])

                    # If year-filtered search returned no results, try without year
                    if not results and folder_year:
                        log(f"No results with year filter, retrying without year...", "info")
                        search_results = loop.run_until_complete(tmdb.search_shows(show_name))
                        results = search_results.get("results", [])

                if not results:
                    log(f"No {source_label} results for '{show_name}'", "warning")
                    record_show(dir_name, show_name, "not_found", detail=f"No {source_label} results")
                    continue

                # Find best match using title similarity + year match
                # Score each result: exact title match + year match wins
                def normalize_title(t):
                    return re.sub(r'[^a-z0-9]', '', t.lower())

                folder_title_norm = normalize_title(show_name)
                best_match = None
                best_score = -1
                already_handled = False

                for result in results[:10]:  # Check top 10 results
                    result_year = None
                    if result.get("first_air_date"):
                        try:
                            result_year = int(result["first_air_date"][:4])
                        except (ValueError, TypeError):
                            pass

                    # Get the correct ID based on provider
                    if use_tvdb:
                        result_id = result.get("tvdb_id") or result.get("id")
                        # For TVDB, check existing by tvdb_id
                        existing_by_id = None
                        for s in existing_shows.values():
                            if s.tvdb_id == result_id:
                                existing_by_id = s
                                break
                    else:
                        result_id = result["id"]
                        existing_by_id = existing_shows.get(result_id)

                    # Check if already exists
                    if existing_by_id:
                        existing = existing_by_id
                        # If it exists but has no folder, assign this folder
                        if not existing.folder_path:
                            log(f"Assigning folder to existing show: '{existing.name}'", "info")
                            existing.folder_path = str(show_dir)
                            db.commit()
                            _library_folder_scan_status["shows_skipped"] += 1
                            # Scan for episodes
                            matched, total_files = _scan_show_folder(scanner, existing, show_dir)
                            _library_folder_scan_status["episodes_matched"] += matched
                            record_show(dir_name, existing.name, "existing", episodes_matched=matched, total_files=total_files, detail="Assigned folder")
                        else:
                            log(f"Skipping '{result['name']}' - already in library", "skip")
                            _library_folder_scan_status["shows_skipped"] += 1
                            record_show(dir_name, result['name'], "existing", detail="Already in library")
                        already_handled = True
                        break

                    # Calculate match score: title similarity (0-1) + year bonus (0.5)
                    result_title_norm = normalize_title(result.get("name", ""))

                    # Exact title match = 1.0, contains = 0.7, partial = lower
                    if result_title_norm == folder_title_norm:
                        title_score = 1.0
                    elif folder_title_norm in result_title_norm or result_title_norm in folder_title_norm:
                        # Prefer shorter matches (exact over partial)
                        title_score = 0.7 * min(len(folder_title_norm), len(result_title_norm)) / max(len(folder_title_norm), len(result_title_norm))
                    else:
                        title_score = 0.0

                    # Year match bonus
                    year_score = 0.5 if (folder_year and result_year == folder_year) else 0.0

                    # Year mismatch penalty (if folder has year but result doesn't match)
                    if folder_year and result_year and result_year != folder_year:
                        year_score = -0.5

                    total_score = title_score + year_score

                    if total_score > best_score:
                        best_score = total_score
                        best_match = result

                if already_handled:
                    continue

                # Require minimum score: year match (0.5) or decent title match (0.5)
                if best_match and best_score < 0.5:
                    log(f"Best match for '{show_name}' scored too low ({best_score:.2f}), skipping", "warning")
                    record_show(dir_name, show_name, "not_found", detail=f"No good match (best score: {best_score:.2f})")
                    best_match = None

                # If folder has a year but no result matched it, skip
                if folder_year and not best_match:
                    log(f"No {source_label} result matched year {folder_year} for '{show_name}', skipping", "warning")
                    record_show(dir_name, show_name, "not_found", detail=f"No match for year {folder_year}")

                if not best_match:
                    continue

                # Check again if best match exists (might have been a different result)
                best_match_id = best_match.get("tvdb_id") or best_match.get("id") if use_tvdb else best_match["id"]
                existing_check = None
                if use_tvdb:
                    for s in existing_shows.values():
                        if s.tvdb_id == best_match_id:
                            existing_check = s
                            break
                else:
                    existing_check = existing_shows.get(best_match_id)

                if existing_check:
                    if not existing_check.folder_path:
                        existing_check.folder_path = str(show_dir)
                        db.commit()
                        log(f"Assigned folder to existing show: '{existing_check.name}'", "info")
                        matched, total_files = _scan_show_folder(scanner, existing_check, show_dir)
                        _library_folder_scan_status["episodes_matched"] += matched
                        record_show(dir_name, existing_check.name, "existing", episodes_matched=matched, total_files=total_files, detail="Assigned folder")
                    else:
                        log(f"Skipping '{best_match['name']}' - already in library", "skip")
                        record_show(dir_name, best_match['name'], "existing", detail="Already in library")
                    _library_folder_scan_status["shows_skipped"] += 1
                    continue

                # Add new show
                if use_tvdb:
                    fetch_id = best_match.get("tvdb_id") or best_match.get("id")
                    log(f"Adding show: '{best_match['name']}' (TVDB ID: {fetch_id})")
                else:
                    fetch_id = best_match["id"]
                    log(f"Adding show: '{best_match['name']}' (TMDB ID: {fetch_id})")

                try:
                    if use_tvdb:
                        show_data = loop.run_until_complete(tvdb.get_show_with_episodes(fetch_id))
                    else:
                        show_data = loop.run_until_complete(tmdb.get_show_with_episodes(fetch_id))

                    # Create show
                    show = Show(
                        tmdb_id=show_data.get("tmdb_id"),
                        tvdb_id=show_data.get("tvdb_id"),
                        imdb_id=show_data.get("imdb_id"),
                        metadata_source=metadata_source,
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
                    if show.tmdb_id:
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
                    matched, total_files = _scan_show_folder(scanner, show, show_dir)
                    _library_folder_scan_status["episodes_matched"] += matched
                    if matched > 0:
                        log(f"Matched {matched} episode files ({total_files} files in folder)", "success")

                    total_eps = show_data.get('number_of_episodes', 0)
                    extra = total_files - matched
                    detail = f"{matched}/{total_eps} episodes matched"
                    if extra > 0:
                        detail += f", {extra} extra file{'s' if extra != 1 else ''} in folder"
                    record_show(dir_name, show.name, "added", episodes_matched=matched, total_episodes=total_eps, total_files=total_files, detail=detail)

                except Exception as e:
                    log(f"Error adding show '{best_match['name']}': {str(e)}", "error")
                    record_show(dir_name, best_match['name'], "error", detail=str(e))
                    db.rollback()

                # Small delay to avoid API rate limiting
                time.sleep(0.3)

            except Exception as e:
                log(f"Error searching for '{show_name}': {str(e)}", "error")
                record_show(dir_name, show_name, "error", detail=str(e))

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
            "shows_processed": _library_folder_scan_status["shows_processed"],
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
        watcher_service.release_scan_lock()


def _scan_show_folder(scanner: ScannerService, show, show_dir: Path) -> tuple[int, int]:
    """Scan a show's folder for video files and match to episodes.

    Returns (matched_count, total_files) tuple.
    """
    import re
    from datetime import datetime
    from ..models import Episode

    matched_count = 0

    # Reset episodes whose recorded file no longer exists on disk so they
    # can be re-matched against the actual files found during the scan.
    stale_episodes = (
        scanner.db.query(Episode)
        .filter(
            Episode.show_id == show.id,
            Episode.file_path.isnot(None),
            Episode.file_status.in_(["found", "renamed"]),
        )
        .all()
    )
    for ep in stale_episodes:
        if not Path(ep.file_path).exists():
            ep.file_path = None
            ep.file_status = "missing"
            ep.matched_at = None

    files = scanner.scan_folder(str(show_dir))
    total_files = len(files)

    for file_info in files:
        if file_info.parsed and file_info.parsed.episode:
            season = file_info.parsed.season
            # If file is in a Specials folder, treat as Season 0
            in_specials_folder = False
            file_path = Path(file_info.path)
            for parent in file_path.parents:
                if parent.name.lower() in ("specials", "season 0", "season 00"):
                    season = 0
                    in_specials_folder = True
                    break
                if str(parent) == str(show_dir):
                    break

            # If no season detected but we have an episode, skip
            if season is None:
                continue

            # Get episode range (for multi-episode files)
            start_ep = file_info.parsed.episode
            end_ep = file_info.parsed.episode_end or file_info.parsed.episode

            # Mark all episodes in range as found
            for ep_num in range(start_ep, end_ep + 1):
                episode = (
                    scanner.db.query(Episode)
                    .filter(
                        Episode.show_id == show.id,
                        Episode.season == season,
                        Episode.episode == ep_num,
                    )
                    .first()
                )

                if episode and episode.file_status == "missing":
                    episode.file_path = file_info.path
                    episode.file_status = "found"
                    episode.matched_at = datetime.utcnow()
                    matched_count += 1
                elif not episode and in_specials_folder:
                    # Create Season 0 episode from file if it doesn't exist in TMDB
                    title = file_info.parsed.title or file_info.filename
                    # Clean up title from filename
                    title = re.sub(r'^\d+[xX]\d+\s*[-–]\s*', '', title)
                    title = re.sub(r'\.[^.]+$', '', title)  # Remove extension
                    title = title.strip() or f"Special {ep_num}"

                    episode = Episode(
                        show_id=show.id,
                        season=0,
                        episode=ep_num,
                        title=title,
                        file_path=file_info.path,
                        file_status="found",
                        matched_at=datetime.utcnow(),
                    )
                    scanner.db.add(episode)
                    matched_count += 1

    if matched_count > 0:
        scanner.db.commit()

    return matched_count, total_files


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

    # Get API keys
    api_key_setting = db.query(AppSettings).filter(AppSettings.key == "tmdb_api_key").first()
    tvdb_key_setting = db.query(AppSettings).filter(AppSettings.key == "tvdb_api_key").first()

    tmdb_key = api_key_setting.value if api_key_setting else ""
    tvdb_key = tvdb_key_setting.value if tvdb_key_setting else ""

    # Get default metadata source
    source_setting = db.query(AppSettings).filter(AppSettings.key == "default_metadata_source").first()
    metadata_source = source_setting.value if source_setting else "tmdb"

    if metadata_source == "tvdb" and not tvdb_key:
        raise HTTPException(status_code=400, detail="TVDB API key not configured")
    if metadata_source == "tmdb" and not tmdb_key:
        raise HTTPException(status_code=400, detail="TMDB API key not configured")

    from ..database import get_session_maker

    background_tasks.add_task(
        run_library_folder_discovery,
        get_session_maker,
        data.folder_id,
        tmdb_key,
        data.limit,
        metadata_source,
        tvdb_key,
    )

    limit_msg = f" (limit: {data.limit})" if data.limit else ""
    return {"message": f"Library folder scan started{limit_msg}", "status": "running", "folder_id": data.folder_id}


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

    episode_ids: list[int] = []
    show_ids: list[int] = []


@router.post("/selected-episodes")
async def scan_selected_episodes(
    data: ScanSelectedRequest,
    db: Session = Depends(get_db),
):
    """Scan for specific episodes and/or shows.

    When episode_ids are provided, looks in their show folders for matching files.
    When show_ids are provided, runs a folder scan for those shows.
    """
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

    # Scan each show's folder for episode matches
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

    # Handle show_ids: scan full show folders
    shows_scanned = 0
    for show_id in data.show_ids:
        # Skip shows already scanned via episode_ids
        if show_id in episodes_by_show:
            continue

        show = db.query(Show).filter(Show.id == show_id).first()
        if not show:
            errors.append(f"Show ID {show_id} not found")
            continue

        if not show.folder_path:
            results.append({
                "show_name": show.name,
                "status": "no_folder",
                "message": "Show has no folder path configured"
            })
            continue

        matched_count, total_files = _scan_show_folder(scanner, show, Path(show.folder_path))
        found += matched_count
        shows_scanned += 1

        results.append({
            "show_name": show.name,
            "status": "scanned",
            "message": f"Scanned: {matched_count} episodes matched from {total_files} files"
        })

    db.commit()

    total_items = len(data.episode_ids) + len(data.show_ids)
    return {
        "message": f"Scanned {total_items} items: {found} found, {not_found} not found",
        "found": found,
        "not_found": not_found,
        "shows_scanned": shows_scanned,
        "errors": errors,
        "results": results
    }


# ── Library Log endpoints ─────────────────────────────────────────


@router.get("/library-log")
async def get_library_log(
    db: Session = Depends(get_db),
    limit: Optional[int] = Query(default=None, ge=1),
    offset: int = Query(default=0, ge=0),
    date_from: Optional[str] = Query(default=None),
    date_to: Optional[str] = Query(default=None),
):
    """Get library log entries with optional date filtering."""
    query = db.query(LibraryLog).order_by(LibraryLog.timestamp.desc())

    if date_from:
        try:
            dt = datetime.fromisoformat(date_from)
            query = query.filter(LibraryLog.timestamp >= dt)
        except ValueError:
            pass

    if date_to:
        try:
            dt = datetime.fromisoformat(date_to)
            query = query.filter(LibraryLog.timestamp <= dt)
        except ValueError:
            pass

    total = query.count()
    if offset:
        query = query.offset(offset)
    if limit is not None:
        query = query.limit(limit)
    entries = query.all()

    return {
        "total": total,
        "entries": [e.to_dict() for e in entries],
    }


@router.delete("/library-log")
async def clear_library_log(db: Session = Depends(get_db)):
    """Delete all library log entries."""
    count = db.query(LibraryLog).count()
    db.query(LibraryLog).delete()
    db.commit()
    return {"message": f"Deleted {count} log entries", "deleted": count}


@router.delete("/library-log/range/{start}/{end}")
async def delete_library_log_range(start: str, end: str, db: Session = Depends(get_db)):
    """Delete all library log entries within a timestamp range (inclusive)."""
    try:
        dt_start = datetime.fromisoformat(start)
        dt_end = datetime.fromisoformat(end)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid date format. Use ISO format.")

    query = db.query(LibraryLog).filter(
        LibraryLog.timestamp >= dt_start,
        LibraryLog.timestamp <= dt_end,
    )
    count = query.count()
    query.delete(synchronize_session=False)
    db.commit()
    return {"message": f"Deleted {count} log entries", "deleted": count}


@router.delete("/library-log/{entry_id}")
async def delete_library_log_entry(entry_id: int, db: Session = Depends(get_db)):
    """Delete a single library log entry by ID."""
    entry = db.query(LibraryLog).filter(LibraryLog.id == entry_id).first()
    if not entry:
        raise HTTPException(status_code=404, detail="Log entry not found")
    db.delete(entry)
    db.commit()
    return {"message": "Log entry deleted", "deleted": 1}


# ── Movie scan endpoints ──────────────────────────────────────────

_movie_scan_status = {
    "running": False,
    "progress": 0,
    "message": "",
    "result": None,
}

_movie_discovery_status = {
    "running": False,
    "progress": 0,
    "message": "",
    "discovered": [],
    "result": None,
}


def run_movie_library_scan(db_session_maker):
    """Background task to scan movie library."""
    global _movie_scan_status
    import time

    time.sleep(0.3)

    SessionLocal = db_session_maker()
    db = SessionLocal()

    try:
        from ..services.movie_scanner import MovieScannerService

        _movie_scan_status["running"] = True
        _movie_scan_status["result"] = None

        scanner = MovieScannerService(db)

        def update_progress(message, percent):
            _movie_scan_status["message"] = message
            _movie_scan_status["progress"] = percent

        result = scanner.scan_movie_library(progress_callback=update_progress)

        _movie_scan_status["result"] = {
            "movies_matched": result.movies_matched,
            "movies_missing": result.movies_missing,
            "unmatched_files": len(result.unmatched_files),
            "rename_previews": len(result.rename_previews),
        }
        _movie_scan_status["message"] = "Complete"
        _movie_scan_status["progress"] = 100

    except Exception as e:
        _movie_scan_status["message"] = f"Error: {e}"
        _movie_scan_status["result"] = {"error": str(e)}
    finally:
        _movie_scan_status["running"] = False
        db.close()


@router.post("/movies")
async def scan_movie_library(
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
):
    """Scan movie library (match files to existing movies)."""
    global _movie_scan_status

    if _movie_scan_status["running"]:
        raise HTTPException(status_code=400, detail="Movie scan already in progress")

    _movie_scan_status = {
        "running": True,
        "progress": 0,
        "message": "Starting movie scan...",
        "result": None,
    }

    from ..database import get_session_maker

    background_tasks.add_task(run_movie_library_scan, get_session_maker)

    return {"message": "Movie scan started", "status": "running"}


@router.get("/movies/status")
async def get_movie_scan_status():
    """Get movie scan status."""
    return _movie_scan_status


@router.post("/movie/{movie_id}")
async def scan_single_movie(
    movie_id: int,
    db: Session = Depends(get_db),
):
    """Scan for a single movie's file."""
    from ..models import Movie
    from ..services.movie_scanner import MovieScannerService

    movie = db.query(Movie).filter(Movie.id == movie_id).first()
    if not movie:
        raise HTTPException(status_code=404, detail="Movie not found")

    scanner = MovieScannerService(db)
    result = scanner.scan_single_movie(movie)

    return {
        "movies_matched": result.movies_matched,
        "movies_missing": result.movies_missing,
    }


def run_movie_library_discovery(db_session_maker, folder_id: int, tmdb_api_key: str, limit: int = None):
    """Background task to discover movies from a folder."""
    global _movie_discovery_status
    import time
    import asyncio

    time.sleep(0.3)

    SessionLocal = db_session_maker()
    db = SessionLocal()

    loop = asyncio.new_event_loop()
    asyncio.set_event_loop(loop)

    try:
        from ..models import Movie, ScanFolder
        from ..services.movie_scanner import MovieScannerService
        from ..services.tmdb import TMDBService
        from ..services.movie_matcher import MovieMatcherService

        _movie_discovery_status["running"] = True
        _movie_discovery_status["discovered"] = []
        _movie_discovery_status["result"] = None

        folder = db.query(ScanFolder).filter(ScanFolder.id == folder_id).first()
        if not folder:
            _movie_discovery_status["message"] = "Folder not found"
            return

        scanner = MovieScannerService(db)
        tmdb = TMDBService(api_key=tmdb_api_key)
        matcher = MovieMatcherService()

        def update_progress(message, percent):
            _movie_discovery_status["message"] = message
            _movie_discovery_status["progress"] = percent

        # Discover files
        discovered_files = scanner.discover_movie_folder(folder.path, progress_callback=update_progress)

        if limit and limit > 0:
            discovered_files = discovered_files[:limit]

        _movie_discovery_status["message"] = f"Found {len(discovered_files)} potential movies, searching TMDB..."

        added = 0
        skipped = 0
        errors = 0

        for i, file_info in enumerate(discovered_files):
            title = file_info["parsed_title"]
            year = file_info.get("parsed_year")

            _movie_discovery_status["progress"] = int((i / max(len(discovered_files), 1)) * 100)
            _movie_discovery_status["message"] = f"Searching: {title}"

            try:
                search_results = loop.run_until_complete(
                    tmdb.search_movies(title, year=year)
                )
                results = search_results.get("results", [])

                if not results and year:
                    search_results = loop.run_until_complete(tmdb.search_movies(title))
                    results = search_results.get("results", [])

                if not results:
                    skipped += 1
                    _movie_discovery_status["discovered"].append({
                        "filename": file_info["filename"],
                        "title": title,
                        "status": "not_found",
                    })
                    continue

                # Pick best match
                best = results[0]
                for r in results[:5]:
                    r_title = r.get("title", "")
                    r_date = r.get("release_date", "")
                    r_year = int(r_date[:4]) if r_date and len(r_date) >= 4 else None
                    score = matcher.match_movie_title(title, r_title, year, r_year)
                    if score > matcher.match_movie_title(title, best.get("title", ""), year,
                        int(best.get("release_date", "")[:4]) if best.get("release_date") and len(best.get("release_date", "")) >= 4 else None):
                        best = r

                tmdb_id = best.get("id")

                # Check if already in DB
                existing = db.query(Movie).filter(Movie.tmdb_id == tmdb_id).first()
                if existing:
                    # Update file path if not set
                    if not existing.file_path:
                        existing.file_path = file_info["path"]
                        existing.file_status = "found"
                        from datetime import datetime
                        existing.matched_at = datetime.utcnow()
                        db.commit()
                    skipped += 1
                    _movie_discovery_status["discovered"].append({
                        "filename": file_info["filename"],
                        "title": existing.title,
                        "status": "existing",
                    })
                    continue

                # Fetch full details and add
                movie_data = loop.run_until_complete(tmdb.get_movie_with_details(tmdb_id))

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
                    file_path=file_info["path"],
                    folder_path=folder.path,
                    file_status="found",
                    edition=file_info.get("edition"),
                )
                from datetime import datetime
                movie.matched_at = datetime.utcnow()

                db.add(movie)
                db.commit()
                added += 1

                _movie_discovery_status["discovered"].append({
                    "filename": file_info["filename"],
                    "title": movie.title,
                    "year": movie.year,
                    "status": "added",
                })

                time.sleep(0.3)  # Rate limiting

            except Exception as e:
                errors += 1
                _movie_discovery_status["discovered"].append({
                    "filename": file_info["filename"],
                    "title": title,
                    "status": "error",
                    "error": str(e),
                })

        _movie_discovery_status["result"] = {
            "added": added,
            "skipped": skipped,
            "errors": errors,
            "total": len(discovered_files),
        }
        _movie_discovery_status["message"] = f"Complete: {added} added, {skipped} skipped, {errors} errors"
        _movie_discovery_status["progress"] = 100

    except Exception as e:
        _movie_discovery_status["message"] = f"Error: {e}"
        _movie_discovery_status["result"] = {"error": str(e)}
    finally:
        _movie_discovery_status["running"] = False
        try:
            loop.run_until_complete(loop.shutdown_asyncgens())
        except Exception:
            pass
        loop.close()
        db.close()


class MovieLibraryFolderScanRequest(BaseModel):
    """Request model for scanning a movie library folder for new movies."""

    folder_id: int
    limit: Optional[int] = None


@router.post("/movie-library-folder")
async def scan_movie_library_folder(
    data: MovieLibraryFolderScanRequest,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
):
    """Discover and add movies from a movie library folder."""
    global _movie_discovery_status

    if _movie_discovery_status["running"]:
        raise HTTPException(status_code=400, detail="Movie discovery scan already in progress")

    # Get TMDB API key
    from ..models import AppSettings
    tmdb_key_setting = db.query(AppSettings).filter(AppSettings.key == "tmdb_api_key").first()
    tmdb_key = tmdb_key_setting.value if tmdb_key_setting else ""
    if not tmdb_key:
        raise HTTPException(status_code=400, detail="TMDB API key not configured")

    _movie_discovery_status = {
        "running": True,
        "progress": 0,
        "message": "Starting movie discovery...",
        "discovered": [],
        "result": None,
    }

    from ..database import get_session_maker

    background_tasks.add_task(
        run_movie_library_discovery,
        get_session_maker,
        data.folder_id,
        tmdb_key,
        limit=data.limit,
    )

    return {"message": "Movie discovery scan started", "status": "running"}


@router.get("/movie-library-folder/status")
async def get_movie_discovery_status():
    """Get the status of the movie library folder discovery scan."""
    return _movie_discovery_status


@router.get("/movie-rename-previews")
async def get_movie_rename_previews(db: Session = Depends(get_db)):
    """Get pending movie rename previews."""
    from ..services.movie_scanner import MovieScannerService
    from ..models import AppSettings

    scanner = MovieScannerService(db)

    movie_format_setting = db.query(AppSettings).filter(AppSettings.key == "movie_format").first()
    movie_format = movie_format_setting.value if movie_format_setting else "{title} ({year})/{title} ({year})"

    previews = scanner.compute_movie_rename_previews(movie_format)
    return previews


@router.post("/apply-movie-renames")
async def apply_movie_renames(db: Session = Depends(get_db)):
    """Execute movie file renames."""
    from ..models import Movie, AppSettings
    from ..services.movie_renamer import MovieRenamerService

    renamer = MovieRenamerService(db)

    movie_format_setting = db.query(AppSettings).filter(AppSettings.key == "movie_format").first()
    movie_format = movie_format_setting.value if movie_format_setting else "{title} ({year})/{title} ({year})"

    movies = (
        db.query(Movie)
        .filter(
            Movie.do_rename == True,
            Movie.file_path.isnot(None),
            Movie.file_status.in_(["found", "renamed"]),
        )
        .all()
    )

    results = []
    success_count = 0
    error_count = 0

    for movie in movies:
        preview = renamer.compute_movie_rename_preview(movie, movie_format)
        if not preview:
            continue

        result = renamer.move_movie_file(preview["current_path"], preview["expected_path"])
        if result.success:
            movie.file_path = result.dest_path
            movie.file_status = "renamed"
            success_count += 1

            log_library_event(
                db,
                action_type="rename",
                result="success",
                file_path=result.source_path,
                dest_path=result.dest_path,
                movie_title=movie.title,
                movie_id=movie.id,
                media_type="movie",
                details=f"Renamed: {Path(result.source_path).name} → {Path(result.dest_path).name}",
            )
        else:
            error_count += 1

            log_library_event(
                db,
                action_type="rename_failed",
                result="failed",
                file_path=result.source_path,
                movie_title=movie.title,
                movie_id=movie.id,
                media_type="movie",
                details=f"Rename failed: {result.error}",
            )

        results.append({
            "movie_id": movie.id,
            "movie_title": movie.title,
            "success": result.success,
            "source_path": result.source_path,
            "dest_path": result.dest_path,
            "error": result.error,
        })

    db.commit()

    return {
        "message": f"Renamed {success_count} movies, {error_count} errors",
        "success_count": success_count,
        "error_count": error_count,
        "results": results,
    }
