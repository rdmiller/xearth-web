"""Publish today's smoke plumes from NOAA's Hazard Mapping System (HMS).

HMS analysts outline smoke on GOES imagery through the day, as polygons
classed Light, Medium or Heavy by how thick the smoke looks, over North
America. The day's KML grows as each
analysis is added. NOAA's server sends no CORS headers, so the browser can't
read it; this rasterises the polygons onto the globe's grid as a single-channel
PNG (row 0 = 90°N, column 0 = 180°W): 0 = none, 85 / 170 / 255 = Light / Medium
/ Heavy, where overlapping plumes take the densest, softened slightly at the
edges.

Early in the UTC day today's file doesn't exist yet (or has nothing in it), so
it falls back to yesterday's.

    python -m xearth_clouds.smoke --out web/public/smoke
"""

from __future__ import annotations

import argparse
import datetime as dt
import json
import os
import re
import sys
from pathlib import Path
from typing import Callable

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

from .launches import iso
from .snowice import http_bytes

HMS_URL = "https://satepsanone.nesdis.noaa.gov/pub/FIRE/web/HMS/Smoke_Polygons/KML/{y}/{m:02d}/hms_smoke{ymd}.kml"
MANIFEST = "latest.json"
IMAGE = "smoke.png"
WIDTH, HEIGHT = 4096, 2048
DENSITY = {"Light": 1, "Medium": 2, "Heavy": 3}
LEVEL = 85  # byte value per density step
BLUR_PX = 1.5

_PLACEMARK = re.compile(r"<Placemark>(.*?)</Placemark>", re.S)
_DESC = re.compile(r"Start Time:\s*(\d{7})\s*(\d{4})UTC.*?End Time:\s*(\d{7})\s*(\d{4})UTC.*?Density:\s*(\w+)(?:.*?Satellite:\s*([\w-]+))?", re.S)
_OUTER = re.compile(r"<outerBoundaryIs>.*?<coordinates>(.*?)</coordinates>", re.S)
_INNER = re.compile(r"<innerBoundaryIs>.*?<coordinates>(.*?)</coordinates>", re.S)


def _time(day: str, hhmm: str) -> dt.datetime:
    """'2026294', '1500' → 2026-10-21 15:00Z."""
    return dt.datetime(int(day[:4]), 1, 1, int(hhmm[:2]), int(hhmm[2:]), tzinfo=dt.timezone.utc) + dt.timedelta(days=int(day[4:]) - 1)


def _ring(text: str) -> list[tuple[float, float]]:
    pts = []
    for c in text.split():
        lon, lat = c.split(",")[:2]
        pts.append((float(lon), float(lat)))
    return pts


def parse_kml(text: str) -> list[dict]:
    """Each smoke polygon: density 1–3, start/end time, satellite, outer ring and holes ([lon, lat] lists)."""
    plumes = []
    for body in _PLACEMARK.findall(text):
        d = _DESC.search(body)
        outer = _OUTER.search(body)
        if not d or not outer or d.group(5) not in DENSITY:
            continue
        plumes.append(
            {
                "density": DENSITY[d.group(5)],
                "start": _time(d.group(1), d.group(2)),
                "end": _time(d.group(3), d.group(4)),
                "satellite": d.group(6) or "",
                "outer": _ring(outer.group(1)),
                "holes": [_ring(h) for h in _INNER.findall(body)],
            }
        )
    return plumes


def _px(ring: list[tuple[float, float]], width: int, height: int) -> list[tuple[float, float]]:
    return [((lon + 180) / 360 * width, (90 - lat) / 180 * height) for lon, lat in ring]


def rasterise(plumes: list[dict], width: int = WIDTH, height: int = HEIGHT) -> np.ndarray:
    """Density on the lat/lon grid (0, 85, 170, 255), densest plume wins, edges softened."""
    out = np.zeros((height, width), np.uint8)
    # One mask per density level (not per plume: there are hundreds, and each mask is 8 MB).
    for level in sorted(set(DENSITY.values())):
        mask = Image.new("L", (width, height), 0)
        draw = ImageDraw.Draw(mask)
        same = [p for p in plumes if p["density"] == level]
        for p in same:
            draw.polygon(_px(p["outer"], width, height), fill=255)
        for p in same:
            for hole in p["holes"]:
                draw.polygon(_px(hole, width, height), fill=0)
        out = np.maximum(out, (np.array(mask) > 0).astype(np.uint8) * (level * LEVEL))
    if BLUR_PX:
        out = np.array(Image.fromarray(out, "L").filter(ImageFilter.GaussianBlur(BLUR_PX)))
    return out


def kml_urls(today: dt.date) -> list[tuple[dt.date, str]]:
    return [(d, HMS_URL.format(y=d.year, m=d.month, ymd=d.strftime("%Y%m%d"))) for d in (today, today - dt.timedelta(days=1))]


def build(get: Callable[[str], bytes], now: dt.datetime | None = None) -> tuple[dict, Image.Image]:
    now = now or dt.datetime.now(dt.timezone.utc)
    day, plumes = None, []
    for d, url in kml_urls(now.date()):
        try:
            plumes = parse_kml(get(url).decode("utf-8", "replace"))
        except Exception:  # not published yet (404): try yesterday
            continue
        if plumes:
            day = d
            break
    if day is None:
        raise RuntimeError("no HMS smoke analysis for today or yesterday")
    grid = rasterise(plumes)
    counts = {name: sum(1 for p in plumes if p["density"] == v) for name, v in DENSITY.items()}
    manifest = {
        "generated": iso(now),
        "source": "NOAA/NESDIS Hazard Mapping System smoke analysis",
        "date": day.isoformat(),
        "image": IMAGE,
        "width": WIDTH,
        "height": HEIGHT,
        "plumes": counts,
        "latest": iso(max(p["end"] for p in plumes)),
    }
    return manifest, Image.fromarray(grid, "L")


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(prog="xearth_clouds.smoke", description=__doc__.split("\n\n")[0])
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
    c = manifest["plumes"]
    print(f"wrote {args.out / IMAGE} ({(args.out / IMAGE).stat().st_size // 1024} KB): {manifest['date']}, "
          f"{c['Light']} light / {c['Medium']} medium / {c['Heavy']} heavy plumes, analysis to {manifest['latest']}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
