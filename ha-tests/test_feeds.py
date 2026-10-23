from datetime import UTC, datetime, timedelta

from custom_components.xearth import feeds
from custom_components.xearth.feeds import Quake

from conftest import FEEDS, NOW

HOME = (32.87336, -117.22743)


def test_feed_urls_sit_beside_the_site():
    urls = feeds.feed_urls("https://host/xearth/")
    assert urls["clouds"] == "https://host/xearth/clouds/latest.json"
    assert urls["quakes"].startswith("https://earthquake.usgs.gov/")
    assert urls["kp"] == "https://services.swpc.noaa.gov/products/noaa-planetary-k-index.json"


def test_space_weather():
    sw = feeds.space_weather(FEEDS)
    assert sw.kp == 5.33
    assert sw.kp_time == datetime(2026, 10, 22, 18, tzinfo=UTC)
    assert (sw.xray, sw.flare) == ("B6.5", "B8.7")
    assert sw.flare_time == datetime(2026, 10, 22, 21, 10, tzinfo=UTC)
    assert (sw.wind_kms, sw.bt_nt, sw.bz_nt) == (427, 6, -3)


def test_space_weather_with_feeds_missing_or_odd():
    sw = feeds.space_weather({"kp": [], "flares": {"not": "a list"}, "wind": [{"proton_speed": None}]})
    assert sw == feeds.SpaceWeather()


def test_storm_level():
    assert feeds.storm_level(4.67) is None
    assert feeds.storm_level(5.0) == "G1"
    assert feeds.storm_level(7.33) == "G3"
    assert feeds.storm_level(9.0) == "G5"


def test_compass_and_rounding_like_javascript():
    assert feeds.compass(0) == "N"
    assert feeds.compass(359) == "N"
    assert feeds.compass(258) == "WSW"
    assert feeds.compass(-45) == "NW"
    # 11.25° is exactly between N and NNE: Math.round goes up.
    assert feeds.compass(11.25) == "NNE"
    assert feeds.where(9.9, 0) == "nearby"
    assert feeds.where(120.5, 45) == "121 km NE"
    assert feeds.where(160.9344, 90, imperial=True) == "100 mi E"


def test_distance():
    km, bearing = feeds.distance_km(51.5, -0.12, 48.86, 2.35)  # London → Paris
    assert 335 < km < 350
    assert feeds.compass(bearing) == "SSE"


def test_titles():
    assert feeds.title_case("TROPICAL STORM MELISSA") == "Tropical Storm Melissa"
    assert feeds.title_case("FLOOD · JAMAICA") == "Flood · Jamaica"
    assert feeds.storm_title({"name": "Melissa", "cls": "HU", "pos": [-77.5, 16.8]}) == "HURRICANE MELISSA"
    assert feeds.storm_title({"name": "Fung-wong", "cls": "HU", "pos": [130, 20]}) == "TYPHOON FUNG-WONG"
    assert feeds.storm_title({"name": "Alfred", "cls": "MH", "pos": [150, -20]}) == "CYCLONE ALFRED"
    assert feeds.storm_title({"name": "x", "cls": "TS", "pos": [0, 0], "nhc": {"name": "Vance"}}) == "TROPICAL STORM VANCE"


def test_next_launch_skips_finished_and_keeps_a_hold_past_its_net():
    assert feeds.next_launch(FEEDS["launches"], NOW)["id"] == "f6af629d"
    later = NOW + timedelta(days=1)
    assert feeds.next_launch(FEEDS["launches"], later)["id"] == "later"
    assert feeds.next_launch(FEEDS["launches"], NOW + timedelta(days=3)) is None


def test_tsunami_statements_show_for_a_day_and_alerts_always():
    statement = {"category": "information", "issued": "2026-10-22T00:00:00Z"}
    assert feeds.tsunami_shown(statement, NOW)
    assert not feeds.tsunami_shown(statement, NOW + timedelta(hours=2))
    assert feeds.tsunami_shown({"category": "warning", "issued": None}, NOW)


def test_quakes_largest_first_without_unmeasured():
    quakes = feeds.decode_quakes(FEEDS["quakes"])
    assert [q.id for q in quakes] == ["us1", "ci1"]
    assert (quakes[0].lat, quakes[0].lon, quakes[0].depth_km, quakes[0].tsunami) == (38.0, 142.0, 30.0, True)
    assert feeds.decode_quakes({"type": "nope"}) is None


