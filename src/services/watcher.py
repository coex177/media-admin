"""Download folder watcher service with stability checking and queue-based coordination."""

import logging
import os
import threading
import time
from datetime import datetime
from pathlib import Path
from typing import Callable, Optional

from watchdog.observers import Observer
from watchdog.events import FileSystemEventHandler, FileCreatedEvent, FileMovedEvent

from ..config import settings

logger = logging.getLogger(__name__)

# Stability check interval (seconds) — how long a file must remain unchanged
STABILITY_SECONDS = 60

# How often the maturity thread checks pending files (seconds)
MATURITY_CHECK_INTERVAL = 10


class DownloadHandler(FileSystemEventHandler):
    """Handler for file system events in download folders."""

    def __init__(self, watcher: "WatcherService"):
        super().__init__()
        self.watcher = watcher
        self.video_extensions = set(settings.video_extensions)

    def _is_video_file(self, path: str) -> bool:
        """Check if a file is a video file."""
        return Path(path).suffix.lower() in self.video_extensions

    def on_created(self, event: FileCreatedEvent):
        if event.is_directory:
            return
        if self._is_video_file(event.src_path):
            self.watcher.on_file_detected(event.src_path)

    def on_moved(self, event: FileMovedEvent):
        if event.is_directory:
            return
        if self._is_video_file(event.dest_path):
            self.watcher.on_file_detected(event.dest_path)

    def on_modified(self, event):
        if event.is_directory:
            return
        if self._is_video_file(event.src_path):
            self.watcher.on_file_modified(event.src_path)


