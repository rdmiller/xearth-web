// Keyboard controls. One table drives both the key handling and the help panel,
// so the two can't drift apart.

import { defaults, type ImageryMode, type IssLiveMode, type SatMode, type Settings, type StarMode } from './params';
import { FEATURED, featuredByKey } from './satellites';
import { ALL_LEAVES } from './satcategories';
import { wrapLon } from './vec';
import type { ViewMode } from './view';

export const MAG_MIN = 0.2;
/** As far as the URL allows: deep enough for NASA GIBS imagery at 244 m a pixel (gibs.ts). */
export const MAG_MAX = 50;
export const PERSPECTIVE_DIST = 3;
const PAN_STEP = 5;
const PAN_STEP_FAST = 15;
const ROT_STEP = 15;
const ZOOM_STEP = 1.25;

/** Clock multipliers stepped through with , and . (0 = paused). */
export const SPEEDS = [-3600, -600, -60, -10, -1, 0, 1, 10, 60, 600, 3600, 86400] as const;

export interface HotkeyContext {
  readonly settings: Settings;
  update(patch: Partial<Settings>): void;
  /** Where the viewer currently is, whatever the mode. */
  viewer(): { lat: number; lon: number };
  /** Change the clock rate, keeping the displayed moment continuous. */
  setSpeed(speed: number): void;
  /** Back to the present, in real time. */
  goLive(): void;
  /** Jump the clock to just before the next launch at 10×; returns its name, or null if none. */
  previewLaunch(): string | null;
  refreshClouds(): void;
  toggleFullscreen(): void;
  toggleHelp(open?: boolean): void;
  /** The satellite tree panel. */
  toggleSatTree(open?: boolean): void;
  /** Pin or unpin the layer dock along the bottom. */
  toggleDrawer(): void;
  /** The place search box. */
  openSearch(): void;
  toast(message: string): void;
}

export interface KeyLike {
  key: string;
  shiftKey?: boolean;
  ctrlKey?: boolean;
  metaKey?: boolean;
  altKey?: boolean;
  repeat?: boolean;
}

export type HotkeyGroup = 'Layers' | 'View' | 'Time' | 'App';

