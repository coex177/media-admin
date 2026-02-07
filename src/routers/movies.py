"""API endpoints for movie management."""

import asyncio
import json
import logging
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, BackgroundTasks
from pydantic import BaseModel
from sqlalchemy import func
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import Movie, AppSettings
from ..services.tmdb import TMDBService
from ..services.movie_scanner import MovieScannerService
from ..services.pagination import compute_sort_name, compute_page_boundaries

logger = logging.getLogger("movie_scanner")

router = APIRouter(prefix="/api/movies", tags=["movies"])

# Global refresh status
_movie_refresh_status = {
    "running": False,
    "current": 0,
    "total": 0,
    "current_movie": "",
    "completed": [],
    "errors": [],
}


class MovieCreate(BaseModel):
    """Request model for creating a movie."""

    tmdb_id: int


class MovieUpdate(BaseModel):
    """Request model for updating a movie."""

    folder_path: Optional[str] = None
    do_rename: Optional[bool] = None
    edition: Optional[str] = None


def get_tmdb_service(db: Session = Depends(get_db)) -> TMDBService:
    """Get TMDB service with API key from settings."""
    api_key_setting = (
        db.query(AppSettings).filter(AppSettings.key == "tmdb_api_key").first()
    )
    api_key = api_key_setting.value if api_key_setting else ""
    return TMDBService(api_key=api_key)


def _get_setting(db: Session, key: str, default: str = "") -> str:
    setting = db.query(AppSettings).filter(AppSettings.key == key).first()
    return setting.value if setting else default




# ── Stats endpoints (must come before parameterized routes) ──

@router.get("/stats")
async def get_movie_stats(db: Session = Depends(get_db)):
    """Get movie statistics."""
    total = db.query(func.count(Movie.id)).scalar() or 0
    found = db.query(func.count(Movie.id)).filter(Movie.file_status != "missing").scalar() or 0
    missing = total - found

    # Total storage
    total_size = 0
    movies_with_files = db.query(Movie).filter(Movie.file_path.isnot(None)).all()
    for movie in movies_with_files:
        try:
            p = Path(movie.file_path)
            if p.exists():
                total_size += p.stat().st_size
        except (OSError, TypeError):
            pass

    return {
        "total": total,
        "found": found,
        "missing": missing,
        "total_size": total_size,
    }


@router.get("/recently-added")
async def get_recently_added_movies(
    db: Session = Depends(get_db),
):
    """Get recently added movies."""
    limit = int(_get_setting(db, "movie_recently_added_count", "5"))
    movies = (
        db.query(Movie)
        .order_by(Movie.created_at.desc())
        .limit(limit)
        .all()
    )
    return [m.to_dict() for m in movies]


@router.get("/recently-released")
async def get_recently_released_movies(db: Session = Depends(get_db)):
    """Get movies sorted by release date (newest first)."""
    limit = int(_get_setting(db, "movie_recently_released_count", "5"))
    movies = (
        db.query(Movie)
        .filter(Movie.release_date.isnot(None))
        .order_by(Movie.release_date.desc())
        .limit(limit)
        .all()
    )
    return [m.to_dict() for m in movies]


@router.get("/top-rated")
async def get_top_rated_movies(db: Session = Depends(get_db)):
    """Get movies sorted by vote_average (highest first)."""
    limit = int(_get_setting(db, "movie_top_rated_count", "5"))
    movies = (
        db.query(Movie)
        .filter(Movie.vote_average.isnot(None))
        .order_by(Movie.vote_average.desc())
        .limit(limit)
        .all()
    )
    return [m.to_dict() for m in movies]


@router.get("/lowest-rated")
async def get_lowest_rated_movies(db: Session = Depends(get_db)):
    """Get movies sorted by vote_average (lowest first, excluding 0)."""
    limit = int(_get_setting(db, "movie_lowest_rated_count", "5"))
    movies = (
        db.query(Movie)
        .filter(Movie.vote_average.isnot(None), Movie.vote_average > 0)
        .order_by(Movie.vote_average.asc())
        .limit(limit)
        .all()
    )
    return [m.to_dict() for m in movies]



