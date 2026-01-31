"""API endpoints for TV show management."""

import asyncio
import logging
import re
import shutil
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, BackgroundTasks
from pydantic import BaseModel
from sqlalchemy import func
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import Show, Episode, AppSettings
from ..services.tmdb import TMDBService
from ..services.tvdb import TVDBService

logger = logging.getLogger("scanner")

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
    tvdb_season_type: Optional[str] = None
    folder_path: Optional[str] = None


class ShowUpdate(BaseModel):
    """Request model for updating a show."""

    folder_path: Optional[str] = None
    season_format: Optional[str] = None
    episode_format: Optional[str] = None
    do_rename: Optional[bool] = None
    do_missing: Optional[bool] = None
    aliases: Optional[list[str]] = None


class SwitchSourceRequest(BaseModel):
    """Request model for switching metadata source."""

    metadata_source: str  # "tmdb" or "tvdb"
    tvdb_season_type: Optional[str] = None


class SwitchSeasonTypeRequest(BaseModel):
    """Request model for switching TVDB season type."""

    season_type: str


class FixMatchEntry(BaseModel):
    """A single file-to-episode mapping for fix match."""

    source_path: str
    target_season: int
    target_episode: int


class FixMatchRequest(BaseModel):
    """Request model for fixing match of extra files."""

    target_show_id: int
    matches: list[FixMatchEntry]


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


_ARTICLE_RE = re.compile(r'^(the|a|an)\s+', re.IGNORECASE)


def _compute_sort_name(name: str) -> str:
    """Strip leading articles and return lowercase sort name.

    "The Goldbergs" -> "goldbergs", "A Team" -> "team", "An Example" -> "example"
    """
    return _ARTICLE_RE.sub('', name).lower() if name else ''


def _sort_key_char(sort_name: str) -> str:
    """First character uppercased, or '#' for non-alpha."""
    if not sort_name:
        return '#'
    ch = sort_name[0].upper()
    return ch if ch.isalpha() else '#'


def _sort_key_prefix(sort_name: str, length: int = 2) -> str:
    """First `length` chars, title-cased for display labels."""
    prefix = sort_name[:length] if sort_name else '#'
    return prefix.title()


def _compute_page_boundaries(sorted_shows, target_size: int):
    """Break sorted shows into pages at letter boundaries.

    Each item in sorted_shows is (id, name, sort_name).
    Returns list of {"start": idx, "end": idx, "label": str}.
    """
    if not sorted_shows or target_size <= 0:
        return [{"start": 0, "end": len(sorted_shows) - 1, "label": "All"}] if sorted_shows else []

    # Group by first letter
    from itertools import groupby

    def first_letter(item):
        return _sort_key_char(item[2])

    groups = []
    for letter, items in groupby(sorted_shows, key=first_letter):
        items_list = list(items)
        groups.append((letter, items_list))

    pages = []
    current_page_items = []
    current_page_start = 0
    idx = 0

    def flush_page(items, start_idx):
        """Add a finished page."""
        if not items:
            return
        pages.append({
            "start": start_idx,
            "end": start_idx + len(items) - 1,
            "items": items,
        })

    for letter, group_items in groups:
        group_size = len(group_items)

        if len(current_page_items) == 0:
            # Page is empty, always add the group (or split if too large)
            if group_size > target_size:
                # Split large letter group by 2-char prefix
                sub_groups = []
                for prefix, sub_items in groupby(group_items, key=lambda x: _sort_key_prefix(x[2])):
                    sub_groups.append((prefix, list(sub_items)))

                for prefix, sub_items in sub_groups:
                    if len(current_page_items) + len(sub_items) <= target_size or len(current_page_items) == 0:
                        current_page_items.extend(sub_items)
                    else:
                        flush_page(current_page_items, current_page_start)
                        current_page_start = current_page_start + len(current_page_items) if pages else idx
                        current_page_start = pages[-1]["end"] + 1 if pages else 0
                        current_page_items = list(sub_items)
            else:
                current_page_items.extend(group_items)
        elif len(current_page_items) + group_size <= target_size:
            # Fits in current page
            current_page_items.extend(group_items)
        else:
            # Doesn't fit — flush current page, start new one
            flush_page(current_page_items, current_page_start)
            current_page_start = pages[-1]["end"] + 1
            current_page_items = []

            if group_size > target_size:
                # Split large letter group by 2-char prefix
                sub_groups = []
                for prefix, sub_items in groupby(group_items, key=lambda x: _sort_key_prefix(x[2])):
                    sub_groups.append((prefix, list(sub_items)))

                for prefix, sub_items in sub_groups:
                    if len(current_page_items) + len(sub_items) <= target_size or len(current_page_items) == 0:
                        current_page_items.extend(sub_items)
                    else:
                        flush_page(current_page_items, current_page_start)
                        current_page_start = pages[-1]["end"] + 1
                        current_page_items = list(sub_items)
            else:
                current_page_items.extend(group_items)

    # Flush remaining
    if current_page_items:
        flush_page(current_page_items, current_page_start)

    # Track which letters span multiple pages (for sub-letter labels)
    letter_page_count = {}
    for page in pages:
        page_letters = set()
        for item in page["items"]:
            page_letters.add(_sort_key_char(item[2]))
        for lt in page_letters:
            letter_page_count[lt] = letter_page_count.get(lt, 0) + 1

    # Compute labels
    result = []
    for page in pages:
        items = page["items"]
        first_char = _sort_key_char(items[0][2])
        last_char = _sort_key_char(items[-1][2])

        if first_char == last_char and letter_page_count.get(first_char, 1) > 1:
            # Same letter spans multiple pages — use 2-char prefix labels
            first_prefix = _sort_key_prefix(items[0][2])
            last_prefix = _sort_key_prefix(items[-1][2])
            if first_prefix == last_prefix:
                label = first_prefix
            else:
                label = f"{first_prefix}-{last_prefix}"
        elif first_char == last_char:
            label = first_char
        else:
            label = f"{first_char}-{last_char}"

        result.append({
            "start": page["start"],
            "end": page["end"],
            "label": label,
        })

    return result


