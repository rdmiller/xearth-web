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


def clear_sky_baseline(grey: np.ndarray, percentile: float = 10.0, lift: float = BLOCK_LIFT) -> np.ndarray:
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
            block[i, j] = np.clip(p if np.isfinite(p) else floor, floor, floor + lift)
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


# ---- visible band (day side) --------------------------------------------------------
# Low, warm cloud (marine stratocumulus above all) is barely colder than the sea, so
# longwave IR misses much of it; in the GMGSI visible band it's plainly bright. But so
# are deserts, snow and sunglint, and a local percentile can't tell "bright because
# cloud" from "bright because desert" (it put cloud all down the Atacama). So the
# clear-sky reference is the surface itself: Blue Marble's cloud-free brightness.
#
# Each run calibrates a table from the scene: for every bin of (surface brightness ×
# sun height × geostationary satellite), the 20th percentile of visible brightness
# among pixels IR calls clear. Visible alpha is brightness above that expectation.
# Sunglint (ocean near the mirror direction from the Sun to the viewing satellite) is
# faded out, and the whole contribution fades as the Sun gets low.
#
# Over bright surfaces (deserts, salt flats, snow, ice) cloud and ground differ too
# little in this band for a scene-wide table to separate them: on 2026-10-21 18Z it
# put 0.6–0.9 "cloud" on the clear Altiplano and Salar de Uyuni. Low warm cloud — the
# thing IR misses — is an ocean and dark-land problem, and cloud over deserts is
# mostly cold convection IR already sees, so the visible band is used only where
# Blue Marble's surface is dark (luminance < ~0.22, gone by 0.32).

VIS_OFFSET = 14.0
VIS_SPAN = 70.0
DARK_SURFACE = (0.22, 0.32)  # visible band used fully below, not at all above
# Geostationary sub-satellite longitudes in the GMGSI mosaic (GOES-West, GOES-East,
# Meteosat 0°, Meteosat IODC, Himawari-9); each pixel is credited to the nearest.
GEO_LONS = np.array([-137.0, -75.2, 0.0, 45.5, 140.7])
GEO_RADIUS = 6.61  # Earth radii
L_BINS = 16
MU_BINS = 12
MU_MIN = 0.08


def subsolar(t: int) -> tuple[float, float]:
    """Subsolar latitude/longitude (degrees) at Unix time t — NOAA's general solar
    position approximation, good to ~0.3°, ample for weighting by sun height."""
    import datetime as dt

    d = dt.datetime.fromtimestamp(t, dt.timezone.utc)
    year_days = 366 if d.year % 4 == 0 and (d.year % 100 != 0 or d.year % 400 == 0) else 365
    hours = d.hour + d.minute / 60 + d.second / 3600
    g = 2 * np.pi / year_days * (d.timetuple().tm_yday - 1 + (hours - 12) / 24)
    eqtime = 229.18 * (0.000075 + 0.001868 * np.cos(g) - 0.032077 * np.sin(g) - 0.014615 * np.cos(2 * g) - 0.040849 * np.sin(2 * g))
    decl = (
        0.006918 - 0.399912 * np.cos(g) + 0.070257 * np.sin(g) - 0.006758 * np.cos(2 * g)
        + 0.000907 * np.sin(2 * g) - 0.002697 * np.cos(3 * g) + 0.00148 * np.sin(3 * g)
    )
    lon = -15 * (hours - 12) - eqtime / 4
    return float(np.degrees(decl)), float((lon + 180) % 360 - 180)


def _unit(lat_deg: np.ndarray, lon_deg: np.ndarray) -> np.ndarray:
    la, lo = np.radians(lat_deg), np.radians(lon_deg)
    return np.stack(np.broadcast_arrays(np.cos(la) * np.cos(lo), np.cos(la) * np.sin(lo), np.sin(la)), axis=-1)


def cos_sun_zenith(mosaic: Mosaic) -> np.ndarray:
    """cos(solar zenith angle) on the mosaic grid at its scan time."""
    s_lat, s_lon = np.radians(subsolar(mosaic.time))
    lat = np.radians(mosaic.lat)[:, None]
    lon = np.radians(mosaic.lon)[None, :]
    return np.sin(lat) * np.sin(s_lat) + np.cos(lat) * np.cos(s_lat) * np.cos(lon - s_lon)


def nearest_satellite(lon: np.ndarray) -> np.ndarray:
    """Index into GEO_LONS of the satellite nearest each longitude."""
    d = np.abs(((lon[..., None] - GEO_LONS) + 180) % 360 - 180)
    return np.argmin(d, axis=-1)


def glint_cos(mosaic: Mosaic) -> np.ndarray:
    """cos of the angle between the Sun and the mirror reflection of the satellite's view."""
    n = _unit(mosaic.lat[:, None], mosaic.lon[None, :])
    sat_lon = GEO_LONS[nearest_satellite(mosaic.lon)][None, :]
    sat = GEO_RADIUS * _unit(np.zeros_like(sat_lon), sat_lon)
    v = sat - n
    v /= np.linalg.norm(v, axis=-1, keepdims=True)
    r = 2 * np.sum(n * v, axis=-1, keepdims=True) * n - v
    s_lat, s_lon = subsolar(mosaic.time)
    sun = _unit(np.array(s_lat), np.array(s_lon))
    return np.sum(r * sun, axis=-1)


def surface_brightness(mosaic: Mosaic, surface_rgb: np.ndarray) -> np.ndarray:
    """Blue Marble luminance (0–1) sampled at each mosaic pixel (nearest texel)."""
    h, w = surface_rgb.shape[:2]
    rows = np.clip(((90 - mosaic.lat) / 180 * h).astype(int), 0, h - 1)
    cols = np.clip((((mosaic.lon + 180) % 360) / 360 * w).astype(int), 0, w - 1)
    rgb = surface_rgb[rows[:, None], cols[None, :]].astype(np.float32) / 255
    return 0.2126 * rgb[..., 0] + 0.7152 * rgb[..., 1] + 0.0722 * rgb[..., 2]


