"""Read xearth web's feeds the way the app does, without Home Assistant.

Two kinds of source, as in the browser:

  * The site's own pipeline output, one latest.json per layer (clouds,
    launches, storms, fires, lightning, GDACS events, tsunami bulletins, smoke).
  * NOAA SWPC space weather and the USGS earthquake feed, read straight from
    their CORS-enabled endpoints.

The parsing mirrors web/src (spaceweather.ts, hazards.ts, tsunami.ts,
launches.ts), and nearby_hazards() is locale.ts's nearbyHazards(), so the
"near home" sensors agree with the app's place card. summarise() turns one
fetch of every feed into the Snapshot the entities read.
"""

from __future__ import annotations

import math
import re
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from typing import Any, Callable, Iterable, Iterator
from urllib.parse import urljoin

SWPC = "https://services.swpc.noaa.gov"
SPACE_WEATHER_URLS = {
    "kp": f"{SWPC}/products/noaa-planetary-k-index.json",
    "flares": f"{SWPC}/json/goes/primary/xray-flares-latest.json",
    "wind": f"{SWPC}/products/summary/solar-wind-speed.json",
    "field": f"{SWPC}/products/summary/solar-wind-mag-field.json",
}
USGS_QUAKES_URL = "https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/2.5_day.geojson"
# The pipeline's folders on the site (snow/ice is only an image, so it isn't read).
SITE_FEEDS = ("clouds", "launches", "storms", "fires", "lightning", "events", "tsunami", "smoke")
HAZARD_FEEDS = ("storms", "tsunami", "quakes", "events", "lightning", "fires")

EARTH_KM = 6371
KM_PER_DEG = EARTH_KM * math.pi / 180
# How close each kind of hazard has to be to count as "here" (locale.ts NEARBY_KM).
NEARBY_KM = {
    "storm": 800,
    "volcano": 150,
    "event": 300,
    "quake_big": 300,
    "quake_small": 50,
    "lightning": 50,
    "fire": 25,
    "tsunami": 1000,
}
COMPASS = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"]
# Launch Library 2 statuses for a launch that's over.
FINISHED = {"Success", "Failure", "Partial Failure"}
# An unfinished launch whose NET is this far gone is a stale record, not the next one.
LAUNCH_STALE = timedelta(hours=6)
# Tsunami statements show for a day; alerts for as long as the bulletin window keeps them.
STATEMENT_HOURS = 24
ALERT_LEVELS = ("info", "advisory", "watch", "warning")


def feed_urls(site: str) -> dict[str, str]:
    """Every URL one update reads, keyed by feed."""
    urls = {key: urljoin(site, f"{key}/latest.json") for key in SITE_FEEDS}
    return urls | SPACE_WEATHER_URLS | {"quakes": USGS_QUAKES_URL}


def parse_time(s: Any) -> datetime | None:
    """ISO 8601 → aware UTC datetime; SWPC's Kp times have no zone and are UTC."""
    if not isinstance(s, str) or not s:
        return None
    try:
        t = datetime.fromisoformat(s.replace("Z", "+00:00"))
    except ValueError:
        return None
    return t if t.tzinfo else t.replace(tzinfo=timezone.utc)


def _first(rows: Any) -> dict:
    return rows[0] if isinstance(rows, list) and rows and isinstance(rows[0], dict) else {}


def _num(v: Any) -> float | None:
    return v if isinstance(v, (int, float)) and not isinstance(v, bool) else None


# ---- space weather (NOAA SWPC) ----------------------------------------------------------


@dataclass
class SpaceWeather:
    kp: float | None = None
    kp_time: datetime | None = None
    # Current GOES 0.1–0.8 nm flux class, e.g. "B9.5".
    xray: str | None = None
    # Peak class and time of the latest flare.
    flare: str | None = None
    flare_time: datetime | None = None
    wind_kms: float | None = None
    bt_nt: float | None = None
    bz_nt: float | None = None


