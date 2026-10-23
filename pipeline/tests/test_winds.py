import datetime as dt
import json
import urllib.error
import urllib.parse

import numpy as np
import pytest
from PIL import Image

from xearth_clouds import grib, winds

UTC = dt.timezone.utc


def at(h, m=0, day=23):
    return dt.datetime(2026, 10, day, h, m, tzinfo=UTC)


def test_cycles_newest_first_across_midnight():
    assert winds.cycles(at(2, 50)) == [at(0), at(18, day=22), at(12, day=22), at(6, day=22)]
    assert winds.cycles(at(18, 0))[0] == at(18)


def test_forecast_hour_is_the_coming_hour():
    # Run at 20:50 → valid 21Z: +9 h from 12Z, +3 h from 18Z.
    assert winds.forecast_hour(at(12), at(20, 50)) == 9
    assert winds.forecast_hour(at(18), at(20, 50)) == 3
    assert winds.forecast_hour(at(18), at(18, 10)) == 1
    assert winds.forecast_hour(at(18), at(18, 0)) == 1  # half past rounds up
    assert winds.forecast_hour(at(18), at(17, 59)) == 0
    assert winds.forecast_hour(at(0, day=1), at(0, day=23)) == winds.MAX_FORECAST_H


def test_filter_url():
    q = urllib.parse.parse_qs(urllib.parse.urlsplit(winds.filter_url(at(12), 9)).query)
    assert q["dir"] == ["/gfs.20261023/12/atmos"]
    assert q["file"] == ["gfs.t12z.pgrb2.0p25.f009"]
    assert {k for k, v in q.items() if v == ["on"]} == {"var_UGRD", "var_VGRD", "lev_10_m_above_ground", "lev_250_mb"}


def field(parameter, level_type, level, values):
    return grib.Field(0, 2, parameter, level_type, level, at(12), 9, 90.0, 0.0, -0.25, 0.25, values)


def gfs_fields(u10=5.0, v10=-2.0, u250=40.0, v250=10.0):
    full = lambda x: np.full((721, 1440), x, np.float32)
    return [
        field(2, 100, 25000.0, full(u250)),
        field(3, 100, 25000.0, full(v250)),
        field(2, 103, 10.0, full(u10)),
        field(3, 103, 10.0, full(v10)),
    ]


def test_fetch_falls_back_to_the_previous_run(monkeypatch):
    calls = []

    def get(url):
        calls.append(url)
        if "gfs.t18z" in url:
            raise urllib.error.HTTPError(url, 404, "Not Found", {}, None)
        return b"GRIB"

    monkeypatch.setattr(winds.grib, "decode", lambda blob: gfs_fields())
    cycle, hour, fields = winds.fetch(get, at(20, 50))
    assert (cycle, hour) == (at(12), 9)
    assert len(calls) == 2 and "gfs.t12z.pgrb2.0p25.f009" in calls[1]
    assert len(fields) == 4


def test_fetch_other_errors_are_not_swallowed():
    def get(url):
        raise urllib.error.HTTPError(url, 503, "busy", {}, None)

    with pytest.raises(urllib.error.HTTPError):
        winds.fetch(get, at(20, 50))


def test_halve_wraps_and_keeps_poles():
    a = np.zeros((721, 1440))
    a[:, 0] = 4.0  # a stripe along 0°E
    h = winds.halve(a)
    assert h.shape == (361, 720)
    # Each output column takes ¼ of each neighbour: 0°E keeps half; 359.5°E (column 719, from 1439) none.
    assert h[180, 0] == pytest.approx(2.0)
    assert h[180, 719] == pytest.approx(0.0)
    assert h[0, 0] == pytest.approx(2.0)  # the pole row reflects rather than reading past the edge
    b = np.arange(721.0)[:, None] * np.ones((1, 1440))
    assert winds.halve(b)[:, 3] == pytest.approx(np.r_[0.25, np.arange(2.0, 720, 2)[: 359], 719.75])


def test_encode_round_trips_to_within_a_step():
    rng = np.random.default_rng(1)
    u = rng.uniform(-30, 25, (361, 720))
    v = rng.uniform(-12, 18, (361, 720))
    image, scale = winds.encode(u, v)
    assert scale == 30.0
    px = np.asarray(image).astype(float)
    back_u = (px[..., 0] - 128) / 127 * scale
    back_v = (px[..., 1] - 128) / 127 * scale
    assert np.abs(back_u - u).max() <= scale / 127 / 2 + 1e-9
    assert np.abs(back_v - v).max() <= scale / 127 / 2 + 1e-9
    calm, _ = winds.encode(np.zeros((2, 2)), np.zeros((2, 2)))
    assert np.asarray(calm)[0, 0].tolist() == [128, 128, 0]


def test_build_and_write(monkeypatch, tmp_path):
    fields = gfs_fields()
    fields[2].values[200, 300] = 33.0  # one gust: 33 m/s east at 40°N, 75°E (row 200 = 40°N at 0.25°)
    monkeypatch.setattr(winds.grib, "decode", lambda blob: fields)

    def get(url):
        if "gfs.t18z" in url:
            raise urllib.error.HTTPError(url, 404, "Not Found", {}, None)
        return b"GRIB"

    manifest, images = winds.build(get, now=at(20, 50))
    assert manifest["cycle"] == "2026-10-23T12:00:00.000Z"
    assert manifest["valid"] == "2026-10-23T21:00:00.000Z"
    assert (manifest["width"], manifest["height"], manifest["lat0"], manifest["lon0"], manifest["step"]) == (720, 361, 90.0, 0.0, 0.5)
    surface, jet = manifest["levels"]["surface"], manifest["levels"]["jet"]
    assert surface["image"] == "surface-20261023T21Z.png" and jet["image"] == "jet-20261023T21Z.png"
    assert (surface["label"], jet["label"]) == ("10 m", "250 hPa")
    assert surface["max"]["lat"] == 40.0 and surface["max"]["lon"] == 75.0
    assert jet["scale"] == 40.0 and jet["max"]["speed"] == pytest.approx(41.2, abs=0.05)
    px = np.asarray(images[jet["image"]])
    assert px[100, 100].tolist() == [255, round(10 / 40 * 127) + 128, 0]

    # An older set is pruned once two newer ones exist.
    for stamp in ("20261023T19Z", "20261023T20Z"):
        for name in winds.LEVELS:
            Image.new("RGB", (1, 1)).save(tmp_path / f"{name}-{stamp}.png")
    winds.write(tmp_path, manifest, images)
    assert json.loads((tmp_path / "latest.json").read_text())["levels"]["surface"]["image"] == "surface-20261023T21Z.png"
    assert sorted(p.name for p in tmp_path.glob("*.png")) == [
        "jet-20261023T20Z.png",
        "jet-20261023T21Z.png",
        "surface-20261023T20Z.png",
        "surface-20261023T21Z.png",
    ]
    assert not list(tmp_path.glob("*.tmp"))
