"""Regression test for filenames Plex silently refuses to scan.

Both cases below are real files that sat invisible in the library for years:
Plex read them fine and deliberately excluded them, with no error logged.
"""

from src.services.file_utils import plex_safe_stem


def test_sample_token_falls_back_to_episode_code():
    # Mrs. Fletcher S1E02 — real title is "Free Sample"
    assert plex_safe_stem("1x02 - Free Sample", fallback="1x02") == "1x02"


def test_extras_suffix_is_dehyphenated_not_dropped():
    # Truth Be Told S2E07 — "-Short" read as a local extra, like "-trailer"
    assert (
        plex_safe_stem("2x07 - Lanterman-Petris-Short", fallback="2x07")
        == "2x07 - Lanterman-Petris Short"
    )


def test_every_plex_extra_suffix_is_neutralised():
    for suffix in ("trailer", "deleted", "featurette", "interview",
                   "scene", "short", "other", "behindthescenes"):
        out = plex_safe_stem(f"1x01 - Title-{suffix}", fallback="1x01")
        assert out == f"1x01 - Title {suffix}", out


def test_ordinary_names_are_untouched():
    for stem in ("1x01 - Pilot", "3x12 - The Long Goodbye",
                 "Free Samples (2013)",          # 'Samples' != 'sample'
                 "1x05 - Sampler Platter",       # 'Sampler' != 'sample'
                 "2x03 - Short Circuit"):        # 'Short' not a trailing suffix
        assert plex_safe_stem(stem, fallback="XxXX") == stem


def test_movies_keep_their_title_without_a_fallback():
    # No fallback: a movie's title is its match key, so never discard it.
    assert plex_safe_stem("Sample People (2000)") == "Sample People (2000)"
    # Plex only reads the suffix as an extra at the very end of the stem, so a
    # mid-name '-Trailer' is a normal title and must survive untouched.
    assert plex_safe_stem("The Movie-Trailer (1999)") == "The Movie-Trailer (1999)"
    assert plex_safe_stem("The Movie-Trailer") == "The Movie Trailer"


if __name__ == "__main__":
    for name, fn in sorted(globals().items()):
        if name.startswith("test_"):
            fn()
            print(f"ok  {name}")
    print("all passed")
