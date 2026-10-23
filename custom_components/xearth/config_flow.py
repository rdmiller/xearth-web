"""Set up xearth web: which site to read, and how its sidebar panel opens."""

from __future__ import annotations

from typing import Any
from urllib.parse import urlsplit, urlunsplit

import aiohttp
import voluptuous as vol

from homeassistant.config_entries import ConfigFlow, ConfigFlowResult, OptionsFlow
from homeassistant.const import CONF_URL
from homeassistant.core import callback
from homeassistant.helpers.aiohttp_client import async_get_clientsession

from . import XearthConfigEntry
from .const import CONF_PANEL, CONF_PANEL_PARAMS, CONF_PANEL_TITLE, DEFAULT_PANEL_TITLE, DEFAULT_URL, DOMAIN, REQUEST_TIMEOUT


def normalise_url(url: str) -> str:
    """'host:8080/xearth?x=1' → 'http://host:8080/xearth/': a folder the feeds sit under."""
    url = url.strip()
    if "://" not in url:
        url = f"http://{url}"
    parts = urlsplit(url)
    path = parts.path if parts.path.endswith("/") else f"{parts.path}/"
    return urlunsplit((parts.scheme.lower(), parts.netloc.lower(), path, "", ""))


class XearthConfigFlow(ConfigFlow, domain=DOMAIN):
    VERSION = 1

    async def async_step_user(self, user_input: dict[str, Any] | None = None) -> ConfigFlowResult:
        errors: dict[str, str] = {}
        if user_input is not None:
            url = normalise_url(user_input[CONF_URL])
            errors = await self._check(url)
            if not errors:
                return self.async_create_entry(title=urlsplit(url).netloc, data={CONF_URL: url})
        return self.async_show_form(
            step_id="user",
            data_schema=vol.Schema({vol.Required(CONF_URL, default=DEFAULT_URL): str}),
            errors=errors,
        )

    async def _check(self, url: str) -> dict[str, str]:
        """The site has to answer with the app's page (layers without data yet are fine)."""
        session = async_get_clientsession(self.hass)
        try:
            async with session.get(url, timeout=aiohttp.ClientTimeout(total=REQUEST_TIMEOUT)) as r:
                r.raise_for_status()
                page = await r.text()
        except (aiohttp.ClientError, TimeoutError):
            return {"base": "cannot_connect"}
        return {} if "<title>xearth" in page else {"base": "not_xearth"}

    @staticmethod
    @callback
    def async_get_options_flow(config_entry: XearthConfigEntry) -> XearthOptionsFlow:
        return XearthOptionsFlow()


class XearthOptionsFlow(OptionsFlow):
    async def async_step_init(self, user_input: dict[str, Any] | None = None) -> ConfigFlowResult:
        if user_input is not None:
            return self.async_create_entry(data=user_input)
        options = self.config_entry.options
        return self.async_show_form(
            step_id="init",
            data_schema=vol.Schema(
                {
                    vol.Required(CONF_PANEL, default=options.get(CONF_PANEL, True)): bool,
                    vol.Required(CONF_PANEL_TITLE, default=options.get(CONF_PANEL_TITLE, DEFAULT_PANEL_TITLE)): str,
                    vol.Optional(CONF_PANEL_PARAMS, description={"suggested_value": options.get(CONF_PANEL_PARAMS, "")}): str,
                }
            ),
        )
