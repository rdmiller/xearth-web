from datetime import timedelta

import pytest
from freezegun.api import FrozenDateTimeFactory

from homeassistant.components import frontend
from homeassistant.config_entries import ConfigEntryState
from homeassistant.const import STATE_OFF, STATE_ON, STATE_UNAVAILABLE
from homeassistant.core import HomeAssistant
from homeassistant.helpers import entity_registry as er
from pytest_homeassistant_custom_component.common import MockConfigEntry, async_fire_time_changed
from pytest_homeassistant_custom_component.test_util.aiohttp import AiohttpClientMocker

from custom_components.xearth import panel_url
from custom_components.xearth.const import DOMAIN, PANEL_URL_PATH, UPDATE_INTERVAL
from custom_components.xearth.feeds import feed_urls

from conftest import NOW, SITE, serve


@pytest.fixture(autouse=True)
def frozen(freezer: FrozenDateTimeFactory) -> FrozenDateTimeFactory:
    freezer.move_to(NOW)
    return freezer


async def setup(hass: HomeAssistant, entry: MockConfigEntry) -> None:
    entry.add_to_hass(hass)
    assert await hass.config_entries.async_setup(entry.entry_id)
    await hass.async_block_till_done()


def state(hass: HomeAssistant, entry: MockConfigEntry, key: str, platform: str = "sensor"):
    entity_id = er.async_get(hass).async_get_entity_id(platform, DOMAIN, f"{entry.entry_id}_{key}")
    assert entity_id, key
    return hass.states.get(entity_id)


async def update(hass: HomeAssistant, freezer: FrozenDateTimeFactory, by: timedelta = UPDATE_INTERVAL) -> None:
    freezer.tick(by)
    async_fire_time_changed(hass)
    # The coordinator refreshes in a background task.
    await hass.async_block_till_done(wait_background_tasks=True)


async def test_sensors(hass: HomeAssistant, config_entry: MockConfigEntry, mock_site) -> None:
    await setup(hass, config_entry)
    assert config_entry.state is ConfigEntryState.LOADED

    assert state(hass, config_entry, "kp_index").state == "5.33"
    assert state(hass, config_entry, "geomagnetic_storm_level").state == "g1"
    assert state(hass, config_entry, "xray_class").state == "B6.5"
    assert state(hass, config_entry, "last_flare").attributes["peak"].isoformat() == "2026-10-22T21:10:00+00:00"
    assert state(hass, config_entry, "solar_wind_speed").state == "427"
    assert state(hass, config_entry, "solar_wind_bz").state == "-3"

    launch = state(hass, config_entry, "next_launch")
    assert launch.state == "2026-10-22T22:51:18+00:00"
    assert launch.attributes["name"] == "Falcon 9 Block 5 | Starlink Group 15-15"
    assert launch.attributes["location"] == "Vandenberg SFB, CA, USA"
    assert state(hass, config_entry, "next_launch_status").state == "On Hold"

    assert state(hass, config_entry, "earthquakes").state == "2"
    assert state(hass, config_entry, "largest_earthquake").state == "6.1"
    nearest_quake = state(hass, config_entry, "nearest_earthquake")
    assert 15 < float(nearest_quake.state) < 30
    assert nearest_quake.attributes["place"] == "5 km E of La Jolla, CA"
    assert nearest_quake.attributes["unit_of_measurement"] == "km"

    cyclones = state(hass, config_entry, "tropical_cyclones")
    assert cyclones.state == "2"
    assert [s["name"] for s in cyclones.attributes["storms"]] == ["Hurricane Raymond", "Tropical Storm Vance"]
    assert state(hass, config_entry, "nearest_tropical_cyclone").attributes["name"] == "Hurricane Raymond"

    assert state(hass, config_entry, "lightning_flashes").state == "7"
    assert float(state(hass, config_entry, "nearest_lightning").state) < 6
    assert state(hass, config_entry, "fire_detections").state == "5"
    assert state(hass, config_entry, "nearest_fire").attributes["detections"] == 4
    assert state(hass, config_entry, "wildfires").attributes["orange"] == 1
    assert state(hass, config_entry, "floods").state == "1"
    assert state(hass, config_entry, "volcanic_eruptions").attributes["nearest"][0]["name"] == "Kanlaon"
    assert state(hass, config_entry, "tsunami_bulletins").state == "1"
    assert state(hass, config_entry, "smoke_plumes").attributes["heavy"] == 4

    nearby = state(hass, config_entry, "hazards_nearby")
    assert nearby.state == "5"
    assert nearby.attributes["highest_level"] == "warning"
    assert nearby.attributes["alerts"][0]["title"] == "Hurricane Raymond"

    assert state(hass, config_entry, "cloud_map").state == "2026-10-22T22:00:00+00:00"
    assert state(hass, config_entry, "data_updated").state == "2026-10-22T22:55:38+00:00"