def _get_default_metadata_source(db: Session) -> str:
    """Get the default metadata source from settings."""
    setting = db.query(AppSettings).filter(AppSettings.key == "default_metadata_source").first()
    return setting.value if setting else "tmdb"


@router.get("")
async def list_shows(
    db: Session = Depends(get_db),
    page: int = Query(1, ge=1),
    per_page: int = Query(0, ge=0),
):
    """List all shows with library-style pagination.

    per_page=0 returns all shows on one page.
    Pages break at letter boundaries (article-stripped sort).
    """
    from ..models import IgnoredEpisode, SpecialEpisode

    # Lightweight query: just id + name
    rows = db.query(Show.id, Show.name).all()
    total = len(rows)

    # Compute sort names and sort in Python (article-stripped)
    sorted_shows = sorted(
        [(r.id, r.name, _compute_sort_name(r.name)) for r in rows],
        key=lambda x: x[2],
    )

    # Compute page boundaries
    if per_page > 0 and total > 0:
        boundaries = _compute_page_boundaries(sorted_shows, per_page)
    else:
        boundaries = [{"start": 0, "end": total - 1, "label": "All"}] if total > 0 else []

    total_pages = len(boundaries) if boundaries else 1

    # Clamp page
    if page > total_pages:
        page = total_pages
    if page < 1:
        page = 1

    # Extract show IDs for the requested page
    if boundaries and total > 0:
        b = boundaries[page - 1]
        page_shows = sorted_shows[b["start"]:b["end"] + 1]
        page_ids = [s[0] for s in page_shows]
    else:
        page_ids = []

    page_labels = [b["label"] for b in boundaries]

    # Fetch full Show objects for just those IDs
    if page_ids:
        shows = db.query(Show).filter(Show.id.in_(page_ids)).all()
        # Re-sort to match the sorted order
        id_order = {sid: i for i, sid in enumerate(page_ids)}
        shows.sort(key=lambda s: id_order.get(s.id, 0))
    else:
        shows = []

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

    return {
        "total": total,
        "total_pages": total_pages,
        "page": page,
        "shows": result,
        "page_labels": page_labels,
    }


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

    # Find extra files on disk not matched to any episode
    extra_files = []
    if show.folder_path:
        import os
        from ..config import settings as app_settings
        video_extensions = set(app_settings.video_extensions)
        matched_paths = set(
            ep.file_path for ep in episodes if ep.file_path
        )
        try:
            for root, dirs, filenames in os.walk(show.folder_path):
                for f in sorted(filenames):
                    if Path(f).suffix.lower() in video_extensions:
                        full_path = os.path.join(root, f)
                        if full_path not in matched_paths:
                            extra_files.append({
                                "filename": f,
                                "path": full_path,
                            })
        except (PermissionError, OSError):
            pass
    show_dict["extra_files"] = extra_files

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
    explicit_source = data.metadata_source  # What the user explicitly chose (may be None)
    default_source = explicit_source or _get_default_metadata_source(db)
    tvdb_season_type = data.tvdb_season_type or "official"

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
                default_data = await tvdb.get_show_with_episodes(data.tvdb_id, season_type=tvdb_season_type)
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
                default_data = await tvdb.get_show_with_episodes(data.tvdb_id, season_type=tvdb_season_type)
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
                    secondary_data = await tvdb.get_show_with_episodes(tvdb_id, season_type=tvdb_season_type)
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
    # Only auto-switch sources when the user didn't explicitly choose one.
    # If they picked a specific source from the search UI, respect that choice.
    source_switched = False
    original_source = default_source
    switch_reason = None

    def count_non_special(show_result):
        return sum(1 for ep in show_result.get("episodes", []) if ep.get("season", 0) > 0)

    default_count = count_non_special(default_data)

    if secondary_data and not explicit_source:
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
        tvdb_season_type=tvdb_season_type if metadata_source == "tvdb" else "official",
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
    if data.aliases is not None:
        import json
        show.aliases = json.dumps(data.aliases) if data.aliases else None

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


