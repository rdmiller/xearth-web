"""Feeds shaped like the live ones (sampled 2026-10-22), placed around the test home.

pytest-homeassistant-custom-component's hass is at 32.87336, -117.22743 (San Diego):
lightning, a fire, a wildfire, a small quake and a hurricane are put near it, and
the rest far away.
"""

from __future__ import annotations

import copy
from datetime import UTC, datetime
from typing import Any

import pytest
from pytest_homeassistant_custom_component.common import MockConfigEntry
from pytest_homeassistant_custom_component.test_util.aiohttp import AiohttpClientMocker

from custom_components.xearth.const import DOMAIN
from custom_components.xearth.feeds import feed_urls

SITE = "https://xearth.example/"
NOW = datetime(2026, 10, 22, 23, 0, tzinfo=UTC)
NOW_MS = int(NOW.timestamp() * 1000)
PAGE = '<!doctype html><html><head><title>xearth web</title></head><body><canvas id="globe"></canvas></body></html>'

FEEDS: dict[str, Any] = {
    "clouds": {
        "t": "2026-10-22T22:00:00Z",
        "url": "clouds-20261022T2200Z.webp",
        "width": 4096,
        "height": 2048,
        "source": "NOAA/NESDIS GMGSI longwave IR + visible (day side)",
        "coverage": [-72.74, 72.72],
        "generated": "2026-10-22T22:55:38Z",
    },
    "launches": {
        "generated": "2026-10-22T22:54:43.924Z",
        "launches": [
            {
                "id": "done",
                "name": "Long March 2D | Yaogan",
                "provider": "CASC",
                "rocket": "Long March 2D",
                "mission": "Yaogan",
                "net": "2026-10-22T10:00:00Z",
                "status": {"abbrev": "Success", "name": "Launch Successful"},
                "pad": {"name": "LC-43/94", "location": "Jiuquan, China", "lat": 40.96, "lon": 100.29},
                "webcastLive": False,
            },
            {
                "id": "f6af629d",
                "name": "Falcon 9 Block 5 | Starlink Group 15-15",
                "provider": "SpaceX",
                "rocket": "Falcon 9 Block 5",
                "mission": "Starlink Group 15-15",
                "orbit": "LEO",
                "net": "2026-10-22T22:51:18Z",
                "windowStart": "2026-10-22T21:45:00Z",
                "windowEnd": "2026-10-23T01:45:00Z",
                "status": {"abbrev": "Hold", "name": "On Hold"},
                "pad": {"name": "Space Launch Complex 4E", "location": "Vandenberg SFB, CA, USA", "lat": 34.632, "lon": -120.611},
                "webcastLive": True,
            },
            {
                "id": "later",
                "name": "Electron | Rocket Lab",
                "provider": "Rocket Lab",
                "rocket": "Electron",
                "mission": "TBD",
                "net": "2026-10-24T02:00:00Z",
                "status": {"abbrev": "Go", "name": "Go for Launch"},
                "pad": {"name": "LC-1A", "location": "Mahia, New Zealand", "lat": -39.26, "lon": 177.86},
                "webcastLive": False,
            },
        ],
    },
    "storms": {
        "generated": "2026-10-22T22:54:45.382Z",
        "storms": [
            {
                "id": "gdacs-1001341",
                "name": "Vance",
                "source": "NOAA",
                "alert": "Green",
                "pos": [-101.5, 10],
                "cls": "TS",
                "peakWindKmh": 194,
                "segments": [],
                "nhc": {"name": "Vance", "classification": "TS", "windKmh": 102, "pressureMb": 994, "movementDir": 300, "movementKmh": 8, "updated": "2026-10-22T21:00:00.000Z"},
                "updated": "2026-10-22T20:42:31.000Z",
            },
            {
                "id": "gdacs-1001342",
                "name": "Raymond",
                "source": "NOAA",
                "alert": "Orange",
                "pos": [-118.5, 30.5],
                "cls": "HU",
                "peakWindKmh": 180,
                "segments": [],
                "updated": "2026-10-22T20:42:31.000Z",
            },
        ],
    },
    "fires": {
        "generated": "2026-10-22T22:55:09.477Z",
        "source": "NASA FIRMS VIIRS 375 m, last 24 h (NOAA-20, NOAA-21)",
        "cellDeg": 0.05,
        "fields": ["lat_index", "lon_index", "frp_mw_x10", "hours_ago", "detections"],
        "detections": 5,
        "count": 2,
        # 32.85, -117.25 (~3 km from home), and somewhere in Kazakhstan.
        "data": [657, -2345, 123, 2, 4, 800, 1400, 50, 10, 1],
    },
    "lightning": {
        "generated": "2026-10-22T22:55:14.249Z",
        "source": "NOAA GOES GLM L2 (GOES-19, GOES-18)",
        "satellites": ["GOES-19", "GOES-18"],
        "windowMin": 30,
        "latest": "2026-10-22T22:54:40.000Z",
        "cellDeg": 0.1,
        "fields": ["lat_index", "lon_index", "flashes", "minutes_ago"],
        "flashes": 7,
        "count": 2,
        # 32.9, -117.2 (~4 km), and the Gulf of Mexico.
        "data": [329, -1172, 5, 3, 250, -900, 2, 12],
    },
    "events": {
        "generated": "2026-10-22T22:55:20.442Z",
        "volcanoDays": 90,
        "counts": {"FL": 1, "WF": 1, "VO": 1},
        "events": [
            {"id": "VO-1000152", "type": "VO", "name": "Kanlaon", "country": "Philippines", "alert": "Orange", "pos": [123.132, 10.412], "from": "2026-10-10T05:58:00.000Z", "to": "2026-10-10T05:58:00.000Z", "url": "https://www.gdacs.org/report.aspx?eventid=1000152&episodeid=1&eventtype=VO"},
            {"id": "WF-1", "type": "WF", "name": "United States", "country": "United States", "alert": "Orange", "pos": [-117.0, 33.2], "from": "2026-10-20T00:00:00.000Z", "to": None, "url": "", "areaHa": 1200},
            {"id": "FL-1", "type": "FL", "name": "Nigeria", "country": "Nigeria", "alert": "Green", "pos": [7.5, 9.1], "from": None, "to": None, "url": ""},
        ],
    },
    "tsunami": {
        "generated": "2026-10-22T22:55:27.987Z",
        "source": "NOAA tsunami.gov (NTWC, PTWC)",
        "centers": ["NTWC", "PTWC"],
        "maxAgeHours": 48,
        "bulletins": [
            {"id": "a", "center": "NTWC", "category": "information", "region": "45 miles SE of Sand Point, Alaska", "lat": 54.634, "lon": -160.218, "magnitude": 5.0, "magnitudeType": "Ml", "issued": "2026-10-22T21:00:00.000Z", "note": "There is NO tsunami danger from this earthquake.", "bulletin": None},
            {"id": "b", "center": "PTWC", "category": "information", "region": "VANUATU", "lat": -15.3, "lon": 167.1, "magnitude": 6.6, "magnitudeType": "Mwp", "issued": "2026-10-21T10:00:00.000Z", "note": None, "bulletin": None},
        ],
    },
    "smoke": {
        "generated": "2026-10-22T22:55:27.593Z",
        "source": "NOAA/NESDIS Hazard Mapping System smoke analysis",
        "date": "2026-10-22",
        "image": "smoke.png",
        "width": 4096,
        "height": 2048,
        "plumes": {"Light": 167, "Medium": 37, "Heavy": 4},
        "latest": "2026-10-22T20:00:00.000Z",
    },
    "kp": [
        {"time_tag": "2026-10-22T15:00:00", "Kp": 3.67, "a_running": 22, "station_count": 8},
        {"time_tag": "2026-10-22T18:00:00", "Kp": 5.33, "a_running": 56, "station_count": 8},
    ],
    "flares": [
        {"time_tag": "2026-10-22T23:56:00Z", "satellite": 18, "current_class": "B6.5", "begin_time": "2026-10-22T21:06:00Z", "max_time": "2026-10-22T21:10:00Z", "max_class": "B8.7", "end_time": "2026-10-22T21:12:00Z"}
    ],
    "wind": [{"proton_speed": 427, "time_tag": "2026-10-22T23:49:00Z"}],
    "field": [{"bt": 6, "bz_gsm": -3, "time_tag": "2026-10-22T23:49:00Z"}],
    "quakes": {
        "type": "FeatureCollection",
        "metadata": {"generated": NOW_MS, "count": 3},
        "features": [
            {"id": "ci1", "properties": {"mag": 3.1, "place": "5 km E of La Jolla, CA", "time": NOW_MS - 2 * 3_600_000, "tsunami": 0, "alert": None, "url": "https://earthquake.usgs.gov/earthquakes/eventpage/ci1"}, "geometry": {"coordinates": [-117.0, 32.9, 8.2]}},
            {"id": "us1", "properties": {"mag": 6.1, "place": "off the east coast of Honshu, Japan", "time": NOW_MS - 5 * 3_600_000, "tsunami": 1, "alert": "green", "url": "https://earthquake.usgs.gov/earthquakes/eventpage/us1"}, "geometry": {"coordinates": [142.0, 38.0, 30.0]}},
            {"id": "nomag", "properties": {"mag": None, "place": "", "time": NOW_MS}, "geometry": {"coordinates": [0, 0, 0]}},
        ],
    },
}


