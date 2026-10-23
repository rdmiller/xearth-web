"""Publish the global winds from NOAA's GFS model: at 10 m, and the jet stream at 250 hPa.

NCEP runs the Global Forecast System four times a day (00, 06, 12, 18Z) on a 0.25° grid,
with hourly output, each run published ~3.5–5 h after its start. NOMADS's GRIB filter cuts
a file down to the fields asked for (~3 MB for the four here), but sends no CORS headers,
and the browser can't read GRIB anyway. So this takes the newest run's forecast for the
coming hour, smooths it to 0.5° and writes each level as an RGB PNG the browser can
decode: red = u (eastward), green = v (northward), 128 = calm, 1 and 255 = ∓`scale` m/s
(the level's strongest component), row 0 = 90°N, column 0 = 0°E; ~300 KB each.

    python -m xearth_clouds.winds --out web/public/winds
"""

from __future__ import annotations

import argparse
import datetime as dt
import json
import math
import os
import sys
import urllib.error
import urllib.parse
from pathlib import Path
from typing import Callable

import numpy as np
from PIL import Image

from . import grib
from .launches import iso
from .snowice import http_bytes

FILTER = "https://nomads.ncep.noaa.gov/cgi-bin/filter_gfs_0p25.pl"
MANIFEST = "latest.json"
# GRIB2 code table 4.2 (discipline 0, category 2: momentum): u and v components of wind.
U, V = 2, 3
# name → (NOMADS filter level, GRIB level type and value, label)
LEVELS = {
    "surface": ("lev_10_m_above_ground", 103, 10.0, "10 m"),
    "jet": ("lev_250_mb", 100, 25000.0, "250 hPa"),
}
CYCLE_H = 6
# GFS's 0.25° output is hourly to +120 h.
MAX_FORECAST_H = 120
# Runs to try, newest first: the newest is often still being published.
LOOKBACK = 4
# Images kept besides the newest, so a browser holding the previous manifest can still load its image.
KEEP = 2


def cycles(now: dt.datetime, lookback: int = LOOKBACK) -> list[dt.datetime]:
    """The last `lookback` GFS runs started at or before `now`, newest first."""
    start = now.replace(hour=now.hour - now.hour % CYCLE_H, minute=0, second=0, microsecond=0)
    return [start - dt.timedelta(hours=CYCLE_H * k) for k in range(lookback)]


def forecast_hour(cycle: dt.datetime, now: dt.datetime) -> int:
    """The forecast valid at the nearest hour to half an hour from now: the hourly pipeline
    runs at :50, so that's the hour the layer is mostly looked at in."""
    h = math.floor((now + dt.timedelta(minutes=30) - cycle).total_seconds() / 3600 + 0.5)
    return max(0, min(MAX_FORECAST_H, h))


def filter_url(cycle: dt.datetime, hour: int) -> str:
    q = {
        "dir": f"/gfs.{cycle:%Y%m%d}/{cycle:%H}/atmos",
        "file": f"gfs.t{cycle:%H}z.pgrb2.0p25.f{hour:03d}",
        "var_UGRD": "on",
        "var_VGRD": "on",
        **{lev: "on" for lev, *_ in LEVELS.values()},
    }
    return f"{FILTER}?{urllib.parse.urlencode(q)}"


def fetch(get: Callable[[str], bytes], now: dt.datetime) -> tuple[dt.datetime, int, list[grib.Field]]:
    """The newest run that has the hour wanted: (run start, forecast hour, its fields)."""
    for cycle in cycles(now):
        hour = forecast_hour(cycle, now)
        try:
            blob = get(filter_url(cycle, hour))
        except urllib.error.HTTPError as err:
            if err.code == 404:  # "Data file is not present": this run isn't out that far yet
                continue
            raise
        return cycle, hour, grib.decode(blob)
    raise RuntimeError(f"no GFS run of the last {LOOKBACK * CYCLE_H} h has the hour wanted")


def components(fields: list[grib.Field], level_type: int, level: float) -> tuple[grib.Field, grib.Field]:
    """The u and v fields at one level."""
    pick = {f.parameter: f for f in fields if f.discipline == 0 and f.category == 2 and f.level_type == level_type and f.level == level}
    if U not in pick or V not in pick:
        raise RuntimeError(f"GFS file has no u and v at level type {level_type}, {level:g}")
    return pick[U], pick[V]


