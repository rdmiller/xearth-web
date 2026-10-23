"""Publish the world's buoys: where each is, its latest readings, and its last 24 hours.

  * NOAA OSMC (the Observing System Monitoring Center) gathers what every buoy on the
    global network reports. One ERDDAP query for the last day, buoys only, comes to ~130,000
    rows (~1.4 MB gzipped, ~20 s): drifting, moored, tropical-moored and ice buoys.
  * NOAA NDBC adds names (activestations.xml), wind gusts and wave period and direction
    for its own stations (latest_obs.txt), and the DART tsunami buoys' water-column height
    (realtime2/<id>.dart, 15-minute readings, sent every few hours; 1-minute or 15-second
    readings when a buoy is in event mode).

None of these send CORS headers. Two files come out:
  * latest.json: each buoy's position, type and latest readings (what the globe draws);
  * history.json: the last 24 hours, hourly, per buoy, and 15-minute DART heights (what a
    buoy's window draws, fetched only when one is opened).

    python -m xearth_clouds.buoys --out web/public/buoys
"""

from __future__ import annotations

import argparse
import csv
import datetime as dt
import gzip
import io
import json
import math
import os
import re
import sys
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from typing import Callable

from .launches import USER_AGENT, iso

OSMC = "https://osmc.noaa.gov/erddap/tabledap/OSMC_30day.csv"
NDBC = "https://www.ndbc.noaa.gov"
WINDOW = dt.timedelta(hours=24)
HOURS = 24
DART_STEP_MIN = 15
# OSMC's platform types → ours.
TYPES = {
    "DRIFTING BUOYS": "drifting",
    "DRIFTING BUOYS (GENERIC)": "drifting",
    "MOORED BUOYS": "moored",
    "MOORED BUOYS (GENERIC)": "moored",
    "WEATHER BUOYS": "moored",
    "TROPICAL MOORED BUOYS": "tropical",
    "ICE BUOYS": "ice",
}
# Readings, as OSMC names them → ours, with how many decimals to keep.
VARS = {"sst": ("sst", 1), "atmp": ("atmp", 1), "slp": ("slp", 1), "windspd": ("wspd", 1), "winddir": ("wdir", 0), "wvht": ("wvht", 2)}
COLUMNS = ["platform_code", "platform_type", "time", "latitude", "longitude", "observation_depth", *VARS]


def _get(url: str) -> bytes:
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT, "Accept-Encoding": "gzip"})
    with urllib.request.urlopen(req, timeout=300) as resp:
        body = resp.read()
        return gzip.decompress(body) if resp.headers.get("Content-Encoding") == "gzip" else body


def osmc_url(since: dt.datetime) -> str:
    """The last day of buoy reports, the columns we use (ERDDAP wants its operators URL-encoded)."""
    # A regex over the names; only their brackets need escaping.
    types = "(" + "|".join(t.replace("(", r"\(").replace(")", r"\)") for t in TYPES) + ")"
    q = ",".join(COLUMNS) + f"&time>={since.strftime('%Y-%m-%dT%H:%M:%SZ')}" + f'&platform_type=~"{types}"'
    return OSMC + "?" + urllib.parse.quote(q, safe="&,=~")


def _f(s: str | None) -> float | None:
    if s is None or s in ("", "NaN", "MM"):
        return None
    try:
        v = float(s)
    except ValueError:
        return None
    return v if math.isfinite(v) else None


def parse_osmc(text: str) -> dict[str, dict]:
    """CSV rows → per buoy: its type and its surface reports (depth ≤ 1 m), oldest first."""
    reader = csv.reader(io.StringIO(text))
    header = next(reader)
    next(reader, None)  # units row
    col = {c: header.index(c) for c in COLUMNS}
    buoys: dict[str, dict] = {}
    for row in reader:
        if len(row) < len(header):
            continue
        kind = TYPES.get(row[col["platform_type"]])
        depth = _f(row[col["observation_depth"]])
        lat, lon = _f(row[col["latitude"]]), _f(row[col["longitude"]])
        if not kind or lat is None or lon is None or (depth is not None and depth > 1):
            continue
        try:
            t = dt.datetime.fromisoformat(row[col["time"]].replace("Z", "+00:00"))
        except ValueError:
            continue
        rec = {"t": t, "lat": lat, "lon": lon}
        for src, (name, _) in VARS.items():
            rec[name] = _f(row[col[src]])
        b = buoys.setdefault(row[col["platform_code"]], {"type": kind, "reports": []})
        b["reports"].append(rec)
    for b in buoys.values():
        b["reports"].sort(key=lambda r: r["t"])
    return buoys


