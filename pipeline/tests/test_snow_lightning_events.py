import datetime as dt
import gzip
import io
import json
from pathlib import Path

import numpy as np
import pytest
from PIL import Image

from xearth_clouds import events, lightning, snowice

FIX = Path(__file__).parent / "fixtures"
NOW = dt.datetime(2026, 10, 21, 22, 0, tzinfo=dt.timezone.utc)


# ---- snow and ice ----------------------------------------------------------------------


def cell(p, lat, lon):
    x, y = snowice.polar_stereo(np.array(lat, float), np.array(lon, float), p["a"], p["b"], p["lat_ts"], p["lon0"])
    return int(np.floor((p["y0"] - y) / p["cell"])), int(np.floor((x - p["x0"]) / p["cell"]))


def test_ims_projection_lands_known_places_in_the_right_cells():
    # Cells checked against ims2026294_00UTC_4km_v1.3: Greenland → 4 (snow),
    # mid-Atlantic and Hudson Bay → 1 (water), the North Pole → 3 (ice). A mirrored
    # grid would put both water points on land in Asia.
    assert cell(snowice.IMS, 72, -40) == (3434, 3375)
    assert cell(snowice.IMS, 40, -40) == (4135, 3964)
    assert cell(snowice.IMS, 60, -85) == (3868, 3002)
    # −80° points straight down the grid from the pole.
    r0, c0 = cell(snowice.IMS, 89.999, 0)
    r1, c1 = cell(snowice.IMS, 50, -80)
    assert c1 == c0 and r1 > r0


def test_sea_ice_projection_matches_the_nsidc_south_grid():
    # Checked against S_20261017_concentration_v4.0: Weddell and Ross seas ~89 %, 80°S 0° land.
    assert cell(snowice.NSIDC_S, -70, -40) == (106, 101)
    assert cell(snowice.NSIDC_S, -75, 179) == (239, 159)
    assert cell(snowice.NSIDC_S, -80, 0) == (130, 158)
    # At the true-scale latitude the radius is a·mc (no scale error).
    x, y = snowice.polar_stereo(np.array(-70.0), np.array(0.0), **{k: snowice.NSIDC_S[k] for k in ("a", "b", "lat_ts", "lon0")})
    e2 = 1 - (snowice.NSIDC_S["b"] / snowice.NSIDC_S["a"]) ** 2
    mc = np.cos(np.radians(70)) / np.sqrt(1 - e2 * np.sin(np.radians(70)) ** 2)
    assert x == pytest.approx(0, abs=1e-6)
    assert y == pytest.approx(snowice.NSIDC_S["a"] * mc, rel=1e-9)


def test_parse_ims_flips_rows_so_the_top_of_the_map_is_row_zero():
    header = b"Data set starts here\n   Units: 8-bit Flag\n"
    body = b"\n".join([b"1111", b"2222", b"3333", b"4444"])  # file starts at the lower left
    grid = snowice.parse_ims(gzip.compress(header + body + b"\n"), n=4)
    assert grid[:, 0].tolist() == [4, 3, 2, 1]
    with pytest.raises(ValueError):
        snowice.parse_ims(header + b"12\n", n=4)


def test_build_marks_snow_red_and_ice_green():
    n = snowice.IMS["n"]
    grid = np.full((n, n), b"2"[0], np.uint8)
    r, c = cell(snowice.IMS, 72, -40)
    grid[r - 40 : r + 40, c - 40 : c + 40] = b"4"[0]  # snow on Greenland
    r, c = cell(snowice.IMS, 89, 0)
    grid[r - 40 : r + 40, c - 40 : c + 40] = b"3"[0]  # ice at the pole
    text = b"header\n" + b"\n".join(bytes(row) for row in grid[::-1]) + b"\n"
    conc = np.zeros((332, 316), np.uint16)
    conc[96:116, 91:111] = 900  # Weddell Sea pack ice
    conc[125:135, 150:165] = 2540  # land flag: never ice
    tif = io.BytesIO()
    Image.fromarray(conc).save(tif, format="TIFF")

    def get(url):
        if "G02156" in url and "ims2026294" in url:
            return gzip.compress(text)
        if "S_20261019" in url:
            return tif.getvalue()
        raise OSError("404")

    m, img = snowice.build(get, NOW)
    assert m["ims"] == "2026-10-21" and m["seaIceSouth"] == "2026-10-19"
    a = np.array(img)

    def px(lat, lon):
        return a[int((90 - lat) / 180 * snowice.HEIGHT), int((lon + 180) / 360 * snowice.WIDTH)]

    assert px(72, -40)[0] == 255 and px(72, -40)[1] == 0
    assert px(89, 0)[1] == 255
    assert px(-70, -40)[1] > 200  # 90 % → ~230
    assert px(-80, 0)[1] == 0
    assert px(40, -40).tolist() == [0, 0, 0]


# ---- lightning --------------------------------------------------------------------------


