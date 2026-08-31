"""API endpoints for media watcher operations."""

import json
import logging
from datetime import datetime
from pathlib import Path, PurePath
from typing import Optional

from fastapi import APIRouter, Body, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import ScanFolder, AppSettings, WatcherLog, current_tenant_id
from ..services.watch_manager import watch_manager
from ..services.quality import QualityService
from ..services.storage import StorageError, storage_for_path

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
def get_watcher_status(db: Session = Depends(get_db)):
    """Get current watcher status and prerequisites. Sync: prerequisites touch storage."""
    status = watch_manager.status(current_tenant_id.get())

    # Add prerequisite info
    prerequisites = _check_prerequisites(db)
    status["prerequisites"] = prerequisites
    status["all_prerequisites_met"] = all(p["met"] for p in prerequisites)
    status["enabled"] = get_setting(db, "watcher_enabled", "false") == "true"

    return status


# ── Watcher start/stop ──────────────────────────────────────────────

@router.post("/watcher/start")
def start_watcher(db: Session = Depends(get_db)):
    """Start the media watcher after validating prerequisites."""
    prerequisites = _check_prerequisites(db)
    unmet = [p for p in prerequisites if not p["met"]]

    if unmet:
        names = ", ".join(p["name"] for p in unmet)
        raise HTTPException(
            status_code=400,
            detail=f"Prerequisites not met: {names}",
        )

    tenant_id = current_tenant_id.get()
    if watch_manager.is_running(tenant_id):
        return {"message": "Watcher is already running", "status": "running"}

    try:
        watch_manager.start(db, tenant_id)
    except RuntimeError as e:
        log_watcher_event(db, "watcher_started", result="failure", details=str(e))
        raise HTTPException(status_code=400, detail=str(e))

    # Mark as enabled
    set_setting(db, "watcher_enabled", "true")

    # Log the event
    log_watcher_event(db, "watcher_started", details="Watcher started by user")

    return {"message": "Watcher started", "status": "running"}


@router.post("/watcher/stop")
def stop_watcher(db: Session = Depends(get_db)):
    """Stop the media watcher."""
    tenant_id = current_tenant_id.get()
    if not watch_manager.is_running(tenant_id):
        return {"message": "Watcher is not running", "status": "stopped"}

    watch_manager.stop(tenant_id)
    set_setting(db, "watcher_enabled", "false")

    log_watcher_event(db, "watcher_stopped", details="Watcher stopped by user")

    return {"message": "Watcher stopped", "status": "stopped"}


# ── Watcher settings ───────────────────────────────────────────────

@router.get("/watcher/settings")
def get_watcher_settings(db: Session = Depends(get_db)):
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
def update_watcher_settings(
    data: WatcherSettingsUpdate,
    db: Session = Depends(get_db),
):
    """Update watcher settings. Sync: storage calls block a worker thread."""
    if data.watcher_issues_folder is not None:
        # Validate path exists or is empty
        if data.watcher_issues_folder:
            # Must live under a configured folder (its agent/local disk creates it if missing)
            try:
                storage_for_path(db, data.watcher_issues_folder).mkdir(data.watcher_issues_folder)
            except StorageError as e:
                raise HTTPException(status_code=400, detail=f"Cannot create issues folder: {e}")
        set_setting(db, "watcher_issues_folder", data.watcher_issues_folder)

    if data.watcher_monitor_subfolders is not None:
        set_setting(db, "watcher_monitor_subfolders", "true" if data.watcher_monitor_subfolders else "false")

    if data.watcher_delete_empty_folders is not None:
        set_setting(db, "watcher_delete_empty_folders", "true" if data.watcher_delete_empty_folders else "false")

    if data.watcher_min_file_size_mb is not None:
        val = max(0, data.watcher_min_file_size_mb)
        set_setting(db, "watcher_min_file_size_mb", str(val))

    if data.watcher_issues_organization is not None:
        if data.watcher_issues_organization in ("date", "reason", "flat"):
            set_setting(db, "watcher_issues_organization", data.watcher_issues_organization)

    if data.watcher_auto_purge_days is not None:
        val = max(0, data.watcher_auto_purge_days)
        set_setting(db, "watcher_auto_purge_days", str(val))

    if data.watcher_companion_types is not None:
        set_setting(db, "watcher_companion_types", json.dumps(data.watcher_companion_types))

    if data.watcher_quality_priorities is not None:
        set_setting(db, "watcher_quality_priorities", json.dumps(data.watcher_quality_priorities))

    # Settings are read at start; a running watcher restarts to pick them up.
    tenant_id = current_tenant_id.get()
    if watch_manager.is_running(tenant_id):
        watch_manager.stop(tenant_id)
        try:
            watch_manager.start(db, tenant_id)
        except RuntimeError as e:
            raise HTTPException(status_code=400, detail=str(e))

    return get_watcher_settings(db)


