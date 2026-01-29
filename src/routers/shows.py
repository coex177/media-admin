"""API endpoints for TV show management."""

import asyncio
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, BackgroundTasks
from pydantic import BaseModel
from sqlalchemy import func
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import Show, Episode, AppSettings
from ..services.tmdb import TMDBService
from ..services.tvdb import TVDBService

router = APIRouter(prefix="/api/shows", tags=["shows"])

# Global refresh status
_refresh_status = {
    "running": False,
    "current": 0,
    "total": 0,
    "current_show": "",
    "completed": [],
    "errors": [],
}


class ShowCreate(BaseModel):
    """Request model for creating a show."""

    tmdb_id: Optional[int] = None
    tvdb_id: Optional[int] = None
    metadata_source: Optional[str] = None  # "tmdb" or "tvdb"
    folder_path: Optional[str] = None


class ShowUpdate(BaseModel):
    """Request model for updating a show."""

    folder_path: Optional[str] = None
    season_format: Optional[str] = None
    episode_format: Optional[str] = None
    do_rename: Optional[bool] = None
    do_missing: Optional[bool] = None


class SwitchSourceRequest(BaseModel):
    """Request model for switching metadata source."""

    metadata_source: str  # "tmdb" or "tvdb"


class ShowResponse(BaseModel):
    """Response model for a show."""

    id: int
    tmdb_id: Optional[int]
    tvdb_id: Optional[int]
    imdb_id: Optional[str]
    metadata_source: str
    name: str
    overview: Optional[str]
    poster_path: Optional[str]
    backdrop_path: Optional[str]
    folder_path: Optional[str]
    season_format: str
    episode_format: str
    do_rename: bool
    do_missing: bool
    status: str
    first_air_date: Optional[str]
    number_of_seasons: int
    number_of_episodes: int
    episodes_found: int = 0
    episodes_missing: int = 0

    class Config:
        from_attributes = True


def get_tmdb_service(db: Session = Depends(get_db)) -> TMDBService:
    """Get TMDB service with API key from settings."""
    api_key_setting = (
        db.query(AppSettings).filter(AppSettings.key == "tmdb_api_key").first()
    )
    api_key = api_key_setting.value if api_key_setting else ""
    return TMDBService(api_key=api_key)


def get_tvdb_service(db: Session = Depends(get_db)) -> TVDBService:
    """Get TVDB service with API key from settings."""
    api_key_setting = (
        db.query(AppSettings).filter(AppSettings.key == "tvdb_api_key").first()
    )
    api_key = api_key_setting.value if api_key_setting else ""
    return TVDBService(api_key=api_key)


def _get_label_char(name: str) -> str:
    """Get the display character for a show name in page labels."""
    if not name:
        return "#"
    first_char = name[0].upper()
    if first_char.isalpha():
        return first_char
    return "#"


def _get_default_metadata_source(db: Session) -> str:
    """Get the default metadata source from settings."""
    setting = db.query(AppSettings).filter(AppSettings.key == "default_metadata_source").first()
    return setting.value if setting else "tmdb"


