"""Cloud side of the agent protocol: accept agent WebSockets, expose them as awaitable proxies.

    from .services.agent_hub import hub
    agent = hub.get("nas")
    files = await agent.call("list", root="/mnt/tv")
    await agent.call("move", src=..., dst=...)
    async for ev in agent.events(): ...

ponytail: one shared AGENT_TOKEN env var and agents keyed by hello.name — step 2 of
phase 0 replaces this with a per-tenant agents table and per-agent tokens.
"""

import asyncio
import itertools
import logging
import os

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

logger = logging.getLogger(__name__)


class AgentError(Exception):
    pass


class AgentProxy:
    def __init__(self, ws: WebSocket, hello: dict):
        self.ws = ws
        self.name: str = hello["name"]
        self.roots: list[str] = hello.get("roots", [])
        self.version: str = hello.get("version", "?")
        self.ffprobe: bool = hello.get("ffprobe", False)
        self._ids = itertools.count(1)
        self._pending: dict[int, asyncio.Future] = {}
        self._events: asyncio.Queue = asyncio.Queue()

    async def call(self, op: str, timeout: float = 600, **args):
        cid = next(self._ids)
        fut = asyncio.get_running_loop().create_future()
        self._pending[cid] = fut
        try:
            await self.ws.send_json({"type": "call", "id": cid, "op": op, "args": args})
            return await asyncio.wait_for(fut, timeout)
        finally:
            self._pending.pop(cid, None)

    def events(self) -> asyncio.Queue:
        return self._events

    def _dispatch(self, msg: dict):
        t = msg.get("type")
        if t in ("result", "error"):
            fut = self._pending.get(msg["id"])
            if fut and not fut.done():
                if t == "result":
                    fut.set_result(msg.get("result"))
                else:
                    fut.set_exception(AgentError(msg.get("error", "agent error")))
        elif t == "event":
            self._events.put_nowait(msg)

    def _fail_all(self, reason: str):
        for fut in self._pending.values():
            if not fut.done():
                fut.set_exception(AgentError(reason))


class AgentHub:
    def __init__(self):
        self.agents: dict[str, AgentProxy] = {}

    def get(self, name: str) -> AgentProxy:
        try:
            return self.agents[name]
        except KeyError:
            raise AgentError(f"agent '{name}' is offline")

    async def serve(self, ws: WebSocket):
        """Run one agent connection to completion."""
        hello = await ws.receive_json()
        if hello.get("type") != "hello" or "name" not in hello:
            await ws.close(code=1002)
            return
        proxy = AgentProxy(ws, hello)
        self.agents[proxy.name] = proxy
        logger.info(f"agent connected: {proxy.name} v{proxy.version} roots={proxy.roots}")
        try:
            while True:
                proxy._dispatch(await ws.receive_json())
        except WebSocketDisconnect:
            pass
        finally:
            if self.agents.get(proxy.name) is proxy:
                del self.agents[proxy.name]
            proxy._fail_all("agent disconnected")
            logger.info(f"agent disconnected: {proxy.name}")


hub = AgentHub()
router = APIRouter()


@router.websocket("/api/agent/ws")
async def agent_ws(ws: WebSocket):
    expected = os.environ.get("AGENT_TOKEN")
    if not expected or ws.headers.get("authorization") != f"Bearer {expected}":
        await ws.close(code=1008)
        return
    await ws.accept()
    await hub.serve(ws)


@router.get("/api/agent/status")
async def agent_status():
    return [
        {"name": a.name, "version": a.version, "roots": a.roots, "ffprobe": a.ffprobe}
        for a in hub.agents.values()
    ]
