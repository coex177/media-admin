"""TVDB API client service."""

import asyncio
import json
from typing import Optional
from datetime import datetime, timedelta

import httpx

from ..config import settings


class TVDBService:
    """Service for interacting with TheTVDB API v4."""

    BASE_URL = "https://api4.thetvdb.com/v4"

    def __init__(self, api_key: str = ""):
        self.api_key = api_key
        self._client: Optional[httpx.AsyncClient] = None
        self._cache: dict = {}
        self._cache_expiry: dict = {}
        self._token: Optional[str] = None
        self._token_expiry: Optional[datetime] = None

    async def _get_client(self) -> httpx.AsyncClient:
        """Get or create HTTP client."""
        if self._client is None or self._client.is_closed:
            self._client = httpx.AsyncClient(timeout=30.0)
        return self._client

    async def close(self):
        """Close the HTTP client."""
        if self._client and not self._client.is_closed:
            await self._client.aclose()

    async def login(self):
        """Authenticate with TVDB API and store bearer token."""
        if not self.api_key:
            raise ValueError("TVDB API key not configured")

        client = await self._get_client()
        response = await client.post(
            f"{self.BASE_URL}/login",
            json={"apikey": self.api_key},
        )
        response.raise_for_status()
        data = response.json()
        self._token = data["data"]["token"]
        # Token valid for 24 hours, refresh after 23
        self._token_expiry = datetime.utcnow() + timedelta(hours=23)

    async def _ensure_token(self):
        """Ensure we have a valid token, refreshing if needed."""
        if not self._token or not self._token_expiry or datetime.utcnow() >= self._token_expiry:
            await self.login()

    async def _request(self, endpoint: str, params: dict = None) -> dict:
        """Make a GET request to TVDB API with authentication."""
        if not self.api_key:
            raise ValueError("TVDB API key not configured")

        # Check cache
        cache_key = f"{endpoint}:{params}"
        if cache_key in self._cache:
            if datetime.utcnow() < self._cache_expiry.get(cache_key, datetime.min):
                return self._cache[cache_key]

        await self._ensure_token()

        client = await self._get_client()
        headers = {"Authorization": f"Bearer {self._token}"}

        response = await client.get(
            f"{self.BASE_URL}{endpoint}",
            params=params or {},
            headers=headers,
        )
        response.raise_for_status()
        data = response.json()

        # Cache response for 1 hour
        self._cache[cache_key] = data
        self._cache_expiry[cache_key] = datetime.utcnow() + timedelta(hours=1)

        return data

    async def search_shows(self, query: str) -> list[dict]:
        """Search for TV series by name. Returns normalized results."""
        data = await self._request("/search", params={"query": query, "type": "series"})
        results = data.get("data", [])

        normalized = []
        for item in results:
            # Extract year from year field or first_air_time
            year = item.get("year")
            first_air_date = None
            if year:
                first_air_date = f"{year}-01-01"

            # TVDB search returns tvdb_id in the id field
            tvdb_id = item.get("tvdb_id") or item.get("id")
            # id might be a string like "series-12345", extract numeric part
            if isinstance(tvdb_id, str):
                tvdb_id = tvdb_id.replace("series-", "")
                try:
                    tvdb_id = int(tvdb_id)
                except (ValueError, TypeError):
                    tvdb_id = None

            # Get poster - TVDB returns image_url or thumbnail
            poster = item.get("image_url") or item.get("thumbnail") or ""

            # Prefer English name from translations
            translations = item.get("translations", {}) or {}
            eng_name = translations.get("eng")
            display_name = eng_name or item.get("name", "Unknown")

            # Prefer English overview from overviewTranslations if available
            overview_translations = item.get("overviewTranslations", {}) or {}
            eng_overview = overview_translations.get("eng") if isinstance(overview_translations, dict) else None
            display_overview = eng_overview or item.get("overview", "")

            normalized.append({
                "id": tvdb_id,
                "tvdb_id": tvdb_id,
                "name": display_name,
                "overview": display_overview,
                "first_air_date": first_air_date,
                "poster_path": poster,
            })

        return normalized

    async def get_show(self, tvdb_id: int) -> dict:
        """Get detailed information about a TV show."""
        data = await self._request(f"/series/{tvdb_id}/extended")
        return data.get("data", {})

    async def get_all_episodes(self, tvdb_id: int, language: str = "eng") -> list[dict]:
        """Get all episodes for a TV show, paginating through all pages.

        Uses the specified language for episode names/overviews.
        Falls back to default language if the translation endpoint fails.
        """
        episodes = []
        page = 0
        # Append language to endpoint for translated episode data
        endpoint = f"/series/{tvdb_id}/episodes/official/{language}" if language else f"/series/{tvdb_id}/episodes/official"

        while True:
            try:
                data = await self._request(
                    endpoint,
                    params={"page": page},
                )
            except Exception:
                # Fall back to no language if translation endpoint fails
                if language:
                    endpoint = f"/series/{tvdb_id}/episodes/official"
                    data = await self._request(
                        endpoint,
                        params={"page": page},
                    )
                else:
                    raise

            series_data = data.get("data", {})
            ep_list = series_data.get("episodes", [])

            if not ep_list:
                break

            for ep in ep_list:
                season_num = ep.get("seasonNumber", 0)
                episode_num = ep.get("number", 0)
                if episode_num is None:
                    continue

                episodes.append({
                    "season": season_num,
                    "episode": episode_num,
                    "title": ep.get("name") or f"Episode {episode_num}",
                    "overview": ep.get("overview"),
                    "air_date": ep.get("aired"),
                    "tvdb_id": ep.get("id"),
                    "still_path": ep.get("image"),
                    "runtime": ep.get("runtime"),
                })

            # Check for more pages
            links = data.get("links", {})
            next_page = links.get("next")
            if next_page and next_page != page:
                page = next_page
            else:
                break

        return episodes

    async def _get_english_translation(self, tvdb_id: int) -> dict:
        """Get English translation for a show (name + overview)."""
        try:
            data = await self._request(f"/series/{tvdb_id}/translations/eng")
            return data.get("data", {})
        except Exception:
            return {}

    async def get_show_with_episodes(self, tvdb_id: int) -> dict:
        """Get show details with all episodes, normalized to match TMDB format."""
        show = await self.get_show(tvdb_id)
        episodes = await self.get_all_episodes(tvdb_id)

        # Prefer English name/overview if the default is non-Latin
        eng = await self._get_english_translation(tvdb_id)

        # Extract genre names
        genres = []
        for genre in show.get("genres", []):
            name = genre.get("name") if isinstance(genre, dict) else genre
            if name:
                genres.append(name)

        # Extract network/company names
        networks = []
        for network in show.get("companies", []):
            if isinstance(network, dict):
                name = network.get("name")
                if name:
                    networks.append(name)

        # Get poster/backdrop - TVDB uses full URLs
        poster = show.get("image") or ""
        backdrop = ""
        for artwork in show.get("artworks", []):
            if isinstance(artwork, dict):
                art_type = artwork.get("type")
                # type 3 = background/backdrop in TVDB
                if art_type == 3 and not backdrop:
                    backdrop = artwork.get("image", "")

        # Get status
        status_data = show.get("status", {})
        if isinstance(status_data, dict):
            status_name = status_data.get("name", "Unknown")
        else:
            status_name = str(status_data) if status_data else "Unknown"

        # Map TVDB status names to standard ones
        status_map = {
            "Continuing": "Returning Series",
            "Ended": "Ended",
            "Upcoming": "In Production",
        }
        status_name = status_map.get(status_name, status_name)

        # Get first air date
        first_air_date = show.get("firstAired") or ""

        # Calculate number of seasons (from episodes)
        season_numbers = set()
        for ep in episodes:
            if ep["season"] > 0:
                season_numbers.add(ep["season"])

        # Get next episode air date (find first future episode)
        today = datetime.utcnow().strftime("%Y-%m-%d")
        next_episode_air_date = None
        for ep in sorted(episodes, key=lambda e: e.get("air_date") or "9999"):
            air = ep.get("air_date")
            if air and air > today:
                next_episode_air_date = air
                break

        # Remote IDs
        remote_ids = show.get("remoteIds", [])
        imdb_id = None
        for rid in (remote_ids or []):
            if isinstance(rid, dict) and rid.get("sourceName") == "IMDB":
                imdb_id = rid.get("id")
                break

        # Use English name/overview when available, fall back to default
        name = eng.get("name") or show.get("name", "Unknown")
        overview = eng.get("overview") or show.get("overview", "")

        return {
            "tmdb_id": None,
            "tvdb_id": tvdb_id,
            "imdb_id": imdb_id,
            "name": name,
            "overview": overview,
            "poster_path": poster,
            "backdrop_path": backdrop,
            "status": status_name,
            "first_air_date": first_air_date,
            "number_of_seasons": len(season_numbers),
            "number_of_episodes": len([e for e in episodes if e["season"] > 0]),
            "genres": json.dumps(genres),
            "networks": json.dumps(networks),
            "next_episode_air_date": next_episode_air_date,
            "episodes": episodes,
        }

    def get_image_url(self, path: str) -> str:
        """Get full URL for an image path.

        TVDB images are already full URLs, so just return as-is.
        """
        return path or ""
