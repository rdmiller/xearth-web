// Live hazard layers: aurora (NOAA SWPC OVATION), tropical cyclones
// (GDACS + NHC, via the pipeline), active fires (NASA FIRMS VIIRS, via the
// pipeline; MTG's fire radiative power is in mtgFires.ts), earthquakes (USGS), lightning (GOES GLM), snow and ice (NOAA IMS),
// smoke (NOAA HMS) and GDACS floods, wildfires and eruptions. Radar is in radar.ts. Decoding and naming only; drawing
// is in renderer/ and overlay.ts.

import type { SurfacePoints } from './renderer/points';
import { SEV } from './tokens';
import { fromLatLon } from './vec';

// ---- aurora ------------------------------------------------------------------------

/** SWPC's OVATION aurora forecast: gzip-compressed, CORS-enabled, refreshed every few minutes. */
export const OVATION_URL = 'https://services.swpc.noaa.gov/json/ovation_aurora_latest.json';

export interface AuroraGrid {
  /** Forecast valid time (ISO) and the observation it's based on. */
  forecast: string;
  observed: string;
  width: number; // 360 (1°, longitude −180…179 left to right)
  height: number; // 181 (1°, latitude +90 at row 0 … −90)
  /** Probability of visible aurora, 0–100, one byte per cell. */
  data: Uint8Array;
  peak: number;
}

interface OvationJson {
  'Observation Time': string;
  'Forecast Time': string;
  coordinates: [number, number, number][];
}

export function isOvation(v: unknown): v is OvationJson {
  const o = v as Partial<OvationJson> | null;
  return !!o && Array.isArray(o.coordinates) && typeof o['Forecast Time'] === 'string';
}

/**
 * The OVATION feed carries non-zero values in a ring at latitudes −3…0° (up to
 * ~11 on 2026-10-21) — an artefact at the edge of the model grid, since
 * everything between ~40°S and ~50°N is otherwise zero. Even the most extreme
 * recorded storms haven't put aurora within ~20° of the equator, so cells
 * equatorward of this are dropped.
 */
export const AURORA_MIN_ABS_LAT = 20;

/**
 * OVATION gives [lon 0…359, lat −90…90, value] triplets. Re-grid them to match
 * the globe's textures: row 0 is the north pole, column 0 is longitude −180.
 */
export function decodeOvation(o: OvationJson): AuroraGrid {
  const width = 360;
  const height = 181;
  const data = new Uint8Array(width * height);
  let peak = 0;
  for (const [lon, lat, v] of o.coordinates) {
    const col = (((Math.round(lon) + 180) % 360) + 360) % 360;
    const row = 90 - Math.round(lat);
    if (row < 0 || row >= height || Math.abs(lat) < AURORA_MIN_ABS_LAT) continue;
    const val = Math.max(0, Math.min(100, Math.round(v)));
    data[row * width + col] = val;
    peak = Math.max(peak, val);
  }
  return { forecast: o['Forecast Time'], observed: o['Observation Time'], width, height, data, peak };
}

// ---- tropical cyclones -------------------------------------------------------------

export interface Storm {
  id: string;
  name: string;
  source: string;
  alert: string;
  /** [lon, lat] */
  pos: [number, number];
  /** GDACS class at the current position: TD / TS / HU. */
  cls: string;
  /** GDACS severity: peak wind over the forecast, km/h. */
  peakWindKmh: number | null;
  /** [lon1, lat1, lon2, lat2, class, forecast 0/1] */
  segments: [number, number, number, number, string, number][];
  nhc?: {
    name: string;
    classification: string;
    windKmh: number | null;
    pressureMb: number | null;
    movementDir: number | null;
    movementKmh: number | null;
    updated: string;
  };
  updated: string | null;
}

export interface StormManifest {
  generated: string;
  storms: Storm[];
}

export function isStormManifest(v: unknown): v is StormManifest {
  const m = v as Partial<StormManifest> | null;
  return !!m && typeof m.generated === 'string' && Array.isArray(m.storms);
}

/** What a mature cyclone is called where it is. */
export function basinWord(lon: number, lat: number): 'HURRICANE' | 'TYPHOON' | 'CYCLONE' {
  if (lat >= 0 && lon >= 100 && lon <= 180) return 'TYPHOON';
  if (lat >= 0 && lon < 0) return 'HURRICANE'; // Atlantic, East and Central Pacific
  return 'CYCLONE';
}

