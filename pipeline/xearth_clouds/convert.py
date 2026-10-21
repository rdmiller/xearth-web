"""Turn a GMGSI longwave-infrared mosaic into an equirectangular cloud-alpha map.

GMGSI_LW files (s3://noaa-gmgsi-pds/GMGSI_LW/) hold `data` as 0-255 grey
levels on a Mercator grid spanning roughly 72.7S..72.7N. Higher values are
colder, so cloud tops are bright and warm clear ground is dark.

A single fixed threshold doesn't work: clear-sky surface temperature falls with
latitude (row 5th percentile ~44 in the subtropics, ~140 near 70N), so a
threshold that keeps polar ground clear erases tropical cumulus. A per-row
baseline isn't enough either: hot deserts drag a whole row's percentile down,
leaving clear ocean at that latitude as grey haze in horizontal bands. So the
clear-sky baseline is estimated locally (a low percentile per block of a few
degrees), clamped to sit no more than `BLOCK_LIFT` above the row's own baseline
so a fully overcast block can't declare its own cloud "clear", then smoothed.
"""

from __future__ import annotations

import warnings
from dataclasses import dataclass

import numpy as np

OUT_WIDTH = 4096
OUT_HEIGHT = 2048

N_BLOCK_ROWS = 50  # ~3 deg of latitude per block on the GMGSI Mercator grid
N_BLOCK_COLS = 24  # 15 deg of longitude
BLOCK_LIFT = 25.0  # max grey levels a block's baseline may sit above its row's
MIN_ROW_VALID = 0.98  # an output row counts as covered if this fraction has data


@dataclass
class Mosaic:
    """Source grid: grey[rows, cols], lat per row (descending), lon per col."""

    grey: np.ndarray
    lat: np.ndarray
    lon: np.ndarray
    time: int  # seconds since the Unix epoch, start of the scan

    @property
    def lat_range(self) -> tuple[float, float]:
        return float(self.lat.min()), float(self.lat.max())


def read_gmgsi(path: str) -> Mosaic:
    import netCDF4

    with netCDF4.Dataset(path) as ds:
        ds.set_auto_mask(False)
        grey = np.asarray(ds["data"][0], dtype=np.float32)
        lat = np.asarray(ds["lat"][:, 0], dtype=np.float64)
        lon = np.asarray(ds["lon"][0, :], dtype=np.float64)
        t = int(ds["time"][0])
        dqf = np.asarray(ds["dqf"][0]) if "dqf" in ds.variables else None
    grey[grey < 0] = np.nan  # _FillValue -9999
    if dqf is not None:
        # Off-disk / grazing-angle pixels poleward of ~60 deg are stored as 255
        # (reads as the coldest possible cloud) with dqf 20; dqf 0 is good data.
        grey[dqf != 0] = np.nan
    return Mosaic(grey=grey, lat=lat, lon=lon, time=t)


