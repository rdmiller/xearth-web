// US severe weather: the National Weather Service's storm-based warnings (tornado, severe
// thunderstorm, flash flood…) as the polygons the forecasters drew, and the Storm Prediction
// Center's day-1 convective outlook as its risk areas. Both are GeoJSON with CORS
// (api.weather.gov, spc.noaa.gov), so the browser reads them directly. Decoding and styling
// only; drawing is in overlay.ts.

import { EVENT_COLOR } from './hazards';
import { clip } from './tsunami';
import { SEV } from './tokens';

/** [lon, lat] rings, as GeoJSON has them; the first ring of a polygon is its outline, the rest holes. */
export type Ring = [number, number][];
export type Polygon = Ring[];

// ---- NWS warnings -------------------------------------------------------------------------

/**
 * Short-fused warnings NWS issues as a polygon around the threat itself, not by county or
 * zone, in the order they're drawn (most severe last, so on top). Flood warnings for rivers,
 * watches and advisories cover counties and zones instead, and are left out.
 */
export const WARNING_EVENTS = [
  'Flash Flood Warning',
  'Snow Squall Warning',
  'Dust Storm Warning',
  'Severe Thunderstorm Warning',
  'Extreme Wind Warning',
  'Tornado Warning',
] as const;
export type WarningEvent = (typeof WARNING_EVENTS)[number];

export const NWS_WARNINGS_URL = `https://api.weather.gov/alerts/active?status=actual&event=${WARNING_EVENTS.map(encodeURIComponent).join(',')}`;

export const WARNING_COLOR: Record<WarningEvent, string> = {
  'Tornado Warning': SEV.warning,
  'Extreme Wind Warning': SEV.warning,
  'Severe Thunderstorm Warning': SEV.watch,
  'Dust Storm Warning': '#d9a066',
  'Snow Squall Warning': '#c7e0ff',
  'Flash Flood Warning': EVENT_COLOR.FL,
};

/** Shorter names for labels and the readout. */
const WARNING_SHORT: Record<WarningEvent, string> = {
  'Tornado Warning': 'tornado',
  'Extreme Wind Warning': 'extreme wind',
  'Severe Thunderstorm Warning': 'severe t-storm',
  'Dust Storm Warning': 'dust storm',
  'Snow Squall Warning': 'snow squall',
  'Flash Flood Warning': 'flash flood',
};

export interface SevereWarning {
  id: string;
  event: WarningEvent;
  areaDesc: string;
  sent: string;
  expires: string | null;
  polygons: Polygon[];
  /** What NWS says of the threat: "OBSERVED", "70 MPH", "1.75 IN HAIL", "DESTRUCTIVE"… */
  tags: string[];
  /** A tornado emergency, a "destructive" thunderstorm or a "catastrophic" flash flood. */
  extreme: boolean;
}

interface NwsFeature {
  geometry?: { type?: string; coordinates?: unknown } | null;
  properties?: {
    id?: string;
    event?: string;
    status?: string;
    messageType?: string;
    areaDesc?: string;
    sent?: string;
    expires?: string | null;
    ends?: string | null;
    parameters?: Record<string, string[] | undefined>;
  };
}

/** Polygon or MultiPolygon → polygons; anything else → none. */
export function polygonsOf(geometry: unknown): Polygon[] {
  const g = geometry as { type?: string; coordinates?: unknown } | null;
  if (!g || !Array.isArray(g.coordinates)) return [];
  if (g.type === 'Polygon') return [g.coordinates as Polygon];
  if (g.type === 'MultiPolygon') return g.coordinates as Polygon[];
  return [];
}

const first = (p: Record<string, string[] | undefined> | undefined, key: string) => p?.[key]?.[0]?.trim();