/** Class code: NHC's when it has the storm (TD/TS/HU/MH/…), else GDACS's. */
export function stormClass(s: Storm): string {
  return (s.nhc?.classification || s.cls || '').toUpperCase();
}

export function stormTitle(s: Storm): string {
  const cls = stormClass(s);
  const name = (s.nhc?.name || s.name).toUpperCase();
  const kind =
    cls === 'TD' ? 'TROPICAL DEPRESSION' : cls === 'TS' ? 'TROPICAL STORM' : cls === 'STD' ? 'SUBTROPICAL DEPRESSION' : cls === 'STS' ? 'SUBTROPICAL STORM' : cls === 'PTC' ? 'POTENTIAL TROPICAL CYCLONE' : cls === 'HU' || cls === 'MH' ? basinWord(s.pos[0], s.pos[1]) : 'STORM';
  return `${kind} ${name}`;
}

const COMPASS = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];

export function stormDetail(s: Storm): string {
  const n = s.nhc;
  if (n?.windKmh != null) {
    const parts = [`${n.windKmh} KM/H`];
    if (n.pressureMb) parts.push(`${n.pressureMb} MB`);
    if (n.movementDir != null && n.movementKmh != null) parts.push(`${COMPASS[Math.round(n.movementDir / 22.5) % 16]} ${n.movementKmh} KM/H`);
    return parts.join(' · ');
  }
  const parts = [];
  // (The GDACS impact level is drawn beside this as a meter.)
  if (s.peakWindKmh) parts.push(`PEAK ${s.peakWindKmh} KM/H`);
  return parts.join(' · ');
}

/** Saffir–Simpson-style colours by class. */
export function stormColor(cls: string): string {
  switch (cls.toUpperCase()) {
    case 'TD':
    case 'STD':
      return '#5ebaff';
    case 'TS':
    case 'STS':
      return '#00e6d2';
    case 'HU':
      return '#ffb347';
    case 'MH':
      return SEV.warning;
    default:
      return '#c8d6e5';
  }
}

// ---- fires ---------------------------------------------------------------------------

export interface FireManifest {
  generated: string;
  source: string;
  cellDeg: number;
  detections: number;
  count: number;
  /** Flat [lat_index, lon_index, frp_mw×10, hours_ago, detections] per cell. */
  data: number[];
}

export function isFireManifest(v: unknown): v is FireManifest {
  const m = v as Partial<FireManifest> | null;
  return !!m && typeof m.generated === 'string' && Array.isArray(m.data) && typeof m.cellDeg === 'number';
}

export interface FirePoints extends SurfacePoints {
  /** Per cell: brightness 0…1 (log fire power), hours since the latest detection, footprint diameter km. */
  look: Float32Array;
  /** Per cell: hours since the latest detection, and detections merged into it (for counting). */
  ageH: Uint8Array;
  detections: Uint16Array;
}

/** A VIIRS I-band pixel is ~375 m across at nadir: a detection means fire somewhere inside one. */
export const VIIRS_PIXEL_KM2 = 0.375 * 0.375;
export const EARTH_RADIUS_KM_MEAN = 6371;

/** 1 MW (a small fire) → ~0.1; ~3,000 MW (a large complex) → 1. */
export function fireIntensity(frpMw: number): number {
  return Math.max(0, Math.min(1, Math.log10(1 + frpMw) / 3.5));
}

/**
 * Diameter (km) of a circle with the area of a cell's detected pixels — the
 * most ground those detections can stand for. Drawn at this size (never under
 * a device pixel), fires stop looking hundreds of times bigger than they are.
 */
export function fireFootprintKm(detections: number): number {
  return Math.sqrt((Math.max(1, detections) * VIIRS_PIXEL_KM2 * 4) / Math.PI);
}

/** Point size in device pixels for a footprint, given device pixels per Earth radius. */
export function fireSizePx(footprintKm: number, radiusPx: number): number {
  return Math.max(1, (footprintKm * radiusPx) / EARTH_RADIUS_KM_MEAN);
}

/**
 * At whole-globe zoom (several km per pixel) small burns crowd every pixel, so
 * hide fires below a fire-power threshold that grows with km per pixel: ~4 MW
 * at ~9 km/px, none once a pixel is about a kilometre.
 */
export function fireMinIntensity(kmPerPx: number): number {
  const thresholdMw = Math.max(0, Math.min(4, (kmPerPx - 1) * 0.5));
  return thresholdMw ? fireIntensity(thresholdMw) : 0;
}

