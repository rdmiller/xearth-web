"""Publish the last day's meteors (Global Meteor Network) and recent fireballs (NASA/JPL CNEOS).

GMN's cameras triangulate every meteor two or more of them see, and publish each day's
trajectories: where it began and ended (latitude, longitude, height), its speed, its peak
brightness, and the shower it belongs to. Two files together cover the latest 24 hours or
so: "yesterday" (the last full day, a few hours behind) and "latest_daily" (what's come in
since). They're 5 MB of 86 columns; this keeps the ten the globe needs (~90 KB gzipped).

CNEOS lists fireballs that US government sensors saw from space: rare (a few a month), but
the big ones, with their energy. Its API sends no CORS headers, so it comes through here too.

    python -m xearth_clouds.meteors --out web/public/meteors
"""

from __future__ import annotations

import argparse
import datetime as dt
import gzip
import json
import os
import sys
import urllib.request
from pathlib import Path
from typing import Callable

from .launches import USER_AGENT, iso

GMN = "https://globalmeteornetwork.org/data/traj_summary_data/daily/"
GMN_FILES = ("traj_summary_yesterday.txt", "traj_summary_latest_daily.txt")
CNEOS = "https://ssd-api.jpl.nasa.gov/fireball.api"
MANIFEST = "latest.json"
WINDOW = dt.timedelta(hours=24)
FIREBALL_DAYS = 90
# Per meteor, in this order (the web app mirrors it).
FIELDS = ["t", "lat0", "lon0", "h0", "lat1", "lon1", "h1", "mag", "shower", "v"]
# Columns by their two header rows joined, as GMN names them.
COLUMNS = {
    "id": "Unique trajectory identifier",
    "time": "Beginning UTC Time",
    "shower": "IAU code",
    "lat0": "LatBeg +N deg",
    "lon0": "LonBeg +E deg",
    "h0": "HtBeg km",
    "lat1": "LatEnd +N deg",
    "lon1": "LonEnd +E deg",
    "h1": "HtEnd km",
    "mag": "Peak AbsMag",
    "v": "Vavg km/s",
}
SPORADIC = "..."


def _get(url: str) -> bytes:
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT, "Accept-Encoding": "gzip"})
    with urllib.request.urlopen(req, timeout=120) as resp:
        body = resp.read()
        return gzip.decompress(body) if resp.headers.get("Content-Encoding") == "gzip" else body


def header_names(lines: list[str]) -> list[str]:
    """GMN's column names: its first two '#' header rows after the summary line, joined."""
    rows = [l for l in lines if l.startswith("#") and ";" in l]
    if len(rows) < 2:
        raise ValueError("GMN file has no column header")
    a = [c.strip() for c in rows[0].lstrip("#").split(";")]
    b = [c.strip() for c in rows[1].lstrip("#").split(";")]
    return [f"{x} {y}".strip() for x, y in zip(a, b)]


def _num(s: str) -> float | None:
    try:
        v = float(s)
    except ValueError:
        return None
    return v if v == v else None  # NaN → None


def parse_gmn(text: str) -> list[dict]:
    """Rows → {id, time, shower, lat0, lon0, h0, lat1, lon1, h1, mag, v}; rows missing a position are dropped."""
    lines = text.splitlines()
    names = header_names(lines)
    idx = {k: names.index(v) for k, v in COLUMNS.items()}
    out = []
    for line in lines:
        if not line.strip() or line.startswith("#"):
            continue
        c = [x.strip() for x in line.split(";")]
        if len(c) < len(names) - 1:
            continue
        rec = {"id": c[idx["id"]], "shower": c[idx["shower"]]}
        try:
            rec["time"] = dt.datetime.fromisoformat(c[idx["time"]]).replace(tzinfo=dt.timezone.utc)
        except ValueError:
            continue
        for k in ("lat0", "lon0", "h0", "lat1", "lon1", "h1", "mag", "v"):
            rec[k] = _num(c[idx[k]])
        if any(rec[k] is None for k in ("lat0", "lon0", "h0", "lat1", "lon1", "h1")):
            continue
        out.append(rec)
    return out


