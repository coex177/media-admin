from src.services.matcher import MatcherService


def test_show_name_match():
    m = MatcherService()
    # Dotted acronym split by dot->space parsing still matches
    assert m.match_show_name("S W A T Exiles", "S.W.A.T. Exiles") == 1.0
    assert m.match_show_name("S W A T", "S.W.A.T.") == 1.0
    # Spin-off with extra leading word must not hit the parent show
    shows = [{"id": 1045, "name": "ONE PIECE"}]
    assert m.find_best_show_match("Lego One Piece", shows) is None
    # Abbreviated filename still matches the longer show name
    assert m.match_show_name("Agents of SHIELD", "Marvel's Agents of S.H.I.E.L.D.") == 0.9
    # S.W.A.T. Exiles must not land in S.W.A.T.
    assert m.find_best_show_match("S W A T Exiles", [{"id": 1, "name": "S.W.A.T."}]) is None
    # Country suffix in filename still matches the bare show name
    assert m.match_show_name("Euphoria US", "Euphoria") == 0.9
    assert m.match_show_name("Heartland CA", "Heartland") == 0.9
    assert m.find_best_show_match("Sanctuary A Witch", [{"id": 1, "name": "Sanctuary"}]) is None