export function decodeFires(m: FireManifest): FirePoints {
  const n = Math.floor(m.data.length / 5);
  const pos = new Float32Array(n * 3);
  const look = new Float32Array(n * 3);
  const ageH = new Uint8Array(n);
  const detections = new Uint16Array(n);
  for (let i = 0; i < n; i++) {
    const [latI, lonI, frp10, age, count] = m.data.slice(i * 5, i * 5 + 5);
    pos.set(fromLatLon(latI * m.cellDeg, lonI * m.cellDeg), i * 3);
    look[i * 3] = fireIntensity(frp10 / 10);
    look[i * 3 + 1] = age;
    look[i * 3 + 2] = fireFootprintKm(count);
    ageH[i] = age;
    detections[i] = count;
  }
  return { count: n, pos, look, ageH, detections };
}

/**
 * FIRMS's cells and MTG's (mtgFires.ts) as one layer. They aren't merged where both see a
 * cell: each is its own instrument's footprint, and a VIIRS pass hours ago and an FCI scan
 * now are different observations, so both are drawn.
 */
export function joinFires(...parts: (FirePoints | undefined)[]): FirePoints {
  const ps = parts.filter((p): p is FirePoints => !!p);
  const count = ps.reduce((n, p) => n + p.count, 0);
  const out: FirePoints = { count, pos: new Float32Array(count * 3), look: new Float32Array(count * 3), ageH: new Uint8Array(count), detections: new Uint16Array(count) };
  let i = 0;
  for (const p of ps) {
    out.pos.set(p.pos.subarray(0, p.count * 3), i * 3);
    out.look.set(p.look.subarray(0, p.count * 3), i * 3);
    out.ageH.set(p.ageH.subarray(0, p.count), i);
    out.detections.set(p.detections.subarray(0, p.count), i);
    i += p.count;
  }
  return out;
}

/** Detections and cells within the last `hours`. */
export function firesWithin(f: FirePoints, hours: number): { cells: number; detections: number } {
  let cells = 0;
  let det = 0;
  for (let i = 0; i < f.count; i++) {
    if (f.ageH[i] <= hours) {
      cells++;
      det += f.detections[i];
    }
  }
  return { cells, detections: det };
}

// ---- earthquakes ---------------------------------------------------------------------

/** USGS real-time feed: M2.5+ in the past day, GeoJSON, CORS-enabled, updated every minute. */
export const USGS_QUAKES_URL = 'https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/2.5_day.geojson';

export interface Quake {
  id: string;
  mag: number;
  place: string;
  /** Origin time, ms. */
  time: number;
  lat: number;
  lon: number;
  depthKm: number;
  tsunami: boolean;
  /** USGS PAGER alert (green / yellow / orange / red), when issued. */
  alert: string | null;
}

interface QuakeFeature {
  id: string;
  properties: { mag: number | null; place: string | null; time: number; tsunami?: number; alert?: string | null };
  geometry: { coordinates: [number, number, number] };
}

export function isQuakeFeed(v: unknown): v is { features: QuakeFeature[] } {
  const f = v as { features?: unknown } | null;
  return !!f && Array.isArray(f.features);
}

/** Quakes with a magnitude, largest first. */
export function decodeQuakes(feed: { features: QuakeFeature[] }): Quake[] {
  return feed.features
    .filter((f) => f.properties.mag != null && f.geometry?.coordinates)
    .map((f) => ({
      id: f.id,
      mag: f.properties.mag as number,
      place: f.properties.place ?? '',
      time: f.properties.time,
      lon: f.geometry.coordinates[0],
      lat: f.geometry.coordinates[1],
      depthKm: f.geometry.coordinates[2],
      tsunami: !!f.properties.tsunami,
      alert: f.properties.alert ?? null,
    }))
    .sort((a, b) => b.mag - a.mag);
}

/** Ring radius in CSS px: ×1.5 per magnitude step (M2.5 → 2.5 px, M5 → 7, M7 → 16). */
export function quakeRadius(mag: number): number {
  return 2.5 * 1.5 ** Math.max(0, mag - 2.5);
}

/** Red within the hour, orange within 6 h, then yellow; fading over the day. */
export function quakeStyle(ageMs: number): { color: string; alpha: number } {
  const h = ageMs / 3_600_000;
  const color = h < 1 ? SEV.warning : h < 6 ? '#ff8c42' : '#ffd166';
  return { color, alpha: Math.max(0.35, 1 - h / 30) };
}

