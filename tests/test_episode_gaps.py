"""Gaps are missing episodes *between* episodes we hold — nothing else."""

from types import SimpleNamespace

from src.services.episode_gaps import find_gaps


def ep(season, num, held=False, path=None):
    return SimpleNamespace(
        id=season * 100 + num,
        season=season,
        episode=num,
        file_status="found" if (held or path) else "missing",
        file_path=path,
    )


def test_gap_in_the_middle_is_reported():
    eps = [ep(1, 1, True), ep(1, 2, True), ep(1, 3, True), ep(1, 4), ep(1, 5), ep(1, 6, True)]
    assert find_gaps(eps) == [(1, [4, 5])]


def test_trailing_and_leading_missing_are_not_gaps():
    trailing = [ep(1, 1, True), ep(1, 2, True), ep(1, 3, True), ep(1, 4, True), ep(1, 5), ep(1, 6)]
    leading = [ep(1, 1), ep(1, 2), ep(1, 3, True), ep(1, 4, True)]
    assert find_gaps(trailing) == []
    assert find_gaps(leading) == []


def test_combined_episode_file_fills_both_slots():
    # DB marked both rows found (normal watcher/scanner behaviour)
    both = [ep(1, i, True) for i in range(1, 5)] + [
        ep(1, 5, path="/tv/Show/Season 1/1x05-E06 - Finale.mkv"),
        ep(1, 6, path="/tv/Show/Season 1/1x05-E06 - Finale.mkv"),
        ep(1, 7, True),
    ]
    assert find_gaps(both) == []

    # Only E05 got marked found, but its filename names E06 too
    one_row = [ep(1, i, True) for i in range(1, 5)] + [
        ep(1, 5, path="/tv/Show/Season 1/1x05-E06 - Finale.mkv"),
        ep(1, 6),
        ep(1, 7, True),
    ]
    assert find_gaps(one_row) == []


def test_codec_digits_in_filename_do_not_fill_a_gap():
    eps = [
        ep(1, 1, path="/tv/Show/Season 1/Show.S01E01.1080p.x264-GRP.mkv"),
        ep(1, 2),
        ep(1, 4),
        ep(1, 6, path="/tv/Show/Season 1/Show.S01E06.720p.h264-GRP.mkv"),
    ]
    assert find_gaps(eps) == [(1, [2, 4])]


def test_specials_and_ignored_episodes_never_count():
    eps = [ep(0, 1, True), ep(0, 2), ep(0, 3, True), ep(1, 1, True), ep(1, 2), ep(1, 3, True)]
    assert find_gaps(eps) == [(1, [2])]
    assert find_gaps(eps, ignored_ids={102}) == []


def test_each_season_is_reported_separately():
    eps = [
        ep(1, 1, True), ep(1, 2), ep(1, 3, True),
        ep(2, 1, True), ep(2, 2, True),
        ep(3, 1, True), ep(3, 2), ep(3, 3), ep(3, 4, True),
    ]
    assert find_gaps(eps) == [(1, [2]), (3, [2, 3])]


if __name__ == "__main__":
    for name, fn in sorted(globals().items()):
        if name.startswith("test_"):
            fn()
            print(f"ok  {name}")
    print("all passed")
