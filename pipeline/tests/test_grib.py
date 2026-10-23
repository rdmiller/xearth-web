import datetime as dt
from pathlib import Path

import numpy as np
import pytest

from xearth_clouds import grib

FIXTURES = Path(__file__).parent / "fixtures"


def test_complex_packing_with_second_order_differencing():
    # GFS 1° 10 m v-wind (12Z 2026-10-23 +3 h) as NOMADS serves the whole globe: template 5.3,
    # spatial differencing order 2. Reference values from eccodes 2.50.
    (f,) = grib.decode((FIXTURES / "gfs_vgrd10m_2026102312_f003_1p00.grb2").read_bytes())
    assert (f.category, f.parameter, f.level_type, f.level) == (2, 3, 103, 10.0)
    assert f.reference == dt.datetime(2026, 10, 23, 12, tzinfo=dt.timezone.utc)
    assert f.forecast_hours == 3
    assert (f.lat0, f.lon0, f.dlat, f.dlon) == (90.0, 0.0, -1.0, 1.0)
    assert f.values.shape == (181, 360)
    v = f.values.ravel()
    assert v[0] == pytest.approx(2.73372, abs=1e-4)
    assert v[-1] == pytest.approx(-3.70628, abs=1e-4)
    assert v[90 * 360 + 180] == pytest.approx(-2.82628, abs=1e-4)
    assert float(v.astype(np.float64).sum()) == pytest.approx(14421.693, abs=0.05)


def test_simple_packing_south_first():
    # A NOMADS subregion (48–52°N, 350–355°E) comes back simple-packed, scanning south to north.
    fields = grib.decode((FIXTURES / "gfs_wind_2026102312_f003_sub.grb2").read_bytes())
    got = {(f.parameter, f.level_type, f.level): f for f in fields}
    want = {
        (2, 100, 25000.0): (38.04937, 21.44937, 43.04937, 14587.827),
        (3, 100, 25000.0): (-39.28534, -19.08534, -41.48534, -14443.466),
        (2, 103, 10.0): (11.09415, 12.63415, 13.73415, 4648.352),
        (3, 103, 10.0): (-5.05695, -8.14695, -5.77695, -2084.199),
    }
    assert set(got) == set(want)
    for key, (first, last, mid, total) in want.items():
        f = got[key]
        assert (f.lat0, f.lon0, f.dlat, f.dlon) == (48.0, 350.0, 0.25, 0.25)
        assert f.values.shape == (17, 21)
        v = f.values.ravel()
        assert v[0] == pytest.approx(first, abs=1e-4)
        assert v[-1] == pytest.approx(last, abs=1e-4)
        assert v[8 * 21 + 10] == pytest.approx(mid, abs=1e-4)
        assert float(v.astype(np.float64).sum()) == pytest.approx(total, abs=0.01)


def test_not_grib():
    with pytest.raises(ValueError, match="no GRIB message"):
        grib.decode(b"<html>Data file is not present</html>")
