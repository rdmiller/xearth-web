// Real stars: Yale Bright Star Catalogue positions, magnitudes and colours.
//
// Positions are J2000 unit vectors, turned into the Earth-fixed frame each
// frame (precession/nutation to date, then Greenwich sidereal time), so the
// sky behind the globe is the real one for that direction and moves with it.
//
// Brightness: Sirius (V −1.46) is ~1,500× a V 6.5 star — far beyond a screen.
// Like planetarium software, the range is compressed and split between peak
// intensity and the width of a soft Gaussian dot, so a few bright stars anchor
// the field over a fine dust of faint ones.

import { MakeTime, RotateVector, Rotation_EQJ_EQD, Vector } from 'astronomy-engine';
import { gastDeg } from './astronomy';
import { DEG, type Vec3 } from './vec';

/** Naked-eye limit: stars fade out over the magnitude beyond this. */
export const LIMIT_MAG = 6.5;
/** Magnitude that gets the full peak and widest dot (≈ Sirius). */
const BRIGHT_MAG = -1.5;
const COLOR_SATURATION = 0.7;

export interface StarCatalog {
  count: number;
  /** J2000 unit vectors, xyz per star. */
  dir: Float32Array;
  mag: Float32Array;
  /** sRGB colour per star, max channel 1. */
  color: Float32Array;
}

interface CatalogJson {
  scale: number;
  data: number[];
}

export function decodeCatalog(json: CatalogJson): StarCatalog {
  const n = Math.floor(json.data.length / 4);
  const dir = new Float32Array(n * 3);
  const mag = new Float32Array(n);
  const color = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const [ra, dec, v, bv] = json.data.slice(i * 4, i * 4 + 4).map((x) => x / json.scale);
    const a = ra * DEG;
    const d = dec * DEG;
    dir.set([Math.cos(d) * Math.cos(a), Math.cos(d) * Math.sin(a), Math.sin(d)], i * 3);
    mag[i] = v;
    color.set(starColor(bv), i * 3);
  }
  return { count: n, dir, mag, color };
}

/** Effective temperature from B−V (Ballesteros 2012, EPL 97 34008). */
export function bvToTemperature(bv: number): number {
  const b = Math.max(-0.4, Math.min(2.0, bv));
  return 4600 * (1 / (0.92 * b + 1.7) + 1 / (0.92 * b + 0.62));
}

/** Blackbody colour, sRGB 0..1 (Tanner Helland's fit, 1000–40000 K). */
export function temperatureToRgb(kelvin: number): Vec3 {
  const t = Math.max(1000, Math.min(40000, kelvin)) / 100;
  const r = t <= 66 ? 255 : 329.698727446 * (t - 60) ** -0.1332047592;
  const g = t <= 66 ? 99.4708025861 * Math.log(t) - 161.1195681661 : 288.1221695283 * (t - 60) ** -0.0755148492;
  const b = t >= 66 ? 255 : t <= 19 ? 0 : 138.5177312231 * Math.log(t - 10) - 305.0447927307;
  const c = (v: number) => Math.max(0, Math.min(255, v)) / 255;
  return [c(r), c(g), c(b)];
}

/** Gently tinted star colour: blackbody hue pulled most of the way to white, max channel 1. */
export function starColor(bv: number, saturation = COLOR_SATURATION): Vec3 {
  const rgb = temperatureToRgb(bvToTemperature(bv));
  const max = Math.max(...rgb);
  return rgb.map((v) => 1 + (v / max - 1) * saturation) as unknown as Vec3;
}

/**
 * Display peak (0..1) and Gaussian sigma (CSS px) for a star of visual
 * magnitude `mag`, after `magShift` (exposure dimming, ≥ 0). t runs 0 at the
 * limit to 1 at Sirius; peak and size both grow with it, size mostly for the
 * brightest few dozen.
 */
export function starAppearance(mag: number, magShift = 0): { peak: number; sigma: number } {
  const m = mag + magShift;
  const t = Math.max(0, Math.min(1, (LIMIT_MAG - m) / (LIMIT_MAG - BRIGHT_MAG)));
  const fade = Math.max(0, Math.min(1, 1 - (m - LIMIT_MAG)));
  return { peak: (0.07 + 0.93 * t ** 0.7) * fade, sigma: 0.55 + 1.6 * t ** 1.8 };
}

/** Interleaved [peak, sigma] per star, for the GPU. */
export function appearanceBuffer(
  cat: StarCatalog,
  magShift: number,
  out: Float32Array<ArrayBuffer> = new Float32Array(cat.count * 2),
) {
  for (let i = 0; i < cat.count; i++) {
    const a = starAppearance(cat.mag[i], magShift);
    out[i * 2] = a.peak;
    out[i * 2 + 1] = a.sigma;
  }
  return out;
}

/**
 * "Camera exposure" dimming: a camera exposed for sunlit Earth loses the
 * stars. `litScreenFraction` is the share of the screen covered by the lit
 * part of the disc; the result is how many magnitudes to dim by.
 */
export function photoMagShift(litScreenFraction: number): number {
  return 16 * Math.max(0, litScreenFraction) ** 0.6;
}

/** Share of the screen covered by sunlit Earth (projected disc × lit share of it). */
export function litScreenFraction(radiusPx: number, width: number, height: number, viewDir: Vec3, sun: Vec3): number {
  const disc = Math.min(1, (Math.PI * radiusPx * radiusPx) / Math.max(1, width * height));
  const litShare = (1 + (viewDir[0] * sun[0] + viewDir[1] * sun[1] + viewDir[2] * sun[2])) / 2;
  return disc * litShare;
}

/**
 * Column-major 3×3 matrix taking J2000 (EQJ) vectors to the Earth-fixed frame
 * at `date`: precession + nutation to the equator of date, then rotation by
 * Greenwich apparent sidereal time.
 */
export function starFrame(date: Date): Float32Array {
  const time = MakeTime(date);
  const rot = Rotation_EQJ_EQD(time);
  const g = gastDeg(date) * DEG;
  const c = Math.cos(g);
  const s = Math.sin(g);
  const m = new Float32Array(9);
  const basis: Vec3[] = [
    [1, 0, 0],
    [0, 1, 0],
    [0, 0, 1],
  ];
  basis.forEach(([x, y, z], col) => {
    const v = RotateVector(rot, new Vector(x, y, z, time));
    m.set([c * v.x + s * v.y, -s * v.x + c * v.y, v.z], col * 3);
  });
  return m;
}

export function applyFrame(m: Float32Array, v: Vec3): Vec3 {
  return [
    m[0] * v[0] + m[3] * v[1] + m[6] * v[2],
    m[1] * v[0] + m[4] * v[1] + m[7] * v[2],
    m[2] * v[0] + m[5] * v[1] + m[8] * v[2],
  ];
}
