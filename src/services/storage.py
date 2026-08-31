"""Where the cloud's filesystem verbs go: to a paired agent, or (self-hosted) to local disk.

    storage = storage_for_path(db, "/mnt/tv/Show/S01E01.mkv")
    storage.move(src, dst)

Resolution: the tenant's ScanFolder whose path is the longest prefix of the
target picks the backend — its agent, or local disk if agent_id is NULL. A
path under no configured folder is refused, which is also the path-confinement
fix for every client-supplied path in the API.

Both backends speak the same 10 verbs. LocalStorage *is* the agent's FS class
(same jail, same semantics), so self-hosted and hosted behave identically.

Sync on purpose: scanner/renamer/pipeline are sync code running in worker
threads. AgentStorage submits to the hub's event loop and blocks the worker;
calling it from the event-loop thread would deadlock, so it refuses to.
"""

import asyncio
import inspect
from pathlib import Path, PurePath
from typing import Optional

from sqlalchemy.orm import Session

from agent.fs import FS, Jail
from ..config import settings
from ..models import ScanFolder
from .agent_hub import AgentError, hub


class StorageError(Exception):
    pass


class _Common:
    def exists(self, path: str) -> bool:
        return self.stat(path)["exists"]

    def is_dir(self, path: str) -> bool:
        st = self.stat(path)
        return st["exists"] and st["is_dir"]

    def is_file(self, path: str) -> bool:
        st = self.stat(path)
        return st["exists"] and not st["is_dir"]


class LocalStorage(_Common):
    def __init__(self, roots: list[str]):
        self._fs = FS(Jail([Path(r) for r in roots]), set(settings.video_extensions))

    def __getattr__(self, op):
        fn = getattr(self._fs, op)
        def call(*a, **kw):
            try:
                return fn(*a, **kw)
            except PermissionError as e:
                raise StorageError(str(e)) from e
        return call


class AgentStorage(_Common):
    def __init__(self, agent_id: int):
        self.agent_id = agent_id

    def __getattr__(self, op):
        sig = inspect.signature(getattr(FS, op))   # AttributeError for unknown verbs, like LocalStorage

        def call(*a, **kw):
            args = dict(sig.bind(None, *a, **kw).arguments)   # positional or keyword, same as local
            args.pop("self")
            try:
                asyncio.get_running_loop()
            except RuntimeError:
                pass
            else:
                raise StorageError("storage is sync: call it from a worker thread (def endpoint / background task)")
            try:
                proxy = hub.get(self.agent_id)
                return asyncio.run_coroutine_threadsafe(proxy.call(op, **args), proxy.loop).result()
            except AgentError as e:
                raise StorageError(str(e)) from e
        return call


def _under(path: str, folder: str) -> bool:
    p, f = PurePath(path), PurePath(folder)
    return p == f or f in p.parents


def storage_for_folder(db: Session, folder: ScanFolder):
    if folder.agent_id:
        return AgentStorage(folder.agent_id)
    local_roots = [f.path for f in db.query(ScanFolder).filter(ScanFolder.agent_id.is_(None)).all()]
    return LocalStorage(local_roots)


def storage_for_path(db: Session, path: str):
    """Backend for `path`, chosen by the longest configured folder that contains it."""
    folders = [f for f in db.query(ScanFolder).all() if _under(path, f.path)]
    if not folders:
        raise StorageError(f"path is not under any configured folder: {path}")
    return storage_for_folder(db, max(folders, key=lambda f: len(f.path)))


def storage_for_agent(agent_id: Optional[int], path: str):
    """For validating a folder before it exists in the DB."""
    return AgentStorage(agent_id) if agent_id else LocalStorage([path])
