import datetime as dt
import json
from pathlib import Path

from xearth_clouds import launches
from xearth_clouds.satellites import NotUpdated

FIX = Path(__file__).parent / "fixtures"
ROW = (FIX / "supgp_prelaunch_row.html").read_text(encoding="utf-8")  # real CelesTrak index row, 2026-10-21
F9 = json.loads((FIX / "ll2_falcon9_starlink.json").read_text(encoding="utf-8"))  # real LL2 record
SUPGP = (FIX / "supgp_starlink-g15-15.json").read_text(encoding="utf-8")


def test_parses_prelaunch_entry_with_primary_and_backups():
    [entry] = launches.parse_prelaunch_index(ROW)
    assert entry["title"] == "Starlink G15-15"
    primary, b1 = entry["variants"][0], entry["variants"][1]
    assert primary == {
        "file": "starlink-g15-15",
        "launch": "2026-10-21T23:02:41.000Z",
        "deploy": "2026-10-22T00:04:56.560Z",
        "windowStart": "2026-10-21T23:02:41.000Z",
        "windowEnd": "2026-10-21T23:03:10.000Z",
    }
    assert b1["file"] == "starlink-g15-15b1"
    assert b1["launch"] == "2026-10-21T23:04:47.000Z"
    assert len(entry["variants"]) == 11  # primary + 10 backup opportunities


def test_simplifies_a_launch_library_record():
    l = launches.simplify(F9)
    assert l["rocket"] == "Falcon 9 Block 5"
    assert l["mission"] == "Starlink Group 15-15"
    assert l["net"] == "2026-10-21T23:02:41Z"
    assert l["pad"]["lat"] == 34.632 and l["pad"]["lon"] == -120.611
    assert l["status"]["abbrev"] == "Go"


def test_matches_by_launch_time_including_backups():
    entries = launches.parse_prelaunch_index(ROW)
    l = launches.simplify(F9)
    assert launches.match_prelaunch(l, entries)["title"] == "Starlink G15-15"
    # A hold to backup opportunity #2 (23:15:19) still matches the same entry.
    assert launches.match_prelaunch({**l, "net": "2026-10-21T23:15:19Z"}, entries)
    # A launch at an unrelated time does not.
    assert launches.match_prelaunch({**l, "net": "2026-10-22T07:00:00Z"}, entries) is None


def fake_get(responses, calls=None):
    def get(url):
        if calls is not None:
            calls.append(url)
        for key, value in responses.items():
            if key in url:
                if isinstance(value, Exception):
                    raise value
                return value
        raise AssertionError(url)

    return get


def test_build_attaches_stack_and_single_elements():
    calls = []
    get = fake_get(
        {
            "launches/upcoming": json.dumps({"results": [F9]}),
            "launches/previous": json.dumps({"results": []}),
            "sup-gp.php": SUPGP,
            "supplemental/": ROW,
        },
        calls,
    )
    now = dt.datetime(2026, 10, 21, 18, 30, tzinfo=dt.timezone.utc)
    m = launches.build(get, now=now)
    [l] = m["launches"]
    v = l["prelaunch"]["variants"][0]
    assert v["stack"][0] == 72000 and v["single"][0] == 72001
    assert abs(v["stack"][4] - 70.01) < 0.01  # inclination
    assert len(l["prelaunch"]["variants"]) == 11
    assert sum("launches/" in c for c in calls) == 2  # LL2: upcoming + previous only


def test_not_updated_reuses_previous_elements_and_old_launches_drop_out():
    previous = {
        "launches": [
            {"id": F9["id"], "prelaunch": {"title": "x", "variants": [{"file": "starlink-g15-15", "launch": "p", "stack": ["old"]}]}}
        ]
    }
    get = fake_get(
        {
            "launches/upcoming": json.dumps({"results": [F9]}),
            "launches/previous": json.dumps({"results": []}),
            "sup-gp.php": NotUpdated("GP data has not updated"),
            "supplemental/": ROW,
        }
    )
    now = dt.datetime(2026, 10, 21, 18, 30, tzinfo=dt.timezone.utc)
    [l] = launches.build(get, now=now, previous=previous)["launches"]
    assert l["prelaunch"]["variants"] == [{"file": "starlink-g15-15", "launch": "p", "stack": ["old"]}]

    later = dt.datetime(2026, 10, 24, tzinfo=dt.timezone.utc)  # > 1 day after the launch
    assert launches.build(get, now=later, previous=previous)["launches"] == []
