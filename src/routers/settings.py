"""API endpoints for application settings."""

import json
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import ScanFolder, AppSettings

router = APIRouter(prefix="/api", tags=["settings"])


class SettingsUpdate(BaseModel):
    """Request model for updating settings."""

    tmdb_api_key: Optional[str] = None
    tvdb_api_key: Optional[str] = None
    default_metadata_source: Optional[str] = None
    episode_format: Optional[str] = None
    season_format: Optional[str] = None
    auto_scan_enabled: Optional[bool] = None
    auto_scan_interval_minutes: Optional[int] = None
    upcoming_days: Optional[int] = None
    recently_aired_days: Optional[int] = None
    recently_added_count: Optional[int] = None
    recently_matched_count: Optional[int] = None
    returning_soon_count: Optional[int] = None
    recently_ended_count: Optional[int] = None
    display_episode_format: Optional[str] = None
    theme: Optional[str] = None
    slow_import_count: Optional[int] = None
    shows_per_page: Optional[int] = None
    shows_per_page_options: Optional[list] = None
    timezone: Optional[str] = None


class FolderCreate(BaseModel):
    """Request model for creating a scan folder."""

    path: str
    type: str  # library, tv, or issues


class SettingsResponse(BaseModel):
    """Response model for settings."""

    tmdb_api_key: str
    tmdb_api_key_set: bool
    episode_format: str
    season_format: str
    auto_scan_enabled: bool
    auto_scan_interval_minutes: int
    setup_completed: bool


def get_setting(db: Session, key: str, default: str = "") -> str:
    """Get a setting value from the database."""
    setting = db.query(AppSettings).filter(AppSettings.key == key).first()
    return setting.value if setting else default


def set_setting(db: Session, key: str, value: str) -> None:
    """Set a setting value in the database."""
    setting = db.query(AppSettings).filter(AppSettings.key == key).first()
    if setting:
        setting.value = value
    else:
        setting = AppSettings(key=key, value=value)
        db.add(setting)
    db.commit()


@router.get("/ui-prefs")
async def get_ui_prefs(db: Session = Depends(get_db)):
    """Get UI preferences blob."""
    raw = get_setting(db, "ui_preferences", "{}")
    try:
        return json.loads(raw)
    except (json.JSONDecodeError, TypeError):
        return {}


@router.put("/ui-prefs")
async def update_ui_prefs(data: dict, db: Session = Depends(get_db)):
    """Merge UI preferences. Expects { prefs: { key: value, ... } }."""
    incoming = data.get("prefs")
    if not isinstance(incoming, dict):
        raise HTTPException(status_code=400, detail="Expected { prefs: { ... } }")

    raw = get_setting(db, "ui_preferences", "{}")
    try:
        existing = json.loads(raw)
    except (json.JSONDecodeError, TypeError):
        existing = {}

    existing.update(incoming)
    set_setting(db, "ui_preferences", json.dumps(existing))
    return existing


