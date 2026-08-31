"""Agent ↔ hub end-to-end: real uvicorn, real websocket, real files, jail enforced."""

import asyncio
from pathlib import Path

import pytest
import uvicorn
import websockets
from fastapi import FastAPI

from agent import watch
from agent.client import Agent
from agent.config import Config
from agent.fs import Jail
from src.models import Agent as AgentRow, Tenant
from src.routers.auth import token_hash
from src.services.agent_hub import AgentError, hub, router


def test_jail_rejects_escapes(tmp_path):
    root = tmp_path / "tv"
    (tmp_path / "tv-evil").mkdir()
    root.mkdir()
    jail = Jail([root])
    assert jail.check(root / "Show" / "x.mkv") == root / "Show" / "x.mkv"
    for bad in [root / ".." / "secret", tmp_path / "tv-evil" / "x", "/etc/passwd"]:
        with pytest.raises(PermissionError):
            jail.check(bad)
    link = root / "link"
    link.symlink_to(tmp_path / "tv-evil")
    with pytest.raises(PermissionError):
        jail.check(link / "x")


def test_roundtrip(tmp_path, monkeypatch, db):
    db.add(Tenant(id=1, name="t"))
    db.commit()
    db.add(AgentRow(id=1, tenant_id=1, name="paired", token_hash=token_hash("t")))
    db.commit()
    monkeypatch.setattr(watch, "CHECK_INTERVAL", 1)
    app = FastAPI()
    app.include_router(router)

    async def main():
        server = uvicorn.Server(uvicorn.Config(app, host="127.0.0.1", port=0, log_level="warning"))
        serve = asyncio.create_task(server.serve())
        while not server.started:
            await asyncio.sleep(0.05)
        port = server.servers[0].sockets[0].getsockname()[1]
        url = f"ws://127.0.0.1:{port}/api/agent/ws"

        # wrong token → handshake refused
        with pytest.raises(websockets.exceptions.InvalidStatus):
            async with websockets.connect(url, additional_headers={"Authorization": "Bearer nope"}):
                pass

        cfg = Config(server=url, token="t", roots=[tmp_path], name="test", settle_seconds=1, min_file_mb=0)
        agent = Agent(cfg)
        session = asyncio.create_task(agent.session())
        while not hub.is_online(1):
            await asyncio.sleep(0.05)
        proxy = hub.get(1)
        assert proxy.roots == [str(tmp_path)] and proxy.name == "test" and proxy.tenant_id == 1

        (tmp_path / "a.mkv").write_bytes(b"x" * 10)
        (tmp_path / "a.txt").write_bytes(b"x")
        assert [f["path"] for f in await proxy.call("list", root=str(tmp_path))] == [str(tmp_path / "a.mkv")]

        dst = tmp_path / "Show" / "Season 1" / "a.mkv"
        await proxy.call("move", src=str(tmp_path / "a.mkv"), dst=str(dst))
        assert dst.exists() and dst.stat().st_mode & 0o044 == 0o044

        with pytest.raises(AgentError, match="outside agent roots"):
            await proxy.call("delete", path="/etc/passwd")
        with pytest.raises(AgentError, match="unknown op"):
            await proxy.call("jail")

        await proxy.call("watch", paths=[str(tmp_path)])
        (tmp_path / "new.mkv").write_bytes(b"y" * 10)
        ev = await asyncio.wait_for(proxy.events().get(), 15)
        assert ev == {"type": "event", "event": "stable", "path": str(tmp_path / "new.mkv"), "size": 10}

        session.cancel()
        server.should_exit = True
        await serve
        assert not hub.is_online(1)

    asyncio.run(main())