/** The threat as NWS tags it: detection, wind, hail, damage threat. */
export function warningTags(parameters: Record<string, string[] | undefined> | undefined): string[] {
  const tags: string[] = [];
  const tornado = first(parameters, 'tornadoDetection');
  if (tornado) tags.push(tornado.toUpperCase());
  const wind = first(parameters, 'maxWindGust');
  if (wind && !/^0\b/.test(wind)) tags.push(wind.toUpperCase());
  const hail = first(parameters, 'maxHailSize');
  if (hail && Number(hail) > 0) tags.push(`${hail} IN HAIL`);
  for (const key of ['tornadoDamageThreat', 'thunderstormDamageThreat', 'flashFloodDamageThreat']) {
    const threat = first(parameters, key);
    if (threat) tags.push(threat.toUpperCase());
  }
  const flood = first(parameters, 'flashFloodDetection');
  if (flood) tags.push(flood.toUpperCase());
  return [...new Set(tags)];
}

/** Real, current warnings with a polygon; cancellations and tests are dropped. */
export function decodeWarnings(json: unknown): SevereWarning[] {
  const features = (json as { features?: NwsFeature[] } | null)?.features;
  if (!Array.isArray(features)) return [];
  return features.flatMap((f) => {
    const p = f.properties;
    const event = p?.event as WarningEvent | undefined;
    if (!p || !event || !WARNING_EVENTS.includes(event) || p.status !== 'Actual' || p.messageType === 'Cancel') return [];
    const polygons = polygonsOf(f.geometry);
    if (!polygons.length) return [];
    const tags = warningTags(p.parameters);
    const extreme = tags.includes('CATASTROPHIC') || tags.includes('DESTRUCTIVE') || (event === 'Tornado Warning' && tags.includes('CONSIDERABLE'));
    return [{ id: p.id ?? '', event, areaDesc: p.areaDesc ?? '', sent: p.sent ?? '', expires: p.ends ?? p.expires ?? null, polygons, tags, extreme }];
  });
}

/** Tornadoes and extreme wind always get a label; anything else only when NWS calls it extreme. */
export const warningLabelled = (w: SevereWarning) => w.event === 'Tornado Warning' || w.event === 'Extreme Wind Warning' || w.extreme;

/** Callout rows: "TORNADO WARNING · OBSERVED", "SEDGWICK, KS", "UNTIL 02:45Z". */
export function warningRows(w: SevereWarning): string[] {
  const head = [w.event.toUpperCase(), ...w.tags.slice(0, 2)].join(' · ');
  const areas = w.areaDesc.split(';').map((s) => s.trim()).filter(Boolean);
  const more = areas.length > 1 ? ` +${areas.length - 1}` : '';
  const until = w.expires ? `UNTIL ${new Date(w.expires).toISOString().slice(11, 16)}Z` : '';
  return [clip(head, 52), clip((areas[0] ?? '').toUpperCase(), 40) + more, until].filter(Boolean);
}

// ---- SPC day-1 convective outlook ---------------------------------------------------------

export const SPC_DAY1_URL = 'https://www.spc.noaa.gov/products/outlook/day1otlk_cat.nolyr.geojson';

/** SPC's categories, low to high. */
export const OUTLOOK_LEVELS = ['TSTM', 'MRGL', 'SLGT', 'ENH', 'MDT', 'HIGH'] as const;
export type OutlookLevel = (typeof OUTLOOK_LEVELS)[number];

export interface OutlookArea {
  level: OutlookLevel;
  /** "Slight Risk" */
  name: string;
  /** SPC's own colours. */
  stroke: string;
  fill: string;
  /** "Non-layered": each ring has a hole where the next level up sits, so fill even-odd. */
  polygons: Polygon[];
}

export interface Outlook {
  issued: string;
  valid: string;
  expires: string;
  areas: OutlookArea[];
}

interface SpcFeature {
  geometry?: unknown;
  properties?: { LABEL?: string; LABEL2?: string; stroke?: string; fill?: string; VALID_ISO?: string; EXPIRE_ISO?: string; ISSUE_ISO?: string };
}

