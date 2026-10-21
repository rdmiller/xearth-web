import { describe, expect, it } from 'vitest';
import { defaults, parseSettings, timezoneLongitude, toQuery } from '../params';

describe('parseSettings', () => {
  it('returns defaults for an empty query', () => {
    const d = defaults();
    expect(parseSettings('', d)).toEqual(d);
  });

  it('reads xearth-style settings and clamps out-of-range numbers', () => {
    const s = parseSettings('?view=sunrel&lat=120&lon=-30&wait=0&clouds=0&grid=1&time=2026-06-21T08:24:00Z');
    expect(s.view).toBe('sunrel');
    expect(s.lat).toBe(90);
    expect(s.lon).toBe(-30);
    expect(s.wait).toBe(1);
    expect(s.clouds).toBe(false);
    expect(s.grid).toBe(true);
    expect(s.time?.toISOString()).toBe('2026-06-21T08:24:00.000Z');
  });

  it('ignores junk values', () => {
    const d = defaults();
    const s = parseSettings('?view=mars&mag=abc&time=yesterday', d);
    expect(s.view).toBe(d.view);
    expect(s.mag).toBe(d.mag);
    expect(s.time).toBeNull();
  });
});

describe('toQuery', () => {
  it('round-trips and omits defaults', () => {
    const d = defaults();
    expect(toQuery(d, d)).toBe('');
    const s = { ...d, view: 'moon' as const, mag: 1.5, stars: false };
    const q = toQuery(s, d);
    expect(q).toContain('view=moon');
    expect(q).not.toContain('lat=');
    expect(parseSettings(q, d)).toEqual(s);
  });
});

describe('timezoneLongitude', () => {
  it('maps UTC offsets to the zone’s central meridian', () => {
    expect(timezoneLongitude(0)).toBe(0);
    expect(timezoneLongitude(300)).toBe(-75); // UTC−5
    expect(timezoneLongitude(-540)).toBe(135); // UTC+9
  });
});
