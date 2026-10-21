// Satellites: CelesTrak GP elements (published by the pipeline as compact
// arrays) → satellite.js SGP4 → positions in the same Earth-fixed frame as the
// globe, in Earth radii.
//
// SGP4 works in TEME; satellite.js's eciToEcf rotates by GMST, which is all
// the accuracy a globe-scale view needs (well under a pixel).

import {
  eciToEcf,
  eciToGeodetic,
  gstime,
  json2satrec,
  propagate,
  type OMMJsonObject,
  type SatRec,
} from 'satellite.js';
import { dot, type Vec3 } from './vec';

export const EARTH_RADIUS_KM = 6378.137;

export interface FeaturedSat {
  /** URL / hotkey id. */
  key: string;
  norad: number;
  name: string;
  detail: string;
  color: string;
}

/** Named satellites: labelled, with an orbit line, and trackable (view=track). */
export const FEATURED: readonly FeaturedSat[] = [
  { key: 'iss', norad: 25544, name: 'ISS', detail: 'International Space Station', color: '#ffd54a' },
  { key: 'tiangong', norad: 48274, name: 'Tiangong', detail: 'China Space Station (Tianhe core)', color: '#ff8a65' },
  {
    key: 'satgus',
    norad: 62713,
    name: 'SAT GUS',
    detail: "Mark Rober's Space Selfie satellite (CrunchLabs, launched 14 Jan 2025)",
    color: '#4dd0e1',
  },
];

export const featuredByKey = (key: string) => FEATURED.find((f) => f.key === key);

/** [norad, epoch (Unix s), n, e, i, raan, argp, M, bstar, ndot, nddot] — see pipeline/satellites.py. */
export type Elements = readonly number[];

export interface SatelliteManifest {
  generated: string;
  source: string;
  fields: string[];
  featured: Record<string, Elements>;
  groups: Record<string, Elements[]>;
}

export function isSatelliteManifest(v: unknown): v is SatelliteManifest {
  const m = v as Partial<SatelliteManifest> | null;
  return (
    !!m &&
    typeof m.generated === 'string' &&
    !Number.isNaN(Date.parse(m.generated)) &&
    typeof m.featured === 'object' &&
    typeof m.groups === 'object'
  );
}

export function toOmm(e: Elements): OMMJsonObject {
  return {
    OBJECT_NAME: String(e[0]),
    OBJECT_ID: '',
    ELEMENT_SET_NO: 999,
    NORAD_CAT_ID: e[0],
    EPOCH: new Date(e[1] * 1000).toISOString(),
    MEAN_MOTION: e[2],
    ECCENTRICITY: e[3],
    INCLINATION: e[4],
    RA_OF_ASC_NODE: e[5],
    ARG_OF_PERICENTER: e[6],
    MEAN_ANOMALY: e[7],
    BSTAR: e[8],
    MEAN_MOTION_DOT: e[9],
    MEAN_MOTION_DDOT: e[10],
  };
}

/** A satrec, or null for elements SGP4 rejects. */
export function satrecFor(e: Elements): SatRec | null {
  try {
    return json2satrec(toOmm(e));
  } catch {
    return null;
  }
}

/**
 * Orbital period in minutes, by the catalogue convention (1440 / published mean
 * motion). Not from satrec.no, which SGP4 has already "un-Kozai'd" (~0.07% off).
 */
export function periodMinutes(e: Elements): number {
  return 1440 / e[2];
}

/** Earth-fixed position in Earth radii, or null if SGP4 fails (e.g. decayed). */
export function positionAt(rec: SatRec, date: Date, gmst = gstime(date)): Vec3 | null {
  const pv = propagate(rec, date);
  if (!pv) return null;
  const f = eciToEcf(pv.position, gmst);
  return [f.x / EARTH_RADIUS_KM, f.y / EARTH_RADIUS_KM, f.z / EARTH_RADIUS_KM];
}

/**
 * In Earth's shadow? A cylinder of one Earth radius behind the planet: at LEO
 * the umbra/penumbra cones are within a few km of it.
 */
export function inShadow(p: Vec3, sun: Vec3): boolean {
  const s = dot(p, sun);
  return s < 0 && dot(p, p) - s * s < 1;
}

export interface SatState {
  pos: Vec3;
  lat: number;
  lon: number;
  altKm: number;
  /** Inertial speed, km/s. */
  speed: number;
  sunlit: boolean;
}