def _rename_episodes_to_match_metadata(db: Session, show: Show) -> int:
    """Rename episode files on disk to match current metadata titles.

    Compares each episode's current file path against the expected path
    generated from the show's episode_format and the episode's metadata.
    Files that don't match are renamed (along with accompanying subtitle,
    image and metadata files).

    Returns the number of files renamed.
    """
    if not show.folder_path:
        return 0

    from ..services.renamer import RenamerService

    renamer = RenamerService(db)
    renamed_count = 0

    # Get all episodes that have files on disk
    episodes = (
        db.query(Episode)
        .filter(
            Episode.show_id == show.id,
            Episode.file_path.isnot(None),
            Episode.file_status.in_(["found", "renamed"]),
        )
        .all()
    )

    # Group by file_path to handle multi-episode files (same file mapped to
    # multiple episode records).  We rename the physical file once and update
    # every episode that pointed at the old path.
    path_to_episodes: dict[str, list[Episode]] = {}
    for ep in episodes:
        path_to_episodes.setdefault(ep.file_path, []).append(ep)

    for file_path, eps in path_to_episodes.items():
        current_path = Path(file_path)
        if not current_path.exists():
            continue

        extension = current_path.suffix

        if len(eps) > 1:
            # Multi-episode file: generate combined filename
            expected_path = Path(
                renamer.generate_multi_episode_path(show, eps, extension)
            )
        else:
            expected_path = Path(
                renamer.generate_episode_path(show, eps[0], extension)
            )

        if current_path == expected_path:
            continue  # Already named correctly

        # Avoid overwriting an existing different file
        if expected_path.exists() and expected_path != current_path:
            logger.warning(
                "Rename skipped – destination already exists: %s", expected_path
            )
            continue

        expected_path.parent.mkdir(parents=True, exist_ok=True)

        try:
            shutil.move(str(current_path), str(expected_path))
            renamer._move_accompanying_files(current_path, expected_path)

            for ep in eps:
                ep.file_path = str(expected_path)
                ep.file_status = "renamed"

            renamed_count += 1
            logger.info(
                "Renamed: %s → %s", current_path.name, expected_path.name
            )
        except Exception as exc:
            logger.error("Rename failed for %s: %s", current_path, exc)

    if renamed_count > 0:
        db.commit()

    return renamed_count


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
            show_data = await tvdb.get_show_with_episodes(show.tvdb_id, season_type=show.tvdb_season_type or "official")
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
    from ..services.scanner import ScannerService
    from ..routers.scan import _scan_show_folder

    scanner = ScannerService(db)
    matched_count = 0

    if show.folder_path:
        show_dir = Path(show.folder_path)
        if show_dir.exists():
            matched_count, _ = _scan_show_folder(scanner, show, show_dir)
            db.commit()
            db.refresh(show)

    # If no files matched, try discovering the correct folder in library folders
    if matched_count == 0:
        discovered = scanner.find_show_folder(show)
        if discovered and discovered != show.folder_path:
            logger.info(f"Refresh: discovered existing folder for '{show.name}': {discovered}")
            show.folder_path = discovered
            db.commit()
            show_dir = Path(discovered)
            if show_dir.exists():
                _scan_show_folder(scanner, show, show_dir)
                db.commit()
                db.refresh(show)

    # Rename files on disk to match updated metadata
    _rename_episodes_to_match_metadata(db, show)
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
    season_type = data.tvdb_season_type or show.tvdb_season_type or "official"
    try:
        if data.metadata_source == "tvdb":
            if not show.tvdb_id:
                raise HTTPException(status_code=400, detail="Show has no TVDB ID. Cannot switch to TVDB.")
            show_data = await tvdb.get_show_with_episodes(show.tvdb_id, season_type=season_type)
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
    if data.metadata_source == "tvdb":
        show.tvdb_season_type = season_type
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


