// Viewing position (xearth's -pos) and the camera derived from it.

import { gastDeg, sublunarPoint, subsolarPoint } from './astronomy';
import { DEG, cross, dot, fromLatLon, normalize, sub, wrapLon, type Vec3 } from './vec';

export type ViewMode = 'fixed' | 'sunrel' | 'orbit' | 'moon';

export interface ViewSettings {
  view: ViewMode;
  /** fixed: viewer lat/lon. sunrel: offset from the subsolar point. */
  lat: number;
  lon: number;
  /** orbit: period in hours and inclination in degrees. */
  period: number;
  inc: number;
  /** Image rotation, degrees counter-clockwise. */
  rot: number;
  /** Viewer distance in Earth radii; 0 = infinitely far (orthographic, like xearth). */
  dist: number;
}

export interface Camera {
  /** Unit vector from Earth's centre toward the viewer. */
  dir: Vec3;
  /** Screen-right and screen-up unit vectors (Earth-fixed frame). */
  right: Vec3;
  up: Vec3;
  /** Viewer distance in Earth radii (0 = orthographic). */
  dist: number;
  /** Perspective focal length chosen so the disc's silhouette has radius 1. */
  focal: number;
}

export function viewerLatLon(s: ViewSettings, date: Date): { lat: number; lon: number } {
  switch (s.view) {
    case 'fixed':
      return { lat: s.lat, lon: wrapLon(s.lon) };
    case 'sunrel': {
      const sun = subsolarPoint(date);
      return { lat: Math.max(-90, Math.min(90, sun.lat + s.lat)), lon: wrapLon(sun.lon + s.lon) };
    }
    case 'moon': {
      const moon = sublunarPoint(date);
      return { lat: moon.lat, lon: moon.lon };
    }
    case 'orbit': {
      // A circular orbit fixed in inertial space; Earth turns beneath it, so the
      // ground track drifts west like a real satellite's.
      const phase = ((date.getTime() / 3_600_000) / Math.max(s.period, 1e-3)) * 2 * Math.PI;
      const inc = s.inc * DEG;
      const x = Math.cos(phase);
      const y = Math.sin(phase) * Math.cos(inc);
      const z = Math.sin(phase) * Math.sin(inc);
      const ra = Math.atan2(y, x) / DEG;
      return { lat: Math.asin(z) / DEG, lon: wrapLon(ra - gastDeg(date)) };
    }
  }
}

export function cameraFor(s: ViewSettings, date: Date): Camera {
  const { lat, lon } = viewerLatLon(s, date);
  const dir = fromLatLon(lat, lon);
  // Screen-up is north projected onto the image plane. Directly over a pole
  // that's undefined, so use the limit approached along the viewer's meridian.
  const north: Vec3 = [0, 0, 1];
  let up = sub(north, [dir[0] * dir[2], dir[1] * dir[2], dir[2] * dir[2]]);
  if (Math.hypot(...up) < 1e-6) {
    const l = lon * DEG;
    const sign = dir[2] > 0 ? -1 : 1;
    up = [sign * Math.cos(l), sign * Math.sin(l), 0];
  }
  up = normalize(up);
  let right = cross(up, dir); // east, when looking down at the surface
  if (s.rot) {
    const c = Math.cos(s.rot * DEG);
    const r = Math.sin(s.rot * DEG);
    const right2: Vec3 = [c * right[0] + r * up[0], c * right[1] + r * up[1], c * right[2] + r * up[2]];
    up = [-r * right[0] + c * up[0], -r * right[1] + c * up[1], -r * right[2] + c * up[2]];
    right = right2;
  }
  const dist = s.dist > 1.0001 ? s.dist : 0;
  const focal = dist ? 1 / Math.tan(Math.asin(1 / dist)) : 1;
  return { dir, right, up, dist, focal };
}

/**
 * Orthographic views have no real field of view, so the star layer borrows
 * one: the shorter screen side spans ~30° at mag 1 (the disc is drawn 0.9 of
 * that side, so its half-width is 1/0.9 Earth radii). Perspective views use
 * the true focal length, which keeps the stars and the globe consistent.
 */
export const ORTHO_SKY_FOCAL = 1 / 0.9 / Math.tan(15 * DEG);

export function skyFocal(cam: Camera): number {
  return cam.dist ? cam.focal : ORTHO_SKY_FOCAL;
}

/**
 * Project a point on the unit sphere to screen units (Earth radii, y up, disc
 * centred at the origin). `visible` is false on the far side.
 */
export function project(cam: Camera, p: Vec3): { x: number; y: number; visible: boolean } {
  if (!cam.dist) {
    return { x: dot(p, cam.right), y: dot(p, cam.up), visible: dot(p, cam.dir) > 0 };
  }
  const eye: Vec3 = [cam.dir[0] * cam.dist, cam.dir[1] * cam.dist, cam.dir[2] * cam.dist];
  const v = sub(p, eye);
  const depth = -dot(v, cam.dir);
  return {
    x: (cam.focal * dot(v, cam.right)) / depth,
    y: (cam.focal * dot(v, cam.up)) / depth,
    visible: dot(p, eye) > 1, // the surface faces the eye
  };
}