@router.get("/settings")
async def get_settings(db: Session = Depends(get_db)):
    """Get application settings."""
    from ..config import TVDB_API_KEY_DEFAULT

    tmdb_key = get_setting(db, "tmdb_api_key", "")

    # Seed TVDB API key from config default if not yet in DB
    tvdb_key = get_setting(db, "tvdb_api_key", "")
    if not tvdb_key:
        set_setting(db, "tvdb_api_key", TVDB_API_KEY_DEFAULT)
        tvdb_key = TVDB_API_KEY_DEFAULT

    return {
        "tmdb_api_key": "***" if tmdb_key else "",
        "tmdb_api_key_set": bool(tmdb_key),
        "tvdb_api_key": "***" if tvdb_key else "",
        "tvdb_api_key_set": bool(tvdb_key),
        "default_metadata_source": get_setting(db, "default_metadata_source", "tmdb"),
        "episode_format": get_setting(db, "episode_format", "{season}x{episode:02d} - {title}"),
        "season_format": get_setting(db, "season_format", "Season {season}"),
        "auto_scan_enabled": get_setting(db, "auto_scan_enabled", "false") == "true",
        "auto_scan_interval_minutes": int(get_setting(db, "auto_scan_interval_minutes", "60")),
        "setup_completed": get_setting(db, "setup_completed", "false") == "true",
        "upcoming_days": int(get_setting(db, "upcoming_days", "5")),
        "recently_aired_days": int(get_setting(db, "recently_aired_days", "5")),
        "recently_added_count": int(get_setting(db, "recently_added_count", "5")),
        "recently_matched_count": int(get_setting(db, "recently_matched_count", "5")),
        "returning_soon_count": int(get_setting(db, "returning_soon_count", "5")),
        "recently_ended_count": int(get_setting(db, "recently_ended_count", "5")),
        "display_episode_format": get_setting(db, "display_episode_format", "{season}x{episode:02d}"),
        "theme": get_setting(db, "theme", "midnight"),
        "slow_import_count": int(get_setting(db, "slow_import_count", "10")),
        "shows_per_page": int(get_setting(db, "shows_per_page", "0")),
        "shows_per_page_options": json.loads(get_setting(db, "shows_per_page_options", "[100,300,500,1000,1500]")),
        "timezone": get_setting(db, "timezone", ""),
    }


@router.put("/settings")
async def update_settings(data: SettingsUpdate, db: Session = Depends(get_db)):
    """Update application settings."""
    if data.tmdb_api_key is not None:
        set_setting(db, "tmdb_api_key", data.tmdb_api_key)

    if data.tvdb_api_key is not None:
        set_setting(db, "tvdb_api_key", data.tvdb_api_key)

    if data.default_metadata_source is not None:
        if data.default_metadata_source in ("tmdb", "tvdb"):
            set_setting(db, "default_metadata_source", data.default_metadata_source)

    if data.episode_format is not None:
        set_setting(db, "episode_format", data.episode_format)

    if data.season_format is not None:
        set_setting(db, "season_format", data.season_format)

    if data.auto_scan_enabled is not None:
        set_setting(db, "auto_scan_enabled", "true" if data.auto_scan_enabled else "false")

    if data.auto_scan_interval_minutes is not None:
        set_setting(db, "auto_scan_interval_minutes", str(data.auto_scan_interval_minutes))

    if data.upcoming_days is not None:
        set_setting(db, "upcoming_days", str(data.upcoming_days))

    if data.recently_aired_days is not None:
        set_setting(db, "recently_aired_days", str(data.recently_aired_days))

    if data.recently_added_count is not None:
        set_setting(db, "recently_added_count", str(data.recently_added_count))

    if data.recently_matched_count is not None:
        set_setting(db, "recently_matched_count", str(data.recently_matched_count))

    if data.returning_soon_count is not None:
        set_setting(db, "returning_soon_count", str(data.returning_soon_count))

    if data.recently_ended_count is not None:
        set_setting(db, "recently_ended_count", str(data.recently_ended_count))

    if data.display_episode_format is not None:
        set_setting(db, "display_episode_format", data.display_episode_format)

    if data.theme is not None:
        set_setting(db, "theme", data.theme)

    if data.slow_import_count is not None:
        set_setting(db, "slow_import_count", str(data.slow_import_count))

    if data.shows_per_page is not None:
        set_setting(db, "shows_per_page", str(data.shows_per_page))

    if data.timezone is not None:
        set_setting(db, "timezone", data.timezone)

    if data.shows_per_page_options is not None:
        opts = sorted([int(v) for v in data.shows_per_page_options if int(v) > 0])[:5]
        set_setting(db, "shows_per_page_options", json.dumps(opts))

    # Mark setup as completed if API key is set
    if data.tmdb_api_key:
        set_setting(db, "setup_completed", "true")

    return await get_settings(db)


