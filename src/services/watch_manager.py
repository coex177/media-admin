"""Per-tenant download watching, hosted-style. Replaces the in-process WatcherService.

Agent folders: the cloud sends `watch(paths)`; the agent's settle timer emits
`stable` events; the hub hands them here. Local folders (self-hosted): the
agent's own Watcher class runs in-process. Either way a stable file runs
WatcherPipeline.process_file in a worker thread, scoped to its tenant and
serialized with that tenant's scan lock (manual scans take the same lock).

ponytail: a file that lands while a scan holds the lock simply blocks its pool
thread until the scan finishes — that *is* the queue. Pool size caps how many
files can wait.
"""

import asyncio
import logging
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path, PurePath
from dataclasses import dataclass, field

from ..config import settings
from ..database import get_session_maker
from ..models import AppSettings, ScanFolder, current_tenant_id
from .agent_hub import AgentProxy, hub
from .storage import StorageError, storage_for_folder
from agent.watch import Watcher

logger = logging.getLogger(__name__)

SETTLE_SECONDS = 60
PURGE_INTERVAL = 3600


@dataclass
class TenantWatch:
    tenant_id: int
    lock: threading.Lock = field(default_factory=threading.Lock)
    enabled: bool = False
    folders: list[tuple[str, int | None]] = field(default_factory=list)   # (path, agent_id)
    local: Watcher | None = None
    min_bytes: int = 50 * 2**20
    purge_days: int = 0
    issues_folder: str = ""


def _setting(db, key, default=""):
    row = db.query(AppSettings).filter(AppSettings.key == key).first()
    return row.value if row else default


