"""Publish recent lightning from the GOES Geostationary Lightning Mappers.

GLM L2 "LCFA" files (one per 20 s per satellite) sit in NOAA's open buckets on
AWS. Those buckets don't send CORS headers, so the browser can't read them;
this gathers the last WINDOW_MIN minutes from GOES-East (GOES-19) and
GOES-West (GOES-18), keeps flashes that pass quality control, and merges
them into 0.1° cells: flash count and minutes since the latest one.

The two satellites overlap over the eastern Pacific and western Americas. A
flash seen by both would count twice, so each cell takes the larger of the
two satellites' counts rather than their sum.

Coverage is the Americas, the Atlantic and the eastern Pacific, to about
±55° latitude — GLM doesn't see Europe, Africa or Asia.

    python -m xearth_clouds.lightning --out web/public/lightning
"""

from __future__ import annotations

import argparse
import datetime as dt
import json
import os
import re
import sys
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from typing import Callable, Iterable

import numpy as np

from .launches import USER_AGENT, iso

SATELLITES = {"GOES-19": "noaa-goes19", "GOES-18": "noaa-goes18"}
PRODUCT = "GLM-L2-LCFA"
WINDOW_MIN = 30
CELL_DEG = 0.1
MANIFEST = "latest.json"
FIELDS = ["lat_index", "lon_index", "flashes", "minutes_ago"]
WORKERS = 16
_START = re.compile(r"_s(\d{4})(\d{3})(\d{2})(\d{2})(\d{2})\d_")


def http_bytes(url: str) -> bytes:
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(req, timeout=60) as resp:
        return resp.read()


def file_start(key: str) -> dt.datetime | None:
    m = _START.search(key)
    if not m:
        return None
    y, doy, h, mi, s = (int(g) for g in m.groups())
    return dt.datetime(y, 1, 1, h, mi, s, tzinfo=dt.timezone.utc) + dt.timedelta(days=doy - 1)


def list_keys(get: Callable[[str], bytes], bucket: str, hour: dt.datetime) -> list[str]:
    prefix = f"{PRODUCT}/{hour:%Y}/{hour.timetuple().tm_yday:03d}/{hour:%H}/"
    xml = get(f"https://{bucket}.s3.amazonaws.com/?list-type=2&prefix={prefix}").decode("utf-8")
    return re.findall(r"<Key>([^<]+\.nc)</Key>", xml)


def recent_keys(get: Callable[[str], bytes], bucket: str, now: dt.datetime, window_min: int = WINDOW_MIN) -> list[tuple[str, dt.datetime]]:
    """Files whose 20 s scan started within the window (the hour folders it spans)."""
    since = now - dt.timedelta(minutes=window_min)
    hours = {since.replace(minute=0, second=0, microsecond=0), now.replace(minute=0, second=0, microsecond=0)}
    out = []
    for hour in sorted(hours):
        for key in list_keys(get, bucket, hour):
            t = file_start(key)
            if t and since <= t <= now:
                out.append((key, t))
    return sorted(out, key=lambda kt: kt[1])


def read_flashes(raw: bytes) -> tuple[np.ndarray, np.ndarray]:
    """Latitude and longitude of the flashes in one LCFA file that pass quality control."""
    import netCDF4

    with netCDF4.Dataset("glm.nc", memory=raw) as ds:
        lat = np.asarray(ds["flash_lat"][:], dtype=np.float64)
        lon = np.asarray(ds["flash_lon"][:], dtype=np.float64)
        good = np.asarray(np.ma.filled(ds["flash_quality_flag"][:], 1)) == 0
    return lat[good], lon[good]


def bin_flashes(batches: Iterable[tuple[np.ndarray, np.ndarray, float]], cell: float = CELL_DEG) -> dict[tuple[int, int], list[float]]:
    """(lat, lon, minutes_ago) batches → {(lat_i, lon_i): [count, minutes since the latest]}."""
    cells: dict[tuple[int, int], list[float]] = {}
    for lat, lon, age in batches:
        if not lat.size:
            continue
        keys = np.stack([np.round(lat / cell), np.round(lon / cell)], axis=1).astype(np.int32)
        uniq, counts = np.unique(keys, axis=0, return_counts=True)
        for (i, j), n in zip(uniq.tolist(), counts.tolist()):
            c = cells.get((i, j))
            if c is None:
                cells[(i, j)] = [n, age]
            else:
                c[0] += n
                c[1] = min(c[1], age)
    return cells


