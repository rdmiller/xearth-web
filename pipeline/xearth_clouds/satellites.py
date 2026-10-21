"""Publish orbital elements for the satellites xearth-web draws.

Fetches CelesTrak GP data (OMM JSON) for a few named satellites and the
Starlink group, keeps only the fields SGP4 needs, and writes
`satellites/latest.json`. The browser rebuilds OMM records from it and runs
SGP4 with satellite.js.

CelesTrak asks that unchanged data not be re-downloaded (GP data updates every
2 hours, and a repeat download inside that window gets HTTP 403 "GP data has
not updated since your last successful download"). So:
  - a fetch is skipped while the published file is younger than
    `--max-age-hours` (default 3);
  - a 403 "not updated" for one query reuses that query's previous data.

    python -m xearth_clouds.satellites --out web/public/satellites
    python -m xearth_clouds.satellites --out … --seed starlink=starlink.tle   # offline / dev
"""

from __future__ import annotations

import argparse
import datetime as dt
import json
import os
import sys
import urllib.error
import urllib.request
from pathlib import Path
from typing import Callable, Iterable

GP_URL = "https://celestrak.org/NORAD/elements/gp.php"
MANIFEST = "latest.json"
USER_AGENT = "xearth-web (+https://github.com) satellite layer, fetches at most every few hours"

# Named satellites shown with a label, orbit line, and a tracking view.
# Names and colours live in the web app; this list is only what to fetch.
FEATURED = {
    25544: "ISS (ZARYA)",
    48274: "CSS (TIANHE) — Tiangong core module",
    62713: "SATGUS — Mark Rober / CrunchLabs Space Selfie",
}
GROUPS = ("starlink",)

# Order of the compact element arrays; the web app mirrors this.
FIELDS = (
    "NORAD_CAT_ID",
    "EPOCH",  # stored as Unix seconds, ms precision
    "MEAN_MOTION",
    "ECCENTRICITY",
    "INCLINATION",
    "RA_OF_ASC_NODE",
    "ARG_OF_PERICENTER",
    "MEAN_ANOMALY",
    "BSTAR",
    "MEAN_MOTION_DOT",
    "MEAN_MOTION_DDOT",
)

Fetch = Callable[[str], list[dict]]


class NotUpdated(Exception):
    """CelesTrak says this query's data hasn't changed since our last download."""


def http_fetch(query: str) -> list[dict]:
    req = urllib.request.Request(f"{GP_URL}?{query}&FORMAT=json", headers={"User-Agent": USER_AGENT})
    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            body = resp.read().decode("utf-8")
    except urllib.error.HTTPError as err:
        text = err.read().decode("utf-8", "replace")
        if err.code == 403 and "has not updated" in text:
            raise NotUpdated(text.strip()) from err
        raise
    if not body.lstrip().startswith("["):
        # CelesTrak answers bad queries / throttling with plain text.
        raise RuntimeError(f"CelesTrak: {body.strip()[:200]}")
    return json.loads(body)


def epoch_seconds(epoch: str) -> float:
    t = dt.datetime.fromisoformat(epoch.rstrip("Z")).replace(tzinfo=dt.timezone.utc)
    return round(t.timestamp(), 3)


def compact(omm: dict) -> list:
    """OMM record → [norad, epoch_s, n, e, i, raan, argp, M, bstar, ndot, nddot]."""
    return [
        int(omm["NORAD_CAT_ID"]),
        epoch_seconds(omm["EPOCH"]),
        float(omm["MEAN_MOTION"]),
        float(omm["ECCENTRICITY"]),
        float(omm["INCLINATION"]),
        float(omm["RA_OF_ASC_NODE"]),
        float(omm["ARG_OF_PERICENTER"]),
        float(omm["MEAN_ANOMALY"]),
        float(omm["BSTAR"]),
        float(omm["MEAN_MOTION_DOT"]),
        float(omm["MEAN_MOTION_DDOT"]),
    ]


def _tle_float(field: str) -> float:
    """TLE implied-decimal exponent fields: ' 48582-3' → 0.48582e-3."""
    f = field.strip()
    if not f or f in ("00000-0", "00000+0", "-00000-0"):
        return 0.0
    sign = -1.0 if f[0] == "-" else 1.0
    f = f.lstrip("+-")
    mantissa, exp = f[:-2], f[-2:]
    return sign * float(f"0.{mantissa}e{exp}")


