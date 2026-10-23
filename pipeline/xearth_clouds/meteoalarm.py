"""Publish Europe's weather warnings from MeteoAlarm, with the outline of every region warned.

MeteoAlarm (EUMETNET) gathers the warnings of 38 national weather services into one CAP feed
per country: feeds.meteoalarm.org/api/v1/warnings/feeds-<country>, JSON, CC BY 4.0. Those
send no CORS headers, run to 37 MB an hour in all, and keep expired warnings, so this keeps
the ones in force now or starting within LOOKAHEAD, in English where the service sends it
(nearly all do), and attaches each region's outline:

  * the polygon in the warning itself (France, Switzerland, Norway, Sweden, the UK, …), or
  * its EMMA_ID region code (Germany, Spain, Italy, …), from MeteoAlarm's geocode file,
    simplified once into meteoalarm_regions.json (scripts/bake_meteoalarm_regions.py), or
  * for areas given only as NUTS codes (Bulgaria, Hungary, Romania, North Macedonia), the
    region of the same name in that file; Belgium's NUTS 2 provinces by a table; Croatia's
    counties, newer than the geocode file, from Natural Earth.

Each warning carries its MeteoAlarm awareness level (2 yellow, 3 orange, 4 red: green, 1,
means no warning and is dropped) and type (wind, rain, thunderstorm, …).

    python -m xearth_clouds.meteoalarm --out web/public/meteoalarm
"""

from __future__ import annotations

import argparse
import datetime as dt
import gzip
import hashlib
import json
import os
import re
import sys
import unicodedata
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from typing import Callable

from .launches import _get, iso

FEED = "https://feeds.meteoalarm.org/api/v1/warnings/feeds-{}"
# MeteoAlarm's feed name for each member, and its ISO code (what EMMA_IDs start with).
COUNTRIES = {
    "austria": "AT", "belgium": "BE", "bosnia-herzegovina": "BA", "bulgaria": "BG", "croatia": "HR",
    "cyprus": "CY", "czechia": "CZ", "denmark": "DK", "estonia": "EE", "finland": "FI", "france": "FR",
    "germany": "DE", "greece": "GR", "hungary": "HU", "iceland": "IS", "ireland": "IE", "israel": "IL",
    "italy": "IT", "latvia": "LV", "lithuania": "LT", "luxembourg": "LU", "malta": "MT", "moldova": "MD",
    "montenegro": "ME", "netherlands": "NL", "norway": "NO", "poland": "PL", "portugal": "PT",
    "republic-of-north-macedonia": "MK", "romania": "RO", "serbia": "RS", "slovakia": "SK",
    "slovenia": "SI", "spain": "ES", "sweden": "SE", "switzerland": "CH", "ukraine": "UA",
    "united-kingdom": "GB",
}
REGIONS = Path(__file__).with_name("meteoalarm_regions.json.gz")
MANIFEST = "latest.json"
# MeteoAlarm's own map shows today and tomorrow; this keeps what starts within the next 48 h.
LOOKAHEAD = dt.timedelta(hours=48)
# Douglas–Peucker tolerance and rounding for the outlines, in degrees: ~1 km, finer than the
# globe draws a county at its closest zoom.
TOLERANCE = 0.01
DIGITS = 3
# Belgium sends its provinces as NUTS 2 codes, named in English; MeteoAlarm's regions are
# named in Dutch or French. Brussels and both Brabants are one region, Brabant.
BE_NUTS2 = {
    "BE10": "BE004", "BE21": "BE002", "BE22": "BE007", "BE23": "BE003", "BE24": "BE004",
    "BE25": "BE009", "BE31": "BE004", "BE32": "BE005", "BE33": "BE008", "BE34": "BE001", "BE35": "BE006",
}
# Met Éireann sends its counties as FIPS 10-4 codes (a province as all of its counties).
IE_FIPS = {
    "EI01": "IE020", "EI02": "IE027", "EI03": "IE014", "EI04": "IE007", "EI06": "IE018", "EI07": "IE012",
    "EI10": "IE015", "EI11": "IE008", "EI12": "IE030", "EI13": "IE021", "EI14": "IE029", "EI15": "IE022",
    "EI16": "IE013", "EI18": "IE025", "EI19": "IE019", "EI20": "IE016", "EI21": "IE023", "EI22": "IE031",
    "EI23": "IE028", "EI24": "IE026", "EI25": "IE017", "EI26": "IE006", "EI27": "IE009", "EI29": "IE024",
    "EI30": "IE010", "EI31": "IE011",
}
DESCRIPTION_MAX = 600
INSTRUCTION_MAX = 300