@router.get("/folders")
async def list_folders(db: Session = Depends(get_db)):
    """List all scan folders."""
    folders = db.query(ScanFolder).all()
    return [f.to_dict() for f in folders]


def _sync_watcher_issues_folder(db: Session):
    """Sync the watcher service with the current enabled issues folder."""
    from ..services.watcher import watcher_service
    issues = db.query(ScanFolder).filter(
        ScanFolder.folder_type == "issues", ScanFolder.enabled == True
    ).first()
    path = issues.path if issues else ""
    watcher_service.set_issues_folder(path)
    set_setting(db, "watcher_issues_folder", path)


@router.post("/folders")
async def create_folder(data: FolderCreate, db: Session = Depends(get_db)):
    """Add a scan folder."""
    # Validate folder type
    if data.type not in ("library", "tv", "issues"):
        raise HTTPException(status_code=400, detail="Type must be 'library', 'tv', or 'issues'")

    # Check if path exists
    path = Path(data.path)
    if not path.exists():
        raise HTTPException(status_code=400, detail="Path does not exist")

    if not path.is_dir():
        raise HTTPException(status_code=400, detail="Path is not a directory")

    # Check for duplicate
    existing = db.query(ScanFolder).filter(ScanFolder.path == data.path).first()
    if existing:
        raise HTTPException(status_code=400, detail="Folder already added")

    folder = ScanFolder(
        path=data.path,
        folder_type=data.type,
        enabled=True,
    )

    db.add(folder)
    db.commit()
    db.refresh(folder)

    # Issues folders: only one can be enabled at a time
    if data.type == "issues":
        db.query(ScanFolder).filter(
            ScanFolder.folder_type == "issues",
            ScanFolder.enabled == True,
            ScanFolder.id != folder.id,
        ).update({"enabled": False})
        db.commit()
        _sync_watcher_issues_folder(db)

    return folder.to_dict()


@router.delete("/folders/{folder_id}")
async def delete_folder(folder_id: int, db: Session = Depends(get_db)):
    """Remove a scan folder."""
    folder = db.query(ScanFolder).filter(ScanFolder.id == folder_id).first()
    if not folder:
        raise HTTPException(status_code=404, detail="Folder not found")

    is_issues = folder.folder_type == "issues"
    db.delete(folder)
    db.commit()

    if is_issues:
        _sync_watcher_issues_folder(db)

    return {"message": "Folder removed"}


@router.put("/folders/{folder_id}/toggle")
async def toggle_folder(folder_id: int, db: Session = Depends(get_db)):
    """Toggle a folder's enabled status."""
    folder = db.query(ScanFolder).filter(ScanFolder.id == folder_id).first()
    if not folder:
        raise HTTPException(status_code=404, detail="Folder not found")

    folder.enabled = not folder.enabled
    db.commit()

    # Issues folders: only one can be enabled at a time
    if folder.folder_type == "issues" and folder.enabled:
        db.query(ScanFolder).filter(
            ScanFolder.folder_type == "issues",
            ScanFolder.enabled == True,
            ScanFolder.id != folder.id,
        ).update({"enabled": False})
        db.commit()

    if folder.folder_type == "issues":
        _sync_watcher_issues_folder(db)

    db.refresh(folder)
    return folder.to_dict()


