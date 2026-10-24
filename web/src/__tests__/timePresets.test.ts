import { describe, expect, it } from 'vitest';
import { fromInputs, inRange, nextMoon, nextSeason, nextSun, toInputs } from '../timePresets';

const MIN = 60_000;
/** Within `mins` minutes of an almanac time. */
const near = (d: Date | undefined, iso: string, mins: number) => expect(Math.abs((d?.getTime() ?? NaN) - Date.parse(iso))).toBeLessThan(mins * MIN);

describe('time presets', () => {
  it('finds the next equinox or solstice (USNO: 2024 December solstice 09:20 UTC)', () => {
    const s = nextSeason(new Date('2024-12-01T00:00:00Z'));
    expect(s.name).toBe('December solstice');
    near(s.date, '2024-12-21T09:20:00Z', 2);
    // Past the last one of a year, it's the next year's March equinox (2025-03-20 09:01 UTC).
    const m = nextSeason(new Date('2024-12-22T00:00:00Z'));
    expect(m.name).toBe('March equinox');
    near(m.date, '2025-03-20T09:01:00Z', 2);
  });

  it('finds the next full and new moon (January 2024: full 25th 17:54, new 11th 11:57 UTC)', () => {
    const full = nextMoon(new Date('2024-01-20T00:00:00Z'), true);
    expect(full.name).toBe('Full moon');
    near(full.date, '2024-01-25T17:54:00Z', 2);
    near(nextMoon(new Date('2024-01-01T00:00:00Z'), false).date, '2024-01-11T11:57:00Z', 2);
  });

  it('finds sunrise and sunset at a place (Greenwich, midsummer 2024: 03:43 and 20:21 UTC)', () => {
    const from = new Date('2024-06-20T12:00:00Z');
    near(nextSun(from, 51.48, 0, false)?.date, '2024-06-20T20:21:00Z', 3);
    near(nextSun(from, 51.48, 0, true)?.date, '2024-06-21T03:43:00Z', 3);
  });

  it('has no sunrise to give in the midnight sun', () => {
    expect(nextSun(new Date('2024-06-20T12:00:00Z'), 85, 0, true)).toBeNull();
  });

  it('moves on from a moment already shown', () => {
    const first = nextSeason(new Date('2024-12-01T00:00:00Z'));
    expect(nextSeason(first.date).name).toBe('March equinox');
    const moon = nextMoon(new Date('2024-01-20T00:00:00Z'), true);
    expect(nextMoon(moon.date, true).date.getTime() - moon.date.getTime()).toBeGreaterThan(25 * 24 * 60 * MIN);
  });

  it('keeps to 1900–2100', () => {
    expect(inRange(new Date('1900-01-01T00:00:00Z'))).toBe(true);
    expect(inRange(new Date('2100-12-31T23:59:59Z'))).toBe(true);
    expect(inRange(new Date('1899-12-31T23:59:59Z'))).toBe(false);
    expect(inRange(new Date('2101-01-01T00:00:00Z'))).toBe(false);
  });
});

describe('picker inputs', () => {
  const d = new Date('2026-10-24T14:32:07.900Z');

  it('fill from a moment in UTC', () => {
    expect(toInputs(d, 'utc')).toEqual({ date: '2026-10-24', time: '14:32:07' });
  });

  it('fill in local time, and read back the same moment', () => {
    const local = toInputs(d, 'local');
    expect(local.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(fromInputs(local.date, local.time, 'local')?.getTime()).toBe(Math.floor(d.getTime() / 1000) * 1000);
  });

  it('read a moment, with or without seconds (iOS has none), or midnight with no time', () => {
    expect(fromInputs('2027-08-02', '10:07:30', 'utc')?.toISOString()).toBe('2027-08-02T10:07:30.000Z');
    expect(fromInputs('2027-08-02', '10:07', 'utc')?.toISOString()).toBe('2027-08-02T10:07:00.000Z');
    expect(fromInputs('2027-08-02', '', 'utc')?.toISOString()).toBe('2027-08-02T00:00:00.000Z');
  });

  it('refuse dates that aren\'t, or are out of range', () => {
    expect(fromInputs('2027-02-31', '12:00', 'utc')).toBeNull();
    expect(fromInputs('', '12:00', 'utc')).toBeNull();
    expect(fromInputs('1850-06-01', '12:00', 'utc')).toBeNull();
    expect(fromInputs('2150-06-01', '12:00', 'utc')).toBeNull();
  });
});
