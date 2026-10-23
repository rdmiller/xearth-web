import datetime as dt
import json
from pathlib import Path

from xearth_clouds import meteors

GMN_TEXT = (Path(__file__).parent / "fixtures" / "gmn-latest-2026-10-23.txt").read_text(encoding="utf-8")
UTC = dt.timezone.utc


def m(id_, minutes, shower="ORI", mag=1.5):
    return {
        "id": id_, "time": dt.datetime(2026, 10, 21, 18, 0, tzinfo=UTC) + dt.timedelta(minutes=minutes), "shower": shower,
        "lat0": 45.5, "lon0": 10.25, "h0": 110.4, "lat1": 45.2, "lon1": 10.75, "h1": 85.1, "mag": mag, "v": 66.2,
    }


def test_reads_gmn_columns_by_name():
    rows = meteors.parse_gmn(GMN_TEXT)
    assert len(rows) == 5
    assert [r["shower"] for r in rows] == ["ORI", "ORI", "ORI", "...", "..."]
    r = rows[0]
    assert r["id"] == "20261021182335_QLvTa"
    assert r["time"] == dt.datetime(2026, 10, 21, 18, 23, 35, 460639, tzinfo=UTC)
    # Orionids enter at ~66 km/s, high up, and burn out above 80 km.
    assert 60 < r["v"] < 72
    assert r["h0"] > r["h1"] > 70
    assert -90 <= r["lat0"] <= 90 and -180 <= r["lon0"] <= 180


def test_packs_the_last_day_as_integers():
    rows = [m("a", 0, "ORI"), m("b", 60, "STA"), m("c", 120, "ORI"), m("d", 180, "..."), m("old", -24 * 60 - 1, "ORI"), m("a", 0, "ORI")]
    p = meteors.pack(rows)
    assert p["from"] == "2026-10-20T21:00:00.000Z" and p["to"] == "2026-10-21T21:00:00.000Z"
    # Duplicates (both files list some) count once; the one older than 24 h is gone.
    assert p["counts"] == {"ORI": 2, "STA": 1, "...": 1}
    assert p["showers"] == ["ORI", "STA", "..."]
    n = len(meteors.FIELDS)
    assert len(p["meteors"]) == 4 * n
    first = p["meteors"][:n]
    assert first == [21 * 3600, 4550, 1025, 1104, 4520, 1075, 851, 15, 0, 662]


def test_no_meteors_packs_empty():
    assert meteors.pack([])["meteors"] == []


def test_fireballs_get_signed_coordinates():
    api = {
        "fields": ["date", "energy", "impact-e", "lat", "lat-dir", "lon", "lon-dir", "alt", "vel"],
        "data": [
            ["2026-10-04 03:14:45", "5.4", "0.18", "41.8", "S", "173.1", "W", "26.9", "13.8"],
            ["2026-09-11 01:12:11", "24.6", "0.67", "54.4", "N", "100.1", "W", "38.0", None],
            ["2026-09-01 00:00:00", "1.0", "0.05", None, None, None, None, None, None],
        ],
    }
    f = meteors.parse_fireballs(api)
    assert len(f) == 2
    assert f[0] == {"time": "2026-10-04T03:14:45Z", "lat": -41.8, "lon": -173.1, "alt": 26.9, "vel": 13.8, "energy": 5.4, "impactKt": 0.18}
    assert f[1]["vel"] is None and f[1]["lat"] == 54.4


def test_build_combines_both_files_and_survives_cneos_failing():
    def get(url):
        if url.startswith(meteors.CNEOS):
            raise OSError("down")
        return GMN_TEXT.encode()

    out = meteors.build(get, now=dt.datetime(2026, 10, 23, 3, tzinfo=UTC))
    # Both GMN files are the fixture here: the same five meteors, counted once.
    assert len(out["meteors"]) == 5 * len(meteors.FIELDS)
    assert out["showers"] == ["ORI", "..."]
    assert out["fireballs"] == []
    json.dumps(out)
