"""Movie model for films."""

from datetime import datetime
from typing import Optional

from sqlalchemy import String, Integer, Boolean, DateTime, Text, Float
from sqlalchemy.orm import Mapped, mapped_column

from ..database import Base


class Movie(Base):
    """Movie model."""

    __tablename__ = "movies"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    tmdb_id: Mapped[Optional[int]] = mapped_column(Integer, unique=True, nullable=True)
    imdb_id: Mapped[Optional[str]] = mapped_column(String(20), nullable=True)

    title: Mapped[str] = mapped_column(String(500), nullable=False)
    original_title: Mapped[Optional[str]] = mapped_column(String(500), nullable=True)
    overview: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    tagline: Mapped[Optional[str]] = mapped_column(String(500), nullable=True)

    year: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    release_date: Mapped[Optional[str]] = mapped_column(String(10), nullable=True)
    runtime: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)

    poster_path: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    backdrop_path: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)

    genres: Mapped[Optional[str]] = mapped_column(Text, nullable=True)  # JSON array
    studio: Mapped[Optional[str]] = mapped_column(Text, nullable=True)  # JSON array of production companies

    vote_average: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    popularity: Mapped[Optional[float]] = mapped_column(Float, nullable=True)

    status: Mapped[str] = mapped_column(String(50), default="Released")

    # File tracking (single file per movie)
    file_path: Mapped[Optional[str]] = mapped_column(String(1024), nullable=True)
    folder_path: Mapped[Optional[str]] = mapped_column(String(1024), nullable=True)
    file_status: Mapped[str] = mapped_column(String(50), default="missing")
    # Status values: missing, found, renamed
    matched_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)

    # Edition info
    edition: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)

    # Collection info
    collection_id: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    collection_name: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)

    # Flags
    do_rename: Mapped[bool] = mapped_column(Boolean, default=True)

    # Timestamps
    created_at: Mapped[datetime] = mapped_column(
        DateTime, default=datetime.utcnow, nullable=False
    )
    last_updated: Mapped[datetime] = mapped_column(
        DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False
    )

    def __repr__(self) -> str:
        return f"<Movie(id={self.id}, title='{self.title}', tmdb_id={self.tmdb_id})>"

    def to_dict(self) -> dict:
        """Convert to dictionary for API responses."""
        import json
        return {
            "id": self.id,
            "tmdb_id": self.tmdb_id,
            "imdb_id": self.imdb_id,
            "title": self.title,
            "original_title": self.original_title,
            "overview": self.overview,
            "tagline": self.tagline,
            "year": self.year,
            "release_date": self.release_date,
            "runtime": self.runtime,
            "poster_path": self.poster_path,
            "backdrop_path": self.backdrop_path,
            "genres": json.loads(self.genres) if self.genres else [],
            "studio": json.loads(self.studio) if self.studio else [],
            "vote_average": self.vote_average,
            "popularity": self.popularity,
            "status": self.status,
            "file_path": self.file_path,
            "folder_path": self.folder_path,
            "file_status": self.file_status,
            "matched_at": self.matched_at.isoformat() if self.matched_at else None,
            "edition": self.edition,
            "collection_id": self.collection_id,
            "collection_name": self.collection_name,
            "do_rename": self.do_rename,
            "created_at": self.created_at.isoformat() if self.created_at else None,
            "last_updated": self.last_updated.isoformat() if self.last_updated else None,
        }
