// Hazard layers fade out as the clock moves away from now. Their data is a snapshot of the
// present, so last night's quakes don't belong over a Tuesday three weeks ago; the Sun, Moon,
// stars, satellites and launches are what follow the clock. Fading is a view of the clock,
// not a setting: the layer stays on, and comes back as the clock returns.

import { LIVE_MAX_SKEW_MS } from './liveImagery';

/** `live`: minutes to hours old. `daily`: a day's product. */
export type FadeTier = 'live' | 'daily';

const HOUR_MS = 3_600_000;

/** Fully shown within `full` of now, gone by `gone`, either way. */
const TIERS: Record<FadeTier, { full: number; gone: number }> = {
  // The same half hour after which live imagery gives way to the painted globe.
  live: { full: LIVE_MAX_SKEW_MS, gone: 2 * HOUR_MS },
  daily: { full: 12 * HOUR_MS, gone: 36 * HOUR_MS },
};

/** Every layer that fades, and how fast. Clouds, winds and buoys aren't hazards: they stay. */
export const FADE_TIER = {
  aurora: 'live',
  iono: 'live',
  lightning: 'live',
  radar: 'live',
  quakes: 'live',
  fires: 'live',
  storms: 'live',
  severe: 'live',
  tsunami: 'live',
  /** GDACS's events and USGS's US volcano alerts. */
  events: 'live',
  smoke: 'live',
  ash: 'live',
  meteors: 'live',
  snow: 'daily',
  sst: 'daily',
  /** NASA's daily flood map (shown with the events). */
  floods: 'daily',
} as const satisfies Record<string, FadeTier>;

export type FadedLayer = keyof typeof FADE_TIER;
export type Fades = Record<FadedLayer, number>;

/** Below this a layer's labels give up their space; its symbols are too faint to name. */
export const LABEL_MIN_FADE = 0.3;
/** Below this a layer's alerts wait for the clock to come back before they're announced. */
export const ANNOUNCE_MIN_FADE = 0.5;

/** 1 (shown) to 0 (gone), easing out as the clock moves `offsetMs` from now. */
export function hazardFade(offsetMs: number, tier: FadeTier): number {
  const { full, gone } = TIERS[tier];
  const t = Math.min(1, Math.max(0, (Math.abs(offsetMs) - full) / (gone - full)));
  return 1 - t * t * (3 - 2 * t);
}

/** Every layer's fade at once, for a frame. */
export function fadesAt(offsetMs: number): Fades {
  const live = hazardFade(offsetMs, 'live');
  const daily = hazardFade(offsetMs, 'daily');
  const out = {} as Fades;
  for (const k of Object.keys(FADE_TIER) as FadedLayer[]) out[k] = FADE_TIER[k] === 'live' ? live : daily;
  return out;
}

/** Whether any layer the viewer has on is faded at all (for the readout's note). */
export function anyFaded(f: Fades, on: (k: FadedLayer) => boolean): boolean {
  return (Object.keys(f) as FadedLayer[]).some((k) => on(k) && f[k] < 1);
}
