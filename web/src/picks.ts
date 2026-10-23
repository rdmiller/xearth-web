// Clicking things on the globe. A press that doesn't move picks the nearest marker within its
// reach (a satellite, a launch, a quake, a cyclone, a GDACS event, a tsunami bulletin, a
// fireball) or else the severe-weather warning under the pointer, and opens its details in a
// window. Satellites and launches in flight are followed too (view=track).
//
// A pick is written `kind:id` (?pick=quake:us7000abcd), so a link or a reload reopens it once
// its layer's data is in. This module only decides what was hit and what its window says;
// main.ts gathers the markers and draws them.

import { IMPACT_WORD, impactLevel, quakeAge, quakeStyle, stormClass, stormTitle, EVENT_COLOR, eventTitle, type GdacsEvent, type Quake, type Storm } from './hazards';
import { formatClock, shortRocket, type LaunchPhase, type LaunchState } from './launches';
import type { Fireball } from './meteors';
import { periodMinutes, type Elements, type SatState } from './satellites';
import type { Polygon, SevereWarning } from './severe';
import type { ToastTone } from './toasts';
import { TSUNAMI_COLOR, clip, type TsunamiBulletin } from './tsunami';

export const PICK_KINDS = ['sat', 'launch', 'quake', 'storm', 'event', 'tsunami', 'fireball', 'warning'] as const;
export type PickKind = (typeof PICK_KINDS)[number];

export interface Selection {
  kind: PickKind;
  id: string;
}

export const pickKey = (kind: PickKind, id: string) => `${kind}:${id}`;

/** `kind:id` → its parts; anything else (including '') → undefined. Ids may hold colons (NWS urns). */
export function parsePick(key: string): Selection | undefined {
  const i = key.indexOf(':');
  const kind = key.slice(0, i) as PickKind;
  const id = key.slice(i + 1);
  return i > 0 && id && PICK_KINDS.includes(kind) ? { kind, id } : undefined;
}

/** A marker where it's drawn (CSS px) and how far from it a click still counts. */
export interface PickTarget {
  x: number;
  y: number;
  reach: number;
  key: string;
}

/** The target nearest (x, y) among those whose reach covers it; undefined if none. */
export function nearestTarget<T extends PickTarget>(targets: Iterable<T>, x: number, y: number): T | undefined {
  let best: T | undefined;
  let bestD = Infinity;
  for (const t of targets) {
    const d = Math.hypot(t.x - x, t.y - y);
    if (d <= t.reach && d < bestD) [best, bestD] = [t, d];
  }
  return best;
}

/**
 * Is (lon, lat) inside a GeoJSON polygon (outline, then holes)? Even–odd in plain degrees:
 * warnings are county-sized and never cross the antimeridian.
 */
export function inPolygon(lon: number, lat: number, polygon: Polygon): boolean {
  let inside = false;
  for (const ring of polygon) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i];
      const [xj, yj] = ring[j];
      if (yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
    }
  }
  return inside;
}

// ---- what a window says ----------------------------------------------------------------

export interface PickDetail {
  title: string;
  /** The chip under the title: what kind of thing it is, in its colour. */
  kind: string;
  color: string;
  lat?: number;
  lon?: number;
  /** The header's chip: how old, or what state it's in. */
  status?: { text: string; tone: ToastTone };
  tiles: { label: string; value: string }[];
  /** Lines of text under the tiles (an area, a note, a source). */
  notes: string[];
  link?: { href: string; text: string };
  /** Something that moves: the window offers Follow / Stop following. */
  followable?: boolean;
}

const MIN = 60_000;

/** "12 min ago", "5 h ago", "3 d ago". */
export function ago(ms: number): string {
  const min = Math.max(0, Math.round(ms / MIN));
  return min < 90 ? `${min} min ago` : min < 48 * 60 ? `${Math.round(min / 60)} h ago` : `${Math.round(min / 1440)} d ago`;
}

/** "21 Oct 14:05 UTC". */
export function utc(t: number | string): string {
  const d = new Date(t);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' })} ${d.toISOString().slice(11, 16)} UTC`;
}

const sinceIso = (iso: string | null | undefined, now: number) => (iso && !Number.isNaN(Date.parse(iso)) ? now - Date.parse(iso) : undefined);

/** "92 min" for low orbits, "11.97 h" for navigation, "23.93 h" for geostationary. */
export function formatPeriod(minutes: number): string {
  return minutes < 180 ? `${minutes.toFixed(1)} min` : `${(minutes / 60).toFixed(2)} h`;
}

export interface SatInfo {
  name: string;
  norad: number;
  /** Its category: "Starlink", "GPS", "Tracked" for the named ones. */
  group: string;
  /** A line on what it is ("International Space Station"), for the named ones. */
  about?: string;
  color: string;
  state: SatState;
  elements: Elements;
  /** Placed from NASA's live telemetry rather than SGP4 (the ISS). */
  live?: boolean;
}

