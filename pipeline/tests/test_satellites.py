import datetime as dt
import json

from xearth_clouds import satellites

SATGUS = {
    "OBJECT_NAME": "SATGUS",
    "EPOCH": "2026-10-21T04:20:58.140672",
    "MEAN_MOTION": 15.02604421,
    "ECCENTRICITY": 0.00031412,
    "INCLINATION": 97.684,
    "RA_OF_ASC_NODE": 14.4051,
    "ARG_OF_PERICENTER": 60.4357,
    "MEAN_ANOMALY": 299.7181,
    "NORAD_CAT_ID": 62713,
    "BSTAR": 0.00062742107,
    "MEAN_MOTION_DOT": 8.299e-05,
    "MEAN_MOTION_DDOT": 0,
}


def starlink(norad):
    return {**SATGUS, "OBJECT_NAME": f"STARLINK-{norad}", "NORAD_CAT_ID": norad, "INCLINATION": 53.05}


def fake_fetch(calls):
    def fetch(query):
        calls.append(query)
        if query == "CATNR=62713":
            return [SATGUS]
        if query == "CATNR=99999":
            return []  # decayed
        if query in ("GROUP=starlink", "supgp:FILE=starlink"):
            return [starlink(44714), starlink(44713)]
        raise AssertionError(query)

    return fetch


def test_compact_keeps_sgp4_fields_in_order():
    row = satellites.compact(SATGUS)
    assert row[0] == 62713
    assert row[1] == 1792556458.141  # 2026-10-21T04:20:58.141Z
    assert row[2:] == [15.02604421, 0.00031412, 97.684, 14.4051, 60.4357, 299.7181, 0.00062742107, 8.299e-05, 0.0]
    assert len(row) == len(satellites.FIELDS)


def test_build_fetches_featured_and_groups_and_skips_decayed():
    calls = []
    now = dt.datetime(2026, 10, 21, 17, tzinfo=dt.timezone.utc)
    m = satellites.build(fake_fetch(calls), featured=[62713, 99999], groups=["starlink"], now=now)
    assert calls == ["CATNR=62713", "CATNR=99999", "supgp:FILE=starlink"]  # SpaceX-derived first
    assert m["groupSources"]["starlink"].startswith("CelesTrak SupGP")
    assert list(m["featured"]) == ["62713"]
    assert [r[0] for r in m["groups"]["starlink"]] == [44713, 44714]  # sorted, stable diffs
    assert m["generated"] == "2026-10-21T17:00:00Z"


def test_featured_list_includes_mark_rober_satellite():
    assert 62713 in satellites.FEATURED
    assert "Rober" in satellites.FEATURED[62713]


def test_freshness_gate(tmp_path):
    now = dt.datetime(2026, 10, 21, 17, tzinfo=dt.timezone.utc)
    assert not satellites.is_fresh(tmp_path, dt.timedelta(hours=3), now)
    satellites.write({"generated": "2026-10-21T15:30:00Z"}, tmp_path)
    assert satellites.is_fresh(tmp_path, dt.timedelta(hours=3), now)
    assert not satellites.is_fresh(tmp_path, dt.timedelta(hours=1), now)


def test_tle_parses_to_the_same_elements_as_celestrak_json():
    l1 = "1 62713U 25009DJ  26294.18122848  .00008299  00000+0  62742-3 0  9993"
    l2 = "2 62713  97.6840  14.4051 0003141  60.4357 299.7181 15.02604421 96472"
    a = satellites.compact(satellites.parse_tle(l1, l2))
    b = satellites.compact(SATGUS)
    assert a[0] == b[0]
    assert abs(a[1] - b[1]) < 0.002  # TLE epoch has ~1 ms resolution
    for x, y in zip(a[2:], b[2:]):
        assert abs(x - y) <= max(abs(y) * 2e-4, 1e-9)  # TLE rounds BSTAR to 5 digits


def test_tle_exponent_fields():
    assert satellites._tle_float(" 48582-3") == 0.48582e-3
    assert satellites._tle_float("-11606-4") == -0.11606e-4
    assert satellites._tle_float(" 00000+0") == 0.0


def test_not_updated_reuses_previous_data_and_seeds_skip_the_fetch():
    previous = {"featured": {"62713": ["old-gus"]}, "groups": {"starlink": [["old"]]}}

    def fetch(query):
        raise satellites.NotUpdated("GP data has not updated")

    m = satellites.build(fetch, featured=[62713], groups=["starlink"], previous=previous)
    assert m["featured"]["62713"] == ["old-gus"]
    assert m["groups"]["starlink"] == [["old"]]

    calls = []
    m = satellites.build(fake_fetch(calls), featured=[62713], groups=["starlink"], seeds={"starlink": [starlink(1)]})
    assert calls == ["CATNR=62713"]
    assert m["groups"]["starlink"][0][0] == 1


def test_starlink_falls_back_to_catalogue_gp_when_supgp_fails():
    calls = []

    def fetch(query):
        calls.append(query)
        if query.startswith("supgp:"):
            raise OSError("502")
        return [starlink(44714)] if query == "GROUP=starlink" else [SATGUS]

    m = satellites.build(fetch, featured=[62713], groups=["starlink"])
    assert calls[-2:] == ["supgp:FILE=starlink", "GROUP=starlink"]
    assert m["groupSources"]["starlink"].startswith("CelesTrak GP")
    assert m["groups"]["starlink"][0][0] == 44714


def test_write_is_compact_json(tmp_path):
    m = satellites.build(fake_fetch([]), featured=[62713], groups=["starlink"])
    path = satellites.write(m, tmp_path)
    text = path.read_text()
    assert ", " not in text  # compact separators
    assert json.loads(text)["featured"]["62713"][0] == 62713
