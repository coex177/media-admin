"""WatchManager local mode: catch-up sweep, live settle events, scan-lock serialization, tenant scope."""

import os
import time

from agent import watch
from src.models import AppSettings, ScanFolder, Tenant, current_tenant_id
from src.services import watch_manager as wm
from src.services.watcher_pipeline import WatcherPipeline


def _wait(pred, timeout=10):
    end = time.time() + timeout
    while time.time() < end:
        if pred():
            return True
        time.sleep(0.1)
    return False


def test_local_watch(db, tmp_path, monkeypatch):
    monkeypatch.setattr(watch, "CHECK_INTERVAL", 1)
    monkeypatch.setattr(wm, "SETTLE_SECONDS", 1)
    seen = []
    monkeypatch.setattr(WatcherPipeline, "process_file", lambda self, p: seen.append((p, current_tenant_id.get())))

    dl = tmp_path / "dl"
    dl.mkdir()
    db.add(Tenant(id=1, name="t"))
    db.commit()
    current_tenant_id.set(1)
    db.add_all([ScanFolder(path=str(dl), folder_type="tv"),
                AppSettings(key="watcher_min_file_size_mb", value="0")])
    db.commit()

    old = dl / "old.mkv"
    old.write_bytes(b"x")
    os.utime(old, (time.time() - 100, time.time() - 100))     # older than the settle window → catch-up

    m = wm.WatchManager()
    m.start(db, 1)
    assert m.status(1)["status"] == "running" and m.status(1)["watched_paths"] == [str(dl)]
    assert _wait(lambda: (str(old), 1) in seen)

    # a scan holds the lock → the file waits; release → processed
    with m.scan_lock(1):
        (dl / "new.mkv").write_bytes(b"y")
        assert not _wait(lambda: any(p.endswith("new.mkv") for p, _ in seen), timeout=3)
    assert _wait(lambda: (str(dl / "new.mkv"), 1) in seen)

    m.stop(1)
    assert m.status(1)["status"] == "stopped"
    current_tenant_id.set(None)