Ring = list[list[float]]
Polygon = list[Ring]


# ---- geometry ---------------------------------------------------------------------------


def _douglas_peucker(points: Ring, tol: float) -> Ring:
    """Points kept by Douglas–Peucker; the first and last always are (equal, for a ring)."""
    if len(points) < 3:
        return points
    keep = [False] * len(points)
    keep[0] = keep[-1] = True
    stack = [(0, len(points) - 1)]
    while stack:
        a, b = stack.pop()
        (ax, ay), (bx, by) = points[a], points[b]
        dx, dy = bx - ax, by - ay
        seg = dx * dx + dy * dy
        worst, at = -1.0, -1
        for i in range(a + 1, b):
            px, py = points[i][0] - ax, points[i][1] - ay
            if seg == 0:
                d = px * px + py * py
            else:
                t = max(0.0, min(1.0, (px * dx + py * dy) / seg))
                ex, ey = px - t * dx, py - t * dy
                d = ex * ex + ey * ey
            if d > worst:
                worst, at = d, i
        if at >= 0 and worst > tol * tol:
            keep[at] = True
            stack += [(a, at), (at, b)]
    return [p for p, k in zip(points, keep) if k]


def ring_area(ring: Ring) -> float:
    """Signed area in square degrees: positive anticlockwise (east then north)."""
    return sum(x0 * y1 - x1 * y0 for (x0, y0), (x1, y1) in zip(ring, ring[1:] + ring[:1])) / 2


def simplify_ring(ring: Ring, tol: float = TOLERANCE, digits: int = DIGITS) -> Ring | None:
    """Simplified, rounded, closed; None when nothing with an area is left."""
    pts = [[round(x, digits), round(y, digits)] for x, y in ring]
    if pts[0] != pts[-1]:
        pts.append(pts[0])
    out = _douglas_peucker(pts, tol)
    # Rounding can leave neighbours equal.
    out = [p for i, p in enumerate(out) if i == 0 or p != out[i - 1]]
    return out if len(out) >= 4 and ring_area(out) != 0 else None


def simplify_polygons(polygons: list[Polygon], tol: float = TOLERANCE, digits: int = DIGITS) -> list[Polygon]:
    """Each polygon's outline anticlockwise and its holes clockwise, so that a non-zero fill of
    many regions at once fills overlaps and leaves holes open. Rings too small to survive
    simplification are dropped, unless that would leave nothing: then the largest is kept as
    it was (a small island region is still a region)."""
    out: list[Polygon] = []
    for poly in polygons:
        outer = simplify_ring(poly[0], tol, digits)
        if not outer:
            continue
        holes = [h for h in (simplify_ring(r, tol, digits) for r in poly[1:]) if h]
        out.append([_wound(outer, True)] + [_wound(h, False) for h in holes])
    if not out and polygons:
        biggest = max((p[0] for p in polygons), key=lambda r: abs(ring_area(r)))
        exact = simplify_ring(biggest, 0, digits)
        if exact:
            out.append([_wound(exact, True)])
    return out


def _wound(ring: Ring, anticlockwise: bool) -> Ring:
    return ring if (ring_area(ring) > 0) == anticlockwise else ring[::-1]


def cap_polygon(text: str) -> Ring | None:
    """A CAP <polygon>, "lat,lon lat,lon …", as [lon, lat] points."""
    pts = []
    for pair in text.split():
        try:
            lat, lon = (float(v) for v in pair.split(","))
        except ValueError:
            return None
        pts.append([lon, lat])
    return pts if len(pts) >= 4 else None