# ── Watcher log ─────────────────────────────────────────────────────

@router.get("/watcher/log")
async def get_watcher_log(
    db: Session = Depends(get_db),
    limit: Optional[int] = Query(default=None, ge=1),
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
    if offset:
        query = query.offset(offset)
    if limit is not None:
        query = query.limit(limit)
    entries = query.all()

    return {
        "total": total,
        "entries": [e.to_dict() for e in entries],
    }


@router.delete("/watcher/log")
async def clear_watcher_log(db: Session = Depends(get_db)):
    """Delete all watcher log entries."""
    count = db.query(WatcherLog).count()
    db.query(WatcherLog).delete()
    db.commit()
    return {"message": f"Deleted {count} log entries", "deleted": count}


@router.delete("/watcher/log/range/{start}/{end}")
async def delete_watcher_log_range(start: str, end: str, db: Session = Depends(get_db)):
    """Delete all log entries within a timestamp range (inclusive)."""
    try:
        dt_start = datetime.fromisoformat(start)
        dt_end = datetime.fromisoformat(end)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid date format. Use ISO format.")

    query = db.query(WatcherLog).filter(
        WatcherLog.timestamp >= dt_start,
        WatcherLog.timestamp <= dt_end,
    )
    count = query.count()
    query.delete(synchronize_session=False)
    db.commit()
    return {"message": f"Deleted {count} log entries", "deleted": count}


@router.delete("/watcher/log/{entry_id}")
async def delete_watcher_log_entry(entry_id: int, db: Session = Depends(get_db)):
    """Delete a single log entry by ID."""
    entry = db.query(WatcherLog).filter(WatcherLog.id == entry_id).first()
    if not entry:
        raise HTTPException(status_code=404, detail="Log entry not found")
    db.delete(entry)
    db.commit()
    return {"message": "Log entry deleted", "deleted": 1}


# ── Issues folder browsing ───────────────────────────────────────

def _issues_folder(db: Session) -> str:
    issues_entry = (
        db.query(ScanFolder)
        .filter(ScanFolder.folder_type == "issues", ScanFolder.enabled == True)
        .first()
    )
    return issues_entry.path if issues_entry else ""


def _prune_empty_dirs(storage, root: str, dirs: set[str]):
    """rmdir candidate dirs deepest-first; rmdir is non-recursive so non-empty ones just stay."""
    for d in sorted(dirs, key=lambda p: len(PurePath(p).parts), reverse=True):
        if d == root:
            continue
        try:
            storage.rmdir(d)
        except StorageError:
            continue


@router.get("/watcher/issues")
def get_issues_files(db: Session = Depends(get_db)):
    """List all files in the configured issues folder (via its storage backend)."""
    issues_folder = _issues_folder(db)
    try:
        if not issues_folder or not storage_for_path(db, issues_folder).is_dir(issues_folder):
            return {"total": 0, "issues_folder": issues_folder, "files": []}
        entries = storage_for_path(db, issues_folder).list(issues_folder, videos_only=False)
    except StorageError as e:
        raise HTTPException(status_code=400, detail=str(e))

    root = PurePath(issues_folder)
    files = []
    for e in entries:
        f = PurePath(e["path"])
        rel = f.relative_to(root)
        # Subfolder is the parent path relative to root, or empty
        subfolder = str(rel.parent) if str(rel.parent) != "." else ""
        files.append({
            "name": f.name,
            "path": str(rel),
            "full_path": str(f),
            "size": e["size"],
            "modified": datetime.fromtimestamp(e["mtime"]).isoformat(),
            "subfolder": subfolder,
        })

    return {"total": len(files), "issues_folder": issues_folder, "files": files}


@router.delete("/watcher/issues")
def delete_issues_file(
    body: dict = Body(...),
    db: Session = Depends(get_db),
):
    """Delete a specific file from the issues folder."""
    rel_path = body.get("path", "")
    if not rel_path:
        raise HTTPException(status_code=400, detail="Missing 'path' in request body")

    issues_folder = _issues_folder(db)
    if not issues_folder:
        raise HTTPException(status_code=400, detail="Issues folder not configured")

    # Traversal guard: a pure path check here, and the owning box's jail re-checks the real path.
    root = PurePath(issues_folder)
    target = root / rel_path
    if ".." in target.parts or not target.is_relative_to(root) or target == root:
        raise HTTPException(status_code=400, detail="Invalid path")

    try:
        storage = storage_for_path(db, str(target))
        if not storage.is_file(str(target)):
            raise HTTPException(status_code=404, detail="File not found")
        storage.delete(str(target))
        # Clean up empty parent directories up to the issues root
        _prune_empty_dirs(storage, issues_folder, {str(p) for p in target.parents if p.is_relative_to(root)})
    except StorageError as e:
        raise HTTPException(status_code=400, detail=str(e))

    return {"message": "File deleted"}


@router.delete("/watcher/issues/all")
def delete_all_issues_files(db: Session = Depends(get_db)):
    """Delete all files in the issues folder."""
    issues_folder = _issues_folder(db)
    if not issues_folder:
        raise HTTPException(status_code=400, detail="Issues folder not configured")

    try:
        storage = storage_for_path(db, issues_folder)
        if not storage.is_dir(issues_folder):
            return {"message": "Deleted 0 files", "deleted": 0}
        entries = storage.list(issues_folder, videos_only=False)
    except StorageError as e:
        raise HTTPException(status_code=400, detail=str(e))

    root = PurePath(issues_folder)
    deleted = 0
    dirs: set[str] = set()
    for e in entries:
        try:
            storage.delete(e["path"])
            deleted += 1
        except StorageError:
            continue
        dirs.update(str(p) for p in PurePath(e["path"]).parents if p.is_relative_to(root))

    # Clean up empty subdirectories
    _prune_empty_dirs(storage, issues_folder, dirs)

    return {"message": f"Deleted {deleted} files", "deleted": deleted}


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
    issues_entry = (
        db.query(ScanFolder)
        .filter(ScanFolder.folder_type == "issues", ScanFolder.enabled == True)
        .first()
    )
    issues_folder = issues_entry.path if issues_entry else ""
    try:
        issues_ok = bool(issues_folder) and storage_for_path(db, issues_folder).is_dir(issues_folder)
    except StorageError:
        issues_ok = False
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

    # 3. At least one TV folder
    tv_folders = (
        db.query(ScanFolder)
        .filter(ScanFolder.folder_type == "tv", ScanFolder.enabled == True)
        .all()
    )
    results.append({
        "name": "Saved/Download Folder",
        "key": "tv_folder",
        "met": len(tv_folders) > 0,
        "detail": f"{len(tv_folders)} folder(s)" if tv_folders else "None configured",
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
