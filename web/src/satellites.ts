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

/**
 * Fill `out` with xyz per satellite (Earth radii). Failures are written as the
 * origin, which the renderer treats as "no position".
 */
export function propagateAll(recs: readonly (SatRec | null)[], date: Date, out: Float32Array): number {
  const gmst = gstime(date);
  let ok = 0;
  for (let i = 0; i < recs.length; i++) {
    const rec = recs[i];
    const p = rec ? positionAt(rec, date, gmst) : null;
    out[i * 3] = p ? p[0] : 0;
    out[i * 3 + 1] = p ? p[1] : 0;
    out[i * 3 + 2] = p ? p[2] : 0;
    if (p) ok++;
  }
  return ok;
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
