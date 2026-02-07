"""TMDB API client service."""

import asyncio
import json
from typing import Optional
from datetime import datetime, timedelta

import httpx

from ..config import settings


class TMDBService:
    """Service for interacting with The Movie Database API."""

    BASE_URL = "https://api.themoviedb.org/3"
    IMAGE_BASE_URL = "https://image.tmdb.org/t/p"

    def __init__(self, api_key: str = ""):
        self.api_key = api_key or settings.tmdb_api_key
        self._client: Optional[httpx.AsyncClient] = None
        self._cache: dict = {}
        self._cache_expiry: dict = {}
        self._rate_limit_remaining = 40
        self._rate_limit_reset: Optional[datetime] = None

    async def _get_client(self) -> httpx.AsyncClient:
        """Get or create HTTP client."""
        if self._client is None or self._client.is_closed:
            self._client = httpx.AsyncClient(timeout=30.0)
        return self._client

    async def close(self):
        """Close the HTTP client."""
        if self._client and not self._client.is_closed:
            await self._client.aclose()

    async def _request(self, endpoint: str, params: dict = None) -> dict:
        """Make a request to TMDB API with rate limiting."""
        if not self.api_key:
            raise ValueError("TMDB API key not configured")

        # Check cache
        cache_key = f"{endpoint}:{params}"
        if cache_key in self._cache:
            if datetime.utcnow() < self._cache_expiry.get(cache_key, datetime.min):
                return self._cache[cache_key]

        # Rate limiting
        if self._rate_limit_remaining <= 1 and self._rate_limit_reset:
            wait_time = (self._rate_limit_reset - datetime.utcnow()).total_seconds()
            if wait_time > 0:
                await asyncio.sleep(wait_time)

        client = await self._get_client()
        params = params or {}
        params["api_key"] = self.api_key

        response = await client.get(f"{self.BASE_URL}{endpoint}", params=params)

        # Update rate limit info
        if "X-RateLimit-Remaining" in response.headers:
            self._rate_limit_remaining = int(response.headers["X-RateLimit-Remaining"])
        if "X-RateLimit-Reset" in response.headers:
            self._rate_limit_reset = datetime.fromtimestamp(
                int(response.headers["X-RateLimit-Reset"])
            )

        response.raise_for_status()
        data = response.json()

        # Cache response for 1 hour
        self._cache[cache_key] = data
        self._cache_expiry[cache_key] = datetime.utcnow() + timedelta(hours=1)

        return data

    async def search_shows(self, query: str, page: int = 1, year: int = None) -> dict:
        """Search for TV shows by name, optionally filtered by first air date year."""
        params = {"query": query, "page": page}
        if year:
            params["first_air_date_year"] = year
        return await self._request("/search/tv", params)

    async def get_show(self, tmdb_id: int) -> dict:
        """Get detailed information about a TV show."""
        return await self._request(f"/tv/{tmdb_id}")

    async def get_show_external_ids(self, tmdb_id: int) -> dict:
        """Get external IDs (TVDB, IMDB) for a show."""
        return await self._request(f"/tv/{tmdb_id}/external_ids")

    async def get_season(self, tmdb_id: int, season_number: int) -> dict:
        """Get details for a specific season."""
        return await self._request(f"/tv/{tmdb_id}/season/{season_number}")

    async def get_episode(
        self, tmdb_id: int, season_number: int, episode_number: int
    ) -> dict:
        """Get details for a specific episode."""
        return await self._request(
            f"/tv/{tmdb_id}/season/{season_number}/episode/{episode_number}"
        )

    async def get_all_episodes(self, tmdb_id: int) -> list[dict]:
        """Get all episodes for a TV show."""
        show = await self.get_show(tmdb_id)
        episodes = []

        for season_info in show.get("seasons", []):
            season_num = season_info.get("season_number", 0)

            try:
                season = await self.get_season(tmdb_id, season_num)
                for ep in season.get("episodes", []):
                    episodes.append({
                        "season": season_num,
                        "episode": ep.get("episode_number"),
                        "title": ep.get("name", f"Episode {ep.get('episode_number')}"),
                        "overview": ep.get("overview"),
                        "air_date": ep.get("air_date"),
                        "tmdb_id": ep.get("id"),
                        "still_path": ep.get("still_path"),
                        "runtime": ep.get("runtime"),
                    })
            except httpx.HTTPStatusError:
                # Season might not have details yet
                continue

        return episodes

    async def find_show_by_tvdb_id(self, tvdb_id: int) -> Optional[int]:
        """Find a TMDB show ID by its TVDB ID using the /find endpoint.

        Returns the TMDB ID (int) or None if not found.
        """
        try:
            data = await self._request(
                f"/find/{tvdb_id}",
                params={"external_source": "tvdb_id"},
            )
            tv_results = data.get("tv_results", [])
            if tv_results:
                return tv_results[0].get("id")
            return None
        except Exception:
            return None

    async def get_show_with_episodes(self, tmdb_id: int) -> dict:
        """Get show details with all episodes."""
        show = await self.get_show(tmdb_id)
        external_ids = await self.get_show_external_ids(tmdb_id)
        episodes = await self.get_all_episodes(tmdb_id)

        # Extract genre names
        genres = [g.get("name") for g in show.get("genres", []) if g.get("name")]

        # Extract network names
        networks = [n.get("name") for n in show.get("networks", []) if n.get("name")]

        # Get next episode air date
        next_ep = show.get("next_episode_to_air")
        next_episode_air_date = next_ep.get("air_date") if next_ep else None

        return {
            "tmdb_id": tmdb_id,
            "tvdb_id": external_ids.get("tvdb_id"),
            "imdb_id": external_ids.get("imdb_id"),
            "name": show.get("name"),
            "overview": show.get("overview"),
            "poster_path": show.get("poster_path"),
            "backdrop_path": show.get("backdrop_path"),
            "status": show.get("status"),
            "first_air_date": show.get("first_air_date"),
            "number_of_seasons": show.get("number_of_seasons", 0),
            "number_of_episodes": show.get("number_of_episodes", 0),
            "genres": json.dumps(genres),
            "networks": json.dumps(networks),
            "next_episode_air_date": next_episode_air_date,
            "episodes": episodes,
        }

    # ── Movie endpoints ──────────────────────────────────────────

    async def search_movies(self, query: str, page: int = 1, year: int = None) -> dict:
        """Search for movies by name, optionally filtered by year."""
        params = {"query": query, "page": page}
        if year:
            params["year"] = year
        return await self._request("/search/movie", params)

    async def get_movie(self, tmdb_id: int) -> dict:
        """Get detailed information about a movie."""
        return await self._request(f"/movie/{tmdb_id}")

    async def get_movie_external_ids(self, tmdb_id: int) -> dict:
        """Get external IDs (IMDB) for a movie."""
        return await self._request(f"/movie/{tmdb_id}/external_ids")

    async def get_movie_with_details(self, tmdb_id: int) -> dict:
        """Get movie details with external IDs, formatted for DB storage."""
        movie = await self.get_movie(tmdb_id)
        external_ids = await self.get_movie_external_ids(tmdb_id)

        # Extract genre names
        genres = [g.get("name") for g in movie.get("genres", []) if g.get("name")]

        # Extract production company names
        studios = [c.get("name") for c in movie.get("production_companies", []) if c.get("name")]

        # Extract year from release_date
        release_date = movie.get("release_date", "")
        year = None
        if release_date and len(release_date) >= 4:
            try:
                year = int(release_date[:4])
            except ValueError:
                pass

        # Collection info
        collection = movie.get("belongs_to_collection")
        collection_id = collection.get("id") if collection else None
        collection_name = collection.get("name") if collection else None

        return {
            "tmdb_id": tmdb_id,
            "imdb_id": external_ids.get("imdb_id"),
            "title": movie.get("title"),
            "original_title": movie.get("original_title"),
            "overview": movie.get("overview"),
            "tagline": movie.get("tagline"),
            "year": year,
            "release_date": release_date,
            "runtime": movie.get("runtime"),
            "poster_path": movie.get("poster_path"),
            "backdrop_path": movie.get("backdrop_path"),
            "genres": json.dumps(genres),
            "studio": json.dumps(studios),
            "vote_average": movie.get("vote_average"),
            "popularity": movie.get("popularity"),
            "status": movie.get("status", "Released"),
            "collection_id": collection_id,
            "collection_name": collection_name,
        }

    def get_image_url(self, path: str, size: str = "w500") -> str:
        """Get full URL for an image path."""
        if not path:
            return ""
        return f"{self.IMAGE_BASE_URL}/{size}{path}"
