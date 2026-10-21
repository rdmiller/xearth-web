import datetime as dt
import json
from pathlib import Path

from xearth_clouds import fires, storms

FIX = Path(__file__).parent / "fixtures"
EVENTS = (FIX / "gdacs_events.json").read_text(encoding="utf-8")  # real GDACS list, 2026-10-21 (2 TCs + 1 EQ)
CHAMPI = (FIX / "gdacs_champi_track.json").read_text(encoding="utf-8")  # real track geometry (lines + centroid)
NHC = (FIX / "nhc_current_storms.json").read_text(encoding="utf-8")  # real NHC CurrentStorms (TD Twenty-Two-E)
FIRMS = (FIX / "firms_j1_sample.csv").read_text(encoding="utf-8")  # first 300 rows of the NOAA-20 24 h CSV
NOW = dt.datetime(2026, 10, 21, 19, 0, tzinfo=dt.timezone.utc)


def fake_get(champi_only=True):
    def get(url):
        if "EVENTS4APP" in url:
            return EVENTS
        if "getgeometry" in url:
            # Twenty-Two-E's geometry isn't in the fixtures; give it an empty collection.
            return CHAMPI if "1001338" in url else json.dumps({"features": []})
        if "CurrentStorms" in url:
            return NHC
        raise AssertionError(url)

    return get


def test_gdacs_track_segments_keep_class_and_forecast_flag():
    segs = storms._segments(json.loads(CHAMPI))
    assert len(segs) == 36
    assert all(len(s) == 6 for s in segs)
    assert {s[4] for s in segs} == {"TD", "TS", "HU"}
    assert {s[5] for s in segs} <= {0, 1}
    assert segs[0][5] == 1  # the first line in the file is forecast


def test_builds_both_storms_and_merges_nhc_details():
    m = storms.build(fake_get(), now=NOW)
    by_name = {s["name"]: s for s in m["storms"]}
    champi = by_name["Champi"]
    assert champi["alert"] == "Red"
    assert champi["source"] == "JTWC"
    assert champi["pos"] == [127.9, 19.3]
    assert champi["peakWindKmh"] == 296
    # Segments come grouped by class, not by time; the observed segment ending at
    # the current position is HU (a 296 km/h typhoon), even though the earliest
    # part of the track was TD/TS.
    assert champi["cls"] == "HU"

    td = by_name["Twenty-Two-E"]
    # NHC's JSON mixes units: intensity in knots, movement in mph. The public
    # advisory for this storm: 35 mph / 55 km/h winds, moving W at 7 mph / 11 km/h.
    assert td["nhc"]["windKmh"] == 56
    assert td["nhc"]["movementKmh"] == 11
    assert td["nhc"]["pressureMb"] == 1005
    assert td["nhc"]["classification"] == "TD"


def test_stale_gdacs_events_are_dropped():
    later = NOW + dt.timedelta(days=5)
    m = storms.build(fake_get(), now=later)
    # GDACS events are stale by then; only NHC's own listing remains (added on its own).
    assert [s["source"] for s in m["storms"]] == ["NHC"]


def test_fires_drop_low_confidence_and_merge_into_cells():
    rows = list(fires.rows(FIRMS))
    cells = fires.aggregate(rows, NOW)
    kept = [r for r in rows if not r["confidence"].lower().startswith("l")]
    assert sum(c[4] for c in cells) == len(kept)
    assert len(cells) <= len(kept)
    # Total FRP is preserved (×10, rounded per cell).
    assert abs(sum(c[2] for c in cells) / 10 - sum(float(r["frp"]) for r in kept)) < len(cells) * 0.05
    lat_i, lon_i = cells[0][0], cells[0][1]
    assert -90 / 0.05 <= lat_i <= 90 / 0.05 and -180 / 0.05 <= lon_i <= 180 / 0.05


def test_fire_age_is_hours_since_the_latest_detection():
    rows = [
        {"latitude": "10.01", "longitude": "20.01", "frp": "5", "confidence": "nominal", "acq_date": "2026-10-21", "acq_time": "0300"},
        {"latitude": "10.02", "longitude": "20.02", "frp": "7", "confidence": "high", "acq_date": "2026-10-21", "acq_time": "1500"},
        {"latitude": "10.02", "longitude": "20.02", "frp": "99", "confidence": "low", "acq_date": "2026-10-21", "acq_time": "1800"},
    ]
    [cell] = fires.aggregate(rows, NOW)
    assert cell[2] == 120  # 5 + 7 MW, ×10; the low-confidence one is dropped
    assert cell[3] == 4  # latest kept detection 15:00 → 4 h before 19:00
    assert cell[4] == 2


def test_fires_build_survives_one_missing_satellite():
    def get(url):
        if "J2_VIIRS" in url:
            raise OSError("404")
        return FIRMS

    m = fires.build(get, now=NOW)
    assert "NOAA-20" in m["source"] and "NOAA-21" not in m["source"]
    assert m["count"] * 5 == len(m["data"])