@router.post("/{show_id}/switch-season-type")
async def switch_season_type(
    show_id: int,
    data: SwitchSeasonTypeRequest,
    db: Session = Depends(get_db),
    tvdb: TVDBService = Depends(get_tvdb_service),
):
    """Switch a TVDB show's episode ordering (season type)."""
    show = db.query(Show).filter(Show.id == show_id).first()
    if not show:
        raise HTTPException(status_code=404, detail="Show not found")

    if show.metadata_source != "tvdb":
        raise HTTPException(status_code=400, detail="Season type only applies to TVDB-sourced shows")
    if not show.tvdb_id:
        raise HTTPException(status_code=400, detail="Show has no TVDB ID")

    if show.tvdb_season_type == data.season_type:
        return show.to_dict()

    # Fetch episodes with the new season type
    try:
        show_data = await tvdb.get_show_with_episodes(show.tvdb_id, season_type=data.season_type)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Failed to fetch episodes with season type '{data.season_type}': {e}")

    # Update season type and show metadata
    show.tvdb_season_type = data.season_type
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

    # Delete all existing episodes
    existing_episodes = db.query(Episode).filter(Episode.show_id == show.id).all()
    for ep in existing_episodes:
        db.delete(ep)
    db.flush()

    # Create new episodes from the new ordering
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
        from ..services.scanner import ScannerService
        from ..routers.scan import _scan_show_folder

        show_dir = Path(show.folder_path)
        if show_dir.exists():
            scanner = ScannerService(db)
            _scan_show_folder(scanner, show, show_dir)
            db.commit()
            db.refresh(show)

    # Rename files on disk to match new metadata
    _rename_episodes_to_match_metadata(db, show)
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


@router.get("/tvdb/{tvdb_id}/season-types")
async def get_tvdb_season_types(
    tvdb_id: int,
    tvdb: TVDBService = Depends(get_tvdb_service),
):
    """Get available season types for a TVDB show."""
    try:
        season_types = await tvdb.get_season_types(tvdb_id)
        return {"season_types": season_types}
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Failed to fetch season types: {e}")


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
                show_data = await tvdb.get_show_with_episodes(show.tvdb_id, season_type=show.tvdb_season_type or "official")
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

            # Rename files on disk to match updated metadata
            _rename_episodes_to_match_metadata(db, show)

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


