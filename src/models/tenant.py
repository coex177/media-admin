"""Tenancy: Tenant / User / UserSession / Agent, plus the ORM-level tenant scope.

Every business model mixes in TenantMixin. A contextvar holds the current tenant
for the request (set by the auth dependency) and two Session events make it
invisible to the rest of the code:

  * do_orm_execute  → every ORM SELECT/UPDATE/DELETE on a TenantMixin model gets
                      `tenant_id == current` appended (with_loader_criteria).
  * before_flush    → new TenantMixin rows get tenant_id stamped if unset.

ponytail: when no tenant is set (None) nothing is filtered. That is "legacy
mode" for the in-process watcher thread and startup migrations; every /api
route is forced through require_user by a test, so HTTP never runs unscoped.
"""

from contextvars import ContextVar
from datetime import datetime
from typing import Optional

from sqlalchemy import DateTime, ForeignKey, Integer, String, event
from sqlalchemy.orm import Mapped, Session, mapped_column, relationship, with_loader_criteria

from ..database import Base

current_tenant_id: ContextVar[Optional[int]] = ContextVar("current_tenant_id", default=None)


class TenantMixin:
    tenant_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False, index=True
    )


class Tenant(Base):
    __tablename__ = "tenants"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    tenant_id: Mapped[int] = mapped_column(Integer, ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False, index=True)
    email: Mapped[str] = mapped_column(String(255), nullable=False, unique=True)
    password_hash: Mapped[str] = mapped_column(String(255), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)

    tenant: Mapped[Tenant] = relationship()

    def to_dict(self) -> dict:
        return {"id": self.id, "email": self.email, "tenant_id": self.tenant_id, "tenant_name": self.tenant.name}


class UserSession(Base):
    __tablename__ = "user_sessions"

    token_hash: Mapped[str] = mapped_column(String(64), primary_key=True)
    user_id: Mapped[int] = mapped_column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    expires_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)

    user: Mapped[User] = relationship()


class Agent(TenantMixin, Base):
    """A paired local agent. Only the sha256 of its token is stored."""

    __tablename__ = "agents"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    token_hash: Mapped[str] = mapped_column(String(64), nullable=False, unique=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)
    last_seen: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "name": self.name,
            "created_at": self.created_at.isoformat(),
            "last_seen": self.last_seen.isoformat() if self.last_seen else None,
        }


# ── ORM scope ───────────────────────────────────────────────────────

@event.listens_for(Session, "do_orm_execute")
def _scope_to_tenant(state):
    tid = current_tenant_id.get()
    if tid is None or state.is_column_load or state.is_relationship_load:
        return
    if state.is_select or state.is_update or state.is_delete:
        state.statement = state.statement.options(
            with_loader_criteria(TenantMixin, lambda cls: cls.tenant_id == tid, include_aliases=True)
        )


@event.listens_for(Session, "before_flush")
def _stamp_tenant(session, _flush_context, _instances):
    tid = current_tenant_id.get()
    if tid is None:
        return
    for obj in session.new:
        if isinstance(obj, TenantMixin) and obj.tenant_id is None:
            obj.tenant_id = tid
