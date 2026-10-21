import { describe, expect, it } from 'vitest';
import { subsolarPoint, sublunarPoint, sunDirection } from '../astronomy';
import { DEG, wrapLon } from '../vec';

/**
 * Meeus, Astronomical Algorithms, ch. 25 (low-accuracy solar coordinates,
 * ~0.01°) with ch. 12 mean sidereal time. Independent of astronomy-engine.
 */
function meeusSubsolar(date: Date) {
  const jd = date.getTime() / 86_400_000 + 2440587.5;
  const T = (jd - 2451545) / 36525;
  const L0 = 280.46646 + 36000.76983 * T + 0.0003032 * T * T;
  const M = (357.52911 + 35999.05029 * T - 0.0001537 * T * T) * DEG;
  const C =
    (1.914602 - 0.004817 * T - 0.000014 * T * T) * Math.sin(M) +
    (0.019993 - 0.000101 * T) * Math.sin(2 * M) +
    0.000289 * Math.sin(3 * M);
  const omega = (125.04 - 1934.136 * T) * DEG;
  const lambda = (L0 + C - 0.00569 - 0.00478 * Math.sin(omega)) * DEG;
  const eps = (23.439291 - 0.0130042 * T + 0.00256 * Math.cos(omega)) * DEG;
  const ra = Math.atan2(Math.cos(eps) * Math.sin(lambda), Math.cos(lambda)) / DEG;
  const dec = Math.asin(Math.sin(eps) * Math.sin(lambda)) / DEG;
  const gmst = 280.46061837 + 360.98564736629 * (jd - 2451545) + 0.000387933 * T * T;
  return { lat: dec, lon: wrapLon(ra - gmst) };
}

describe('subsolarPoint', () => {
  it('puts the Sun over the equator at the March 2026 equinox (USNO: 20 Mar 14:46 UTC)', () => {
    expect(Math.abs(subsolarPoint(new Date('2026-03-20T14:46:00Z')).lat)).toBeLessThan(0.02);
  });

  it('puts the Sun over the Tropic of Cancer at the June 2026 solstice (USNO: 21 Jun 08:24 UTC)', () => {
    expect(subsolarPoint(new Date('2026-06-21T08:24:00Z')).lat).toBeCloseTo(23.436, 1);
  });

  it('agrees with Meeus’s solar coordinates to 0.02° across a year', () => {
    for (let i = 0; i < 48; i++) {
      const date = new Date(Date.UTC(2026, 0, 1) + i * 7.6 * 86_400_000 + i * 3_517_000);
      const a = subsolarPoint(date);
      const b = meeusSubsolar(date);
      expect(Math.abs(a.lat - b.lat), date.toISOString()).toBeLessThan(0.02);
      expect(Math.abs(wrapLon(a.lon - b.lon)), date.toISOString()).toBeLessThan(0.02);
    }
  });

  it('is near Greenwich at 12:00 UTC (within the equation of time, ≤ 4.2°)', () => {
    for (const m of [0, 3, 6, 9]) {
      expect(Math.abs(subsolarPoint(new Date(Date.UTC(2026, m, 15, 12))).lon)).toBeLessThan(4.2);
    }
  });

  it('moves west 15° per hour', () => {
    const a = subsolarPoint(new Date('2026-10-21T12:00:00Z'));
    const b = subsolarPoint(new Date('2026-10-21T13:00:00Z'));
    expect(wrapLon(b.lon - a.lon)).toBeCloseTo(-15, 1);
  });

  it('reports the Sun at about 1 AU', () => {
    const d = subsolarPoint(new Date('2026-07-04T00:00:00Z')).distKm;
    expect(d).toBeGreaterThan(1.47e8);
    expect(d).toBeLessThan(1.53e8);
  });
});

describe('sunDirection', () => {
  it('is a unit vector', () => {
    const v = sunDirection(new Date('2026-10-21T16:00:00Z'));
    expect(Math.hypot(...v)).toBeCloseTo(1, 12);
  });
});

describe('sublunarPoint', () => {
  it('stays within the Moon’s declination and distance limits', () => {
    for (let i = 0; i < 60; i++) {
      const m = sublunarPoint(new Date(Date.UTC(2026, 0, 1) + i * 6.1 * 86_400_000));
      expect(Math.abs(m.lat)).toBeLessThan(29.5); // 2025–26 is a major lunar standstill
      expect(m.distKm).toBeGreaterThan(355_000);
      expect(m.distKm).toBeLessThan(407_500);
    }
  });
});
