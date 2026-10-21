// How often to redraw: as rarely as possible, as often as on-screen motion needs.

/** Speeds across the screen, in Earth radii per (simulated) second. */
export const LEO_RATE = 7.8 / 6378.137; // a low-orbit satellite
export const SURFACE_RATE = 0.465 / 6378.137; // the equator, turning
/** Redraw often enough that nothing moves more than this between frames. */
export const MAX_STEP_PX = 0.5;
/** Below this interval, just render every display frame. */
export const CONTINUOUS_BELOW_S = 1 / 40;

export interface CadenceInput {
  /** Something is animating regardless of the clock (drag, cloud fade). */
  animating: boolean;
  /** Anything moving at low-orbit speed is on screen (satellites, orbit/track views). */
  leo: boolean;
  /** Clock multiplier (0 = paused). */
  speed: number;
  /** Disc radius in CSS px. */
  radiusPx: number;
  /** Upper bound between redraws, s (xearth's -wait). */
  wait: number;
}

/** Seconds until the next redraw is due; 0 means every display frame. */
export function redrawInterval(c: CadenceInput): number {
  if (c.animating) return 0;
  const pxPerSec = (c.leo ? LEO_RATE : SURFACE_RATE) * Math.abs(c.speed) * c.radiusPx;
  if (pxPerSec === 0) return c.wait;
  const s = Math.min(c.wait, MAX_STEP_PX / pxPerSec);
  return s < CONTINUOUS_BELOW_S ? 0 : s;
}

export function describeCadence(interval: number): string {
  if (interval === 0) return 'continuous';
  return `on demand · every ${interval >= 1 ? `${interval.toFixed(1)} s` : `${Math.round(interval * 1000)} ms`}`;
}
