"""WebSocket session: connect out, answer calls, push events, reconnect forever.

Wire format (JSON text frames):
  agent → cloud   {"type":"hello","name":..,"version":..,"roots":[..],"ffprobe":bool}
  cloud → agent   {"type":"call","id":N,"op":"move","args":{"src":..,"dst":..}}
  agent → cloud   {"type":"result","id":N,"result":..} | {"type":"error","id":N,"error":".."}
  agent → cloud   {"type":"event","event":"stable","path":..,"size":..}
"""

import asyncio
import json
import logging
import shutil
from pathlib import Path

import websockets

from . import VERSION
from .config import Config
from .fs import FS, Jail
from .watch import Watcher

logger = logging.getLogger(__name__)

# The complete vocabulary a cloud can speak to this agent. Nothing else is reachable.
FS_OPS = frozenset({"list", "stat", "probe", "move", "delete", "mkdir", "rmdir", "chmod_readable"})


class Agent:
    def __init__(self, cfg: Config):
        self.cfg = cfg
        self.fs = FS(Jail(cfg.roots), cfg.video_extensions)
        self.outbox: asyncio.Queue = asyncio.Queue()   # survives reconnects → events are not lost
        self.watcher: Watcher | None = None
        self._loop: asyncio.AbstractEventLoop | None = None

    # ── lifecycle ───────────────────────────────────────────────────

    async def run_forever(self):
        backoff = 1
        while True:
            try:
                await self.session()
                backoff = 1
            except (OSError, websockets.exceptions.WebSocketException) as e:
                logger.warning(f"disconnected ({e}); retry in {backoff}s")
            await asyncio.sleep(backoff)
            backoff = min(backoff * 2, 60)

    async def session(self):
        """One connection: hello, then serve until the socket closes."""
        self._loop = asyncio.get_running_loop()
        headers = {"Authorization": f"Bearer {self.cfg.token}"}
        async with websockets.connect(self.cfg.server, additional_headers=headers, max_size=64 * 2**20) as ws:
            await ws.send(json.dumps({
                "type": "hello", "name": self.cfg.name, "version": VERSION,
                "roots": [str(r) for r in self.cfg.roots], "ffprobe": shutil.which("ffprobe") is not None,
            }))
            logger.info(f"connected to {self.cfg.server}")
            sender = asyncio.create_task(self._drain(ws))
            try:
                async for raw in ws:
                    asyncio.create_task(self._handle(json.loads(raw)))
            finally:
                sender.cancel()

    async def _drain(self, ws):
        while True:
            msg = await self.outbox.get()
            try:
                await ws.send(json.dumps(msg))
            except Exception:
                self.outbox.put_nowait(msg)   # re-queue; reconnect will deliver it
                raise

    # ── calls ───────────────────────────────────────────────────────

    async def _handle(self, msg: dict):
        if msg.get("type") != "call":
            return
        cid, op, args = msg["id"], msg["op"], msg.get("args", {})
        try:
            if op == "watch":
                result = self._watch([Path(p) for p in args["paths"]])
            elif op == "unwatch":
                result = self._unwatch()
            elif op == "ping":
                result = "pong"
            else:
                if op not in FS_OPS:
                    raise ValueError(f"unknown op: {op}")
                result = await asyncio.to_thread(getattr(self.fs, op), **args)   # a 40 GB move must not block a stat
            self.outbox.put_nowait({"type": "result", "id": cid, "result": result})
        except Exception as e:
            logger.warning(f"{op} {args} failed: {e}")
            self.outbox.put_nowait({"type": "error", "id": cid, "error": f"{type(e).__name__}: {e}"})

    # ── watch ───────────────────────────────────────────────────────

    def _watch(self, paths: list[Path]) -> dict:
        paths = [self.fs.jail.check(p) for p in paths]
        self._unwatch()
        self.watcher = Watcher(
            paths, self.cfg.video_extensions, self.cfg.settle_seconds,
            self.cfg.min_file_mb * 2**20, self._on_stable,
        )
        self.watcher.start()
        return {"watching": [str(p) for p in paths]}

    def _unwatch(self) -> dict:
        if self.watcher:
            self.watcher.stop()
            self.watcher = None
        return {"watching": []}

    def _on_stable(self, path: str, size: int):
        # called from the settle thread → hop onto the event loop
        self._loop.call_soon_threadsafe(
            self.outbox.put_nowait, {"type": "event", "event": "stable", "path": path, "size": size}
        )
