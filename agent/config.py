"""Agent config: one TOML file, no defaults hidden in code paths."""

import socket
import tomllib
from dataclasses import dataclass, field
from pathlib import Path

VIDEO_EXTENSIONS = {
    ".mkv", ".mp4", ".avi", ".m4v", ".wmv", ".flv", ".webm",
    ".mpg", ".mpeg", ".m2ts", ".mts", ".ts", ".vob", ".ogv",
    ".mov", ".divx", ".3gp", ".3g2", ".asf", ".f4v", ".rmvb",
    ".rm", ".ogm", ".iso",
}


@dataclass
class Config:
    server: str                      # wss://host/api/agent/ws
    token: str
    roots: list[Path]                # the ONLY paths this agent will ever touch
    name: str = field(default_factory=socket.gethostname)
    settle_seconds: int = 60         # file size unchanged for this long → "stable"
    min_file_mb: int = 50            # smaller video files are ignored by the watcher
    video_extensions: set[str] = field(default_factory=lambda: set(VIDEO_EXTENSIONS))


def load(path: str | Path) -> Config:
    with open(path, "rb") as f:
        raw = tomllib.load(f)
    roots = [Path(r).expanduser().resolve() for r in raw["roots"]]
    if not roots:
        raise ValueError("config: 'roots' must list at least one directory")
    for r in roots:
        if not r.is_dir():
            raise ValueError(f"config: root is not a directory: {r}")
    return Config(
        server=raw["server"],
        token=raw["token"],
        roots=roots,
        name=raw.get("name", socket.gethostname()),
        settle_seconds=int(raw.get("settle_seconds", 60)),
        min_file_mb=int(raw.get("min_file_mb", 50)),
        video_extensions={e.lower() for e in raw.get("video_extensions", VIDEO_EXTENSIONS)},
    )
