"""Build public/relief.webp, the terrain slopes the globe lights by the real Sun.

    python scripts/make-relief.py              (needs numpy, netCDF4 and Pillow — the pipeline's)
    python scripts/make-relief.py --nc FILE    from a local copy of the ETOPO file
    python scripts/make-relief.py --cache F.npy   keep the averaged grid (58 MB) for re-runs

Source: NOAA NCEI ETOPO 2022, 60 arc-second surface elevation (ice-sheet tops, lake
surfaces; public domain). Every second sample is read over OPeNDAP (~230 MB) and
averaged 2×2 down to 5400×2700 — the Blue Marble's grid, 4 arc-minutes, ~7.4 km a texel at
the equator.

Output: an RGB WebP (lossless) on that grid, north up, 180°W at the left edge.
  R = slope toward the east  (dz/dx, metres per metre)
  G = slope toward the north (dz/dy)
  B = land, 0 (water) … 255, softened over a texel at the coast — the globe takes land from
      the plain Blue Marble and water from the shaded one (see textures.ts, blendLand)
Each slope is stored as 127.5 + 127·sign(g)·sqrt(min(|g| / GMAX, 1)), which keeps fine
steps for the gentle slopes that cover most land (the smallest step is ~3e-5) while still
reaching the steepest 7 km-averaged walls. The shader decodes it the same way.

The sea floor is left flat: sunlight doesn't show it from space, and the ocean's look is
the Blue Marble's own. Land below sea level counts as sea level.
"""

import argparse
import math
from pathlib import Path

import numpy as np
from PIL import Image

OPENDAP = "https://www.ngdc.noaa.gov/thredds/dodsC/global/ETOPO2022/60s/60s_surface_elev_netcdf/ETOPO_2022_v1_60s_N90W180_surface.nc"
OUT = Path(__file__).resolve().parent.parent / "public" / "relief.webp"
W, H = 5400, 2700
GMAX = 0.5
EARTH_M = 6_371_000.0


def encode(g: np.ndarray) -> np.ndarray:
    e = np.sign(g) * np.sqrt(np.clip(np.abs(g) / GMAX, 0, 1))
    return np.clip(np.rint(127.5 + 127 * e), 0, 255).astype(np.uint8)


def decode(b: np.ndarray) -> np.ndarray:
    e = (b.astype(np.float64) - 127.5) / 127
    return np.sign(e) * e * e * GMAX


def read_elevation(nc_path: str | None) -> np.ndarray:
    """5400×2700 surface elevation (m), north row first."""
    from netCDF4 import Dataset

    ds = Dataset(nc_path or OPENDAP)
    z = ds.variables["z"]
    lat = ds.variables["lat"]
    rows, cols = z.shape
    assert (rows, cols) == (10800, 21600), z.shape
    south_first = float(lat[0]) < float(lat[-1])
    out = np.empty((H, W), np.float32)
    band = 270  # output rows per request (1080 source rows, every second one read)
    for r0 in range(0, H, band):
        n = min(band, H - r0)
        a = r0 * 4
        block = np.asarray(z[a : a + n * 4 : 2, ::2], dtype=np.float32)  # (2n, 10800)
        out[r0 : r0 + n] = block.reshape(n, 2, W, 2).mean(axis=(1, 3))
        print(f"  rows {r0 + n}/{H}", flush=True)
    ds.close()
    return out[::-1] if south_first else out


def slopes(z: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """East and north slopes (m/m) by central differences on the sphere; longitude wraps."""
    land = np.maximum(z, 0.0).astype(np.float64)
    step = math.radians(360 / W)  # = 180 / H
    lat = np.radians(90 - (np.arange(H) + 0.5) * 180 / H)
    dx = EARTH_M * step * np.maximum(np.cos(lat), 0.02)  # metres between columns, per row
    dy = EARTH_M * step
    gx = (np.roll(land, -1, axis=1) - np.roll(land, 1, axis=1)) / (2 * dx[:, None])
    up = np.vstack([land[:1], land[:-1]])  # the row to the north (edge rows repeat)
    down = np.vstack([land[1:], land[-1:]])
    gy = (up - down) / (2 * dy)
    # Sea and below-sea-level land stay flat (both ends at zero).
    flat = (land == 0) & (np.roll(land, 1, 1) == 0) & (np.roll(land, -1, 1) == 0) & (up == 0) & (down == 0)
    gx[flat] = 0
    gy[flat] = 0
    return gx, gy


def land_mask(z: np.ndarray) -> np.ndarray:
    """Land (above sea level) as 0–255, a 3×3 box blur softening the coast; longitude wraps."""
    land = (z > 0).astype(np.float64)
    soft = sum(np.roll(land, dx, axis=1) for dx in (-1, 0, 1)) / 3
    soft = (np.vstack([soft[:1], soft[:-1]]) + soft + np.vstack([soft[1:], soft[-1:]])) / 3
    return np.rint(soft * 255).astype(np.uint8)


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--nc", help="local ETOPO 2022 60s surface NetCDF instead of OPeNDAP")
    ap.add_argument("--cache", type=Path, help="keep (or reuse) the averaged 5400×2700 elevation grid here, .npy")
    ap.add_argument("--out", type=Path, default=OUT)
    args = ap.parse_args()
    if args.cache and args.cache.exists():
        print(f"elevation from {args.cache}")
        z = np.load(args.cache)
    else:
        print(f"reading ETOPO 2022 from {args.nc or 'NOAA OPeNDAP'} …")
        z = read_elevation(args.nc)
        if args.cache:
            np.save(args.cache, z)
    print(f"elevation {z.min():.0f} … {z.max():.0f} m")
    gx, gy = slopes(z)
    print(f"slopes: 99.9th percentile {np.percentile(np.hypot(gx, gy), 99.9):.3f}, max {np.hypot(gx, gy).max():.3f}")
    rgb = np.zeros((H, W, 3), np.uint8)
    rgb[..., 0] = encode(gx)
    rgb[..., 1] = encode(gy)
    rgb[..., 2] = land_mask(z)
    args.out.parent.mkdir(parents=True, exist_ok=True)
    Image.fromarray(rgb, "RGB").save(args.out, "WEBP", lossless=True, quality=100, method=6)
    print(f"wrote {args.out} ({args.out.stat().st_size / 1e6:.1f} MB)")


if __name__ == "__main__":
    main()
