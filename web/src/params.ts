// Settings ⇄ URL query string. Every setting is shareable as a link, the way
// xearth's behaviour was set entirely by command-line flags.

import { ALL_LEAVES, DEFAULT_LABELS } from './satcategories';
import type { ViewMode, ViewSettings } from './view';

/** `photo` dims the stars the way a camera exposed for sunlit Earth would. */
export type StarMode = 'on' | 'off' | 'photo';

/** `featured` = only the named satellites (ISS, Tiangong, SAT GUS); `all` adds Starlink. */
export type SatMode = 'all' | 'featured' | 'off';

/** NASA ISS telemetry panel: while tracking the ISS, always, or off (no connection). */
export type IssLiveMode = 'track' | 'on' | 'off';

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
  /** Satellite categories ticked in the satellite tree (leaf keys). */
  satshow: string[];
  /** Categories whose satellites carry name labels. */
  satlabels: string[];
  label: boolean;
  /** Frame-rate display. */
  fps: boolean;
  /** Sun and Moon in the sky. */
  bodies: boolean;
  /** Launch mode: pads, countdowns, ascents. */
  launches: boolean;
  /** Live hazard layers. */
  aurora: boolean;
  storms: boolean;
  fires: boolean;
  /** Show fires detected within this many hours (1–24). */
  firehours: number;
  quakes: boolean;
  /** Lightning (GOES GLM, last 30 min). */
  lightning: boolean;
  /** GDACS floods, wildfires and eruptions. */
  events: boolean;
  /** Today's snow cover and sea ice. */
  snow: boolean;
  /** RainViewer weather radar. */
  radar: boolean;
  /** NOAA tsunami bulletins and NWS tsunami alerts. */
  tsunami: boolean;
  /** NASA GIBS true-colour imagery when zoomed in. */
  truecolor: boolean;
  /** Terrain lit by the real Sun (ETOPO 2022 slopes); off shows NASA's fixed shaded relief. */
  relief: boolean;
  /** Relief strength: 1 = the default vertical exaggeration. */
  reliefscale: number;
  /** NASA ISS live telemetry. */
  isslive: IssLiveMode;
  /** NOAA HMS smoke plumes. */
  smoke: boolean;
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
  /** Where the pipeline's storm, fire, lightning, GDACS event, snow/ice, smoke and tsunami files live. */
  stormsrc: string;
  firesrc: string;
  lightningsrc: string;
  eventsrc: string;
  snowsrc: string;
  smokesrc: string;
  tsunamisrc: string;
}

const VIEWS: readonly ViewMode[] = ['fixed', 'sunrel', 'orbit', 'moon', 'track'];

/** A sensible starting longitude: the middle of the viewer's own time zone. */
export function timezoneLongitude(offsetMinutes = new Date().getTimezoneOffset()): number {
  return Math.max(-180, Math.min(180, -offsetMinutes / 4)) || 0; // no -0 for UTC
}

/**
 * Where a layer's files live: its own VITE_*_BASE if set, else VITE_DATA_BASE + folder (the
 * Android build sets that to the hosted server, since the app bundle has no pipeline beside
 * it), else the folder beside the page.
 */