def load_surface(path: str) -> np.ndarray:
    from PIL import Image

    return np.asarray(Image.open(path).convert("RGB"))


def clear_sky_table(vis: np.ndarray, L: np.ndarray, mu: np.ndarray, sat: np.ndarray, ir_clear: np.ndarray, step: int = 4):
    """20th-percentile visible brightness per (satellite, surface bin, sun bin) among IR-clear pixels.

    Bins with too few samples fall back to the same bin across all satellites, then to
    the nearest filled sun bin, so the table is always complete.
    """
    sl = (slice(None, None, step), slice(None, None, step))
    v, l, m, sa, ok = vis[sl], L[sl], mu[sl], sat[sl], ir_clear[sl] & np.isfinite(vis[sl]) & (mu[sl] > MU_MIN)
    li = np.clip((l * L_BINS).astype(int), 0, L_BINS - 1)
    mi = np.clip(((m - MU_MIN) / (1 - MU_MIN) * MU_BINS).astype(int), 0, MU_BINS - 1)
    table = np.full((len(GEO_LONS), L_BINS, MU_BINS), np.nan)
    pooled = np.full((L_BINS, MU_BINS), np.nan)
    for a in range(L_BINS):
        for b in range(MU_BINS):
            sel = ok & (li == a) & (mi == b)
            if sel.sum() >= 200:
                pooled[a, b] = np.percentile(v[sel], 20)
            for k in range(len(GEO_LONS)):
                ks = sel & (sa == k)
                if ks.sum() >= 200:
                    table[k, a, b] = np.percentile(v[ks], 20)
    # Fill gaps: pooled across satellites, then nearest sun bin, then the global median.
    for a in range(L_BINS):
        row = pooled[a]
        if np.isfinite(row).any():
            idx = np.flatnonzero(np.isfinite(row))
            pooled[a] = np.interp(np.arange(MU_BINS), idx, row[idx])
    pooled = np.where(np.isfinite(pooled), pooled, np.nanmedian(pooled) if np.isfinite(pooled).any() else 60.0)
    for k in range(len(GEO_LONS)):
        table[k] = np.where(np.isfinite(table[k]), table[k], pooled)
    return table


def vis_alpha(vis: Mosaic, ir_alpha: np.ndarray, surface_rgb: np.ndarray) -> np.ndarray:
    """Cloud opacity from the visible band; 0 where dark, glinting, or no data."""
    mu = cos_sun_zenith(vis)
    L = surface_brightness(vis, surface_rgb)
    sat = np.broadcast_to(nearest_satellite(vis.lon)[None, :], vis.grey.shape)
    table = clear_sky_table(vis.grey, L, mu, sat, np.nan_to_num(ir_alpha, nan=1.0) < 0.05)
    li = np.clip((L * L_BINS).astype(int), 0, L_BINS - 1)
    mi = np.clip(((mu - MU_MIN) / (1 - MU_MIN) * MU_BINS).astype(int), 0, MU_BINS - 1)
    clear = table[sat, li, mi]
    a = np.clip((vis.grey - clear - VIS_OFFSET) / VIS_SPAN, 0.0, 1.0) ** 0.9
    sun = np.clip((mu - MU_MIN) / (0.3 - MU_MIN), 0.0, 1.0)
    sun = sun * sun * (3 - 2 * sun)  # none below ~85° zenith, full above ~17° elevation
    ocean = L < 0.18
    g = np.clip((glint_cos(vis) - np.cos(np.radians(30))) / (np.cos(np.radians(12)) - np.cos(np.radians(30))), 0.0, 1.0)
    glint = np.where(ocean, 1.0 - g * g * (3 - 2 * g), 1.0)  # fade out within ~12–30° of the glint
    d = np.clip((L - DARK_SURFACE[0]) / (DARK_SURFACE[1] - DARK_SURFACE[0]), 0.0, 1.0)
    dark = 1.0 - d * d * (3 - 2 * d)  # bright surfaces: leave it to IR
    return np.nan_to_num(a * sun * glint * dark, nan=0.0).astype(np.float32)


def cloud_alpha(lw: Mosaic, vis: Mosaic | None = None, surface_rgb: np.ndarray | None = None) -> np.ndarray:
    """IR alpha everywhere, raised to the visible-band alpha by day where that's higher.

    Without a surface map there is no trustworthy clear-sky reference for the visible
    band (deserts would read as cloud), so it is IR only.
    """
    alpha = to_alpha(lw.grey)
    if vis is None or surface_rgb is None or vis.grey.shape != lw.grey.shape:
        return alpha
    # IR's NaN (no data) is kept, so the polar fill still knows where coverage ends.
    return np.where(np.isfinite(alpha), np.maximum(alpha, vis_alpha(vis, alpha, surface_rgb)), alpha).astype(np.float32)


def cloud_map(
    mosaic: Mosaic,
    width: int = OUT_WIDTH,
    height: int = OUT_HEIGHT,
    vis: Mosaic | None = None,
    surface_rgb: np.ndarray | None = None,
) -> np.ndarray:
    """Full conversion: mosaic(s) → equirectangular uint8 alpha (0 clear, 255 opaque)."""
    alpha = cloud_alpha(mosaic, vis, surface_rgb)
    eq, covered = reproject(mosaic, alpha, width, height)
    eq = fill_poles(eq, covered)
    return np.clip(np.round(eq * 255.0), 0, 255).astype(np.uint8)