def halve(a: np.ndarray) -> np.ndarray:
    """A global 0.25° grid (rows 90°N…90°S, columns from 0°E) at 0.5°: every other point,
    each the 1-2-1 weighted mean of its neighbours so nothing finer than 0.5° aliases."""
    a = a.astype(np.float64)
    a = 0.25 * np.roll(a, 1, axis=1) + 0.5 * a + 0.25 * np.roll(a, -1, axis=1)
    up = np.concatenate([a[:1], a[:-1]])
    down = np.concatenate([a[1:], a[-1:]])
    a = 0.25 * up + 0.5 * a + 0.25 * down
    return a[::2, ::2]


def encode(u: np.ndarray, v: np.ndarray) -> tuple[Image.Image, float]:
    """u in red and v in green, 128 = 0 and ±127 = ±scale; the scale (m/s) is the strongest component."""
    scale = float(np.ceil(max(np.abs(u).max(), np.abs(v).max(), 1.0)))
    q = lambda a: np.clip(np.rint(a / scale * 127) + 128, 1, 255).astype(np.uint8)
    rgb = np.stack([q(u), q(v), np.zeros(u.shape, np.uint8)], axis=-1)
    return Image.fromarray(rgb, "RGB"), scale


def strongest(u: np.ndarray, v: np.ndarray, lat0: float, lon0: float, step: float) -> dict:
    speed = np.hypot(u, v)
    r, c = np.unravel_index(int(np.argmax(speed)), speed.shape)
    lon = (lon0 + c * step + 180) % 360 - 180
    return {"speed": round(float(speed[r, c]), 1), "lat": round(lat0 - r * step, 2), "lon": round(lon, 2)}


def build(get: Callable[[str], bytes], now: dt.datetime | None = None) -> tuple[dict, dict[str, Image.Image]]:
    now = now or dt.datetime.now(dt.timezone.utc)
    _, _, fields = fetch(get, now)
    # The run and hour as the file has them.
    cycle, hour = fields[0].reference, fields[0].forecast_hours
    valid = cycle + dt.timedelta(hours=hour)
    stamp = f"{valid:%Y%m%dT%HZ}"
    levels, images = {}, {}
    grid = None
    for name, (_, level_type, level, label) in LEVELS.items():
        fu, fv = components(fields, level_type, level)
        if (fu.lat0, fu.lon0, fu.dlat, fu.dlon, fu.values.shape) != (90.0, 0.0, -0.25, 0.25, (721, 1440)):
            raise RuntimeError(f"unexpected GFS grid: {fu.values.shape} from {fu.lat0}, {fu.lon0}")
        u, v = halve(fu.values), halve(fv.values)
        grid = u.shape
        image, scale = encode(u, v)
        file = f"{name}-{stamp}.png"
        images[file] = image
        levels[name] = {
            "image": file,
            "label": label,
            "scale": scale,
            "max": strongest(u, v, 90.0, 0.0, 0.5),
            "mean": round(float(np.hypot(u, v).mean()), 1),
        }
    assert grid is not None
    manifest = {
        "generated": iso(now),
        "source": "NOAA/NCEP GFS 0.25°",
        "cycle": iso(cycle),
        "forecastHour": hour,
        "valid": iso(valid),
        "width": grid[1],
        "height": grid[0],
        "lat0": 90.0,
        "lon0": 0.0,
        "step": 0.5,
        "levels": levels,
    }
    return manifest, images


def write(out: Path, manifest: dict, images: dict[str, Image.Image], keep: int = KEEP) -> None:
    """Images first, the manifest last (atomically), then all but the newest `keep` sets go."""
    out.mkdir(parents=True, exist_ok=True)
    for file, image in images.items():
        tmp = out / (file + ".tmp")
        image.save(tmp, format="PNG", optimize=True)
        os.replace(tmp, out / file)
    tmp = out / (MANIFEST + ".tmp")
    tmp.write_text(json.dumps(manifest, separators=(",", ":")) + "\n", encoding="utf-8")
    os.replace(tmp, out / MANIFEST)
    for name in LEVELS:
        # The stamp sorts by time (YYYYMMDDTHHZ).
        for old in sorted(out.glob(f"{name}-*.png"), reverse=True)[keep:]:
            old.unlink()


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(prog="xearth_clouds.winds", description=__doc__.split("\n\n")[0])
    ap.add_argument("--out", type=Path, required=True)
    args = ap.parse_args(argv)
    manifest, images = build(http_bytes)
    write(args.out, manifest, images)
    sizes = ", ".join(f"{f} {(args.out / f).stat().st_size // 1024} KB" for f in images)
    tops = ", ".join(f"{k} up to {v['max']['speed']} m/s" for k, v in manifest["levels"].items())
    print(f"wrote {args.out / MANIFEST}: GFS {manifest['cycle']} +{manifest['forecastHour']} h (valid {manifest['valid']}); {sizes}; {tops}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
