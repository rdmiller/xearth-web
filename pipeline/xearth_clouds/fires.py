"""Publish the last 24 h of active fires from NASA FIRMS (VIIRS), compacted.

The FIRMS global 24-hour CSVs (NOAA-20 and NOAA-21 VIIRS, 375 m) are ~10 MB
and ~120,000 detections each. Low-confidence detections are dropped and the
rest merged into 0.05° cells (about 5 km): total fire radiative power, the
detection count, and hours since the latest one. That keeps the file small
enough for every page load while still placing each fire within a pixel at
globe scale.

    python -m xearth_clouds.fires --out web/public/fires
"""

from __future__ import annotations

import argparse
import csv
import datetime as dt
import io
import json
import os
import sys
from pathlib import Path
from typing import Callable, Iterable

from .launches import _get, iso

FIRMS = "https://firms.modaps.eosdis.nasa.gov/data/active_fire/"
SOURCES = {
    "NOAA-20": "noaa-20-viirs-c2/csv/J1_VIIRS_C2_Global_24h.csv",
    "NOAA-21": "noaa-21-viirs-c2/csv/J2_VIIRS_C2_Global_24h.csv",
}
CELL_DEG = 0.05
MANIFEST = "latest.json"
FIELDS = ["lat_index", "lon_index", "frp_mw_x10", "hours_ago", "detections"]


def rows(text: str) -> Iterable[dict]:
    return csv.DictReader(io.StringIO(text))


def acquired(row: dict) -> dt.datetime | None:
    try:
        t = row["acq_time"].zfill(4)
        return dt.datetime.strptime(f"{row['acq_date']} {t}", "%Y-%m-%d %H%M").replace(tzinfo=dt.timezone.utc)
    except (KeyError, ValueError):
        return None


def aggregate(detections: Iterable[dict], now: dt.datetime, cell: float = CELL_DEG) -> list[list[int]]:
    """Merge detections into cells: [lat_index, lon_index, frp×10, hours_ago, count]."""
    cells: dict[tuple[int, int], list[float]] = {}
    for r in detections:
        if r.get("confidence", "").lower().startswith("l"):  # VIIRS: low / nominal / high
            continue
        try:
            lat, lon, frp = float(r["latitude"]), float(r["longitude"]), float(r.get("frp") or 0)
        except (KeyError, ValueError):
            continue
        t = acquired(r)
        age = (now - t).total_seconds() / 3600 if t else 24
        key = (round(lat / cell), round(lon / cell))
        c = cells.get(key)
        if c is None:
            cells[key] = [frp, age, 1]
        else:
            c[0] += frp
            c[1] = min(c[1], age)
            c[2] += 1
    return [
        [k[0], k[1], min(round(v[0] * 10), 2**31 - 1), max(0, min(255, round(v[1]))), min(255, int(v[2]))]
        for k, v in sorted(cells.items())
    ]


def build(get: Callable[[str], str], now: dt.datetime | None = None) -> dict:
    now = now or dt.datetime.now(dt.timezone.utc)
    detections: list[dict] = []
    used = []
    for name, path in SOURCES.items():
        try:
            detections.extend(rows(get(FIRMS + path)))
            used.append(name)
        except Exception as err:  # one satellite's file missing shouldn't drop the other
            print(f"fires: {name} unavailable ({err})", file=sys.stderr)
    cells = aggregate(detections, now)
    return {
        "generated": iso(now),
        "source": f"NASA FIRMS VIIRS 375 m, last 24 h ({', '.join(used)})",
        "cellDeg": CELL_DEG,
        "fields": FIELDS,
        "detections": len(detections),
        "count": len(cells),
        "data": [v for c in cells for v in c],
    }


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(prog="xearth_clouds.fires", description=__doc__.split("\n\n")[0])
    ap.add_argument("--out", type=Path, required=True)
    args = ap.parse_args(argv)
    manifest = build(_get)
    args.out.mkdir(parents=True, exist_ok=True)
    tmp = args.out / (MANIFEST + ".tmp")
    tmp.write_text(json.dumps(manifest, separators=(",", ":")) + "\n", encoding="utf-8")
    os.replace(tmp, args.out / MANIFEST)
    print(f"wrote {args.out / MANIFEST}: {manifest['detections']} detections -> {manifest['count']} cells")
    return 0


if __name__ == "__main__":
    sys.exit(main())