export function stateAt(rec: SatRec, date: Date, sun: Vec3): SatState | null {
  const pv = propagate(rec, date);
  if (!pv) return null;
  const gmst = gstime(date);
  const f = eciToEcf(pv.position, gmst);
  const geo = eciToGeodetic(pv.position, gmst);
  const pos: Vec3 = [f.x / EARTH_RADIUS_KM, f.y / EARTH_RADIUS_KM, f.z / EARTH_RADIUS_KM];
  const v = pv.velocity;
  return {
    pos,
    lat: (geo.latitude * 180) / Math.PI,
    lon: (geo.longitude * 180) / Math.PI,
    altKm: geo.height,
    speed: Math.hypot(v.x, v.y, v.z),
    sunlit: !inShadow(pos, sun),
  };
}

/** Earth's rotation rate, rad/s (WGS-84). */
export const EARTH_ROTATION = 7.2921159e-5;

/**
 * Fill `out` with xyz per satellite (Earth radii) and, if given, `vel` with
 * the Earth-fixed velocity (Earth radii per second) — enough for the renderer
 * to move each point to the exact time of every frame between SGP4 passes.
 * Failures are written as the origin, which the renderer treats as "no position".
 */
export function propagateAll(recs: readonly (SatRec | null)[], date: Date, out: Float32Array, vel?: Float32Array): number {
  const gmst = gstime(date);
  let ok = 0;
  for (let i = 0; i < recs.length; i++) {
    const rec = recs[i];
    const pv = rec ? propagate(rec, date) : null;
    if (!pv) {
      out.fill(0, i * 3, i * 3 + 3);
      vel?.fill(0, i * 3, i * 3 + 3);
      continue;
    }
    const f = eciToEcf(pv.position, gmst);
    const x = f.x / EARTH_RADIUS_KM;
    const y = f.y / EARTH_RADIUS_KM;
    out[i * 3] = x;
    out[i * 3 + 1] = y;
    out[i * 3 + 2] = f.z / EARTH_RADIUS_KM;
    if (vel) {
      // Rotate the inertial velocity into the Earth-fixed frame, then remove the
      // frame's own rotation: v_ecf = R·v_eci − ω × r.
      const v = eciToEcf(pv.velocity, gmst);
      vel[i * 3] = v.x / EARTH_RADIUS_KM + EARTH_ROTATION * y;
      vel[i * 3 + 1] = v.y / EARTH_RADIUS_KM - EARTH_ROTATION * x;
      vel[i * 3 + 2] = v.z / EARTH_RADIUS_KM;
    }
    ok++;
  }
  return ok;
}

/**
 * Orbit tracks sampled on a fixed time grid, so consecutive frames reuse
 * almost every point: only samples entering the window are propagated.
 * Recomputing ~160 points × 3 satellites every frame was most of the
 * frame's simulation time.
 */
export class TrackCache {
  private readonly samples = new Map<string, Map<number, Vec3 | null>>();
  /** SGP4 calls made so far (cache misses). */
  misses = 0;

  clear() {
    this.samples.clear();
  }

  /**
   * Samples every `stepMin` minutes over [date − before, date + after], plus the
   * exact current position at t = 0 so the line meets the satellite's marker.
   */
  track(key: string, rec: SatRec, date: Date, before: number, after: number, stepMin: number, now: Vec3) {
    const stepMs = stepMin * 60_000;
    const nowMs = date.getTime();
    const k0 = Math.ceil((nowMs - before * 60_000) / stepMs);
    const k1 = Math.floor((nowMs + after * 60_000) / stepMs);
    let cache = this.samples.get(key);
    if (!cache) this.samples.set(key, (cache = new Map()));
    const out: { t: number; pos: Vec3 | null }[] = [];
    let placedNow = false;
    for (let k = k0; k <= k1; k++) {
      const tMs = k * stepMs;
      if (!placedNow && tMs > nowMs) {
        out.push({ t: 0, pos: now });
        placedNow = true;
      }
      let pos = cache.get(k);
      if (pos === undefined) {
        pos = positionAt(rec, new Date(tMs));
        cache.set(k, pos);
        this.misses++;
      }
      out.push({ t: (tMs - nowMs) / 60_000, pos });
    }
    if (!placedNow) out.push({ t: 0, pos: now });
    for (const k of cache.keys()) if (k < k0 - 2 || k > k1 + 2) cache.delete(k);
    return out;
  }
}

/**
 * Positions over the window [date − before, date + after] (minutes), Earth-fixed —
 * so the line is the path over the ground, which drifts west each orbit.
 */
export function orbitTrack(rec: SatRec, date: Date, before: number, after: number, steps: number) {
  const out: { t: number; pos: Vec3 | null }[] = [];
  for (let i = 0; i <= steps; i++) {
    const t = -before + ((before + after) * i) / steps;
    out.push({ t, pos: positionAt(rec, new Date(date.getTime() + t * 60_000)) });
  }
  return out;
}