def pack(meteors: list[dict], window: dt.timedelta = WINDOW) -> dict:
    """The `window` before the newest meteor, as flat integers, with a table of shower codes."""
    if not meteors:
        return {"from": None, "to": None, "showers": [], "counts": {}, "fields": FIELDS, "meteors": []}
    unique = {m["id"]: m for m in meteors}.values()
    newest = max(m["time"] for m in unique)
    start = newest - window
    kept = sorted((m for m in unique if m["time"] > start), key=lambda m: m["time"])
    counts: dict[str, int] = {}
    for m in kept:
        counts[m["shower"]] = counts.get(m["shower"], 0) + 1
    # Showers most numerous first, sporadic last; index into this list per meteor.
    codes = sorted((c for c in counts if c != SPORADIC), key=lambda c: -counts[c]) + ([SPORADIC] if SPORADIC in counts else [])
    index = {c: i for i, c in enumerate(codes)}
    flat: list[int] = []
    for m in kept:
        flat += [
            round((m["time"] - start).total_seconds()),
            round(m["lat0"] * 100),
            round(m["lon0"] * 100),
            round(m["h0"] * 10),
            round(m["lat1"] * 100),
            round(m["lon1"] * 100),
            round(m["h1"] * 10),
            round((m["mag"] if m["mag"] is not None else 2.0) * 10),
            index[m["shower"]],
            round((m["v"] or 0) * 10),
        ]
    return {
        "from": iso(start),
        "to": iso(newest),
        "showers": codes,
        "counts": counts,
        # t: seconds after `from`; lat/lon: hundredths of a degree; h: tenths of a km;
        # mag: tenths of a magnitude (2.0 when GMN has none); v: tenths of a km/s.
        "fields": FIELDS,
        "meteors": flat,
    }


def parse_fireballs(api: dict) -> list[dict]:
    """CNEOS rows → {time, lat, lon, alt, vel, energy, impactKt}; rows without a place are dropped."""
    fields = api.get("fields") or []
    out = []
    for row in api.get("data") or []:
        r = dict(zip(fields, row))
        if r.get("lat") is None or r.get("lon") is None:
            continue
        lat = float(r["lat"]) * (-1 if r.get("lat-dir") == "S" else 1)
        lon = float(r["lon"]) * (-1 if r.get("lon-dir") == "W" else 1)
        out.append(
            {
                "time": r["date"].replace(" ", "T") + "Z",
                "lat": lat,
                "lon": lon,
                "alt": float(r["alt"]) if r.get("alt") else None,
                "vel": float(r["vel"]) if r.get("vel") else None,
                # Radiated energy (10^10 J) and the estimated impact energy (kilotons of TNT).
                "energy": float(r["energy"]) if r.get("energy") else None,
                "impactKt": float(r["impact-e"]) if r.get("impact-e") else None,
            }
        )
    return out


def build(get: Callable[[str], bytes], now: dt.datetime | None = None) -> dict:
    now = now or dt.datetime.now(dt.timezone.utc)
    meteors: list[dict] = []
    errors = []
    for name in GMN_FILES:
        try:
            meteors += parse_gmn(get(GMN + name).decode("utf-8", "replace"))
        except Exception as err:  # one file missing shouldn't drop the other
            errors.append(f"{name}: {err}")
            print(f"meteors: GMN {name} unavailable ({err})", file=sys.stderr)
    if not meteors:
        raise RuntimeError("no GMN trajectories: " + "; ".join(errors))
    since = (now - dt.timedelta(days=FIREBALL_DAYS)).strftime("%Y-%m-%d")
    try:
        fireballs = parse_fireballs(json.loads(get(f"{CNEOS}?date-min={since}&req-loc=true")))
    except Exception as err:
        print(f"meteors: CNEOS unavailable ({err})", file=sys.stderr)
        fireballs = []
    return {
        "generated": iso(now),
        "source": "Global Meteor Network; NASA/JPL CNEOS fireballs",
        **pack(meteors),
        "fireballDays": FIREBALL_DAYS,
        "fireballs": fireballs,
    }


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(prog="xearth_clouds.meteors", description=__doc__.split("\n\n")[0])
    ap.add_argument("--out", type=Path, required=True)
    args = ap.parse_args(argv)
    manifest = build(_get)
    args.out.mkdir(parents=True, exist_ok=True)
    tmp = args.out / (MANIFEST + ".tmp")
    tmp.write_text(json.dumps(manifest, separators=(",", ":")) + "\n", encoding="utf-8")
    os.replace(tmp, args.out / MANIFEST)
    n = len(manifest["meteors"]) // len(FIELDS)
    top = ", ".join(f"{c} {manifest['counts'][c]}" for c in manifest["showers"][:3])
    print(f"wrote {args.out / MANIFEST}: {n} meteors {manifest['from']} to {manifest['to']} ({top}); {len(manifest['fireballs'])} fireballs in {FIREBALL_DAYS} d")
    return 0


if __name__ == "__main__":
    sys.exit(main())
