"""Same-name shows in year-suffixed folders: the year must decide the match.

Three "Queer as Folk" series (1999, 2000, 2022) live side by side in the
library, plus a leftover bare "Queer as Folk" folder. Phase 1's direct lookup
used to try the bare name before the year variant, so the 1999 and 2000 shows
kept binding to the no-year folder instead of their own.
"""

from types import SimpleNamespace

import pytest

from src.models import ScanFolder, Tenant, current_tenant_id
from src.services.scanner import ScannerService


@pytest.fixture
def library(db, tmp_path):
    for name in (
        "Queer as Folk",            # stray no-year folder
        "Queer as Folk (1999)",
        "Queer As Folk (2000)",     # capital A — case must not matter
        "Queer as Folk (2022)",
    ):
        (tmp_path / name).mkdir()
    db.add(Tenant(id=1, name="t"))
    db.commit()
    current_tenant_id.set(1)
    db.add(ScanFolder(path=str(tmp_path), folder_type="library"))
    db.commit()
    yield tmp_path
    current_tenant_id.set(None)


def _show(name, first_air):
    return SimpleNamespace(name=name, first_air_date=first_air)


def test_year_folder_beats_bare_folder(db, library):
    got = ScannerService(db).find_show_folder(_show("Queer as Folk", "1999-02-23"))
    assert got == str(library / "Queer as Folk (1999)")


def test_year_match_is_case_insensitive(db, library):
    got = ScannerService(db).find_show_folder(_show("Queer as Folk", "2000-12-03"))
    assert got == str(library / "Queer As Folk (2000)")


def test_country_suffixed_name_matches_year_folder(db, library):
    # TVDB titles the 2000 series "Queer as Folk (US)"
    got = ScannerService(db).find_show_folder(_show("Queer as Folk (US)", "2000-12-03"))
    assert got == str(library / "Queer As Folk (2000)")


def test_bare_folder_still_used_without_year(db, library):
    got = ScannerService(db).find_show_folder(_show("Queer as Folk", None))
    assert got == str(library / "Queer as Folk")