@router.get("")
async def list_shows(
    db: Session = Depends(get_db),
    skip: int = Query(0, ge=0),
    limit: int = Query(1000, ge=1, le=10000),
):
    """List all shows."""
    from ..models import IgnoredEpisode, SpecialEpisode

    total = db.query(Show).count()
    shows = db.query(Show).order_by(func.lower(Show.name)).offset(skip).limit(limit).all()

    # Compute page labels for pagination
    page_labels = []
    if limit < 10000 and total > 0:
        all_names = [
            r[0] for r in db.query(Show.name).order_by(func.lower(Show.name)).all()
        ]
        total_pages = -(-total // limit)  # ceiling division
        for page_idx in range(total_pages):
            start_idx = page_idx * limit
            end_idx = min(start_idx + limit - 1, len(all_names) - 1)
            first_char = _get_label_char(all_names[start_idx])
            last_char = _get_label_char(all_names[end_idx])
            if first_char == last_char:
                page_labels.append(first_char)
            else:
                page_labels.append(f"{first_char}-{last_char}")


    # Get all ignored and special episode IDs in one query
    ignored_ids = set(r[0] for r in db.query(IgnoredEpisode.episode_id).all())
    special_ids = set(r[0] for r in db.query(SpecialEpisode.episode_id).all())

    result = []
    for show in shows:
        show_dict = show.to_dict()

        # Get all episodes for this show
        episodes = db.query(Episode).filter(Episode.show_id == show.id).all()

        # Count episodes by status (considering air date, ignored, specials)
        # Season 0 (specials) are never counted as missing
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

        show_dict["episodes_found"] = found_count
        show_dict["episodes_missing"] = missing_count
        show_dict["episodes_not_aired"] = not_aired_count
        result.append(show_dict)

    return {"total": total, "shows": result, "page_labels": page_labels}


@router.get("/{show_id}")
async def get_show(show_id: int, db: Session = Depends(get_db)):
    """Get a show by ID with episodes."""
    from ..models import IgnoredEpisode, SpecialEpisode

    show = db.query(Show).filter(Show.id == show_id).first()
    if not show:
        raise HTTPException(status_code=404, detail="Show not found")

    episodes = (
        db.query(Episode)
        .filter(Episode.show_id == show_id)
        .order_by(Episode.season, Episode.episode)
        .all()
    )

    # Get ignored and special episode IDs for this show
    ep_ids = [ep.id for ep in episodes]
    ignored_ids = set(
        r[0] for r in db.query(IgnoredEpisode.episode_id)
        .filter(IgnoredEpisode.episode_id.in_(ep_ids)).all()
    ) if ep_ids else set()
    special_ids = set(
        r[0] for r in db.query(SpecialEpisode.episode_id)
        .filter(SpecialEpisode.episode_id.in_(ep_ids)).all()
    ) if ep_ids else set()

    show_dict = show.to_dict()
    ep_list = []
    for ep in episodes:
        ep_dict = ep.to_dict()
        ep_dict["is_ignored"] = ep.id in ignored_ids
        ep_dict["is_special"] = ep.id in special_ids
        ep_list.append(ep_dict)
    show_dict["episodes"] = ep_list

    # Count episodes by status (considering air date, ignored, specials)
    found_count = 0
    missing_count = 0
    not_aired_count = 0
    ignored_count = 0
    special_count = 0

    for ep in episodes:
        if ep.file_status != "missing":
            found_count += 1
        elif ep.season == 0:
            pass  # Season 0 specials never count as missing
        elif not ep.has_aired:
            not_aired_count += 1
        elif ep.id in ignored_ids:
            ignored_count += 1
        elif ep.id in special_ids:
            special_count += 1
        else:
            missing_count += 1

    show_dict["episodes_found"] = found_count
    show_dict["episodes_missing"] = missing_count
    show_dict["episodes_not_aired"] = not_aired_count
    show_dict["episodes_ignored"] = ignored_count
    show_dict["episodes_special"] = special_count

    return show_dict


@router.post("")
async def create_show(
    data: ShowCreate,
    db: Session = Depends(get_db),
    tmdb: TMDBService = Depends(get_tmdb_service),
    tvdb: TVDBService = Depends(get_tvdb_service),
):
    """Add a new show from TMDB or TVDB.

    Fetches episode data from both sources when possible and automatically
    selects whichever has more complete data (more non-special episodes).
    The user's default source wins when counts are equal.
    """
    default_source = data.metadata_source or _get_default_metadata_source(db)

    # --- Step 1: Initial duplicate check on provided IDs ---
    if data.tmdb_id:
        existing = db.query(Show).filter(Show.tmdb_id == data.tmdb_id).first()
        if existing:
            raise HTTPException(status_code=400, detail="Show already exists")
    if data.tvdb_id:
        existing = db.query(Show).filter(Show.tvdb_id == data.tvdb_id).first()
        if existing:
            raise HTTPException(status_code=400, detail="Show already exists")

    # --- Step 2: Fetch from default source ---
    default_data = None
    prefetched_secondary = None  # Reuse data fetched during cross-referencing
    if default_source == "tvdb":
        if not data.tvdb_id:
            # User searched TMDB but default is TVDB — cross-reference first
            if data.tmdb_id:
                try:
                    prefetched_secondary = await tmdb.get_show_with_episodes(data.tmdb_id)
                    data.tvdb_id = prefetched_secondary.get("tvdb_id")
                except Exception:
                    pass
            if not data.tvdb_id:
                # Can't find TVDB ID — fall back to TMDB as default
                default_source = "tmdb"

        if default_source == "tvdb":
            try:
                default_data = await tvdb.get_show_with_episodes(data.tvdb_id)
            except Exception as e:
                # TVDB failed — fall back to TMDB if we have a TMDB ID
                if data.tmdb_id:
                    default_source = "tmdb"
                else:
                    raise HTTPException(status_code=400, detail=f"Failed to fetch show from TVDB: {e}")

    if default_source == "tmdb":
        if not data.tmdb_id:
            # User searched TVDB but default is TMDB — cross-reference
            if data.tvdb_id:
                try:
                    data.tmdb_id = await tmdb.find_show_by_tvdb_id(data.tvdb_id)
                except Exception:
                    pass
            if not data.tmdb_id:
                # Can't find TMDB ID — fall back to TVDB as default
                default_source = "tvdb"

        if default_source == "tmdb" and not default_data:
            try:
                default_data = await tmdb.get_show_with_episodes(data.tmdb_id)
            except Exception as e:
                if data.tvdb_id:
                    default_source = "tvdb"
                else:
                    raise HTTPException(status_code=400, detail=f"Failed to fetch show from TMDB: {e}")

        # If we fell back to TVDB after TMDB cross-ref failed
        if default_source == "tvdb" and not default_data:
            try:
                default_data = await tvdb.get_show_with_episodes(data.tvdb_id)
            except Exception as e:
                raise HTTPException(status_code=400, detail=f"Failed to fetch show: {e}")

    if not default_data:
        raise HTTPException(status_code=400, detail="Failed to fetch show from any source")

    # --- Step 3: Cross-reference and fetch secondary source ---
    secondary_data = prefetched_secondary  # Reuse if already fetched during cross-ref
    secondary_source = "tvdb" if default_source == "tmdb" else "tmdb"

    if not secondary_data:
        try:
            if secondary_source == "tvdb":
                # Default is TMDB — get TVDB ID from TMDB's external_ids
                tvdb_id = data.tvdb_id or default_data.get("tvdb_id")
                if tvdb_id:
                    data.tvdb_id = tvdb_id
                    secondary_data = await tvdb.get_show_with_episodes(tvdb_id)
            else:
                # Default is TVDB — find TMDB ID via cross-reference
                tmdb_id = data.tmdb_id
                if not tmdb_id:
                    tvdb_id = data.tvdb_id or default_data.get("tvdb_id")
                    if tvdb_id:
                        tmdb_id = await tmdb.find_show_by_tvdb_id(tvdb_id)
                if tmdb_id:
                    data.tmdb_id = tmdb_id
                    secondary_data = await tmdb.get_show_with_episodes(tmdb_id)
        except Exception:
            # Secondary lookup failed — proceed with default only
            secondary_data = None

    # --- Step 4: Second duplicate check on cross-referenced IDs ---
    if data.tmdb_id:
        existing = db.query(Show).filter(Show.tmdb_id == data.tmdb_id).first()
        if existing:
            raise HTTPException(status_code=400, detail="Show already exists")
    if data.tvdb_id:
        existing = db.query(Show).filter(Show.tvdb_id == data.tvdb_id).first()
        if existing:
            raise HTTPException(status_code=400, detail="Show already exists")

    # --- Step 5: Compare episode counts (non-specials only) ---
    source_switched = False
    original_source = default_source
    switch_reason = None

    def count_non_special(show_result):
        return sum(1 for ep in show_result.get("episodes", []) if ep.get("season", 0) > 0)

    default_count = count_non_special(default_data)

    if secondary_data:
        secondary_count = count_non_special(secondary_data)
        if secondary_count > default_count:
            # Switch to secondary source
            show_data = secondary_data
            metadata_source = secondary_source
            source_switched = True
            switch_reason = f"{secondary_source.upper()} had {secondary_count} episodes vs {default_count} from {default_source.upper()}"
        else:
            show_data = default_data
            metadata_source = default_source
    else:
        show_data = default_data
        metadata_source = default_source

    # --- Step 6: Merge IDs from both sources ---
    tmdb_id = data.tmdb_id or show_data.get("tmdb_id")
    tvdb_id = data.tvdb_id or show_data.get("tvdb_id")
    imdb_id = show_data.get("imdb_id")

    # Pull IDs from whichever source has them
    if secondary_data:
        tmdb_id = tmdb_id or secondary_data.get("tmdb_id")
        tvdb_id = tvdb_id or secondary_data.get("tvdb_id")
        imdb_id = imdb_id or secondary_data.get("imdb_id")
    if default_data:
        tmdb_id = tmdb_id or default_data.get("tmdb_id")
        tvdb_id = tvdb_id or default_data.get("tvdb_id")
        imdb_id = imdb_id or default_data.get("imdb_id")

    # --- Step 7: Create show + episodes ---
    show = Show(
        tmdb_id=tmdb_id,
        tvdb_id=tvdb_id,
        imdb_id=imdb_id,
        metadata_source=metadata_source,
        name=show_data["name"],
        overview=show_data.get("overview"),
        poster_path=show_data.get("poster_path"),
        backdrop_path=show_data.get("backdrop_path"),
        folder_path=data.folder_path,
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

    # --- Step 8: Build response ---
    result = show.to_dict()
    if source_switched:
        result["source_switched"] = True
        result["original_source"] = original_source
        result["switched_to"] = metadata_source
        result["switch_reason"] = switch_reason

    return result


@router.put("/{show_id}")
async def update_show(
    show_id: int, data: ShowUpdate, db: Session = Depends(get_db)
):
    """Update show settings."""
    show = db.query(Show).filter(Show.id == show_id).first()
    if not show:
        raise HTTPException(status_code=404, detail="Show not found")

    if data.folder_path is not None:
        show.folder_path = data.folder_path
    if data.season_format is not None:
        show.season_format = data.season_format
    if data.episode_format is not None:
        show.episode_format = data.episode_format
    if data.do_rename is not None:
        show.do_rename = data.do_rename
    if data.do_missing is not None:
        show.do_missing = data.do_missing

    db.commit()
    db.refresh(show)

    return show.to_dict()


@router.delete("/{show_id}")
async def delete_show(show_id: int, db: Session = Depends(get_db)):
    """Remove a show from the library."""
    show = db.query(Show).filter(Show.id == show_id).first()
    if not show:
        raise HTTPException(status_code=404, detail="Show not found")

    db.delete(show)
    db.commit()

    return {"message": "Show deleted"}


@router.post("/{show_id}/refresh")
async def refresh_show(
    show_id: int,
    db: Session = Depends(get_db),
    tmdb: TMDBService = Depends(get_tmdb_service),
    tvdb: TVDBService = Depends(get_tvdb_service),
):
    """Refresh show metadata from its configured source."""
    show = db.query(Show).filter(Show.id == show_id).first()
    if not show:
        raise HTTPException(status_code=404, detail="Show not found")

    try:
        if show.metadata_source == "tvdb" and show.tvdb_id:
            show_data = await tvdb.get_show_with_episodes(show.tvdb_id)
        elif show.tmdb_id:
            show_data = await tmdb.get_show_with_episodes(show.tmdb_id)
        else:
            raise HTTPException(status_code=400, detail="Show has no valid source ID")
    except HTTPException:
        raise
    except Exception as e:
        source = show.metadata_source.upper()
        raise HTTPException(status_code=400, detail=f"Failed to refresh from {source}: {e}")

    # Update show metadata
    show.name = show_data["name"]
    show.overview = show_data.get("overview")
    show.poster_path = show_data.get("poster_path")
    show.backdrop_path = show_data.get("backdrop_path")
    show.status = show_data.get("status", "Unknown")
    show.first_air_date = show_data.get("first_air_date")
    show.number_of_seasons = show_data.get("number_of_seasons", 0)
    show.number_of_episodes = show_data.get("number_of_episodes", 0)
    show.genres = show_data.get("genres")
    show.networks = show_data.get("networks")
    show.next_episode_air_date = show_data.get("next_episode_air_date")

    # Update cross-reference IDs if available
    if show_data.get("tvdb_id"):
        show.tvdb_id = show_data["tvdb_id"]
    if show_data.get("tmdb_id"):
        show.tmdb_id = show_data["tmdb_id"]
    if show_data.get("imdb_id"):
        show.imdb_id = show_data["imdb_id"]

    # Get existing episodes
    existing_episodes = {
        (ep.season, ep.episode): ep
        for ep in db.query(Episode).filter(Episode.show_id == show.id).all()
    }

    # Update or create episodes
    for ep_data in show_data.get("episodes", []):
        key = (ep_data["season"], ep_data["episode"])
        if key in existing_episodes:
            ep = existing_episodes[key]
            ep.title = ep_data["title"]
            ep.overview = ep_data.get("overview")
            ep.air_date = ep_data.get("air_date")
            ep.still_path = ep_data.get("still_path")
            ep.runtime = ep_data.get("runtime")
        else:
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
    db.refresh(show)

    # Rescan the show's folder to re-match files against updated episode list
    if show.folder_path:
        from pathlib import Path
        from ..services.scanner import ScannerService
        from ..routers.scan import _scan_show_folder

        show_dir = Path(show.folder_path)
        if show_dir.exists():
            scanner = ScannerService(db)
            _scan_show_folder(scanner, show, show_dir)
            db.commit()
            db.refresh(show)

    return show.to_dict()


@router.post("/{show_id}/switch-source")
async def switch_metadata_source(
    show_id: int,
    data: SwitchSourceRequest,
    db: Session = Depends(get_db),
    tmdb: TMDBService = Depends(get_tmdb_service),
    tvdb: TVDBService = Depends(get_tvdb_service),
):
    """Switch a show's metadata source between TMDB and TVDB."""
    if data.metadata_source not in ("tmdb", "tvdb"):
        raise HTTPException(status_code=400, detail="metadata_source must be 'tmdb' or 'tvdb'")

    show = db.query(Show).filter(Show.id == show_id).first()
    if not show:
        raise HTTPException(status_code=404, detail="Show not found")

    if show.metadata_source == data.metadata_source:
        return show.to_dict()

    # Fetch from the new source
    try:
        if data.metadata_source == "tvdb":
            if not show.tvdb_id:
                raise HTTPException(status_code=400, detail="Show has no TVDB ID. Cannot switch to TVDB.")
            show_data = await tvdb.get_show_with_episodes(show.tvdb_id)
        else:
            if not show.tmdb_id:
                raise HTTPException(status_code=400, detail="Show has no TMDB ID. Cannot switch to TMDB.")
            show_data = await tmdb.get_show_with_episodes(show.tmdb_id)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Failed to fetch from {data.metadata_source.upper()}: {e}")

    # Update show metadata
    show.metadata_source = data.metadata_source
    show.name = show_data["name"]
    show.overview = show_data.get("overview")
    show.poster_path = show_data.get("poster_path")
    show.backdrop_path = show_data.get("backdrop_path")
    show.status = show_data.get("status", "Unknown")
    show.first_air_date = show_data.get("first_air_date")
    show.number_of_seasons = show_data.get("number_of_seasons", 0)
    show.number_of_episodes = show_data.get("number_of_episodes", 0)
    show.genres = show_data.get("genres")
    show.networks = show_data.get("networks")
    show.next_episode_air_date = show_data.get("next_episode_air_date")

    # Update cross-reference IDs
    if show_data.get("tvdb_id"):
        show.tvdb_id = show_data["tvdb_id"]
    if show_data.get("tmdb_id"):
        show.tmdb_id = show_data["tmdb_id"]
    if show_data.get("imdb_id"):
        show.imdb_id = show_data["imdb_id"]

    # Delete all existing episodes
    existing_episodes = db.query(Episode).filter(Episode.show_id == show.id).all()
    for ep in existing_episodes:
        db.delete(ep)
    db.flush()

    # Create new episodes from the new source (all start as missing)
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
    db.refresh(show)

    # Rescan the show's folder to re-match files against new episode structure
    if show.folder_path:
        from pathlib import Path
        from ..services.scanner import ScannerService
        from ..routers.scan import _scan_show_folder

        show_dir = Path(show.folder_path)
        if show_dir.exists():
            scanner = ScannerService(db)
            _scan_show_folder(scanner, show, show_dir)
            db.commit()
            db.refresh(show)

    return show.to_dict()


@router.get("/{show_id}/missing")
async def get_missing_episodes(show_id: int, db: Session = Depends(get_db)):
    """Get missing episodes for a show."""
    show = db.query(Show).filter(Show.id == show_id).first()
    if not show:
        raise HTTPException(status_code=404, detail="Show not found")

    from datetime import datetime

    today = datetime.utcnow().strftime("%Y-%m-%d")

    missing = (
        db.query(Episode)
        .filter(
            Episode.show_id == show_id,
            Episode.file_status == "missing",
            Episode.air_date <= today,
            Episode.season != 0,
        )
        .order_by(Episode.season, Episode.episode)
        .all()
    )

    return [ep.to_dict() for ep in missing]


@router.get("/search/tmdb")
async def search_tmdb(
    q: str = Query(..., min_length=1),
    page: int = Query(1, ge=1),
    tmdb: TMDBService = Depends(get_tmdb_service),
):
    """Search TMDB for TV shows."""
    try:
        results = await tmdb.search_shows(q, page)
        return {
            "results": results.get("results", []),
            "page": results.get("page", 1),
            "total_pages": results.get("total_pages", 1),
            "total_results": results.get("total_results", 0),
        }
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Search failed: {e}")


@router.get("/search/tvdb")
async def search_tvdb(
    q: str = Query(..., min_length=1),
    tvdb: TVDBService = Depends(get_tvdb_service),
):
    """Search TVDB for TV shows."""
    try:
        results = await tvdb.search_shows(q)
        return {
            "results": results,
            "total_results": len(results),
        }
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Search failed: {e}")


@router.get("/preview/{source}/{provider_id}")
async def preview_show(
    source: str,
    provider_id: int,
    db: Session = Depends(get_db),
    tmdb: TMDBService = Depends(get_tmdb_service),
    tvdb: TVDBService = Depends(get_tvdb_service),
):
    """Preview full show data from a provider without adding to library."""
    if source not in ("tmdb", "tvdb"):
        raise HTTPException(status_code=400, detail="source must be 'tmdb' or 'tvdb'")

    try:
        if source == "tvdb":
            show_data = await tvdb.get_show_with_episodes(provider_id)
        else:
            show_data = await tmdb.get_show_with_episodes(provider_id)
    except Exception as e:
        raise HTTPException(
            status_code=400, detail=f"Failed to fetch from {source.upper()}: {e}"
        )

    # Check if the show already exists in the local library
    in_library = False
    library_id = None
    if source == "tvdb":
        existing = db.query(Show).filter(Show.tvdb_id == provider_id).first()
    else:
        existing = db.query(Show).filter(Show.tmdb_id == provider_id).first()

    if existing:
        in_library = True
        library_id = existing.id

    show_data["in_library"] = in_library
    show_data["library_id"] = library_id

    return show_data


async def _refresh_all_shows_async(db, tmdb, tvdb):
    """Async helper to refresh all shows."""
    global _refresh_status

    shows = db.query(Show).all()
    _refresh_status["total"] = len(shows)
    _refresh_status["current"] = 0

    for show in shows:
        _refresh_status["current_show"] = show.name

        try:
            # Use the correct service based on show's metadata source
            if show.metadata_source == "tvdb" and show.tvdb_id:
                show_data = await tvdb.get_show_with_episodes(show.tvdb_id)
            elif show.tmdb_id:
                show_data = await tmdb.get_show_with_episodes(show.tmdb_id)
            else:
                _refresh_status["errors"].append(f"{show.name}: No valid source ID")
                _refresh_status["current"] += 1
                continue

            # Update show metadata
            show.name = show_data["name"]
            show.overview = show_data.get("overview")
            show.poster_path = show_data.get("poster_path")
            show.backdrop_path = show_data.get("backdrop_path")
            show.status = show_data.get("status", "Unknown")
            show.first_air_date = show_data.get("first_air_date")
            show.number_of_seasons = show_data.get("number_of_seasons", 0)
            show.number_of_episodes = show_data.get("number_of_episodes", 0)
            show.genres = show_data.get("genres")
            show.networks = show_data.get("networks")
            show.next_episode_air_date = show_data.get("next_episode_air_date")

            # Update cross-reference IDs
            if show_data.get("tvdb_id"):
                show.tvdb_id = show_data["tvdb_id"]
            if show_data.get("tmdb_id"):
                show.tmdb_id = show_data["tmdb_id"]
            if show_data.get("imdb_id"):
                show.imdb_id = show_data["imdb_id"]

            # Get existing episodes
            existing_episodes = {
                (ep.season, ep.episode): ep
                for ep in db.query(Episode).filter(Episode.show_id == show.id).all()
            }

            # Update or create episodes
            for ep_data in show_data.get("episodes", []):
                key = (ep_data["season"], ep_data["episode"])
                if key in existing_episodes:
                    ep = existing_episodes[key]
                    ep.title = ep_data["title"]
                    ep.overview = ep_data.get("overview")
                    ep.air_date = ep_data.get("air_date")
                    ep.still_path = ep_data.get("still_path")
                    ep.runtime = ep_data.get("runtime")
                else:
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
            _refresh_status["completed"].append(show.name)

        except Exception as e:
            _refresh_status["errors"].append(f"{show.name}: {str(e)}")
            db.rollback()

        _refresh_status["current"] += 1

        # Small delay to avoid rate limiting
        await asyncio.sleep(0.5)

    _refresh_status["current_show"] = ""


def run_refresh_all(db_session_maker, tmdb_api_key: str, tvdb_api_key: str):
    """Background task to refresh all shows."""
    global _refresh_status
    import time

    # Small delay to ensure any recent commits are visible
    time.sleep(0.5)

    SessionLocal = db_session_maker()
    db = SessionLocal()

    # Create a single event loop for the entire operation
    loop = asyncio.new_event_loop()
    asyncio.set_event_loop(loop)

    try:
        _refresh_status["running"] = True
        _refresh_status["completed"] = []
        _refresh_status["errors"] = []

        tmdb = TMDBService(api_key=tmdb_api_key)
        tvdb = TVDBService(api_key=tvdb_api_key)

        # Run all refreshes in the single event loop
        loop.run_until_complete(_refresh_all_shows_async(db, tmdb, tvdb))

    except Exception as e:
        _refresh_status["errors"].append(f"Fatal error: {str(e)}")
    finally:
        _refresh_status["running"] = False
        # Clean up the event loop properly
        try:
            loop.run_until_complete(loop.shutdown_asyncgens())
        except Exception:
            pass
        loop.close()
        db.close()


@router.post("/refresh-all")
async def refresh_all_shows(
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
):
    """Refresh metadata for all shows."""
    global _refresh_status

    if _refresh_status["running"]:
        raise HTTPException(status_code=400, detail="Refresh already in progress")

    # Get API keys
    tmdb_key_setting = (
        db.query(AppSettings).filter(AppSettings.key == "tmdb_api_key").first()
    )
    tvdb_key_setting = (
        db.query(AppSettings).filter(AppSettings.key == "tvdb_api_key").first()
    )

    tmdb_key = tmdb_key_setting.value if tmdb_key_setting else ""
    tvdb_key = tvdb_key_setting.value if tvdb_key_setting else ""

    if not tmdb_key and not tvdb_key:
        raise HTTPException(status_code=400, detail="No API keys configured")

    from ..database import get_session_maker

    background_tasks.add_task(run_refresh_all, get_session_maker, tmdb_key, tvdb_key)

    return {"message": "Refresh started", "status": "running"}


@router.get("/refresh-all/status")
async def get_refresh_status():
    """Get the status of the refresh-all operation."""
    return _refresh_status
