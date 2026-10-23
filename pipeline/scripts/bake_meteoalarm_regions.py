"""Bake MeteoAlarm's warning regions into xearth_clouds/meteoalarm_regions.json.gz: each
EMMA_ID region's outline, simplified to ~1 km, for the meteoalarm job to attach to warnings.

MeteoAlarm publishes its geocodes (33 MB, 2006 regions) in its documents repository, a new
dated file when members change their regions. Croatia's counties (HR011–HR031), which its
warnings use, aren't in it yet; they come from Natural Earth's admin-1 provinces (public
domain), named as Croatia names them, so the job finds them by name.

Regions change rarely, so this runs by hand, not in the pipeline:

    python -I pipeline/scripts/bake_meteoalarm_regions.py [geocodes.json] [ne_10m_admin_1.geojson]

(paths to already downloaded copies, or nothing to fetch both).
"""

from __future__ import annotations

import gzip
import json
import sys
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from xearth_clouds.meteoalarm import REGIONS, TOLERANCE, simplify_polygons  # noqa: E402

GEOCODES_FILE = "MeteoAlarm_Geocodes_2026_07_31.json"
GEOCODES = f"https://gitlab.com/meteoalarm-pm-group/documents/-/raw/master/{GEOCODES_FILE}"
NATURAL_EARTH = "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/v5.1.2/geojson/ne_10m_admin_1_states_provinces.geojson"
# Natural Earth 5.1.2 names Požega-Slavonia "Brodsko-Posavska" too; it's the one holding Požega.
POZEGA = (17.685, 45.340)
# Misspellings in the geocode file, which the job would otherwise fail to match warnings to.
RENAMES = {("BG", "Targovoshte"): "Targovishte"}


def load(arg: str | None, url: str) -> dict:
    if arg:
        return json.loads(Path(arg).read_text(encoding="utf-8"))
    print(f"fetching {url}", file=sys.stderr)
    with urllib.request.urlopen(url, timeout=600) as r:
        return json.load(r)


def polygons(geometry: dict) -> list:
    if geometry["type"] == "Polygon":
        return [geometry["coordinates"]]
    if geometry["type"] == "MultiPolygon":
        return geometry["coordinates"]
    return []


def inside(x: float, y: float, polys: list) -> bool:
    hit = False
    for poly in polys:
        for ring in poly:
            for (xi, yi), (xj, yj) in zip(ring, ring[-1:] + ring[:-1]):
                if (yi > y) != (yj > y) and x < (xj - xi) * (y - yi) / (yj - yi) + xi:
                    hit = not hit
    return hit


def main(argv: list[str]) -> int:
    geocodes = load(argv[0] if argv else None, GEOCODES)
    ne = load(argv[1] if len(argv) > 1 else None, NATURAL_EARTH)
    regions: dict[str, dict] = {}
    for f in geocodes["features"]:
        p = f["properties"]
        out = simplify_polygons(polygons(f["geometry"]))
        if out:
            name = RENAMES.get((p["country"], p["name"]), p["name"])
            regions[p["code"]] = {"name": name, "country": p["country"], "polygons": out}
        else:
            print(f"no outline: {p['code']} {p['name']}", file=sys.stderr)
    for f in ne["features"]:
        p = f["properties"]
        if p.get("adm0_a3") != "HRV":
            continue
        polys = polygons(f["geometry"])
        code, name = p["iso_3166_2"], p["name"]
        if name == "Brodsko-Posavska" and inside(*POZEGA, polys):
            code, name = "HR-11", "Požeško-slavonska"
        regions[code] = {"name": name, "country": "HR", "polygons": simplify_polygons(polys)}
    points = sum(len(r) for v in regions.values() for poly in v["polygons"] for r in poly)
    doc = {
        "source": f"MeteoAlarm geocodes ({GEOCODES_FILE}); Croatia's counties from Natural Earth 5.1.2 admin-1",
        "tolerance": TOLERANCE,
        "regions": dict(sorted(regions.items())),
    }
    raw = json.dumps(doc, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
    with gzip.GzipFile(REGIONS, "wb", mtime=0) as g:
        g.write(raw)
    print(f"wrote {REGIONS}: {len(regions)} regions, {points:,} points, {len(raw) / 1e6:.1f} MB ({REGIONS.stat().st_size / 1e6:.2f} MB gzipped)")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