@router.get("/stats")
async def get_stats(db: Session = Depends(get_db)):
    """Get library statistics."""
    from ..models import Show, Episode, PendingAction, IgnoredEpisode, SpecialEpisode
    from datetime import datetime
    from sqlalchemy import or_, select

    today = datetime.utcnow().strftime("%Y-%m-%d")

    total_shows = db.query(Show).count()
    total_episodes = db.query(Episode).count()
    found_episodes = db.query(Episode).filter(Episode.file_status != "missing").count()

    # Get ignored and special episode IDs
    ignored_ids = set(r[0] for r in db.query(IgnoredEpisode.episode_id).all())
    special_ids = set(r[0] for r in db.query(SpecialEpisode.episode_id).all())

    # Count ignored and special episodes (only those that are still missing and aired)
    ignored_count = (
        db.query(Episode)
        .filter(
            Episode.id.in_(ignored_ids),
            Episode.file_status == "missing",
            Episode.air_date <= today,
        )
        .count()
    ) if ignored_ids else 0

    special_count = (
        db.query(Episode)
        .filter(
            Episode.id.in_(special_ids),
            Episode.file_status == "missing",
            Episode.air_date <= today,
        )
        .count()
    ) if special_ids else 0

    # Missing episodes that have aired (excluding ignored, specials, and season 0)
    excluded_ids = ignored_ids | special_ids
    missing_query = db.query(Episode).filter(
        Episode.file_status == "missing",
        Episode.air_date <= today,
        Episode.season != 0,
    )
    if excluded_ids:
        missing_query = missing_query.filter(~Episode.id.in_(excluded_ids))
    missing_episodes = missing_query.count()

    # Episodes that haven't aired yet (no air date or future air date), exclude season 0
    not_aired_episodes = (
        db.query(Episode)
        .filter(
            Episode.file_status == "missing",
            Episode.season != 0,
            or_(Episode.air_date > today, Episode.air_date == None)
        )
        .count()
    )

    pending_actions = db.query(PendingAction).filter(PendingAction.status == "pending").count()

    continuing_shows = db.query(Show).filter(Show.status.in_(["Returning Series", "In Production"])).count()
    ended_shows = total_shows - continuing_shows

    return {
        "total_shows": total_shows,
        "continuing_shows": continuing_shows,
        "ended_shows": ended_shows,
        "total_episodes": total_episodes,
        "found_episodes": found_episodes,
        "missing_episodes": missing_episodes,
        "ignored_episodes": ignored_count,
        "special_episodes": special_count,
        "not_aired_episodes": not_aired_episodes,
        "pending_actions": pending_actions,
    }


@router.get("/recently-aired")
async def get_recently_aired(
    db: Session = Depends(get_db),
):
    """Get episodes that aired recently (within configured days from settings)."""
    from ..models import Show, Episode
    from datetime import datetime, timedelta

    # Get days from settings
    days = int(get_setting(db, "recently_aired_days", "5"))

    today = datetime.utcnow()
    cutoff_date = (today - timedelta(days=days)).strftime("%Y-%m-%d")
    today_str = today.strftime("%Y-%m-%d")

    # Get all episodes that aired in the last N days (no per-show limit)
    episodes = (
        db.query(Episode)
        .join(Show)
        .filter(
            Episode.air_date >= cutoff_date,
            Episode.air_date <= today_str
        )
        .order_by(Episode.air_date.desc())
        .all()
    )

    result = []
    for ep in episodes:
        show = db.query(Show).filter(Show.id == ep.show_id).first()
        # Determine effective status
        effective_status = ep.file_status
        if ep.file_status == "missing" and not ep.has_aired:
            effective_status = "not_aired"

        result.append({
            "id": ep.id,
            "show_id": ep.show_id,
            "show_name": show.name if show else "Unknown",
            "show_poster": show.poster_path if show else None,
            "season": ep.season,
            "episode": ep.episode,
            "title": ep.title,
            "air_date": ep.air_date,
            "file_status": effective_status,
            "episode_code": f"S{ep.season:02d}E{ep.episode:02d}"
        })

    return result


