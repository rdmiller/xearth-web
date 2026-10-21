// Settings ⇄ URL query string. Every setting is shareable as a link, the way
// xearth's behaviour was set entirely by command-line flags.

import type { ViewMode, ViewSettings } from './view';

/** `photo` dims the stars the way a camera exposed for sunlit Earth would. */
export type StarMode = 'on' | 'off' | 'photo';

/** `featured` = only the named satellites (ISS, Tiangong, SAT GUS); `all` adds Starlink. */
export type SatMode = 'all' | 'featured' | 'off';

export interface Settings extends ViewSettings {
  /** Disc diameter as a fraction of 90% of the window's shorter side. */
  mag: number;
  /** Seconds between redraws in real time (xearth -wait). */
  wait: number;
  clouds: boolean;
  lights: boolean;
  grid: boolean;
  markers: boolean;
  stars: StarMode;
  sats: SatMode;
  label: boolean;
  /** Frame-rate display. */
  fps: boolean;
  /** Sun and Moon in the sky. */
  bodies: boolean;
  /** Launch mode: pads, countdowns, ascents. */
  launches: boolean;
  /** Enlarge the Sun and Moon discs (1 = true angular size, ~0.5°). */
  bodyscale: number;
  /** Fixed start time (ISO), or null for "now". */
  time: Date | null;
  /** Clock multiplier; 1 = real time. */
  speed: number;
  /** Where latest.json lives, relative to the page unless absolute. */
  cloudsrc: string;
  /** Where the satellites' latest.json lives. */
  satsrc: string;
  /** Where the launches' latest.json lives. */
  launchsrc: string;
}

const VIEWS: readonly ViewMode[] = ['fixed', 'sunrel', 'orbit', 'moon', 'track'];

/** A sensible starting longitude: the middle of the viewer's own time zone. */
export function timezoneLongitude(offsetMinutes = new Date().getTimezoneOffset()): number {
  return Math.max(-180, Math.min(180, -offsetMinutes / 4)) || 0; // no -0 for UTC
}

export function defaults(): Settings {
  return {
    view: 'fixed',
    track: 'iss',
    lat: 20,
    lon: timezoneLongitude(),
    period: 1.5,
    inc: 51.6,
    rot: 0,
    dist: 0,
    mag: 1,
    wait: 60,
    clouds: true,
    lights: true,
    grid: false,
    markers: true,
    stars: 'on',
    sats: 'all',
    label: true,
    fps: false,
    bodies: true,
    launches: true,
    bodyscale: 1,
    time: null,
    speed: 1,
    cloudsrc: (import.meta.env?.VITE_CLOUD_BASE as string | undefined) ?? 'clouds/',
    satsrc: (import.meta.env?.VITE_SAT_BASE as string | undefined) ?? 'satellites/',
    launchsrc: (import.meta.env?.VITE_LAUNCH_BASE as string | undefined) ?? 'launches/',
  };
}

function num(q: URLSearchParams, key: string, fallback: number, min = -Infinity, max = Infinity): number {
  const raw = q.get(key);
  if (raw === null || raw.trim() === '') return fallback;
  const v = Number(raw);
  return Number.isFinite(v) ? Math.max(min, Math.min(max, v)) : fallback;
}

const FALSY = ['0', 'false', 'off', 'no'];

function bool(q: URLSearchParams, key: string, fallback: boolean): boolean {
  const raw = q.get(key);
  if (raw === null) return fallback;
  return !FALSY.includes(raw.toLowerCase());
}

function starMode(q: URLSearchParams, fallback: StarMode): StarMode {
  const raw = q.get('stars')?.toLowerCase();
  if (raw === undefined) return fallback;
  if (raw === 'photo') return 'photo';
  return FALSY.includes(raw) ? 'off' : 'on';
}

function satMode(q: URLSearchParams, fallback: SatMode): SatMode {
  const raw = q.get('sats')?.toLowerCase();
  if (raw === undefined) return fallback;
  if (raw === 'featured' || raw === 'named') return 'featured';
  return FALSY.includes(raw) ? 'off' : 'all';
}

export function parseSettings(search: string, base: Settings = defaults()): Settings {
  const q = new URLSearchParams(search);
  const view = q.get('view') as ViewMode | null;
  const timeRaw = q.get('time');
  const time = timeRaw ? new Date(timeRaw) : null;
  return {
    view: view && VIEWS.includes(view) ? view : base.view,
    track: q.get('track')?.toLowerCase() || base.track,
    lat: num(q, 'lat', base.lat, -90, 90),
    lon: num(q, 'lon', base.lon, -360, 360),
    period: num(q, 'period', base.period, 0.01),
    inc: num(q, 'inc', base.inc, -180, 180),
    rot: num(q, 'rot', base.rot),
    dist: num(q, 'dist', base.dist, 0),
    mag: num(q, 'mag', base.mag, 0.05, 50),
    wait: num(q, 'wait', base.wait, 1),
    clouds: bool(q, 'clouds', base.clouds),
    lights: bool(q, 'lights', base.lights),
    grid: bool(q, 'grid', base.grid),
    markers: bool(q, 'markers', base.markers),
    stars: starMode(q, base.stars),
    sats: satMode(q, base.sats),
    label: bool(q, 'label', base.label),
    fps: bool(q, 'fps', base.fps),
    bodies: bool(q, 'bodies', base.bodies),
    launches: bool(q, 'launches', base.launches),
    bodyscale: num(q, 'bodyscale', base.bodyscale, 1, 30),
    time: time && !Number.isNaN(time.getTime()) ? time : base.time,
    speed: num(q, 'speed', base.speed, -1e6, 1e6),
    cloudsrc: q.get('cloudsrc') ?? base.cloudsrc,
    satsrc: q.get('satsrc') ?? base.satsrc,
    launchsrc: q.get('launchsrc') ?? base.launchsrc,
  };
}

/** Query string holding only what differs from the defaults. */
export function toQuery(s: Settings, base: Settings = defaults()): string {
  const q = new URLSearchParams();
  for (const key of Object.keys(s) as (keyof Settings)[]) {
    const v = s[key];
    const d = base[key];
    if (key === 'time') {
      if (v instanceof Date) q.set('time', v.toISOString());
      continue;
    }
    if (v === d) continue;
    if (typeof v === 'boolean') q.set(key, v ? '1' : '0');
    else if (typeof v === 'number') q.set(key, String(Math.round(v * 1000) / 1000));
    else q.set(key, String(v));
  }
  const str = q.toString();
  return str ? `?${str}` : '';
}
