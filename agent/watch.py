"""inotify watcher with a settle timer: emit a path only once its size has stopped changing."""

import logging
import os
import threading
import time
from pathlib import Path
from typing import Callable

from watchdog.events import FileSystemEventHandler
from watchdog.observers import Observer

logger = logging.getLogger(__name__)

CHECK_INTERVAL = 10


class Watcher:
    def __init__(self, paths: list[Path], video_extensions: set[str], settle_seconds: int,
                 min_bytes: int, on_stable: Callable[[str, int], None]):
        self.paths = paths
        self.exts = video_extensions
        self.settle = settle_seconds
        self.min_bytes = min_bytes
        self.on_stable = on_stable
        self._pending: dict[str, tuple[float, int]] = {}   # path → (last_change, size)
        self._lock = threading.Lock()
        self._stop = threading.Event()
        self._observer = Observer()
        self._thread = threading.Thread(target=self._loop, daemon=True, name="agent-settle")

    def start(self):
        handler = _Handler(self)
        for p in self.paths:
            self._observer.schedule(handler, str(p), recursive=True)
        self._observer.start()
        self._thread.start()
        logger.info(f"watching {[str(p) for p in self.paths]}")

    def stop(self):
        self._stop.set()
        self._observer.stop()
        self._observer.join(5)

    def touch(self, path: str):
        if Path(path).suffix.lower() not in self.exts:
            return
        try:
            size = os.path.getsize(path)
        except OSError:
            return
        with self._lock:
            self._pending[path] = (time.time(), size)

    def _loop(self):
        while not self._stop.is_set():
            for path, size in self._settled():
                try:
                    self.on_stable(path, size)
                except Exception as e:  # never let a callback kill the loop
                    logger.error(f"on_stable failed for {path}: {e}")
            self._stop.wait(CHECK_INTERVAL)

    def _settled(self) -> list[tuple[str, int]]:
        now, done = time.time(), []
        with self._lock:
            for path, (since, size) in list(self._pending.items()):
                try:
                    cur = os.path.getsize(path)
                except OSError:
                    del self._pending[path]
                    continue
                if cur != size:
                    self._pending[path] = (now, cur)
                elif now - since >= self.settle:
                    del self._pending[path]
                    if cur >= self.min_bytes:
                        done.append((path, cur))
        return done


class _Handler(FileSystemEventHandler):
    def __init__(self, w: Watcher):
        self.w = w

    def on_created(self, e):
        if not e.is_directory:
            self.w.touch(e.src_path)

    def on_modified(self, e):
        if not e.is_directory:
            self.w.touch(e.src_path)

    def on_moved(self, e):
        if not e.is_directory:
            self.w.touch(e.dest_path)
