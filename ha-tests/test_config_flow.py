from unittest.mock import patch

import pytest

from homeassistant.config_entries import SOURCE_USER
from homeassistant.core import HomeAssistant
from homeassistant.data_entry_flow import FlowResultType
from pytest_homeassistant_custom_component.common import MockConfigEntry
from pytest_homeassistant_custom_component.test_util.aiohttp import AiohttpClientMocker

from custom_components.xearth.config_flow import normalise_url
from custom_components.xearth.const import DEFAULT_URL, DOMAIN

from conftest import PAGE, SITE


@pytest.fixture(autouse=True)
def no_setup():
    with patch("custom_components.xearth.async_setup_entry", return_value=True):
        yield


async def test_user_flow(hass: HomeAssistant, aioclient_mock: AiohttpClientMocker) -> None:
    aioclient_mock.get(SITE, text=PAGE)
    result = await hass.config_entries.flow.async_init(DOMAIN, context={"source": SOURCE_USER})
    assert result["type"] is FlowResultType.FORM
    assert result["data_schema"]({})["url"] == DEFAULT_URL

    result = await hass.config_entries.flow.async_configure(result["flow_id"], {"url": " https://XEARTH.example "})
    assert result["type"] is FlowResultType.CREATE_ENTRY
    assert result["title"] == "xearth.example"
    assert result["data"] == {"url": SITE}


@pytest.mark.parametrize(
    ("answer", "error"),
    [({"status": 404}, "cannot_connect"), ({"exc": TimeoutError()}, "cannot_connect"), ({"text": "<title>Router login</title>"}, "not_xearth")],
)
async def test_user_flow_errors(hass: HomeAssistant, aioclient_mock: AiohttpClientMocker, answer, error) -> None:
    aioclient_mock.get(SITE, **answer)
    result = await hass.config_entries.flow.async_init(DOMAIN, context={"source": SOURCE_USER})
    result = await hass.config_entries.flow.async_configure(result["flow_id"], {"url": SITE})
    assert result["type"] is FlowResultType.FORM
    assert result["errors"] == {"base": error}

    aioclient_mock.clear_requests()
    aioclient_mock.get(SITE, text=PAGE)
    result = await hass.config_entries.flow.async_configure(result["flow_id"], {"url": SITE})
    assert result["type"] is FlowResultType.CREATE_ENTRY


async def test_only_one(hass: HomeAssistant) -> None:
    MockConfigEntry(domain=DOMAIN, data={"url": SITE}).add_to_hass(hass)
    result = await hass.config_entries.flow.async_init(DOMAIN, context={"source": SOURCE_USER})
    assert result["type"] is FlowResultType.ABORT
    assert result["reason"] == "single_instance_allowed"


async def test_options_flow(hass: HomeAssistant) -> None:
    entry = MockConfigEntry(domain=DOMAIN, data={"url": SITE})
    entry.add_to_hass(hass)
    result = await hass.config_entries.options.async_init(entry.entry_id)
    assert result["type"] is FlowResultType.FORM
    result = await hass.config_entries.options.async_configure(result["flow_id"], {"panel": True, "panel_title": "Globe", "panel_params": "track=iss"})
    assert result["type"] is FlowResultType.CREATE_ENTRY
    assert entry.options == {"panel": True, "panel_title": "Globe", "panel_params": "track=iss"}


def test_normalise_url():
    assert normalise_url("nas.local:8080") == "http://nas.local:8080/"
    assert normalise_url("https://Host/xearth-web?view=orbit#x") == "https://host/xearth-web/"
    assert normalise_url(DEFAULT_URL) == DEFAULT_URL