async def test_binary_sensors(hass: HomeAssistant, config_entry: MockConfigEntry, mock_site) -> None:
    await setup(hass, config_entry)
    on = {"geomagnetic_storm", "launch_webcast", "tropical_cyclone_nearby", "earthquake_nearby", "gdacs_event_nearby", "lightning_nearby", "fire_nearby"}
    for key in on | {"tsunami_nearby"}:
        assert state(hass, config_entry, key, "binary_sensor").state == (STATE_ON if key in on else STATE_OFF), key
    lightning = state(hass, config_entry, "lightning_nearby", "binary_sensor")
    assert lightning.attributes["alerts"][0]["detail"] == "5 flashes within 50 km in the last 30 min"
    assert lightning.attributes["device_class"] == "safety"


async def test_a_feed_down_keeps_its_last_data_for_a_while(
    hass: HomeAssistant, config_entry: MockConfigEntry, aioclient_mock: AiohttpClientMocker, mock_site, frozen
) -> None:
    await setup(hass, config_entry)
    serve(aioclient_mock, mock_site, lightning=500)
    await update(hass, frozen)
    assert state(hass, config_entry, "lightning_flashes").state == "7"

    await update(hass, frozen, timedelta(hours=3))
    assert state(hass, config_entry, "lightning_flashes").state == STATE_UNAVAILABLE
    assert state(hass, config_entry, "kp_index").state == "5.33"


async def test_a_missing_layer_is_unavailable(hass: HomeAssistant, config_entry: MockConfigEntry, aioclient_mock: AiohttpClientMocker, mock_site) -> None:
    del mock_site["smoke"]
    serve(aioclient_mock, mock_site)
    await setup(hass, config_entry)
    assert state(hass, config_entry, "smoke_plumes").state == STATE_UNAVAILABLE
    assert state(hass, config_entry, "fire_detections").state == "5"


async def test_unchanged_files_are_revalidated(
    hass: HomeAssistant, config_entry: MockConfigEntry, aioclient_mock: AiohttpClientMocker, mock_site, frozen
) -> None:
    await setup(hass, config_entry)
    fires = feed_urls(SITE)["fires"]
    aioclient_mock.clear_requests()
    for key, url in feed_urls(SITE).items():
        aioclient_mock.get(url, status=304)
    await update(hass, frozen)

    sent = {str(url): headers for _, url, _, headers in aioclient_mock.mock_calls}
    assert sent[fires]["If-None-Match"] == '"fires-1"'
    assert state(hass, config_entry, "fire_detections").state == "5"


async def test_nothing_answering_retries_setup(hass: HomeAssistant, config_entry: MockConfigEntry, aioclient_mock: AiohttpClientMocker) -> None:
    for url in feed_urls(SITE).values():
        aioclient_mock.get(url, status=503)
    config_entry.add_to_hass(hass)
    await hass.config_entries.async_setup(config_entry.entry_id)
    assert config_entry.state is ConfigEntryState.SETUP_RETRY


async def test_panel_over_home_and_removed_on_unload(hass: HomeAssistant, config_entry: MockConfigEntry, mock_site) -> None:
    await setup(hass, config_entry)
    panel = hass.data[frontend.DATA_PANELS][PANEL_URL_PATH]
    assert panel.component_name == "iframe"
    assert panel.sidebar_title == "Earth"
    assert panel.config == {"url": f"{SITE}?lat=32.87&lon=-117.23"}

    assert await hass.config_entries.async_unload(config_entry.entry_id)
    assert PANEL_URL_PATH not in hass.data[frontend.DATA_PANELS]


async def test_panel_options(hass: HomeAssistant, mock_site) -> None:
    entry = MockConfigEntry(domain=DOMAIN, data={"url": SITE}, options={"panel": True, "panel_title": "Globe", "panel_params": "view=sunrel&grid=1"})
    await setup(hass, entry)
    panel = hass.data[frontend.DATA_PANELS][PANEL_URL_PATH]
    assert panel.sidebar_title == "Globe"
    assert panel.config["url"] == f"{SITE}?view=sunrel&grid=1&lat=32.87&lon=-117.23"

    hass.config_entries.async_update_entry(entry, options={"panel": False, "panel_title": "Globe"})
    await hass.async_block_till_done()
    assert PANEL_URL_PATH not in hass.data[frontend.DATA_PANELS]
    assert entry.state is ConfigEntryState.LOADED


def test_panel_url_keeps_a_given_position():
    assert panel_url(SITE, "?lat=-33.9&lon=151.2&satshow=iss,starlink", 1, 2) == f"{SITE}?lat=-33.9&lon=151.2&satshow=iss,starlink"
    assert panel_url(SITE, "", 51.477, -0.0005) == f"{SITE}?lat=51.48&lon=-0.00"
