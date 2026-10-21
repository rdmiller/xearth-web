import { describe, expect, it } from 'vitest';
import { subsolarPoint } from '../astronomy';
import { dot, fromLatLon, type Vec3 } from '../vec';
import { cameraFor, isOccluded, project, viewerLatLon, type ViewSettings } from '../view';

const base: ViewSettings = { view: 'fixed', track: 'iss', lat: 0, lon: 0, period: 1.5, inc: 51.6, rot: 0, dist: 0 };
const date = new Date('2026-10-21T16:00:00Z');

function expectOrthonormal(right: Vec3, up: Vec3, dir: Vec3) {
  expect(dot(right, right)).toBeCloseTo(1, 10);
  expect(dot(up, up)).toBeCloseTo(1, 10);
  expect(dot(right, up)).toBeCloseTo(0, 10);
  expect(dot(right, dir)).toBeCloseTo(0, 10);
  expect(dot(up, dir)).toBeCloseTo(0, 10);
}

describe('cameraFor', () => {
  it('looks down at (0,0) with east to the right and north up', () => {
    const cam = cameraFor(base, date);
    expect(cam.dir[0]).toBeCloseTo(1);
    expect(cam.right[1]).toBeCloseTo(1);
    expect(cam.up[2]).toBeCloseTo(1);
  });

  it('stays orthonormal everywhere, including directly over each pole', () => {
    for (const [lat, lon] of [
      [90, 0],
      [-90, 45],
      [89.9999, 10],
      [37, -122],
      [-60, 170],
    ]) {
      const cam = cameraFor({ ...base, lat, lon }, date);
      expectOrthonormal(cam.right, cam.up, cam.dir);
    }
  });

  it('rotates the image by rot degrees', () => {
    const cam = cameraFor({ ...base, rot: 90 }, date);
    expect(cam.right[2]).toBeCloseTo(1); // north now points right
  });
});

describe('viewerLatLon', () => {
  it('sunrel 0 0 sits over the subsolar point', () => {
    const v = viewerLatLon({ ...base, view: 'sunrel' }, date);
    const s = subsolarPoint(date);
    expect(v.lat).toBeCloseTo(s.lat, 6);
    expect(v.lon).toBeCloseTo(s.lon, 6);
  });

  it('orbit latitude never exceeds the inclination', () => {
    for (let i = 0; i < 50; i++) {
      const v = viewerLatLon({ ...base, view: 'orbit' }, new Date(date.getTime() + i * 517_000));
      expect(Math.abs(v.lat)).toBeLessThanOrEqual(51.6 + 1e-9);
    }
  });
});

describe('track view', () => {
  it('sits over whatever the resolver reports, falling back to lat/lon until data arrives', () => {
    const s = { ...base, view: 'track' as const, track: 'satgus', lat: 5, lon: 6 };
    expect(viewerLatLon(s, date, (key) => (key === 'satgus' ? { lat: -40, lon: 120 } : null))).toEqual({ lat: -40, lon: 120 });
    expect(viewerLatLon(s, date, () => null)).toEqual({ lat: 5, lon: 6 });
    expect(viewerLatLon(s, date)).toEqual({ lat: 5, lon: 6 });
  });
});

describe('isOccluded', () => {
  const sat = (lat: number, lon: number, r = 1.086): Vec3 => {
    const [x, y, z] = fromLatLon(lat, lon);
    return [x * r, y * r, z * r];
  };

  it('orthographic: hides a satellite behind the disc but not one beside it', () => {
    const cam = cameraFor(base, date); // looking at (0, 0)
    expect(isOccluded(cam, sat(0, 0))).toBe(false);
    expect(isOccluded(cam, sat(0, 180))).toBe(true);
    // Just past the limb on the far side, but outside the silhouette (r > 1 in the image plane).
    expect(isOccluded(cam, sat(0, 95))).toBe(false);
  });

  it('perspective: the Earth blocks the line of sight', () => {
    const cam = cameraFor({ ...base, dist: 3 }, date);
    expect(isOccluded(cam, sat(0, 0))).toBe(false);
    expect(isOccluded(cam, sat(0, 180))).toBe(true);
    expect(isOccluded(cam, fromLatLon(0, 30))).toBe(false); // near-side surface point
    expect(isOccluded(cam, fromLatLon(0, 120))).toBe(true); // far-side surface point
  });
});

describe('project', () => {
  it('maps the sub-viewer point to the disc centre and hides the far side', () => {
    const cam = cameraFor({ ...base, lat: 30, lon: 40 }, date);
    const c = project(cam, fromLatLon(30, 40));
    expect(c.x).toBeCloseTo(0);
    expect(c.y).toBeCloseTo(0);
    expect(c.visible).toBe(true);
    expect(project(cam, fromLatLon(-30, -140)).visible).toBe(false);
  });

  it('puts a point east of centre on the right, north of centre above', () => {
    const cam = cameraFor(base, date);
    expect(project(cam, fromLatLon(0, 10)).x).toBeGreaterThan(0);
    expect(project(cam, fromLatLon(10, 0)).y).toBeGreaterThan(0);
  });

  it('in perspective, the limb lands on the unit circle', () => {
    const cam = cameraFor({ ...base, dist: 3 }, date);
    // From 3 radii the visible cap's edge is at angle acos(1/3) from the sub-viewer point.
    const limbAngle = Math.acos(1 / 3) / (Math.PI / 180);
    const p = project(cam, fromLatLon(0, limbAngle - 1e-6));
    expect(Math.hypot(p.x, p.y)).toBeCloseTo(1, 4);
  });
});
