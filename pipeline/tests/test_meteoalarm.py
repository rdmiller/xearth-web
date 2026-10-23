import copy
import datetime as dt
import json
from pathlib import Path

from xearth_clouds import meteoalarm as ma

FIX = Path(__file__).parent / "fixtures"
# Real warnings from feeds.meteoalarm.org, 2026-10-23 19:31 UTC: a few from each of seven
# countries, as each sends its areas (EMMA_ID codes, FIPS counties, CAP polygons, NUTS codes).
FEEDS = json.loads((FIX / "meteoalarm_feeds.json").read_text(encoding="utf-8"))["feeds"]
NOW = dt.datetime(2026, 10, 23, 19, 31, tzinfo=dt.timezone.utc)
REGIONS = ma.load_regions()


def get(url):
    slug = url.rsplit("feeds-", 1)[1]
    return json.dumps(FEEDS.get(slug, {"warnings": []}))


def test_levels_and_types():
    assert ma.parse_level("3; orange; Severe") == 3
    assert ma.parse_level("2; Yellow; Moderate") == 2
    assert ma.parse_level("") == 0
    assert ma.parse_type("10; Rain") == 10


def test_names_match_across_spellings():
    assert ma.norm_name("Caraș-Severin") == ma.norm_name("CARAS-SEVERIN") == "caras severin"
    assert ma.norm_name("Skopje region") == ma.norm_name("Skopje Region") == "skopje"
    assert ma.norm_name("County Cork") == "cork"
    assert ma.norm_name("Međimurska") == ma.norm_name("Medimurska")


def test_cap_polygon_is_lon_lat():
    assert ma.cap_polygon("46.5,6.6 46.6,6.7 46.5,6.8 46.5,6.6") == [[6.6, 46.5], [6.7, 46.6], [6.8, 46.5], [6.6, 46.5]]
    assert ma.cap_polygon("46.5,6.6 x") is None


def test_simplify_winds_outlines_anticlockwise_and_holes_clockwise():
    square = [[0, 0], [0, 1], [1, 1], [1, 0], [0, 0]]  # clockwise
    hole = [[0.25, 0.25], [0.75, 0.25], [0.75, 0.75], [0.25, 0.75], [0.25, 0.25]]  # anticlockwise
    [[outer, inner]] = ma.simplify_polygons([[square, hole]])
    assert ma.ring_area(outer) == 1 and ma.ring_area(inner) == -0.25


