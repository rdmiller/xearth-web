import datetime as dt
from pathlib import Path

import numpy as np
import pytest

from xearth_clouds import smoke

KML = (Path(__file__).parent / "fixtures" / "hms_smoke_sample.kml").read_text(encoding="utf-8")  # 4 of 234 real placemarks, 2026-10-21
NOW = dt.datetime(2026, 10, 21, 22, 0, tzinfo=dt.timezone.utc)


def px(lat, lon):
    return int((90 - lat) / 180 * smoke.HEIGHT), int((lon + 180) / 360 * smoke.WIDTH)


def test_parse_reads_density_times_satellite_and_ring():
    plumes = smoke.parse_kml(KML)
    assert [p["density"] for p in plumes] == [1, 1, 2, 3]
    heavy = plumes[3]
    assert heavy["start"] == dt.datetime(2026, 10, 21, 15, 0, tzinfo=dt.timezone.utc)  # "2026294 1500UTC"
    assert heavy["end"] == dt.datetime(2026, 10, 21, 17, 0, tzinfo=dt.timezone.utc)
    assert heavy["satellite"] == "GOES-EAST"
    assert heavy["outer"][0] == (-87.237859, 31.862057)
    assert heavy["outer"][0] == heavy["outer"][-1]  # closed ring


def test_rasterise_takes_the_densest_overlapping_plume():
    def box(lon0, lat0, lon1, lat1):
        return [(lon0, lat0), (lon1, lat0), (lon1, lat1), (lon0, lat1), (lon0, lat0)]

    light = {"density": 1, "outer": box(-100, 40, -90, 30), "holes": []}
    heavy = {"density": 3, "outer": box(-96, 36, -94, 34), "holes": []}
    grid = smoke.rasterise([heavy, light])  # order doesn't matter
    assert grid[px(35.0, -95.0)] == 255
    assert grid[px(38.0, -98.0)] == 85
    assert grid[px(45.0, -95.0)] == 0


def test_real_plumes_land_where_hms_drew_them():
    grid = smoke.rasterise(smoke.parse_kml(KML))
    assert grid[px(31.87, -87.34)] > 0  # inside the first light plume (Alabama)
    assert grid[px(40.0, -100.0)] == 0
    # The heavy plume is ~10 × 4 km, under one ~10 km pixel: drawn to scale, so faint.
    assert 0 < grid[px(31.85, -87.27)] < 255


def test_holes_are_cut_out():
    square = [(-100.0, 40.0), (-90.0, 40.0), (-90.0, 30.0), (-100.0, 30.0), (-100.0, 40.0)]
    hole = [(-97.0, 37.0), (-93.0, 37.0), (-93.0, 33.0), (-97.0, 33.0), (-97.0, 37.0)]
    grid = smoke.rasterise([{"density": 2, "outer": square, "holes": [hole]}])
    assert grid[px(38.5, -98.5)] == 170
    assert grid[px(35.0, -95.0)] == 0


def test_falls_back_to_yesterday_when_today_is_missing_or_empty():
    empty = '<?xml version="1.0"?><kml><Document></Document></kml>'

    def get(url):
        if "hms_smoke20261021" in url:
            return empty.encode()
        if "hms_smoke20261020" in url:
            return KML.encode()
        raise AssertionError(url)

    m, img = smoke.build(get, NOW)
    assert m["date"] == "2026-10-20"
    assert m["plumes"] == {"Light": 2, "Medium": 1, "Heavy": 1}
    assert m["latest"] == "2026-10-21T17:00:00.000Z"
    assert img.mode == "L" and img.size == (smoke.WIDTH, smoke.HEIGHT)

    with pytest.raises(RuntimeError):
        smoke.build(lambda url: (_ for _ in ()).throw(OSError("404")), NOW)
