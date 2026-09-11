"""A multi-episode filename must stay inside the filesystem's 255-byte limit.

Five chapters of a long title produced a 306-byte name, and shutil.move then
raised ENAMETOOLONG as an unhandled error, so the whole refresh returned a 500.
"""

from types import SimpleNamespace

import pytest

from src.services.renamer import RenamerService


def _show():
    return SimpleNamespace(
        name="Teen Titans Go!",
        episode_format="{season}x{episode:02d} - {title}",
        season_format="Season {season}",
        folder_path="/tmp/x",
    )


def _eps(titles, season=6, start=18):
    return [
        SimpleNamespace(season=season, episode=start + i, title=t)
        for i, t in enumerate(titles)
    ]


LONG = [
    "The Night Begins To Shine - Chapter One: Mission To Find The Lost Stems",
    "The Night Begins To Shine - Chapter Two: Drums",
    "The Night Begins To Shine - Chapter Three: Guitar",
    "The Night Begins To Shine - Chapter Four: Bass",
    "The Night Begins To Shine - Chapter Five: You're The One",
]


def test_long_range_is_trimmed_to_fit(db=None):
    svc = RenamerService.__new__(RenamerService)
    name = svc.generate_multi_episode_filename(_show(), _eps(LONG), ".mkv")
    assert len(name.encode()) <= 255, f"{len(name.encode())} bytes: {name}"
    assert name.startswith("6x18-6x19-6x20-6x21-6x22")
    assert name.endswith(".mkv")


def test_short_range_is_untouched():
    svc = RenamerService.__new__(RenamerService)
    name = svc.generate_multi_episode_filename(
        _show(), _eps(["Drums", "Guitar"]), ".mkv"
    )
    assert name == "6x18-6x19 - Drums + Guitar.mkv"


def test_trims_whole_titles_never_mid_title():
    """A partial title would name an episode that does not exist."""
    svc = RenamerService.__new__(RenamerService)
    name = svc.generate_multi_episode_filename(_show(), _eps(LONG), ".mkv")
    stem = name[: -len(".mkv")]
    if " - " in stem:
        titles = stem.split(" - ", 1)[1].split(" + ")
        for t in titles:
            assert t in [x.replace(":", "") for x in LONG], f"partial title: {t!r}"


if __name__ == "__main__":
    test_long_range_is_trimmed_to_fit()
    test_short_range_is_untouched()
    test_trims_whole_titles_never_mid_title()
    print("ok")
