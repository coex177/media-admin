"""API routers for media-admin."""

from .shows import router as shows_router
from .scan import router as scan_router
from .actions import router as actions_router
from .settings import router as settings_router
from .watcher import router as watcher_router

__all__ = ["shows_router", "scan_router", "actions_router", "settings_router", "watcher_router"]
