"""API endpoints for scanning operations."""

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


def run_library_scan(db_session_maker, quick_scan: bool = False):
    """Background task for library scan.

    Args:
        quick_scan: If True, only scan ongoing shows (not Canceled/Ended).
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

    scan_type = "quick" if quick_scan else "full"

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
        result = scanner.scan_library(quick_scan=quick_scan, progress_callback=update_progress)

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

    background_tasks.add_task(run_library_scan, get_session_maker, False)

    return {"message": "Full scan started", "status": "running"}


@router.post("/quick")
async def trigger_quick_scan(
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
):
    """Trigger a quick scan of ongoing shows only (library + downloads)."""
    global _scan_status

    if _scan_status["running"]:
        raise HTTPException(status_code=400, detail="Scan already in progress")

    from ..database import get_session_maker

    background_tasks.add_task(run_library_scan, get_session_maker, True)

    return {"message": "Quick scan started", "status": "running"}


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
    from ..models import Show, Episode

    today = datetime.utcnow().strftime("%Y-%m-%d")

    # Get missing episodes that have aired, joined with show info
    missing_episodes = (
        db.query(Episode, Show)
        .join(Show, Episode.show_id == Show.id)
        .filter(
            Episode.file_status == "missing",
            Episode.air_date <= today,
            Episode.air_date != None,
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