def parse_tle(line1: str, line2: str) -> dict:
    """A two-line element set as the OMM fields CelesTrak's JSON would carry."""
    yy = int(line1[18:20])
    year = 1900 + yy if yy >= 57 else 2000 + yy
    epoch = dt.datetime(year, 1, 1, tzinfo=dt.timezone.utc) + dt.timedelta(days=float(line1[20:32]) - 1)
    return {
        "NORAD_CAT_ID": int(line1[2:7]),
        "EPOCH": epoch.strftime("%Y-%m-%dT%H:%M:%S.%f"),
        "MEAN_MOTION_DOT": float(line1[33:43]),
        "MEAN_MOTION_DDOT": _tle_float(line1[44:52]),
        "BSTAR": _tle_float(line1[53:61]),
        "INCLINATION": float(line2[8:16]),
        "RA_OF_ASC_NODE": float(line2[17:25]),
        "ECCENTRICITY": float("0." + line2[26:33].strip()),
        "ARG_OF_PERICENTER": float(line2[34:42]),
        "MEAN_ANOMALY": float(line2[43:51]),
        "MEAN_MOTION": float(line2[52:63]),
    }


def read_tle_file(path: Path) -> list[dict]:
    lines = [ln.rstrip() for ln in path.read_text(encoding="utf-8").splitlines() if ln.strip()]
    pairs = [(a, b) for a, b in zip(lines, lines[1:]) if a.startswith("1 ") and b.startswith("2 ")]
    return [parse_tle(a, b) for a, b in pairs]


def read_manifest(out_dir: Path) -> dict | None:
    try:
        return json.loads((out_dir / MANIFEST).read_text(encoding="utf-8"))
    except (FileNotFoundError, ValueError):
        return None


def is_fresh(out_dir: Path, max_age: dt.timedelta, now: dt.datetime) -> bool:
    manifest = read_manifest(out_dir)
    try:
        generated = dt.datetime.fromisoformat(manifest["generated"].replace("Z", "+00:00"))  # type: ignore[index]
    except (TypeError, KeyError, ValueError):
        return False
    return now - generated < max_age


def build(
    fetch: Fetch,
    featured: Iterable[int] = FEATURED,
    groups: Iterable[str] = GROUPS,
    now: dt.datetime | None = None,
    previous: dict | None = None,
    seeds: dict[str, list[dict]] | None = None,
) -> dict:
    """Assemble the manifest. `previous` supplies data CelesTrak reports as unchanged;
    `seeds` supplies whole groups from local TLE files instead of fetching them."""
    now = now or dt.datetime.now(dt.timezone.utc)
    previous = previous or {}
    seeds = seeds or {}
    objects = {}
    for norad in featured:
        key = str(norad)
        try:
            recs = fetch(f"CATNR={norad}")
        except NotUpdated:
            if key in previous.get("featured", {}):
                objects[key] = previous["featured"][key]
            continue
        if recs:  # a decayed or unknown satellite returns nothing; skip it rather than fail
            objects[key] = compact(recs[0])
    group_data = {}
    for group in groups:
        if group in seeds:
            recs = seeds[group]
        else:
            try:
                recs = fetch(f"GROUP={group}")
            except NotUpdated:
                if group not in previous.get("groups", {}):
                    raise
                group_data[group] = previous["groups"][group]
                continue
        group_data[group] = sorted((compact(r) for r in recs), key=lambda a: a[0])
    return {
        "generated": now.isoformat(timespec="seconds").replace("+00:00", "Z"),
        "source": "CelesTrak GP data (celestrak.org)",
        "fields": list(FIELDS),
        "featured": objects,
        "groups": group_data,
    }


def write(manifest: dict, out_dir: Path) -> Path:
    out_dir.mkdir(parents=True, exist_ok=True)
    tmp = out_dir / (MANIFEST + ".tmp")
    tmp.write_text(json.dumps(manifest, separators=(",", ":")) + "\n", encoding="utf-8")
    os.replace(tmp, out_dir / MANIFEST)
    return out_dir / MANIFEST


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(prog="xearth_clouds.satellites", description=__doc__.split("\n\n")[0])
    ap.add_argument("--out", type=Path, required=True)
    ap.add_argument("--max-age-hours", type=float, default=3.0)
    ap.add_argument("--force", action="store_true")
    ap.add_argument("--seed", action="append", default=[], metavar="GROUP=FILE.tle", help="take a group from a local TLE file")
    args = ap.parse_args(argv)

    now = dt.datetime.now(dt.timezone.utc)
    if not args.force and not args.seed and is_fresh(args.out, dt.timedelta(hours=args.max_age_hours), now):
        print(f"satellites: {args.out / MANIFEST} is under {args.max_age_hours} h old, not refetching")
        return 0
    seeds = {}
    for spec in args.seed:
        group, _, path = spec.partition("=")
        seeds[group] = read_tle_file(Path(path))
    manifest = build(http_fetch, now=now, previous=read_manifest(args.out), seeds=seeds)
    path = write(manifest, args.out)
    counts = ", ".join(f"{len(v)} {k}" for k, v in manifest["groups"].items())
    print(f"wrote {path}: {len(manifest['featured'])} featured, {counts}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
