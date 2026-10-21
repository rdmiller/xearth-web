"""Publish upcoming launches, with SpaceX pre-launch orbit predictions where available.

Two sources:
  * Launch Library 2 (The Space Devs) — schedule, status, pads, windows. Its free
    tier allows ~15 requests an hour; this makes two per run.
  * CelesTrak supplemental GP "Pre-Launch" entries — derived from a pre-launch
    state vector SpaceX provides for Starlink missions: elements for the stack and
    for a single satellite, the deploy time, and one set per backup launch
    opportunity. The CelesTrak index page lists each with its launch, deploy and
    window times, which is how they're matched to Launch Library launches.

SpaceX publishes no live telemetry; the web app synthesises an approximate ascent
from the pad to this predicted orbit and labels it as such.

    python -m xearth_clouds.launches --out web/public/launches
"""

from __future__ import annotations

import argparse
import datetime as dt
import html
import json
import os
import re
import sys
import urllib.error
import urllib.request
from pathlib import Path
from typing import Callable

from .satellites import USER_AGENT, NotUpdated, compact

LL2 = "https://ll.thespacedevs.com/2.3.0"
SUPGP = "https://celestrak.org/NORAD/elements/supplemental/"
MANIFEST = "latest.json"

# Launches outside this window aren't published.
LOOKAHEAD = dt.timedelta(days=14)
LOOKBACK = dt.timedelta(days=1)
# How far a pre-launch launch time may sit from Launch Library's NET to count as a match.
MATCH_TOLERANCE = dt.timedelta(minutes=3)


def _get(url: str) -> str:
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            return resp.read().decode("utf-8")
    except urllib.error.HTTPError as err:
        text = err.read().decode("utf-8", "replace")
        if err.code == 403 and "has not updated" in text:
            raise NotUpdated(text.strip()) from err
        raise


def parse_time(s: str | None) -> dt.datetime | None:
    if not s:
        return None
    s = s.strip().replace(" UTC", "").replace("Z", "")
    for fmt in ("%Y-%m-%dT%H:%M:%S.%f", "%Y-%m-%dT%H:%M:%S", "%Y-%m-%d %H:%M:%S.%f", "%Y-%m-%d %H:%M:%S"):
        try:
            return dt.datetime.strptime(s, fmt).replace(tzinfo=dt.timezone.utc)
        except ValueError:
            continue
    return None


def iso(t: dt.datetime | None) -> str | None:
    return t.isoformat(timespec="milliseconds").replace("+00:00", "Z") if t else None


# ---- Launch Library 2 -------------------------------------------------------------


def simplify(rec: dict) -> dict:
    """The fields the web app uses from a Launch Library 2 'normal' launch record."""
    pad = rec.get("pad") or {}
    mission = rec.get("mission") or {}
    rocket = ((rec.get("rocket") or {}).get("configuration") or {})
    status = rec.get("status") or {}
    return {
        "id": rec["id"],
        "name": rec.get("name", ""),
        "provider": (rec.get("launch_service_provider") or {}).get("name", ""),
        "rocket": rocket.get("full_name") or rocket.get("name") or rec.get("name", "").split(" | ")[0],
        "mission": mission.get("name") or rec.get("name", "").split(" | ")[-1],
        "orbit": (mission.get("orbit") or {}).get("abbrev"),
        "net": rec.get("net"),
        "windowStart": rec.get("window_start"),
        "windowEnd": rec.get("window_end"),
        "status": {"abbrev": status.get("abbrev", ""), "name": status.get("name", "")},
        "pad": {
            "name": pad.get("name", ""),
            "location": (pad.get("location") or {}).get("name", ""),
            "lat": float(pad["latitude"]) if pad.get("latitude") is not None else None,
            "lon": float(pad["longitude"]) if pad.get("longitude") is not None else None,
        },
        "webcastLive": bool(rec.get("webcast_live")),
    }


def fetch_ll2(get: Callable[[str], str]) -> list[dict]:
    seen: dict[str, dict] = {}
    for path in ("launches/upcoming/?limit=40&mode=normal", "launches/previous/?limit=10&mode=normal"):
        for rec in json.loads(get(f"{LL2}/{path}")).get("results", []):
            seen[rec["id"]] = rec
    return list(seen.values())


# ---- CelesTrak pre-launch SupGP ----------------------------------------------------

_TD = re.compile(r"<td[^>]*>(.*?)</td>", re.S)
_FILE = re.compile(r"sup-gp\.php\?FILE=([A-Za-z0-9_-]+)")
_LAUNCH = re.compile(r"Launch:\s*([0-9-]+ [0-9:.]+) UTC")
_DEPLOY = re.compile(r"Deploy:\s*([0-9-]+ [0-9:.]+) UTC")
_WINDOW = re.compile(r"Launch window:\s*([0-9-]+ [0-9:.]+) UTC to ([0-9-]+ [0-9:.]+) UTC")
_TITLE = re.compile(r">([^<>]+?)\s*Pre-Launch</a>")