def merge_satellites(per_sat: list[dict[tuple[int, int], list[float]]]) -> dict[tuple[int, int], list[float]]:
    """Larger count per cell (overlap would otherwise double-count), most recent age."""
    out: dict[tuple[int, int], list[float]] = {}
    for cells in per_sat:
        for k, (n, age) in cells.items():
            c = out.get(k)
            if c is None:
                out[k] = [n, age]
            else:
                c[0] = max(c[0], n)
                c[1] = min(c[1], age)
    return out


def build(get: Callable[[str], bytes], now: dt.datetime | None = None, window_min: int = WINDOW_MIN) -> dict:
    now = now or dt.datetime.now(dt.timezone.utc)
    per_sat = []
    used = []
    files = 0
    newest: dt.datetime | None = None
    for name, bucket in SATELLITES.items():
        try:
            keys = recent_keys(get, bucket, now, window_min)
        except Exception as err:  # one satellite's bucket failing shouldn't drop the other
            print(f"lightning: {name} listing failed ({err})", file=sys.stderr)
            continue
        if not keys:
            print(f"lightning: {name} has no files in the last {window_min} min", file=sys.stderr)
            continue

        def download(kt: tuple[str, dt.datetime]) -> bytes | None:
            try:
                return get(f"https://{bucket}.s3.amazonaws.com/{kt[0]}")
            except Exception as err:
                print(f"lightning: skipped {kt[0]} ({err})", file=sys.stderr)
                return None

        # Downloads in parallel; parsing one file at a time. The netCDF/HDF5 C library
        # isn't thread-safe: reading files from several threads at once crashes the
        # process (SIGBUS in the Linux container).
        with ThreadPoolExecutor(WORKERS) as pool:
            raws = list(pool.map(download, keys))
        batches = []
        for (key, t), raw in zip(keys, raws):
            if raw is None:
                continue
            try:
                lat, lon = read_flashes(raw)
            except Exception as err:
                print(f"lightning: skipped {key} ({err})", file=sys.stderr)
                continue
            batches.append((lat, lon, max(0.0, (now - t).total_seconds() / 60)))
        per_sat.append(bin_flashes(batches))
        used.append(name)
        files += len(batches)
        newest = max(newest or keys[-1][1], keys[-1][1])
    cells = merge_satellites(per_sat)
    rows = [
        [k[0], k[1], min(int(v[0]), 65535), min(255, round(v[1]))]
        for k, v in sorted(cells.items())
    ]
    return {
        "generated": iso(now),
        "source": f"NOAA GOES GLM L2 ({', '.join(used) or 'unavailable'})",
        "satellites": used,
        "windowMin": window_min,
        "latest": iso(newest),
        "files": files,
        "cellDeg": CELL_DEG,
        "fields": FIELDS,
        "flashes": int(sum(r[2] for r in rows)),
        "count": len(rows),
        "data": [v for r in rows for v in r],
    }


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(prog="xearth_clouds.lightning", description=__doc__.split("\n\n")[0])
    ap.add_argument("--out", type=Path, required=True)
    ap.add_argument("--minutes", type=int, default=WINDOW_MIN, help="how far back to gather flashes")
    args = ap.parse_args(argv)
    manifest = build(http_bytes, window_min=args.minutes)
    if not manifest["satellites"]:
        print("lightning: no GLM data from either satellite", file=sys.stderr)
        return 1
    args.out.mkdir(parents=True, exist_ok=True)
    tmp = args.out / (MANIFEST + ".tmp")
    tmp.write_text(json.dumps(manifest, separators=(",", ":")) + "\n", encoding="utf-8")
    os.replace(tmp, args.out / MANIFEST)
    print(f"wrote {args.out / MANIFEST}: {manifest['flashes']} flashes from {manifest['files']} files -> {manifest['count']} cells")
    return 0


if __name__ == "__main__":
    sys.exit(main())