def parse_stations(xml: str) -> dict[str, dict]:
    """NDBC activestations.xml → id: {name, owner, lat, lon, dart}."""
    out = {}
    for m in re.finditer(r"<station\b([^>]*)/?>", xml):
        a = dict(re.findall(r'(\w+)="([^"]*)"', m.group(1)))
        if "id" in a:
            out[a["id"]] = {
                "name": a.get("name", ""),
                "owner": a.get("owner", ""),
                "lat": _f(a.get("lat")),
                "lon": _f(a.get("lon")),
                "dart": a.get("dart") == "y" or a.get("type") == "dart",
            }
    return out


def parse_latest_obs(text: str) -> dict[str, dict]:
    """NDBC latest_obs.txt → id: {t, gust, dpd, mwd, …}; 'MM' is missing."""
    lines = text.splitlines()
    cols = lines[0].lstrip("#").split()
    out = {}
    for line in lines[2:]:
        c = line.split()
        if len(c) != len(cols):
            continue
        r = dict(zip(cols, c))
        try:
            t = dt.datetime(int(r["YYYY"]), int(r["MM"]), int(r["DD"]), int(r["hh"]), int(r["mm"]), tzinfo=dt.timezone.utc)
        except (KeyError, ValueError):
            continue
        out[r["STN"]] = {
            "t": t,
            "wspd": _f(r.get("WSPD")),
            "wdir": _f(r.get("WDIR")),
            "gust": _f(r.get("GST")),
            "wvht": _f(r.get("WVHT")),
            "dpd": _f(r.get("DPD")),
            "mwd": _f(r.get("MWD")),
            "slp": _f(r.get("PRES")),
            "atmp": _f(r.get("ATMP")),
            "sst": _f(r.get("WTMP")),
        }
    return out


def parse_dart(text: str, since: dt.datetime) -> dict | None:
    """A DART file → readings since `since` (time, height m, measurement type), newest last."""
    out = []
    for line in text.splitlines():
        if line.startswith("#"):
            continue
        c = line.split()
        if len(c) < 8:
            continue
        try:
            t = dt.datetime(int(c[0]), int(c[1]), int(c[2]), int(c[3]), int(c[4]), int(c[5]), tzinfo=dt.timezone.utc)
            h = float(c[7])
            kind = int(c[6])
        except ValueError:
            continue
        # 9999.000 marks a missing value.
        if t >= since and h < 9000:
            out.append((t, h, kind))
    if not out:
        return None
    out.sort()
    return {"readings": out, "event": any(k in (2, 3) for _, _, k in out)}


def _round(v: float | None, places: int) -> float | int | None:
    if v is None:
        return None
    r = round(v, places)
    return int(r) if places == 0 else r