@router.get("/genre-distribution")
async def get_genre_distribution(db: Session = Depends(get_db)):
    """Get genre breakdown across all movies."""
    movies = db.query(Movie).filter(Movie.genres.isnot(None)).all()
    genre_movies = {}
    for movie in movies:
        try:
            genres = json.loads(movie.genres)
            for genre in genres:
                if genre not in genre_movies:
                    genre_movies[genre] = []
                genre_movies[genre].append({"id": movie.id, "title": movie.title})
        except (json.JSONDecodeError, TypeError):
            pass

    sorted_genres = sorted(genre_movies.items(), key=lambda x: len(x[1]), reverse=True)
    return [{"genre": g, "count": len(m), "movies": sorted(m, key=lambda x: x["title"])} for g, m in sorted_genres]


@router.get("/studio-distribution")
async def get_studio_distribution(db: Session = Depends(get_db)):
    """Get studio breakdown across all movies."""
    movies = db.query(Movie).filter(Movie.studio.isnot(None)).all()
    studio_movies = {}
    for movie in movies:
        try:
            studios = json.loads(movie.studio)
            for studio in studios:
                if studio not in studio_movies:
                    studio_movies[studio] = []
                studio_movies[studio].append({"id": movie.id, "title": movie.title})
        except (json.JSONDecodeError, TypeError):
            pass

    sorted_studios = sorted(studio_movies.items(), key=lambda x: len(x[1]), reverse=True)
    return [{"studio": s, "count": len(m), "movies": sorted(m, key=lambda x: x["title"])} for s, m in sorted_studios]


@router.get("/collections")
async def get_movie_collections(db: Session = Depends(get_db)):
    """Get movies grouped by TMDB collection."""
    movies = (
        db.query(Movie)
        .filter(Movie.collection_id.isnot(None))
        .order_by(Movie.collection_name, Movie.year)
        .all()
    )

    collections = {}
    for movie in movies:
        cid = movie.collection_id
        if cid not in collections:
            collections[cid] = {
                "collection_id": cid,
                "collection_name": movie.collection_name,
                "movies": [],
            }
        collections[cid]["movies"].append(movie.to_dict())

    return list(collections.values())


@router.get("/search/tmdb")
async def search_tmdb_movies(
    q: str = Query(..., min_length=1),
    page: int = Query(1, ge=1),
    year: int = Query(None),
    tmdb: TMDBService = Depends(get_tmdb_service),
):
    """Search TMDB for movies."""
    try:
        results = await tmdb.search_movies(q, page, year)
        return {
            "results": [
                {
                    "id": r.get("id"),
                    "title": r.get("title"),
                    "overview": r.get("overview"),
                    "poster_path": r.get("poster_path"),
                    "release_date": r.get("release_date"),
                    "vote_average": r.get("vote_average"),
                }
                for r in results.get("results", [])
            ],
            "page": results.get("page", 1),
            "total_pages": results.get("total_pages", 1),
            "total_results": results.get("total_results", 0),
        }
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Search failed: {e}")


@router.get("/lookup/tmdb/{tmdb_id}")
async def lookup_tmdb_movie_by_id(
    tmdb_id: int,
    tmdb: TMDBService = Depends(get_tmdb_service),
):
    """Look up a specific movie by its TMDB ID. Returns it in search result format."""
    try:
        movie = await tmdb.get_movie(tmdb_id)
        return {
            "id": movie.get("id"),
            "title": movie.get("title"),
            "overview": movie.get("overview"),
            "poster_path": movie.get("poster_path"),
            "release_date": movie.get("release_date"),
            "vote_average": movie.get("vote_average"),
        }
    except Exception as e:
        raise HTTPException(status_code=404, detail=f"Movie not found: {e}")


@router.get("/preview/{tmdb_id}")
async def preview_movie(
    tmdb_id: int,
    db: Session = Depends(get_db),
    tmdb: TMDBService = Depends(get_tmdb_service),
):
    """Preview movie data from TMDB without adding to library."""
    try:
        movie_data = await tmdb.get_movie_with_details(tmdb_id)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Failed to fetch from TMDB: {e}")

    # Check if already in library
    existing = db.query(Movie).filter(Movie.tmdb_id == tmdb_id).first()
    movie_data["in_library"] = existing is not None
    movie_data["library_id"] = existing.id if existing else None

    return movie_data


@router.get("/refresh-all/status")
async def get_movie_refresh_status():
    """Get the status of the refresh-all operation."""
    return _movie_refresh_status


# ── CRUD endpoints ──

