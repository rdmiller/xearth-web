import { Body, Illumination, MakeTime } from 'astronomy-engine';
import { describe, expect, it } from 'vitest';
import { eclipticNorth, edgePoint, framingViewpoint, placeBody, skyBodies } from '../bodies';
import { DEG, dot, fromLatLon, scale } from '../vec';
import { cameraFor, ORTHO_SKY_FOCAL, type ViewSettings } from '../view';

const date = new Date('2026-10-21T17:00:00Z');
const base: ViewSettings = { view: 'fixed', track: 'iss', lat: 0, lon: 0, period: 1.5, inc: 51.6, rot: 0, dist: 0 };

describe('skyBodies', () => {
  it('matches astronomy-engine’s Moon phase across a lunation', () => {
    for (let d = 0; d < 30; d += 3) {
      const t = new Date(date.getTime() + d * 86_400_000);
      const ours = skyBodies(t).moonLit;
      const theirs = Illumination(Body.Moon, MakeTime(t)).phase_fraction;
      expect(Math.abs(ours - theirs), t.toISOString()).toBeLessThan(0.01);
    }
  });

  it('sizes the Sun and Moon at about half a degree', () => {
    const b = skyBodies(date);
    expect(b.sunRadius / DEG).toBeGreaterThan(0.26);
    expect(b.sunRadius / DEG).toBeLessThan(0.273);
    expect(b.moonDistKm).toBeGreaterThan(355_000);
    expect(b.moonDistKm).toBeLessThan(407_500);
  });

  it('turns the Moon’s near side to Earth with a right-handed frame', () => {
    const { moonFrame: f, moonPos } = skyBodies(date);
    const toEarth = scale(moonPos, -1 / Math.hypot(...moonPos));
    expect(dot(f.x, toEarth)).toBeCloseTo(1, 6);
    expect(dot(f.x, f.z)).toBeCloseTo(0, 6);
    // y = z × x: east, as for the Earth's own (x, y, z) frame.
    expect(dot(f.y, [f.z[1] * f.x[2] - f.z[2] * f.x[1], f.z[2] * f.x[0] - f.z[0] * f.x[2], f.z[0] * f.x[1] - f.z[1] * f.x[0]])).toBeCloseTo(1, 6);
  });

  it('tilts the ecliptic pole 23.4° from the Earth’s axis', () => {
    const tilt = Math.acos(eclipticNorth(date)[2]) / DEG;
    expect(tilt).toBeCloseTo(23.44, 1);
  });
});

describe('placeBody', () => {
  it('hides a body straight behind the globe and shows one beside it (orthographic)', () => {
    const cam = cameraFor(base, date); // looking at (0, 0), so "behind" is toward (0, 180)
    const behind = placeBody(cam, ORTHO_SKY_FOCAL, scale(fromLatLon(0, 180), 1e6), 0.0046);
    expect(behind.ahead).toBe(true);
    expect(behind.occluded).toBe(true);
    expect(Math.hypot(behind.x, behind.y)).toBeLessThan(1e-6);
    const beside = placeBody(cam, ORTHO_SKY_FOCAL, scale(fromLatLon(0, 180 - 20), 1e6), 0.0046);
    expect(beside.occluded).toBe(false);
    expect(beside.radius).toBeCloseTo(ORTHO_SKY_FOCAL * Math.tan(0.0046), 9);
  });

  it('reports bodies behind the camera as not ahead (they get an edge marker instead)', () => {
    const cam = cameraFor(base, date);
    expect(placeBody(cam, ORTHO_SKY_FOCAL, scale(fromLatLon(0, 0), 1e6), 0.0046).ahead).toBe(false);
  });

  it('perspective: the globe hides what the sight line passes through', () => {
    const cam = cameraFor({ ...base, dist: 3 }, date);
    const p = placeBody(cam, cam.focal, scale(fromLatLon(0, 180), 60), 0.0045);
    expect(p.occluded).toBe(true);
  });
});

describe('framingViewpoint', () => {
  const sun = fromLatLon(-10.9, -98.4);
  const offset = (Math.atan(1.35 / ORTHO_SKY_FOCAL) * 180) / Math.PI;

  for (const toward of ['east', 'north'] as const) {
    it(`puts the body ~1.35 disc radii off-centre, toward the ${toward === 'east' ? 'right' : 'top'}`, () => {
      const v = framingViewpoint(sun, offset, toward);
      const cam = cameraFor({ ...base, lat: v.lat, lon: v.lon }, date);
      const p = placeBody(cam, ORTHO_SKY_FOCAL, scale(sun, 1e6), 0.0046);
      expect(p.ahead).toBe(true);
      expect(p.occluded).toBe(false);
      expect(Math.hypot(p.x, p.y)).toBeCloseTo(1.35, 2);
      if (toward === 'east') {
        expect(p.x).toBeGreaterThan(1.3);
        // Stepping "east" follows a great circle, which drifts off the local parallel
        // away from the equator, so the body sits a little above or below the axis.
        expect(Math.abs(p.y)).toBeLessThan(0.15);
      } else {
        expect(p.y).toBeGreaterThan(1.3);
        expect(Math.abs(p.x)).toBeLessThan(0.05);
      }
    });
  }
});

describe('edgePoint', () => {
  it('lands inside the inset frame in the body’s direction', () => {
    for (const [x, y] of [
      [5, 0],
      [-5, 0.1],
      [0.2, 9],
      [-3, -3],
    ] as [number, number][]) {
      const e = edgePoint(x, y, 1200, 700, 26);
      expect(e.x).toBeGreaterThanOrEqual(26 - 1e-9);
      expect(e.x).toBeLessThanOrEqual(1200 - 26 + 1e-9);
      expect(e.y).toBeGreaterThanOrEqual(26 - 1e-9);
      expect(e.y).toBeLessThanOrEqual(700 - 26 + 1e-9);
      expect(Math.sign(e.x - 600)).toBe(Math.sign(x));
      expect(Math.sign(350 - e.y)).toBe(Math.sign(y));
    }
  });
});
