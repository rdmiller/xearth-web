"""Binary sensors: a geomagnetic storm, a launch on air, and each kind of hazard near home.

"Near" is what the app's place card uses (feeds.NEARBY_KM): tropical cyclones within
800 km, tsunami alerts within 1,000 km, an M4.5+ quake within 300 km (or any within
50 km), GDACS floods and fires within 300 km and eruptions within 150 km, lightning
within 50 km and fire detections within 25 km.
"""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import asdict, dataclass
from typing import Any

from homeassistant.components.binary_sensor import BinarySensorDeviceClass, BinarySensorEntity, BinarySensorEntityDescription
from homeassistant.core import HomeAssistant
from homeassistant.helpers.entity_platform import AddConfigEntryEntitiesCallback

from . import XearthConfigEntry
from .entity import XearthEntity
from .feeds import Snapshot, highest_level, storm_level


@dataclass(frozen=True, kw_only=True)
class XearthBinarySensorDescription(BinarySensorEntityDescription):
    feeds: tuple[str, ...]
    is_on_fn: Callable[[Snapshot], bool | None]
    attrs_fn: Callable[[Snapshot], dict[str, Any] | None] = lambda s: None


def _nearby(key: str, kind: str, feeds: tuple[str, ...]) -> XearthBinarySensorDescription:
    def alerts(s: Snapshot) -> list:
        return [a for a in s.nearby if a.kind == kind]

    return XearthBinarySensorDescription(
        key=key,
        translation_key=key,
        feeds=feeds,
        device_class=BinarySensorDeviceClass.SAFETY,
        is_on_fn=lambda s: bool(alerts(s)),
        attrs_fn=lambda s: {"level": highest_level(alerts(s)), "alerts": [asdict(a) for a in alerts(s)]},
    )


BINARY_SENSORS: tuple[XearthBinarySensorDescription, ...] = (
    XearthBinarySensorDescription(
        key="geomagnetic_storm",
        translation_key="geomagnetic_storm",
        feeds=("kp",),
        is_on_fn=lambda s: None if s.space.kp is None else s.space.kp >= 5,
        attrs_fn=lambda s: {"level": storm_level(s.space.kp)} if s.space.kp is not None else None,
    ),
    XearthBinarySensorDescription(
        key="launch_webcast",
        translation_key="launch_webcast",
        feeds=("launches",),
        is_on_fn=lambda s: bool(s.launch and s.launch.get("webcastLive")),
        attrs_fn=lambda s: {"launch": s.launch.get("name")} if s.launch else None,
    ),
    _nearby("tropical_cyclone_nearby", "storm", ("storms",)),
    _nearby("tsunami_nearby", "tsunami", ("tsunami",)),
    _nearby("earthquake_nearby", "quake", ("quakes",)),
    _nearby("gdacs_event_nearby", "event", ("events",)),
    _nearby("lightning_nearby", "lightning", ("lightning",)),
    _nearby("fire_nearby", "fire", ("fires",)),
)


async def async_setup_entry(hass: HomeAssistant, entry: XearthConfigEntry, async_add_entities: AddConfigEntryEntitiesCallback) -> None:
    coordinator = entry.runtime_data
    async_add_entities(XearthBinarySensor(coordinator, d) for d in BINARY_SENSORS)


class XearthBinarySensor(XearthEntity, BinarySensorEntity):
    entity_description: XearthBinarySensorDescription
    _unrecorded_attributes = frozenset({"alerts"})

    @property
    def is_on(self) -> bool | None:
        return self.entity_description.is_on_fn(self.coordinator.data)

    @property
    def extra_state_attributes(self) -> dict[str, Any] | None:
        return self.entity_description.attrs_fn(self.coordinator.data)
