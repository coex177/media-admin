"""Episode model for TV episodes."""

from datetime import datetime
from typing import Optional, TYPE_CHECKING

from sqlalchemy import String, Integer, DateTime, Text, ForeignKey
from sqlalchemy.orm import Mapped, mapped_column, relationship

from ..database import Base

if TYPE_CHECKING:
    from .show import Show


class Episode(Base):
    """TV Episode model."""

    __tablename__ = "episodes"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    show_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("shows.id", ondelete="CASCADE"), nullable=False
    )

    # Episode info
    season: Mapped[int] = mapped_column(Integer, nullable=False)
    episode: Mapped[int] = mapped_column(Integer, nullable=False)
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    overview: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    air_date: Mapped[Optional[str]] = mapped_column(String(10), nullable=True)
    tmdb_id: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    still_path: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)

    # File info
    file_path: Mapped[Optional[str]] = mapped_column(String(1024), nullable=True)
    file_status: Mapped[str] = mapped_column(String(50), default="missing")
    # Status values: missing, found, renamed, skipped
    matched_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)

    # Runtime in minutes
    runtime: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)

    # Timestamps
    created_at: Mapped[datetime] = mapped_column(
        DateTime, default=datetime.utcnow, nullable=False
    )
    last_updated: Mapped[datetime] = mapped_column(
        DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False
    )

    # Relationships
    show: Mapped["Show"] = relationship("Show", back_populates="episodes")

    def __repr__(self) -> str:
        return f"<Episode(id={self.id}, show_id={self.show_id}, S{self.season:02d}E{self.episode:02d})>"

    def to_dict(self) -> dict:
        """Convert to dictionary for API responses."""
        # Determine effective status (considers air date for missing episodes)
        effective_status = self.file_status
        if self.file_status == "missing" and not self.has_aired:
            effective_status = "not_aired"

        return {
            "id": self.id,
            "show_id": self.show_id,
            "season": self.season,
            "episode": self.episode,
            "title": self.title,
            "overview": self.overview,
            "air_date": self.air_date,
            "tmdb_id": self.tmdb_id,
            "still_path": self.still_path,
            "file_path": self.file_path,
            "file_status": effective_status,
            "runtime": self.runtime,
            "matched_at": self.matched_at.isoformat() if self.matched_at else None,
            "created_at": self.created_at.isoformat() if self.created_at else None,
            "last_updated": self.last_updated.isoformat() if self.last_updated else None,
        }

    @property
    def episode_code(self) -> str:
        """Get episode code like S01E01."""
        return f"S{self.season:02d}E{self.episode:02d}"

    @property
    def has_aired(self) -> bool:
        """Check if episode has aired based on air date."""
        if not self.air_date:
            return False
        try:
            air_datetime = datetime.strptime(self.air_date, "%Y-%m-%d")
            return air_datetime <= datetime.utcnow()
        except ValueError:
            return False
