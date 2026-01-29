"""API endpoints for media watcher operations."""

import json
import logging
from datetime import datetime
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy.orm import Session

from ..database import get_db, get_session_maker
from ..models import ScanFolder, AppSettings, WatcherLog
from ..services.watcher import watcher_service
from ..services.quality import QualityService
from ..services.watcher_pipeline import WatcherPipeline

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api", tags=["watcher"])


# ── Helpers ─────────────────────────────────────────────────────────

def get_setting(db: Session, key: str, default: str = "") -> str:
    setting = db.query(AppSettings).filter(AppSettings.key == key).first()
    return setting.value if setting else default


def set_setting(db: Session, key: str, value: str) -> None:
    setting = db.query(AppSettings).filter(AppSettings.key == key).first()
    if setting:
        setting.value = value
    else:
        setting = AppSettings(key=key, value=value)
        db.add(setting)
    db.commit()


def log_watcher_event(
    db: Session,
    action_type: str,
    result: str = "success",
    file_path: str = None,
    show_name: str = None,
    show_id: int = None,
    episode_code: str = None,
    details: str = None,
):
    """Write an entry to the watcher_log table."""
    entry = WatcherLog(
        action_type=action_type,
        file_path=file_path,
        show_name=show_name,
        show_id=show_id,
        episode_code=episode_code,
        result=result,
        details=details,
    )
    db.add(entry)
    db.commit()


# ── Default settings values ─────────────────────────────────────────

WATCHER_DEFAULTS = {
    "watcher_enabled": "false",
    "watcher_issues_folder": "",
    "watcher_monitor_subfolders": "true",
    "watcher_delete_empty_folders": "false",
    "watcher_min_file_size_mb": "50",
    "watcher_issues_organization": "date",
    "watcher_auto_purge_days": "0",
    "watcher_companion_types": json.dumps([".srt", ".sub", ".ass", ".ssa", ".vtt", ".idx", ".sup", ".nfo"]),
    "watcher_quality_priorities": json.dumps([
        {"factor": "resolution", "points": 100},
        {"factor": "bitrate", "points": 80},
        {"factor": "video_codec", "points": 60},
        {"factor": "audio_codec", "points": 40},
        {"factor": "audio_channels", "points": 20},
        {"factor": "subtitles", "points": 10},
    ]),
}


# ── Request models ──────────────────────────────────────────────────

class WatcherSettingsUpdate(BaseModel):
    watcher_issues_folder: Optional[str] = None
    watcher_monitor_subfolders: Optional[bool] = None
    watcher_delete_empty_folders: Optional[bool] = None
    watcher_min_file_size_mb: Optional[int] = None
    watcher_issues_organization: Optional[str] = None
    watcher_auto_purge_days: Optional[int] = None
    watcher_companion_types: Optional[list[str]] = None
    watcher_quality_priorities: Optional[list[dict]] = None


# ── Watcher status ──────────────────────────────────────────────────

@router.get("/watcher/status")
async def get_watcher_status(db: Session = Depends(get_db)):
    """Get current watcher status and prerequisites."""
    status = watcher_service.get_status()

    # Add prerequisite info
    prerequisites = _check_prerequisites(db)
    status["prerequisites"] = prerequisites
    status["all_prerequisites_met"] = all(p["met"] for p in prerequisites)
    status["enabled"] = get_setting(db, "watcher_enabled", "false") == "true"

    return status


# ── Watcher start/stop ──────────────────────────────────────────────

@router.post("/watcher/start")
async def start_watcher(db: Session = Depends(get_db)):
    """Start the media watcher after validating prerequisites."""
    prerequisites = _check_prerequisites(db)
    unmet = [p for p in prerequisites if not p["met"]]

    if unmet:
        names = ", ".join(p["name"] for p in unmet)
        raise HTTPException(
            status_code=400,
            detail=f"Prerequisites not met: {names}",
        )

    if watcher_service.is_running:
        return {"message": "Watcher is already running", "status": "running"}

    # Configure watcher from settings
    _configure_watcher(db)

    # Add download folders
    download_folders = (
        db.query(ScanFolder)
        .filter(ScanFolder.folder_type == "download", ScanFolder.enabled == True)
        .all()
    )
    for folder in download_folders:
        watcher_service.add_watch_folder(folder.path)

    watcher_service.start()

    # Mark as enabled
    set_setting(db, "watcher_enabled", "true")

    # Log the event
    log_watcher_event(db, "watcher_started", details="Watcher started by user")

    return {"message": "Watcher started", "status": "running"}