export function decodeOutlook(json: unknown): Outlook | null {
  const features = (json as { features?: SpcFeature[] } | null)?.features;
  if (!Array.isArray(features)) return null;
  const areas: OutlookArea[] = [];
  let times = { issued: '', valid: '', expires: '' };
  for (const f of features) {
    const p = f.properties;
    const level = p?.LABEL as OutlookLevel | undefined;
    if (!p || !level || !OUTLOOK_LEVELS.includes(level)) continue;
    const polygons = polygonsOf(f.geometry);
    if (!polygons.length) continue;
    areas.push({ level, name: p.LABEL2 ?? level, stroke: p.stroke ?? '#888888', fill: p.fill ?? '#888888', polygons });
    times = { issued: p.ISSUE_ISO ?? '', valid: p.VALID_ISO ?? '', expires: p.EXPIRE_ISO ?? '' };
  }
  areas.sort((a, b) => OUTLOOK_LEVELS.indexOf(a.level) - OUTLOOK_LEVELS.indexOf(b.level));
  return { ...times, areas };
}

/** The highest category, if it's worth a label (Slight Risk and up). */
export function outlookTop(o: Outlook | null): OutlookArea | undefined {
  const top = o?.areas[o.areas.length - 1];
  return top && OUTLOOK_LEVELS.indexOf(top.level) >= OUTLOOK_LEVELS.indexOf('SLGT') ? top : undefined;
}

export function outlookRows(o: Outlook, top: OutlookArea): string[] {
  const until = o.expires ? `UNTIL ${new Date(o.expires).toISOString().slice(11, 16)}Z` : '';
  return [`SPC DAY 1 · ${top.name.toUpperCase()}`, ['SEVERE STORMS OUTLOOK', until].filter(Boolean).join(' · ')];
}

/** The ring with the most vertices: where a label for the area goes. */
export function largestRing(polygons: Polygon[]): Ring | undefined {
  return polygons.map((p) => p[0]).filter(Boolean).sort((a, b) => b.length - a.length)[0];
}

/** Vertex mean of a ring, [lon, lat]. */
export function ringCentre(ring: Ring): [number, number] {
  const [sx, sy] = ring.reduce(([x, y], [lon, lat]) => [x + lon, y + lat], [0, 0]);
  return [sx / ring.length, sy / ring.length];
}

/**
 * Extra points along any edge longer than `maxDeg`, so a long edge follows the globe's curve
 * instead of cutting a straight chord across the screen.
 */
export function densify(ring: Ring, maxDeg = 1): Ring {
  const out: Ring = [];
  for (let i = 0; i < ring.length; i++) {
    const [a0, a1] = ring[i];
    out.push([a0, a1]);
    const next = ring[i + 1];
    if (!next) break;
    const n = Math.ceil(Math.hypot(next[0] - a0, next[1] - a1) / maxDeg);
    for (let k = 1; k < n; k++) out.push([a0 + ((next[0] - a0) * k) / n, a1 + ((next[1] - a1) * k) / n]);
  }
  return out;
}

/** The readout's row: "2 tornado · 4 severe t-storm warnings · SPC slight risk". */
export function severeSummary(warnings: SevereWarning[], outlook: Outlook | null): string | undefined {
  const counts = new Map<WarningEvent, number>();
  for (const w of warnings) counts.set(w.event, (counts.get(w.event) ?? 0) + 1);
  const parts = [...WARNING_EVENTS]
    .reverse()
    .filter((e) => counts.get(e))
    .map((e) => `${counts.get(e)} ${WARNING_SHORT[e]}`);
  const warned = parts.length ? `${parts.join(' · ')} warning${warnings.length === 1 ? '' : 's'}` : 'no warnings';
  const top = outlook?.areas[outlook.areas.length - 1];
  const risk = top ? `SPC ${top.name.toLowerCase()}` : outlook ? 'SPC no thunder' : undefined;
  return [warned, risk].filter(Boolean).join(' · ');
}
