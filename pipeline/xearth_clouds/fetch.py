"""Find and download the newest GMGSI longwave-infrared file from NOAA's open bucket."""

from __future__ import annotations

import datetime as dt
import re
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from pathlib import Path

BUCKET_URL = "https://noaa-gmgsi-pds.s3.amazonaws.com"
PRODUCT = "GMGSI_LW"
_NS = {"s3": "http://s3.amazonaws.com/doc/2006-03-01/"}
_START = re.compile(r"_s(\d{12})\d*_")


def _list_keys(prefix: str) -> list[str]:
    keys: list[str] = []
    token = None
    while True:
        url = f"{BUCKET_URL}/?list-type=2&prefix={prefix}"
        if token:
            url += f"&continuation-token={urllib.parse.quote(token)}"
        with urllib.request.urlopen(url, timeout=30) as resp:
            root = ET.fromstring(resp.read())
        keys += [el.text for el in root.findall("s3:Contents/s3:Key", _NS) if el.text]
        if root.findtext("s3:IsTruncated", default="false", namespaces=_NS) != "true":
            return keys
        token = root.findtext("s3:NextContinuationToken", namespaces=_NS)


def scan_start(key: str) -> dt.datetime | None:
    """Scan start time encoded in a GMGSI file name (`_sYYYYMMDDhhmm…_`)."""
    m = _START.search(key)
    if not m:
        return None
    return dt.datetime.strptime(m.group(1), "%Y%m%d%H%M").replace(tzinfo=dt.timezone.utc)


def latest_key(now: dt.datetime | None = None, lookback_days: int = 2) -> str:
    """Newest `.nc` key, searching today's folder first and stepping back a day at a time."""
    now = now or dt.datetime.now(dt.timezone.utc)
    for back in range(lookback_days + 1):
        day = now - dt.timedelta(days=back)
        keys = [k for k in _list_keys(f"{PRODUCT}/{day:%Y/%m/%d}/") if k.endswith(".nc")]
        dated = [(scan_start(k), k) for k in keys]
        dated = [(t, k) for t, k in dated if t is not None]
        if dated:
            return max(dated)[1]
    raise RuntimeError(f"no {PRODUCT} files in the last {lookback_days} days")


def download(key: str, dest_dir: Path) -> Path:
    dest_dir.mkdir(parents=True, exist_ok=True)
    dest = dest_dir / Path(key).name
    if not dest.exists():
        tmp = dest.with_suffix(".part")
        urllib.request.urlretrieve(f"{BUCKET_URL}/{key}", tmp)
        tmp.replace(dest)
    return dest