@router.post("/watcher/stop")
async def stop_watcher(db: Session = Depends(get_db)):
    """Stop the media watcher."""
    if not watcher_service.is_running:
        return {"message": "Watcher is not running", "status": "stopped"}

    watcher_service.stop()
    set_setting(db, "watcher_enabled", "false")

    log_watcher_event(db, "watcher_stopped", details="Watcher stopped by user")

    return {"message": "Watcher stopped", "status": "stopped"}


# ── Watcher settings ───────────────────────────────────────────────

@router.get("/watcher/settings")
async def get_watcher_settings(db: Session = Depends(get_db)):
    """Get all watcher settings."""
    result = {}
    for key, default in WATCHER_DEFAULTS.items():
        raw = get_setting(db, key, default)
        # Parse JSON values
        if key in ("watcher_companion_types", "watcher_quality_priorities"):
            try:
                result[key] = json.loads(raw)
            except (json.JSONDecodeError, TypeError):
                result[key] = json.loads(default)
        elif key in ("watcher_monitor_subfolders", "watcher_delete_empty_folders", "watcher_enabled"):
            result[key] = raw == "true"
        elif key in ("watcher_min_file_size_mb", "watcher_auto_purge_days"):
            try:
                result[key] = int(raw)
            except (ValueError, TypeError):
                result[key] = int(default)
        else:
            result[key] = raw

    # Also include enabled state
    result["watcher_enabled"] = get_setting(db, "watcher_enabled", "false") == "true"

    return result


@router.put("/watcher/settings")
async def update_watcher_settings(
    data: WatcherSettingsUpdate,
    db: Session = Depends(get_db),
):
    """Update watcher settings."""
    if data.watcher_issues_folder is not None:
        # Validate path exists or is empty
        if data.watcher_issues_folder:
            path = Path(data.watcher_issues_folder)
            if not path.exists():
                # Create it
                try:
                    path.mkdir(parents=True, exist_ok=True)
                except OSError as e:
                    raise HTTPException(status_code=400, detail=f"Cannot create issues folder: {e}")
        set_setting(db, "watcher_issues_folder", data.watcher_issues_folder)
        watcher_service.set_issues_folder(data.watcher_issues_folder)

    if data.watcher_monitor_subfolders is not None:
        set_setting(db, "watcher_monitor_subfolders", "true" if data.watcher_monitor_subfolders else "false")
        watcher_service.set_monitor_subfolders(data.watcher_monitor_subfolders)

    if data.watcher_delete_empty_folders is not None:
        set_setting(db, "watcher_delete_empty_folders", "true" if data.watcher_delete_empty_folders else "false")

    if data.watcher_min_file_size_mb is not None:
        val = max(0, data.watcher_min_file_size_mb)
        set_setting(db, "watcher_min_file_size_mb", str(val))
        watcher_service.set_min_file_size(val)

    if data.watcher_issues_organization is not None:
        if data.watcher_issues_organization in ("date", "reason", "flat"):
            set_setting(db, "watcher_issues_organization", data.watcher_issues_organization)

    if data.watcher_auto_purge_days is not None:
        val = max(0, data.watcher_auto_purge_days)
        set_setting(db, "watcher_auto_purge_days", str(val))
        watcher_service.set_auto_purge_days(val)

    if data.watcher_companion_types is not None:
        set_setting(db, "watcher_companion_types", json.dumps(data.watcher_companion_types))

    if data.watcher_quality_priorities is not None:
        set_setting(db, "watcher_quality_priorities", json.dumps(data.watcher_quality_priorities))

    return await get_watcher_settings(db)


# ── Watcher log ─────────────────────────────────────────────────────

@router.get("/watcher/log")
async def get_watcher_log(
    db: Session = Depends(get_db),
    limit: int = Query(default=100, ge=1, le=1000),
    offset: int = Query(default=0, ge=0),
    date_from: Optional[str] = Query(default=None),
    date_to: Optional[str] = Query(default=None),
):
    """Get watcher log entries with optional date filtering."""
    query = db.query(WatcherLog).order_by(WatcherLog.timestamp.desc())

    if date_from:
        try:
            dt = datetime.fromisoformat(date_from)
            query = query.filter(WatcherLog.timestamp >= dt)
        except ValueError:
            pass

    if date_to:
        try:
            dt = datetime.fromisoformat(date_to)
            query = query.filter(WatcherLog.timestamp <= dt)
        except ValueError:
            pass

    total = query.count()
    entries = query.offset(offset).limit(limit).all()

    return {
        "total": total,
        "entries": [e.to_dict() for e in entries],
    }