@router.get("")
async def list_movies(
    db: Session = Depends(get_db),
    page: int = Query(1, ge=1),
    per_page: int = Query(0, ge=0),
):
    """List all movies with library-style pagination."""
    rows = db.query(Movie.id, Movie.title).all()
    total = len(rows)

    sorted_movies = sorted(
        [(r.id, r.title, compute_sort_name(r.title)) for r in rows],
        key=lambda x: x[2],
    )

    if per_page > 0 and total > 0:
        boundaries = compute_page_boundaries(sorted_movies, per_page)
    else:
        boundaries = [{"start": 0, "end": total - 1, "label": "All"}] if total > 0 else []

    total_pages = len(boundaries) if boundaries else 1

    if page > total_pages:
        page = total_pages
    if page < 1:
        page = 1

    if boundaries and total > 0:
        b = boundaries[page - 1]
        page_movies = sorted_movies[b["start"]:b["end"] + 1]
        page_ids = [m[0] for m in page_movies]
    else:
        page_ids = []

    page_labels = [b["label"] for b in boundaries]

    if page_ids:
        movies = db.query(Movie).filter(Movie.id.in_(page_ids)).all()
        id_order = {mid: i for i, mid in enumerate(page_ids)}
        movies.sort(key=lambda m: id_order.get(m.id, 0))
    else:
        movies = []

    return {
        "total": total,
        "total_pages": total_pages,
        "page": page,
        "movies": [m.to_dict() for m in movies],
        "page_labels": page_labels,
    }


@router.get("/{movie_id}")
async def get_movie(movie_id: int, db: Session = Depends(get_db)):
    """Get a movie by ID."""
    movie = db.query(Movie).filter(Movie.id == movie_id).first()
    if not movie:
        raise HTTPException(status_code=404, detail="Movie not found")

    movie_dict = movie.to_dict()

    # Check if file exists on disk
    if movie.file_path:
        file_exists = Path(movie.file_path).exists()
        movie_dict["file_exists"] = file_exists
        if file_exists:
            try:
                movie_dict["file_size"] = Path(movie.file_path).stat().st_size
            except OSError:
                movie_dict["file_size"] = 0
    else:
        movie_dict["file_exists"] = False
        movie_dict["file_size"] = 0

    return movie_dict


@router.post("")
async def create_movie(
    data: MovieCreate,
    db: Session = Depends(get_db),
    tmdb: TMDBService = Depends(get_tmdb_service),
):
    """Add a new movie from TMDB."""
    # Check for duplicate
    existing = db.query(Movie).filter(Movie.tmdb_id == data.tmdb_id).first()
    if existing:
        raise HTTPException(status_code=400, detail="Movie already exists")

    try:
        movie_data = await tmdb.get_movie_with_details(data.tmdb_id)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Failed to fetch from TMDB: {e}")

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
    )

    db.add(movie)
    db.commit()
    db.refresh(movie)

    # Auto-scan to find the file on disk
    try:
        scanner = MovieScannerService(db)
        scanner.scan_single_movie(movie)
        db.refresh(movie)
    except Exception as e:
        logger.warning(f"Auto-scan failed for '{movie.title}': {e}")

    return movie.to_dict()


@router.put("/{movie_id}")
async def update_movie(
    movie_id: int, data: MovieUpdate, db: Session = Depends(get_db)
):
    """Update movie settings."""
    movie = db.query(Movie).filter(Movie.id == movie_id).first()
    if not movie:
        raise HTTPException(status_code=404, detail="Movie not found")

    if data.folder_path is not None:
        movie.folder_path = data.folder_path
    if data.do_rename is not None:
        movie.do_rename = data.do_rename
    if data.edition is not None:
        movie.edition = data.edition

    db.commit()
    db.refresh(movie)

    return movie.to_dict()


@router.delete("/{movie_id}")
async def delete_movie(movie_id: int, db: Session = Depends(get_db)):
    """Remove a movie from the library."""
    movie = db.query(Movie).filter(Movie.id == movie_id).first()
    if not movie:
        raise HTTPException(status_code=404, detail="Movie not found")

    db.delete(movie)
    db.commit()

    return {"message": "Movie deleted"}