export function satDetail(s: SatInfo, now: number): PickDetail {
  const epoch = s.elements[1] * 1000;
  return {
    title: s.name,
    kind: s.group,
    color: s.color,
    lat: s.state.lat,
    lon: s.state.lon,
    status: s.state.sunlit ? { text: 'SUNLIT', tone: 'ok' } : { text: 'IN SHADOW', tone: 'info' },
    tiles: [
      { label: 'Altitude', value: `${Math.round(s.state.altKm).toLocaleString('en-US')} km` },
      { label: 'Speed', value: `${s.state.speed.toFixed(2)} km/s` },
      { label: 'Period', value: formatPeriod(periodMinutes(s.elements)) },
      { label: 'Inclination', value: `${s.elements[4].toFixed(1)}°` },
    ],
    notes: [...(s.about ? [s.about] : []), `NORAD ${s.norad} · ${s.live ? 'placed by NASA telemetry' : `elements from ${ago(now - epoch)}`}`],
    link: { href: `https://www.n2yo.com/satellite/?s=${s.norad}`, text: 'N2YO' },
    followable: true,
  };
}

const PHASE: Record<LaunchPhase, string> = {
  countdown: 'COUNTDOWN',
  ascent: 'ASCENT (APPROX.)',
  coast: 'COAST',
  deployed: 'DEPLOYED',
  inflight: 'IN FLIGHT',
  done: 'DONE',
};

export function launchDetail(st: LaunchState, color: string): PickDetail {
  const l = st.launch;
  const tiles = [
    { label: 'Clock', value: formatClock(st.t) },
    { label: 'Status', value: l.status.name || l.status.abbrev || '?' },
  ];
  if (st.altKm !== undefined) tiles.push({ label: 'Altitude', value: `${Math.round(st.altKm)} km` });
  if (st.speed !== undefined) tiles.push({ label: 'Speed', value: `${st.speed.toFixed(1)} km/s` });
  // Launch Library says "N/A" or "Unknown" when it doesn't know.
  if (l.orbit && !/^(n\/a|unknown)$/i.test(l.orbit.trim())) tiles.push({ label: 'Orbit', value: l.orbit });
  const notes = [`${l.provider} · ${l.pad.name}`, l.pad.location, `NET ${utc(l.net)}`];
  if (st.phase === 'inflight') notes.push('No trajectory data: shown on the pad');
  else if (st.approximate) notes.push('Ascent synthesised up to the predicted orbit');
  return {
    title: `${shortRocket(l.rocket)} · ${l.mission}`,
    kind: PHASE[st.phase],
    color,
    lat: l.pad.lat,
    lon: l.pad.lon,
    status: l.webcastLive ? { text: '● WEBCAST', tone: 'bad' } : st.t < 0 ? { text: l.status.abbrev, tone: 'info' } : undefined,
    tiles,
    notes,
    followable: true,
  };
}

export function quakeDetail(q: Quake, now: number): PickDetail {
  const tiles = [
    { label: 'Magnitude', value: `M${q.mag.toFixed(1)}` },
    { label: 'Depth', value: `${Math.round(q.depthKm)} km` },
  ];
  if (q.alert) tiles.push({ label: 'PAGER alert', value: q.alert[0].toUpperCase() + q.alert.slice(1) });
  if (q.tsunami) tiles.push({ label: 'Tsunami', value: 'Flagged' });
  return {
    title: `M${q.mag.toFixed(1)} · ${q.place || 'Earthquake'}`,
    kind: 'EARTHQUAKE',
    color: quakeStyle(now - q.time).color,
    lat: q.lat,
    lon: q.lon,
    status: { text: quakeAge(now - q.time).toLowerCase(), tone: now - q.time < 3_600_000 ? 'warn' : 'info' },
    tiles,
    notes: [utc(q.time)],
    link: { href: `https://earthquake.usgs.gov/earthquakes/eventpage/${encodeURIComponent(q.id)}`, text: 'USGS' },
  };
}

const COMPASS = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];

export function stormInfo(s: Storm, color: string, now: number): PickDetail {
  const n = s.nhc;
  const tiles: { label: string; value: string }[] = [];
  const cls = stormClass(s);
  if (cls) tiles.push({ label: 'Class', value: cls });
  if (n?.windKmh != null) tiles.push({ label: 'Wind', value: `${n.windKmh} km/h` });
  else if (s.peakWindKmh) tiles.push({ label: 'Peak wind', value: `${s.peakWindKmh} km/h` });
  if (n?.pressureMb) tiles.push({ label: 'Pressure', value: `${n.pressureMb} hPa` });
  if (n?.movementDir != null && n.movementKmh != null) tiles.push({ label: 'Moving', value: `${COMPASS[Math.round(n.movementDir / 22.5) % 16]} ${n.movementKmh} km/h` });
  const level = impactLevel(s.alert);
  if (level) tiles.push({ label: 'GDACS impact', value: IMPACT_WORD[level] });
  const updated = n?.updated ?? s.updated;
  const age = sinceIso(updated, now);
  return {
    title: stormTitle(s),
    kind: 'TROPICAL CYCLONE',
    color,
    lat: s.pos[1],
    lon: s.pos[0],
    status: age !== undefined ? { text: ago(age), tone: 'info' } : undefined,
    tiles,
    notes: [n ? 'NHC advisory · GDACS track' : `Track from ${s.source || 'GDACS'}`, ...(updated ? [`Updated ${utc(updated)}`] : [])],
    link: { href: n ? 'https://www.nhc.noaa.gov/' : 'https://www.gdacs.org/', text: n ? 'NHC' : 'GDACS' },
  };
}