class WatchManager:
    def __init__(self):
        self._t: dict[int, TenantWatch] = {}
        self._pool = ThreadPoolExecutor(max_workers=4, thread_name_prefix="watch")
        self._purge_stop = threading.Event()

    def _get(self, tenant_id: int) -> TenantWatch:
        return self._t.setdefault(tenant_id, TenantWatch(tenant_id))

    def scan_lock(self, tenant_id: int) -> threading.Lock:
        """Manual scans hold this so they never interleave with file processing."""
        return self._get(tenant_id).lock

    # ── lifecycle (call from worker threads: def endpoints / to_thread) ─────

    def start(self, db, tenant_id: int):
        tw = self._get(tenant_id)
        if tw.enabled:
            return
        try:
            tw.min_bytes = max(0, int(_setting(db, "watcher_min_file_size_mb", "50"))) * 2**20
            tw.purge_days = max(0, int(_setting(db, "watcher_auto_purge_days", "0")))
        except ValueError:
            pass
        issues = db.query(ScanFolder).filter(ScanFolder.folder_type == "issues", ScanFolder.enabled == True).first()
        tw.issues_folder = issues.path if issues else ""
        folders = db.query(ScanFolder).filter(ScanFolder.folder_type == "tv", ScanFolder.enabled == True).all()
        tw.folders = [(f.path, f.agent_id) for f in folders]

        local = [f for f in folders if not f.agent_id]
        reachable = []
        for f in local:
            try:
                if storage_for_folder(db, f).is_dir(f.path):
                    reachable.append(f.path)
            except StorageError as e:
                logger.warning(f"watch: {e}")
        if local and not reachable:
            raise RuntimeError(f"No watchable folders: {', '.join(f.path for f in local)}")
        if reachable:
            tw.local = Watcher([Path(p) for p in reachable], set(settings.video_extensions), SETTLE_SECONDS,
                               tw.min_bytes, lambda path, size: self._on_stable(tenant_id, path, size))
            tw.local.start()
        tw.enabled = True

        for agent_id in {f.agent_id for f in folders if f.agent_id}:
            if hub.is_online(agent_id):
                self._send_watch(hub.get(agent_id), tw)
        self._catchup(db, tw)
        logger.info(f"watch: tenant {tenant_id} watching {[p for p, _ in tw.folders]}")

    def stop(self, tenant_id: int):
        tw = self._get(tenant_id)
        if tw.local:
            tw.local.stop()
            tw.local = None
        for agent_id in {a for _, a in tw.folders if a}:
            if hub.is_online(agent_id):
                proxy = hub.get(agent_id)
                asyncio.run_coroutine_threadsafe(proxy.call("unwatch"), proxy.loop)
        tw.enabled = False
        tw.folders = []
        logger.info(f"watch: tenant {tenant_id} stopped")

    def status(self, tenant_id: int) -> dict:
        tw = self._get(tenant_id)
        agents = {a for _, a in tw.folders if a}
        return {
            "status": "running" if tw.enabled else "stopped",
            "watched_paths": [p for p, _ in tw.folders],
            "pending_files": len(tw.local._pending) if tw.local else 0,
            "queued_files": 0,
            "agents_offline": sorted(a for a in agents if not hub.is_online(a)),
        }

    def is_running(self, tenant_id: int) -> bool:
        return self._get(tenant_id).enabled

    # ── agents ──────────────────────────────────────────────────────

    @staticmethod
    def _send_watch(proxy: AgentProxy, tw: TenantWatch):
        paths = [p for p, a in tw.folders if a == proxy.id]
        if paths:
            asyncio.run_coroutine_threadsafe(proxy.call("watch", paths=paths), proxy.loop)

    async def agent_connected(self, proxy: AgentProxy):
        """Hub hook: subscribe to the agent's events and (re)issue its watch list."""
        def on_event(ev):
            if ev.get("event") == "stable":
                self._on_stable(proxy.tenant_id, ev["path"], ev.get("size", 0))
        proxy.on_event.append(on_event)
        tw = self._t.get(proxy.tenant_id)
        if tw and tw.enabled:
            paths = [p for p, a in tw.folders if a == proxy.id]
            if paths:
                try:
                    await proxy.call("watch", paths=paths)
                except Exception as e:
                    logger.warning(f"watch: agent #{proxy.id} refused watch: {e}")

    # ── processing ──────────────────────────────────────────────────

    def _on_stable(self, tenant_id: int, path: str, size: int):
        tw = self._get(tenant_id)
        if not tw.enabled or size < tw.min_bytes:
            return
        self._pool.submit(self._process, tenant_id, path)

    def _process(self, tenant_id: int, path: str):
        from .watcher_pipeline import WatcherPipeline   # inline: pipeline imports storage/hub
        tw = self._get(tenant_id)
        token = current_tenant_id.set(tenant_id)
        try:
            with tw.lock:
                db = get_session_maker()()
                try:
                    logger.info(f"watch: processing {path}")
                    WatcherPipeline(db).process_file(path)
                except Exception as e:
                    logger.error(f"watch: pipeline failed for {path}: {e}", exc_info=True)
                    db.rollback()
                finally:
                    db.close()
        finally:
            current_tenant_id.reset(token)

    def _catchup(self, db, tw: TenantWatch):
        """Files that arrived while nobody was watching. Only files already older than the
        settle window — anything fresher will emit events on its own."""
        cutoff = time.time() - SETTLE_SECONDS
        found = 0
        for folder in db.query(ScanFolder).filter(ScanFolder.folder_type == "tv", ScanFolder.enabled == True).all():
            try:
                for e in storage_for_folder(db, folder).list(folder.path):
                    if e["size"] >= tw.min_bytes and e["mtime"] < cutoff:
                        self._pool.submit(self._process, tw.tenant_id, e["path"])
                        found += 1
            except StorageError as e:
                logger.warning(f"watch: catch-up skipped {folder.path}: {e}")
        if found:
            logger.info(f"watch: catch-up queued {found} file(s) for tenant {tw.tenant_id}")

    # ── auto-purge of the Issues folder ─────────────────────────────

    def purge_issues(self, db, tw: TenantWatch) -> int:
        if tw.purge_days <= 0 or not tw.issues_folder:
            return 0
        folder = db.query(ScanFolder).filter(ScanFolder.path == tw.issues_folder).first()
        if not folder:
            return 0
        storage = storage_for_folder(db, folder)
        cutoff = time.time() - tw.purge_days * 86400
        purged, dirs = 0, set()
        for e in storage.list(tw.issues_folder, videos_only=False):
            if e["mtime"] < cutoff:
                try:
                    storage.delete(e["path"])
                    purged += 1
                    dirs.add(str(PurePath(e["path"]).parent))
                except StorageError as err:
                    logger.warning(f"auto-purge: {err}")
        for d in sorted(dirs, key=len, reverse=True):
            if d != tw.issues_folder:
                try:
                    storage.rmdir(d)
                except StorageError:
                    pass
        if purged:
            logger.info(f"auto-purge: tenant {tw.tenant_id} deleted {purged} file(s) older than {tw.purge_days} days")
        return purged

    def _purge_loop(self):
        while not self._purge_stop.wait(PURGE_INTERVAL):
            for tw in list(self._t.values()):
                if tw.enabled and tw.purge_days > 0:
                    token = current_tenant_id.set(tw.tenant_id)
                    db = get_session_maker()()
                    try:
                        self.purge_issues(db, tw)
                    except Exception as e:
                        logger.error(f"auto-purge failed for tenant {tw.tenant_id}: {e}")
                    finally:
                        db.close()
                        current_tenant_id.reset(token)

    # ── app lifecycle ───────────────────────────────────────────────

    def auto_start_all(self):
        """Startup: resume every tenant whose watcher was enabled. Runs unscoped, then scopes per tenant."""
        db = get_session_maker()()
        try:
            rows = db.query(AppSettings).filter(AppSettings.key == "watcher_enabled", AppSettings.value == "true").all()
            tenant_ids = sorted({r.tenant_id for r in rows})
        finally:
            db.close()
        for tid in tenant_ids:
            token = current_tenant_id.set(tid)
            db = get_session_maker()()
            try:
                self.start(db, tid)
            except Exception as e:
                logger.error(f"watch: auto-start failed for tenant {tid}: {e}")
            finally:
                db.close()
                current_tenant_id.reset(token)
        threading.Thread(target=self._purge_loop, daemon=True, name="issues-purge").start()

    def shutdown(self):
        self._purge_stop.set()
        for tid in list(self._t):
            if self._t[tid].enabled:
                self.stop(tid)


watch_manager = WatchManager()
hub.on_connect.append(watch_manager.agent_connected)
