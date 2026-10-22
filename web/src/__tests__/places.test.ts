import { describe, expect, it } from 'vitest';
import { decodeGeocoder, formatCoordinates, glideAt, glideMs, mergePlaces, parseCoordinates, searchCities } from '../places';
import { cameraFor, pinchMag, project, unproject } from '../view';
import { defaults } from '../params';
import { fromLatLon } from '../vec';

describe('parseCoordinates', () => {
  it.each([
    ['40.71, -74.01', 40.71, -74.01],
    ['40.71 -74.01', 40.71, -74.01],
    ['40.71N 74.01W', 40.71, -74.01],
    ['40.71° N, 74.01° W', 40.71, -74.01],
    ['74.01W 40.71N', 40.71, -74.01],
    ['-33.87; 151.21', -33.87, 151.21],
    ['33°52′S 151°12′E', -(33 + 52 / 60), 151.2],
    [`40°42'51"N 74°0'21"W`, 40 + 42 / 60 + 51 / 3600, -(74 + 21 / 3600)],
  ])('%s', (text, lat, lon) => {
    const c = parseCoordinates(text)!;
    expect(c.lat).toBeCloseTo(lat, 6);
    expect(c.lon).toBeCloseTo(lon, 6);
  });

  it('rejects names and impossible values', () => {
    expect(parseCoordinates('Sioux Falls')).toBeNull();
    expect(parseCoordinates('95, 10')).toBeNull();
    expect(parseCoordinates('10, 190')).toBeNull();
    expect(parseCoordinates('40N 74N')).toBeNull();
    expect(parseCoordinates('40°75′N 74W')).toBeNull();
    expect(parseCoordinates('12')).toBeNull();
  });

  it('formats for labels', () => {
    expect(formatCoordinates(-33.868, 151.209)).toBe('33.87°S 151.21°E');
  });
});

describe('place lookup', () => {
  it('finds the app\'s own cities first, ignoring accents and case', () => {
    expect(searchCities('sao').map((p) => p.name)).toEqual(['São Paulo']);
    expect(searchCities('york')[0]).toMatchObject({ name: 'New York', lat: 40.71 });
    expect(searchCities('a')).toEqual([]);
  });

  it('reads Open-Meteo results with region, country and kind', () => {
    const json = {
      results: [
        { name: 'Sioux Falls', latitude: 43.54369, longitude: -96.72796, admin1: 'South Dakota', country: 'United States', feature_code: 'PPLA2' },
        { name: 'Mount Everest', latitude: 27.98806, longitude: 86.92528, admin1: 'Province 1', country: 'Nepal', feature_code: 'MT' },
      ],
    };
    expect(decodeGeocoder(json)).toEqual([
      { name: 'Sioux Falls', detail: 'South Dakota, United States', lat: 43.54369, lon: -96.72796 },
      { name: 'Mount Everest', detail: 'Mountain · Province 1, Nepal', lat: 27.98806, lon: 86.92528 },
    ]);
    expect(decodeGeocoder({})).toEqual([]);
  });

  it('drops geocoder duplicates of a local city', () => {
    const local = searchCities('Lima');
    const remote = [
      { name: 'Lima', detail: 'Lima, Peru', lat: -12.04318, lon: -77.02824 },
      { name: 'Lima', detail: 'Ohio, United States', lat: 40.74255, lon: -84.10523 },
    ];
    expect(mergePlaces(local, remote).map((p) => p.detail)).toEqual(['City', 'Ohio, United States']);
  });
});

describe('glide', () => {
  it('follows the great circle and ends exactly on target', () => {
    const from = { lat: 40.71, lon: -74.01 };
    const to = { lat: 51.51, lon: -0.13 };
    expect(glideAt(from, to, 0).lat).toBeCloseTo(40.71, 6);
    const end = glideAt(from, to, 1);
    expect(end.lat).toBeCloseTo(51.51, 6);
    expect(end.lon).toBeCloseTo(-0.13, 6);
    // The great circle from New York to London bows north of both.
    expect(glideAt(from, to, 0.5).lat).toBeGreaterThan(51.51);
  });

  it('handles the antipode and takes longer for longer trips', () => {
    const end = glideAt({ lat: 10, lon: 20 }, { lat: -10, lon: -160 }, 1);
    expect(end.lat).toBeCloseTo(-10, 4);
    expect(end.lon).toBeCloseTo(-160, 4);
    expect(glideMs(fromLatLon(0, 0), fromLatLon(0, 10))).toBeLessThan(glideMs(fromLatLon(0, 0), fromLatLon(0, 170)));
  });
});

describe('unproject', () => {
  it.each([0, 3])('inverts project on the visible disc (dist %s)', (dist) => {
    const cam = cameraFor({ ...defaults(), view: 'fixed', lat: 30, lon: -60, rot: 25, dist }, new Date('2026-10-21T22:00:00Z'));
    for (const [lat, lon] of [
      [30, -60],
      [45, -40],
      [10, -80],
    ]) {
      const p = fromLatLon(lat, lon);
      const q = project(cam, p);
      const back = unproject(cam, q.x, q.y)!;
      expect(Math.hypot(back[0] - p[0], back[1] - p[1], back[2] - p[2])).toBeLessThan(1e-9);
    }
    expect(unproject(cam, 2, 2)).toBeNull();
  });
});

describe('pinch zoom', () => {
  it('scales the starting zoom by how far the fingers spread, within limits', () => {
    expect(pinchMag(2, 100, 200, 0.2, 50)).toBe(4);
    expect(pinchMag(2, 100, 50, 0.2, 50)).toBe(1);
    expect(pinchMag(40, 100, 400, 0.2, 50)).toBe(50);
    expect(pinchMag(1, 0, 10, 0.2, 50)).toBe(10); // a zero starting spread doesn't divide by zero
  });
});
