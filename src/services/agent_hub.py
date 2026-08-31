"""Cloud side of the agent protocol: accept agent WebSockets, expose them as awaitable proxies.

    from .services.agent_hub import hub
    agent = hub.get(agent_id)
    files = await agent.call("list", root="/mnt/tv")
    await agent.call("move", src=..., dst=...)
    async for ev in agent.events(): ...

Agents authenticate with a per-agent bearer token (sha256 stored on the agents
row); the connection is keyed by agent id and scoped to the agent's tenant.
"""

import asyncio
import hashlib
import itertools
import logging
from datetime import datetime

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from ..database import get_session_maker
from ..models import Agent, current_tenant_id

logger = logging.getLogger(__name__)


class AgentError(Exception):
    pass


class AgentProxy:
    def __init__(self, ws: WebSocket, agent_id: int, tenant_id: int, hello: dict):
        self.ws = ws
        self.id = agent_id
        self.tenant_id = tenant_id
        self.name: str = hello.get("name", "?")
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
        self.agents: dict[int, AgentProxy] = {}

    def get(self, agent_id: int) -> AgentProxy:
        try:
            return self.agents[agent_id]
        except KeyError:
            raise AgentError(f"agent {agent_id} is offline")

    def is_online(self, agent_id: int) -> bool:
        return agent_id in self.agents

    def roots(self, agent_id: int) -> list[str]:
        return self.agents[agent_id].roots if agent_id in self.agents else []

    async def disconnect(self, agent_id: int):
        proxy = self.agents.get(agent_id)
        if proxy:
            await proxy.ws.close(code=1008)

    @staticmethod
    def _lookup(token: str) -> tuple[int, int] | None:
        """token → (agent_id, tenant_id), or None. Runs unscoped: no tenant is known yet."""
        db = get_session_maker()()
        try:
            row = db.query(Agent).filter(Agent.token_hash == hashlib.sha256(token.encode()).hexdigest()).first()
            if not row:
                return None
            row.last_seen = datetime.utcnow()
            db.commit()
            return row.id, row.tenant_id
        finally:
            db.close()

    async def serve(self, ws: WebSocket, agent_id: int, tenant_id: int):
        """Run one authenticated agent connection to completion."""
        hello = await ws.receive_json()
        if hello.get("type") != "hello":
            await ws.close(code=1002)
            return
        current_tenant_id.set(tenant_id)
        proxy = AgentProxy(ws, agent_id, tenant_id, hello)
        old = self.agents.get(agent_id)
        self.agents[agent_id] = proxy
        if old:
            old._fail_all("replaced by a new connection")
            await old.ws.close(code=1000)
        logger.info(f"agent connected: #{agent_id} {proxy.name} v{proxy.version} roots={proxy.roots}")
        try:
            while True:
                proxy._dispatch(await ws.receive_json())
        except WebSocketDisconnect:
            pass
        finally:
            if self.agents.get(agent_id) is proxy:
                del self.agents[agent_id]
            proxy._fail_all("agent disconnected")
            logger.info(f"agent disconnected: #{agent_id} {proxy.name}")


hub = AgentHub()
router = APIRouter()


@router.websocket("/api/agent/ws")
async def agent_ws(ws: WebSocket):
    auth = ws.headers.get("authorization", "")
    found = await asyncio.to_thread(hub._lookup, auth[7:]) if auth.startswith("Bearer ") else None
    if not found:
        await ws.close(code=1008)
        return
    await ws.accept()
    await hub.serve(ws, *found)
