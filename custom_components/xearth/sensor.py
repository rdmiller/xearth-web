"""Sensors: space weather, the next launch, hazards worldwide and nearest to home."""

from __future__ import annotations

from collections import Counter
from collections.abc import Callable
from dataclasses import asdict, dataclass
from datetime import datetime, timezone
from typing import Any

from homeassistant.components.sensor import SensorDeviceClass, SensorEntity, SensorEntityDescription, SensorStateClass
from homeassistant.const import EntityCategory, UnitOfLength
from homeassistant.core import HomeAssistant
from homeassistant.helpers.entity_platform import AddConfigEntryEntitiesCallback
from homeassistant.helpers.typing import StateType

from . import XearthConfigEntry
from .entity import XearthEntity
from .feeds import HAZARD_FEEDS, Nearest, Quake, Snapshot, highest_level, parse_time, storm_class, storm_level, storm_title, title_case

# Lists in attributes are capped, and kept out of the recorder.
LIST_MAX = 10
STORM_LEVELS = ["none", "g1", "g2", "g3", "g4", "g5"]


@dataclass(frozen=True, kw_only=True)
class XearthSensorDescription(SensorEntityDescription):
    feeds: tuple[str, ...]
    value_fn: Callable[[Snapshot], StateType | datetime]
    attrs_fn: Callable[[Snapshot], dict[str, Any] | None] = lambda s: None


def _km(n: Nearest | None) -> float | None:
    return round(n.km, 1) if n else None


def _place(n: Nearest) -> dict[str, Any]:
    return {"distance_km": round(n.km, 1), "direction": n.direction}


def _ms(ms: float) -> datetime:
    return datetime.fromtimestamp(ms / 1000, timezone.utc)


def _launch(s: Snapshot) -> dict[str, Any] | None:
    l = s.launch
    if l is None:
        return None
    pad = l.get("pad") or {}
    return {
        "name": l.get("name"),
        "provider": l.get("provider"),
        "rocket": l.get("rocket"),
        "mission": l.get("mission"),
        "orbit": l.get("orbit"),
        "status": (l.get("status") or {}).get("name"),
        "window_start": parse_time(l.get("windowStart")),
        "window_end": parse_time(l.get("windowEnd")),
        "webcast_live": l.get("webcastLive"),
        "pad": pad.get("name"),
        "location": pad.get("location"),
        "latitude": pad.get("lat"),
        "longitude": pad.get("lon"),
        **(_place(s.launch_distance) if s.launch_distance else {}),
    }


def _quake(q: Quake) -> dict[str, Any]:
    return {
        "magnitude": q.mag,
        "place": q.place,
        "time": _ms(q.time),
        "depth_km": q.depth_km,
        "latitude": q.lat,
        "longitude": q.lon,
        "tsunami": q.tsunami,
        "alert": q.alert,
        "url": q.url,
    }


def _storm(n: Nearest) -> dict[str, Any]:
    s = n.item
    nhc = s.get("nhc") or {}
    return {
        "name": title_case(storm_title(s)),
        "class": storm_class(s),
        "wind_kmh": nhc.get("windKmh"),
        "pressure_mb": nhc.get("pressureMb"),
        "peak_wind_kmh": s.get("peakWindKmh"),
        "alert": s.get("alert"),
        "latitude": s["pos"][1],
        "longitude": s["pos"][0],
        **_place(n),
    }


def _gdacs(s: Snapshot, kind: str) -> dict[str, Any]:
    events = s.events_by_type.get(kind, [])
    alerts = Counter(str(n.item.get("alert", "")).lower() for n in events)
    nearest = [
        {"name": n.item.get("name"), "country": n.item.get("country"), "alert": n.item.get("alert"), "area_ha": n.item.get("areaHa"), "url": n.item.get("url"), **_place(n)}
        for n in events[:LIST_MAX]
    ]
    return {"red": alerts["red"], "orange": alerts["orange"], "green": alerts["green"], "nearest": nearest}


def _bulletin(b: dict) -> dict[str, Any]:
    return {k: b.get(k) for k in ("center", "category", "region", "magnitude", "issued", "note", "bulletin")} | {"latitude": b.get("lat"), "longitude": b.get("lon")}


def _len(xs: list | None) -> int | None:
    return None if xs is None else len(xs)


