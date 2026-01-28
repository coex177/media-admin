"""Download folder watcher service."""

import asyncio
import logging
from pathlib import Path
from typing import Callable, Optional

from watchdog.observers import Observer
from watchdog.events import FileSystemEventHandler, FileCreatedEvent, FileMovedEvent

from ..config import settings

logger = logging.getLogger(__name__)


class DownloadHandler(FileSystemEventHandler):
    """Handler for file system events in download folders."""

    def __init__(self, callback: Callable[[str], None]):
        super().__init__()
        self.callback = callback
        self.video_extensions = set(settings.video_extensions)
        self._pending_files: dict[str, float] = {}
        self._settle_time = 5.0  # Wait for file to settle before processing

    def _is_video_file(self, path: str) -> bool:
        """Check if a file is a video file."""
        return Path(path).suffix.lower() in self.video_extensions

    def on_created(self, event: FileCreatedEvent):
        """Handle file creation events."""
        if event.is_directory:
            return

        if self._is_video_file(event.src_path):
            logger.info(f"New video file detected: {event.src_path}")
            # Schedule callback after settle time
            asyncio.get_event_loop().call_later(
                self._settle_time,
                lambda: self.callback(event.src_path),
            )

    def on_moved(self, event: FileMovedEvent):
        """Handle file move events."""
        if event.is_directory:
            return

        if self._is_video_file(event.dest_path):
            logger.info(f"Video file moved to watched folder: {event.dest_path}")
            asyncio.get_event_loop().call_later(
                self._settle_time,
                lambda: self.callback(event.dest_path),
            )


class WatcherService:
    """Service for watching download folders for new files."""

    def __init__(self):
        self.observer: Optional[Observer] = None
        self._watched_paths: set[str] = set()
        self._handlers: dict[str, DownloadHandler] = {}
        self._callback: Optional[Callable[[str], None]] = None
        self._running = False

    def set_callback(self, callback: Callable[[str], None]):
        """Set the callback function for new file events."""
        self._callback = callback

    def add_watch_folder(self, path: str) -> bool:
        """Add a folder to watch."""
        folder = Path(path)
        if not folder.exists() or not folder.is_dir():
            logger.error(f"Cannot watch non-existent folder: {path}")
            return False

        if path in self._watched_paths:
            return True  # Already watching

        if not self._callback:
            logger.error("No callback set for watcher")
            return False

        handler = DownloadHandler(self._callback)
        self._handlers[path] = handler

        if self.observer:
            self.observer.schedule(handler, path, recursive=True)
            self._watched_paths.add(path)
            logger.info(f"Added watch on folder: {path}")

        return True

    def remove_watch_folder(self, path: str) -> bool:
        """Remove a folder from watching."""
        if path not in self._watched_paths:
            return False

        self._watched_paths.discard(path)
        if path in self._handlers:
            del self._handlers[path]

        # Note: watchdog doesn't have a clean way to unschedule a specific watch
        # We would need to restart the observer
        if self.observer and self._running:
            self._restart_observer()

        logger.info(f"Removed watch on folder: {path}")
        return True

    def _restart_observer(self):
        """Restart the observer with current watched paths."""
        if self.observer:
            self.observer.stop()
            self.observer.join()

        self.observer = Observer()
        for path, handler in self._handlers.items():
            if path in self._watched_paths:
                self.observer.schedule(handler, path, recursive=True)

        if self._running:
            self.observer.start()

    def start(self):
        """Start watching all configured folders."""
        if self._running:
            return

        self.observer = Observer()

        for path, handler in self._handlers.items():
            if path in self._watched_paths:
                self.observer.schedule(handler, path, recursive=True)

        self.observer.start()
        self._running = True
        logger.info("File watcher started")

    def stop(self):
        """Stop watching folders."""
        if not self._running:
            return

        if self.observer:
            self.observer.stop()
            self.observer.join()

        self._running = False
        logger.info("File watcher stopped")

    @property
    def is_running(self) -> bool:
        """Check if the watcher is running."""
        return self._running

    @property
    def watched_paths(self) -> list[str]:
        """Get list of currently watched paths."""
        return list(self._watched_paths)


# Global watcher instance
watcher_service = WatcherService()
