import { describe, expect, it } from 'vitest';
import {
  EARTH_RADIUS_KM,
  FEATURED,
  featuredByKey,
  inShadow,
  isSatelliteManifest,
  orbitTrack,
  periodMinutes,
  positionAt,
  propagateAll,
  satrecFor,
  stateAt,
  toOmm,
  type Elements,
} from '../satellites';
import { fromLatLon, toLatLon, type Vec3 } from '../vec';

// CelesTrak GP elements as the pipeline publishes them (2026-10-21).
// SAT GUS: SATCAT gives period 95.84 min, inclination 97.68°, perigee/apogee 557/561 km.
const SATGUS: Elements = [62713, 1792556458.141, 15.02604421, 0.00031412, 97.684, 14.4051, 60.4357, 299.7181, 0.00062742107, 8.299e-5, 0];
// ISS (ZARYA), from the TLE "26294.04791053 ... 51.6327 37.2623 0006759 289.5321 70.4938 15.48967427".
const ISS: Elements = [25544, 1792544939.47, 15.48967427, 0.0006759, 51.6327, 37.2623, 289.5321, 70.4938, 0.00018188, 9.575e-5, 0];

const epoch = (e: Elements) => new Date(e[1] * 1000);
const sunOver = (lat: number, lon: number): Vec3 => fromLatLon(lat, lon);

describe('featured satellites', () => {
  it('includes Mark Rober’s SAT GUS as its own trackable entry', () => {
    const gus = featuredByKey('satgus');
    expect(gus).toMatchObject({ norad: 62713, name: 'SAT GUS' });
    expect(gus?.detail).toMatch(/Mark Rober/);
    expect(new Set(FEATURED.map((f) => f.key)).size).toBe(FEATURED.length);
  });
});

describe('SGP4 from compact elements', () => {
  it('rebuilds an OMM record satellite.js accepts', () => {
    const omm = toOmm(SATGUS);
    expect(omm.EPOCH).toBe('2026-10-21T04:20:58.141Z');
    expect(omm.NORAD_CAT_ID).toBe(62713);
    expect(satrecFor(SATGUS)).not.toBeNull();
  });

  it('matches the catalogue’s period for SAT GUS (95.84 min)', () => {
    expect(periodMinutes(SATGUS)).toBeCloseTo(95.84, 1);
  });

  it('flies SAT GUS at the catalogue’s 557–561 km, ~7.6 km/s, reaching 82° latitude (sun-synchronous)', () => {
    const rec = satrecFor(SATGUS)!;
    let maxLat = 0;
    for (let m = 0; m < 96; m += 2) {
      const s = stateAt(rec, new Date(epoch(SATGUS).getTime() + m * 60_000), sunOver(0, 0))!;
      // The catalogue measures from the equatorial radius; SGP4's osculating orbit wanders ±~8 km.
      const aboveEquatorialRadius = (Math.hypot(...s.pos) - 1) * EARTH_RADIUS_KM;
      expect(aboveEquatorialRadius).toBeGreaterThan(548);
      expect(aboveEquatorialRadius).toBeLessThan(570);
      // Height above the ellipsoid runs higher near the poles, where the surface is ~21 km lower.
      expect(s.altKm).toBeGreaterThan(548);
      expect(s.altKm).toBeLessThan(592);
      expect(s.speed).toBeGreaterThan(7.5);
      expect(s.speed).toBeLessThan(7.7);
      maxLat = Math.max(maxLat, Math.abs(s.lat));
    }
    expect(maxLat).toBeGreaterThan(80);
    expect(maxLat).toBeLessThan(82.4); // 180° − 97.68°
  });

  it('keeps the ISS near 400–440 km and inside ±51.7°', () => {
    const rec = satrecFor(ISS)!;
    for (let m = 0; m < 93; m += 3) {
      const s = stateAt(rec, new Date(epoch(ISS).getTime() + m * 60_000), sunOver(0, 0))!;
      expect(s.altKm).toBeGreaterThan(400);
      expect(s.altKm).toBeLessThan(440);
      // Geocentric latitude is bounded by the inclination (51.63°); geodetic runs ~0.1° higher.
      expect(Math.abs(toLatLon(s.pos).lat)).toBeLessThan(51.7);
      expect(Math.abs(s.lat)).toBeLessThan(51.85);
    }
  });

  it('positions are Earth-fixed: one orbit later the ground track has moved ~24° west', () => {
    const rec = satrecFor(SATGUS)!;
    const t0 = epoch(SATGUS);
    const a = toLatLon(positionAt(rec, t0)!);
    const b = toLatLon(positionAt(rec, new Date(t0.getTime() + periodMinutes(SATGUS) * 60_000))!);
    expect(Math.abs(b.lat - a.lat)).toBeLessThan(1);
    const dLon = ((b.lon - a.lon + 540) % 360) - 180;
    expect(dLon).toBeLessThan(-22); // 95.84 min × 0.25°/min of Earth rotation
    expect(dLon).toBeGreaterThan(-26);
  });

  it('propagateAll writes the origin for elements SGP4 rejects', () => {
    const bad: Elements = [1, SATGUS[1], 0.5, 0.99, 0, 0, 0, 0, 0, 0, 0]; // decayed-looking orbit
    const recs = [satrecFor(SATGUS), satrecFor(bad), null];
    const out = new Float32Array(9);
    propagateAll(recs, epoch(SATGUS), out);
    expect(Math.hypot(out[0], out[1], out[2])).toBeGreaterThan(1.08);
    expect([out[6], out[7], out[8]]).toEqual([0, 0, 0]);
  });

  it('orbit tracks span the requested window', () => {
    const rec = satrecFor(ISS)!;
    const track = orbitTrack(rec, epoch(ISS), 45, 45, 90);
    expect(track).toHaveLength(91);
    expect(track[0].t).toBe(-45);
    expect(track[45].t).toBe(0);
    expect(track.every((k) => k.pos !== null)).toBe(true);
  });
});

describe('inShadow', () => {
  const sun = sunOver(0, 0);
  it('is dark straight behind the Earth and lit beside or in front of it', () => {
    expect(inShadow([-1.08, 0, 0], sun)).toBe(true);
    expect(inShadow([-0.5, 0, 1.05], sun)).toBe(false); // behind, but outside the cylinder
    expect(inShadow([1.08, 0, 0], sun)).toBe(false);
    expect(inShadow([0, 1.08, 0], sun)).toBe(false); // over the terminator
  });
});

describe('isSatelliteManifest', () => {
  it('accepts the pipeline’s shape and rejects others', () => {
    expect(isSatelliteManifest({ generated: '2026-10-21T17:00:00Z', featured: {}, groups: {} })).toBe(true);
    expect(isSatelliteManifest({ generated: 'nope', featured: {}, groups: {} })).toBe(false);
    expect(isSatelliteManifest(null)).toBe(false);
  });
});