def _smooth_1d(a: np.ndarray, width: int, wrap: bool = False) -> np.ndarray:
    if width <= 1:
        return a
    k = np.ones(width) / width
    if wrap:
        pad = width
        ext = np.concatenate([a[-pad:], a, a[:pad]])
        return np.convolve(ext, k, mode="same")[pad:-pad]
    ext = np.pad(a, width // 2, mode="edge")
    return np.convolve(ext, k, mode="valid")[: a.size]


def _nanpercentile(a: np.ndarray, q: float, axis=None):
    # All-NaN slices (fill rows, off-disk blocks) are expected; callers replace
    # the resulting NaN with a fallback, so numpy's warning is just noise.
    with warnings.catch_warnings():
        warnings.simplefilter("ignore", RuntimeWarning)
        return np.nanpercentile(a, q, axis=axis)


def row_baseline(grey: np.ndarray, percentile: float = 5.0) -> np.ndarray:
    """Per-row clear-sky grey level, smoothed across ~2 deg of latitude."""
    base = _nanpercentile(grey, percentile, axis=1)
    base = np.where(np.isfinite(base), base, np.nanmedian(base))
    return _smooth_1d(base, max(1, grey.shape[0] // 75) | 1)


def _upsample_linear(grid: np.ndarray, shape: tuple[int, int], wrap_x: bool) -> np.ndarray:
    """Separable linear interpolation of block-centre values onto a full grid."""
    gh, gw = grid.shape
    h, w = shape
    ys = (np.arange(h) + 0.5) * gh / h - 0.5
    cols = np.stack([np.interp(ys, np.arange(gh), grid[:, j]) for j in range(gw)], axis=1)
    xs = (np.arange(w) + 0.5) * gw / w - 0.5
    if wrap_x:
        ext = np.concatenate([cols[:, -1:], cols, cols[:, :1]], axis=1)
        xp = np.arange(-1, gw + 1)
    else:
        ext, xp = cols, np.arange(gw)
    return np.stack([np.interp(xs, xp, ext[i]) for i in range(h)], axis=0)


def clear_sky_baseline(grey: np.ndarray, percentile: float = 10.0) -> np.ndarray:
    """Local clear-sky grey level for every pixel (see module docstring)."""
    h, w = grey.shape
    gh, gw = min(N_BLOCK_ROWS, h), min(N_BLOCK_COLS, w)
    row = row_baseline(grey)
    ry = np.linspace(0, h, gh + 1).astype(int)
    rx = np.linspace(0, w, gw + 1).astype(int)
    block = np.empty((gh, gw))
    for i in range(gh):
        band = grey[ry[i] : ry[i + 1]]
        floor = float(row[ry[i] : ry[i + 1]].mean())
        for j in range(gw):
            p = _nanpercentile(band[:, rx[j] : rx[j + 1]], percentile)
            block[i, j] = np.clip(p if np.isfinite(p) else floor, floor, floor + BLOCK_LIFT)
    # 3x3 box smoothing (wrapping in longitude) so block edges never show.
    padded = np.pad(block, ((1, 1), (0, 0)), mode="edge")
    padded = np.concatenate([padded[:, -1:], padded, padded[:, :1]], axis=1)
    smooth = sum(padded[dy : dy + gh, dx : dx + gw] for dy in range(3) for dx in range(3)) / 9.0
    return _upsample_linear(smooth, (h, w), wrap_x=True).astype(np.float32)


def to_alpha(
    grey: np.ndarray,
    *,
    offset: float = 14.0,
    span: float = 75.0,
    gamma: float = 0.9,
    cold_start: float = 180.0,
    cold_span: float = 45.0,
) -> np.ndarray:
    """Cloud opacity 0..1 from grey levels (higher = colder = more cloud).

    `offset` ignores noise and warm low haze just above the baseline; `span` is
    the excess that reaches full opacity. Very cold tops (deep convection) are
    forced opaque whatever the local baseline.
    """
    base = clear_sky_baseline(grey)
    rel = np.clip((grey - base - offset) / span, 0.0, 1.0) ** gamma
    cold = np.clip((grey - cold_start) / cold_span, 0.0, 1.0)
    return np.maximum(rel, cold).astype(np.float32)  # NaN (no data) propagates


def reproject(mosaic: Mosaic, field: np.ndarray, width: int = OUT_WIDTH, height: int = OUT_HEIGHT):
    """Bilinearly resample a source-grid field onto an equirectangular grid.

    Returns (out, covered). NaN (no data) in `field` stays NaN in `out`.
    `covered[row]` is True only for the contiguous band of output rows around
    the equator that lie inside the mosaic's latitude span AND are at least
    `MIN_ROW_VALID` valid — so a polar edge with ragged no-data patches is
    handed to `fill_poles` rather than shown as holes.
    """
    out_lat = 90.0 - (np.arange(height) + 0.5) * 180.0 / height
    out_lon = -180.0 + (np.arange(width) + 0.5) * 360.0 / width

    # Rows: source latitude descends; interp needs ascending x.
    rows = np.arange(mosaic.lat.size, dtype=np.float64)
    fy = np.interp(out_lat, mosaic.lat[::-1], rows[::-1])
    lat_lo, lat_hi = mosaic.lat_range
    covered = (out_lat >= lat_lo) & (out_lat <= lat_hi)

    # Columns: unwrap so longitude increases monotonically, then append the
    # first column at +360 so bilinear sampling wraps across the antimeridian.
    lon = np.unwrap(np.radians(mosaic.lon))
    lon = np.degrees(lon)
    lon = lon - 360.0 * np.floor((lon[0] + 180.0) / 360.0)
    lon_ext = np.concatenate([lon, [lon[0] + 360.0]])
    cols_ext = np.arange(lon_ext.size, dtype=np.float64)
    q = out_lon.copy()
    q[q < lon_ext[0]] += 360.0
    fx = np.interp(q, lon_ext, cols_ext)

    src = np.concatenate([field, field[:, :1]], axis=1)
    y0 = np.clip(np.floor(fy).astype(int), 0, field.shape[0] - 1)
    y1 = np.clip(y0 + 1, 0, field.shape[0] - 1)
    x0 = np.clip(np.floor(fx).astype(int), 0, src.shape[1] - 1)
    x1 = np.clip(x0 + 1, 0, src.shape[1] - 1)
    wy = (fy - y0)[:, None]
    wx = (fx - x0)[None, :]
    top = src[y0][:, x0] * (1 - wx) + src[y0][:, x1] * wx
    bot = src[y1][:, x0] * (1 - wx) + src[y1][:, x1] * wx
    out = (top * (1 - wy) + bot * wy).astype(np.float32)

    valid = covered & (np.isfinite(out).mean(axis=1) >= MIN_ROW_VALID)
    covered = np.zeros_like(valid)
    eq = height // 2
    if valid[eq]:
        lo = eq
        while lo > 0 and valid[lo - 1]:
            lo -= 1
        hi = eq
        while hi < height - 1 and valid[hi + 1]:
            hi += 1
        covered[lo : hi + 1] = True
    return out, covered


def fill_poles(
    alpha: np.ndarray,
    covered: np.ndarray,
    *,
    band_deg: float = 6.0,
    feather_deg: float = 6.0,
    decay_deg: float = 5.0,
    cap: float = 0.45,
) -> np.ndarray:
    """Extend cloud cover smoothly into the uncovered polar caps.

    There is no real data up there, and the last few degrees of coverage are
    seen by the geostationary satellites at grazing angles (limb-cooled, so they
    read too cold). The fill is therefore deliberately soft: the band near the
    edge is averaged per longitude, blurred hard along the parallel, capped at
    `cap`, and relaxed towards its own mean with distance from the edge. The
    last `feather_deg` of real data is cross-faded into it. The goal is "no
    hard seam, no fake detail", not a forecast.
    """
    h, w = alpha.shape
    deg_per_row = 180.0 / h
    band = max(1, int(round(band_deg / deg_per_row)))
    feather = max(1, int(round(feather_deg / deg_per_row)))
    alpha = np.where(covered[:, None], np.nan_to_num(alpha, nan=0.0), alpha)
    out = alpha.copy()
    idx = np.flatnonzero(covered)
    if idx.size == 0:
        return np.zeros_like(alpha)
    for edge, step in ((idx[0], -1), (idx[-1], 1)):
        rows = slice(edge, edge + band) if step == -1 else slice(edge - band + 1, edge + 1)
        profile = np.minimum(alpha[rows].mean(axis=0), cap)
        profile = _smooth_1d(_smooth_1d(profile, w // 8, wrap=True), w // 8, wrap=True)
        mean = float(profile.mean())
        r = edge + step
        while 0 <= r < h:
            k = np.exp(-abs(r - edge) * deg_per_row / decay_deg)
            out[r] = profile * k + mean * (1 - k)
            r += step
        for i in range(feather):
            r = edge - step * i
            t = 0.5 - 0.5 * np.cos(np.pi * i / feather)  # 0 at the edge → 1 inside
            out[r] = alpha[r] * t + profile * (1 - t)
    return out


def cloud_map(mosaic: Mosaic, width: int = OUT_WIDTH, height: int = OUT_HEIGHT) -> np.ndarray:
    """Full conversion: mosaic → equirectangular uint8 alpha (0 clear, 255 opaque)."""
    alpha = to_alpha(mosaic.grey)
    eq, covered = reproject(mosaic, alpha, width, height)
    eq = fill_poles(eq, covered)
    return np.clip(np.round(eq * 255.0), 0, 255).astype(np.uint8)
