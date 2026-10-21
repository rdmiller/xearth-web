"""Write the cloud map and its manifest where the web app looks for them.

The manifest (`latest.json`) is written last, atomically, so a client never
sees a manifest pointing at an image that isn't there yet.
"""

from __future__ import annotations

import datetime as dt
import json
import os
from pathlib import Path

import numpy as np
from PIL import Image

MANIFEST = "latest.json"


def read_manifest(out_dir: Path) -> dict | None:
    try:
        return json.loads((out_dir / MANIFEST).read_text(encoding="utf-8"))
    except (FileNotFoundError, json.JSONDecodeError):
        return None


def publish(
    alpha: np.ndarray,
    out_dir: Path,
    *,
    time: int,
    source_key: str,
    coverage: tuple[float, float],
    keep: int = 3,
    quality: int = 82,
) -> dict:
    out_dir.mkdir(parents=True, exist_ok=True)
    stamp = dt.datetime.fromtimestamp(time, dt.timezone.utc)
    name = f"clouds-{stamp:%Y%m%dT%H%MZ}.webp"
    Image.fromarray(alpha, mode="L").convert("RGB").save(out_dir / name, "WEBP", quality=quality, method=6)

    manifest = {
        "t": stamp.isoformat().replace("+00:00", "Z"),
        "url": name,
        "width": int(alpha.shape[1]),
        "height": int(alpha.shape[0]),
        "source": "NOAA/NESDIS GMGSI longwave IR",
        "sourceKey": source_key,
        "coverage": [round(coverage[0], 2), round(coverage[1], 2)],
        "generated": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z"),
    }
    tmp = out_dir / (MANIFEST + ".tmp")
    tmp.write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    os.replace(tmp, out_dir / MANIFEST)

    old = sorted(out_dir.glob("clouds-*.webp"), reverse=True)[keep:]
    for p in old:
        p.unlink()
    return manifest
