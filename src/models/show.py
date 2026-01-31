"""Show model for TV series."""

from datetime import datetime
from typing import Optional, TYPE_CHECKING

from sqlalchemy import String, Integer, Boolean, DateTime, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from ..database import Base

if TYPE_CHECKING:
    from .episode import Episode


class Show(Base):
    """TV Show model."""

    __tablename__ = "shows"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    tmdb_id: Mapped[Optional[int]] = mapped_column(Integer, unique=True, nullable=True)
    tvdb_id: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    imdb_id: Mapped[Optional[str]] = mapped_column(String(20), nullable=True)
    metadata_source: Mapped[str] = mapped_column(String(10), default="tmdb", nullable=False)
    tvdb_season_type: Mapped[Optional[str]] = mapped_column(String(20), default="official", nullable=True)

    name: Mapped[str] = mapped_column(String(255), nullable=False)
    overview: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    poster_path: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    backdrop_path: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    folder_path: Mapped[Optional[str]] = mapped_column(String(1024), nullable=True)

    # Naming formats
    season_format: Mapped[str] = mapped_column(
        String(255), default="Season {season}", nullable=False
    )
    episode_format: Mapped[str] = mapped_column(
        String(255), default="{season}x{episode:02d} - {title}", nullable=False
    )

    # Flags
    do_rename: Mapped[bool] = mapped_column(Boolean, default=True)
    do_missing: Mapped[bool] = mapped_column(Boolean, default=True)

    # Status
    status: Mapped[str] = mapped_column(String(50), default="Unknown")
    first_air_date: Mapped[Optional[str]] = mapped_column(String(10), nullable=True)
    number_of_seasons: Mapped[int] = mapped_column(Integer, default=0)
    number_of_episodes: Mapped[int] = mapped_column(Integer, default=0)

    # Additional metadata
    genres: Mapped[Optional[str]] = mapped_column(Text, nullable=True)  # JSON array
    networks: Mapped[Optional[str]] = mapped_column(Text, nullable=True)  # JSON array
    aliases: Mapped[Optional[str]] = mapped_column(Text, nullable=True)  # JSON array
    next_episode_air_date: Mapped[Optional[str]] = mapped_column(String(10), nullable=True)

    # Timestamps
    created_at: Mapped[datetime] = mapped_column(
        DateTime, default=datetime.utcnow, nullable=False
    )
    last_updated: Mapped[datetime] = mapped_column(
        DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False
    )

    # Relationships
    episodes: Mapped[list["Episode"]] = relationship(
        "Episode", back_populates="show", cascade="all, delete-orphan"
    )

    def __repr__(self) -> str:
        return f"<Show(id={self.id}, name='{self.name}', tmdb_id={self.tmdb_id})>"

    def to_dict(self) -> dict:
        """Convert to dictionary for API responses."""
        import json
        return {
            "id": self.id,
            "tmdb_id": self.tmdb_id,
            "tvdb_id": self.tvdb_id,
            "imdb_id": self.imdb_id,
            "metadata_source": self.metadata_source,
            "tvdb_season_type": self.tvdb_season_type,
            "name": self.name,
            "overview": self.overview,
            "poster_path": self.poster_path,
            "backdrop_path": self.backdrop_path,
            "folder_path": self.folder_path,
            "season_format": self.season_format,
            "episode_format": self.episode_format,
            "do_rename": self.do_rename,
            "do_missing": self.do_missing,
            "status": self.status,
            "first_air_date": self.first_air_date,
            "number_of_seasons": self.number_of_seasons,
            "number_of_episodes": self.number_of_episodes,
            "genres": json.loads(self.genres) if self.genres else [],
            "networks": json.loads(self.networks) if self.networks else [],
            "aliases": json.loads(self.aliases) if self.aliases else [],
            "next_episode_air_date": self.next_episode_air_date,
            "created_at": self.created_at.isoformat() if self.created_at else None,
            "last_updated": self.last_updated.isoformat() if self.last_updated else None,
        }