@router.get("/upcoming")
async def get_upcoming_episodes(
    db: Session = Depends(get_db),
):
    """Get upcoming episodes within the configured days from settings."""
    from ..models import Show, Episode
    from datetime import datetime, timedelta

    # Get days from settings
    days = int(get_setting(db, "upcoming_days", "5"))

    today = datetime.utcnow()
    today_str = today.strftime("%Y-%m-%d")
    cutoff_date = (today + timedelta(days=days)).strftime("%Y-%m-%d")

    # Get all episodes that will air in the next N days (no per-show limit)
    episodes = (
        db.query(Episode)
        .join(Show)
        .filter(
            Episode.air_date > today_str,
            Episode.air_date <= cutoff_date,
            Episode.air_date != None
        )
        .order_by(Episode.air_date.asc())
        .all()
    )

    result = []
    for ep in episodes:
        show = db.query(Show).filter(Show.id == ep.show_id).first()
        result.append({
            "id": ep.id,
            "show_id": ep.show_id,
            "show_name": show.name if show else "Unknown",
            "show_poster": show.poster_path if show else None,
            "season": ep.season,
            "episode": ep.episode,
            "title": ep.title,
            "air_date": ep.air_date,
            "episode_code": f"S{ep.season:02d}E{ep.episode:02d}"
        })

    return result


@router.get("/recently-ended")
async def get_recently_ended(
    db: Session = Depends(get_db),
):
    """Get shows that have recently ended or been canceled."""
    limit = int(get_setting(db, "recently_ended_count", "5"))
    from ..models import Show, Episode, IgnoredEpisode, SpecialEpisode

    ignored_ids = set(r[0] for r in db.query(IgnoredEpisode.episode_id).all())
    special_ids = set(r[0] for r in db.query(SpecialEpisode.episode_id).all())

    # Get ended/canceled shows, ordered by last_updated (most recent first)
    ended_statuses = ["Ended", "Canceled"]
    shows = (
        db.query(Show)
        .filter(Show.status.in_(ended_statuses))
        .order_by(Show.last_updated.desc())
        .limit(limit)
        .all()
    )

    result = []
    for show in shows:
        # Count episodes (season 0 specials never count as missing)
        episodes = db.query(Episode).filter(Episode.show_id == show.id).all()
        found_count = sum(1 for ep in episodes if ep.file_status != "missing" or ep.season == 0 or ep.id in ignored_ids or ep.id in special_ids)

        result.append({
            "id": show.id,
            "name": show.name,
            "poster_path": show.poster_path,
            "status": show.status,
            "number_of_seasons": show.number_of_seasons,
            "episodes_found": found_count,
            "episodes_total": len(episodes),
            "first_air_date": show.first_air_date,
        })

    return result


@router.get("/recently-added")
async def get_recently_added(
    db: Session = Depends(get_db),
):
    """Get shows that were recently added."""
    limit = int(get_setting(db, "recently_added_count", "5"))
    from ..models import Show, Episode, IgnoredEpisode, SpecialEpisode

    ignored_ids = set(r[0] for r in db.query(IgnoredEpisode.episode_id).all())
    special_ids = set(r[0] for r in db.query(SpecialEpisode.episode_id).all())

    # Get recently added shows
    shows = (
        db.query(Show)
        .order_by(Show.created_at.desc())
        .limit(limit)
        .all()
    )

    result = []
    for show in shows:
        # Count episodes
        episodes = db.query(Episode).filter(Episode.show_id == show.id).all()

        found_count = 0
        missing_count = 0
        not_aired_count = 0

        for ep in episodes:
            if ep.file_status != "missing":
                found_count += 1
            elif ep.season == 0:
                pass  # Season 0 specials never count as missing
            elif not ep.has_aired:
                not_aired_count += 1
            elif ep.id in ignored_ids or ep.id in special_ids:
                found_count += 1  # Count as collected
            else:
                missing_count += 1

        result.append({
            "id": show.id,
            "name": show.name,
            "poster_path": show.poster_path,
            "status": show.status,
            "number_of_seasons": show.number_of_seasons,
            "created_at": show.created_at.isoformat() if show.created_at else None,
            "episodes_found": found_count,
            "episodes_missing": missing_count,
            "episodes_not_aired": not_aired_count,
            "folder_path": show.folder_path,
        })

    return result