export function quakeAge(ageMs: number): string {
  const min = Math.round(ageMs / 60_000);
  return min < 60 ? `${min} MIN AGO` : `${Math.round(min / 60)} H AGO`;
}

/** Label the biggest few, and anything notable (M6+, a tsunami flag, a PAGER alert). */
export function labelledQuakes(quakes: Quake[], max = 4): Quake[] {
  return quakes.filter((q, i) => i < max || q.mag >= 6 || q.tsunami || (q.alert && q.alert !== 'green'));
}

// ---- lightning (GOES GLM, via the pipeline) -------------------------------------------

export interface LightningManifest {
  generated: string;
  source: string;
  satellites: string[];
  /** Flashes gathered over this many minutes, ending at `latest`. */
  windowMin: number;
  latest: string | null;
  cellDeg: number;
  flashes: number;
  count: number;
  /** Flat [lat_index, lon_index, flashes, minutes_ago] per cell. */
  data: number[];
}

export function isLightningManifest(v: unknown): v is LightningManifest {
  const m = v as Partial<LightningManifest> | null;
  return !!m && typeof m.generated === 'string' && Array.isArray(m.data) && typeof m.cellDeg === 'number' && typeof m.windowMin === 'number';
}

/** A GLM pixel is ~8 km across at nadir: a flash is placed within one. */
export const GLM_PIXEL_KM = 8;

/** One flash in the window → 0.15; ~300 (a vigorous storm cell) → 1. */
export function lightningIntensity(flashes: number): number {
  return Math.max(0, Math.min(1, 0.15 + (0.85 * Math.log10(Math.max(1, flashes))) / Math.log10(300)));
}

/** Points for the GL layer: ages in minutes before the newest file. */
export function decodeLightning(m: LightningManifest): SurfacePoints {
  return lightningPoints(m.data, m.cellDeg);
}

/** Flat [lat_index, lon_index, flashes, minutes_ago] cells (GOES, MTG or both) → GL points. */
export function lightningPoints(data: number[], cellDeg: number): SurfacePoints {
  const n = Math.floor(data.length / 4);
  const pos = new Float32Array(n * 3);
  const look = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const [latI, lonI, flashes, age] = data.slice(i * 4, i * 4 + 4);
    pos.set(fromLatLon(latI * cellDeg, lonI * cellDeg), i * 3);
    look[i * 3] = lightningIntensity(flashes);
    look[i * 3 + 1] = age;
    look[i * 3 + 2] = GLM_PIXEL_KM;
  }
  return { count: n, pos, look };
}

// ---- snow and ice (NOAA IMS + Sea Ice Index, via the pipeline) ------------------------

export interface SnowIceManifest {
  generated: string;
  source: string;
  /** PNG beside latest.json: red = snow, green = ice concentration. */
  image: string;
  /** IMS chart date (Northern Hemisphere snow and ice). */
  ims: string;
  /** Sea Ice Index date (Antarctic sea ice), when one was found. */
  seaIceSouth?: string;
}

export function isSnowIceManifest(v: unknown): v is SnowIceManifest {
  const m = v as Partial<SnowIceManifest> | null;
  return !!m && typeof m.generated === 'string' && typeof m.image === 'string' && typeof m.ims === 'string';
}

