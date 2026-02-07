"""Settings and configuration models."""

from datetime import datetime
from typing import Optional

from sqlalchemy import String, Integer, Boolean, DateTime, Text, ForeignKey
from sqlalchemy.orm import Mapped, mapped_column

from ..database import Base


class ScanFolder(Base):
    """Scan folder configuration."""

    __tablename__ = "scan_folders"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    path: Mapped[str] = mapped_column(String(1024), nullable=False, unique=True)
    folder_type: Mapped[str] = mapped_column(String(50), nullable=False)
    # Type values: library, download
    enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime, default=datetime.utcnow, nullable=False
    )

    def __repr__(self) -> str:
        return f"<ScanFolder(id={self.id}, path='{self.path}', type='{self.folder_type}')>"

    def to_dict(self) -> dict:
        """Convert to dictionary for API responses."""
        return {
            "id": self.id,
            "path": self.path,
            "type": self.folder_type,
            "enabled": self.enabled,
            "created_at": self.created_at.isoformat() if self.created_at else None,
        }


class PendingAction(Base):
    """Pending rename/move actions."""

    __tablename__ = "pending_actions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    action_type: Mapped[str] = mapped_column(String(50), nullable=False)
    # Type values: rename, move, copy, delete

    source_path: Mapped[str] = mapped_column(String(1024), nullable=False)
    dest_path: Mapped[Optional[str]] = mapped_column(String(1024), nullable=True)

    show_id: Mapped[Optional[int]] = mapped_column(
        Integer, ForeignKey("shows.id", ondelete="SET NULL"), nullable=True
    )
    episode_id: Mapped[Optional[int]] = mapped_column(
        Integer, ForeignKey("episodes.id", ondelete="SET NULL"), nullable=True
    )
    movie_id: Mapped[Optional[int]] = mapped_column(
        Integer, ForeignKey("movies.id", ondelete="SET NULL"), nullable=True
    )

    status: Mapped[str] = mapped_column(String(50), default="pending")
    # Status values: pending, approved, completed, rejected, failed

    error_message: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    created_at: Mapped[datetime] = mapped_column(
        DateTime, default=datetime.utcnow, nullable=False
    )
    completed_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)

    def __repr__(self) -> str:
        return f"<PendingAction(id={self.id}, type='{self.action_type}', status='{self.status}')>"

    def to_dict(self) -> dict:
        """Convert to dictionary for API responses."""
        return {
            "id": self.id,
            "type": self.action_type,
            "source_path": self.source_path,
            "dest_path": self.dest_path,
            "show_id": self.show_id,
            "episode_id": self.episode_id,
            "movie_id": self.movie_id,
            "status": self.status,
            "error_message": self.error_message,
            "created_at": self.created_at.isoformat() if self.created_at else None,
            "completed_at": self.completed_at.isoformat() if self.completed_at else None,
        }


class AppSettings(Base):
    """Application settings stored in database."""

    __tablename__ = "app_settings"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    key: Mapped[str] = mapped_column(String(255), nullable=False, unique=True)
    value: Mapped[str] = mapped_column(Text, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False
    )

    def __repr__(self) -> str:
        return f"<AppSettings(key='{self.key}')>"


class IgnoredEpisode(Base):
    """Ignored episodes that should not appear in missing lists."""

    __tablename__ = "ignored_episodes"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    episode_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("episodes.id", ondelete="CASCADE"), nullable=False, unique=True
    )
    reason: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime, default=datetime.utcnow, nullable=False
    )

    def __repr__(self) -> str:
        return f"<IgnoredEpisode(episode_id={self.episode_id})>"

    def to_dict(self) -> dict:
        """Convert to dictionary for API responses."""
        return {
            "id": self.id,
            "episode_id": self.episode_id,
            "reason": self.reason,
            "created_at": self.created_at.isoformat() if self.created_at else None,
        }
