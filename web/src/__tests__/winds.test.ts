import { describe, expect, it } from 'vitest';
import manifest from './fixtures/winds-2026-10-23.json';
import { HOTKEYS } from '../hotkeys';
import { defaults, parseSettings, toQuery, type Settings } from '../params';
import { DEG, dot, type Vec3 } from '../vec';
import type { Camera } from '../view';
import {
  decodeWind,
  isWindManifest,
  POINT_FLOATS,
  PX_PER_MS,
  sampleWind,
  TICK_S,
  TRAIL_SLOTS,
  WindParticles,
  windSummary,
  type WindField,
  type WindView,
} from '../winds';

/** A seeded generator, so the particles land in the same places every run. */
function seeded(seed = 7): () => number {
  let s = seed;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
}

/** Every point blowing the same way. */
function uniform(u: number, v: number, mode: 'surface' | 'jet' = 'surface'): WindField {
  const width = 720;
  const height = 361;
  return { mode, valid: '', width, height, lat0: 90, lon0: 0, step: 0.5, u: new Float32Array(width * height).fill(u), v: new Float32Array(width * height).fill(v) };
}

/** Looking straight down at 0°N 0°E from far away, the disc 400 px across a 1000 px screen. */
const CAMERA: Camera = { dir: [1, 0, 0], right: [0, 1, 0], up: [0, 0, 1], dist: 0, focal: 1 };
const VIEW: WindView = { camera: CAMERA, radiusPx: 200, width: 1000, height: 1000 };

function headPoints(p: WindParticles, slot = p.head): { pos: Vec3; gen: number; speed: number }[] {
  const out = [];
  for (let i = 0; i < p.capacity; i++) {
    const o = (slot * p.capacity + i) * POINT_FLOATS;
    out.push({ pos: [p.trail[o], p.trail[o + 1], p.trail[o + 2]] as Vec3, gen: p.trail[o + 3], speed: p.trail[o + 4] });
  }
  return out;
}

describe('the pipeline’s wind manifest', () => {
  it('is recognised, and something else isn’t', () => {
    expect(isWindManifest(manifest)).toBe(true);
    expect(isWindManifest({ ...manifest, levels: { surface: manifest.levels.surface } })).toBe(false);
    expect(isWindManifest({ ...manifest, width: '720' })).toBe(false);
    expect(isWindManifest(null)).toBe(false);
  });

  it('says what the trails show and the scale of their colours', () => {
    if (!isWindManifest(manifest)) throw new Error('fixture');
    expect(windSummary('surface', manifest)).toBe('10 m · calm blue → 120+ km/h magenta · up to 109 km/h, 25.5°N 123.5°E · GFS 21:00 UTC');
    expect(windSummary('jet', manifest)).toBe('jet stream 250 hPa · calm blue → 360+ km/h magenta · up to 316 km/h, 54.5°N 32.0°W · GFS 21:00 UTC');
  });
});

describe('decoding and sampling the wind grid', () => {
  it('reads red as u and green as v, 128 calm and ±127 the scale', () => {
    const rgba = [128, 128, 0, 255, 255, 1, 0, 255, 192, 64, 0, 255];
    const { u, v } = decodeWind(rgba, 3, 29);
    expect([...u].map((x) => +x.toFixed(3))).toEqual([0, 29, +((64 * 29) / 127).toFixed(3)]);
    expect([...v].map((x) => +x.toFixed(3))).toEqual([0, -29, +((-64 * 29) / 127).toFixed(3)]);
  });

  it('interpolates between grid points, across 0°E, and holds at the poles', () => {
    // 4 columns 90° apart from 0°E, 3 rows: 90°N, 0°, 90°S. u = the column's longitude / 90.
    const f: WindField = { mode: 'surface', valid: '', width: 4, height: 3, lat0: 90, lon0: 0, step: 90, u: new Float32Array([0, 1, 2, 3, 0, 1, 2, 3, 0, 1, 2, 3]), v: new Float32Array([5, 5, 5, 5, 0, 0, 0, 0, -5, -5, -5, -5]) };
    expect(sampleWind(f, 0, 45)).toEqual([0.5, 0]);
    expect(sampleWind(f, 45, 90)[1]).toBeCloseTo(2.5);
    // Between 270°E (3) and 360° = 0°E (0).
    expect(sampleWind(f, 0, -45)[0]).toBeCloseTo(1.5);
    expect(sampleWind(f, 0, 315)[0]).toBeCloseTo(1.5);
    expect(sampleWind(f, -90, 0)[1]).toBe(-5);
    expect(sampleWind(f, -95, 0)[1]).toBe(-5);
  });
});

