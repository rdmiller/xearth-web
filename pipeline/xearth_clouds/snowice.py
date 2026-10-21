"""Publish today's snow and ice cover as an equirectangular texture.

  * Northern Hemisphere: NOAA/NESDIS IMS (Interactive Multisensor Snow and Ice
    Mapping System), the daily analysts' chart of snow on land and ice on sea
    and lakes, 4 km polar stereographic, via NSIDC (G02156).
  * Southern Hemisphere: IMS stops at the equator, so Antarctic sea ice comes
    from the NOAA/NSIDC Sea Ice Index daily concentration (G02135, 25 km
    passive microwave, a few days behind).

Output is an RGB PNG on the globe's grid (row 0 = 90°N, column 0 = 180°W):
red = snow on land (0/255), green = ice concentration (0–255), blue unused.

    python -m xearth_clouds.snowice --out web/public/snowice
"""

from __future__ import annotations

import argparse
import datetime as dt
import gzip
import io
import json
import os
import sys
import urllib.request
from pathlib import Path
from typing import Callable

import numpy as np
from PIL import Image

from .launches import USER_AGENT, iso

IMS_URL = "https://noaadata.apps.nsidc.org/NOAA/G02156/4km/{y}/ims{y}{doy:03d}_00UTC_4km_v1.3.asc.gz"
SEA_ICE_S_URL = "https://noaadata.apps.nsidc.org/NOAA/G02135/south/daily/geotiff/{y}/{m:02d}_{mon}/S_{ymd}_concentration_v4.0.tif"
MANIFEST = "latest.json"
IMAGE = "snowice.png"
WIDTH, HEIGHT = 4096, 2048
IMS_LOOKBACK_DAYS = 6
SEA_ICE_LOOKBACK_DAYS = 10

# IMS 4 km grid (Ims4km.gpd): polar stereographic on WGS84, true at 60°N,
# −80° pointing down the grid; 6144 cells of 4 km, upper-left corner at (−12288 km, 12288 km).
IMS = dict(a=6378137.0, b=6356752.314245, lat_ts=60.0, lon0=-80.0, x0=-12_288_000.0, y0=12_288_000.0, cell=4000.0, n=6144)
IMS_WATER, IMS_LAND, IMS_ICE, IMS_SNOW = 1, 2, 3, 4

# NSIDC sea-ice polar stereographic south (EPSG:3412): Hughes 1980 ellipsoid, true
# at 70°S, 0° pointing up the grid; 316 × 332 cells of 25 km, upper-left corner at (−3950 km, 4350 km).
NSIDC_S = dict(a=6378273.0, b=6356889.449, lat_ts=-70.0, lon0=0.0, x0=-3_950_000.0, y0=4_350_000.0, cell=25_000.0, cols=316, rows=332)
# Concentration is stored ×10 (0–1000); 2510+ flags pole hole, coast, land, missing.
SEA_ICE_MAX = 1000
ICE_MIN_CONC = 150  # 15 %, the usual ice-edge threshold
UPSAMPLE = 5


def http_bytes(url: str) -> bytes:
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(req, timeout=120) as resp:
        return resp.read()


# ---- projections ---------------------------------------------------------------------


def _t(phi: np.ndarray, e: float) -> np.ndarray:
    s = e * np.sin(phi)
    return np.tan(np.pi / 4 - phi / 2) / ((1 - s) / (1 + s)) ** (e / 2)


def polar_stereo(lat: np.ndarray, lon: np.ndarray, a: float, b: float, lat_ts: float, lon0: float) -> tuple[np.ndarray, np.ndarray]:
    """Ellipsoidal polar stereographic, standard parallel `lat_ts` (Snyder 21-33…21-40).

    North: x = ρ sin(λ−λ0), y = −ρ cos(λ−λ0). South: the mirror image, computed
    by flipping latitude and longitude, so y = +ρ cos(λ−λ0).
    """
    e = np.sqrt(1 - (b / a) ** 2)
    south = lat_ts < 0
    phi = np.radians(-lat if south else lat)
    phic = np.radians(abs(lat_ts))
    dlam = np.radians(lon - lon0) * (-1 if south else 1)
    mc = np.cos(phic) / np.sqrt(1 - (e * np.sin(phic)) ** 2)
    rho = a * mc * _t(phi, e) / _t(np.float64(phic), e)
    x = rho * np.sin(dlam)
    y = -rho * np.cos(dlam)
    return (-x, -y) if south else (x, y)