def test_simplify_drops_wiggles_and_keeps_a_lone_island():
    # A 0.001° zigzag along one side is under the tolerance: a square is left.
    wiggly = [[x / 100, 0.001 * (x % 2)] for x in range(101)] + [[1, 1], [0, 1], [0, 0]]
    assert ma.simplify_polygons([[wiggly]]) == [[[[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]]]
    # An islet smaller than the tolerance goes beside a larger polygon, but is kept on its own.
    islet = [[0, 0], [0.004, 0], [0.004, 0.004], [0, 0.004], [0, 0]]
    big = [[5, 5], [6, 5], [6, 6], [5, 5]]
    assert ma.simplify_polygons([[islet], [big]]) == [[big]]
    assert ma.simplify_polygons([[islet]]) == [[islet]]


def test_regions_cover_every_way_an_area_is_given():
    places = ma.Places(REGIONS)
    # One EMMA_ID; several in one area (Irish sea areas); FIPS counties; Belgium's NUTS 2.
    assert places.keys({"areaDesc": "Kreis Harz", "geocode": [{"valueName": "EMMA_ID", "value": "DE093"}]}, "DE") == ["DE093"]
    sea = {"areaDesc": "Erris Head to Belfast Lough", "geocode": [{"valueName": "EMMA_ID", "value": c} for c in ("EI820", "EI805")]}
    assert places.keys(sea, "IE") == ["EI805", "EI820"]
    assert places.keys({"areaDesc": "Dublin, Wicklow", "geocode": [{"valueName": "FIPS", "value": "EI07"}, {"valueName": "FIPS", "value": "EI31"}]}, "IE") == ["IE011", "IE012"]
    assert places.keys({"areaDesc": "West Flanders", "geocode": [{"valueName": "NUTS2", "value": "BE25"}]}, "BE") == ["BE009"]
    # NUTS 3 only, by name (including the geocode file's misspelt Targovishte).
    assert places.keys({"areaDesc": "Targovishte", "geocode": [{"valueName": "NUTS3", "value": "BG334"}]}, "BG") != []
    assert places.keys({"areaDesc": "Bacău", "geocode": [{"valueName": "NUTS3", "value": "RO211"}]}, "RO") != []
    # Croatia's counties, newer than the geocode file, from Natural Earth; Požega-Slavonia too.
    assert places.keys({"areaDesc": "Požeško-slavonska", "geocode": [{"valueName": "EMMA_ID", "value": "HR021"}]}, "HR") == ["HR-11"]
    assert places.keys({"areaDesc": "Atlantis", "geocode": [{"valueName": "NUTS3", "value": "XX000"}]}, "BG") == []
    assert places.unplaced == {"BG Atlantis"}
    # The name a single region is shown by is the warning's.
    assert places.used["BE009"]["name"] == "West Flanders"


def test_cap_polygons_become_regions_once():
    places = ma.Places(REGIONS)
    area = {"areaDesc": "Lausanne", "polygon": ["46.5,6.6 46.6,6.7 46.5,6.8 46.5,6.6"]}
    [key] = places.keys(area, "CH")
    assert places.keys(dict(area), "CH") == [key] and key.startswith("p")
    assert places.used[key]["name"] == "Lausanne"


def test_build_keeps_warnings_in_force_in_english_worst_first():
    m = ma.build(get, REGIONS, NOW)
    assert len(m["countries"]) == len(ma.COUNTRIES) and m["failed"] == [] and m["unplaced"] == []
    ws = m["warnings"]
    assert [w["level"] for w in ws] == sorted((w["level"] for w in ws), reverse=True)
    red = ws[0]
    assert (red["country"], red["level"], red["type"], red["event"]) == ("DE", 4, 1, "hurricane-force gusts")
    assert (red["onset"], red["expires"]) == ("2026-10-23T18:00:00.000Z", "2026-10-24T12:00:00.000Z")  # +02:00 → UTC
    assert red["regions"] == ["DE093"] and red["sender"] == "Deutscher Wetterdienst"
    # The expired German warning and Italy's and Bulgaria's green ones are left out.
    assert {w["country"] for w in ws} == {"DE", "IE", "BE", "CH", "HR"}
    assert sum(w["country"] == "DE" for w in ws) == 2
    # Belgium sends Dutch, French and English: English it is.
    [be] = [w for w in ws if w["country"] == "BE"]
    assert be["areas"] == "West Flanders" and be["type"] == 10
    # Every region a warning names has an outline, and no others are sent.
    assert set(m["regions"]) == {k for w in ws for k in w["regions"]}
    assert all(r["polygons"] for r in m["regions"].values())


def test_build_lookahead_and_levels():
    later = NOW + dt.timedelta(days=3)
    assert ma.build(get, REGIONS, later)["warnings"] == []
    # Raise Bulgaria's green warning to yellow: it's placed by its names.
    feeds = copy.deepcopy(FEEDS)
    for info in feeds["bulgaria"]["warnings"][0]["alert"]["info"]:
        for p in info["parameter"]:
            if p["valueName"] == "awareness_level":
                p["value"] = "2; yellow; Moderate"
    m = ma.build(lambda url: json.dumps(feeds.get(url.rsplit("feeds-", 1)[1], {"warnings": []})), REGIONS, NOW)
    [bg] = [w for w in m["warnings"] if w["country"] == "BG"]
    assert bg["regions"] and m["unplaced"] == []


def test_one_feed_failing_keeps_the_others():
    def flaky(url):
        if url.endswith("feeds-germany"):
            raise OSError("503")
        return get(url)

    m = ma.build(flaky, REGIONS, NOW)
    assert m["failed"] == ["DE"] and "DE" not in m["countries"]
    assert all(w["country"] != "DE" for w in m["warnings"]) and m["warnings"]
