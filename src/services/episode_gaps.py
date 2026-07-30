"""Find episode gaps: missing episodes that sit between episodes we already hold."""

import re


def _file_covers(file_path: str, ep_num: int) -> bool:
    """True if a filename explicitly names ep_num (multi-episode file like S01E05-E06)."""
    if not file_path:
        return False
    filename = file_path.rsplit("/", 1)[-1]
    # E06 / x06 / -06 / -E06, but not mid-word ('Se7en') or codec digits ('x264' for ep 4)
    return re.search(rf"(?<![A-Za-z])(?:[exEX]|-[eE]?)0*{ep_num}(?!\d)", filename) is not None


def find_gaps(episodes, ignored_ids=frozenset()):
    """Group episodes by season, returning [(season, [missing episode numbers]), ...].

    Only episodes strictly between the first and last episode we hold count as a
    gap — leading and trailing missing episodes do not. A multi-episode file
    counts for every episode its name mentions, so a combined "5 & 6" release
    leaves no gap even if only one of the two rows is marked found.
    """
    by_season: dict[int, list] = {}
    for ep in episodes:
        if ep.season == 0:  # specials are never a gap
            continue
        by_season.setdefault(ep.season, []).append(ep)

    gaps = []
    for season in sorted(by_season):
        eps = by_season[season]
        held = [e for e in eps if e.file_status != "missing"]
        if not held:
            continue
        first = min(e.episode for e in held)
        last = max(e.episode for e in held)
        held_paths = [e.file_path for e in held]
        missing = sorted(
            e.episode
            for e in eps
            if e.file_status == "missing"
            and first < e.episode < last
            and e.id not in ignored_ids
            and not any(_file_covers(p, e.episode) for p in held_paths)
        )
        if missing:
            gaps.append((season, missing))
    return gaps