describe('wind particles', () => {
  it('fill the globe on screen, one per PX2 of it', () => {
    expect(WindParticles.countFor(VIEW)).toBe(Math.round((Math.PI * 200 * 200) / 90));
    // Zoomed right in, the screen is all globe; never more than the capacity.
    expect(WindParticles.countFor({ ...VIEW, radiusPx: 50_000 })).toBe(7000);
    expect(WindParticles.countFor({ ...VIEW, radiusPx: 50_000 }, 500)).toBe(500);
  });

  it('start on the side of the globe in view, and the rest stay idle', () => {
    const p = new WindParticles(2000, seeded());
    p.step(uniform(0, 0), VIEW, 0);
    const want = WindParticles.countFor(VIEW, 2000);
    expect(p.active).toBe(want);
    const pts = headPoints(p);
    expect(pts.slice(0, want).every((q) => q.gen >= 0 && dot(q.pos, CAMERA.dir) > 0)).toBe(true);
    expect(pts.slice(want).every((q) => q.gen === -1)).toBe(true);
  });

  it('move with the wind at the same speed on screen at any zoom', () => {
    for (const radiusPx of [200, 2000]) {
      const p = new WindParticles(1500, seeded(3));
      const view = { ...VIEW, radiusPx };
      p.step(uniform(10, 0), view, 0);
      const before = headPoints(p);
      p.step(uniform(10, 0), view, TICK_S * 0.99);
      const after = headPoints(p);
      // Eastward 10 m/s for ~1/30 s: 4.5 px/s per m/s → ~1.5 px of the disc's radius.
      const want = ((10 * PX_PER_MS.surface * TICK_S * 0.99) / radiusPx) / DEG;
      let n = 0;
      for (let i = 0; i < before.length; i++) {
        if (before[i].gen < 0 || before[i].gen !== after[i].gen) continue;
        const [x0, y0, z0] = before[i].pos;
        const [x1, y1, z1] = after[i].pos;
        const lat = Math.asin(z0) / DEG;
        // A step east follows a great circle, so it edges toward the equator by ~θ²/2 · tan(lat).
        const drift = ((want * DEG) ** 2 / 2) * Math.tan(Math.abs(lat) * DEG);
        expect(Math.abs(Math.asin(z1) / DEG - lat)).toBeLessThan((drift * 1.1) / DEG + 1e-6);
        expect(((Math.atan2(y1, x1) - Math.atan2(y0, x0)) / DEG) * Math.cos(lat * DEG)).toBeCloseTo(want, 2);
        expect(after[i].speed).toBeCloseTo(10, 5);
        n++;
      }
      expect(n).toBeGreaterThan(100);
    }
  });

  it('go north with a south wind', () => {
    const p = new WindParticles(500, seeded(5));
    p.step(uniform(0, 20), VIEW, 0);
    const before = headPoints(p);
    p.step(uniform(0, 20), VIEW, 0.02);
    const after = headPoints(p);
    const moved = before.map((b, i) => (b.gen >= 0 && b.gen === after[i].gen ? after[i].pos[2] - b.pos[2] : NaN)).filter(Number.isFinite);
    expect(moved.length).toBeGreaterThan(100);
    expect(moved.every((dz) => dz > 0)).toBe(true);
  });

  it('keep a trail: the head moves on a slot a tick, slot 0 repeated at the end', () => {
    const p = new WindParticles(100, seeded());
    const f = uniform(5, 5);
    p.step(f, VIEW, 0);
    p.takeDirty();
    expect(p.head).toBe(0);
    for (let k = 1; k <= TRAIL_SLOTS; k++) {
      p.step(f, VIEW, TICK_S);
      expect(p.head).toBe(k % TRAIL_SLOTS);
    }
    // The last tick wrapped to slot 0, which is written twice: there and in the extra slot.
    expect(p.takeDirty().sort((a, b) => a - b)).toEqual([...Array(TRAIL_SLOTS + 1).keys()]);
    expect(headPoints(p, 0)).toEqual(headPoints(p, TRAIL_SLOTS));
    p.step(f, VIEW, TICK_S / 2);
    expect(p.phase).toBeCloseTo(0.5);
    expect(p.takeDirty().sort((a, b) => a - b)).toEqual([0, TRAIL_SLOTS]);
    p.step(f, VIEW, TICK_S / 2);
    expect(p.head).toBe(1);
    expect(p.takeDirty()).toEqual([1]);
  });

  it('forget everything on reset', () => {
    const p = new WindParticles(100, seeded());
    p.step(uniform(5, 5), VIEW, 0);
    p.reset();
    expect(p.active).toBe(0);
    for (let s = 0; s <= TRAIL_SLOTS; s++) expect(headPoints(p, s).every((q) => q.gen === -1)).toBe(true);
  });

  it('wait while no globe is on screen', () => {
    const p = new WindParticles(100, seeded());
    // The disc entirely off to one side of a small screen: nowhere to start.
    const away: WindView = { ...VIEW, width: 10, height: 10, camera: { ...CAMERA, dir: [0, 0, 1], right: [0, 1, 0], up: [-1, 0, 0] }, radiusPx: 0.001 };
    p.step(uniform(5, 5), away, 0);
    expect(headPoints(p).every((q) => q.gen === -1)).toBe(true);
  });
});

describe('the winds setting', () => {
  it('is in the URL as winds=surface|jet', () => {
    expect(parseSettings('').winds).toBe('off');
    expect(parseSettings('?winds=jet').winds).toBe('jet');
    expect(parseSettings('?winds=1').winds).toBe('surface');
    expect(parseSettings('?winds=0').winds).toBe('off');
    expect(toQuery({ ...defaults(), winds: 'jet' })).toBe('?winds=jet');
  });

  it('Shift+V cycles 10 m → jet stream → off', () => {
    let s: Settings = defaults();
    const key = HOTKEYS.find((h) => h.keys.includes('shift+v'))!;
    const ctx = { settings: s, update: (p: Partial<Settings>) => (s = ctx.settings = { ...s, ...p }), toast: () => undefined };
    const seen = [1, 2, 3].map(() => (key.run(ctx as never, {} as KeyboardEvent), s.winds));
    expect(seen).toEqual(['surface', 'jet', 'off']);
  });
});