def _distance(key: str, feeds: tuple[str, ...], nearest: Callable[[Snapshot], Nearest | None], attrs: Callable[[Nearest], dict[str, Any]]) -> XearthSensorDescription:
    return XearthSensorDescription(
        key=key,
        translation_key=key,
        feeds=feeds,
        device_class=SensorDeviceClass.DISTANCE,
        native_unit_of_measurement=UnitOfLength.KILOMETERS,
        state_class=SensorStateClass.MEASUREMENT,
        suggested_display_precision=0,
        value_fn=lambda s: _km(nearest(s)),
        attrs_fn=lambda s: (attrs(n) | {"direction": n.direction}) if (n := nearest(s)) else None,
    )


def _count(key: str, feeds: tuple[str, ...], value: Callable[[Snapshot], int | None], attrs: Callable[[Snapshot], dict[str, Any] | None] = lambda s: None) -> XearthSensorDescription:
    return XearthSensorDescription(key=key, translation_key=key, feeds=feeds, state_class=SensorStateClass.MEASUREMENT, value_fn=value, attrs_fn=attrs)


SENSORS: tuple[XearthSensorDescription, ...] = (
    # ---- space weather
    XearthSensorDescription(
        key="kp_index",
        translation_key="kp_index",
        feeds=("kp",),
        state_class=SensorStateClass.MEASUREMENT,
        suggested_display_precision=2,
        value_fn=lambda s: s.space.kp,
        attrs_fn=lambda s: {"observed": s.space.kp_time},
    ),
    XearthSensorDescription(
        key="geomagnetic_storm_level",
        translation_key="geomagnetic_storm_level",
        feeds=("kp",),
        device_class=SensorDeviceClass.ENUM,
        options=STORM_LEVELS,
        value_fn=lambda s: None if s.space.kp is None else (storm_level(s.space.kp) or "none").lower(),
    ),
    XearthSensorDescription(key="xray_class", translation_key="xray_class", feeds=("flares",), value_fn=lambda s: s.space.xray),
    XearthSensorDescription(
        key="last_flare",
        translation_key="last_flare",
        feeds=("flares",),
        value_fn=lambda s: s.space.flare,
        attrs_fn=lambda s: {"peak": s.space.flare_time},
    ),
    XearthSensorDescription(
        key="solar_wind_speed",
        translation_key="solar_wind_speed",
        feeds=("wind",),
        native_unit_of_measurement="km/s",
        state_class=SensorStateClass.MEASUREMENT,
        value_fn=lambda s: s.space.wind_kms,
    ),
    XearthSensorDescription(
        key="solar_wind_bz",
        translation_key="solar_wind_bz",
        feeds=("field",),
        native_unit_of_measurement="nT",
        state_class=SensorStateClass.MEASUREMENT,
        value_fn=lambda s: s.space.bz_nt,
    ),
    XearthSensorDescription(
        key="solar_wind_bt",
        translation_key="solar_wind_bt",
        feeds=("field",),
        native_unit_of_measurement="nT",
        state_class=SensorStateClass.MEASUREMENT,
        value_fn=lambda s: s.space.bt_nt,
    ),
    # ---- launches
    XearthSensorDescription(
        key="next_launch",
        translation_key="next_launch",
        feeds=("launches",),
        device_class=SensorDeviceClass.TIMESTAMP,
        value_fn=lambda s: parse_time(s.launch.get("net")) if s.launch else None,
        attrs_fn=_launch,
    ),
    XearthSensorDescription(
        key="next_launch_status",
        translation_key="next_launch_status",
        feeds=("launches",),
        value_fn=lambda s: (s.launch.get("status") or {}).get("name") if s.launch else None,
    ),
    # ---- earthquakes (USGS, M2.5+, past day)
    _count("earthquakes", ("quakes",), lambda s: _len(s.quakes)),
    XearthSensorDescription(
        key="largest_earthquake",
        translation_key="largest_earthquake",
        feeds=("quakes",),
        state_class=SensorStateClass.MEASUREMENT,
        suggested_display_precision=1,
        value_fn=lambda s: s.quakes[0].mag if s.quakes else None,
        attrs_fn=lambda s: _quake(s.quakes[0]) if s.quakes else None,
    ),
    _distance("nearest_earthquake", ("quakes",), lambda s: s.nearest_quake, lambda n: _quake(n.item)),
    # ---- tropical cyclones
    _count("tropical_cyclones", ("storms",), lambda s: _len(s.storms), lambda s: {"storms": [_storm(n) for n in s.storms[:LIST_MAX]]} if s.storms is not None else None),
    _distance("nearest_tropical_cyclone", ("storms",), lambda s: s.storms[0] if s.storms else None, _storm),
    # ---- lightning (GOES GLM: the Americas, Atlantic and eastern Pacific)
    _count(
        "lightning_flashes",
        ("lightning",),
        lambda s: s.lightning.get("flashes") if s.lightning else None,
        lambda s: {"window_minutes": s.lightning.get("windowMin"), "latest": parse_time(s.lightning.get("latest")), "satellites": s.lightning.get("satellites")} if s.lightning else None,
    ),
    _distance(
        "nearest_lightning",
        ("lightning",),
        lambda s: s.nearest_lightning,
        lambda n: {"flashes": n.item[2], "minutes_ago": n.item[3], "latitude": round(n.item[0], 2), "longitude": round(n.item[1], 2)},
    ),
    # ---- fires (NASA FIRMS VIIRS, last 24 h)
    _count("fire_detections", ("fires",), lambda s: s.fires.get("detections") if s.fires else None, lambda s: {"cells": s.fires.get("count")} if s.fires else None),
    _distance(
        "nearest_fire",
        ("fires",),
        lambda s: s.nearest_fire,
        lambda n: {"fire_power_mw": n.item[2] / 10, "hours_ago": n.item[3], "detections": n.item[4], "latitude": round(n.item[0], 2), "longitude": round(n.item[1], 2)},
    ),
    # ---- GDACS
    _count("floods", ("events",), lambda s: _len(s.events_by_type.get("FL")) if s.events else None, lambda s: _gdacs(s, "FL") if s.events else None),
    _count("wildfires", ("events",), lambda s: _len(s.events_by_type.get("WF")) if s.events else None, lambda s: _gdacs(s, "WF") if s.events else None),
    _count("volcanic_eruptions", ("events",), lambda s: _len(s.events_by_type.get("VO")) if s.events else None, lambda s: _gdacs(s, "VO") if s.events else None),
    # ---- tsunami bulletins (NTWC, PTWC)
    _count("tsunami_bulletins", ("tsunami",), lambda s: _len(s.tsunami), lambda s: {"bulletins": [_bulletin(b) for b in s.tsunami[:LIST_MAX]]} if s.tsunami is not None else None),
    # ---- smoke (NOAA HMS, North America)
    _count(
        "smoke_plumes",
        ("smoke",),
        lambda s: sum(s.smoke["plumes"].values()) if s.smoke else None,
        lambda s: {"light": s.smoke["plumes"].get("Light"), "medium": s.smoke["plumes"].get("Medium"), "heavy": s.smoke["plumes"].get("Heavy"), "analysis_date": s.smoke.get("date")} if s.smoke else None,
    ),
    # ---- everything near home, as the app's place card lists it
    _count(
        "hazards_nearby",
        HAZARD_FEEDS,
        lambda s: len(s.nearby),
        lambda s: {"highest_level": highest_level(s.nearby), "alerts": [asdict(a) for a in s.nearby]},
    ),
    # ---- diagnostics
    XearthSensorDescription(
        key="cloud_map",
        translation_key="cloud_map",
        feeds=("clouds",),
        device_class=SensorDeviceClass.TIMESTAMP,
        entity_category=EntityCategory.DIAGNOSTIC,
        value_fn=lambda s: parse_time(s.clouds.get("t")) if s.clouds else None,
        attrs_fn=lambda s: {"source": s.clouds.get("source")} if s.clouds else None,
    ),
    XearthSensorDescription(
        key="data_updated",
        translation_key="data_updated",
        feeds=("clouds", "launches", "storms", "fires", "lightning", "events", "tsunami", "smoke"),
        device_class=SensorDeviceClass.TIMESTAMP,
        entity_category=EntityCategory.DIAGNOSTIC,
        value_fn=lambda s: max(s.generated.values(), default=None),
        attrs_fn=lambda s: dict(sorted(s.generated.items())),
    ),
)


async def async_setup_entry(hass: HomeAssistant, entry: XearthConfigEntry, async_add_entities: AddConfigEntryEntitiesCallback) -> None:
    coordinator = entry.runtime_data
    async_add_entities(XearthSensor(coordinator, d) for d in SENSORS)


class XearthSensor(XearthEntity, SensorEntity):
    entity_description: XearthSensorDescription
    _unrecorded_attributes = frozenset({"storms", "nearest", "bulletins", "alerts", "url"})

    @property
    def native_value(self) -> StateType | datetime:
        return self.entity_description.value_fn(self.coordinator.data)

    @property
    def extra_state_attributes(self) -> dict[str, Any] | None:
        return self.entity_description.attrs_fn(self.coordinator.data)
