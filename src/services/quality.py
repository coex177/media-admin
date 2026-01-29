"""Quality analysis service using ffprobe."""

import logging
import shutil
import subprocess
import json
from dataclasses import dataclass, field
from pathlib import Path
from typing import Optional

logger = logging.getLogger(__name__)

# Codec quality tiers (higher index = better)
VIDEO_CODEC_RANK = {
    "mpeg2video": 0, "mpeg4": 1, "msmpeg4v3": 1, "wmv3": 1,
    "vc1": 2, "h264": 3, "hevc": 4, "h265": 4, "av1": 5,
}

AUDIO_CODEC_RANK = {
    "mp2": 0, "mp3": 1, "wma": 1, "wmav2": 1,
    "aac": 2, "ac3": 3, "eac3": 4, "dts": 5,
    "dts-hd ma": 6, "dts_hd_ma": 6, "truehd": 7, "pcm_s16le": 7, "pcm_s24le": 8, "flac": 8,
}


@dataclass
class MediaQuality:
    """Quality profile extracted from a video file via ffprobe."""

    file_path: str = ""

    # Resolution
    width: int = 0
    height: int = 0

    # Bitrate (overall, bits/sec)
    bitrate: int = 0

    # Video codec (lowercase canonical name)
    video_codec: str = ""

    # Audio codec (lowercase canonical name)
    audio_codec: str = ""

    # Audio channels (e.g. 2 = stereo, 6 = 5.1, 8 = 7.1)
    audio_channels: int = 0

    # Subtitle track count
    subtitle_count: int = 0

    def resolution_pixels(self) -> int:
        """Total pixel count for resolution comparison."""
        return self.width * self.height

    def video_codec_rank(self) -> int:
        return VIDEO_CODEC_RANK.get(self.video_codec, -1)

    def audio_codec_rank(self) -> int:
        return AUDIO_CODEC_RANK.get(self.audio_codec, -1)

    def summary(self) -> str:
        """Human-readable summary."""
        res = f"{self.width}x{self.height}" if self.width else "unknown"
        br = f"{self.bitrate // 1000}kbps" if self.bitrate else "unknown"
        return (
            f"{res}, {br}, v:{self.video_codec or '?'}, "
            f"a:{self.audio_codec or '?'} {self.audio_channels}ch, "
            f"{self.subtitle_count} subs"
        )


class QualityService:
    """Service for analyzing video file quality using ffprobe."""

    @staticmethod
    def is_available() -> bool:
        """Check if ffprobe is available on the system."""
        return shutil.which("ffprobe") is not None

    @staticmethod
    def get_ffprobe_path() -> Optional[str]:
        """Get the full path to ffprobe."""
        return shutil.which("ffprobe")

    @staticmethod
    def probe_file(file_path: str) -> Optional[dict]:
        """Run ffprobe on a file and return the parsed JSON output."""
        if not QualityService.is_available():
            logger.warning("ffprobe is not available")
            return None

        path = Path(file_path)
        if not path.exists():
            logger.warning(f"File does not exist: {file_path}")
            return None

        try:
            result = subprocess.run(
                [
                    "ffprobe",
                    "-v", "quiet",
                    "-print_format", "json",
                    "-show_format",
                    "-show_streams",
                    str(path),
                ],
                capture_output=True,
                text=True,
                timeout=30,
            )
            if result.returncode != 0:
                logger.warning(f"ffprobe failed for {file_path}: {result.stderr}")
                return None

            return json.loads(result.stdout)
        except subprocess.TimeoutExpired:
            logger.warning(f"ffprobe timed out for {file_path}")
            return None
        except (json.JSONDecodeError, OSError) as e:
            logger.warning(f"ffprobe error for {file_path}: {e}")
            return None

    @staticmethod
    def analyze(file_path: str) -> Optional[MediaQuality]:
        """Analyze a video file and return a MediaQuality profile.

        Returns None if ffprobe is unavailable or the file can't be probed.
        """
        probe = QualityService.probe_file(file_path)
        if not probe:
            return None

        mq = MediaQuality(file_path=file_path)

        streams = probe.get("streams", [])
        fmt = probe.get("format", {})

        # Overall bitrate from format
        try:
            mq.bitrate = int(fmt.get("bit_rate", 0))
        except (ValueError, TypeError):
            mq.bitrate = 0

        # Walk streams
        video_found = False
        best_audio_channels = 0
        best_audio_codec = ""
        subtitle_count = 0

        for stream in streams:
            codec_type = stream.get("codec_type", "")

            if codec_type == "video" and not video_found:
                mq.width = int(stream.get("width", 0) or 0)
                mq.height = int(stream.get("height", 0) or 0)
                mq.video_codec = (stream.get("codec_name", "") or "").lower()
                video_found = True

            elif codec_type == "audio":
                channels = int(stream.get("channels", 0) or 0)
                codec = (stream.get("codec_name", "") or "").lower()
                # Keep the best audio track (most channels, then best codec)
                if channels > best_audio_channels or (
                    channels == best_audio_channels
                    and AUDIO_CODEC_RANK.get(codec, -1) > AUDIO_CODEC_RANK.get(best_audio_codec, -1)
                ):
                    best_audio_channels = channels
                    best_audio_codec = codec

            elif codec_type == "subtitle":
                subtitle_count += 1

        mq.audio_codec = best_audio_codec
        mq.audio_channels = best_audio_channels
        mq.subtitle_count = subtitle_count

        return mq

    @staticmethod
    def compare(
        existing: MediaQuality,
        new: MediaQuality,
        priorities: list[dict],
    ) -> str:
        """Compare two MediaQuality profiles using the user's priority ranking.

        Args:
            existing: Quality of the file currently in the library.
            new: Quality of the incoming file.
            priorities: List of {"factor": str, "points": int}, sorted by
                        descending points. The first decisive factor wins.

        Returns:
            "new_better"      — new file should replace existing
            "existing_better" — keep existing, discard new
            "equal"           — no decisive difference (keep existing)
        """
        # Sort by points descending to ensure correct priority order
        sorted_priorities = sorted(priorities, key=lambda p: p.get("points", 0), reverse=True)

        for prio in sorted_priorities:
            factor = prio.get("factor", "")
            result = QualityService._compare_factor(existing, new, factor)
            if result != 0:
                winner = "new_better" if result > 0 else "existing_better"
                logger.debug(
                    f"Quality compare: factor '{factor}' is decisive → {winner}"
                )
                return winner

        # All factors equal → keep existing (no churn)
        return "equal"

    @staticmethod
    def _compare_factor(existing: MediaQuality, new: MediaQuality, factor: str) -> int:
        """Compare a single quality factor.

        Returns:
            > 0 if new is better
            < 0 if existing is better
            0   if equal or factor unknown
        """
        if factor == "resolution":
            return _cmp(new.resolution_pixels(), existing.resolution_pixels())

        elif factor == "bitrate":
            return _cmp(new.bitrate, existing.bitrate)

        elif factor == "video_codec":
            return _cmp(new.video_codec_rank(), existing.video_codec_rank())

        elif factor == "audio_codec":
            return _cmp(new.audio_codec_rank(), existing.audio_codec_rank())

        elif factor == "audio_channels":
            return _cmp(new.audio_channels, existing.audio_channels)

        elif factor == "subtitles":
            return _cmp(new.subtitle_count, existing.subtitle_count)

        return 0


def _cmp(a: int, b: int) -> int:
    """Three-way comparison: positive if a > b, negative if a < b, zero if equal."""
    return (a > b) - (a < b)


# Global instance
quality_service = QualityService()