# ── Prerequisites validation ────────────────────────────────────────

@router.post("/watcher/validate-prerequisites")
async def validate_prerequisites(db: Session = Depends(get_db)):
    """Check all prerequisites for the watcher."""
    prerequisites = _check_prerequisites(db)
    return {
        "prerequisites": prerequisites,
        "all_met": all(p["met"] for p in prerequisites),
    }


def _check_prerequisites(db: Session) -> list[dict]:
    """Check all watcher prerequisites."""
    results = []

    # 1. Issues folder configured and exists
    issues_folder = get_setting(db, "watcher_issues_folder", "")
    issues_ok = bool(issues_folder) and Path(issues_folder).is_dir()
    results.append({
        "name": "Issues Folder",
        "key": "issues_folder",
        "met": issues_ok,
        "detail": issues_folder if issues_folder else "Not configured",
    })

    # 2. At least one library folder
    library_folders = (
        db.query(ScanFolder)
        .filter(ScanFolder.folder_type == "library", ScanFolder.enabled == True)
        .all()
    )
    results.append({
        "name": "Library Folder",
        "key": "library_folder",
        "met": len(library_folders) > 0,
        "detail": f"{len(library_folders)} folder(s)" if library_folders else "None configured",
    })

    # 3. At least one download folder
    download_folders = (
        db.query(ScanFolder)
        .filter(ScanFolder.folder_type == "download", ScanFolder.enabled == True)
        .all()
    )
    results.append({
        "name": "Download Folder",
        "key": "download_folder",
        "met": len(download_folders) > 0,
        "detail": f"{len(download_folders)} folder(s)" if download_folders else "None configured",
    })

    # 4. ffprobe available
    ffprobe_ok = QualityService.is_available()
    results.append({
        "name": "ffprobe",
        "key": "ffprobe",
        "met": ffprobe_ok,
        "detail": QualityService.get_ffprobe_path() or "Not found (install ffmpeg)",
    })

    return results


def _make_pipeline_callback():
    """Create a callback that processes files through the watcher pipeline.

    Each invocation opens a fresh DB session (the callback runs in the
    watcher's background maturity thread, not in a request context).
    """

    def callback(file_path: str):
        session_factory = get_session_maker()
        db = session_factory()
        try:
            pipeline = WatcherPipeline(db)
            pipeline.process_file(file_path)
        except Exception as e:
            logger.error(f"Pipeline callback error: {e}", exc_info=True)
            db.rollback()
        finally:
            db.close()

    return callback


def _configure_watcher(db: Session):
    """Apply stored settings to the watcher service instance."""
    monitor_subfolders = get_setting(db, "watcher_monitor_subfolders", "true") == "true"
    watcher_service.set_monitor_subfolders(monitor_subfolders)

    try:
        min_size = int(get_setting(db, "watcher_min_file_size_mb", "50"))
    except ValueError:
        min_size = 50
    watcher_service.set_min_file_size(min_size)

    # Auto-purge settings
    try:
        purge_days = int(get_setting(db, "watcher_auto_purge_days", "0"))
    except ValueError:
        purge_days = 0
    watcher_service.set_auto_purge_days(purge_days)
    watcher_service.set_issues_folder(get_setting(db, "watcher_issues_folder", ""))

    # Set the pipeline callback
    watcher_service.set_callback(_make_pipeline_callback())


def auto_start_watcher(db: Session):
    """Auto-start the watcher if it was previously enabled. Called during app startup."""
    enabled = get_setting(db, "watcher_enabled", "false") == "true"
    if not enabled:
        logger.info("Watcher auto-start: disabled in settings")
        return

    prerequisites = _check_prerequisites(db)
    unmet = [p for p in prerequisites if not p["met"]]
    if unmet:
        names = ", ".join(p["name"] for p in unmet)
        logger.warning(f"Watcher auto-start: prerequisites not met ({names})")
        return

    _configure_watcher(db)

    download_folders = (
        db.query(ScanFolder)
        .filter(ScanFolder.folder_type == "download", ScanFolder.enabled == True)
        .all()
    )
    for folder in download_folders:
        watcher_service.add_watch_folder(folder.path)

    watcher_service.start()
    log_watcher_event(db, "watcher_started", details="Auto-started on app launch")
    logger.info("Watcher auto-started successfully")
