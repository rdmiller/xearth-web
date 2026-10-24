"""Publish recent tsunami bulletins from NOAA's two Tsunami Warning Centers.

  * NTWC (Palmer, Alaska): the US mainland, Alaska and Canada.
  * PTWC (Honolulu, Hawaii): Hawaii, the US Pacific and Caribbean territories,
    and threat messages for other nations around the Pacific, Indian Ocean
    and Caribbean.

Each center's Atom feed on tsunami.gov lists its latest bulletins: the
earthquake's epicentre, its preliminary magnitude, and the category —
Warning, Advisory, Watch, Threat, Information or Cancellation. tsunami.gov
sends no CORS headers, so the browser can't read the feeds; this keeps the
last MAX_AGE of bulletins. (Live US warnings, watches and advisories also come
to the browser directly from the NWS alerts API.)

    python -m xearth_clouds.tsunami --out web/public/tsunami
"""

from __future__ import annotations

import argparse
import datetime as dt
import json
import os
import re
import sys
import xml.etree.ElementTree as ET
from pathlib import Path
from typing import Callable

from .launches import _get, iso, parse_time

FEEDS = {
    "NTWC": "https://www.tsunami.gov/events/xml/PAAQAtom.xml",
    "PTWC": "https://www.tsunami.gov/events/xml/PHEBAtom.xml",
}
MANIFEST = "latest.json"
MAX_AGE = dt.timedelta(hours=48)
NS = {"a": "http://www.w3.org/2005/Atom", "geo": "http://www.w3.org/2003/01/geo/wgs84_pos#"}
CATEGORIES = ("warning", "advisory", "watch", "threat", "information", "cancellation")


def _field(summary: str, name: str) -> str:
    m = re.search(rf"{name}:\s*</(?:strong|b)>\s*(.*?)\s*<br", summary, re.S | re.I)
    return re.sub(r"<[^>]+>", "", m.group(1)).strip() if m else ""


def category(text: str) -> str:
    """'Information' / 'Tsunami Threat Message' / … → one of CATEGORIES ('' if none)."""
    t = text.lower()
    return next((c for c in CATEGORIES if c in t), "")


def parse_feed(xml: str, center: str) -> list[dict]:
    root = ET.fromstring(xml)
    out = []
    for e in root.findall("a:entry", NS):
        summary_el = e.find("a:summary", NS)
        summary = ET.tostring(summary_el, encoding="unicode") if summary_el is not None else ""
        # The summary is namespaced XHTML; drop the prefixes so the field regexes match.
        summary = re.sub(r"<(/?)\w+:", r"<\1", summary)
        try:
            lat = float(e.findtext("geo:lat", namespaces=NS) or "")
            lon = float(e.findtext("geo:long", namespaces=NS) or "")
        except ValueError:
            continue
        issued = parse_time((e.findtext("a:updated", namespaces=NS) or "").replace("Z", ""))
        mag = re.match(r"\s*([\d.]+)\s*\(?(\w*)\)?", _field(summary, "Preliminary Magnitude"))
        links = {l.get("title", ""): l.get("href", "") for l in e.findall("a:link", NS)}
        # https only: the web app makes it a link (as MeteoAlarm's warning pages).
        bulletin = re.search(r'href="(https://[^"]+\.txt)"', summary)
        note = re.sub(r"^\*\s*", "", _field(summary, "Note")).strip()
        out.append(
            {
                "id": f"{center}-{(e.findtext('a:id', namespaces=NS) or '').split(':')[-1]}",
                "center": center,
                "category": category(_field(summary, "Category")),
                "region": (e.findtext("a:title", namespaces=NS) or "").strip(),
                "lat": round(lat, 3),
                "lon": round(lon, 3),
                "magnitude": float(mag.group(1)) if mag else None,
                "magnitudeType": (mag.group(2) if mag else "") or None,
                "issued": iso(issued),
                "note": note or None,
                "bulletin": bulletin.group(1) if bulletin else None,
                "cap": links.get("CapXML document"),
            }
        )
    return out


ORDER = {c: i for i, c in enumerate(("warning", "threat", "advisory", "watch", "cancellation", "information", ""))}


def build(get: Callable[[str], str], now: dt.datetime | None = None) -> dict:
    now = now or dt.datetime.now(dt.timezone.utc)
    bulletins = []
    used = []
    for center, url in FEEDS.items():
        try:
            bulletins += parse_feed(get(url), center)
            used.append(center)
        except Exception as err:  # one center's feed failing shouldn't drop the other's
            print(f"tsunami: {center} feed unavailable ({err})", file=sys.stderr)
    recent = [b for b in bulletins if b["issued"] and now - parse_time(b["issued"][:-1]) <= MAX_AGE]
    # Most severe first; newest first within a category.
    recent.sort(key=lambda b: b["issued"], reverse=True)
    recent.sort(key=lambda b: ORDER.get(b["category"], 9))
    return {
        "generated": iso(now),
        "source": f"NOAA tsunami.gov ({', '.join(used) or 'unavailable'})",
        "centers": used,
        "maxAgeHours": int(MAX_AGE.total_seconds() // 3600),
        "bulletins": recent,
    }


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(prog="xearth_clouds.tsunami", description=__doc__.split("\n\n")[0])
    ap.add_argument("--out", type=Path, required=True)
    args = ap.parse_args(argv)
    manifest = build(_get)
    if not manifest["centers"]:
        return 1
    args.out.mkdir(parents=True, exist_ok=True)
    tmp = args.out / (MANIFEST + ".tmp")
    tmp.write_text(json.dumps(manifest, separators=(",", ":")) + "\n", encoding="utf-8")
    os.replace(tmp, args.out / MANIFEST)
    cats = [b["category"] for b in manifest["bulletins"]]
    print(f"wrote {args.out / MANIFEST}: {len(cats)} bulletins in {manifest['maxAgeHours']} h ({', '.join(cats) or 'none'})")
    return 0


if __name__ == "__main__":
    sys.exit(main())
