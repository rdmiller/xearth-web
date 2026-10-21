"""CLI: `python -m xearth_clouds --out web/public/clouds [--input file.nc] [--force]`."""

from __future__ import annotations

import argparse
import datetime as dt
import sys
import tempfile
from pathlib import Path

from . import convert, fetch, publish


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(prog="xearth_clouds", description=__doc__)
    ap.add_argument("--out", type=Path, required=True, help="directory the web app serves clouds/ from")
    ap.add_argument("--input", type=Path, help="use a local GMGSI_LW .nc instead of fetching the newest")
    ap.add_argument("--vis", type=Path, help="with --input: the matching GMGSI_VIS .nc (day-side low cloud)")
    ap.add_argument(
        "--surface",
        type=Path,
        help="Blue Marble day texture for the visible band's clear-sky reference "
        "(default: textures/day-MM.jpg beside --out; without one, IR only)",
    )
    ap.add_argument("--cache", type=Path, help="where downloads are kept (default: a temp dir)")
    ap.add_argument("--force", action="store_true", help="rebuild even if latest.json already has this file")
    args = ap.parse_args(argv)

    vis_path = None
    if args.input:
        path, key = args.input, args.input.name
        vis_path = args.vis
    else:
        key = fetch.latest_key()
        current = publish.read_manifest(args.out)
        if current and current.get("sourceKey") == key and not args.force:
            print(f"up to date: {key}")
            return 0
        cache = args.cache or Path(tempfile.gettempdir()) / "xearth-gmgsi"
        print(f"downloading {key}")
        path = fetch.download(key, cache)
        vis_key = fetch.matching_key(key)
        if vis_key:
            print(f"downloading {vis_key}")
            vis_path = fetch.download(vis_key, cache)
        else:
            print("no matching visible-band file yet; infrared only")

    mosaic = convert.read_gmgsi(str(path))
    vis = convert.read_gmgsi(str(vis_path)) if vis_path else None
    surface_path = args.surface or args.out.parent / "textures" / f"day-{dt.datetime.fromtimestamp(mosaic.time, dt.timezone.utc):%m}.jpg"
    surface = convert.load_surface(str(surface_path)) if vis is not None and surface_path.exists() else None
    if vis is not None and surface is None:
        print(f"no surface map at {surface_path}; infrared only (the visible band needs a clear-sky reference)")
    alpha = convert.cloud_map(mosaic, vis=vis, surface_rgb=surface)
    manifest = publish.publish(
        alpha,
        args.out,
        time=mosaic.time,
        source_key=key,
        coverage=mosaic.lat_range,
        source="NOAA/NESDIS GMGSI longwave IR + visible (day side)" if surface is not None else "NOAA/NESDIS GMGSI longwave IR",
    )
    print(f"wrote {args.out / manifest['url']} ({manifest['t']})")
    return 0


if __name__ == "__main__":
    sys.exit(main())
