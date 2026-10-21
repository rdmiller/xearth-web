"""Publish GDACS floods, wildfires and recent volcanic eruptions.

GDACS (the EU/UN Global Disaster Alert and Coordination System) lists each
current event with an alert level (Green / Orange / Red) and a centroid:

  * Floods (FL) — from GloFAS river-flow forecasts and observed flooding.
  * Wildfires (WF) — from GWIS, with the burned area in hectares.
  * Volcanoes (VO) — eruptions reported by the Volcanic Ash Advisory Centres.
    GDACS records an eruption as a single moment, never "current", so these
    come from a search over the last VOLCANO_DAYS days instead.

Tropical cyclones are in storms.py; earthquakes come from USGS in the browser.

    python -m xearth_clouds.events --out web/public/events
"""

from __future__ import annotations

import argparse
import datetime as dt
import json
import os
import sys
from pathlib import Path
from typing import Callable
from urllib.parse import urlencode

from .launches import _get, iso, parse_time

GDACS_EVENTS = "https://www.gdacs.org/gdacsapi/api/events/geteventlist/EVENTS4APP"
GDACS_SEARCH = "https://www.gdacs.org/gdacsapi/api/events/geteventlist/SEARCH"
REPORT = "https://www.gdacs.org/report.aspx?eventid={id}&episodeid={ep}&eventtype={type}"
MANIFEST = "latest.json"
CURRENT_TYPES = ("FL", "WF")
VOLCANO_DAYS = 90
# Drop current events GDACS hasn't touched for this long.
STALE = dt.timedelta(days=4)


def _name(p: dict) -> str:
    """'Eruption  Kanlaon' → 'Kanlaon'; floods and fires are named by country."""
    if p.get("eventtype") == "VO":
        return (p.get("eventname") or p.get("name", "").replace("Eruption", "")).strip()
    return (p.get("country") or p.get("name") or "").strip()


def simplify(feature: dict) -> dict | None:
    p = feature.get("properties") or {}
    coords = (feature.get("geometry") or {}).get("coordinates") or []
    if len(coords) < 2:
        return None
    sev = p.get("severitydata") or {}
    unit = (sev.get("severityunit") or "").strip()
    out = {
        "id": f"{p.get('eventtype')}-{p.get('eventid')}",
        "type": p.get("eventtype"),
        "name": _name(p),
        "country": (p.get("country") or "").strip(),
        "alert": (p.get("alertlevel") or "").title(),
        "pos": [round(float(coords[0]), 3), round(float(coords[1]), 3)],
        "from": iso(parse_time(p.get("fromdate"))),
        "to": iso(parse_time(p.get("todate"))),
        "updated": iso(parse_time((p.get("datemodified") or "").split("+")[0])),
        "url": REPORT.format(id=p.get("eventid"), ep=p.get("episodeid"), type=p.get("eventtype")),
    }
    if unit == "ha" and sev.get("severity"):
        out["areaHa"] = round(float(sev["severity"]))
    return out


def current_events(get: Callable[[str], str], now: dt.datetime) -> list[dict]:
    out = []
    for f in json.loads(get(GDACS_EVENTS)).get("features", []):
        p = f.get("properties") or {}
        if p.get("eventtype") not in CURRENT_TYPES or str(p.get("iscurrent", "true")).lower() != "true":
            continue
        updated = parse_time((p.get("datemodified") or p.get("todate") or "").split("+")[0])
        if updated and now - updated > STALE:
            continue
        ev = simplify(f)
        if ev:
            out.append(ev)
    return out


def recent_eruptions(get: Callable[[str], str], now: dt.datetime, days: int = VOLCANO_DAYS) -> list[dict]:
    q = urlencode({"eventlist": "VO", "fromDate": (now - dt.timedelta(days=days)).date().isoformat(), "toDate": now.date().isoformat()})
    out = [simplify(f) for f in json.loads(get(f"{GDACS_SEARCH}?{q}")).get("features", [])]
    # One marker per volcano: its latest eruption.
    latest: dict[str, dict] = {}
    for ev in out:
        if ev and (ev["name"] not in latest or (ev["from"] or "") > (latest[ev["name"]]["from"] or "")):
            latest[ev["name"]] = ev
    return sorted(latest.values(), key=lambda e: e["from"] or "", reverse=True)


ORDER = {"Red": 0, "Orange": 1, "Green": 2}


def build(get: Callable[[str], str], now: dt.datetime | None = None) -> dict:
    now = now or dt.datetime.now(dt.timezone.utc)
    events = current_events(get, now)
    try:
        events += recent_eruptions(get, now)
    except Exception as err:  # a failed search shouldn't drop the floods and fires
        print(f"events: volcano search failed ({err})", file=sys.stderr)
    events.sort(key=lambda e: (ORDER.get(e["alert"], 3), e["type"], -(e.get("areaHa") or 0)))
    counts = {t: sum(1 for e in events if e["type"] == t) for t in ("FL", "WF", "VO")}
    return {
        "generated": iso(now),
        "source": "GDACS (EU JRC / UN OCHA): GloFAS floods, GWIS wildfires, VAAC eruptions",
        "volcanoDays": VOLCANO_DAYS,
        "counts": counts,
        "events": events,
    }


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(prog="xearth_clouds.events", description=__doc__.split("\n\n")[0])
    ap.add_argument("--out", type=Path, required=True)
    args = ap.parse_args(argv)
    manifest = build(_get)
    args.out.mkdir(parents=True, exist_ok=True)
    tmp = args.out / (MANIFEST + ".tmp")
    tmp.write_text(json.dumps(manifest, separators=(",", ":")) + "\n", encoding="utf-8")
    os.replace(tmp, args.out / MANIFEST)
    c = manifest["counts"]
    print(f"wrote {args.out / MANIFEST}: {c['FL']} floods, {c['WF']} wildfires, {c['VO']} volcanoes")
    return 0


if __name__ == "__main__":
    sys.exit(main())
