"""RSS Feed model."""

from datetime import datetime
from typing import Optional

from sqlalchemy import String, Integer, Boolean, DateTime, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from ..database import Base
from .tenant import TenantMixin


class RssFeed(TenantMixin, Base):
    """RSS Feed subscription."""

    __tablename__ = "rss_feeds"
    __table_args__ = (UniqueConstraint("tenant_id", "url"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    title: Mapped[Optional[str]] = mapped_column(String(500), nullable=True)
    url: Mapped[str] = mapped_column(Text, nullable=False)
    enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime, default=datetime.utcnow, nullable=False
    )

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "title": self.title,
            "url": self.url,
            "enabled": self.enabled,
            "created_at": self.created_at.isoformat() if self.created_at else None,
        }
