"""Argo floats for the buoys job: where each of the ~3,900 floats last surfaced, its track, and
its latest temperature and salinity profile, from NOAA OSMC's ArgoFloats ERDDAP dataset.

A float drifts at ~1,000 m, dives to 2,000 m every ~10 days and rises to the surface measuring
as it goes, then reports by satellite and sinks again. So:
  * positions: one query for the last 30 days of surfacings (~10 s, ~300 KB gzipped) gives
    each float's latest position, model and project, and its last few surfacings as a track;
  * profiles: far too many to fetch every hour (a 10-day query times out on the server), but
    only ~300 arrive a day. Each run fetches those since the last one (a few seconds), binned
    by ERDDAP to one sample per 50 dbar, and keeps each float's newest in a store that
    carries over between runs (argo.json in the output folder; the deploy workflow caches the
    folder). With no store, it's rebuilt from the last 10 days a day at a time (~5-10 min).
"""

from __future__ import annotations

import csv
import datetime as dt
import io
import math
import sys
import time
import urllib.parse
from typing import Callable

from .launches import iso

ARGO = "https://osmc.noaa.gov/erddap/tabledap/ArgoFloats.csv"
TRACK_DAYS = 30
# A float's newest profile is kept this long; one that hasn't surfaced since has likely died.
KEEP_DAYS = 30
BOOTSTRAP_DAYS = 10
# Profiles are rarely listed late, but an overlap with the previous run costs little.
OVERLAP = dt.timedelta(hours=3)
BIN_DBAR = 50
MAX_DBAR = 2000
# Argo QC flags (reference table 2): 3 probably bad, 4 bad. Real-time salinity especially
# has sensors drifting to nonsense (0.3 or 104 PSU), which these catch.
BAD_QC = {"3", "4"}
RETRY_S = 20


def _q(query: str) -> str:
    return ARGO + "?" + urllib.parse.quote(query, safe="&,=()")


def _t(s: dt.datetime) -> str:
    return s.strftime("%Y-%m-%dT%H:%M:%SZ")


def positions_url(since: dt.datetime) -> str:
    return _q(f"platform_number,cycle_number,time,latitude,longitude,platform_type,project_name&time>={_t(since)}&distinct()")


def profiles_url(since: dt.datetime, until: dt.datetime) -> str:
    """Profiles in [since, until), one sample per BIN_DBAR (ERDDAP's orderByClosest), to MAX_DBAR."""
    return _q(
        f"platform_number,cycle_number,time,pres,temp,temp_qc,psal,psal_qc&time>={_t(since)}&time<{_t(until)}&pres<={MAX_DBAR}"
        f'&orderByClosest("platform_number,cycle_number,pres,{BIN_DBAR}")'
    )


def _fetch(get: Callable[[str], bytes], url: str) -> str:
    """The server now and then answers a 500 that a second try gets past; "no results" is a 404."""
    try:
        return get(url).decode("utf-8", "replace")
    except Exception as err:
        if "404" in str(err):
            raise
        time.sleep(RETRY_S)
        return get(url).decode("utf-8", "replace")


def _rows(text: str):
    reader = csv.reader(io.StringIO(text))
    header = next(reader)
    next(reader, None)  # units
    for row in reader:
        if len(row) == len(header):
            yield dict(zip(header, row))


def _f(s: str) -> float | None:
    try:
        v = float(s)
    except (TypeError, ValueError):
        return None
    return v if math.isfinite(v) else None


def _time(s: str) -> dt.datetime | None:
    try:
        return dt.datetime.fromisoformat(s.replace("Z", "+00:00"))
    except ValueError:
        return None


def parse_positions(text: str) -> dict[str, list[dict]]:
    """Surfacings per float, oldest first: time, position, cycle, model, project."""
    out: dict[str, list[dict]] = {}
    for r in _rows(text):
        t, lat, lon = _time(r["time"]), _f(r["latitude"]), _f(r["longitude"])
        if t is None or lat is None or lon is None:
            continue
        out.setdefault(r["platform_number"].strip(), []).append(
            {"t": t, "lat": lat, "lon": lon, "cycle": int(_f(r["cycle_number"]) or 0), "model": r["platform_type"].strip(), "project": r["project_name"].strip()}
        )
    for v in out.values():
        v.sort(key=lambda p: p["t"])
    return out


