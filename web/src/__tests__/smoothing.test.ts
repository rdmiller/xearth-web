import { describe, expect, it } from 'vitest';
import { CONTINUOUS_BELOW_S, describeCadence, redrawInterval } from '../cadence';
import { EARTH_RADIUS_KM, positionAt, propagateAll, satrecFor, TrackCache, type Elements } from '../satellites';

// SAT GUS, CelesTrak GP elements of 2026-10-21 (as in satellites.test.ts).
const SATGUS: Elements = [62713, 1792556458.141, 15.02604421, 0.00031412, 97.684, 14.4051, 60.4357, 299.7181, 0.00062742107, 8.299e-5, 0];
const ISS: Elements = [25544, 1792544939.47, 15.48967427, 0.0006759, 51.6327, 37.2623, 289.5321, 70.4938, 0.00018188, 9.575e-5, 0];
const t0 = new Date(SATGUS[1] * 1000 + 3_600_000);

describe('velocity extrapolation', () => {
  it('position + Earth-fixed velocity × 10 s lands within 1 km of a fresh SGP4 pass', () => {
    for (const el of [SATGUS, ISS]) {
      const rec = satrecFor(el)!;
      const pos = new Float32Array(3);
      const vel = new Float32Array(3);
      propagateAll([rec], t0, pos, vel);
      const exact = positionAt(rec, new Date(t0.getTime() + 10_000))!;
      const err = Math.hypot(...[0, 1, 2].map((i) => pos[i] + vel[i] * 10 - exact[i])) * EARTH_RADIUS_KM;
      expect(err).toBeLessThan(1);
    }
  });

  it('includes the frame’s rotation (without it, 10 s is ~5 km off)', () => {
    const rec = satrecFor(ISS)!;
    const pos = new Float32Array(3);
    const vel = new Float32Array(3);
    propagateAll([rec], t0, pos, vel);
    const speedKms = Math.hypot(vel[0], vel[1], vel[2]) * EARTH_RADIUS_KM;
    // Inertial speed is ~7.66 km/s; relative to the turning Earth it differs by up to ~0.47 km/s.
    expect(speedKms).toBeGreaterThan(7.1);
    expect(speedKms).toBeLessThan(8.2);
  });

  it('writes zero position and velocity for satellites SGP4 rejects', () => {
    // A null record (elements json2satrec refused) and an orbit SGP4 fails on at epoch.
    const bad: Elements = [1, SATGUS[1], 0.5, 0.99, 0, 0, 0, 0, 0, 0, 0];
    const pos = new Float32Array(6).fill(9);
    const vel = new Float32Array(6).fill(9);
    propagateAll([null, satrecFor(bad)], new Date(SATGUS[1] * 1000), pos, vel);
    expect([...pos, ...vel]).toEqual(new Array(12).fill(0));
  });
});

describe('TrackCache', () => {
  it('reuses samples between frames and puts the satellite itself at t = 0', () => {
    const rec = satrecFor(ISS)!;
    const cache = new TrackCache();
    const step = 92.9 / 160;
    const here = positionAt(rec, t0)!;
    const a = cache.track('iss', rec, t0, 46, 46, step, here);
    const now = a.find((k) => k.t === 0);
    expect(now?.pos).toBe(here);
    expect(a.length).toBeGreaterThan(155);

    const first = cache.misses;
    expect(first).toBe(a.length - 1); // every grid sample computed once; t = 0 is supplied

    // A frame 5 s later needs at most the sample entering the window.
    const t1 = new Date(t0.getTime() + 5_000);
    const b = cache.track('iss', rec, t1, 46, 46, step, positionAt(rec, t1)!);
    expect(cache.misses - first).toBeLessThanOrEqual(1);
    // Grid samples are identical between frames.
    const gridA = a.filter((k) => k.t !== 0 && k.t > -40 && k.t < 40).map((k) => k.pos);
    const gridB = b.filter((k) => k.t !== 0 && k.t > -40 && k.t < 40).map((k) => k.pos);
    expect(gridB.slice(0, 10)).toEqual(gridA.slice(0, 10));
  });

  it('matches a fresh SGP4 position at every grid sample', () => {
    const rec = satrecFor(SATGUS)!;
    const cache = new TrackCache();
    const out = cache.track('gus', rec, t0, 48, 48, 0.6, positionAt(rec, t0)!);
    const sample = out.find((k) => k.t > 10)!;
    const exact = positionAt(rec, new Date(t0.getTime() + sample.t * 60_000))!;
    expect(sample.pos).toEqual(exact);
  });
});

describe('redrawInterval', () => {
  const base = { animating: false, leo: true, speed: 1, radiusPx: 333, wait: 60 };

  it('at rest at default zoom, redraws about once a second (satellites move ~0.4 px/s)', () => {
    const s = redrawInterval(base);
    expect(s).toBeGreaterThan(0.9);
    expect(s).toBeLessThan(1.5);
  });

  it('zoomed in 8×, redraws ~8 times a second so satellites don’t step', () => {
    const s = redrawInterval({ ...base, radiusPx: 333 * 8 });
    expect(s).toBeGreaterThan(0.1);
    expect(s).toBeLessThan(0.2);
  });

  it('goes continuous for fast clocks, drags and fades', () => {
    expect(redrawInterval({ ...base, speed: 600 })).toBe(0);
    expect(redrawInterval({ ...base, animating: true })).toBe(0);
    expect(redrawInterval({ ...base, speed: 10 })).toBeGreaterThan(CONTINUOUS_BELOW_S);
  });

  it('with only the Earth turning, redraws every ~20 s (the equator moves 0.024 px/s)', () => {
    const s = redrawInterval({ ...base, leo: false });
    expect(s).toBeGreaterThan(19);
    expect(s).toBeLessThan(22);
  });

  it('never waits longer than xearth’s wait, and uses it when the clock is paused', () => {
    expect(redrawInterval({ ...base, speed: 0 })).toBe(60);
    expect(redrawInterval({ ...base, wait: 5, leo: false })).toBe(5);
  });

  it('describes itself for the frame-rate display', () => {
    expect(describeCadence(0)).toBe('continuous');
    expect(describeCadence(1.234)).toBe('on demand · every 1.2 s');
    expect(describeCadence(0.15)).toBe('on demand · every 150 ms');
  });
});
