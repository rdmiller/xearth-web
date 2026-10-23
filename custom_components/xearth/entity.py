"""The device every xearth web entity belongs to."""

from __future__ import annotations

from homeassistant.helpers.device_registry import DeviceEntryType, DeviceInfo
from homeassistant.helpers.entity import EntityDescription
from homeassistant.helpers.update_coordinator import CoordinatorEntity

from .const import DOMAIN
from .coordinator import XearthCoordinator


class XearthEntity(CoordinatorEntity[XearthCoordinator]):
    _attr_has_entity_name = True

    def __init__(self, coordinator: XearthCoordinator, description: EntityDescription) -> None:
        super().__init__(coordinator)
        self.entity_description = description
        entry = coordinator.config_entry
        self._attr_unique_id = f"{entry.entry_id}_{description.key}"
        self._attr_device_info = DeviceInfo(
            identifiers={(DOMAIN, entry.entry_id)},
            name="xearth web",
            manufacturer="xearth web",
            entry_type=DeviceEntryType.SERVICE,
            configuration_url=coordinator.site,
        )

    @property
    def available(self) -> bool:
        """Available while any of the feeds it's drawn from has answered."""
        feeds: tuple[str, ...] = self.entity_description.feeds  # type: ignore[attr-defined]
        return super().available and any(f in self.coordinator.data.present for f in feeds)
