// Buoys: the ocean's weather stations, from NOAA's OSMC and NDBC via the pipeline (buoys.py).
// latest.json puts each on the globe with its latest readings; history.json holds the last
// 24 hours for a buoy's window, and is only fetched once one is opened. Argo floats (they
// surface every ~10 days) are in latest.json too; argo.json holds their latest temperature
// and salinity profiles and their tracks, fetched once a float's window opens. Decoding,
// picking and wording here; the window is buoyView.ts.

import { compass, distanceKm, speed, temp } from './locale';

export type BuoyType = 'moored' | 'drifting' | 'tropical' | 'ice' | 'dart' | 'argo';

export interface Buoy {
  id: string;
  type: BuoyType;
  /** NDBC's name for its own stations ("SAN FRANCISCO - 18NM West of San Francisco, CA"). */
  name?: string;
  lat: number;
  lon: number;
  /** Its latest report, ISO. */
  time: string;
  /** Water and air temperature °C, sea-level pressure hPa, wind m/s and ° (from), gust m/s. */
  sst?: number | null;
  atmp?: number | null;
  slp?: number | null;
  wspd?: number | null;
  wdir?: number | null;
  gust?: number | null;
  /** Significant wave height m, dominant period s, mean direction ° (from). */
  wvht?: number | null;
  dpd?: number | null;
  mwd?: number | null;
  /** DART: water-column height m, and whether it's reporting in event (tsunami) mode. */
  height?: number;
  event?: boolean;
  /** Argo: its latest surfacing's cycle, the float's model and its programme, and surface salinity (PSU). */
  cycle?: number;
  model?: string;
  project?: string;
  sal?: number | null;
}

export interface BuoyManifest {
  generated: string;
  source: string;
  from: string;
  to: string;
  counts: Partial<Record<BuoyType, number>>;
  buoys: Buoy[];
}

export type SeriesKey = 'sst' | 'atmp' | 'slp' | 'wspd' | 'wdir' | 'wvht' | 'lat' | 'lon';

export interface BuoyHistory {
  generated: string;
  /** Start of the first hourly bin, ISO. */
  from: string;
  stepMin: number;
  hours: number;
  /** Per buoy, per reading: one value per hour (the hour's last), null where none. */
  series: Record<string, Partial<Record<SeriesKey, (number | null)[]>>>;
  /** DART: minutes after `from`, and water-column height m. */
  dart: Record<string, { t: number[]; height: number[] }>;
}

/** An Argo float's newest profile: pressure (dbar, ≈ m deep), temperature °C and salinity PSU. */
export interface ArgoProfile {
  cycle: number;
  time: string;
  pres: number[];
  temp: (number | null)[];
  psal: (number | null)[];
}

export interface ArgoFile {
  generated: string;
  trackDays: number;
  profiles: Record<string, ArgoProfile>;
  /** Its surfacings over the last `trackDays`: unix seconds and positions, oldest first. */
  tracks: Record<string, { t: number[]; lat: number[]; lon: number[] }>;
}

export function isArgoFile(v: unknown): v is ArgoFile {
  const a = v as Partial<ArgoFile> | null;
  return !!a && typeof a.profiles === 'object' && typeof a.tracks === 'object' && typeof a.generated === 'string';
}

export function isBuoyManifest(v: unknown): v is BuoyManifest {
  const m = v as Partial<BuoyManifest> | null;
  return !!m && Array.isArray(m.buoys) && typeof m.from === 'string';
}

export function isBuoyHistory(v: unknown): v is BuoyHistory {
  const h = v as Partial<BuoyHistory> | null;
  return !!h && typeof h.series === 'object' && typeof h.from === 'string' && typeof h.stepMin === 'number';
}

export const TYPE_COLOR: Record<BuoyType, string> = {
  moored: '#7fd6ff',
  drifting: '#9bf0c4',
  tropical: '#ffd27f',
  ice: '#e8f3ff',
  dart: '#ff8fa3',
  argo: '#c9a6ff',
};

export const TYPE_LABEL: Record<BuoyType, string> = {
  moored: 'Moored buoy',
  drifting: 'Drifting buoy',
  tropical: 'Tropical mooring',
  ice: 'Ice buoy',
  dart: 'DART tsunami buoy',
  argo: 'Argo float',
};

/** "46026 · San Francisco" from NDBC's "SAN FRANCISCO - 18NM West of San Francisco, CA"; else the id. */
export function buoyTitle(b: Buoy): string {
  const place = b.name?.split(' - ')[0].trim();
  const nice = place ? place.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase()) : '';
  return nice ? `${b.id} · ${nice}` : `${TYPE_LABEL[b.type]} ${b.id}`;
}

/** The nearest of some screen points within `maxPx` of (x, y), by index; -1 if none. */
export function pickNearest(points: readonly { x: number; y: number }[], x: number, y: number, maxPx: number): number {
  let best = -1;
  let bestD = maxPx * maxPx;
  points.forEach((p, i) => {
    const d = (p.x - x) ** 2 + (p.y - y) ** 2;
    if (d <= bestD) [best, bestD] = [i, d];
  });
  return best;
}

