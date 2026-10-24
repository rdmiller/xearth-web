// Moments worth jumping to from the time picker, each the next one after the moment shown
// (so pressing again goes on to the one after): sunrise and sunset at the view's centre, the
// next equinox or solstice, the next full and new moon. All from astronomy-engine.
//
// No eclipses: the globe isn't drawn with the Moon's shadow on it, nor the Moon with the
// Earth's, so one would look like any other day.

import { Body, Observer, SearchMoonPhase, SearchRiseSet, Seasons } from 'astronomy-engine';

/** The picker's range: the stars' precession and the month's textures are tuned for the present. */
export const MIN_YEAR = 1900;
export const MAX_YEAR = 2100;

export const inRange = (d: Date) => d.getUTCFullYear() >= MIN_YEAR && d.getUTCFullYear() <= MAX_YEAR;

export interface Moment {
  date: Date;
  /** "Sunrise", "December solstice", "Full moon". */
  name: string;
}

/** Searching from a minute on, so a moment already on screen isn't found again. */
const PAST_MS = 60_000;
const after = (d: Date) => new Date(d.getTime() + PAST_MS);

/** The next sunrise (`rise`) or sunset at a place, within two days (none near the poles some seasons). */
export function nextSun(from: Date, lat: number, lon: number, rise: boolean): Moment | null {
  const t = SearchRiseSet(Body.Sun, new Observer(lat, lon, 0), rise ? +1 : -1, after(from), 2);
  return t && { date: t.date, name: rise ? 'Sunrise' : 'Sunset' };
}

/** The next equinox or solstice. */
export function nextSeason(from: Date): Moment {
  const start = after(from);
  for (let year = start.getUTCFullYear(); ; year++) {
    const s = Seasons(year);
    const all: [Date, string][] = [
      [s.mar_equinox.date, 'March equinox'],
      [s.jun_solstice.date, 'June solstice'],
      [s.sep_equinox.date, 'September equinox'],
      [s.dec_solstice.date, 'December solstice'],
    ];
    const next = all.find(([d]) => d > start);
    if (next) return { date: next[0], name: next[1] };
  }
}

/** The next full moon (`full`) or new moon. */
export function nextMoon(from: Date, full: boolean): Moment {
  // A lunation is ~29.5 days: one is always found within 30.
  const t = SearchMoonPhase(full ? 180 : 0, after(from), 30)!;
  return { date: t.date, name: full ? 'Full moon' : 'New moon' };
}

/** The picker's date and time inputs ("2026-10-24", "14:32:07") for a moment, in UTC or local time. */
export function toInputs(d: Date, zone: 'utc' | 'local'): { date: string; time: string } {
  const p2 = (n: number) => String(n).padStart(2, '0');
  if (zone === 'utc') {
    const iso = d.toISOString();
    return { date: iso.slice(0, 10), time: iso.slice(11, 19) };
  }
  return {
    date: `${String(d.getFullYear()).padStart(4, '0')}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`,
    time: `${p2(d.getHours())}:${p2(d.getMinutes())}:${p2(d.getSeconds())}`,
  };
}

/**
 * The moment the inputs say, or null if they don't say one in range. The time may lack seconds
 * (iOS's wheel has none) or be empty (midnight).
 */
export function fromInputs(date: string, time: string, zone: 'utc' | 'local'): Date | null {
  const dm = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  const tm = /^(\d{2}):(\d{2})(?::(\d{2}))?/.exec(time || '00:00');
  if (!dm || !tm) return null;
  const [y, mo, d] = [Number(dm[1]), Number(dm[2]), Number(dm[3])];
  const [h, mi, s] = [Number(tm[1]), Number(tm[2]), Number(tm[3] ?? 0)];
  const out = zone === 'utc' ? new Date(Date.UTC(y, mo - 1, d, h, mi, s)) : new Date(y, mo - 1, d, h, mi, s);
  // No 31 February: the parts must survive the round trip.
  const back = toInputs(out, zone);
  if (Number.isNaN(out.getTime()) || back.date !== date || !inRange(out)) return null;
  return out;
}
