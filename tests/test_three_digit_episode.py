"""Zero-padded 3-digit episode numbers must not be mistaken for codec tags."""

from src.services.matcher import MatcherService


def test_three_digit_episodes_parse():
    m = MatcherService()
    cases = {
        "1x054 - Ta Da Dump.mkv": (1, 54, None),
        "1x106 - The Senses Song.mkv": (1, 106, None),
        "0x005 - The SpongeBob SquarePants Movie.mp4": (0, 5, None),
        "3x057-3x058 - Cal-umbus + Porky Pigskin.mkv": (3, 57, 58),
        "1x54 - Two Digit Still Works.mkv": (1, 54, None),
        "Show.S01E005.720p.mkv": (1, 5, None),
    }
    for name, expected in cases.items():
        p = m.parse_filename(name)
        assert p is not None, f"failed to parse {name}"
        assert (p.season, p.episode, p.episode_end) == expected, f"{name} -> {p}"


def test_codec_tags_still_rejected():
    """A codec tag is preceded by a separator, never a digit."""
    m = MatcherService()
    for name in ["Show.Name.2020.1080p.BluRay.x264-GRP.mkv",
                 "Show.Name.1080p.h265-GRP.mkv",
                 "Show.Name.2020.720p.H.264.mkv"]:
        p = m.parse_filename(name)
        assert p is None or p.episode not in (264, 265), f"{name} parsed as codec: {p}"


if __name__ == "__main__":
    test_three_digit_episodes_parse()
    test_codec_tags_still_rejected()
    print("ok")
