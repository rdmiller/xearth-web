import datetime as dt

import numpy as np
import pytest

from xearth_clouds import convert

# 2026-10-21 18:00 UTC: the Sun is over ~10.5°S 94°W.
T = int(dt.datetime(2026, 10, 21, 18, tzinfo=dt.timezone.utc).timestamp())


def test_subsolar_point():
    lat, lon = convert.subsolar(T)
    assert lat == pytest.approx(-10.5, abs=0.4)
    assert lon == pytest.approx(-94.0, abs=0.5)
    # June solstice 2026 (USNO: 21 Jun 08:24 UTC): over the Tropic of Cancer.
    lat, _ = convert.subsolar(int(dt.datetime(2026, 6, 21, 8, 24, tzinfo=dt.timezone.utc).timestamp()))
    assert lat == pytest.approx(23.44, abs=0.3)


def scene(vis_value, surface_lum, rows=120, cols=240):
    """A plate-carrée mosaic over 60°S–60°N, 180°W–180°E with uniform visible brightness."""
    lat = np.linspace(60, -60, rows)
    lon = np.linspace(-180, 180, cols, endpoint=False)
    grey = np.full((rows, cols), float(vis_value), dtype=np.float32)
    vis = convert.Mosaic(grey=grey, lat=lat, lon=lon, time=T)
    surface = np.full((180, 360, 3), int(surface_lum * 255), dtype=np.uint8)
    return vis, surface


def at(m: convert.Mosaic, a: np.ndarray, lat: float, lon: float) -> float:
    i = np.abs(m.lat - lat).argmin()
    j = np.abs(((m.lon - lon + 180) % 360) - 180).argmin()
    return float(a[i, j])


def test_bright_cloud_over_dark_ocean_is_detected_by_day_only():
    vis, surface = scene(45, 0.08)  # clear dark ocean everywhere…
    # …with a bright low cloud deck off Peru (daytime) and another over the night side.
    for lat, lon in [(-20, -82), (10, 100)]:
        i = np.abs(vis.lat - lat).argmin()
        j = np.abs(vis.lon - lon).argmin()
        vis.grey[i - 3 : i + 4, j - 3 : j + 4] = 170
    ir_clear = np.zeros_like(vis.grey)
    a = convert.vis_alpha(vis, ir_clear, surface)
    assert at(vis, a, -20, -82) > 0.8  # IR would call this clear
    assert at(vis, a, -10, -40) == pytest.approx(0.0, abs=0.02)  # clear ocean stays clear
    assert at(vis, a, 10, 100) == 0.0  # night side: no visible contribution


def test_bright_surfaces_are_left_to_infrared():
    vis, surface = scene(150, 0.6)  # a bright desert / salt flat, IR-clear
    a = convert.vis_alpha(vis, np.zeros_like(vis.grey), surface)
    assert float(a.max()) == 0.0


def test_sunglint_is_suppressed():
    vis, surface = scene(45, 0.08)
    g = convert.glint_cos(vis)
    i, j = np.unravel_index(np.argmax(g), g.shape)
    vis.grey[max(i - 2, 0) : i + 3, max(j - 2, 0) : j + 3] = 170  # bright, but at the glint point
    a = convert.vis_alpha(vis, np.zeros_like(vis.grey), surface)
    assert a[i, j] < 0.1


def test_without_a_surface_map_it_is_infrared_only():
    vis, _ = scene(170, 0.08)
    lw = convert.Mosaic(grey=np.full_like(vis.grey, 60.0), lat=vis.lat, lon=vis.lon, time=T)
    ir_only = convert.to_alpha(lw.grey)
    np.testing.assert_array_equal(convert.cloud_alpha(lw, vis, None), ir_only)
