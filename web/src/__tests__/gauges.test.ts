import { describe, expect, it } from 'vitest';
import { arcPath, fraction, polar, Series, severity, sparkPath, sparkScale, wrap360, type MeterScale } from '../gauges';

const CO2: MeterScale = { min: 0, max: 6, ok: [0, 3], warn: [0, 4] };

describe('meters', () => {
  it('place a value along the scale, clamped to the track', () => {
    expect(fraction(3, 0, 6)).toBe(0.5);
    expect(fraction(-1, 0, 6)).toBe(0);
    expect(fraction(9, 0, 6)).toBe(1);
    expect(fraction(1, 2, 2)).toBe(0);
  });

  it('read normal inside the ok band, caution inside warn, and alarm beyond', () => {
    expect(severity(2.4, CO2)).toBe('ok');
    expect(severity(3.5, CO2)).toBe('warn');
    expect(severity(4.5, CO2)).toBe('bad');
    const pressure: MeterScale = { min: 13.5, max: 15.5, ok: [14.2, 14.9], warn: [13.9, 15.2] };
    expect(severity(14.0, pressure)).toBe('warn'); // low is as much a caution as high
    expect(severity(13.6, pressure)).toBe('bad');
  });
});

describe('sparklines', () => {
  it('span the box, oldest at the left, high values at the top', () => {
    expect(sparkPath([1, 2, 3], 100, 20)).toBe('M0.0 18.5 L50.0 10.0 L100.0 1.5');
    expect(sparkPath([], 100, 20)).toBe('');
  });

  it('keep small wobbles small: the vertical scale never spans less than minSpan', () => {
    const { y } = sparkScale([420.0, 420.1], 100, 20, 2);
    expect(Math.abs(y(420.1) - y(420.0))).toBeLessThan(1); // 0.1 km of 2 km → under a pixel
    const flat = sparkScale([5, 5, 5], 100, 20);
    expect(flat.y(5)).toBe(10);
  });
});

describe('dials', () => {
  it('measure angles clockwise from 12 o’clock', () => {
    const [x, y] = polar(24, 24, 10, 90);
    expect(x).toBeCloseTo(34);
    expect(y).toBeCloseTo(24);
    expect(arcPath(24, 24, 10, -90, 90)).toBe('M14.00 24.00 A10 10 0 0 1 34.00 24.00');
  });

  it('wrap joint angles into one turn', () => {
    expect(wrap360(-20)).toBe(340);
    expect(wrap360(370)).toBe(10);
  });
});

describe('series', () => {
  it('keeps one sample per interval, and only the last span', () => {
    const s = new Series(10_000, 2000);
    expect(s.push(0, 1)).toBe(true);
    expect(s.push(1000, 2)).toBe(false); // too soon
    for (let t = 2000; t <= 14_000; t += 2000) s.push(t, t / 1000);
    expect(s.times[0]).toBe(4000);
    expect(s.values.at(-1)).toBe(14);
    expect(s.change).toBe(10);
  });

  it('starts over if time runs backwards (a clock reset)', () => {
    const s = new Series(10_000, 2000);
    s.push(10_000, 1);
    s.push(12_000, 2);
    expect(s.push(5000, 3)).toBe(true);
    expect(s.values).toEqual([3]);
    expect(s.change).toBeUndefined();
  });

  it('reads off the sample nearest a point along the line', () => {
    const s = new Series(60_000, 1000);
    [10, 20, 30].forEach((v, i) => s.push(i * 1000, v));
    expect(s.at(0)).toEqual({ t: 0, v: 10 });
    expect(s.at(0.6)).toEqual({ t: 1000, v: 20 });
    expect(s.at(1)).toEqual({ t: 2000, v: 30 });
  });
});