@router.post("/{show_id}/fix-match/preview")
async def fix_match_preview(
    show_id: int,
    data: FixMatchRequest,
    db: Session = Depends(get_db),
):
    """Preview fix-match operations without moving files."""
    from ..services.renamer import RenamerService

    # Validate source show exists
    source_show = db.query(Show).filter(Show.id == show_id).first()
    if not source_show:
        raise HTTPException(status_code=404, detail="Source show not found")

    # Validate target show exists and has a folder_path
    target_show = db.query(Show).filter(Show.id == data.target_show_id).first()
    if not target_show:
        raise HTTPException(status_code=404, detail="Target show not found")
    if not target_show.folder_path:
        raise HTTPException(status_code=400, detail="Target show has no folder path configured")

    renamer = RenamerService(db)
    results = []
    has_conflicts = False

    for match in data.matches:
        source_path = Path(match.source_path)
        source_filename = source_path.name
        result = {
            "source_path": match.source_path,
            "source_filename": source_filename,
            "target_path": None,
            "target_episode_name": None,
            "conflict": False,
            "error": None,
        }

        # Find the target episode
        target_ep = (
            db.query(Episode)
            .filter(
                Episode.show_id == data.target_show_id,
                Episode.season == match.target_season,
                Episode.episode == match.target_episode,
            )
            .first()
        )

        if not target_ep:
            result["error"] = f"Episode S{match.target_season:02d}E{match.target_episode:02d} not found"
            results.append(result)
            continue

        result["target_episode_name"] = f"S{target_ep.season:02d}E{target_ep.episode:02d} - {target_ep.title}"

        # Check if episode already has a file
        if target_ep.file_path and target_ep.file_status != "missing":
            result["conflict"] = True
            result["error"] = "Episode already has a file"
            has_conflicts = True
            results.append(result)
            continue

        # Generate expected target path
        extension = source_path.suffix
        try:
            target_path = renamer.generate_episode_path(target_show, target_ep, extension)
            result["target_path"] = target_path
        except Exception as e:
            result["error"] = str(e)

        results.append(result)

    return {
        "target_show_name": target_show.name,
        "results": results,
        "has_conflicts": has_conflicts,
    }


@router.post("/{show_id}/fix-match")
async def fix_match_execute(
    show_id: int,
    data: FixMatchRequest,
    db: Session = Depends(get_db),
):
    """Execute fix-match: move files to target show's episode locations."""
    from datetime import datetime
    from ..services.renamer import RenamerService

    # Validate source show exists
    source_show = db.query(Show).filter(Show.id == show_id).first()
    if not source_show:
        raise HTTPException(status_code=404, detail="Source show not found")

    # Validate target show exists and has a folder_path
    target_show = db.query(Show).filter(Show.id == data.target_show_id).first()
    if not target_show:
        raise HTTPException(status_code=404, detail="Target show not found")
    if not target_show.folder_path:
        raise HTTPException(status_code=400, detail="Target show has no folder path configured")

    renamer = RenamerService(db)
    results = []
    success_count = 0
    error_count = 0

    for match in data.matches:
        source_path = Path(match.source_path)
        result = {
            "source_path": match.source_path,
            "source_filename": source_path.name,
            "success": False,
            "error": None,
        }

        # Verify source file exists
        if not source_path.exists():
            result["error"] = "Source file not found on disk"
            error_count += 1
            results.append(result)
            continue

        # Find the target episode
        target_ep = (
            db.query(Episode)
            .filter(
                Episode.show_id == data.target_show_id,
                Episode.season == match.target_season,
                Episode.episode == match.target_episode,
            )
            .first()
        )

        if not target_ep:
            result["error"] = f"Episode S{match.target_season:02d}E{match.target_episode:02d} not found"
            error_count += 1
            results.append(result)
            continue

        # Verify episode doesn't already have a file
        if target_ep.file_path and target_ep.file_status != "missing":
            result["error"] = "Episode already has a file"
            error_count += 1
            results.append(result)
            continue

        # Generate target path
        extension = source_path.suffix
        try:
            target_path_str = renamer.generate_episode_path(target_show, target_ep, extension)
            target_path = Path(target_path_str)
        except Exception as e:
            result["error"] = f"Failed to generate path: {e}"
            error_count += 1
            results.append(result)
            continue

        # Create season folder if needed
        target_path.parent.mkdir(parents=True, exist_ok=True)

        # Move the file
        try:
            shutil.move(str(source_path), str(target_path))
            renamer._move_accompanying_files(source_path, target_path)

            # Update episode record
            target_ep.file_path = str(target_path)
            target_ep.file_status = "renamed"
            target_ep.matched_at = datetime.utcnow()

            result["success"] = True
            success_count += 1
        except Exception as e:
            result["error"] = f"Move failed: {e}"
            error_count += 1

        results.append(result)

    db.commit()

    return {
        "message": f"Fix match complete: {success_count} moved, {error_count} errors",
        "success_count": success_count,
        "error_count": error_count,
        "results": results,
    }