def glm_file(lat, lon, flags):
    import netCDF4

    ds = netCDF4.Dataset("x.nc", "w", memory=1024)
    ds.createDimension("number_of_flashes", len(lat))
    for name, values, kind in (("flash_lat", lat, "f4"), ("flash_lon", lon, "f4"), ("flash_quality_flag", flags, "i2")):
        ds.createVariable(name, kind, ("number_of_flashes",))[:] = values
    return bytes(ds.close())


def test_file_start_reads_the_scan_time_from_the_key():
    key = "GLM-L2-LCFA/2026/294/21/OR_GLM-L2-LCFA_G19_s20262942151200_e20262942151400_c20262942151420.nc"
    assert lightning.file_start(key) == dt.datetime(2026, 10, 21, 21, 51, 20, tzinfo=dt.timezone.utc)


def test_read_flashes_drops_flagged_ones():
    lat, lon = lightning.read_flashes(glm_file([10.0, 20.0, 30.0], [-60.0, -70.0, -80.0], [0, 3, 0]))
    assert lat.tolist() == [10.0, 30.0] and lon.tolist() == [-60.0, -80.0]


def test_overlap_takes_the_larger_count_not_the_sum():
    a = lightning.bin_flashes([(np.array([10.01, 10.02, 5.0]), np.array([-110.0, -110.01, -60.0]), 4.0)])
    b = lightning.bin_flashes([(np.array([10.0]), np.array([-110.0]), 1.0)])
    merged = lightning.merge_satellites([a, b])
    assert merged[(100, -1100)] == [2, 1.0]
    assert merged[(50, -600)] == [1, 4.0]


def test_build_gathers_the_window_from_both_buckets():
    def listing(keys):
        return ("<ListBucketResult>" + "".join(f"<Key>{k}</Key>" for k in keys) + "</ListBucketResult>").encode()

    def key(sat, hhmm, ss="000"):
        return f"GLM-L2-LCFA/2026/294/{hhmm[:2]}/OR_GLM-L2-LCFA_{sat}_s2026294{hhmm}{ss}_e0_c0.nc"

    files = {
        "noaa-goes19": [key("G19", "2125"), key("G19", "2159", "400"), key("G19", "2129")],  # 21:29 is outside 30 min
        "noaa-goes18": [key("G18", "2150")],
    }

    def get(url):
        bucket = url.split("//")[1].split(".")[0]
        if "list-type=2" in url:
            return listing(files[bucket] if "/294/21/" in url else [])
        if "_s20262942159" in url:
            return glm_file([10.0, 10.0], [-60.0, -60.0], [0, 0])
        if "_s20262942150" in url:
            return glm_file([10.0, 40.0], [-60.0, -120.0], [0, 0])
        raise AssertionError(url)

    m = lightning.build(get, NOW)
    assert m["satellites"] == ["GOES-19", "GOES-18"]
    assert m["files"] == 2
    rows = [m["data"][i : i + 4] for i in range(0, len(m["data"]), 4)]
    assert rows == [[100, -600, 2, 0], [400, -1200, 1, 10]]
    assert m["flashes"] == 3


# ---- GDACS events -----------------------------------------------------------------------

EVENTS = (FIX / "gdacs_events_fl_wf.json").read_text(encoding="utf-8")  # real list, 2026-10-21 (FL, TC, 2 WF)
VOLCANOES = (FIX / "gdacs_volcano_search.json").read_text(encoding="utf-8")  # real VO search (Kanlaon ×2, Taal)


def gdacs_get(url):
    if "EVENTS4APP" in url:
        return EVENTS
    if "SEARCH" in url and "eventlist=VO" in url:
        return VOLCANOES
    raise AssertionError(url)


def test_events_keep_floods_and_fires_and_skip_cyclones():
    m = events.build(gdacs_get, NOW)
    types = [e["type"] for e in m["events"]]
    assert "TC" not in types
    assert m["counts"] == {"FL": 1, "WF": 2, "VO": 2}
    fire = next(e for e in m["events"] if e["type"] == "WF")
    assert fire["areaHa"] == 7652  # largest first within an alert level
    assert fire["name"] == "Australia"
    flood = next(e for e in m["events"] if e["type"] == "FL")
    assert flood["name"] == "Italy" and "areaHa" not in flood


def test_one_marker_per_volcano_at_its_latest_eruption():
    m = events.build(gdacs_get, NOW)
    vo = [e for e in m["events"] if e["type"] == "VO"]
    assert [v["name"] for v in vo] == ["Kanlaon", "Taal"]  # Orange alerts sort first
    assert vo[0]["from"] == "2026-10-10T05:58:00.000Z"
    assert vo[0]["alert"] == "Orange"


def test_a_failed_volcano_search_keeps_the_rest():
    def get(url):
        if "SEARCH" in url:
            raise OSError("503")
        return EVENTS

    m = events.build(get, NOW)
    assert m["counts"]["VO"] == 0 and m["counts"]["WF"] == 2


def test_stale_events_are_dropped():
    m = events.build(gdacs_get, NOW + dt.timedelta(days=10))
    assert m["counts"]["FL"] == 0 and m["counts"]["WF"] == 0
