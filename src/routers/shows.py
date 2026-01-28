"""API endpoints for TV show management."""

import asyncio
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, BackgroundTasks
from pydantic import BaseModel
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import Show, Episode, AppSettings
from ..services.tmdb import TMDBService

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

    tmdb_id: int
    folder_path: Optional[str] = None


class ShowUpdate(BaseModel):
    """Request model for updating a show."""

    folder_path: Optional[str] = None
    season_format: Optional[str] = None
    episode_format: Optional[str] = None
    do_rename: Optional[bool] = None
    do_missing: Optional[bool] = None


class ShowResponse(BaseModel):
    """Response model for a show."""

    id: int
    tmdb_id: int
    tvdb_id: Optional[int]
    imdb_id: Optional[str]
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


@router.get("")
async def list_shows(
    db: Session = Depends(get_db),
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=1000),
):
    """List all shows."""
    from ..models import IgnoredEpisode, SpecialEpisode

    shows = db.query(Show).order_by(Show.name).offset(skip).limit(limit).all()

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

    return result


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
):
    """Add a new show from TMDB."""
    # Check if show already exists
    existing = db.query(Show).filter(Show.tmdb_id == data.tmdb_id).first()
    if existing:
        raise HTTPException(status_code=400, detail="Show already exists")

    try:
        # Fetch show details from TMDB
        show_data = await tmdb.get_show_with_episodes(data.tmdb_id)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Failed to fetch show from TMDB: {e}")

    # Create show
    show = Show(
        tmdb_id=show_data["tmdb_id"],
        tvdb_id=show_data.get("tvdb_id"),
        imdb_id=show_data.get("imdb_id"),
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

    return show.to_dict()


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
):
    """Refresh show metadata from TMDB."""
    show = db.query(Show).filter(Show.id == show_id).first()
    if not show:
        raise HTTPException(status_code=404, detail="Show not found")

    try:
        # Fetch updated data
        show_data = await tmdb.get_show_with_episodes(show.tmdb_id)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Failed to refresh from TMDB: {e}")

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


async def _refresh_all_shows_async(db, tmdb):
    """Async helper to refresh all shows."""
    global _refresh_status

    shows = db.query(Show).all()
    _refresh_status["total"] = len(shows)
    _refresh_status["current"] = 0

    for show in shows:
        _refresh_status["current_show"] = show.name

        try:
            show_data = await tmdb.get_show_with_episodes(show.tmdb_id)

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


def run_refresh_all(db_session_maker, api_key: str):
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

        tmdb = TMDBService(api_key=api_key)

        # Run all refreshes in the single event loop
        loop.run_until_complete(_refresh_all_shows_async(db, tmdb))

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

    # Get API key
    api_key_setting = (
        db.query(AppSettings).filter(AppSettings.key == "tmdb_api_key").first()
    )
    if not api_key_setting or not api_key_setting.value:
        raise HTTPException(status_code=400, detail="TMDB API key not configured")

    from ..database import get_session_maker

    background_tasks.add_task(run_refresh_all, get_session_maker, api_key_setting.value)

    return {"message": "Refresh started", "status": "running"}


@router.get("/refresh-all/status")
async def get_refresh_status():
    """Get the status of the refresh-all operation."""
    return _refresh_status