export const DATA_BASE = (import.meta.env?.VITE_DATA_BASE as string | undefined) ?? '';
function dataSrc(env: string, folder: string): string {
  return (import.meta.env?.[env] as string | undefined) ?? `${DATA_BASE}${folder}`;
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
    satshow: [...ALL_LEAVES],
    satlabels: [...DEFAULT_LABELS],
    label: true,
    fps: false,
    bodies: true,
    launches: true,
    aurora: true,
    storms: true,
    fires: true,
    firehours: 12,
    quakes: true,
    lightning: true,
    events: true,
    snow: true,
    radar: true,
    smoke: true,
    tsunami: true,
    truecolor: true,
    relief: true,
    reliefscale: 1,
    isslive: 'track',
    bodyscale: 1,
    time: null,
    speed: 1,
    cloudsrc: dataSrc('VITE_CLOUD_BASE', 'clouds/'),
    satsrc: dataSrc('VITE_SAT_BASE', 'satellites/'),
    launchsrc: dataSrc('VITE_LAUNCH_BASE', 'launches/'),
    stormsrc: dataSrc('VITE_STORM_BASE', 'storms/'),
    firesrc: dataSrc('VITE_FIRE_BASE', 'fires/'),
    lightningsrc: dataSrc('VITE_LIGHTNING_BASE', 'lightning/'),
    eventsrc: dataSrc('VITE_EVENT_BASE', 'events/'),
    snowsrc: dataSrc('VITE_SNOW_BASE', 'snowice/'),
    smokesrc: dataSrc('VITE_SMOKE_BASE', 'smoke/'),
    tsunamisrc: dataSrc('VITE_TSUNAMI_BASE', 'tsunami/'),
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

function issLiveMode(q: URLSearchParams, fallback: IssLiveMode): IssLiveMode {
  const raw = q.get('isslive')?.toLowerCase();
  if (raw === undefined) return fallback;
  if (raw === 'track') return 'track';
  return FALSY.includes(raw) ? 'off' : 'on';
}

/** A comma list of satellite category keys; unknown keys are dropped, `none` is empty. */
function keyList(q: URLSearchParams, key: string, fallback: string[]): string[] {
  const raw = q.get(key);
  if (raw === null) return fallback;
  const wanted = new Set(raw.toLowerCase().split(',').map((k) => k.trim()));
  return ALL_LEAVES.filter((k) => wanted.has(k));
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
    satshow: keyList(q, 'satshow', base.satshow),
    satlabels: keyList(q, 'satlabels', base.satlabels),
    label: bool(q, 'label', base.label),
    fps: bool(q, 'fps', base.fps),
    bodies: bool(q, 'bodies', base.bodies),
    launches: bool(q, 'launches', base.launches),
    aurora: bool(q, 'aurora', base.aurora),
    storms: bool(q, 'storms', base.storms),
    fires: bool(q, 'fires', base.fires),
    firehours: num(q, 'firehours', base.firehours, 1, 24),
    quakes: bool(q, 'quakes', base.quakes),
    lightning: bool(q, 'lightning', base.lightning),
    events: bool(q, 'events', base.events),
    snow: bool(q, 'snow', base.snow),
    radar: bool(q, 'radar', base.radar),
    smoke: bool(q, 'smoke', base.smoke),
    tsunami: bool(q, 'tsunami', base.tsunami),
    truecolor: bool(q, 'truecolor', base.truecolor),
    relief: bool(q, 'relief', base.relief),
    reliefscale: num(q, 'reliefscale', base.reliefscale, 0.1, 5),
    isslive: issLiveMode(q, base.isslive),
    bodyscale: num(q, 'bodyscale', base.bodyscale, 1, 30),
    time: time && !Number.isNaN(time.getTime()) ? time : base.time,
    speed: num(q, 'speed', base.speed, -1e6, 1e6),
    cloudsrc: q.get('cloudsrc') ?? base.cloudsrc,
    satsrc: q.get('satsrc') ?? base.satsrc,
    launchsrc: q.get('launchsrc') ?? base.launchsrc,
    stormsrc: q.get('stormsrc') ?? base.stormsrc,
    firesrc: q.get('firesrc') ?? base.firesrc,
    lightningsrc: q.get('lightningsrc') ?? base.lightningsrc,
    eventsrc: q.get('eventsrc') ?? base.eventsrc,
    snowsrc: q.get('snowsrc') ?? base.snowsrc,
    smokesrc: q.get('smokesrc') ?? base.smokesrc,
    tsunamisrc: q.get('tsunamisrc') ?? base.tsunamisrc,
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
    if (Array.isArray(v)) {
      if (v.join(',') !== (d as string[]).join(',')) q.set(key, v.length ? v.join(',') : 'none');
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