export interface Hotkey {
  /** KeyboardEvent.key values (letters lower-case). */
  keys: readonly string[];
  /** How the key is shown in the help panel. */
  label: string;
  description: string;
  group: HotkeyGroup;
  /** Act on auto-repeat while held (pan, zoom, rotate). */
  repeat?: boolean;
  run(ctx: HotkeyContext, e: KeyLike): void;
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

export const VIEW_LABELS: Record<ViewMode, string> = {
  fixed: 'Fixed position',
  sunrel: 'Facing the Sun',
  orbit: 'Orbit',
  moon: 'From the Moon',
  track: 'Tracking a satellite',
};
const VIEW_ORDER: readonly ViewMode[] = ['fixed', 'sunrel', 'orbit', 'moon', 'track'];

const NEXT_SATS: Record<SatMode, SatMode> = { all: 'featured', featured: 'off', off: 'all' };
export const SAT_LABELS: Record<SatMode, string> = {
  all: 'Satellites: Starlink + named',
  featured: `Satellites: ${FEATURED.map((f) => f.name).join(', ')}`,
  off: 'Satellites off',
};

/** Follow a featured satellite, turning the satellite layer back on if it was off. */
export function track(ctx: HotkeyContext, key: string) {
  const sat = featuredByKey(key);
  if (!sat) return;
  const satshow = ctx.settings.satshow.includes(key) ? ctx.settings.satshow : [...ctx.settings.satshow, key];
  ctx.update({ view: 'track', track: key, satshow, ...(ctx.settings.sats === 'off' ? { sats: 'featured' as const } : {}) });
  ctx.toast(`Tracking ${sat.name} — ${sat.detail}`);
}

type Layer = 'clouds' | 'lights' | 'grid' | 'markers' | 'label' | 'fps' | 'feeds' | 'bodies' | 'launches' | 'aurora' | 'storms' | 'fires' | 'quakes' | 'lightning' | 'events' | 'snow' | 'radar' | 'smoke' | 'tsunami' | 'severe' | 'relief';

const NEXT_STARS: Record<StarMode, StarMode> = { on: 'photo', photo: 'off', off: 'on' };
const NEXT_ISSLIVE: Record<IssLiveMode, IssLiveMode> = { track: 'on', on: 'off', off: 'track' };
export const ISSLIVE_LABELS: Record<IssLiveMode, string> = {
  track: 'ISS telemetry while tracking the ISS',
  on: 'ISS telemetry always',
  off: 'ISS telemetry off',
};
const NEXT_IMAGERY: Record<ImageryMode, ImageryMode> = { live: 'daily', daily: 'painted', painted: 'live' };
export const IMAGERY_LABELS: Record<ImageryMode, string> = {
  live: 'Imagery: live satellite pictures (GOES, MTG), last night’s lights zoomed in',
  daily: 'Imagery: yesterday’s VIIRS and last night’s lights when zoomed in',
  painted: 'Imagery off: Blue Marble and live clouds',
};
export const RAIN_LABELS = {
  both: 'Radar (RainViewer), and satellite rain where there’s none (NASA IMERG)',
  radar: 'Radar only (RainViewer)',
  off: 'Radar off',
};
export const STAR_LABELS: Record<StarMode, string> = {
  on: 'Stars on',
  photo: 'Stars: camera exposure',
  off: 'Stars off',
};

function layer(key: string, field: Layer, name: string): Hotkey {
  return {
    keys: [key],
    label: key.startsWith('shift+') ? `Shift+${key.slice(6).toUpperCase()}` : key.toUpperCase(),
    description: name,
    group: 'Layers',
    run(ctx) {
      const on = !ctx.settings[field];
      ctx.update({ [field]: on });
      ctx.toast(`${name} ${on ? 'on' : 'off'}`);
    },
  };
}

/** Switch view mode, starting each mode from a sensible place. */
export function setView(ctx: HotkeyContext, view: ViewMode, offset?: { lat: number; lon: number }) {
  if (view === 'fixed') {
    const here = ctx.viewer();
    ctx.update({ view, lat: here.lat, lon: here.lon });
  } else if (view === 'sunrel') {
    ctx.update({ view, lat: offset?.lat ?? 0, lon: offset?.lon ?? 0 });
  } else if (view === 'track') {
    track(ctx, ctx.settings.track);
    return;
  } else {
    ctx.update({ view });
  }
  ctx.toast(offset ? 'Dusk line' : VIEW_LABELS[view]);
}

/**
 * Move the viewpoint. Fixed and sun-relative views keep their mode (sunrel
 * shifts its offset from the Sun); orbit and Moon views drop to a fixed view
 * from wherever the viewer is now, as dragging does.
 */
export function pan(ctx: HotkeyContext, dLat: number, dLon: number) {
  const s = ctx.settings;
  if (s.view === 'fixed' || s.view === 'sunrel') {
    ctx.update({ lat: clamp(s.lat + dLat, -90, 90), lon: wrapLon(s.lon + dLon) });
  } else {
    const here = ctx.viewer();
    ctx.update({ view: 'fixed', lat: clamp(here.lat + dLat, -90, 90), lon: wrapLon(here.lon + dLon) });
  }
}

export function nextSpeed(current: number, dir: 1 | -1): number {
  if (dir > 0) return SPEEDS.find((s) => s > current) ?? SPEEDS[SPEEDS.length - 1];
  return [...SPEEDS].reverse().find((s) => s < current) ?? SPEEDS[0];
}

export function formatSpeed(speed: number): string {
  if (speed === 0) return 'Paused';
  if (speed === 1) return 'Real time';
  const a = Math.abs(speed);
  const rate =
    a >= 86400 ? `${a / 86400} day` : a >= 3600 ? `${a / 3600} h` : a >= 60 ? `${a / 60} min` : `${a} s`;
  return `${speed < 0 ? 'Backwards, ' : ''}${rate} per second`;
}

let pausedFrom = 1;

const panKey = (key: string, arrow: string, dLat: number, dLon: number): Hotkey => ({
  keys: [key],
  label: arrow,
  description: `Look ${dLat > 0 ? 'north' : dLat < 0 ? 'south' : dLon > 0 ? 'east' : 'west'} (Shift: faster)`,
  group: 'View',
  repeat: true,
  run(ctx, e) {
    const step = e.shiftKey ? PAN_STEP_FAST : PAN_STEP;
    pan(ctx, dLat * step, dLon * step);
  },
});

export const HOTKEYS: readonly Hotkey[] = [
  layer('c', 'clouds', 'Clouds'),
  {
    keys: ['s'],
    label: 'S',
    description: 'Stars: on → camera exposure → off',
    group: 'Layers',
    run(ctx) {
      const next = NEXT_STARS[ctx.settings.stars];
      ctx.update({ stars: next });
      ctx.toast(STAR_LABELS[next]);
    },
  },
  {
    keys: ['o'],
    label: 'O',
    description: 'Satellites: everything ticked → named only → off',
    group: 'Layers',
    run(ctx) {
      const next = NEXT_SATS[ctx.settings.sats];
      // Coming back on with nothing ticked in the tree would show nothing: tick everything.
      const reset = next !== 'off' && !ctx.settings.satshow.length ? { satshow: [...ALL_LEAVES] } : {};
      ctx.update({ sats: next, ...reset });
      ctx.toast(SAT_LABELS[next]);
    },
  },
  layer('n', 'lights', 'City lights'),
  layer('b', 'bodies', 'Sun and Moon'),
  layer('u', 'launches', 'Upcoming launches'),
  layer('a', 'aurora', 'Aurora'),
  layer('w', 'storms', 'Tropical cyclones'),
  layer('x', 'fires', 'Fires (24 h)'),
  layer('q', 'quakes', 'Earthquakes (24 h)'),
  layer('z', 'lightning', 'Lightning (GOES, MTG; 30 min)'),
  layer('y', 'events', 'Floods, wildfires, eruptions (GDACS)'),
  layer('i', 'snow', 'Snow and ice (today)'),
  {
    keys: ['shift+r'],
    label: 'Shift+R',
    description: 'Rain: radar with satellite rain where there’s none → radar only → off',
    group: 'Layers',
    run(ctx) {
      const { radar, imerg } = ctx.settings;
      const next = !radar ? { radar: true, imerg: true } : imerg ? { radar: true, imerg: false } : { radar: false, imerg };
      ctx.update(next);
      ctx.toast(RAIN_LABELS[!next.radar ? 'off' : next.imerg ? 'both' : 'radar']);
    },
  },
  layer('shift+s', 'smoke', 'Smoke plumes (NOAA HMS)'),
  layer('shift+t', 'tsunami', 'Tsunami alerts (NOAA)'),
  layer('shift+w', 'severe', 'Severe weather warnings and outlook (US: NWS, SPC)'),
  {
    keys: ['shift+p'],
    label: 'Shift+P',
    description: 'Imagery: live (GOES, MTG) → yesterday’s when zoomed in (VIIRS) → off; either shows the newest night’s lights zoomed in',
    group: 'Layers',
    run(ctx) {
      const next = NEXT_IMAGERY[ctx.settings.imagery];
      ctx.update({ imagery: next });
      ctx.toast(IMAGERY_LABELS[next]);
    },
  },
  layer('shift+e', 'relief', 'Terrain lit by the Sun (ETOPO 2022)'),
  {
    keys: ['shift+o'],
    label: 'Shift+O',
    description: 'Satellite categories panel',
    group: 'Layers',
    run: (ctx) => ctx.toggleSatTree(),
  },
  {
    keys: ['shift+l'],
    label: 'Shift+L',
    description: 'ISS live telemetry: while tracking the ISS → always → off',
    group: 'Layers',
    run(ctx) {
      const next = NEXT_ISSLIVE[ctx.settings.isslive];
      ctx.update({ isslive: next });
      ctx.toast(ISSLIVE_LABELS[next]);
    },
  },
  layer('g', 'grid', 'Grid'),
  layer('m', 'markers', 'City markers'),
  layer('l', 'label', 'Label'),

  { keys: ['/'], label: '/', description: 'Go to a place (or double-click the globe)', group: 'View', run: (ctx) => ctx.openSearch() },
  { keys: ['1'], label: '1', description: VIEW_LABELS.fixed, group: 'View', run: (ctx) => setView(ctx, 'fixed') },
  { keys: ['2'], label: '2', description: `${VIEW_LABELS.sunrel} (full day side)`, group: 'View', run: (ctx) => setView(ctx, 'sunrel') },
  { keys: ['3'], label: '3', description: VIEW_LABELS.orbit, group: 'View', run: (ctx) => setView(ctx, 'orbit') },
  { keys: ['4'], label: '4', description: VIEW_LABELS.moon, group: 'View', run: (ctx) => setView(ctx, 'moon') },
  {
    keys: ['5'],
    label: '5',
    description: 'Dusk line (Sun 90° to the west)',
    group: 'View',
    run: (ctx) => setView(ctx, 'sunrel', { lat: 0, lon: 90 }),
  },
  ...FEATURED.map(
    (sat, i): Hotkey => ({
      keys: [String(6 + i)],
      label: String(6 + i),
      description: `Track ${sat.name}${sat.key === 'satgus' ? ' (Mark Rober)' : ''}`,
      group: 'View',
      run: (ctx) => track(ctx, sat.key),
    }),
  ),
  {
    keys: ['e'],
    label: 'E',
    description: 'Frame the Sun, then the Moon, just beside the Earth',
    group: 'View',
    run(ctx) {
      const next = ctx.settings.view === 'track' && ctx.settings.track === 'sunrise' ? 'moonrise' : 'sunrise';
      ctx.update({ view: 'track', track: next, ...(ctx.settings.bodies ? {} : { bodies: true }) });
      ctx.toast(next === 'sunrise' ? 'Sun just past the Earth' : 'Moon beside the Earth');
    },
  },
  {
    keys: ['j'],
    label: 'J',
    description: 'Follow the next launch (or the one in flight)',
    group: 'View',
    run(ctx) {
      ctx.update({ view: 'track', track: 'launch', ...(ctx.settings.launches ? {} : { launches: true }) });
      ctx.toast('Following the next launch');
    },
  },
  {
    keys: ['v'],
    label: 'V',
    description: 'Next view mode',
    group: 'View',
    run(ctx) {
      const next = VIEW_ORDER[(VIEW_ORDER.indexOf(ctx.settings.view) + 1) % VIEW_ORDER.length];
      setView(ctx, next);
    },
  },
  {
    keys: ['home'],
    label: 'Home',
    description: 'Back over your time zone',
    group: 'View',
    run(ctx) {
      const d = defaults();
      ctx.update({ view: 'fixed', lat: d.lat, lon: d.lon, rot: 0 });
      ctx.toast('Home');
    },
  },
  panKey('arrowup', '↑', 1, 0),
  panKey('arrowdown', '↓', -1, 0),
  panKey('arrowleft', '←', 0, -1),
  panKey('arrowright', '→', 0, 1),
  {
    keys: ['+', '='],
    label: '+',
    description: 'Zoom in',
    group: 'View',
    repeat: true,
    run: (ctx) => ctx.update({ mag: clamp(ctx.settings.mag * ZOOM_STEP, MAG_MIN, MAG_MAX) }),
  },
  {
    keys: ['-', '_'],
    label: '−',
    description: 'Zoom out',
    group: 'View',
    repeat: true,
    run: (ctx) => ctx.update({ mag: clamp(ctx.settings.mag / ZOOM_STEP, MAG_MIN, MAG_MAX) }),
  },
  {
    keys: ['['],
    label: '[',
    description: 'Rotate counter-clockwise',
    group: 'View',
    repeat: true,
    run: (ctx) => ctx.update({ rot: (ctx.settings.rot + ROT_STEP) % 360 }),
  },
  {
    keys: [']'],
    label: ']',
    description: 'Rotate clockwise',
    group: 'View',
    repeat: true,
    run: (ctx) => ctx.update({ rot: (ctx.settings.rot - ROT_STEP) % 360 }),
  },
  {
    keys: ['0'],
    label: '0',
    description: 'Reset zoom and rotation',
    group: 'View',
    run(ctx) {
      ctx.update({ mag: 1, rot: 0 });
      ctx.toast('Zoom and rotation reset');
    },
  },
  {
    keys: ['p'],
    label: 'P',
    description: 'Perspective / orthographic',
    group: 'View',
    run(ctx) {
      const dist = ctx.settings.dist ? 0 : PERSPECTIVE_DIST;
      ctx.update({ dist });
      ctx.toast(dist ? `Perspective from ${dist} Earth radii` : 'Orthographic');
    },
  },

  {
    keys: [' '],
    label: 'Space',
    description: 'Pause / resume the clock',
    group: 'Time',
    run(ctx) {
      const s = ctx.settings.speed;
      if (s === 0) {
        ctx.setSpeed(pausedFrom);
        ctx.toast(formatSpeed(pausedFrom));
      } else {
        pausedFrom = s;
        ctx.setSpeed(0);
        ctx.toast('Paused');
      }
    },
  },
  {
    keys: ['.', '>'],
    label: '.',
    description: 'Faster',
    group: 'Time',
    run(ctx) {
      const s = nextSpeed(ctx.settings.speed, 1);
      ctx.setSpeed(s);
      ctx.toast(formatSpeed(s));
    },
  },
  {
    keys: [',', '<'],
    label: ',',
    description: 'Slower (then backwards)',
    group: 'Time',
    run(ctx) {
      const s = nextSpeed(ctx.settings.speed, -1);
      ctx.setSpeed(s);
      ctx.toast(formatSpeed(s));
    },
  },
  {
    keys: ['k'],
    label: 'K',
    description: 'Preview the next launch from T−1 min at 10×',
    group: 'Time',
    run(ctx) {
      const name = ctx.previewLaunch();
      ctx.toast(name ? `Preview: ${name} (T to return to now)` : 'No upcoming launch to preview');
    },
  },
  {
    keys: ['t'],
    label: 'T',
    description: 'Back to now, real time',
    group: 'Time',
    run(ctx) {
      ctx.goLive();
      ctx.toast('Now');
    },
  },

  {
    keys: ['r'],
    label: 'R',
    description: 'Check for new clouds now',
    group: 'App',
    run(ctx) {
      ctx.refreshClouds();
      ctx.toast('Checking for new clouds…');
    },
  },
  { keys: ['shift+d'], label: 'Shift+D', description: 'Pin the layer buttons', group: 'App', run: (ctx) => ctx.toggleDrawer() },
  { keys: ['f'], label: 'F', description: 'Fullscreen', group: 'App', run: (ctx) => ctx.toggleFullscreen() },
  { ...layer('d', 'fps', 'Frame-rate display'), group: 'App' },
  { ...layer('shift+u', 'feeds', 'Data feeds: last update and next check'), group: 'App' },
  { keys: ['h', '?'], label: 'H', description: 'This help', group: 'App', run: (ctx) => ctx.toggleHelp() },
  {
    keys: ['escape'],
    label: 'Esc',
    description: 'Close help, the satellite panel and the feeds dashboard',
    group: 'App',
    run: (ctx) => {
      ctx.toggleHelp(false);
      ctx.toggleSatTree(false);
      if (ctx.settings.feeds) ctx.update({ feeds: false });
    },
  },
];

const BY_KEY = new Map<string, Hotkey>();
for (const hk of HOTKEYS) for (const k of hk.keys) BY_KEY.set(k, hk);

/** The hotkey bound to a key name as written in HOTKEYS ("c", "shift+r"). */
export function hotkeyByKey(key: string): Hotkey | undefined {
  return BY_KEY.get(key);
}

/**
 * The hotkey for a key event, or undefined (Ctrl/Cmd/Alt chords are left to the
 * browser). Shift picks a "shift+" binding when there is one, else the plain key.
 */
export function matchHotkey(e: KeyLike): Hotkey | undefined {
  if (e.ctrlKey || e.metaKey || e.altKey) return undefined;
  const key = e.key.toLowerCase();
  const hk = (e.shiftKey ? BY_KEY.get(`shift+${key}`) : undefined) ?? BY_KEY.get(key);
  if (!hk || (e.repeat && !hk.repeat)) return undefined;
  return hk;
}

export function helpRows(): { group: HotkeyGroup; rows: { label: string; description: string }[] }[] {
  const groups: HotkeyGroup[] = ['Layers', 'View', 'Time', 'App'];
  return groups.map((group) => ({
    group,
    rows: HOTKEYS.filter((h) => h.group === group).map(({ label, description }) => ({ label, description })),
  }));
}
