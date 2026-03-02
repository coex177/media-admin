"""API endpoints for RSS feeds."""

import logging
from typing import Optional
from xml.etree import ElementTree

import httpx
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from ..database import get_db
from ..models.rss_feed import RssFeed

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/feeds", tags=["feeds"])


class FeedCreate(BaseModel):
    url: str


class FeedUpdate(BaseModel):
    title: str


class FeedResponse(BaseModel):
    id: int
    title: Optional[str]
    url: str
    enabled: bool
    created_at: str


class FeedEntry(BaseModel):
    title: str
    link: str
    date: Optional[str] = None
    categories: list[str] = []


def _parse_rss(xml_bytes: bytes) -> tuple[Optional[str], list[dict]]:
    """Parse RSS/Atom XML and return (feed_title, entries)."""
    root = ElementTree.fromstring(xml_bytes)

    # Namespace map for Atom feeds
    ns = {"atom": "http://www.w3.org/2005/Atom"}

    feed_title = None
    entries = []

    if root.tag == "rss" or root.find("channel") is not None:
        # RSS 2.0
        channel = root.find("channel")
        if channel is None:
            return None, []

        title_el = channel.find("title")
        feed_title = title_el.text if title_el is not None else None

        for item in channel.findall("item"):
            entry = {}
            t = item.find("title")
            entry["title"] = t.text if t is not None and t.text else "Untitled"
            l = item.find("link")
            entry["link"] = l.text if l is not None and l.text else ""
            d = item.find("pubDate")
            entry["date"] = d.text if d is not None and d.text else None
            entry["categories"] = [
                c.text for c in item.findall("category") if c.text
            ]
            entries.append(entry)

    elif root.tag == "{http://www.w3.org/2005/Atom}feed":
        # Atom
        title_el = root.find("atom:title", ns)
        feed_title = title_el.text if title_el is not None else None

        for item in root.findall("atom:entry", ns):
            entry = {}
            t = item.find("atom:title", ns)
            entry["title"] = t.text if t is not None and t.text else "Untitled"
            l = item.find("atom:link", ns)
            entry["link"] = l.get("href", "") if l is not None else ""
            d = item.find("atom:updated", ns) or item.find("atom:published", ns)
            entry["date"] = d.text if d is not None and d.text else None
            entry["categories"] = [
                c.get("term", "")
                for c in item.findall("atom:category", ns)
                if c.get("term")
            ]
            entries.append(entry)

    return feed_title, entries


async def _fetch_feed_xml(url: str) -> bytes:
    """Fetch feed XML from URL."""
    headers = {"User-Agent": "MediaAdmin/1.0 (+RSS reader)"}
    async with httpx.AsyncClient(timeout=15.0, follow_redirects=True, headers=headers) as client:
        resp = await client.get(url)
        if resp.status_code == 403:
            # Some sites block non-browser UAs, others block browser UAs —
            # retry with a minimal fallback identity
            resp = await client.get(url, headers={"User-Agent": "curl/8.5"})
        resp.raise_for_status()
        return resp.content


@router.get("")
def list_feeds(db: Session = Depends(get_db)):
    feeds = db.query(RssFeed).order_by(RssFeed.created_at.desc()).all()
    return [f.to_dict() for f in feeds]


@router.post("", status_code=201)
async def add_feed(body: FeedCreate, db: Session = Depends(get_db)):
    url = body.url.strip()
    if not url:
        raise HTTPException(status_code=400, detail="URL is required")

    existing = db.query(RssFeed).filter(RssFeed.url == url).first()
    if existing:
        raise HTTPException(status_code=409, detail="Feed already exists")

    # Fetch the feed to get the title
    try:
        xml_bytes = await _fetch_feed_xml(url)
        feed_title, _ = _parse_rss(xml_bytes)
    except httpx.HTTPStatusError as e:
        raise HTTPException(status_code=400, detail=f"Failed to fetch feed: HTTP {e.response.status_code}")
    except Exception as e:
        logger.warning(f"Failed to fetch/parse feed {url}: {e}")
        feed_title = None

    feed = RssFeed(url=url, title=feed_title or url)
    db.add(feed)
    db.commit()
    db.refresh(feed)
    return feed.to_dict()


@router.patch("/{feed_id}")
def update_feed(feed_id: int, body: FeedUpdate, db: Session = Depends(get_db)):
    feed = db.query(RssFeed).filter(RssFeed.id == feed_id).first()
    if not feed:
        raise HTTPException(status_code=404, detail="Feed not found")
    title = body.title.strip()
    if not title:
        raise HTTPException(status_code=400, detail="Title is required")
    feed.title = title
    db.commit()
    db.refresh(feed)
    return feed.to_dict()


@router.delete("/{feed_id}", status_code=204)
def delete_feed(feed_id: int, db: Session = Depends(get_db)):
    feed = db.query(RssFeed).filter(RssFeed.id == feed_id).first()
    if not feed:
        raise HTTPException(status_code=404, detail="Feed not found")
    db.delete(feed)
    db.commit()


@router.get("/{feed_id}/entries")
async def get_feed_entries(feed_id: int, db: Session = Depends(get_db)):
    feed = db.query(RssFeed).filter(RssFeed.id == feed_id).first()
    if not feed:
        raise HTTPException(status_code=404, detail="Feed not found")

    try:
        xml_bytes = await _fetch_feed_xml(feed.url)
        _, entries = _parse_rss(xml_bytes)
    except Exception as e:
        logger.warning(f"Failed to fetch feed entries for {feed.url}: {e}")
        raise HTTPException(status_code=502, detail=f"Failed to fetch feed: {e}")

    return entries