def parse_profiles(text: str) -> dict[str, dict]:
    """Per float, its newest profile in the text: cycle, time, and pressure/temperature/salinity by depth."""
    profiles: dict[tuple[str, int], dict] = {}
    for r in _rows(text):
        pres, t = _f(r["pres"]), _time(r["time"])
        if pres is None or t is None:
            continue
        key = (r["platform_number"].strip(), int(_f(r["cycle_number"]) or 0))
        p = profiles.setdefault(key, {"cycle": key[1], "time": iso(t), "levels": []})
        temp = None if r["temp_qc"].strip('" ') in BAD_QC else _f(r["temp"])
        psal = None if r["psal_qc"].strip('" ') in BAD_QC else _f(r["psal"])
        p["levels"].append((pres, temp, psal))
    newest: dict[str, dict] = {}
    for (pid, cycle), p in profiles.items():
        lv = sorted(l for l in p["levels"] if l[1] is not None or l[2] is not None)
        if not lv:
            continue
        rec = {
            "cycle": cycle,
            "time": p["time"],
            "pres": [round(l[0]) for l in lv],
            "temp": [None if l[1] is None else round(l[1], 2) for l in lv],
            "psal": [None if l[2] is None else round(l[2], 2) for l in lv],
        }
        if pid not in newest or (rec["time"], cycle) > (newest[pid]["time"], newest[pid]["cycle"]):
            newest[pid] = rec
    return newest


def update_profiles(get: Callable[[str], bytes], store: dict | None, now: dt.datetime) -> dict:
    """Fetch the profiles since the store's last update (or the last 10 days), keep each float's newest."""
    profiles: dict[str, dict] = dict((store or {}).get("profiles") or {})
    updated = _time((store or {}).get("updated") or "")
    since = max(updated - OVERLAP, now - dt.timedelta(days=BOOTSTRAP_DAYS)) if updated else now - dt.timedelta(days=BOOTSTRAP_DAYS)
    t = since
    while t < now:
        # A day at a time: a longer span is too much for the server in one go.
        until = min(t + dt.timedelta(days=1), now)
        try:
            fresh = parse_profiles(_fetch(get, profiles_url(t, until)))
        except Exception as err:
            # ERDDAP answers "no matching results" with a 404; anything else is worth a note.
            if "404" not in str(err):
                print(f"buoys: Argo profiles {_t(t)} unavailable ({err})", file=sys.stderr)
            fresh = {}
        for pid, p in fresh.items():
            old = profiles.get(pid)
            if not old or (p["time"], p["cycle"]) >= (old["time"], old["cycle"]):
                profiles[pid] = p
        t = until
    cutoff = iso(now - dt.timedelta(days=KEEP_DAYS))
    return {"updated": iso(now), "profiles": {k: v for k, v in profiles.items() if v["time"] >= cutoff}}


def surface(p: dict | None) -> tuple[float | None, float | None]:
    """A profile's shallowest temperature and salinity, if measured in the top 10 dbar."""
    if not p or not p["pres"] or p["pres"][0] > 10:
        return None, None
    return p["temp"][0], p["psal"][0]


def floats(get: Callable[[str], bytes], store: dict | None, now: dt.datetime) -> tuple[list[dict], dict]:
    """latest.json entries for every float that surfaced in the last 30 days, and argo.json."""
    since = now - dt.timedelta(days=TRACK_DAYS)
    positions = parse_positions(_fetch(get, positions_url(since)))
    store = update_profiles(get, store, now)
    latest, tracks = [], {}
    for pid, ps in positions.items():
        last = ps[-1]
        prof = store["profiles"].get(pid)
        sst, sal = surface(prof)
        latest.append(
            {
                "id": pid,
                "type": "argo",
                "lat": round(last["lat"], 3),
                "lon": round(last["lon"], 3),
                "time": iso(last["t"]),
                "cycle": last["cycle"],
                "model": last["model"],
                "project": last["project"],
                "sst": sst,
                "sal": sal,
            }
        )
        tracks[pid] = {
            "t": [round(p["t"].timestamp()) for p in ps],
            "lat": [round(p["lat"], 3) for p in ps],
            "lon": [round(p["lon"], 3) for p in ps],
        }
    published = {"generated": iso(now), "updated": store["updated"], "trackDays": TRACK_DAYS, "binDbar": BIN_DBAR, "profiles": store["profiles"], "tracks": tracks}
    return latest, published
