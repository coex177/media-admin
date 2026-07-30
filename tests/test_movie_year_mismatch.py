"""A remake must never match the original just because the titles agree.

Real case: Supergirl.2026...mkv scored 1.0 on title, -0.3 for the year mismatch
= 0.70, exactly the match threshold, so it overwrote Supergirl (1984).
"""

from src.services.movie_matcher import MovieMatcherService

m = MovieMatcherService()

LIBRARY = [{"id": 1, "title": "Supergirl", "year": 1984}]


def test_remake_does_not_match_the_original_in_the_library():
    assert m.find_best_movie_match("Supergirl", 2026, LIBRARY) is None


def test_same_year_still_matches():
    assert m.find_best_movie_match("Supergirl", 1984, LIBRARY)[0]["id"] == 1


def test_one_year_of_drift_is_tolerated():
    # Release-vs-production year disagreement is common and still the same film
    assert m.match_movie_title("Supergirl", "Supergirl", 1985, 1984) == 0.7
    assert m.find_best_movie_match("Supergirl", 1985, LIBRARY)[0]["id"] == 1


def test_unknown_year_falls_back_to_the_title():
    assert m.find_best_movie_match("Supergirl", None, LIBRARY)[0]["id"] == 1


def test_far_apart_years_score_zero_even_on_an_exact_title():
    assert m.match_movie_title("Supergirl", "Supergirl", 2026, 1984) == 0.0


if __name__ == "__main__":
    for name, fn in sorted(globals().items()):
        if name.startswith("test_"):
            fn()
            print(f"ok  {name}")
    print("all passed")