def parse_kp(rows: Any) -> tuple[float, datetime | None] | None:
    if not isinstance(rows, list) or not rows or not isinstance(rows[-1], dict):
        return None
    last = rows[-1]
    kp = _num(last.get("Kp"))
    return (kp, parse_time(last.get("time_tag"))) if kp is not None else None


def space_weather(raw: dict[str, Any]) -> SpaceWeather:
    sw = SpaceWeather()
    if kp := parse_kp(raw.get("kp")):
        sw.kp, sw.kp_time = kp
    f = _first(raw.get("flares"))
    sw.xray = f.get("current_class") or None
    if f.get("max_class") and f.get("max_time"):
        sw.flare, sw.flare_time = f["max_class"], parse_time(f["max_time"])
    sw.wind_kms = _num(_first(raw.get("wind")).get("proton_speed"))
    field_ = _first(raw.get("field"))
    sw.bt_nt, sw.bz_nt = _num(field_.get("bt")), _num(field_.get("bz_gsm"))
    return sw


def storm_level(kp: float) -> str | None:
    """NOAA geomagnetic storm scale from Kp: 5 → G1 … 9 → G5."""
    return f"G{min(5, math.floor(kp) - 4)}" if kp >= 5 else None


# ---- geometry and words ------------------------------------------------------------------


