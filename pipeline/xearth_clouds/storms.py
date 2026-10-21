"""Publish current tropical cyclones: position, intensity, past and forecast track.

  * GDACS (EU JRC) covers every basin: its event list gives each current
    cyclone, and the per-event geometry gives the track as segments, each
    tagged with its class (TD / TS / HU) and whether it is forecast.
    (JTWC is GDACS's source for West Pacific / Indian Ocean storms.)
  * NHC (Atlantic, East/Central Pacific) adds authoritative current intensity,
    pressure and motion. GDACS's "severity" is the peak over the forecast, so
    for NHC storms the current wind comes from NHC.

    python -m xearth_clouds.storms --out web/public/storms
"""

from __future__ import annotations

import argparse
import datetime as dt
import json
import math
import os
import sys
from pathlib import Path
from typing import Callable

from .launches import _get, iso, parse_time

GDACS_EVENTS = "https://www.gdacs.org/gdacsapi/api/events/geteventlist/EVENTS4APP"
NHC_STORMS = "https://www.nhc.noaa.gov/CurrentStorms.json"
MANIFEST = "latest.json"
KT_TO_KMH = 1.852
# An NHC storm and a GDACS centroid this close (degrees) are the same storm.
MATCH_DEG = 2.0
# Drop events GDACS hasn't updated for this long.
STALE = dt.timedelta(days=2)


def _segments(geometry: dict) -> list[list]:
    """Track segments: [lon1, lat1, lon2, lat2, class, forecast(0/1)]."""
    out = []
    for f in geometry.get("features", []):
        g, p = f.get("geometry") or {}, f.get("properties") or {}
        if g.get("type") != "LineString" or not str(p.get("Class", "")).startswith("Line_"):
            continue
        coords = g.get("coordinates") or []
        for a, b in zip(coords, coords[1:]):
            out.append([round(a[0], 2), round(a[1], 2), round(b[0], 2), round(b[1], 2), p.get("polygonlabel", ""), int(bool(p.get("forecast")))])
    return out


def _centroid(geometry: dict, fallback: list[float]) -> list[float]:
    for f in geometry.get("features", []):
        if (f.get("properties") or {}).get("Class") == "Point_Centroid":
            return [round(c, 2) for c in f["geometry"]["coordinates"][:2]]
    return fallback


def current_class(segments: list[list], pos: list[float]) -> str:
    """Class at the current position.

    GDACS lists segments grouped by class, not in time order, but they chain:
    the observed track ends at the current position and the forecast starts
    there. So take the observed segment ending nearest `pos` — or, with no
    observed track yet, the forecast segment starting nearest it.
    """

    def dist(lon: float, lat: float) -> float:
        return math.hypot(lon - pos[0], lat - pos[1])

    past = [s for s in segments if not s[5]]
    if past:
        return min(past, key=lambda s: dist(s[2], s[3]))[4]
    ahead = [s for s in segments if s[5]]
    return min(ahead, key=lambda s: dist(s[0], s[1]))[4] if ahead else ""


def gdacs_storms(get: Callable[[str], str], now: dt.datetime) -> list[dict]:
    events = json.loads(get(GDACS_EVENTS)).get("features", [])
    storms = []
    for ev in events:
        p = ev.get("properties") or {}
        if p.get("eventtype") != "TC" or str(p.get("iscurrent", "true")).lower() != "true":
            continue
        updated = parse_time((p.get("datemodified") or p.get("todate") or "").split("+")[0])
        if updated and now - updated > STALE:
            continue
        url = (p.get("url") or {}).get("geometry")
        geometry = json.loads(get(url)) if url else {}
        segs = _segments(geometry)
        pos = _centroid(geometry, (ev.get("geometry") or {}).get("coordinates", [0, 0])[:2])
        sev = p.get("severitydata") or {}
        storms.append(
            {
                "id": f"gdacs-{p.get('eventid')}",
                "name": (p.get("eventname") or p.get("name") or "").rsplit("-", 1)[0].title(),
                "source": p.get("source") or "GDACS",
                "alert": p.get("alertlevel", ""),
                "pos": pos,
                "cls": current_class(segs, pos),
                "peakWindKmh": round(float(sev["severity"])) if sev.get("severity") else None,
                "segments": segs,
                "updated": iso(updated),
            }
        )
    return storms


def merge_nhc(storms: list[dict], nhc: dict) -> list[dict]:
    """Attach NHC's current details to the matching GDACS storm (or add it alone)."""
    for s in nhc.get("activeStorms", []):
        lat, lon = s.get("latitudeNumeric"), s.get("longitudeNumeric")
        if lat is None or lon is None:
            continue
        details = {
            "name": s.get("name"),
            "classification": s.get("classification"),
            "windKmh": round(float(s["intensity"]) * KT_TO_KMH) if s.get("intensity") else None,
            "pressureMb": int(s["pressure"]) if s.get("pressure") else None,
            "movementDir": s.get("movementDir"),
            "movementKmh": round(float(s["movementSpeed"]) * 1.609) if s.get("movementSpeed") is not None else None,  # NHC JSON speed is mph
            "updated": s.get("lastUpdate"),
        }
        match = min(
            storms,
            key=lambda g: math.hypot(g["pos"][0] - lon, g["pos"][1] - lat),
            default=None,
        )
        if match and math.hypot(match["pos"][0] - lon, match["pos"][1] - lat) <= MATCH_DEG:
            match["nhc"] = details
            match["pos"] = [lon, lat]
        else:
            storms.append(
                {
                    "id": f"nhc-{s.get('id')}",
                    "name": (s.get("name") or "").title(),
                    "source": "NHC",
                    "alert": "",
                    "pos": [lon, lat],
                    "cls": "",
                    "peakWindKmh": None,
                    "segments": [],
                    "nhc": details,
                    "updated": s.get("lastUpdate"),
                }
            )
    return storms


def build(get: Callable[[str], str], now: dt.datetime | None = None) -> dict:
    now = now or dt.datetime.now(dt.timezone.utc)
    storms = gdacs_storms(get, now)
    try:
        storms = merge_nhc(storms, json.loads(get(NHC_STORMS)))
    except Exception as err:  # NHC outage shouldn't drop the GDACS storms
        print(f"storms: NHC unavailable ({err})", file=sys.stderr)
    return {"generated": iso(now), "source": "GDACS (EU JRC; JTWC/NHC); NOAA NHC", "storms": storms}


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(prog="xearth_clouds.storms", description=__doc__.split("\n\n")[0])
    ap.add_argument("--out", type=Path, required=True)
    args = ap.parse_args(argv)
    manifest = build(_get)
    args.out.mkdir(parents=True, exist_ok=True)
    tmp = args.out / (MANIFEST + ".tmp")
    tmp.write_text(json.dumps(manifest, separators=(",", ":")) + "\n", encoding="utf-8")
    os.replace(tmp, args.out / MANIFEST)
    print(f"wrote {args.out / MANIFEST}: {len(manifest['storms'])} storms")
    return 0


if __name__ == "__main__":
    sys.exit(main())
