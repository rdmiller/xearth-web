// The Sun and Moon as objects in the sky: where they are, how big they look,
// how the Moon is lit and oriented, and where they fall on screen.
//
// Both are drawn at their true angular size (~0.5°). They sit behind the
// globe, so they're only in frame when the viewer looks roughly toward them
// past the Earth; otherwise the overlay points to them from the screen edge.

import { subsolarPoint, sublunarPoint } from './astronomy';
import { EARTH_RADIUS_KM } from './satellites';
import { applyFrame, starFrame } from './stars';
import { DEG, add, cross, dot, fromLatLon, normalize, scale, sub, toLatLon, type Vec3 } from './vec';
import type { Camera } from './view';

export const SUN_RADIUS_KM = 695_700;
export const MOON_RADIUS_KM = 1_737.4;
/** Mean obliquity of the ecliptic (J2000), for the Moon's approximate pole. */
const OBLIQUITY = 23.4393 * DEG;

export interface SkyBodies {
  /** Unit vector toward the Sun, Earth-fixed. */
  sunDir: Vec3;
  /** Sun's angular radius, radians (~0.267°). */
  sunRadius: number;
  /** Moon's geocentric position, Earth radii, Earth-fixed. */
  moonPos: Vec3;
  moonDistKm: number;
  /** Moon's body frame: x toward Earth (0° selenographic longitude), z ≈ ecliptic north, y east. */
  moonFrame: { x: Vec3; y: Vec3; z: Vec3 };
  /** Fraction of the Moon's disc lit, as seen from Earth (0 new … 1 full). */
  moonLit: number;
}

/** Ecliptic north pole in the Earth-fixed frame (≈ the Moon's spin axis, within ~1.5°). */
export function eclipticNorth(date: Date): Vec3 {
  return normalize(applyFrame(starFrame(date), [0, -Math.sin(OBLIQUITY), Math.cos(OBLIQUITY)]));
}

export function skyBodies(date: Date): SkyBodies {
  const sun = subsolarPoint(date);
  const moon = sublunarPoint(date);
  const sunDir = fromLatLon(sun.lat, sun.lon);
  const moonPos = scale(fromLatLon(moon.lat, moon.lon), moon.distKm / EARTH_RADIUS_KM);

  // Tidally locked: the near side (0° longitude) faces Earth.
  const x = normalize(scale(moonPos, -1));
  const pole = eclipticNorth(date);
  const z = normalize(sub(pole, scale(x, dot(pole, x))));
  const y = cross(z, x);

  // Phase angle at the Moon between the Sun and the Earth; lit fraction (1 + cos i) / 2.
  const cosI = dot(sunDir, x);
  return {
    sunDir,
    sunRadius: Math.asin(SUN_RADIUS_KM / (sun.distKm || 1.496e8)),
    moonPos,
    moonDistKm: moon.distKm,
    moonFrame: { x, y, z },
    moonLit: (1 + cosI) / 2,
  };
}

export interface BodyPlacement {
  /** Screen position, Earth radii from the disc centre (y up), on the sky projection. */
  x: number;
  y: number;
  /** In front of the camera (toward the far side of the globe). */
  ahead: boolean;
  /** Disc radius in the same units as x/y. */
  radius: number;
  /** Unit vector from the eye toward the body, Earth-fixed. */
  dir: Vec3;
  /** Hidden by the Earth's disc. */
  occluded: boolean;
}

/**
 * Where a body appears on the sky projection the stars use (`focal`: sky focal
 * length). `pos` is the body's position in Earth radii — or, for the Sun,
 * a far point along its direction; parallax only matters for the Moon.
 */
export function placeBody(cam: Camera, focal: number, pos: Vec3, angRadius: number): BodyPlacement {
  const eye: Vec3 = cam.dist ? scale(cam.dir, cam.dist) : [0, 0, 0];
  const dir = normalize(sub(pos, eye));
  const z = -dot(dir, cam.dir);
  const ahead = z > 1e-4;
  const x = (focal * dot(dir, cam.right)) / Math.max(Math.abs(z), 1e-4);
  const y = (focal * dot(dir, cam.up)) / Math.max(Math.abs(z), 1e-4);
  const radius = focal * Math.tan(angRadius);
  let occluded = false;
  if (ahead && !cam.dist) {
    // Orthographic: the sky is a backdrop in the same screen units as the disc
    // (radius 1), so anything drawn inside the disc is behind the Earth.
    occluded = Math.hypot(x, y) < 1;
  } else if (ahead) {
    // Perspective: the sight line from the eye meets the globe before the body.
    const b = dot(eye, dir);
    const disc = b * b - (dot(eye, eye) - 1);
    const t = -b - Math.sqrt(Math.max(disc, 0));
    occluded = disc > 0 && t > 0 && t < Math.hypot(...sub(pos, eye));
  }
  return { x, y, ahead, radius, dir, occluded };
}

/** Point on the screen edge (inset px) along the direction from the centre to (x, y). */
export function edgePoint(x: number, y: number, w: number, h: number, inset: number) {
  const angle = Math.atan2(y, x);
  const hw = w / 2 - inset;
  const hh = h / 2 - inset;
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const t = Math.min(hw / Math.max(Math.abs(c), 1e-6), hh / Math.max(Math.abs(s), 1e-6));
  return { x: w / 2 + c * t, y: h / 2 - s * t, angle };
}

/**
 * A viewpoint that puts a body `offsetDeg` off the line of sight, just past the
 * Earth's limb. The viewer stands behind the globe from the body, nudged
 * toward `toward`; the body then appears on that side of the globe — east is
 * screen-right (use in landscape), north is screen-up (use in portrait).
 */
export function framingViewpoint(
  bodyDir: Vec3,
  offsetDeg: number,
  toward: 'east' | 'north' = 'east',
): { lat: number; lon: number } {
  const anti = scale(normalize(bodyDir), -1);
  const north: Vec3 = [0, 0, 1];
  let northT = sub(north, scale(anti, dot(north, anti)));
  if (Math.hypot(...northT) < 1e-6) northT = [1, 0, 0];
  northT = normalize(northT);
  const tilt = toward === 'north' ? northT : cross(northT, anti); // east at the anti-body point
  const o = offsetDeg * DEG;
  return toLatLon(add(scale(anti, Math.cos(o)), scale(tilt, Math.sin(o))));
}
