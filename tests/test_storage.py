"""storage_for_path picks the backend by longest configured folder; both backends confine paths."""

import asyncio
import threading

import pytest

from agent.fs import FS, Jail
from src.models import Agent, ScanFolder, Tenant, current_tenant_id
from src.services import storage as st
from src.services.agent_hub import hub


@pytest.fixture
def folders(db, tmp_path):
    tv, dl, other = tmp_path / "tv", tmp_path / "downloads", tmp_path / "other"
    for d in (tv, dl, other):
        d.mkdir()
    db.add(Tenant(id=1, name="t"))
    db.commit()
    db.add(Agent(id=1, tenant_id=1, name="nas", token_hash="x"))
    db.commit()
    current_tenant_id.set(1)
    db.add_all([ScanFolder(path=str(tv), folder_type="library"),
                ScanFolder(path=str(dl), folder_type="tv"),
                ScanFolder(path=str(tmp_path / "remote"), folder_type="library", agent_id=1)])
    db.commit()
    yield tv, dl, other
    current_tenant_id.set(None)


def test_local_backend_resolves_and_confines(db, folders, tmp_path):
    tv, dl, other = folders
    (dl / "ep.mkv").write_bytes(b"x")
    s = st.storage_for_path(db, str(dl / "ep.mkv"))
    assert isinstance(s, st.LocalStorage)
    assert [e["path"] for e in s.list(str(dl))] == [str(dl / "ep.mkv")]
    s.move(str(dl / "ep.mkv"), str(tv / "Show" / "ep.mkv"))      # local → local, both configured
    assert (tv / "Show" / "ep.mkv").exists()
    with pytest.raises(st.StorageError, match="outside"):
        s.move(str(tv / "Show" / "ep.mkv"), str(other / "ep.mkv"))   # 'other' is not configured
    with pytest.raises(st.StorageError, match="not under any configured folder"):
        st.storage_for_path(db, str(other / "x.mkv"))
    with pytest.raises(st.StorageError, match="not under any configured folder"):
        st.storage_for_path(db, str(tmp_path / "tv-evil" / "x.mkv"))   # prefix trick


def test_agent_backend(db, folders, tmp_path, monkeypatch):
    remote = tmp_path / "remote"
    remote.mkdir()
    (remote / "m.mkv").write_bytes(b"x")
    s = st.storage_for_path(db, str(remote / "m.mkv"))
    assert isinstance(s, st.AgentStorage) and s.agent_id == 1

    with pytest.raises(st.StorageError, match="offline"):
        s.exists(str(remote / "m.mkv"))

    # a fake connected agent: a real FS behind an event loop on another thread, like the hub's
    loop = asyncio.new_event_loop()
    threading.Thread(target=loop.run_forever, daemon=True).start()
    fs = FS(Jail([remote]), {".mkv"})

    class FakeProxy:
        async def call(self, op, **args):
            return getattr(fs, op)(**args)
    FakeProxy.loop = loop
    monkeypatch.setitem(hub.agents, 1, FakeProxy())

    assert s.exists(str(remote / "m.mkv")) and s.is_file(str(remote / "m.mkv"))
    assert s.listdir(str(remote))[0]["name"] == "m.mkv"          # positional args work
    assert s.list(root=str(remote), videos_only=True)[0]["size"] == 1
    s.move(str(remote / "m.mkv"), str(remote / "Films" / "m.mkv"))
    assert (remote / "Films" / "m.mkv").exists()

    async def from_loop():
        return s.exists(str(remote))
    with pytest.raises(st.StorageError, match="sync"):
        asyncio.run(from_loop())
    loop.call_soon_threadsafe(loop.stop)