def summarise(buoys: dict[str, dict], start: dt.datetime) -> tuple[list[dict], dict[str, dict]]:
    """Per buoy: the latest value of each reading, and hourly bins (each the hour's last value)."""
    latest, history = [], {}
    for pid, b in buoys.items():
        reps = b["reports"]
        last = {name: next((r[name] for r in reversed(reps) if r[name] is not None), None) for name, _ in VARS.values()}
        if all(v is None for v in last.values()):
            continue  # reports positions only (or nothing): not worth a dot
        lastrep = next(r for r in reversed(reps) if any(r[n] is not None for n, _ in VARS.values()))
        rec = {"id": pid, "type": b["type"], "lat": round(reps[-1]["lat"], 3), "lon": round(reps[-1]["lon"], 3), "time": iso(lastrep["t"])}
        rec.update({name: _round(last[name], places) for name, places in VARS.values()})
        latest.append(rec)
        bins: dict[str, list] = {name: [None] * HOURS for name, _ in VARS.values()}
        track = {"lat": [None] * HOURS, "lon": [None] * HOURS}
        for r in reps:
            i = int((r["t"] - start).total_seconds() // 3600)
            if not 0 <= i < HOURS:
                continue
            for name, places in VARS.values():
                if r[name] is not None:
                    bins[name][i] = _round(r[name], places)
            track["lat"][i], track["lon"][i] = round(r["lat"], 3), round(r["lon"], 3)
        series = {k: v for k, v in bins.items() if any(x is not None for x in v)}
        if b["type"] in ("drifting", "ice"):
            series.update(track)
        history[pid] = series
    return latest, history


def build(get: Callable[[str], bytes], now: dt.datetime | None = None, workers: int = 8) -> tuple[dict, dict]:
    now = now or dt.datetime.now(dt.timezone.utc)
    hour = now.replace(minute=0, second=0, microsecond=0)
    start = hour + dt.timedelta(hours=1) - WINDOW
    buoys = parse_osmc(get(osmc_url(start)).decode("utf-8", "replace"))
    latest, history = summarise(buoys, start)
    try:
        stations = parse_stations(get(f"{NDBC}/activestations.xml").decode("utf-8", "replace"))
    except Exception as err:
        print(f"buoys: NDBC station list unavailable ({err})", file=sys.stderr)
        stations = {}
    try:
        obs = parse_latest_obs(get(f"{NDBC}/data/latest_obs/latest_obs.txt").decode("utf-8", "replace"))
    except Exception as err:
        print(f"buoys: NDBC latest observations unavailable ({err})", file=sys.stderr)
        obs = {}
    for rec in latest:
        st = stations.get(rec["id"])
        if st and st["name"]:
            rec["name"] = st["name"]
        o = obs.get(rec["id"])
        if o:
            # Gusts and wave period and direction only NDBC has; a newer report wins outright.
            rec.update({k: _round(o[k], 1 if k == "gust" else 0) for k in ("gust", "dpd", "mwd")})
            if iso(o["t"]) > rec["time"]:
                for k, places in (("wspd", 1), ("wdir", 0), ("wvht", 2), ("slp", 1), ("atmp", 1), ("sst", 1)):
                    if o[k] is not None:
                        rec[k] = _round(o[k], places)
                rec["time"] = iso(o["t"])

    # DART tsunami buoys: their own files, in parallel.
    darts = {sid: st for sid, st in stations.items() if st["dart"] and st["lat"] is not None}

    def one(sid: str):
        try:
            return sid, parse_dart(get(f"{NDBC}/data/realtime2/{sid}.dart").decode("utf-8", "replace"), start)
        except Exception:
            return sid, None  # many listed DARTs have no recent file

    dart_history = {}
    with ThreadPoolExecutor(max_workers=workers) as pool:
        for sid, d in pool.map(one, darts):
            if not d:
                continue
            st = darts[sid]
            t, h, _ = d["readings"][-1]
            latest.append({"id": sid, "type": "dart", "name": st["name"], "lat": st["lat"], "lon": st["lon"], "time": iso(t), "height": round(h, 3), "event": d["event"]})
            dart_history[sid] = {"t": [round((x - start).total_seconds() / 60) for x, _, _ in d["readings"]], "height": [round(y, 3) for _, y, _ in d["readings"]]}

    latest.sort(key=lambda r: r["id"])
    counts: dict[str, int] = {}
    for r in latest:
        counts[r["type"]] = counts.get(r["type"], 0) + 1
    manifest = {
        "generated": iso(now),
        "source": "NOAA OSMC; NOAA NDBC",
        "from": iso(start),
        "to": iso(start + WINDOW),
        "counts": counts,
        "buoys": latest,
    }
    hist = {"generated": iso(now), "from": iso(start), "stepMin": 60, "hours": HOURS, "series": history, "dart": dart_history}
    return manifest, hist


def write_json(path: Path, data: dict) -> None:
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(json.dumps(data, separators=(",", ":")) + "\n", encoding="utf-8")
    os.replace(tmp, path)


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(prog="xearth_clouds.buoys", description=__doc__.split("\n\n")[0])
    ap.add_argument("--out", type=Path, required=True)
    args = ap.parse_args(argv)
    manifest, hist = build(_get)
    args.out.mkdir(parents=True, exist_ok=True)
    # History first: a latest.json never points at a missing or older history.
    write_json(args.out / "history.json", hist)
    write_json(args.out / "latest.json", manifest)
    counts = ", ".join(f"{n} {k}" for k, n in sorted(manifest["counts"].items(), key=lambda x: -x[1]))
    print(f"wrote {args.out}: {len(manifest['buoys'])} buoys ({counts})")
    return 0


if __name__ == "__main__":
    sys.exit(main())
