// Where the Sun and Moon are overhead right now.
//
// astronomy-engine gives geocentric J2000 vectors; rotating them to the
// equator/equinox of date and subtracting Greenwich apparent sidereal time
// turns right ascension into an Earth-fixed longitude.

import {
  Body,
  EquatorFromVector,
  GeoMoon,
  GeoVector,
  KM_PER_AU,
  MakeTime,
  RotateVector,
  Rotation_EQJ_EQD,
  SiderealTime,
  Vector,
} from 'astronomy-engine';
import { fromLatLon, wrapLon, type Vec3 } from './vec';

export interface SubPoint {
  /** Latitude where the body is at the zenith (= its declination), degrees. */
  lat: number;
  /** Longitude where the body is at the zenith, degrees east, [-180, 180). */
  lon: number;
  /** Geocentric distance, km. */
  distKm: number;
}

/** Greenwich apparent sidereal time as an angle, degrees. */
export function gastDeg(date: Date): number {
  return SiderealTime(MakeTime(date)) * 15;
}

/**
 * A J2000 (EQJ) vector in Earth-fixed axes: precess/nutate to the true equator and
 * equinox of date, then turn by −GAST. Units pass through. (Skipping precession
 * would misplace a low orbit by ~40 km in 2026.)
 */
export function j2000ToEarthFixed(v: Vec3, date: Date): Vec3 {
  const time = MakeTime(date);
  const eqd = RotateVector(Rotation_EQJ_EQD(time), new Vector(v[0], v[1], v[2], time));
  const g = (gastDeg(date) * Math.PI) / 180;
  const c = Math.cos(g);
  const s = Math.sin(g);
  return [c * eqd.x + s * eqd.y, -s * eqd.x + c * eqd.y, eqd.z];
}

function subPoint(eqj: Vector, date: Date): SubPoint {
  const time = MakeTime(date);
  const eqd = RotateVector(Rotation_EQJ_EQD(time), eqj);
  const eq = EquatorFromVector(eqd);
  return { lat: eq.dec, lon: wrapLon(eq.ra * 15 - gastDeg(date)), distKm: eq.dist * KM_PER_AU };
}

export function subsolarPoint(date: Date): SubPoint {
  return subPoint(GeoVector(Body.Sun, MakeTime(date), true), date);
}

export function sublunarPoint(date: Date): SubPoint {
  return subPoint(GeoMoon(MakeTime(date)), date);
}

/** Unit vector toward the Sun in the Earth-fixed frame (parallax ~9″, ignored). */
export function sunDirection(date: Date): Vec3 {
  const s = subsolarPoint(date);
  return fromLatLon(s.lat, s.lon);
}