@pytest.fixture(autouse=True)
def auto_enable_custom_integrations(enable_custom_integrations):
    yield


@pytest.fixture
def feeds() -> dict[str, Any]:
    """A copy of every feed, keyed as feed_urls() keys them, to change per test."""
    return copy.deepcopy(FEEDS)


@pytest.fixture
def mock_site(aioclient_mock: AiohttpClientMocker, feeds: dict[str, Any]) -> dict[str, Any]:
    """Serve the app page and every feed; returns the feeds to change and re-serve."""
    serve(aioclient_mock, feeds)
    return feeds


def serve(aioclient_mock: AiohttpClientMocker, feeds: dict[str, Any], **status: int) -> None:
    """(Re)register every URL; status={'clouds': 500} makes a feed fail."""
    aioclient_mock.clear_requests()
    aioclient_mock.get(SITE, text=PAGE)
    for key, url in feed_urls(SITE).items():
        if key in status:
            aioclient_mock.get(url, status=status[key])
        elif key in feeds:
            aioclient_mock.get(url, json=feeds[key], headers={"ETag": f'"{key}-1"'})
        else:
            aioclient_mock.get(url, status=404)


@pytest.fixture
def config_entry() -> MockConfigEntry:
    return MockConfigEntry(domain=DOMAIN, title="xearth.example", data={"url": SITE}, unique_id=None)
