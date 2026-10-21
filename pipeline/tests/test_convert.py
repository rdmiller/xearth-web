import json
import math

import numpy as np
import pytest
from PIL import Image

from xearth_clouds import convert, fetch, publish


def mercator_mosaic(rows=300, cols=500, lat_max=72.7, fill=60.0):
    """A synthetic GMGSI-shaped mosaic: Mercator rows, column 0 at +180."""
    y_max = math.log(math.tan(math.pi / 4 + math.radians(lat_max) / 2))
    ys = np.linspace(y_max, -y_max, rows)
    lat = np.degrees(2 * np.arctan(np.exp(ys)) - math.pi / 2)
    lon = -180.0 + np.arange(cols) * 360.0 / cols
    lon[0] = 179.9996  # GMGSI stores the first column as +180
    grey = np.full((rows, cols), fill, dtype=np.float32)
    return convert.Mosaic(grey=grey, lat=lat, lon=lon, time=1_792_594_800)


def test_reproject_puts_a_feature_at_its_lat_lon():
    m = mercator_mosaic()
    field = np.zeros_like(m.grey)
    i = np.abs(m.lat - 30.0).argmin()
    j = np.abs(m.lon - 45.0).argmin()
    field[i - 2 : i + 3, j - 2 : j + 3] = 1.0
    out, covered = convert.reproject(m, field, width=720, height=360)
    rr, cc = np.indices(out.shape)
    r = (rr * out).sum() / out.sum()
    c = (cc * out).sum() / out.sum()
    assert 90 - (r + 0.5) * 0.5 == pytest.approx(m.lat[i], abs=0.5)
    assert -180 + (c + 0.5) * 0.5 == pytest.approx(m.lon[j], abs=0.5)
    assert covered[180] and not covered[0] and not covered[-1]


def test_reproject_wraps_across_the_antimeridian():
    m = mercator_mosaic()
    field = np.zeros_like(m.grey)
    field[:, 0] = 1.0  # the +180 / -180 column
    out, _ = convert.reproject(m, field, width=720, height=360)
    mid = out[180]
    assert mid[0] > 0.2 and mid[-1] > 0.2  # both edges of the output see it
    assert mid[360] == 0.0


def test_clear_rows_are_transparent_and_cold_cloud_is_opaque():
    m = mercator_mosaic(fill=60.0)
    # Latitude-dependent clear sky (colder toward the poles) must still read clear.
    m.grey += np.abs(m.lat)[:, None].astype(np.float32)
    m.grey[140:160, 200:260] = 230.0  # deep convective tops
    a = convert.to_alpha(m.grey)
    assert np.nanmax(a[:100]) == pytest.approx(0.0, abs=1e-6)
    assert a[150, 230] == pytest.approx(1.0)


def test_hot_desert_does_not_turn_clear_ocean_grey():
    m = mercator_mosaic(fill=70.0)  # clear ocean
    m.grey[100:130, 0:150] = 45.0  # a hot desert occupying part of those rows
    a = convert.to_alpha(m.grey)
    assert float(np.nanmax(a[100:130, 300:])) < 0.05


def test_no_data_rows_are_filled_without_a_seam():
    m = mercator_mosaic()
    m.grey[:20] = np.nan  # ragged no-data at the north edge
    alpha = convert.to_alpha(m.grey)
    eq, covered = convert.reproject(m, alpha, width=720, height=360)
    filled = convert.fill_poles(eq, covered)
    assert np.isfinite(filled).all()
    edge = np.flatnonzero(covered)[0]
    assert abs(float(filled[edge].mean() - filled[edge - 1].mean())) < 0.05


def test_cloud_map_is_uint8_equirectangular():
    m = mercator_mosaic()
    out = convert.cloud_map(m, width=360, height=180)
    assert out.dtype == np.uint8 and out.shape == (180, 360)


def test_publish_writes_image_then_manifest_and_prunes(tmp_path):
    alpha = np.zeros((90, 180), dtype=np.uint8)
    alpha[40:50, 80:100] = 255
    for hour in range(5):
        man = publish.publish(
            alpha, tmp_path, time=1_792_594_800 + hour * 3600, source_key=f"k{hour}", coverage=(-72.7, 72.7)
        )
    assert json.loads((tmp_path / "latest.json").read_text())["url"] == man["url"]
    assert man["t"] == "2026-10-21T19:00:00Z"
    assert len(list(tmp_path.glob("clouds-*.webp"))) == 3
    img = np.asarray(Image.open(tmp_path / man["url"]).convert("L"))
    assert img.shape == (90, 180) and img[45, 90] > 200 and img[10, 10] < 20


def test_scan_start_parses_gmgsi_names():
    key = "GMGSI_LW/2026/10/21/15/GLOBCOMPLIR_v3r0_blend_s202610211500000_e202610211509599_c202610211535478.nc"
    t = fetch.scan_start(key)
    assert (t.year, t.month, t.day, t.hour, t.minute) == (2026, 10, 21, 15, 0)
    assert fetch.scan_start("index.html") is None
