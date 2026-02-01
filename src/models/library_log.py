"""Library log model for tracking rename/import file operations."""

from datetime import datetime
from typing import Optional

from sqlalchemy import String, Integer, DateTime, Text, ForeignKey
from sqlalchemy.orm import Mapped, mapped_column

from ..database import Base


class LibraryLog(Base):
    """Log entries for library file operations (renames, imports)."""

    __tablename__ = "library_log"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    timestamp: Mapped[datetime] = mapped_column(
        DateTime, default=datetime.utcnow, nullable=False
    )
    action_type: Mapped[str] = mapped_column(String(50), nullable=False)
    # Type values: rename, import, rename_failed, import_failed

    file_path: Mapped[Optional[str]] = mapped_column(String(1024), nullable=True)
    dest_path: Mapped[Optional[str]] = mapped_column(String(1024), nullable=True)
    show_name: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    show_id: Mapped[Optional[int]] = mapped_column(
        Integer, ForeignKey("shows.id", ondelete="SET NULL"), nullable=True
    )
    episode_code: Mapped[Optional[str]] = mapped_column(String(20), nullable=True)
    result: Mapped[Optional[str]] = mapped_column(String(50), nullable=True)
    # Result values: success, failed
    details: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    def __repr__(self) -> str:
        return f"<LibraryLog(id={self.id}, action='{self.action_type}', result='{self.result}')>"

    def to_dict(self) -> dict:
        """Convert to dictionary for API responses."""
        return {
            "id": self.id,
            "timestamp": self.timestamp.isoformat() if self.timestamp else None,
            "action_type": self.action_type,
            "file_path": self.file_path,
            "dest_path": self.dest_path,
            "show_name": self.show_name,
            "show_id": self.show_id,
            "episode_code": self.episode_code,
            "result": self.result,
            "details": self.details,
        }
