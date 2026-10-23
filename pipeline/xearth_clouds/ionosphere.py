"""Publish the ionosphere's total electron content from NOAA SWPC's GloTEC.

GloTEC assimilates GNSS ground stations and radio occultations into a global map of total
electron content (TEC, in TEC units, 10^16 electrons/m²) every 10 minutes, with its
anomaly against the recent norm. SWPC publishes each map as GeoJSON with CORS, but as
5,184 points with four variables each it's 2.5 MB, and served uncompressed: too much for
the browser every few minutes. So this reads the newest map and keeps a 72×72 grid of TEC
and anomaly in tenths of a TECU (~40 KB, ~15 KB gzipped).

    python -m xearth_clouds.ionosphere --out web/public/ionosphere
"""

from __future__ import annotations

import argparse
import datetime as dt
import json
import os
import sys
from pathlib import Path
from typing import Callable

from .launches import _get, iso

SWPC = "https://services.swpc.noaa.gov"
INDEX = f"{SWPC}/products/glotec/geojson_2d_urt.json"
MANIFEST = "latest.json"


def newest_frame(index: list[dict]) -> dict:
    """The index lists every frame of the last month or so: the newest by time_tag."""
    if not index:
        raise RuntimeError("GloTEC index is empty")
    return max(index, key=lambda e: e["time_tag"])


def grid(features: list[dict]) -> dict:
    """Points on a regular lon/lat grid → rows from north to south, each west to east."""
    lons = sorted({f["geometry"]["coordinates"][0] for f in features})
    lats = sorted({f["geometry"]["coordinates"][1] for f in features}, reverse=True)
    col = {v: i for i, v in enumerate(lons)}
    row = {v: i for i, v in enumerate(lats)}
    n = len(lons) * len(lats)
    tec: list[int | None] = [None] * n
    anomaly: list[int | None] = [None] * n
    for f in features:
        lon, lat = f["geometry"]["coordinates"][:2]
        p = f["properties"]
        i = row[lat] * len(lons) + col[lon]
        tec[i] = round(p["tec"] * 10) if p.get("tec") is not None else None
        anomaly[i] = round(p["anomaly"] * 10) if p.get("anomaly") is not None else None
    step = lambda vs: round(abs(vs[1] - vs[0]), 4) if len(vs) > 1 else 0
    return {
        "lon0": lons[0],
        "lat0": lats[0],
        "dlon": step(lons),
        "dlat": -step(lats),
        "nlon": len(lons),
        "nlat": len(lats),
        # Tenths of a TECU, north row first; null where GloTEC has no value.
        "tec": tec,
        "anomaly": anomaly,
    }


def build(get: Callable[[str], str], now: dt.datetime | None = None) -> dict:
    now = now or dt.datetime.now(dt.timezone.utc)
    frame = newest_frame(json.loads(get(INDEX)))
    data = json.loads(get(SWPC + frame["url"]))
    g = grid(data["features"])
    values = [v for v in g["tec"] if v is not None]
    return {
        "generated": iso(now),
        "source": "NOAA SWPC GloTEC",
        "time": data.get("time_tag") or frame["time_tag"],
        "cadenceMin": data.get("cadence", 10),
        "tecMax": max(values) / 10 if values else None,
        **g,
    }


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(prog="xearth_clouds.ionosphere", description=__doc__.split("\n\n")[0])
    ap.add_argument("--out", type=Path, required=True)
    args = ap.parse_args(argv)
    manifest = build(_get)
    args.out.mkdir(parents=True, exist_ok=True)
    tmp = args.out / (MANIFEST + ".tmp")
    tmp.write_text(json.dumps(manifest, separators=(",", ":")) + "\n", encoding="utf-8")
    os.replace(tmp, args.out / MANIFEST)
    print(f"wrote {args.out / MANIFEST}: GloTEC {manifest['time']}, {manifest['nlon']}x{manifest['nlat']}, TEC up to {manifest['tecMax']} TECU")
    return 0


if __name__ == "__main__":
    sys.exit(main())