def grid_latlon(width: int = WIDTH, height: int = HEIGHT) -> tuple[np.ndarray, np.ndarray]:
    """Cell-centre latitude (rows, north first) and longitude (columns, from −180)."""
    lat = 90 - (np.arange(height) + 0.5) * 180 / height
    lon = -180 + (np.arange(width) + 0.5) * 360 / width
    return lat, lon


def sample(grid: np.ndarray, lat: np.ndarray, lon: np.ndarray, p: dict) -> np.ndarray:
    """Nearest-cell lookup of a polar grid at (lat, lon); outside the grid → 0."""
    x, y = polar_stereo(lat, lon, p["a"], p["b"], p["lat_ts"], p["lon0"])
    col = np.floor((x - p["x0"]) / p["cell"]).astype(np.int64)
    row = np.floor((p["y0"] - y) / p["cell"]).astype(np.int64)
    rows, cols = grid.shape
    inside = (col >= 0) & (col < cols) & (row >= 0) & (row < rows)
    out = np.zeros(lat.shape, dtype=grid.dtype)
    out[inside] = grid[row[inside], col[inside]]
    return out


# ---- IMS ------------------------------------------------------------------------------


def parse_ims(raw: bytes, n: int = IMS["n"]) -> np.ndarray:
    """IMS ASCII grid → (n, n) uint8 with row 0 at the top of the map (y = +12288 km).

    The file is a text header, then one line of n digits per row, starting at the
    lower-left corner — so the last line is the top row.
    """
    text = gzip.decompress(raw) if raw[:2] == b"\x1f\x8b" else raw
    rows = [ln for ln in text.split(b"\n") if len(ln.strip()) == n and ln.strip().isdigit()]
    if len(rows) != n:
        raise ValueError(f"IMS grid: expected {n} rows of {n} digits, found {len(rows)}")
    grid = np.frombuffer(b"".join(r.strip() for r in rows), dtype=np.uint8).reshape(n, n) - ord("0")
    return grid[::-1].copy()