const shortDate = (iso: string) =>
  new Date(`${iso.slice(0, 10)}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });

// ---- smoke (NOAA HMS, via the pipeline) --------------------------------------------------

export interface SmokeManifest {
  generated: string;
  /** Analysis day (UTC). */
  date: string;
  /** PNG beside latest.json: density 0 / 85 / 170 / 255. */
  image: string;
  plumes: { Light: number; Medium: number; Heavy: number };
  /** End of the latest analysis period in the file. */
  latest: string | null;
}

export function isSmokeManifest(v: unknown): v is SmokeManifest {
  const m = v as Partial<SmokeManifest> | null;
  return !!m && typeof m.generated === 'string' && typeof m.image === 'string' && !!m.plumes;
}

/** The readout's smoke row: plumes analysed, and how many are heavy. */
export function smokeSummary(m: SmokeManifest): string {
  const p = m.plumes;
  const n = p.Light + p.Medium + p.Heavy;
  return `${n} plume${n === 1 ? '' : 's'}${p.Heavy ? ` · ${p.Heavy} heavy` : ''}`;
}

// ---- GDACS floods, wildfires, volcanoes (via the pipeline) -----------------------------

export type GdacsType = 'FL' | 'WF' | 'VO';

export interface GdacsEvent {
  id: string;
  type: GdacsType;
  /** Country for floods and fires, the volcano's name for eruptions. */
  name: string;
  country: string;
  /** Green / Orange / Red. */
  alert: string;
  /** [lon, lat] */
  pos: [number, number];
  from: string | null;
  to: string | null;
  url: string;
  /** Wildfires: burned area, hectares. */
  areaHa?: number;
}

export interface EventManifest {
  generated: string;
  volcanoDays: number;
  counts: Record<GdacsType, number>;
  events: GdacsEvent[];
}

export function isEventManifest(v: unknown): v is EventManifest {
  const m = v as Partial<EventManifest> | null;
  return !!m && typeof m.generated === 'string' && Array.isArray(m.events) && !!m.counts;
}

export const EVENT_COLOR: Record<GdacsType, string> = { FL: '#4da3ff', WF: '#ff7a45', VO: SEV.warning };
export const ALERT_COLOR: Record<string, string> = { Green: '#6fdc8c', Orange: SEV.watch, Red: SEV.warning };

/**
 * GDACS alert levels grade expected humanitarian impact (hazard × exposed population ×
 * vulnerability), not the size of the event, so they're shown as an impact meter — one, two
 * or three bars lit in the alert's colour: Green → low (international help unlikely to be
 * needed), Orange → medium (may be), Red → high (likely). 0: not a GDACS level.
 */
export function impactLevel(alert: string | null | undefined): 0 | 1 | 2 | 3 {
  return ({ green: 1, orange: 2, red: 3 } as Record<string, 1 | 2 | 3>)[(alert ?? '').trim().toLowerCase()] ?? 0;
}

/** Colour of each impact level, as GDACS draws it. */
export const IMPACT_COLOR = ['#c8d6e5', ALERT_COLOR.Green, ALERT_COLOR.Orange, ALERT_COLOR.Red] as const;
export const IMPACT_WORD = ['Unknown', 'Low', 'Medium', 'High'] as const;
const EVENT_WORD: Record<GdacsType, string> = { FL: 'FLOOD', WF: 'WILDFIRE', VO: 'ERUPTION' };

/** Radius (km) of a circle with the burned area. 1 ha = 0.01 km². */
export function burnedRadiusKm(areaHa: number): number {
  return Math.sqrt((areaHa * 0.01) / Math.PI);
}

export function eventTitle(e: GdacsEvent): string {
  return `${EVENT_WORD[e.type]} · ${e.name.toUpperCase()}`;
}

function daysAgo(iso: string | null, now: number): string {
  if (!iso) return '';
  const d = Math.floor((now - Date.parse(iso)) / 86_400_000);
  return d <= 0 ? 'TODAY' : d === 1 ? 'YESTERDAY' : `${d} DAYS AGO`;
}

/** Second row: what GDACS knows, then the alert level (drawn in its colour). */
export function eventDetail(e: GdacsEvent, now: number): string {
  if (e.type === 'WF') return e.areaHa ? `${e.areaHa.toLocaleString('en-US')} HA BURNED` : 'ACTIVE';
  if (e.type === 'VO') return `${e.country.toUpperCase()} · ${daysAgo(e.from, now)}`;
  return e.from ? `SINCE ${shortDate(e.from).toUpperCase()}` : 'ONGOING';
}

/** Marker half-size in CSS px by alert level. */
export function eventSize(alert: string): number {
  return alert === 'Red' ? 9 : alert === 'Orange' ? 7.5 : 5.5;
}

/**
 * Label every flood, eruption and Orange/Red alert, but only the few largest
 * Green wildfires — GDACS lists dozens, and FIRMS already shows where they burn.
 */
export function labelledEvents(events: GdacsEvent[], maxGreenFires = 3): GdacsEvent[] {
  const fires = events
    .filter((e) => e.type === 'WF' && e.alert === 'Green')
    .sort((a, b) => (b.areaHa ?? 0) - (a.areaHa ?? 0))
    .slice(0, maxGreenFires);
  return events.filter((e) => e.type !== 'WF' || e.alert !== 'Green' || fires.includes(e));
}

/** The readout's GDACS row: events of each kind (eruptions over the manifest's window). */
export function eventSummary(m: EventManifest): string {
  const c = m.counts;
  const n = (k: number, one: string, many: string) => `${k} ${k === 1 ? one : many}`;
  return `${n(c.FL, 'flood', 'floods')} · ${n(c.WF, 'wildfire', 'wildfires')} · ${n(c.VO, 'eruption', 'eruptions')} in ${m.volcanoDays} d`;
}
