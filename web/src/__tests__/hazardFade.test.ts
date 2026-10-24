import { describe, expect, it } from 'vitest';
import { anyFaded, FADE_TIER, fadesAt, hazardFade } from '../hazardFade';

const MIN = 60_000;
const HOUR = 60 * MIN;

describe('hazard fade', () => {
  it('live layers: shown within 30 min, gone by 2 h', () => {
    expect(hazardFade(0, 'live')).toBe(1);
    expect(hazardFade(30 * MIN, 'live')).toBe(1);
    expect(hazardFade(75 * MIN, 'live')).toBeCloseTo(0.5);
    expect(hazardFade(2 * HOUR, 'live')).toBe(0);
    expect(hazardFade(30 * 24 * HOUR, 'live')).toBe(0);
  });

  it('daily layers: shown within 12 h, gone by 36 h', () => {
    expect(hazardFade(12 * HOUR, 'daily')).toBe(1);
    expect(hazardFade(24 * HOUR, 'daily')).toBeCloseTo(0.5);
    expect(hazardFade(36 * HOUR, 'daily')).toBe(0);
  });

  it('is the same into the past and the future', () => {
    for (const ms of [10 * MIN, 50 * MIN, 90 * MIN, 20 * HOUR]) {
      expect(hazardFade(-ms, 'live')).toBe(hazardFade(ms, 'live'));
      expect(hazardFade(-ms, 'daily')).toBe(hazardFade(ms, 'daily'));
    }
  });

  it('never comes back as the clock moves further away', () => {
    let last = 1;
    for (let ms = 0; ms <= 40 * HOUR; ms += 5 * MIN) {
      const f = hazardFade(ms, 'daily');
      expect(f).toBeLessThanOrEqual(last);
      last = f;
    }
  });

  it('fades every hazard, but not clouds, winds or buoys', () => {
    expect(Object.keys(FADE_TIER).sort()).toEqual(
      ['aurora', 'ash', 'events', 'fires', 'floods', 'iono', 'lightning', 'lst', 'meteors', 'quakes', 'radar', 'severe', 'smoke', 'snow', 'sst', 'storms', 'tsunami'].sort(),
    );
    for (const k of ['buoys', 'clouds', 'winds']) expect(FADE_TIER).not.toHaveProperty(k);
  });

  it('fadesAt gives each layer its tier', () => {
    const f = fadesAt(-3 * HOUR);
    expect(f.quakes).toBe(0);
    expect(f.snow).toBe(1);
    expect(f.floods).toBe(1);
  });

  it('anyFaded counts only layers that are on', () => {
    const f = fadesAt(3 * HOUR);
    expect(anyFaded(f, (k) => k === 'snow')).toBe(false);
    expect(anyFaded(f, (k) => k === 'quakes')).toBe(true);
    expect(anyFaded(fadesAt(0), () => true)).toBe(false);
  });
});
