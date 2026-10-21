"""CLI: `python -m xearth_clouds --out web/public/clouds [--input file.nc] [--force]`."""

from __future__ import annotations

import argparse
import sys
import tempfile
from pathlib import Path

from . import convert, fetch, publish


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(prog="xearth_clouds", description=__doc__)
    ap.add_argument("--out", type=Path, required=True, help="directory the web app serves clouds/ from")
    ap.add_argument("--input", type=Path, help="use a local GMGSI_LW .nc instead of fetching the newest")
    ap.add_argument("--cache", type=Path, help="where downloads are kept (default: a temp dir)")
    ap.add_argument("--force", action="store_true", help="rebuild even if latest.json already has this file")
    args = ap.parse_args(argv)

    if args.input:
        path, key = args.input, args.input.name
    else:
        key = fetch.latest_key()
        current = publish.read_manifest(args.out)
        if current and current.get("sourceKey") == key and not args.force:
            print(f"up to date: {key}")
            return 0
        cache = args.cache or Path(tempfile.gettempdir()) / "xearth-gmgsi"
        print(f"downloading {key}")
        path = fetch.download(key, cache)

    mosaic = convert.read_gmgsi(str(path))
    alpha = convert.cloud_map(mosaic)
    manifest = publish.publish(alpha, args.out, time=mosaic.time, source_key=key, coverage=mosaic.lat_range)
    print(f"wrote {args.out / manifest['url']} ({manifest['t']})")
    return 0


if __name__ == "__main__":
    sys.exit(main())