def ims_layers(grid: np.ndarray, lat: np.ndarray, lon: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """Snow and ice (0/255 each) on the lat/lon grid, Northern Hemisphere rows only."""
    nh = lat > 0
    la, lo = np.meshgrid(lat[nh], lon, indexing="ij")
    cls = sample(grid, la, lo, IMS)
    snow = np.zeros((lat.size, lon.size), np.uint8)
    ice = np.zeros((lat.size, lon.size), np.uint8)
    snow[nh] = np.where(cls == IMS_SNOW, 255, 0)
    ice[nh] = np.where(cls == IMS_ICE, 255, 0)
    return snow, ice


# ---- Antarctic sea ice --------------------------------------------------------------------


def parse_sea_ice(raw: bytes) -> np.ndarray:
    """Sea Ice Index concentration GeoTIFF → (rows, cols) uint16, ×10 percent."""
    a = np.array(Image.open(io.BytesIO(raw)))
    if a.shape != (NSIDC_S["rows"], NSIDC_S["cols"]):
        raise ValueError(f"sea ice grid: unexpected shape {a.shape}")
    return a.astype(np.uint16)


def sea_ice_layer(conc: np.ndarray, lat: np.ndarray, lon: np.ndarray) -> np.ndarray:
    """Ice concentration 0–255 on the lat/lon grid, Southern Hemisphere rows only."""
    sh = lat < 0
    la, lo = np.meshgrid(lat[sh], lon, indexing="ij")
    # 25 km cells would show as blocks on a ~5 km texture: upsample bilinearly first
    # (flags → 0, so the ice fades out at the coast rather than smearing the flag value).
    clean = np.where(conc > SEA_ICE_MAX, 0, conc).astype(np.float32)
    k = UPSAMPLE
    fine = np.array(Image.fromarray(clean, "F").resize((clean.shape[1] * k, clean.shape[0] * k), Image.BILINEAR))
    c = sample(fine, la, lo, {**NSIDC_S, "cell": NSIDC_S["cell"] / k})
    c[c < ICE_MIN_CONC] = 0
    out = np.zeros((lat.size, lon.size), np.uint8)
    out[sh] = np.round(c * 255 / SEA_ICE_MAX).astype(np.uint8)
    return out


# ---- fetch + build ----------------------------------------------------------------------


def _latest(get: Callable[[str], bytes], urls: list[tuple[dt.date, str]]) -> tuple[dt.date, bytes] | None:
    for day, url in urls:
        try:
            return day, get(url)
        except Exception:  # not published yet (404): try the day before
            continue
    return None


def ims_urls(today: dt.date) -> list[tuple[dt.date, str]]:
    days = [today - dt.timedelta(days=i) for i in range(IMS_LOOKBACK_DAYS + 1)]
    return [(d, IMS_URL.format(y=d.year, doy=d.timetuple().tm_yday)) for d in days]


def sea_ice_urls(today: dt.date) -> list[tuple[dt.date, str]]:
    days = [today - dt.timedelta(days=i) for i in range(1, SEA_ICE_LOOKBACK_DAYS + 1)]
    return [
        (d, SEA_ICE_S_URL.format(y=d.year, m=d.month, mon=d.strftime("%b"), ymd=d.strftime("%Y%m%d")))
        for d in days
    ]


def build(get: Callable[[str], bytes], now: dt.datetime | None = None) -> tuple[dict, Image.Image]:
    now = now or dt.datetime.now(dt.timezone.utc)
    lat, lon = grid_latlon()
    rgb = np.zeros((HEIGHT, WIDTH, 3), np.uint8)
    sources = []
    manifest: dict = {"generated": iso(now), "image": IMAGE, "width": WIDTH, "height": HEIGHT}

    ims = _latest(get, ims_urls(now.date()))
    if ims is None:
        raise RuntimeError("no IMS snow and ice chart in the last week")
    snow, ice = ims_layers(parse_ims(ims[1]), lat, lon)
    rgb[..., 0] = snow
    rgb[..., 1] = ice
    manifest["ims"] = ims[0].isoformat()
    sources.append("NOAA/NESDIS IMS 4 km")

    sea = _latest(get, sea_ice_urls(now.date()))
    if sea is not None:
        rgb[..., 1] = np.maximum(rgb[..., 1], sea_ice_layer(parse_sea_ice(sea[1]), lat, lon))
        manifest["seaIceSouth"] = sea[0].isoformat()
        sources.append("NOAA/NSIDC Sea Ice Index (south)")
    else:
        print("snowice: no Antarctic sea-ice file in the last 10 days", file=sys.stderr)

    manifest["source"] = " + ".join(sources)
    manifest["snowFraction"] = round(float((snow > 0).mean()), 4)
    return manifest, Image.fromarray(rgb, "RGB")


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(prog="xearth_clouds.snowice", description=__doc__.split("\n\n")[0])
    ap.add_argument("--out", type=Path, required=True)
    args = ap.parse_args(argv)
    manifest, image = build(http_bytes)
    args.out.mkdir(parents=True, exist_ok=True)
    tmp = args.out / (IMAGE + ".tmp")
    image.save(tmp, format="PNG", optimize=True)
    os.replace(tmp, args.out / IMAGE)
    tmp = args.out / (MANIFEST + ".tmp")
    tmp.write_text(json.dumps(manifest, separators=(",", ":")) + "\n", encoding="utf-8")
    os.replace(tmp, args.out / MANIFEST)
    size = (args.out / IMAGE).stat().st_size
    print(f"wrote {args.out / IMAGE} ({size // 1024} KB): IMS {manifest['ims']}, south sea ice {manifest.get('seaIceSouth', 'none')}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