def parse_prelaunch_index(page: str) -> list[dict]:
    """Every 'Pre-Launch' entry on the SupGP index: title and per-opportunity times + file."""
    entries = []
    for cell in _TD.findall(page):
        if "Pre-Launch" not in cell:
            continue
        title = _TITLE.search(cell)
        variants = []
        for seg in cell.split("<hr class=sep>"):
            f, launch, deploy = _FILE.search(seg), _LAUNCH.search(seg), _DEPLOY.search(seg)
            if not (f and launch and deploy):
                continue
            w = _WINDOW.search(seg)
            variants.append(
                {
                    "file": f.group(1),
                    "launch": iso(parse_time(launch.group(1))),
                    "deploy": iso(parse_time(deploy.group(1))),
                    "windowStart": iso(parse_time(w.group(1))) if w else None,
                    "windowEnd": iso(parse_time(w.group(2))) if w else None,
                }
            )
        if variants:
            entries.append({"title": html.unescape(title.group(1).strip()) if title else variants[0]["file"], "variants": variants})
    return entries


def match_prelaunch(launch: dict, entries: list[dict]) -> dict | None:
    """The pre-launch entry with an opportunity within MATCH_TOLERANCE of the launch's NET."""
    net = parse_time(launch.get("net"))
    if not net:
        return None
    best, best_gap = None, MATCH_TOLERANCE
    for e in entries:
        for v in e["variants"]:
            gap = abs(parse_time(v["launch"]) - net)
            if gap <= best_gap:
                best, best_gap = e, gap
    return best


def attach_elements(entry: dict, get: Callable[[str], str], previous: dict[str, dict]) -> dict:
    """Fetch stack + single-satellite elements for every opportunity (reusing unchanged ones)."""
    out = {"title": entry["title"], "variants": []}
    for v in entry["variants"]:
        try:
            recs = json.loads(get(f"{SUPGP}sup-gp.php?FILE={v['file']}&FORMAT=json"))
        except NotUpdated:
            if v["file"] in previous:
                out["variants"].append(previous[v["file"]])
            continue
        stack = next((r for r in recs if "STACK" in r.get("OBJECT_NAME", "")), recs[0] if recs else None)
        single = next((r for r in recs if "SINGLE" in r.get("OBJECT_NAME", "")), stack)
        if stack:
            out["variants"].append({**v, "stack": compact(stack), "single": compact(single)})
    return out


# ---- manifest ---------------------------------------------------------------------


def previous_variants(manifest: dict | None) -> dict[str, dict]:
    found = {}
    for l in (manifest or {}).get("launches", []):
        for v in ((l.get("prelaunch") or {}).get("variants") or []):
            found[v["file"]] = v
    return found


def build(get: Callable[[str], str], now: dt.datetime | None = None, previous: dict | None = None) -> dict:
    now = now or dt.datetime.now(dt.timezone.utc)
    launches = []
    for rec in fetch_ll2(get):
        l = simplify(rec)
        net = parse_time(l["net"])
        if net and now - LOOKBACK <= net <= now + LOOKAHEAD and l["pad"]["lat"] is not None:
            launches.append(l)
    launches.sort(key=lambda l: l["net"])

    try:
        entries = parse_prelaunch_index(get(SUPGP))
    except (NotUpdated, urllib.error.URLError) as err:
        print(f"launches: CelesTrak index unavailable ({err}); reusing previous pre-launch data", file=sys.stderr)
        entries = []
    prev = previous_variants(previous)
    prev_by_id = {l["id"]: l.get("prelaunch") for l in (previous or {}).get("launches", [])}
    for l in launches:
        entry = match_prelaunch(l, entries)
        if entry:
            l["prelaunch"] = attach_elements(entry, get, prev)
        elif prev_by_id.get(l["id"]):
            l["prelaunch"] = prev_by_id[l["id"]]
    return {
        "generated": iso(now),
        "source": "Launch Library 2 (The Space Devs); CelesTrak SupGP pre-launch data provided by SpaceX",
        "launches": launches,
    }


def write(manifest: dict, out_dir: Path) -> Path:
    out_dir.mkdir(parents=True, exist_ok=True)
    tmp = out_dir / (MANIFEST + ".tmp")
    tmp.write_text(json.dumps(manifest, separators=(",", ":")) + "\n", encoding="utf-8")
    os.replace(tmp, out_dir / MANIFEST)
    return out_dir / MANIFEST


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(prog="xearth_clouds.launches", description=__doc__.split("\n\n")[0])
    ap.add_argument("--out", type=Path, required=True)
    args = ap.parse_args(argv)
    try:
        previous = json.loads((args.out / MANIFEST).read_text(encoding="utf-8"))
    except (FileNotFoundError, ValueError):
        previous = None
    manifest = build(_get, previous=previous)
    path = write(manifest, args.out)
    with_orbit = sum(1 for l in manifest["launches"] if l.get("prelaunch"))
    print(f"wrote {path}: {len(manifest['launches'])} launches, {with_orbit} with pre-launch orbits")
    return 0


if __name__ == "__main__":
    sys.exit(main())