@router.get("/most-incomplete")
async def get_most_incomplete(
    db: Session = Depends(get_db),
    limit: int = 5
):
    """Get shows with the most missing episodes."""
    from ..models import Show, Episode, IgnoredEpisode, SpecialEpisode

    ignored_ids = set(r[0] for r in db.query(IgnoredEpisode.episode_id).all())
    special_ids = set(r[0] for r in db.query(SpecialEpisode.episode_id).all())

    shows = db.query(Show).all()

    show_data = []
    for show in shows:
        episodes = db.query(Episode).filter(Episode.show_id == show.id).all()

        found_count = 0
        missing_count = 0

        for ep in episodes:
            if ep.file_status != "missing":
                found_count += 1
            elif ep.season == 0:
                pass  # Season 0 specials never count as missing
            elif not ep.has_aired:
                pass  # not aired, skip
            elif ep.id in ignored_ids or ep.id in special_ids:
                found_count += 1  # Count as collected
            else:
                missing_count += 1

        # Only include shows with missing episodes
        if missing_count > 0:
            total_aired = found_count + missing_count
            completion_pct = (found_count / total_aired * 100) if total_aired > 0 else 0
            show_data.append({
                "id": show.id,
                "name": show.name,
                "poster_path": show.poster_path,
                "episodes_found": found_count,
                "episodes_missing": missing_count,
                "total_aired": total_aired,
                "completion_percent": round(completion_pct, 1),
            })

    # Sort by missing count descending
    show_data.sort(key=lambda x: x["episodes_missing"], reverse=True)

    return show_data[:limit]


@router.get("/storage-stats")
async def get_storage_stats(db: Session = Depends(get_db)):
    """Get storage statistics for the library."""
    from ..models import Episode
    import os

    episodes_with_files = (
        db.query(Episode)
        .filter(Episode.file_path != None, Episode.file_status != "missing")
        .all()
    )

    total_size = 0
    file_count = 0
    errors = 0

    for ep in episodes_with_files:
        if ep.file_path:
            try:
                if os.path.exists(ep.file_path):
                    total_size += os.path.getsize(ep.file_path)
                    file_count += 1
            except (OSError, IOError):
                errors += 1

    avg_size = total_size / file_count if file_count > 0 else 0

    return {
        "total_size_bytes": total_size,
        "total_size_gb": round(total_size / (1024 ** 3), 2),
        "file_count": file_count,
        "average_size_bytes": int(avg_size),
        "average_size_mb": round(avg_size / (1024 ** 2), 1),
    }


@router.get("/recently-matched")
async def get_recently_matched(
    db: Session = Depends(get_db),
):
    """Get episodes that were recently matched by the scanner."""
    limit = int(get_setting(db, "recently_matched_count", "5"))
    from ..models import Show, Episode

    episodes = (
        db.query(Episode)
        .filter(Episode.matched_at != None)
        .order_by(Episode.matched_at.desc())
        .limit(limit)
        .all()
    )

    result = []
    for ep in episodes:
        show = db.query(Show).filter(Show.id == ep.show_id).first()
        result.append({
            "id": ep.id,
            "show_id": ep.show_id,
            "show_name": show.name if show else "Unknown",
            "show_poster": show.poster_path if show else None,
            "season": ep.season,
            "episode": ep.episode,
            "title": ep.title,
            "episode_code": f"S{ep.season:02d}E{ep.episode:02d}",
            "matched_at": ep.matched_at.isoformat() if ep.matched_at else None,
            "file_path": ep.file_path,
        })

    return result


