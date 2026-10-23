"""One update every few minutes: fetch every feed, then summarise them for the entities."""

from __future__ import annotations

import asyncio
import logging
from dataclasses import dataclass
from datetime import datetime
from typing import TYPE_CHECKING, Any

import aiohttp

from homeassistant.core import HomeAssistant
from homeassistant.helpers.aiohttp_client import async_get_clientsession
from homeassistant.helpers.update_coordinator import DataUpdateCoordinator, UpdateFailed
from homeassistant.util import dt as dt_util
from homeassistant.util.json import json_loads
from homeassistant.util.unit_system import US_CUSTOMARY_SYSTEM

from .const import DOMAIN, REQUEST_TIMEOUT, STALE_AFTER, UPDATE_INTERVAL
from .feeds import Snapshot, feed_urls, summarise

if TYPE_CHECKING:
    from . import XearthConfigEntry

_LOGGER = logging.getLogger(__name__)


@dataclass
class _Cached:
    etag: str | None
    last_modified: str | None
    body: Any
    # When the source last answered (200 or 304).
    ok_at: datetime


class XearthCoordinator(DataUpdateCoordinator[Snapshot]):
    """Fetches the site's latest.json files, NOAA SWPC and USGS, then summarise()s them."""

    config_entry: XearthConfigEntry

    def __init__(self, hass: HomeAssistant, entry: XearthConfigEntry, site: str) -> None:
        super().__init__(hass, _LOGGER, config_entry=entry, name=DOMAIN, update_interval=UPDATE_INTERVAL)
        self.site = site
        self.urls = feed_urls(site)
        self._session = async_get_clientsession(hass)
        self._cache: dict[str, _Cached] = {}

    async def _fetch(self, url: str) -> Any:
        """GET with the last ETag / Last-Modified, so an unchanged file is a cheap 304.

        The site's latest.json files only change once an hour, and the fires file is
        over a megabyte.
        """
        cached = self._cache.get(url)
        headers = {}
        if cached and cached.etag:
            headers["If-None-Match"] = cached.etag
        if cached and cached.last_modified:
            headers["If-Modified-Since"] = cached.last_modified
        async with self._session.get(url, headers=headers, timeout=aiohttp.ClientTimeout(total=REQUEST_TIMEOUT)) as r:
            if r.status == 304 and cached:
                cached.ok_at = dt_util.utcnow()
                return cached.body
            r.raise_for_status()
            body = json_loads(await r.read())
            self._cache[url] = _Cached(r.headers.get("ETag"), r.headers.get("Last-Modified"), body, dt_util.utcnow())
        return body

    async def _async_update_data(self) -> Snapshot:
        keys = list(self.urls)
        results = await asyncio.gather(*(self._fetch(self.urls[k]) for k in keys), return_exceptions=True)
        now = dt_util.utcnow()
        raw: dict[str, Any] = {}
        failed: list[str] = []
        for key, result in zip(keys, results):
            if not isinstance(result, BaseException):
                raw[key] = result
                continue
            if not isinstance(result, Exception):
                raise result
            # A feed being down for a while keeps its last answer: the pipeline's are hourly anyway.
            why = f"HTTP {result.status}" if isinstance(result, aiohttp.ClientResponseError) else type(result).__name__
            failed.append(f"{key} ({why})")
            cached = self._cache.get(self.urls[key])
            if cached and now - cached.ok_at < STALE_AFTER:
                raw[key] = cached.body
        if not raw:
            raise UpdateFailed(f"No feed answered: {', '.join(failed)}")
        if failed:
            _LOGGER.debug("Feeds that didn't answer: %s", ", ".join(failed))

        imperial = self.hass.config.units is US_CUSTOMARY_SYSTEM
        lat, lon = self.hass.config.latitude, self.hass.config.longitude
        # The fire and lightning grids are tens of thousands of cells: measure them off the loop.
        return await self.hass.async_add_executor_job(summarise, raw, lat, lon, now, imperial)