def norm_name(name: str) -> str:
    """'Caraș-Severin' and 'CARAS SEVERIN', 'Skopje region' and 'Skopje Region' alike."""
    s = unicodedata.normalize("NFKD", name.replace("đ", "d").replace("Đ", "D"))
    s = "".join(c for c in s if not unicodedata.combining(c)).lower()
    s = re.sub(r"[^a-z0-9]+", " ", s).strip()
    return re.sub(r"^county\s+|\s+region$", "", s)


# ---- the warnings -------------------------------------------------------------------------


def parse_level(value: str) -> int:
    """'3; orange; Severe' → 3 (0 if unreadable)."""
    m = re.match(r"\s*(\d+)", value or "")
    return int(m.group(1)) if m else 0


def parse_type(value: str) -> int:
    """'1; Wind' → 1 (0 if unreadable)."""
    return parse_level(value)


def _time(s: str | None) -> dt.datetime | None:
    if not s:
        return None
    try:
        t = dt.datetime.fromisoformat(s.replace("Z", "+00:00"))
    except ValueError:
        return None
    return (t if t.tzinfo else t.replace(tzinfo=dt.timezone.utc)).astimezone(dt.timezone.utc)


def _clip(s: str | None, n: int) -> str | None:
    s = re.sub(r"\s+", " ", s or "").strip()
    if not s:
        return None
    return s if len(s) <= n else s[: n - 1].rsplit(" ", 1)[0] + "…"


def _infos(alert: dict) -> list[dict]:
    """The English infos, or else those in the first language the warning gives."""
    infos = alert.get("info") or []
    english = [i for i in infos if (i.get("language") or "").lower().startswith("en")]
    if english:
        return english
    first = infos[0].get("language") if infos else None
    return [i for i in infos if i.get("language") == first]


class Places:
    """Turns a CAP area into region keys, keeping each region's outline once."""

    def __init__(self, regions: dict[str, dict]):
        self.known = regions
        self.by_name = {(r["country"], norm_name(r["name"])): code for code, r in regions.items()}
        self.used: dict[str, dict] = {}
        self.unplaced: set[str] = set()

    def keys(self, area: dict, country: str) -> list[str]:
        desc = (area.get("areaDesc") or "").strip()
        polys = [r for r in (cap_polygon(p) for p in area.get("polygon") or []) if r]
        if polys:
            outline = simplify_polygons([[r] for r in polys])
            if outline:
                key = "p" + hashlib.sha1(json.dumps(outline).encode()).hexdigest()[:12]
                self.used.setdefault(key, {"name": desc, "country": country, "polygons": outline})
                return [key]
        # An area can list several regions, each by a code or (failing that) by name.
        codes = []
        for g in area.get("geocode") or []:
            kind, value = g.get("valueName"), str(g.get("value") or "")
            codes.append(value if kind == "EMMA_ID" else BE_NUTS2.get(value) if kind == "NUTS2" else IE_FIPS.get(value) if kind == "FIPS" else None)
        codes = [c for c in codes if c in self.known]
        if not codes:
            names = [desc] if (country, norm_name(desc)) in self.by_name else desc.split(",")
            for name in names:
                code = self.by_name.get((country, norm_name(name)))
                if code:
                    codes.append(code)
                elif name.strip():
                    self.unplaced.add(f"{country} {name.strip()}")
        for code in codes:
            r = self.known[code]
            # A single region is named as the warning names it; one of several by its own name.
            self.used.setdefault(code, {"name": desc if len(codes) == 1 and desc else r["name"], "country": r["country"], "polygons": r["polygons"]})
        return sorted(set(codes))


