"""Configuration management for media-admin."""

import os
from pathlib import Path
from typing import Optional

from pydantic import BaseModel
from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    """Application settings loaded from environment or config file."""

    # Database
    database_url: str = "sqlite:///./data/media-admin.db"

    # TMDB API
    tmdb_api_key: str = ""
    tmdb_base_url: str = "https://api.themoviedb.org/3"

    # Server
    host: str = "0.0.0.0"
    port: int = 8095
    debug: bool = False

    # File handling
    video_extensions: list[str] = [".mkv", ".mp4", ".avi", ".m4v", ".wmv", ".flv", ".webm"]
    subtitle_extensions: list[str] = [".srt", ".sub", ".ass", ".ssa", ".vtt"]

    # Default naming formats
    default_season_format: str = "Season {season}"
    default_episode_format: str = "{season}x{episode:02d} - {title}"

    class Config:
        env_prefix = "MEDIA_ADMIN_"
        env_file = ".env"


class AppConfig(BaseModel):
    """Runtime application configuration stored in database."""

    tmdb_api_key: str = ""
    library_folders: list[str] = []
    download_folders: list[str] = []
    episode_format: str = "{season}x{episode:02d} - {title}"
    season_format: str = "Season {season}"
    auto_scan_enabled: bool = False
    auto_scan_interval_minutes: int = 60
    setup_completed: bool = False


# Global settings instance
settings = Settings()


def get_project_root() -> Path:
    """Get the project root directory."""
    return Path(__file__).parent.parent


def get_data_dir() -> Path:
    """Get the data directory path."""
    data_dir = get_project_root() / "data"
    data_dir.mkdir(exist_ok=True)
    return data_dir


def get_database_path() -> Path:
    """Get the SQLite database path."""
    return get_data_dir() / "media-admin.db"