const EVENT_KIND = { FL: 'FLOOD', WF: 'WILDFIRE', VO: 'ERUPTION' } as const;

export function eventInfo(e: GdacsEvent, now: number): PickDetail {
  const level = impactLevel(e.alert);
  const tiles: { label: string; value: string }[] = [{ label: 'GDACS impact', value: IMPACT_WORD[level] }];
  if (e.areaHa) tiles.push({ label: 'Burned', value: `${e.areaHa.toLocaleString('en-US')} ha` });
  if (e.from) tiles.push({ label: 'Since', value: utc(e.from).replace(/ \d\d:\d\d UTC$/, '') });
  if (e.country && e.country !== e.name) tiles.push({ label: 'Country', value: e.country });
  const age = sinceIso(e.from, now);
  return {
    title: eventTitle(e),
    kind: EVENT_KIND[e.type],
    color: EVENT_COLOR[e.type],
    lat: e.pos[1],
    lon: e.pos[0],
    status: level ? { text: e.alert.toUpperCase(), tone: level >= 3 ? 'bad' : level === 2 ? 'warn' : 'ok' } : undefined,
    tiles,
    notes: age !== undefined ? [`Began ${ago(age)}`] : [],
    link: e.url ? { href: e.url, text: 'GDACS' } : undefined,
  };
}

export function tsunamiInfo(b: TsunamiBulletin, now: number): PickDetail {
  const tiles = [{ label: 'Centre', value: b.center }];
  if (b.magnitude != null) tiles.push({ label: 'Magnitude', value: `${b.magnitudeType ?? 'M'} ${b.magnitude.toFixed(1)}` });
  const age = sinceIso(b.issued, now);
  const alert = ['warning', 'threat', 'advisory', 'watch'].includes(b.category);
  return {
    title: `Tsunami ${b.category || 'bulletin'}`,
    kind: (b.category || 'bulletin').toUpperCase(),
    color: TSUNAMI_COLOR[b.category] ?? TSUNAMI_COLOR.information,
    lat: b.lat,
    lon: b.lon,
    status: age !== undefined ? { text: ago(age), tone: alert ? 'bad' : 'info' } : undefined,
    tiles,
    notes: [b.region, ...(b.note ? [clip(b.note, 160)] : []), ...(b.issued ? [`Issued ${utc(b.issued)}`] : [])],
    link: { href: b.bulletin ?? 'https://www.tsunami.gov/', text: b.bulletin ? 'Bulletin' : 'tsunami.gov' },
  };
}

export function fireballInfo(f: Fireball, color: string, now: number): PickDetail {
  const tiles: { label: string; value: string }[] = [];
  if (f.impactKt != null) tiles.push({ label: 'Impact energy', value: `${f.impactKt < 0.1 ? f.impactKt.toFixed(2) : f.impactKt.toFixed(1)} kt` });
  if (f.energy != null) tiles.push({ label: 'Radiated', value: `${f.energy.toFixed(1)} × 10¹⁰ J` });
  if (f.alt != null) tiles.push({ label: 'Altitude', value: `${Math.round(f.alt)} km` });
  if (f.vel != null) tiles.push({ label: 'Speed', value: `${f.vel.toFixed(1)} km/s` });
  return {
    title: 'Fireball',
    kind: 'FIREBALL',
    color,
    lat: f.lat,
    lon: f.lon,
    status: { text: ago(now - Date.parse(f.time)), tone: 'info' },
    tiles,
    notes: [utc(f.time), 'Detected by US Government sensors'],
    link: { href: 'https://cneos.jpl.nasa.gov/fireballs/', text: 'CNEOS' },
  };
}

export function warningInfo(w: SevereWarning, color: string, centre: [number, number] | undefined, now: number): PickDetail {
  const tiles: { label: string; value: string }[] = [];
  if (w.expires) tiles.push({ label: 'Until', value: utc(w.expires) });
  for (const tag of w.tags.slice(0, 3)) tiles.push({ label: 'Threat', value: tag });
  const age = sinceIso(w.sent, now);
  return {
    title: w.event,
    kind: w.extreme ? 'EXTREME' : 'NWS WARNING',
    color,
    lat: centre?.[1],
    lon: centre?.[0],
    status: age !== undefined ? { text: ago(age), tone: w.extreme ? 'bad' : 'warn' } : undefined,
    tiles,
    notes: [clip(w.areaDesc.replace(/;\s*/g, ' · '), 200)],
    link: { href: 'https://www.weather.gov/', text: 'NWS' },
  };
}
