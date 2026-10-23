// Global winds from NOAA's GFS model, as particles carried along by them: at 10 m (what a
// weather map's wind is), or at 250 hPa, the jet stream's level (~10 km up).
//
// NOMADS serves GFS as GRIB, without CORS, so the pipeline (winds.py) takes the newest run's
// forecast for the coming hour and writes each level as a 720 × 361 PNG at 0.5°: red = u
// (eastward), green = v (northward), 128 = calm, ±127 = ±`scale` m/s. ~250 KB a level, and only
// the level shown is fetched.
//
// The particles are moved here, on the CPU (a few thousand bilinear lookups a frame), and drawn
// as fading trails by renderer/winds.ts on a canvas of their own over the globe: they need every
// display frame, and the globe shader, at 16 textures, would rather not be redrawn that often.
// Each particle's last TRAIL_SLOTS positions, a TICK_S apart, make its trail; positions are kept
// on the sphere (Earth-fixed), so trails stay put on the ground while the view turns.

import { DEG, type Vec3 } from './vec';
import { project, unproject, type Camera } from './view';

export type WindMode = 'off' | 'surface' | 'jet';

export interface WindLevel {
  /** The level's PNG, beside latest.json. */
  image: string;
  /** "10 m", "250 hPa" */
  label: string;
  /** m/s at ±127 from 128. */
  scale: number;
  /** The strongest wind on the grid, m/s, and where. */
  max: { speed: number; lat: number; lon: number };
  /** Mean speed over the grid, m/s. */
  mean: number;
}

export interface WindManifest {
  generated: string;
  source: string;
  /** The GFS run (its start) and the forecast hour shown, valid at `valid`. */
  cycle: string;
  forecastHour: number;
  valid: string;
  width: number;
  height: number;
  /** Row 0's latitude, column 0's longitude, and the spacing of both, degrees. */
  lat0: number;
  lon0: number;
  step: number;
  levels: Record<Exclude<WindMode, 'off'>, WindLevel>;
}

const isLevel = (l: unknown): l is WindLevel => {
  const v = l as WindLevel;
  return !!v && typeof v.image === 'string' && typeof v.scale === 'number' && v.scale > 0 && typeof v.max?.speed === 'number';
};

export function isWindManifest(m: unknown): m is WindManifest {
  const v = m as WindManifest;
  return (
    !!v &&
    typeof v.valid === 'string' &&
    typeof v.cycle === 'string' &&
    Number.isInteger(v.width) &&
    Number.isInteger(v.height) &&
    typeof v.step === 'number' &&
    isLevel(v.levels?.surface) &&
    isLevel(v.levels?.jet)
  );
}

/** One level's wind on the manifest's grid, m/s, row 0 north. */
export interface WindField {
  mode: Exclude<WindMode, 'off'>;
  valid: string;
  width: number;
  height: number;
  lat0: number;
  lon0: number;
  step: number;
  u: Float32Array;
  v: Float32Array;
}

/** RGBA pixels (as getImageData gives them) → u and v, m/s. */
export function decodeWind(rgba: ArrayLike<number>, n: number, scale: number): { u: Float32Array; v: Float32Array } {
  const u = new Float32Array(n);
  const v = new Float32Array(n);
  const k = scale / 127;
  for (let i = 0; i < n; i++) {
    u[i] = (rgba[4 * i] - 128) * k;
    v[i] = (rgba[4 * i + 1] - 128) * k;
  }
  return { u, v };
}

