from src.services.movie_matcher import MovieMatcherService


def test_exact_title_outranks_partial_with_same_year():
    m = MovieMatcherService()
    # 'Runner' (2026) and 'The Runner' (2026) are different movies
    assert m.match_movie_title("Runner", "Runner", 2026, 2026) == 1.0
    assert m.match_movie_title("Runner", "The Runner", 2026, 2026) < 1.0
    # A partial match still clears the 0.7 threshold ('Batman' → 'The Batman')
    assert m.find_best_movie_match("Batman", 2022, [{"id": 1, "title": "The Batman", "year": 2022}])
