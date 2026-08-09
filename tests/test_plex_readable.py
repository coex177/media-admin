"""Check that imported files end up readable by Plex (which runs as another user)."""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from src.services.file_utils import make_plex_readable


def test_make_plex_readable(tmp_path):
    # The bug: a 0600 file imports as 0600 and Plex silently skips it.
    f = tmp_path / "movie.mkv"
    f.touch()
    f.chmod(0o600)
    make_plex_readable(f)
    assert f.stat().st_mode & 0o777 == 0o664

    # Never removes bits that were already granted.
    f.chmod(0o755)
    make_plex_readable(f)
    assert f.stat().st_mode & 0o777 == 0o775

    # Already fine -> unchanged.
    f.chmod(0o664)
    make_plex_readable(f)
    assert f.stat().st_mode & 0o777 == 0o664


def test_missing_file_does_not_raise(tmp_path):
    # A failed chmod must not fail an otherwise-good import.
    make_plex_readable(tmp_path / "gone.mkv")


if __name__ == "__main__":
    import tempfile

    with tempfile.TemporaryDirectory() as d:
        test_make_plex_readable(Path(d))
        test_missing_file_does_not_raise(Path(d))
    print("ok")
