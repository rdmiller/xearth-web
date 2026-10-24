import datetime as dt
from pathlib import Path

from xearth_clouds import tsunami

FIX = Path(__file__).parent / "fixtures"
NTWC = (FIX / "tsunami_ntwc_atom.xml").read_text(encoding="utf-8")  # real PAAQAtom.xml, 2026-10-21
PTWC = (FIX / "tsunami_ptwc_atom.xml").read_text(encoding="utf-8")  # real PHEBAtom.xml, 2026-10-21
NOW = dt.datetime(2026, 10, 21, 22, 0, tzinfo=dt.timezone.utc)


def get(url):
    return NTWC if "PAAQ" in url else PTWC


def test_parses_epicentre_category_magnitude_and_note():
    [b] = tsunami.parse_feed(NTWC, "NTWC")
    assert b["category"] == "information"
    assert b["region"] == "45 miles SE of Sand Point, Alaska"
    assert (b["lat"], b["lon"]) == (54.634, -160.218)
    assert (b["magnitude"], b["magnitudeType"]) == (5.0, "Ml")
    assert b["issued"] == "2026-10-20T10:45:01.000Z"
    assert b["note"] == "There is NO tsunami danger from this earthquake."
    assert b["bulletin"].endswith("WEAK53.txt")
    assert b["cap"].endswith("PAAQCAP.xml")


def test_bulletin_link_is_https_only():
    for href in ("javascript:alert(1)//WEAK53.txt", "http://www.tsunami.gov/WEAK53.txt"):
        xml = NTWC.replace("https://www.tsunami.gov/events/PAAQ/2026/10/20/tn7cbt/1/WEAK53/WEAK53.txt", href)
        assert href in xml
        [b] = tsunami.parse_feed(xml, "NTWC")
        assert b["bulletin"] is None


def test_ptwc_uppercase_titles_and_no_note():
    [b] = tsunami.parse_feed(PTWC, "PTWC")
    assert (b["center"], b["region"], b["magnitude"], b["magnitudeType"]) == ("PTWC", "VANUATU", 6.6, "Mwp")
    assert b["note"] is None


def test_category_names():
    assert tsunami.category("Warning") == "warning"
    assert tsunami.category("Tsunami Threat Message") == "threat"
    assert tsunami.category("Information") == "information"
    assert tsunami.category("") == ""


def test_build_keeps_48_hours_alerts_first():
    m = tsunami.build(get, NOW)
    assert m["centers"] == ["NTWC", "PTWC"]
    assert [b["region"] for b in m["bulletins"]] == ["45 miles SE of Sand Point, Alaska", "VANUATU"]  # newest first
    assert tsunami.build(get, NOW + dt.timedelta(days=2))["bulletins"] == []

    warning = PTWC.replace("<strong>Category:</strong> Information", "<strong>Category:</strong> Warning")
    m = tsunami.build(lambda url: NTWC if "PAAQ" in url else warning, NOW)
    assert [b["category"] for b in m["bulletins"]] == ["warning", "information"]


def test_one_feed_failing_keeps_the_other():
    def flaky(url):
        if "PHEB" in url:
            raise OSError("503")
        return NTWC

    m = tsunami.build(flaky, NOW)
    assert m["centers"] == ["NTWC"] and len(m["bulletins"]) == 1
