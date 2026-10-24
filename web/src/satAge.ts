// How far the clock is from a satellite's orbital elements, which say where it was at their
// epoch. SGP4 carries them forward (or back) well for days, but drag and manoeuvres add up:
// weeks out, a low satellite can be anywhere along its orbit. So with the clock far from the
// elements, the dense constellations go (a point cloud in the wrong places is worse than
// none), and the named satellites are marked approximate, then go too.

const DAY_MS = 86_400_000;

/** Within this of their elements, satellites are placed as usual. */
export const APPROX_AFTER_DAYS = 30;
/** Past this, named satellites go too. */
export const GONE_AFTER_DAYS = 365;

/** `ok`: as usual; `approx`: named ones marked approximate, the constellations hidden; `gone`. */
export type ElementsAge = 'ok' | 'approx' | 'gone';

/** How far the moment `atMs` is from elements dated `epochMs`, either way. */
export function elementsAge(atMs: number, epochMs: number): ElementsAge {
  const days = Math.abs(atMs - epochMs) / DAY_MS;
  return days <= APPROX_AFTER_DAYS ? 'ok' : days <= GONE_AFTER_DAYS ? 'approx' : 'gone';
}

/** An element set's epoch, ms ([norad, epoch (Unix s), …], see satellites.ts). */
export const epochMs = (elements: readonly number[]) => elements[1] * 1000;

/** The readout's note when the constellations are hidden: "constellations hidden: orbits from 24 Oct 2026". */
export function hiddenNote(catalogMs: number): string {
  const day = new Date(catalogMs).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
  return `constellations hidden: orbits from ${day}`;
}