class WatcherService:
    """Service for watching download folders for new video files.

    Lifecycle:
        start() → running (observing + maturity thread)
        stop()  → fully stopped

    Queue coordination:
        The watcher and manual scans share a lock. Only one can process
        at a time. If the other is busy, work is queued and processed
        when the lock becomes available.
    """

    def __init__(self):
        self.observer: Optional[Observer] = None
        self._watched_paths: set[str] = set()
        self._handlers: dict[str, DownloadHandler] = {}
        self._callback: Optional[Callable[[str], None]] = None
        self._running = False

        # Pending files: path → (first_seen, last_modified_size)
        self._pending: dict[str, tuple[float, int]] = {}
        self._pending_lock = threading.Lock()

        # Queued files (detected while a scan or watcher processing holds the lock)
        self._queued: list[str] = []
        self._queue_lock = threading.Lock()

        # Processing lock — shared with manual scan operations.
        # Only one of (watcher pipeline, manual scan) runs at a time.
        self._scan_lock = threading.Lock()
        self._scan_running = False

        # Maturity check thread
        self._maturity_thread: Optional[threading.Thread] = None
        self._maturity_stop = threading.Event()

        # Watch subdirectories setting
        self._monitor_subfolders: bool = True

        # Minimum file size in bytes
        self._min_file_size_bytes: int = 50 * 1024 * 1024  # 50MB default

        # Auto-purge settings
        self._auto_purge_days: int = 0  # 0 = disabled
        self._issues_folder: str = ""
        self._last_purge_check: float = 0.0
        self._purge_check_interval: float = 3600  # Check once per hour

    def set_callback(self, callback: Callable[[str], None]):
        """Set the callback function for stable file events."""
        self._callback = callback

    def set_monitor_subfolders(self, enabled: bool):
        """Set whether to watch subdirectories."""
        self._monitor_subfolders = enabled

    def set_min_file_size(self, size_mb: int):
        """Set minimum file size in MB."""
        self._min_file_size_bytes = max(0, size_mb) * 1024 * 1024

    def set_auto_purge_days(self, days: int):
        """Set auto-purge threshold in days (0 = disabled)."""
        self._auto_purge_days = max(0, days)

    def set_issues_folder(self, path: str):
        """Set the issues folder path for auto-purge."""
        self._issues_folder = path

    # ── File detection ──────────────────────────────────────────────

    def on_file_detected(self, file_path: str):
        """Called when a new video file is detected by watchdog."""
        try:
            size = os.path.getsize(file_path)
        except OSError:
            size = 0

        with self._pending_lock:
            self._pending[file_path] = (time.time(), size)
            logger.info(f"File detected, starting stability timer: {file_path}")

    def on_file_modified(self, file_path: str):
        """Called when a watched file is modified — resets its stability timer."""
        with self._pending_lock:
            if file_path in self._pending:
                try:
                    size = os.path.getsize(file_path)
                except OSError:
                    size = 0
                self._pending[file_path] = (time.time(), size)

    # ── Maturity thread ─────────────────────────────────────────────

    def _maturity_loop(self):
        """Background thread that checks pending files for stability."""
        while not self._maturity_stop.is_set():
            self._check_pending_files()
            self._check_auto_purge()
            self._maturity_stop.wait(MATURITY_CHECK_INTERVAL)

    def _check_pending_files(self):
        """Check if any pending files have been stable long enough."""
        now = time.time()
        mature_files = []

        with self._pending_lock:
            for path, (detected_at, last_size) in list(self._pending.items()):
                # Check if file still exists
                if not os.path.exists(path):
                    del self._pending[path]
                    continue

                # Check current size
                try:
                    current_size = os.path.getsize(path)
                except OSError:
                    continue

                # If size changed, reset timer
                if current_size != last_size:
                    self._pending[path] = (now, current_size)
                    continue

                # Check if stable for STABILITY_SECONDS
                if now - detected_at >= STABILITY_SECONDS:
                    # Check minimum file size
                    if current_size < self._min_file_size_bytes:
                        logger.info(
                            f"File too small ({current_size / 1024 / 1024:.1f}MB < "
                            f"{self._min_file_size_bytes / 1024 / 1024:.0f}MB), skipping: {path}"
                        )
                        del self._pending[path]
                        continue

                    mature_files.append(path)
                    del self._pending[path]

        # Process mature files
        for path in mature_files:
            self._process_stable_file(path)

    def _process_stable_file(self, file_path: str):
        """Process a file that has been stable for the required duration.

        Acquires the shared lock so that manual scans and watcher
        processing never overlap. If the lock is held (scan running),
        the file is queued and will be processed once the scan finishes.
        """
        if not self._callback:
            logger.warning(f"No callback set, cannot process: {file_path}")
            return

        # Check file still exists before trying to lock
        if not os.path.exists(file_path):
            logger.info(f"File no longer exists, skipping: {file_path}")
            return

        acquired = self._scan_lock.acquire(blocking=False)
        if not acquired:
            # A scan is running — queue for later
            with self._queue_lock:
                if file_path not in self._queued:
                    self._queued.append(file_path)
                    logger.info(f"Lock held (scan running) — queued file: {file_path}")
            return

        try:
            # Double-check file still exists after acquiring the lock
            if not os.path.exists(file_path):
                logger.info(f"File no longer exists, skipping: {file_path}")
                return

            logger.info(f"File stable, processing: {file_path}")
            self._callback(file_path)
        except Exception as e:
            logger.error(f"Error processing file {file_path}: {e}", exc_info=True)
        finally:
            self._scan_lock.release()

        # After releasing the lock, drain any queued files
        self._drain_queue()

    # ── Scan lock integration ───────────────────────────────────────

    def acquire_scan_lock(self, timeout: float = 300) -> bool:
        """Acquire the shared processing lock for a manual scan.

        Blocks up to `timeout` seconds waiting for the watcher to finish
        if it is currently processing a file. Returns True if acquired.
        """
        acquired = self._scan_lock.acquire(blocking=True, timeout=timeout)
        if acquired:
            self._scan_running = True
        else:
            logger.warning(f"Could not acquire scan lock within {timeout}s")
        return acquired

    def release_scan_lock(self):
        """Release the shared processing lock after a manual scan."""
        self._scan_running = False
        try:
            self._scan_lock.release()
        except RuntimeError:
            pass

        # Drain any files the watcher queued while the scan was running
        self._drain_queue()

    def _drain_queue(self):
        """Process queued files one at a time, respecting the lock.

        Each file is processed only if the lock is available and the
        file still exists.
        """
        while True:
            with self._queue_lock:
                if not self._queued:
                    return
                file_path = self._queued.pop(0)

            if not os.path.exists(file_path):
                logger.info(f"Queued file no longer exists, skipping: {file_path}")
                continue

            acquired = self._scan_lock.acquire(blocking=False)
            if not acquired:
                # Lock taken again (a scan just started) — re-queue and stop
                with self._queue_lock:
                    self._queued.insert(0, file_path)
                return

            try:
                if not os.path.exists(file_path):
                    logger.info(f"Queued file no longer exists, skipping: {file_path}")
                    continue

                logger.info(f"Processing queued file: {file_path}")
                if self._callback:
                    self._callback(file_path)
            except Exception as e:
                logger.error(f"Error processing queued file {file_path}: {e}", exc_info=True)
            finally:
                self._scan_lock.release()

    # ── Folder management ───────────────────────────────────────────

    def add_watch_folder(self, path: str) -> bool:
        """Add a folder to watch.

        Can be called before or after start(). The path is always registered;
        if the observer is already running it is scheduled immediately,
        otherwise start() will pick it up.
        """
        folder = Path(path)
        if not folder.exists() or not folder.is_dir():
            logger.error(f"Cannot watch non-existent folder: {path}")
            return False

        if path in self._watched_paths:
            return True

        handler = DownloadHandler(self)
        self._handlers[path] = handler
        self._watched_paths.add(path)

        # If the observer is already live, schedule immediately
        if self.observer and self._running:
            self.observer.schedule(handler, path, recursive=self._monitor_subfolders)

        logger.info(f"Added watch folder: {path}")
        return True

    def remove_watch_folder(self, path: str) -> bool:
        """Remove a folder from watching."""
        if path not in self._watched_paths:
            return False

        self._watched_paths.discard(path)
        if path in self._handlers:
            del self._handlers[path]

        if self.observer and self._running:
            self._restart_observer()

        logger.info(f"Removed watch on folder: {path}")
        return True

    def _restart_observer(self):
        """Restart the observer with current watched paths."""
        if self.observer:
            self.observer.stop()
            self.observer.join(timeout=5)

        self.observer = Observer()
        for path, handler in self._handlers.items():
            if path in self._watched_paths:
                self.observer.schedule(handler, path, recursive=self._monitor_subfolders)

        if self._running:
            self.observer.start()

    # ── Lifecycle ───────────────────────────────────────────────────

    def start(self):
        """Start watching all configured folders."""
        if self._running:
            return

        self.observer = Observer()

        for path, handler in self._handlers.items():
            if path in self._watched_paths:
                self.observer.schedule(handler, path, recursive=self._monitor_subfolders)

        self.observer.start()
        self._running = True

        # Start maturity check thread
        self._maturity_stop.clear()
        self._maturity_thread = threading.Thread(
            target=self._maturity_loop, daemon=True, name="watcher-maturity"
        )
        self._maturity_thread.start()

        logger.info("File watcher started")

        # Sweep download folders for files that arrived while the watcher was down
        self._catchup_sweep()

    def stop(self):
        """Stop watching folders completely."""
        if not self._running:
            return

        # Stop maturity thread
        self._maturity_stop.set()
        if self._maturity_thread:
            self._maturity_thread.join(timeout=5)
            self._maturity_thread = None

        # Stop observer
        if self.observer:
            self.observer.stop()
            self.observer.join(timeout=5)
            self.observer = None

        self._running = False

        # Clear all state
        with self._pending_lock:
            self._pending.clear()
        with self._queue_lock:
            self._queued.clear()
        self._watched_paths.clear()
        self._handlers.clear()

        logger.info("File watcher stopped")

    # ── Catch-up sweep ─────────────────────────────────────────────

    def _catchup_sweep(self):
        """Scan all download folders for video files that arrived while dormant.

        Any video files found that are not already pending or queued are
        added as newly detected files (they'll go through the normal
        stability timer).
        """
        video_extensions = set(settings.video_extensions)
        found = 0

        with self._pending_lock:
            pending_paths = set(self._pending.keys())
        with self._queue_lock:
            queued_paths = set(self._queued)

        for watched_path in list(self._watched_paths):
            folder = Path(watched_path)
            if not folder.is_dir():
                continue

            try:
                iterator = folder.rglob("*") if self._monitor_subfolders else folder.glob("*")
                for file_path in iterator:
                    if not file_path.is_file():
                        continue
                    if file_path.suffix.lower() not in video_extensions:
                        continue
                    str_path = str(file_path)
                    if str_path in pending_paths or str_path in queued_paths:
                        continue

                    try:
                        size = file_path.stat().st_size
                    except OSError:
                        continue

                    if size < self._min_file_size_bytes:
                        continue

                    with self._pending_lock:
                        self._pending[str_path] = (time.time(), size)
                    found += 1
            except PermissionError:
                logger.warning(f"Catch-up sweep: permission denied on {watched_path}")
            except OSError as e:
                logger.warning(f"Catch-up sweep: error scanning {watched_path}: {e}")

        if found:
            logger.info(f"Catch-up sweep: found {found} video file(s) to process")

    # ── Auto-purge ───────────────────────────────────────────────

    def _check_auto_purge(self):
        """Periodically purge old files from the Issues folder."""
        if self._auto_purge_days <= 0 or not self._issues_folder:
            return

        now = time.time()
        if now - self._last_purge_check < self._purge_check_interval:
            return
        self._last_purge_check = now

        issues_path = Path(self._issues_folder)
        if not issues_path.is_dir():
            return

        cutoff = now - (self._auto_purge_days * 86400)
        purged = 0

        try:
            for item in issues_path.rglob("*"):
                if not item.is_file():
                    continue
                try:
                    mtime = item.stat().st_mtime
                    if mtime < cutoff:
                        item.unlink()
                        purged += 1
                        logger.debug(f"Auto-purge: deleted {item}")
                except PermissionError:
                    logger.warning(f"Auto-purge: permission denied on {item}")
                except OSError as e:
                    logger.warning(f"Auto-purge: error deleting {item}: {e}")

            # Clean up empty subdirectories
            if purged:
                for dirpath in sorted(issues_path.rglob("*"), reverse=True):
                    if dirpath.is_dir():
                        try:
                            if not any(dirpath.iterdir()):
                                dirpath.rmdir()
                        except OSError:
                            pass

        except PermissionError:
            logger.warning(f"Auto-purge: permission denied scanning {issues_path}")
        except OSError as e:
            logger.warning(f"Auto-purge: error scanning issues folder: {e}")

        if purged:
            logger.info(f"Auto-purge: deleted {purged} file(s) older than {self._auto_purge_days} days")

    # ── Status ──────────────────────────────────────────────────────

    @property
    def is_running(self) -> bool:
        return self._running

    @property
    def watched_paths(self) -> list[str]:
        return list(self._watched_paths)

    @property
    def pending_count(self) -> int:
        with self._pending_lock:
            return len(self._pending)

    @property
    def queued_count(self) -> int:
        with self._queue_lock:
            return len(self._queued)

    def get_status(self) -> dict:
        """Get full watcher status."""
        return {
            "status": "running" if self._running else "stopped",
            "watched_paths": list(self._watched_paths),
            "pending_files": self.pending_count,
            "queued_files": self.queued_count,
        }


# Global watcher instance
watcher_service = WatcherService()