@router.post("/{movie_id}/refresh")
async def refresh_movie(
    movie_id: int,
    db: Session = Depends(get_db),
    tmdb: TMDBService = Depends(get_tmdb_service),
):
    """Refresh movie metadata from TMDB."""
    movie = db.query(Movie).filter(Movie.id == movie_id).first()
    if not movie:
        raise HTTPException(status_code=404, detail="Movie not found")

    if not movie.tmdb_id:
        raise HTTPException(status_code=400, detail="Movie has no TMDB ID")

    try:
        movie_data = await tmdb.get_movie_with_details(movie.tmdb_id)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Failed to refresh from TMDB: {e}")

    movie.title = movie_data.get("title", movie.title)
    movie.original_title = movie_data.get("original_title")
    movie.overview = movie_data.get("overview")
    movie.tagline = movie_data.get("tagline")
    movie.year = movie_data.get("year")
    movie.release_date = movie_data.get("release_date")
    movie.runtime = movie_data.get("runtime")
    movie.poster_path = movie_data.get("poster_path")
    movie.backdrop_path = movie_data.get("backdrop_path")
    movie.genres = movie_data.get("genres")
    movie.studio = movie_data.get("studio")
    movie.vote_average = movie_data.get("vote_average")
    movie.popularity = movie_data.get("popularity")
    movie.status = movie_data.get("status", movie.status)
    movie.imdb_id = movie_data.get("imdb_id") or movie.imdb_id
    movie.collection_id = movie_data.get("collection_id")
    movie.collection_name = movie_data.get("collection_name")

    db.commit()
    db.refresh(movie)

    return movie.to_dict()


async def _refresh_all_movies_async(db, tmdb):
    """Async helper to refresh all movies."""
    global _movie_refresh_status

    movies = db.query(Movie).all()
    _movie_refresh_status["total"] = len(movies)
    _movie_refresh_status["current"] = 0

    for movie in movies:
        _movie_refresh_status["current_movie"] = movie.title

        try:
            if not movie.tmdb_id:
                _movie_refresh_status["errors"].append(f"{movie.title}: No TMDB ID")
                _movie_refresh_status["current"] += 1
                continue

            movie_data = await tmdb.get_movie_with_details(movie.tmdb_id)

            movie.title = movie_data.get("title", movie.title)
            movie.original_title = movie_data.get("original_title")
            movie.overview = movie_data.get("overview")
            movie.tagline = movie_data.get("tagline")
            movie.year = movie_data.get("year")
            movie.release_date = movie_data.get("release_date")
            movie.runtime = movie_data.get("runtime")
            movie.poster_path = movie_data.get("poster_path")
            movie.backdrop_path = movie_data.get("backdrop_path")
            movie.genres = movie_data.get("genres")
            movie.studio = movie_data.get("studio")
            movie.vote_average = movie_data.get("vote_average")
            movie.popularity = movie_data.get("popularity")
            movie.status = movie_data.get("status", movie.status)
            movie.imdb_id = movie_data.get("imdb_id") or movie.imdb_id
            movie.collection_id = movie_data.get("collection_id")
            movie.collection_name = movie_data.get("collection_name")

            db.commit()
            _movie_refresh_status["completed"].append(movie.title)

        except Exception as e:
            _movie_refresh_status["errors"].append(f"{movie.title}: {str(e)}")
            db.rollback()

        _movie_refresh_status["current"] += 1
        await asyncio.sleep(0.5)

    _movie_refresh_status["current_movie"] = ""


def run_movie_refresh_all(db_session_maker, tmdb_api_key: str):
    """Background task to refresh all movies."""
    global _movie_refresh_status
    import time

    time.sleep(0.5)

    SessionLocal = db_session_maker()
    db = SessionLocal()

    loop = asyncio.new_event_loop()
    asyncio.set_event_loop(loop)

    try:
        _movie_refresh_status["running"] = True
        _movie_refresh_status["completed"] = []
        _movie_refresh_status["errors"] = []

        tmdb = TMDBService(api_key=tmdb_api_key)
        loop.run_until_complete(_refresh_all_movies_async(db, tmdb))

    except Exception as e:
        _movie_refresh_status["errors"].append(f"Fatal error: {str(e)}")
    finally:
        _movie_refresh_status["running"] = False
        try:
            loop.run_until_complete(loop.shutdown_asyncgens())
        except Exception:
            pass
        loop.close()
        db.close()


@router.post("/refresh-all")
async def refresh_all_movies(
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
):
    """Refresh metadata for all movies."""
    global _movie_refresh_status

    if _movie_refresh_status["running"]:
        raise HTTPException(status_code=400, detail="Refresh already in progress")

    tmdb_key_setting = (
        db.query(AppSettings).filter(AppSettings.key == "tmdb_api_key").first()
    )
    tmdb_key = tmdb_key_setting.value if tmdb_key_setting else ""

    if not tmdb_key:
        raise HTTPException(status_code=400, detail="TMDB API key not configured")

    from ..database import get_session_maker

    background_tasks.add_task(run_movie_refresh_all, get_session_maker, tmdb_key)

    return {"message": "Refresh started", "status": "running"}