def test_nearby_hazards_as_the_app_finds_them():
    """web/src/__tests__/locale.test.ts 'finds what the layers have near a place', ported."""
    now = datetime(2026, 10, 22, 12, tzinfo=UTC)
    now_ms = now.timestamp() * 1000
    lat, lon = 17.97, -76.79  # Kingston, Jamaica
    storms = {
        "storms": [
            {"id": "a", "name": "Melissa", "source": "", "alert": "Red", "pos": [-77.5, 16.8], "cls": "HU", "peakWindKmh": 250, "segments": []},
            {"id": "b", "name": "Far", "source": "", "alert": "Green", "pos": [140, 20], "cls": "TS", "peakWindKmh": 80, "segments": []},
        ]
    }
    quakes = [
        Quake("q1", 5.2, "", now_ms - 3 * 3_600_000, 18.5, -77.5, 10, False, None),
        Quake("q2", 6.8, "", now_ms - 3_600_000, 35, 140, 10, False, None),
        Quake("q3", 5.9, "", now_ms - 3 * 86_400_000, 18, -76.8, 10, False, None),
    ]
    events = {"events": [{"id": "f", "type": "FL", "name": "Jamaica", "country": "Jamaica", "alert": "Orange", "pos": [-77.2, 18.2], "from": None, "to": None, "url": ""}]}
    lightning = {"windowMin": 15, "cellDeg": 0.1, "data": [180, -768, 5, 2, 400, 400, 2, 1]}
    fires = {"cellDeg": 0.1, "data": [180, -768, 50, 3, 3]}
    tsunami = {"bulletins": [{"id": "t", "center": "PTWC", "category": "threat", "region": "Caribbean Sea", "lat": 17, "lon": -78, "magnitude": 7.1, "issued": None}]}
    src = {"storms": storms, "quakes": quakes, "events": events, "lightning": lightning, "fires": fires, "tsunami": tsunami}

    alerts = feeds.nearby_hazards(lat, lon, src, now)
    assert [a.title for a in alerts] == [
        "Hurricane Melissa",
        "Tsunami threat (PTWC)",
        "M5.2 earthquake",
        "Flood · Jamaica",
        "Lightning nearby",
        "Active fires detected",
    ]
    assert [a.kind for a in alerts] == ["storm", "tsunami", "quake", "event", "lightning", "fire"]
    assert alerts[0].level == "warning"
    assert alerts[0].impact == 3
    assert alerts[2].detail.endswith(" km NW · 3 h ago")
    assert alerts[3].detail.endswith(" km WNW")
    assert alerts[3].impact == 2
    assert alerts[4].detail == "5 flashes within 50 km in the last 15 min"
    assert alerts[5].detail == "3 satellite detections within 25 km"
    assert "within 30 mi" in feeds.nearby_hazards(lat, lon, src, now, imperial=True)[4].detail
    assert feeds.highest_level(alerts) == "warning"


def test_nearby_hazards_with_nothing_loaded():
    assert feeds.nearby_hazards(17.97, -76.79, {}, NOW) == []
    assert feeds.highest_level([]) is None


def test_summarise_everything():
    snap = feeds.summarise(FEEDS, *HOME, NOW)
    assert snap.present == set(FEEDS)
    assert snap.launch["id"] == "f6af629d"
    assert 360 < snap.launch_distance.km < 380  # Vandenberg
    assert snap.nearest_quake.item.id == "ci1"
    assert [n.item["name"] for n in snap.storms] == ["Raymond", "Vance"]
    assert snap.nearest_lightning.km < 6
    assert snap.nearest_lightning.item[:4] == (32.9, -117.2, 5, 3)
    assert snap.nearest_fire.km < 4
    assert "data" not in snap.fires and snap.fires["detections"] == 5
    assert [n.item["id"] for n in snap.events_by_type["WF"]] == ["WF-1"]
    assert [b["id"] for b in snap.tsunami] == ["a"]
    assert [a.kind for a in snap.nearby] == ["storm", "quake", "event", "lightning", "fire"]
    assert snap.generated["clouds"] == datetime(2026, 10, 22, 22, 55, 38, tzinfo=UTC)


def test_summarise_leaves_out_bad_records_not_the_feed():
    raw = {key: FEEDS[key] for key in ("storms", "events", "tsunami", "quakes", "launches")}
    raw["storms"] = FEEDS["storms"] | {"storms": [*FEEDS["storms"]["storms"], {"name": "No position"}, "junk"]}
    raw["events"] = FEEDS["events"] | {"events": [*FEEDS["events"]["events"], {"type": "FL", "pos": [None, 3]}]}
    raw["tsunami"] = FEEDS["tsunami"] | {"bulletins": [*FEEDS["tsunami"]["bulletins"], {"category": "warning", "lat": "?"}]}
    raw["quakes"] = FEEDS["quakes"] | {"features": [*FEEDS["quakes"]["features"], {"properties": {"mag": 4}, "geometry": {"coordinates": [1]}}, None]}
    raw["launches"] = FEEDS["launches"] | {"launches": [None, *FEEDS["launches"]["launches"]]}
    snap = feeds.summarise(raw, *HOME, NOW)
    assert {"storms", "events", "tsunami", "quakes", "launches"} <= snap.present
    assert [n.item["name"] for n in snap.storms] == ["Raymond", "Vance"]
    assert sum(len(v) for v in snap.events_by_type.values()) == 3
    assert [b["id"] for b in snap.tsunami] == ["a"]
    assert len(snap.quakes) == 2
    assert snap.launch["id"] == "f6af629d"
    # The original bodies, which the coordinator caches, are as they were.
    assert len(raw["storms"]["storms"]) == 4


def test_summarise_with_feeds_missing_or_malformed():
    raw = {"kp": FEEDS["kp"], "clouds": {"generated": "x"}, "fires": {"generated": "x", "data": [1]}, "quakes": "garbage"}
    snap = feeds.summarise(raw, *HOME, NOW)
    assert snap.present == {"kp"}
    assert snap.fires is None and snap.quakes is None and snap.storms is None
    assert snap.nearby == []
