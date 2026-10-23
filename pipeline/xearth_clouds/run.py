"""Run every pipeline job into one data directory, once or on the hour.

The same jobs, in the same order, as the GitHub Actions deploy: each runs
in its own process, so a failure or a crash in one (a feed down, a bad
file) only skips that layer for the hour. Clouds go last, since they read
the Blue Marble textures as their clear-sky reference.

    python -m xearth_clouds.run --data /data             # once
    python -m xearth_clouds.run --data /data --loop      # then every hour at :50
    python -m xearth_clouds.run --data /data --check     # healthcheck: has a run finished lately?

GMGSI cloud files land in NOAA's bucket 35–45 minutes after the hour, which
is why the loop runs at :50 (XEARTH_MINUTE / --minute changes it).
XEARTH_SKIP / --skip takes a comma list of jobs to leave out — lightning,
say, which downloads ~70 MB an hour.

After each run, status.json in the data directory records what ran and how
it went; --check reads it.
"""

from __future__ import annotations

import argparse
import datetime as dt
import json
import os
import subprocess
import sys
import time
from pathlib import Path

# (name, module, output folder): the deploy workflow's order.
JOBS: tuple[tuple[str, str, str], ...] = (
    ("satellites", "xearth_clouds.satellites", "satellites"),
    ("launches", "xearth_clouds.launches", "launches"),
    ("storms", "xearth_clouds.storms", "storms"),
    ("fires", "xearth_clouds.fires", "fires"),
    ("lightning", "xearth_clouds.lightning", "lightning"),
    ("events", "xearth_clouds.events", "events"),
    ("snowice", "xearth_clouds.snowice", "snowice"),
    ("smoke", "xearth_clouds.smoke", "smoke"),
    ("tsunami", "xearth_clouds.tsunami", "tsunami"),
    ("ionosphere", "xearth_clouds.ionosphere", "ionosphere"),
    ("meteors", "xearth_clouds.meteors", "meteors"),
    ("buoys", "xearth_clouds.buoys", "buoys"),
    ("clouds", "xearth_clouds", "clouds"),
)
JOB_TIMEOUT_S = 20 * 60
STATUS = "status.json"
# --check passes while the last run finished within this long.
HEALTHY_FOR = dt.timedelta(hours=2)


def parse_skip(raw: str | None) -> set[str]:
    names = {s.strip().lower() for s in (raw or "").split(",") if s.strip()}
    unknown = names - {j[0] for j in JOBS}
    if unknown:
        raise SystemExit(f"unknown job(s) to skip: {', '.join(sorted(unknown))}")
    return names


def next_run(now: dt.datetime, minute: int) -> dt.datetime:
    """The next HH:minute strictly after `now`."""
    at = now.replace(minute=minute, second=0, microsecond=0)
    return at if at > now else at + dt.timedelta(hours=1)


def iso(t: dt.datetime) -> str:
    return t.isoformat(timespec="seconds").replace("+00:00", "Z")


def run_once(data: Path, skip: set[str], run=subprocess.run) -> dict:
    data.mkdir(parents=True, exist_ok=True)
    started = dt.datetime.now(dt.timezone.utc)
    results = {}
    for name, module, folder in JOBS:
        if name in skip:
            results[name] = {"ok": None, "skipped": True}
            continue
        t0 = time.monotonic()
        print(f"[{iso(dt.datetime.now(dt.timezone.utc))}] {name} …", flush=True)
        try:
            proc = run([sys.executable, "-m", module, "--out", str(data / folder)], timeout=JOB_TIMEOUT_S)
            ok, error = proc.returncode == 0, None if proc.returncode == 0 else f"exit {proc.returncode}"
        except subprocess.TimeoutExpired:
            ok, error = False, f"timed out after {JOB_TIMEOUT_S} s"
        except OSError as err:
            ok, error = False, str(err)
        results[name] = {"ok": ok, "seconds": round(time.monotonic() - t0, 1), **({"error": error} if error else {})}
        print(f"    {name}: {'ok' if ok else error} ({results[name]['seconds']} s)", flush=True)
    status = {"started": iso(started), "finished": iso(dt.datetime.now(dt.timezone.utc)), "jobs": results}
    tmp = data / (STATUS + ".tmp")
    tmp.write_text(json.dumps(status, indent=1) + "\n", encoding="utf-8")
    os.replace(tmp, data / STATUS)
    return status


def healthy(data: Path, now: dt.datetime | None = None) -> tuple[bool, str]:
    """A run finished recently. Failed jobs are reported but don't fail the check: a feed being
    down isn't something restarting the container would fix."""
    now = now or dt.datetime.now(dt.timezone.utc)
    try:
        status = json.loads((data / STATUS).read_text(encoding="utf-8"))
        finished = dt.datetime.fromisoformat(status["finished"].replace("Z", "+00:00"))
    except (OSError, ValueError, KeyError) as err:
        return False, f"no run recorded yet ({err.__class__.__name__})"
    age = now - finished
    if age > HEALTHY_FOR:
        return False, f"last run finished {age} ago"
    failed = [k for k, v in status["jobs"].items() if v.get("ok") is False]
    return True, f"last run {iso(finished)}" + (f", failed: {', '.join(failed)}" if failed else "")


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(prog="xearth_clouds.run", description=__doc__.split("\n\n")[0])
    ap.add_argument("--data", type=Path, required=True, help="the directory the web server serves the layers from")
    ap.add_argument("--loop", action="store_true", help="after the first run, run again every hour")
    ap.add_argument("--minute", type=int, default=int(os.environ.get("XEARTH_MINUTE", "50")), help="minute past the hour to run at (default 50)")
    ap.add_argument("--skip", default=os.environ.get("XEARTH_SKIP", ""), help="comma list of jobs to leave out")
    ap.add_argument("--check", action="store_true", help="exit 0 if a run finished within the last 2 h")
    args = ap.parse_args(argv)
    if args.check:
        ok, why = healthy(args.data)
        print(why)
        return 0 if ok else 1
    if not 0 <= args.minute < 60:
        ap.error("--minute must be 0–59")
    skip = parse_skip(args.skip)
    run_once(args.data, skip)
    while args.loop:
        at = next_run(dt.datetime.now(dt.timezone.utc), args.minute)
        print(f"next run {iso(at)}", flush=True)
        time.sleep(max(1.0, (at - dt.datetime.now(dt.timezone.utc)).total_seconds()))
        run_once(args.data, skip)
    return 0


if __name__ == "__main__":
    sys.exit(main())