def parse_feed(feed: dict, country: str, places: Places, now: dt.datetime) -> list[dict]:
    out = []
    for w in feed.get("warnings") or []:
        alert = w.get("alert") or {}
        if alert.get("status") not in (None, "Actual") or alert.get("msgType") == "Cancel":
            continue
        for n, info in enumerate(_infos(alert)):
            params = {}
            for p in info.get("parameter") or []:
                params.setdefault(p.get("valueName"), p.get("value"))
            level = parse_level(params.get("awareness_level", ""))
            if level < 2:
                continue
            onset = _time(info.get("onset") or info.get("effective") or alert.get("sent"))
            expires = _time(info.get("expires"))
            if not expires or expires <= now or (onset and onset > now + LOOKAHEAD):
                continue
            areas = info.get("area") or []
            keys = sorted({k for a in areas for k in places.keys(a, country)})
            if not keys:
                continue
            names = list(dict.fromkeys((a.get("areaDesc") or "").strip() for a in areas))
            out.append(
                {
                    "id": f"{w.get('uuid') or alert.get('identifier')}-{n}",
                    "country": country,
                    "level": min(level, 4),
                    "type": parse_type(params.get("awareness_type", "")),
                    "event": _clip(info.get("event"), 80),
                    "headline": _clip(info.get("headline"), 160),
                    "description": _clip(info.get("description"), DESCRIPTION_MAX),
                    "instruction": _clip(info.get("instruction"), INSTRUCTION_MAX),
                    "sender": _clip(info.get("senderName"), 80),
                    "web": info.get("web") if str(info.get("web") or "").startswith("https://") else None,
                    "sent": iso(_time(alert.get("sent"))),
                    "onset": iso(onset),
                    "expires": iso(expires),
                    "areas": _clip("; ".join(n for n in names if n), 300),
                    "regions": keys,
                }
            )
    return out


def load_regions(path: Path = REGIONS) -> dict[str, dict]:
    with gzip.open(path, "rt", encoding="utf-8") as f:
        return json.load(f)["regions"]


def build(get: Callable[[str], str], regions: dict[str, dict], now: dt.datetime | None = None, workers: int = 6) -> dict:
    now = now or dt.datetime.now(dt.timezone.utc)
    places = Places(regions)

    def fetch(slug: str):
        try:
            return slug, json.loads(get(FEED.format(slug))), None
        except Exception as err:  # one service's feed failing shouldn't drop the others
            return slug, None, err

    warnings, used, failed = [], [], []
    with ThreadPoolExecutor(workers) as pool:
        for slug, feed, err in pool.map(fetch, COUNTRIES):
            if feed is None:
                print(f"meteoalarm: {slug} unavailable ({err})", file=sys.stderr)
                failed.append(COUNTRIES[slug])
                continue
            warnings += parse_feed(feed, COUNTRIES[slug], places, now)
            used.append(COUNTRIES[slug])
    # Worst first, then soonest.
    warnings.sort(key=lambda w: (-w["level"], w["onset"] or "", w["id"]))
    keep = {k for w in warnings for k in w["regions"]}
    return {
        "generated": iso(now),
        "source": "MeteoAlarm (EUMETNET), CC BY 4.0",
        "countries": sorted(used),
        "failed": sorted(failed),
        "lookaheadHours": int(LOOKAHEAD.total_seconds() // 3600),
        "warnings": warnings,
        "regions": {k: v for k, v in sorted(places.used.items()) if k in keep},
        "unplaced": sorted(places.unplaced)[:50],
    }


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(prog="xearth_clouds.meteoalarm", description=__doc__.split("\n\n")[0])
    ap.add_argument("--out", type=Path, required=True)
    args = ap.parse_args(argv)
    manifest = build(_get, load_regions())
    if not manifest["countries"]:
        return 1
    args.out.mkdir(parents=True, exist_ok=True)
    tmp = args.out / (MANIFEST + ".tmp")
    tmp.write_text(json.dumps(manifest, separators=(",", ":"), ensure_ascii=False) + "\n", encoding="utf-8")
    os.replace(tmp, args.out / MANIFEST)
    levels = [w["level"] for w in manifest["warnings"]]
    print(
        f"wrote {args.out / MANIFEST}: {len(levels)} warnings ({levels.count(4)} red, {levels.count(3)} orange, "
        f"{levels.count(2)} yellow) over {len(manifest['regions'])} regions from {len(manifest['countries'])} countries"
        + (f"; {len(manifest['unplaced'])} areas unplaced" if manifest["unplaced"] else "")
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