def great_circle_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Great-circle distance (km) alone, for measuring the fire and lightning grids."""
    p1, p2 = math.radians(lat1), math.radians(lat2)
    h = math.sin((p2 - p1) / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(math.radians(lon2 - lon1) / 2) ** 2
    return 2 * EARTH_KM * math.asin(min(1, math.sqrt(h)))


def distance_km(lat1: float, lon1: float, lat2: float, lon2: float) -> tuple[float, float]:
    """Great-circle distance (km) and initial bearing (degrees) from 1 to 2."""
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dl = math.radians(lon2 - lon1)
    h = math.sin((p2 - p1) / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    km = 2 * EARTH_KM * math.asin(min(1, math.sqrt(h)))
    bearing = math.degrees(math.atan2(math.sin(dl) * math.cos(p2), math.cos(p1) * math.sin(p2) - math.sin(p1) * math.cos(p2) * math.cos(dl)))
    return km, (bearing + 360) % 360


def _round(x: float) -> int:
    """Math.round: halves go up (Python's round() goes to even)."""
    return math.floor(x + 0.5)


def compass(deg: float) -> str:
    return COMPASS[_round((deg % 360) / 22.5) % 16]


def where(km: float, bearing: float, imperial: bool = False) -> str:
    """'120 km NE' (the hazard's direction from home), or 'nearby' under 10 km."""
    if km < 10:
        return "nearby"
    return f"{_round(km / 1.609344)} mi {compass(bearing)}" if imperial else f"{_round(km)} km {compass(bearing)}"


def ago(ms: float) -> str:
    minutes = max(0, _round(ms / 60_000))
    return f"{minutes} min ago" if minutes < 60 else f"{_round(minutes / 60)} h ago"


def title_case(s: str) -> str:
    """'TROPICAL STORM MELISSA' → 'Tropical Storm Melissa' (the layers' labels are HUD caps)."""
    return re.sub(r"(^|[\s(·/-])([^\W\d_])", lambda m: m[1] + m[2].upper(), s.lower())


def impact_level(alert: Any) -> int:
    """GDACS alert colour → impact 1–3 (0 when unknown)."""
    return {"green": 1, "orange": 2, "red": 3}.get(str(alert or "").strip().lower(), 0)


def basin_word(lon: float, lat: float) -> str:
    """What a mature cyclone is called where it is."""
    if lat >= 0 and 100 <= lon <= 180:
        return "TYPHOON"
    if lat >= 0 and lon < 0:
        return "HURRICANE"  # Atlantic, East and Central Pacific
    return "CYCLONE"


def storm_class(s: dict) -> str:
    return ((s.get("nhc") or {}).get("classification") or s.get("cls") or "").upper()


STORM_KIND = {
    "TD": "TROPICAL DEPRESSION",
    "TS": "TROPICAL STORM",
    "STD": "SUBTROPICAL DEPRESSION",
    "STS": "SUBTROPICAL STORM",
    "PTC": "POTENTIAL TROPICAL CYCLONE",
}


def storm_title(s: dict) -> str:
    cls = storm_class(s)
    name = ((s.get("nhc") or {}).get("name") or s.get("name") or "").upper()
    kind = basin_word(s["pos"][0], s["pos"][1]) if cls in ("HU", "MH") else STORM_KIND.get(cls, "STORM")
    return f"{kind} {name}"


EVENT_WORD = {"FL": "FLOOD", "WF": "WILDFIRE", "VO": "ERUPTION"}


def event_title(e: dict) -> str:
    return f"{EVENT_WORD.get(e.get('type'), 'EVENT')} · {str(e.get('name', '')).upper()}"


# ---- the pipeline's manifests ------------------------------------------------------------


def _manifest(raw: dict[str, Any], key: str, *lists: str) -> dict | None:
    """The feed's latest.json, if it has a 'generated' time and the lists named."""
    m = raw.get(key)
    if not isinstance(m, dict) or not isinstance(m.get("generated"), str):
        return None
    return m if all(isinstance(m.get(name), list) for name in lists) else None


def _lonlat(p: Any) -> bool:
    """A [lon, lat] the distance maths can use."""
    return isinstance(p, (list, tuple)) and len(p) >= 2 and _num(p[0]) is not None and _num(p[1]) is not None


def _grid(m: dict | None) -> dict | None:
    """A fire or lightning grid: a cell size and a flat list of numbers."""
    if m is None or _num(m.get("cellDeg")) is None or not all(isinstance(x, (int, float)) for x in m["data"]):
        return None
    return m


def next_launch(m: dict, now: datetime) -> dict | None:
    """The first launch in NET order that isn't over (the manifest also keeps recent ones)."""
    for launch in m.get("launches", []):
        if (launch.get("status") or {}).get("abbrev") in FINISHED:
            continue
        net = parse_time(launch.get("net"))
        if net and net >= now - LAUNCH_STALE:
            return launch
    return None


def is_alert_category(c: str) -> bool:
    return c in ("warning", "threat", "advisory", "watch")


def tsunami_shown(b: dict, now: datetime) -> bool:
    """What the app draws: every alert, and statements for a day."""
    if is_alert_category(b.get("category", "")):
        return True
    issued = parse_time(b.get("issued"))
    return issued is not None and now - issued <= timedelta(hours=STATEMENT_HOURS)


@dataclass
class Quake:
    id: str
    mag: float
    place: str
    # Origin time, ms.
    time: int
    lat: float
    lon: float
    depth_km: float
    tsunami: bool
    # USGS PAGER alert (green / yellow / orange / red), when issued.
    alert: str | None
    url: str | None = None


def decode_quakes(feed: Any) -> list[Quake] | None:
    """Quakes with a magnitude, largest first."""
    if not isinstance(feed, dict) or not isinstance(feed.get("features"), list):
        return None
    out = []
    for f in feed["features"]:
        if not isinstance(f, dict):
            continue
        p = f.get("properties") or {}
        c = (f.get("geometry") or {}).get("coordinates")
        if _num(p.get("mag")) is None or not isinstance(c, list) or len(c) < 3 or not _lonlat(c):
            continue
        out.append(
            Quake(
                id=f.get("id", ""),
                mag=p["mag"],
                place=p.get("place") or "",
                time=p.get("time", 0),
                lon=c[0],
                lat=c[1],
                depth_km=c[2],
                tsunami=bool(p.get("tsunami")),
                alert=p.get("alert"),
                url=p.get("url"),
            )
        )
    return sorted(out, key=lambda q: -q.mag)


# ---- what's near home --------------------------------------------------------------------


@dataclass
class Alert:
    # storm / tsunami / quake / event / lightning / fire
    kind: str
    # info / advisory / watch / warning
    level: str
    title: str
    detail: str
    # GDACS impact 1–3, where GDACS gives one.
    impact: int | None = None


def nearby_hazards(lat: float, lon: float, src: dict[str, Any], now: datetime, imperial: bool = False) -> list[Alert]:
    """locale.ts nearbyHazards(): what the hazard layers have near a place."""
    out: list[Alert] = []
    now_ms = now.timestamp() * 1000

    def at(la: float, lo: float) -> tuple[float, float]:
        return distance_km(lat, lon, la, lo)

    for s in (src.get("storms") or {}).get("storms", []):
        km, bearing = at(s["pos"][1], s["pos"][0])
        if km <= NEARBY_KM["storm"]:
            cls = storm_class(s)
            out.append(
                Alert(
                    "storm",
                    "warning" if cls in ("HU", "MH") or km < 300 else "watch",
                    title_case(storm_title(s)),
                    where(km, bearing, imperial),
                    impact_level(s.get("alert")) or None,
                )
            )

    for b in (src.get("tsunami") or {}).get("bulletins", []):
        km, bearing = at(b["lat"], b["lon"])
        cat = str(b.get("category", "")).lower()
        if km > NEARBY_KM["tsunami"] or cat in ("cancellation", "information"):
            continue
        level = "warning" if cat in ("warning", "threat") else "watch" if cat == "watch" else "advisory"
        out.append(Alert("tsunami", level, f"Tsunami {cat} ({b.get('center')})", f"{b.get('region')} · {where(km, bearing, imperial)}"))

    # The strongest quake within 300 km in the last day, else the strongest close by.
    day = [(q, *at(q.lat, q.lon)) for q in src.get("quakes") or [] if now_ms - q.time < 86_400_000]
    big = [d for d in day if d[0].mag >= 4.5 and d[1] <= NEARBY_KM["quake_big"]]
    small = [d for d in day if d[1] <= NEARBY_KM["quake_small"]]
    if pick := max(big, key=lambda d: d[0].mag, default=None) or max(small, key=lambda d: d[0].mag, default=None):
        q, km, bearing = pick
        level = "warning" if q.mag >= 6 else "advisory" if q.mag >= 4.5 else "info"
        out.append(Alert("quake", level, f"M{q.mag:.1f} earthquake", f"{where(km, bearing, imperial)} · {ago(now_ms - q.time)}"))

    for e in (src.get("events") or {}).get("events", []):
        km, bearing = at(e["pos"][1], e["pos"][0])
        if km > (NEARBY_KM["volcano"] if e.get("type") == "VO" else NEARBY_KM["event"]):
            continue
        alert = str(e.get("alert", "")).lower()
        level = "warning" if alert == "red" else "advisory" if alert == "orange" else "info"
        out.append(Alert("event", level, title_case(event_title(e)), where(km, bearing, imperial), impact_level(e.get("alert")) or None))

    if lightning := src.get("lightning"):
        flashes, nearest = _within(lat, lon, lightning, 4, 2, NEARBY_KM["lightning"])
        if flashes:
            radius = "30 mi" if imperial else f"{NEARBY_KM['lightning']} km"
            out.append(
                Alert(
                    "lightning",
                    "advisory" if nearest < 15 else "info",
                    "Lightning nearby",
                    f"{flashes} flash{'' if flashes == 1 else 'es'} within {radius} in the last {lightning.get('windowMin')} min",
                )
            )

    if fires := src.get("fires"):
        detections, nearest = _within(lat, lon, fires, 5, 4, NEARBY_KM["fire"])
        if detections:
            radius = "15 mi" if imperial else f"{NEARBY_KM['fire']} km"
            out.append(
                Alert(
                    "fire",
                    "advisory" if nearest < 5 else "info",
                    "Active fires detected",
                    f"{detections} satellite detection{'' if detections == 1 else 's'} within {radius}",
                )
            )

    return out


def _within(lat: float, lon: float, m: dict, stride: int, count: int, radius_km: float) -> tuple[int, float]:
    """A flat [lat_index, lon_index, …] grid's total of field `count` within the radius, and the nearest cell's km.

    The fire grid runs to tens of thousands of cells, so a cell further off in latitude
    alone than the radius (a lower bound on the distance) isn't measured.
    """
    d, cell = m["data"], m["cellDeg"]
    band = radius_km / KM_PER_DEG
    total, nearest_km = 0, math.inf
    for i in range(0, len(d) - stride + 1, stride):
        la = d[i] * cell
        if abs(la - lat) > band:
            continue
        km = great_circle_km(lat, lon, la, d[i + 1] * cell)
        if km <= radius_km:
            total += d[i + count]
            nearest_km = min(nearest_km, km)
    return total, nearest_km


@dataclass
class Nearest:
    km: float
    bearing: float
    item: Any

    @property
    def direction(self) -> str:
        return compass(self.bearing)


def _located(lat: float, lon: float, items: Iterable, pos: Callable[[Any], tuple[float, float]]) -> Iterator[Nearest]:
    for item in items:
        yield Nearest(*distance_km(lat, lon, *pos(item)), item)


def nearest(lat: float, lon: float, items: Iterable, pos: Callable[[Any], tuple[float, float]]) -> Nearest | None:
    """The item closest to (lat, lon); pos(item) gives its (lat, lon)."""
    best, best_km = None, math.inf
    for item in items:
        if (km := great_circle_km(lat, lon, *pos(item))) < best_km:
            best, best_km = item, km
    return None if best is None else Nearest(*distance_km(lat, lon, *pos(best)), best)


def by_distance(lat: float, lon: float, items: Iterable, pos: Callable[[Any], tuple[float, float]]) -> list[Nearest]:
    """Every item with its distance, nearest first."""
    return sorted(_located(lat, lon, items, pos), key=lambda n: n.km)


def nearest_cell(lat: float, lon: float, m: dict, stride: int) -> Nearest | None:
    """The closest cell of a flat [lat_index, lon_index, …] grid (fires, lightning).

    Its item is the cell with the indices turned into degrees: (lat, lon, …the rest).
    """
    d, cell = m["data"], m["cellDeg"]
    # Minimise the haversine term itself (it rises with distance): no asin or sqrt per cell.
    p1, rad = math.radians(lat), math.pi / 180
    cos1 = math.cos(p1)
    best, best_h = -1, math.inf
    for i in range(0, len(d) - stride + 1, stride):
        p2 = d[i] * cell * rad
        h = math.sin((p2 - p1) / 2) ** 2 + cos1 * math.cos(p2) * math.sin((d[i + 1] * cell - lon) * rad / 2) ** 2
        if h < best_h:
            best, best_h = i, h
    if best < 0:
        return None
    c = (d[best] * cell, d[best + 1] * cell, *d[best + 2 : best + stride])
    return Nearest(*distance_km(lat, lon, c[0], c[1]), c)


# ---- one update ------------------------------------------------------------------------


@dataclass
class Snapshot:
    """Everything the entities show, from one fetch of every feed."""

    # Feeds that answered (or that are still cached from an earlier answer).
    present: set[str] = field(default_factory=set)
    space: SpaceWeather = field(default_factory=SpaceWeather)
    clouds: dict | None = None
    launches: dict | None = None
    launch: dict | None = None
    launch_distance: Nearest | None = None
    quakes: list[Quake] | None = None
    nearest_quake: Nearest | None = None
    # Each storm with its distance from home, nearest first.
    storms: list[Nearest] | None = None
    lightning: dict | None = None
    nearest_lightning: Nearest | None = None
    fires: dict | None = None
    nearest_fire: Nearest | None = None
    events: dict | None = None
    # GDACS events by type (FL / WF / VO), each nearest first.
    events_by_type: dict[str, list[Nearest]] = field(default_factory=dict)
    tsunami: list[dict] | None = None
    smoke: dict | None = None
    nearby: list[Alert] = field(default_factory=list)
    # Each pipeline feed's 'generated' time.
    generated: dict[str, datetime] = field(default_factory=dict)


def summarise(raw: dict[str, Any], lat: float, lon: float, now: datetime, imperial: bool = False) -> Snapshot:
    """Parse one update's feeds (any of them may be missing) into a Snapshot."""
    snap = Snapshot(space=space_weather(raw))
    snap.present = {k for k in raw if k not in SITE_FEEDS}

    snap.clouds = raw.get("clouds") if isinstance(raw.get("clouds"), dict) and isinstance(raw["clouds"].get("t"), str) else None
    snap.launches = _manifest(raw, "launches", "launches")
    storms = _manifest(raw, "storms", "storms")
    fires = _manifest(raw, "fires", "data")
    lightning = _manifest(raw, "lightning", "data")
    snap.events = _manifest(raw, "events", "events")
    tsunami = _manifest(raw, "tsunami", "bulletins")
    snap.smoke = _manifest(raw, "smoke") if isinstance((raw.get("smoke") or {}).get("plumes"), dict) else None
    fires, lightning = _grid(fires), _grid(lightning)
    # One bad record leaves out that record, not the feed (the cached bodies aren't changed).
    if snap.launches is not None:
        snap.launches = snap.launches | {"launches": [l for l in snap.launches["launches"] if isinstance(l, dict)]}
    if storms is not None:
        storms = storms | {"storms": [s for s in storms["storms"] if isinstance(s, dict) and _lonlat(s.get("pos"))]}
    if snap.events is not None:
        snap.events = snap.events | {"events": [e for e in snap.events["events"] if isinstance(e, dict) and _lonlat(e.get("pos"))]}
    if tsunami is not None:
        placed = [b for b in tsunami["bulletins"] if isinstance(b, dict) and _lonlat([b.get("lon"), b.get("lat")])]
        tsunami = tsunami | {"bulletins": placed}
    manifests = {
        "clouds": snap.clouds,
        "launches": snap.launches,
        "storms": storms,
        "fires": fires,
        "lightning": lightning,
        "events": snap.events,
        "tsunami": tsunami,
        "smoke": snap.smoke,
    }
    for key, m in manifests.items():
        if m is not None:
            snap.present.add(key)
            if t := parse_time(m.get("generated")):
                snap.generated[key] = t

    if snap.launches is not None:
        snap.launch = next_launch(snap.launches, now)
        if snap.launch and isinstance((pad := snap.launch.get("pad") or {}).get("lat"), (int, float)):
            snap.launch_distance = Nearest(*distance_km(lat, lon, pad["lat"], pad["lon"]), pad)

    snap.quakes = decode_quakes(raw.get("quakes"))
    if snap.quakes is None:
        snap.present.discard("quakes")
    else:
        snap.nearest_quake = nearest(lat, lon, snap.quakes, lambda q: (q.lat, q.lon))

    if storms is not None:
        snap.storms = by_distance(lat, lon, storms["storms"], lambda s: (s["pos"][1], s["pos"][0]))
    if lightning is not None:
        snap.lightning = {k: v for k, v in lightning.items() if k != "data"}
        snap.nearest_lightning = nearest_cell(lat, lon, lightning, 4)
    if fires is not None:
        snap.fires = {k: v for k, v in fires.items() if k != "data"}
        snap.nearest_fire = nearest_cell(lat, lon, fires, 5)
    if snap.events is not None:
        for kind in EVENT_WORD:
            of_kind = (e for e in snap.events["events"] if e.get("type") == kind)
            snap.events_by_type[kind] = by_distance(lat, lon, of_kind, lambda e: (e["pos"][1], e["pos"][0]))
    if tsunami is not None:
        snap.tsunami = [b for b in tsunami["bulletins"] if tsunami_shown(b, now)]

    src = {"storms": storms, "tsunami": tsunami, "quakes": snap.quakes, "events": snap.events, "lightning": lightning, "fires": fires}
    snap.nearby = nearby_hazards(lat, lon, src, now, imperial)
    return snap


def highest_level(alerts: list[Alert]) -> str | None:
    return max((a.level for a in alerts), key=ALERT_LEVELS.index, default=None)