@router.get("/returning-soon")
async def get_returning_soon(
    db: Session = Depends(get_db),
):
    """Get shows that are returning soon (have a next episode air date)."""
    limit = int(get_setting(db, "returning_soon_count", "5"))
    from ..models import Show
    from datetime import datetime

    today = datetime.utcnow().strftime("%Y-%m-%d")

    # Get shows with future next_episode_air_date
    shows = (
        db.query(Show)
        .filter(
            Show.next_episode_air_date != None,
            Show.next_episode_air_date >= today
        )
        .order_by(Show.next_episode_air_date.asc())
        .limit(limit)
        .all()
    )

    result = []
    for show in shows:
        # Calculate days until return
        if show.next_episode_air_date:
            try:
                air_date = datetime.strptime(show.next_episode_air_date, "%Y-%m-%d")
                days_until = (air_date - datetime.utcnow()).days
            except ValueError:
                days_until = None
        else:
            days_until = None

        result.append({
            "id": show.id,
            "name": show.name,
            "poster_path": show.poster_path,
            "status": show.status,
            "next_episode_air_date": show.next_episode_air_date,
            "days_until": days_until,
        })

    return result


@router.get("/genre-distribution")
async def get_genre_distribution(db: Session = Depends(get_db)):
    """Get distribution of shows by genre."""
    from ..models import Show
    import json

    shows = db.query(Show).all()

    genre_shows = {}
    for show in shows:
        if show.genres:
            try:
                genres = json.loads(show.genres)
                for genre in genres:
                    if genre not in genre_shows:
                        genre_shows[genre] = []
                    genre_shows[genre].append({"id": show.id, "name": show.name})
            except (json.JSONDecodeError, TypeError):
                pass

    # Sort by count descending
    sorted_genres = sorted(genre_shows.items(), key=lambda x: len(x[1]), reverse=True)

    return [{"genre": g, "count": len(s), "shows": sorted(s, key=lambda x: x["name"])} for g, s in sorted_genres]


@router.get("/network-distribution")
async def get_network_distribution(db: Session = Depends(get_db)):
    """Get distribution of shows by network."""
    from ..models import Show
    import json

    shows = db.query(Show).all()

    network_shows = {}
    for show in shows:
        if show.networks:
            try:
                networks = json.loads(show.networks)
                for network in networks:
                    if network not in network_shows:
                        network_shows[network] = []
                    network_shows[network].append({"id": show.id, "name": show.name})
            except (json.JSONDecodeError, TypeError):
                pass

    # Sort by count descending
    sorted_networks = sorted(network_shows.items(), key=lambda x: len(x[1]), reverse=True)

    return [{"network": n, "count": len(s), "shows": sorted(s, key=lambda x: x["name"])} for n, s in sorted_networks]


@router.get("/extra-files")
async def get_extra_files(db: Session = Depends(get_db)):
    """Get shows with more video files on disk than matched episodes in the DB."""
    from ..models import Show, Episode
    from ..config import settings
    import os
    from pathlib import Path

    video_extensions = set(settings.video_extensions)

    shows = db.query(Show).filter(Show.folder_path != None).all()

    result = []
    for show in shows:
        if not show.folder_path or not os.path.isdir(show.folder_path):
            continue

        matched_episodes = db.query(Episode).filter(
            Episode.show_id == show.id,
            Episode.file_status != "missing",
        ).count()

        disk_files = 0
        try:
            for root, dirs, filenames in os.walk(show.folder_path):
                for f in filenames:
                    if Path(f).suffix.lower() in video_extensions:
                        disk_files += 1
        except (PermissionError, OSError):
            continue

        if disk_files > matched_episodes:
            result.append({
                "id": show.id,
                "name": show.name,
                "poster_path": show.poster_path,
                "matched_episodes": matched_episodes,
                "disk_files": disk_files,
                "extra": disk_files - matched_episodes,
            })

    result.sort(key=lambda x: x["extra"], reverse=True)
    return result


@router.get("/last-scan")
async def get_last_scan(db: Session = Depends(get_db)):
    """Get information about the last scan."""
    import json

    last_scan_time = get_setting(db, "last_scan_time", "")
    last_scan_result = get_setting(db, "last_scan_result", "{}")

    try:
        result = json.loads(last_scan_result)
    except json.JSONDecodeError:
        result = {}

    return {
        "last_scan_time": last_scan_time or None,
        "result": result,
    }
