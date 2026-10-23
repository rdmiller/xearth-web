"""xearth web for Home Assistant: the live globe as a sidebar panel, and its feeds as sensors."""

from __future__ import annotations

from urllib.parse import parse_qsl, urlencode

from homeassistant.components import frontend
from homeassistant.config_entries import ConfigEntry
from homeassistant.const import CONF_URL, Platform
from homeassistant.core import HomeAssistant, callback

from .const import CONF_PANEL, CONF_PANEL_PARAMS, CONF_PANEL_TITLE, DEFAULT_PANEL_TITLE, PANEL_ICON, PANEL_URL_PATH
from .coordinator import XearthCoordinator

PLATFORMS = [Platform.BINARY_SENSOR, Platform.SENSOR]

type XearthConfigEntry = ConfigEntry[XearthCoordinator]


async def async_setup_entry(hass: HomeAssistant, entry: XearthConfigEntry) -> bool:
    coordinator = XearthCoordinator(hass, entry, entry.data[CONF_URL])
    await coordinator.async_config_entry_first_refresh()
    entry.runtime_data = coordinator
    await hass.config_entries.async_forward_entry_setups(entry, PLATFORMS)
    if entry.options.get(CONF_PANEL, True):
        _register_panel(hass, entry)
    entry.async_on_unload(entry.add_update_listener(_async_reload))
    return True


async def async_unload_entry(hass: HomeAssistant, entry: XearthConfigEntry) -> bool:
    if PANEL_URL_PATH in hass.data.get(frontend.DATA_PANELS, {}):
        frontend.async_remove_panel(hass, PANEL_URL_PATH)
    return await hass.config_entries.async_unload_platforms(entry, PLATFORMS)


async def _async_reload(hass: HomeAssistant, entry: XearthConfigEntry) -> None:
    await hass.config_entries.async_reload(entry.entry_id)


def panel_url(site: str, params: str, lat: float, lon: float) -> str:
    """The site with the panel's URL parameters, over home unless they say otherwise.

    The app reads its settings from the query string, as xearth reads its flags, so
    `view=sunrel&grid=1` or `track=iss` work here as they do in the address bar.
    """
    query = parse_qsl(params.strip().lstrip("?"), keep_blank_values=True)
    given = {k for k, _ in query}
    if not given & {"lat", "lon"}:
        query += [("lat", f"{lat:.2f}"), ("lon", f"{lon:.2f}")]
    return f"{site}?{urlencode(query, safe=',')}"


@callback
def _register_panel(hass: HomeAssistant, entry: XearthConfigEntry) -> None:
    url = panel_url(entry.data[CONF_URL], entry.options.get(CONF_PANEL_PARAMS, ""), hass.config.latitude, hass.config.longitude)
    frontend.async_register_built_in_panel(
        hass,
        "iframe",
        sidebar_title=entry.options.get(CONF_PANEL_TITLE) or DEFAULT_PANEL_TITLE,
        sidebar_icon=PANEL_ICON,
        frontend_url_path=PANEL_URL_PATH,
        config={"url": url},
        require_admin=False,
    )
