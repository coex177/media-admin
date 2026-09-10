"""TVDB paginates with a `next` URL, not a page index.

Assigning that URL to the page counter made the client re-request page 0 and
stop, so a show over one page long came back duplicated and truncated.
"""

import asyncio

import pytest

from src.services.tvdb import TVDBService


def _page(episodes, has_next):
    return {
        "data": {"episodes": episodes},
        "links": {
            "next": "https://api4.thetvdb.com/v4/series/1/episodes/official/eng?page=1"
            if has_next else None
        },
    }


def test_paginates_past_the_first_page(monkeypatch):
    """Three pages must come back whole, in order, with nothing repeated."""
    pages = [
        _page([{"seasonNumber": 1, "number": n, "name": f"E{n}"} for n in range(1, 4)], True),
        _page([{"seasonNumber": 1, "number": n, "name": f"E{n}"} for n in range(4, 7)], True),
        _page([{"seasonNumber": 1, "number": n, "name": f"E{n}"} for n in range(7, 9)], False),
    ]
    requested = []

    async def fake_request(self, endpoint, params=None):
        page = (params or {}).get("page", 0)
        requested.append(page)
        assert isinstance(page, int), f"page must be an int, got {page!r}"
        return pages[page]

    monkeypatch.setattr(TVDBService, "_request", fake_request)

    episodes = asyncio.run(TVDBService(api_key="x").get_all_episodes(1))

    assert requested == [0, 1, 2]
    assert [e["episode"] for e in episodes] == [1, 2, 3, 4, 5, 6, 7, 8]
    assert len({(e["season"], e["episode"]) for e in episodes}) == len(episodes)


def test_stops_when_there_is_no_next_page(monkeypatch):
    calls = []

    async def fake_request(self, endpoint, params=None):
        calls.append((params or {}).get("page", 0))
        return _page([{"seasonNumber": 1, "number": 1, "name": "only"}], False)

    monkeypatch.setattr(TVDBService, "_request", fake_request)

    episodes = asyncio.run(TVDBService(api_key="x").get_all_episodes(1))

    assert calls == [0]
    assert len(episodes) == 1
