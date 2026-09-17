"""compute_rename_previews must not emit a path the filesystem cannot write.

The renamer learned the 255-byte cap, but the scanner's preview builder kept its
own copy of the multi-episode filename logic, so a five-chapter Teen Titans Go!
range produced a 306-byte expected_path. apply_renames then raised
ENAMETOOLONG from dest.exists() and the whole batch returned a 500.
"""

from types import SimpleNamespace

from src.services.renamer import RenamerService


def test_long_multi_episode_preview_fits():
    titles = [
        "The Night Begins To Shine - Chapter One Mission To Find The Lost Stems",
        "The Night Begins To Shine - Chapter Two Drums",
        "The Night Begins To Shine - Chapter Three Guitar",
        "The Night Begins To Shine - Chapter Four Bass",
        "The Night Begins To Shine - Chapter Five You're The One",
    ]
    code, sep, ext = "6x18-6x19", " - ", ".mkv"
    stem = code + sep + " + ".join(titles)
    assert len(stem.encode()) + len(ext.encode()) > 255  # the original bug

    name = RenamerService.__new__(RenamerService)._fit_name(stem, code, sep, titles, ext)
    assert len(name.encode()) <= 255
    assert name.startswith(code)       # scanner matches on the episode code
    assert name.endswith(ext)