/** Bilinear u and v at a point, m/s: longitude wraps, latitude holds at the poles' rows. */
export function sampleWind(f: WindField, lat: number, lon: number, out: [number, number] = [0, 0]): [number, number] {
  let x = (lon - f.lon0) / f.step;
  x = ((x % f.width) + f.width) % f.width;
  const y = Math.max(0, Math.min(f.height - 1, (f.lat0 - lat) / f.step));
  const x0 = Math.floor(x);
  const y0 = Math.min(f.height - 2, Math.floor(y));
  const x1 = x0 + 1 === f.width ? 0 : x0 + 1;
  const fx = x - x0;
  const fy = y - y0;
  const a = y0 * f.width;
  const b = a + f.width;
  const w00 = (1 - fx) * (1 - fy);
  const w10 = fx * (1 - fy);
  const w01 = (1 - fx) * fy;
  const w11 = fx * fy;
  out[0] = f.u[a + x0] * w00 + f.u[a + x1] * w10 + f.u[b + x0] * w01 + f.u[b + x1] * w11;
  out[1] = f.v[a + x0] * w00 + f.v[a + x1] * w10 + f.v[b + x0] * w01 + f.v[b + x1] * w11;
  return out;
}

/** Fetch and decode a level's PNG. `base`: the folder latest.json was read from. */
export async function loadWindField(base: string, m: WindManifest, mode: Exclude<WindMode, 'off'>): Promise<WindField> {
  const level = m.levels[mode];
  const url = new URL(level.image, base).href;
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${r.status} ${url}`);
  // The colours are data: no colour management.
  const bmp = await createImageBitmap(await r.blob(), { colorSpaceConversion: 'none', premultiplyAlpha: 'none' });
  if (bmp.width !== m.width || bmp.height !== m.height) throw new Error(`${level.image} is ${bmp.width}×${bmp.height}, not ${m.width}×${m.height}`);
  const c = new OffscreenCanvas(m.width, m.height);
  const g = c.getContext('2d', { willReadFrequently: true })!;
  g.drawImage(bmp, 0, 0);
  bmp.close();
  const { u, v } = decodeWind(g.getImageData(0, 0, m.width, m.height).data, m.width * m.height, level.scale);
  return { mode, valid: m.valid, width: m.width, height: m.height, lat0: m.lat0, lon0: m.lon0, step: m.step, u, v };
}

// ---- look -------------------------------------------------------------------------------------

/**
 * Trail colour by speed, m/s: calm air a faint blue, a breeze cyan to white, then yellow, orange
 * and red into storm force, magenta past hurricane force (33 m/s). The jet stream's level runs
 * three times as fast, so its scale is stretched to match.
 */
export const WIND_RAMP: readonly (readonly [number, number, number, number])[] = [
  [0, 0.45, 0.62, 1.0],
  [4, 0.55, 0.88, 1.0],
  [9, 0.92, 0.98, 1.0],
  [15, 1.0, 0.9, 0.38],
  [21, 1.0, 0.58, 0.2],
  [27, 1.0, 0.28, 0.3],
  [33, 0.95, 0.3, 0.95],
];
export const RAMP_STRETCH: Record<Exclude<WindMode, 'off'>, number> = { surface: 1, jet: 3 };

/** On-screen speed of the particles: CSS px a second per m/s, whatever the zoom. */
export const PX_PER_MS: Record<Exclude<WindMode, 'off'>, number> = { surface: 4.5, jet: 1.6 };

const KMH = 3.6;

/** "10 m · calm blue → 120+ km/h magenta · up to 109 km/h, 25.5°N 123.5°E · GFS 21:00 UTC" */
export function windSummary(mode: Exclude<WindMode, 'off'>, m: WindManifest): string {
  const l = m.levels[mode];
  const top = Math.round((WIND_RAMP[WIND_RAMP.length - 1][0] * RAMP_STRETCH[mode] * KMH) / 10) * 10;
  const where = `${Math.abs(l.max.lat).toFixed(1)}°${l.max.lat >= 0 ? 'N' : 'S'} ${Math.abs(l.max.lon).toFixed(1)}°${l.max.lon >= 0 ? 'E' : 'W'}`;
  const name = mode === 'jet' ? `jet stream ${l.label}` : l.label;
  return `${name} · calm blue → ${top}+ km/h magenta · up to ${Math.round(l.max.speed * KMH)} km/h, ${where} · GFS ${m.valid.slice(11, 16)} UTC`;
}

// ---- particles --------------------------------------------------------------------------------

/** Positions kept per trail, and how far apart in time. */
export const TRAIL_SLOTS = 14;
export const TICK_S = 1 / 30;
/** CSS px² of globe on screen per particle, and the most there can be. */
export const PX2_PER_PARTICLE = 90;
export const MAX_PARTICLES = 7000;
/** A particle lives this long (s) before starting again somewhere else. */
const LIFE_S: [number, number] = [1.6, 4.0];
/** Floats per trail point: x, y, z, life id (−1 = nothing), speed m/s. */
export const POINT_FLOATS = 5;

export interface WindView {
  camera: Camera;
  /** CSS px per Earth radius, and the canvas's CSS size. */
  radiusPx: number;
  width: number;
  height: number;
}

/**
 * The particles and their trails. `trail` holds TRAIL_SLOTS + 1 slots of `capacity` points
 * (slot-major, POINT_FLOATS each); the extra slot repeats slot 0, so each segment, slot s to
 * s + 1, reads from one place. `head` is the slot being written; it advances every TICK_S.
 */
export class WindParticles {
  readonly trail: Float32Array;
  head = 0;
  /** Where in the current tick we are, 0…1 (the trail's fade slides with it). */
  phase = 0;
  /** Particles in play; the rest of the capacity is idle. */
  active = 0;
  /** Slots written since the last `takeDirty`, for the GPU upload. */
  private dirty = new Set<number>();
  private readonly pos: Float32Array;
  private readonly age: Float32Array;
  private readonly life: Float32Array;
  private readonly gen: Float32Array;
  private readonly speed: Float32Array;
  private clock = 0;
  private nextGen = 0;
  private readonly uv: [number, number] = [0, 0];

  constructor(
    readonly capacity = MAX_PARTICLES,
    private readonly random: () => number = Math.random,
  ) {
    this.trail = new Float32Array((TRAIL_SLOTS + 1) * capacity * POINT_FLOATS);
    this.pos = new Float32Array(capacity * 3);
    this.age = new Float32Array(capacity);
    this.life = new Float32Array(capacity);
    this.gen = new Float32Array(capacity).fill(-1);
    this.speed = new Float32Array(capacity);
    for (let i = 0; i < this.trail.length; i += POINT_FLOATS) this.trail[i + 3] = -1;
  }

  /** How many particles suit the view: by the globe's area on screen. */
  static countFor(v: WindView, capacity = MAX_PARTICLES): number {
    const disc = Math.PI * v.radiusPx * v.radiusPx;
    return Math.min(capacity, Math.round(Math.min(disc, v.width * v.height) / PX2_PER_PARTICLE));
  }

  /** Forget every particle and trail (a new field, or the layer coming back on). */
  reset() {
    this.gen.fill(-1);
    this.age.fill(0);
    for (let i = 3; i < this.trail.length; i += POINT_FLOATS) this.trail[i] = -1;
    this.active = 0;
    this.clock = 0;
    this.phase = 0;
    for (let s = 0; s <= TRAIL_SLOTS; s++) this.dirty.add(s);
  }

  /** A random point of the globe that's on screen, or null if a few tries miss. */
  private spawnPoint(v: WindView): Vec3 | null {
    const r = v.radiusPx;
    // The disc's bounding box, clipped to the screen.
    const x0 = Math.max(-r, -v.width / 2);
    const x1 = Math.min(r, v.width / 2);
    const y0 = Math.max(-r, -v.height / 2);
    const y1 = Math.min(r, v.height / 2);
    if (x1 <= x0 || y1 <= y0) return null;
    for (let k = 0; k < 6; k++) {
      const x = x0 + (x1 - x0) * this.random();
      const y = y0 + (y1 - y0) * this.random();
      const p = unproject(v.camera, x / r, y / r);
      if (p) return p;
    }
    return null;
  }

  private onScreen(v: WindView, i: number): boolean {
    const p: Vec3 = [this.pos[3 * i], this.pos[3 * i + 1], this.pos[3 * i + 2]];
    const q = project(v.camera, p);
    if (!q.visible) return false;
    const margin = 8;
    return Math.abs(q.x * v.radiusPx) < v.width / 2 + margin && Math.abs(q.y * v.radiusPx) < v.height / 2 + margin;
  }

  private respawn(v: WindView, i: number, fresh: boolean) {
    const p = this.spawnPoint(v);
    if (!p) {
      this.gen[i] = -1;
      return;
    }
    this.pos[3 * i] = p[0];
    this.pos[3 * i + 1] = p[1];
    this.pos[3 * i + 2] = p[2];
    this.life[i] = LIFE_S[0] + (LIFE_S[1] - LIFE_S[0]) * this.random();
    // The first ones start part-way through their lives, so they don't all end together.
    this.age[i] = fresh ? this.life[i] * this.random() : 0;
    this.gen[i] = this.nextGen = (this.nextGen + 1) % 65536;
  }

  /** Move every particle on by `dt` seconds of animation and write the trails' heads. */
  step(field: WindField, v: WindView, dt: number) {
    const want = WindParticles.countFor(v, this.capacity);
    // Angular speed per m/s: the same on-screen speed at any zoom.
    const k = PX_PER_MS[field.mode] / Math.max(v.radiusPx, 1);
    for (let i = 0; i < this.capacity; i++) {
      if (i >= want) {
        this.gen[i] = -1;
        continue;
      }
      this.age[i] += dt;
      if (this.gen[i] < 0 || this.age[i] > this.life[i] || !this.onScreen(v, i)) {
        this.respawn(v, i, this.gen[i] < 0 && i >= this.active);
        if (this.gen[i] < 0) continue;
      }
      const x = this.pos[3 * i];
      const y = this.pos[3 * i + 1];
      const z = this.pos[3 * i + 2];
      const c = Math.hypot(x, y); // cos(lat)
      if (c < 1e-4) {
        this.age[i] = this.life[i] + 1; // too near a pole for east and north: start again
        continue;
      }
      const [u, w] = sampleWind(field, Math.asin(Math.max(-1, Math.min(1, z))) / DEG, Math.atan2(y, x) / DEG, this.uv);
      const cl = x / c; // cos(lon)
      const sl = y / c; // sin(lon)
      // east = (−sin lon, cos lon, 0); north = (−sin lat cos lon, −sin lat sin lon, cos lat)
      const d = k * dt;
      const nx = x + d * (-u * sl - w * z * cl);
      const ny = y + d * (u * cl - w * z * sl);
      const nz = z + d * (w * c);
      const len = Math.hypot(nx, ny, nz);
      this.pos[3 * i] = nx / len;
      this.pos[3 * i + 1] = ny / len;
      this.pos[3 * i + 2] = nz / len;
      this.speed[i] = Math.hypot(u, w);
    }
    this.active = want;
    this.clock += dt;
    if (this.clock >= TICK_S) {
      this.clock %= TICK_S;
      this.head = (this.head + 1) % TRAIL_SLOTS;
    }
    this.phase = this.clock / TICK_S;
    this.writeHead();
  }

  private writeHead() {
    const write = (slot: number) => {
      const base = slot * this.capacity * POINT_FLOATS;
      for (let i = 0; i < this.capacity; i++) {
        const o = base + i * POINT_FLOATS;
        this.trail[o] = this.pos[3 * i];
        this.trail[o + 1] = this.pos[3 * i + 1];
        this.trail[o + 2] = this.pos[3 * i + 2];
        this.trail[o + 3] = this.gen[i];
        this.trail[o + 4] = this.speed[i];
      }
      this.dirty.add(slot);
    };
    write(this.head);
    if (this.head === 0) write(TRAIL_SLOTS);
  }

  /** Slots changed since last asked (each to be uploaded whole). */
  takeDirty(): number[] {
    const s = [...this.dirty];
    this.dirty.clear();
    return s;
  }
}
