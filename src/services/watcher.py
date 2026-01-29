"""Download folder watcher service with stability checking and heartbeat-based pause/resume."""

import logging
import os
import shutil
import threading
import time
from datetime import datetime, timedelta
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
        """Handle file creation events."""
        if event.is_directory:
            return
        if self._is_video_file(event.src_path):
            self.watcher.on_file_detected(event.src_path)

    def on_moved(self, event: FileMovedEvent):
        """Handle file move events."""
        if event.is_directory:
            return
        if self._is_video_file(event.dest_path):
            self.watcher.on_file_detected(event.dest_path)

    def on_modified(self, event):
        """Handle file modification events — resets stability timer."""
        if event.is_directory:
            return
        if self._is_video_file(event.src_path):
            self.watcher.on_file_modified(event.src_path)


class WatcherService:
    """Service for watching download folders for new video files.

    Lifecycle:
        start() → running (observing + maturity thread)
        pause() → paused (observing stopped, maturity thread paused)
        resume() → running again
        stop() → fully stopped

    Heartbeat:
        The frontend sends heartbeats every 30s. If no heartbeat is received
        for `inactivity_minutes`, the watcher pauses automatically.
        When a heartbeat arrives while paused-for-inactivity, it resumes.
    """

    def __init__(self):
        self.observer: Optional[Observer] = None
        self._watched_paths: set[str] = set()
        self._handlers: dict[str, DownloadHandler] = {}
        self._callback: Optional[Callable[[str], None]] = None
        self._running = False
        self._paused = False
        self._pause_reason: Optional[str] = None

        # Pending files: path → (first_seen, last_modified_size)
        self._pending: dict[str, tuple[float, int]] = {}
        self._pending_lock = threading.Lock()

        # Queued files (detected while scan is running or watcher is paused)
        self._queued: list[str] = []
        self._queue_lock = threading.Lock()

        # Scan lock — shared with manual scan operations
        self._scan_lock = threading.Lock()
        self._scan_running = False

        # Maturity check thread
        self._maturity_thread: Optional[threading.Thread] = None
        self._maturity_stop = threading.Event()

        # Heartbeat tracking
        self._last_heartbeat: Optional[float] = None
        self._inactivity_minutes: int = 5

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

    def set_inactivity_minutes(self, minutes: int):
        """Set the inactivity timeout in minutes (minimum 5)."""
        self._inactivity_minutes = max(5, minutes)

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
        if self._paused:
            with self._queue_lock:
                if file_path not in self._queued:
                    self._queued.append(file_path)
                    logger.info(f"Watcher paused — queued file: {file_path}")
            return

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
            if not self._paused:
                self._check_pending_files()
                self._check_inactivity()
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
        """Process a file that has been stable for the required duration."""
        if not self._callback:
            logger.warning(f"No callback set, cannot process: {file_path}")
            return

        # If a manual scan is running, queue the file
        if self._scan_running:
            with self._queue_lock:
                if file_path not in self._queued:
                    self._queued.append(file_path)
                    logger.info(f"Scan running — queued file: {file_path}")
            return

        logger.info(f"File stable, processing: {file_path}")
        try:
            self._callback(file_path)
        except Exception as e:
            logger.error(f"Error processing file {file_path}: {e}", exc_info=True)

    def _check_inactivity(self):
        """Check if the user has left the WebUI and we can resume.

        When the user is active in the WebUI, the watcher is paused to avoid
        conflicts with manual operations. Once heartbeats stop arriving for
        `inactivity_minutes`, the user has left and the watcher resumes.
        """
        if not self._paused or self._pause_reason != "user_active":
            return
        if not self._last_heartbeat:
            return

        elapsed = time.time() - self._last_heartbeat
        timeout = self._inactivity_minutes * 60

        if elapsed > timeout:
            logger.info(
                f"No heartbeat for {self._inactivity_minutes} minutes, user inactive — resuming watcher"
            )
            self.resume()

    # ── Heartbeat ───────────────────────────────────────────────────

    def heartbeat(self):
        """Record a heartbeat from the frontend.

        A heartbeat means the user is actively using the WebUI.
        The watcher pauses while the user is active to avoid conflicts
        with manual scan/move operations.
        """
        self._last_heartbeat = time.time()

        # If running, pause — user is active in the UI
        if self._running and not self._paused:
            logger.info("Heartbeat received — user active, pausing watcher")
            self.pause(reason="user_active")

    # ── Scan lock integration ───────────────────────────────────────

    def acquire_scan_lock(self) -> bool:
        """Try to acquire the scan lock. Returns True if acquired."""
        acquired = self._scan_lock.acquire(blocking=False)
        if acquired:
            self._scan_running = True
        return acquired

    def release_scan_lock(self):
        """Release the scan lock and process any queued files."""
        self._scan_running = False
        try:
            self._scan_lock.release()
        except RuntimeError:
            pass

        # Process queued files
        self._process_queue()

    def _process_queue(self):
        """Process files that were queued while scan was running or watcher was paused."""
        with self._queue_lock:
            queued = list(self._queued)
            self._queued.clear()

        for path in queued:
            if os.path.exists(path):
                logger.info(f"Processing queued file: {path}")
                # Re-enter as newly detected so stability timer runs
                self.on_file_detected(path)

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
        if self.observer and self._running and not self._paused:
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

        if self._running and not self._paused:
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
        self._paused = False
        self._pause_reason = None
        self._last_heartbeat = None

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
        self._paused = False
        self._pause_reason = None

        # Clear all state
        with self._pending_lock:
            self._pending.clear()
        with self._queue_lock:
            self._queued.clear()
        self._watched_paths.clear()
        self._handlers.clear()

        logger.info("File watcher stopped")

    def pause(self, reason: str = "manual"):
        """Pause the watcher (stops observing but keeps state)."""
        if not self._running or self._paused:
            return

        self._paused = True
        self._pause_reason = reason

        # Stop the observer but keep the maturity thread alive (it checks _paused)
        if self.observer:
            self.observer.stop()
            self.observer.join(timeout=5)
            self.observer = None

        logger.info(f"File watcher paused (reason: {reason})")

    def resume(self):
        """Resume the watcher after being paused.

        Performs a catch-up sweep of all download folders to detect any
        video files that arrived while the watcher was dormant.
        """
        if not self._running or not self._paused:
            return

        self._paused = False
        self._pause_reason = None

        # Restart observer
        self.observer = Observer()
        for path, handler in self._handlers.items():
            if path in self._watched_paths:
                self.observer.schedule(handler, path, recursive=self._monitor_subfolders)
        self.observer.start()

        logger.info("File watcher resumed")

        # Process any queued files
        self._process_queue()

        # Catch-up sweep: scan download folders for files that arrived while dormant
        self._catchup_sweep()

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
        """Check if the watcher is running (may be paused)."""
        return self._running

    @property
    def is_paused(self) -> bool:
        """Check if the watcher is paused."""
        return self._paused

    @property
    def pause_reason(self) -> Optional[str]:
        """Get the reason for the current pause."""
        return self._pause_reason

    @property
    def watched_paths(self) -> list[str]:
        """Get list of currently watched paths."""
        return list(self._watched_paths)

    @property
    def pending_count(self) -> int:
        """Number of files waiting for stability."""
        with self._pending_lock:
            return len(self._pending)

    @property
    def queued_count(self) -> int:
        """Number of files queued for processing."""
        with self._queue_lock:
            return len(self._queued)

    def get_status(self) -> dict:
        """Get full watcher status."""
        status = "stopped"
        if self._running:
            status = "paused" if self._paused else "running"

        return {
            "status": status,
            "pause_reason": self._pause_reason,
            "watched_paths": list(self._watched_paths),
            "pending_files": self.pending_count,
            "queued_files": self.queued_count,
            "last_heartbeat": (
                datetime.fromtimestamp(self._last_heartbeat).isoformat()
                if self._last_heartbeat
                else None
            ),
        }


# Global watcher instance
watcher_service = WatcherService()