/** The nearest buoy with something to say within `maxKm` of a place, and how far and which way. */
export function nearestBuoy(buoys: readonly Buoy[], lat: number, lon: number, maxKm: number): { buoy: Buoy; km: number; bearing: number } | undefined {
  let best: { buoy: Buoy; km: number; bearing: number } | undefined;
  for (const b of buoys) {
    // A DART has no weather; an Argo float's surface reading can be days old.
    if (b.type === 'dart' || b.type === 'argo') continue;
    const d = distanceKm(lat, lon, b.lat, b.lon);
    if (d.km <= maxKm && (!best || d.km < best.km)) best = { buoy: b, ...d };
  }
  return best;
}

/** The first and last non-null values of a series, with their indices. */
export function ends(values: readonly (number | null)[] | undefined): { first: number; last: number; i0: number; i1: number } | undefined {
  if (!values) return undefined;
  const i0 = values.findIndex((v) => v !== null);
  let i1 = values.length - 1;
  while (i1 >= 0 && values[i1] === null) i1--;
  if (i0 < 0 || i1 <= i0) return undefined;
  return { first: values[i0]!, last: values[i1]!, i0, i1 };
}

/** How far and which way a drifter went over its history: "23 km toward NE in 21 h". */
export function drift(series: BuoyHistory['series'][string] | undefined, stepMin = 60): string | undefined {
  const lat = ends(series?.lat);
  const lon = ends(series?.lon);
  if (!lat || !lon) return undefined;
  const d = distanceKm(lat.first, lon.first, lat.last, lon.last);
  const hours = Math.round(((Math.max(lat.i1, lon.i1) - Math.min(lat.i0, lon.i0)) * stepMin) / 60);
  if (d.km < 0.5) return `stayed put over ${hours} h`;
  return `drifted ${d.km < 10 ? d.km.toFixed(1) : Math.round(d.km)} km toward ${compass(d.bearing)} in ${hours} h`;
}

/** How far and which way a float went over its track: "drifted 140 km toward W in 28 d". */
export function argoDrift(track: ArgoFile['tracks'][string] | undefined): string | undefined {
  if (!track || track.t.length < 2) return undefined;
  const n = track.t.length - 1;
  const d = distanceKm(track.lat[0], track.lon[0], track.lat[n], track.lon[n]);
  const days = Math.round((track.t[n] - track.t[0]) / 86_400);
  return `drifted ${Math.round(d.km)} km toward ${compass(d.bearing)} in ${days} d`;
}

/** Pressure's change over the last 3 hours (the forecaster's tendency): "falling 2.1 hPa / 3 h". */
export function tendency(slp: readonly (number | null)[] | undefined): { hPa: number; word: string } | undefined {
  if (!slp) return undefined;
  let i1 = slp.length - 1;
  while (i1 >= 0 && slp[i1] === null) i1--;
  const i0 = i1 - 3;
  if (i1 < 0 || i0 < 0 || slp[i0] === null) return undefined;
  const hPa = slp[i1]! - slp[i0]!;
  return { hPa, word: Math.abs(hPa) < 0.5 ? 'steady' : hPa > 0 ? 'rising' : 'falling' };
}

// ---- wording, in the viewer's units -------------------------------------------------------

export const ms = (v: number, imperial: boolean) => speed(v * 3.6, imperial);
export const metres = (v: number, imperial: boolean) => (imperial ? `${(v * 3.28084).toFixed(1)} ft` : `${v.toFixed(1)} m`);
export const degC = (v: number, imperial: boolean) => (imperial ? temp(v, true) : `${v.toFixed(1)}°C`);

/** The place card's line: "Buoy 46026 (12 km SW): waves 2.3 m every 9 s · water 16.1°C · wind 29 km/h NW". */
export function buoyLine(b: Buoy, km: number, bearing: number, imperial: boolean): string {
  const parts = [
    b.wvht != null ? `waves ${metres(b.wvht, imperial)}${b.dpd ? ` every ${b.dpd} s` : ''}` : '',
    b.sst != null ? `water ${degC(b.sst, imperial)}` : '',
    b.wspd != null ? `wind ${ms(b.wspd, imperial)}${b.wdir != null ? ` ${compass(b.wdir)}` : ''}` : '',
  ].filter(Boolean);
  const dist = imperial ? `${Math.round(km / 1.609344)} mi` : `${Math.round(km)} km`;
  return `Buoy ${b.id} (${dist} ${compass(bearing)}): ${parts.join(' · ') || 'no recent readings'}`;
}

/** "1,921 reporting · 1,300 drifting · 489 moored · 43 DART · 4,352 Argo floats". */
export function buoySummary(m: BuoyManifest): string {
  const order: [BuoyType, string][] = [
    ['drifting', 'drifting'],
    ['moored', 'moored'],
    ['tropical', 'tropical'],
    ['ice', 'ice'],
    ['dart', 'DART'],
  ];
  const parts = order.filter(([k]) => m.counts[k]).map(([k, w]) => `${m.counts[k]!.toLocaleString('en-US')} ${w}`);
  // Floats surfaced some time in the last 30 days, so they aren't "reporting" in the same sense.
  const argo = m.counts.argo ?? 0;
  if (argo) parts.push(`${argo.toLocaleString('en-US')} Argo floats`);
  return [`${(m.buoys.length - argo).toLocaleString('en-US')} reporting`, ...parts].join(' · ');
}
