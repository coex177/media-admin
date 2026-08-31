"""The filesystem verbs. Every path goes through Jail.check() first — no exceptions.

This is the whole trust boundary of the product: a compromised cloud can only
ever ask for operations inside the roots the customer wrote in their own config.
"""

from __future__ import annotations

import json
import logging
import os
import shutil
import subprocess
from pathlib import Path

logger = logging.getLogger(__name__)


class Jail:
    def __init__(self, roots: list[Path]):
        self.roots = [Path(r).resolve() for r in roots]

    def check(self, path: str | Path) -> Path:
        """Resolve `path` and refuse it unless it lives under a declared root.

        resolve() follows symlinks, so a link inside a root that points outside
        is rejected too. is_relative_to() is a real path comparison, not a
        string-prefix check, so `/media/tv-evil` never matches root `/media/tv`.
        """
        p = Path(path).expanduser().resolve()
        if not any(p == r or p.is_relative_to(r) for r in self.roots):
            raise PermissionError(f"outside agent roots: {path}")
        return p


class FS:
    def __init__(self, jail: Jail, video_extensions: set[str]):
        self.jail = jail
        self.video_extensions = video_extensions

    # ── read ────────────────────────────────────────────────────────

    def list(self, root: str, videos_only: bool = True) -> list[dict]:
        top = self.jail.check(root)
        out = []
        for dirpath, _dirs, files in os.walk(top):
            for name in files:
                p = Path(dirpath) / name
                if videos_only and p.suffix.lower() not in self.video_extensions:
                    continue
                try:
                    st = p.stat()
                except OSError:
                    continue
                out.append({"path": str(p), "size": st.st_size, "mtime": st.st_mtime})
        return out

    def listdir(self, path: str) -> list[dict]:
        """Immediate children with is_dir — for folder discovery, not media listing."""
        p = self.jail.check(path)
        out = []
        for child in p.iterdir():
            try:
                st = child.stat()
            except OSError:
                continue
            out.append({"path": str(child), "name": child.name, "is_dir": child.is_dir(),
                        "size": st.st_size, "mtime": st.st_mtime})
        return out

    def stat(self, path: str) -> dict:
        p = self.jail.check(path)
        try:
            st = p.stat()
        except FileNotFoundError:
            return {"path": str(p), "exists": False}
        return {"path": str(p), "exists": True, "is_dir": p.is_dir(), "size": st.st_size, "mtime": st.st_mtime}

    def probe(self, path: str) -> dict | None:
        """ffprobe JSON, or None if ffprobe is missing/fails. The cloud does the comparing."""
        p = self.jail.check(path)
        if not shutil.which("ffprobe"):
            return None
        try:
            r = subprocess.run(
                ["ffprobe", "-v", "quiet", "-print_format", "json", "-show_format", "-show_streams", "--", str(p)],
                capture_output=True, text=True, timeout=30,
            )
            return json.loads(r.stdout) if r.returncode == 0 else None
        except (subprocess.TimeoutExpired, json.JSONDecodeError, OSError) as e:
            logger.warning(f"ffprobe failed for {p}: {e}")
            return None

    # ── write ───────────────────────────────────────────────────────

    def move(self, src: str, dst: str) -> dict:
        s, d = self.jail.check(src), self.jail.check(dst)
        if d.exists():
            raise FileExistsError(f"destination exists: {d}")
        d.parent.mkdir(parents=True, exist_ok=True)
        shutil.move(str(s), str(d))
        self._readable(d)
        return {"path": str(d)}

    def copy(self, src: str, dst: str) -> dict:
        s, d = self.jail.check(src), self.jail.check(dst)
        if d.exists():
            raise FileExistsError(f"destination exists: {d}")
        d.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(str(s), str(d))
        self._readable(d)
        return {"path": str(d)}

    def delete(self, path: str) -> dict:
        p = self.jail.check(path)
        p.unlink()
        return {"path": str(p)}

    def mkdir(self, path: str) -> dict:
        p = self.jail.check(path)
        p.mkdir(parents=True, exist_ok=True)
        return {"path": str(p)}

    def rmdir(self, path: str) -> dict:
        """Remove a directory only if empty; never recursive."""
        p = self.jail.check(path)
        p.rmdir()
        return {"path": str(p)}

    def chmod_readable(self, path: str) -> dict:
        p = self.jail.check(path)
        self._readable(p)
        return {"path": str(p)}

    @staticmethod
    def _readable(p: Path):
        # OR the bits in, never assign — Plex runs as another user and skips 0600 files silently.
        try:
            p.chmod(p.stat().st_mode | 0o064)
        except OSError as e:
            logger.warning(f"chmod failed for {p}: {e}")
