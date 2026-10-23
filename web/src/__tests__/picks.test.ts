import { describe, expect, it } from 'vitest';
import type { GdacsEvent, Quake, Storm } from '../hazards';
import { launchState, type Launch } from '../launches';
import { defaults, parseSettings, toQuery } from '../params';
import {
  eventInfo,
  formatPeriod,
  inPolygon,
  launchDetail,
  nearestTarget,
  parsePick,
  pickKey,
  quakeDetail,
  satDetail,
  stormInfo,
  warningInfo,
} from '../picks';
import type { SevereWarning } from '../severe';

const NOW = Date.parse('2026-10-23T12:00:00Z');

describe('pick keys', () => {
  it('splits kind and id at the first colon, so NWS urns keep theirs', () => {
    expect(parsePick('quake:us7000abcd')).toEqual({ kind: 'quake', id: 'us7000abcd' });
    expect(parsePick('warning:urn:oid:2.49.0.1.840.0.abc')).toEqual({ kind: 'warning', id: 'urn:oid:2.49.0.1.840.0.abc' });
    expect(parsePick(pickKey('sat', '44713'))).toEqual({ kind: 'sat', id: '44713' });
  });

  it('rejects empty, unknown and id-less keys', () => {
    expect(parsePick('')).toBeUndefined();
    expect(parsePick('quake:')).toBeUndefined();
    expect(parsePick('ufo:1')).toBeUndefined();
    expect(parsePick('iss')).toBeUndefined();
  });

  it('round-trips through the URL', () => {
    const s = { ...defaults(), pick: 'quake:us7000abcd' };
    expect(toQuery(s)).toContain('pick=quake%3Aus7000abcd');
    expect(parseSettings(toQuery(s)).pick).toBe('quake:us7000abcd');
    expect(toQuery(defaults())).not.toContain('pick');
  });
});

describe('hit testing', () => {
  it('takes the nearest marker whose own reach covers the click', () => {
    const targets = [
      { x: 100, y: 100, reach: 8, key: 'sat:1' },
      { x: 112, y: 100, reach: 14, key: 'storm:a' },
      { x: 300, y: 300, reach: 12, key: 'quake:b' },
    ];
    expect(nearestTarget(targets, 103, 100)?.key).toBe('sat:1');
    // 9 px from the satellite (beyond its 8) but 3 from the storm.
    expect(nearestTarget(targets, 109, 100)?.key).toBe('storm:a');
    expect(nearestTarget(targets, 200, 200)).toBeUndefined();
  });

  it('finds a point inside a polygon, but not in its hole', () => {
    const square: [number, number][] = [
      [-100, 30],
      [-96, 30],
      [-96, 34],
      [-100, 34],
      [-100, 30],
    ];
    const hole: [number, number][] = [
      [-99, 31],
      [-97, 31],
      [-97, 33],
      [-99, 33],
      [-99, 31],
    ];
    expect(inPolygon(-99.5, 30.5, [square])).toBe(true);
    expect(inPolygon(-95, 32, [square])).toBe(false);
    expect(inPolygon(-98, 32, [square, hole])).toBe(false);
    expect(inPolygon(-99.5, 32, [square, hole])).toBe(true);
  });
});

describe('details', () => {
  it('describes a satellite, and offers to follow it', () => {
    // A Starlink: 15.06 rev/day at 53°.
    const elements = [44713, NOW / 1000 - 3 * 3600, 15.06, 0.0001, 53.05, 120, 90, 270, 0.0001, 0, 0];
    const d = satDetail(
      { name: 'Starlink 44713', norad: 44713, group: 'Starlink', color: '#d1e6ff', elements, state: { pos: [1, 0, 0], lat: 12.3, lon: -45.6, altKm: 548.4, speed: 7.594, sunlit: false } },
      NOW,
    );
    expect(d.title).toBe('Starlink 44713');
    expect(d.kind).toBe('Starlink');
    expect(d.status).toEqual({ text: 'IN SHADOW', tone: 'info' });
    expect(d.tiles).toEqual([
      { label: 'Altitude', value: '548 km' },
      { label: 'Speed', value: '7.59 km/s' },
      { label: 'Period', value: '95.6 min' },
      { label: 'Inclination', value: '53.0°' },
    ]);
    expect(d.notes).toEqual(['NORAD 44713 · elements from 3 h ago']);
    expect(d.followable).toBe(true);
  });

  it('gives long periods in hours', () => {
    expect(formatPeriod(1436.4)).toBe('23.94 h');
    expect(formatPeriod(92.68)).toBe('92.7 min');
  });

  it('describes a quake, with its USGS page', () => {
    const q: Quake = { id: 'us7000abcd', mag: 6.24, place: '45 km SE of Sand Point, Alaska', time: NOW - 20 * 60_000, lat: 55, lon: -160, depthKm: 33.4, tsunami: true, alert: 'yellow' };
    const d = quakeDetail(q, NOW);
    expect(d.title).toBe('M6.2 · 45 km SE of Sand Point, Alaska');
    expect(d.tiles).toEqual([
      { label: 'Magnitude', value: 'M6.2' },
      { label: 'Depth', value: '33 km' },
      { label: 'PAGER alert', value: 'Yellow' },
      { label: 'Tsunami', value: 'Flagged' },
    ]);
    expect(d.link?.href).toBe('https://earthquake.usgs.gov/earthquakes/eventpage/us7000abcd');
    expect(d.followable).toBeFalsy();
  });

  it('describes a cyclone from NHC when it has one', () => {
    const st: Storm = {
      id: 'AL142026',
      name: 'Milton',
      source: 'GDACS',
      alert: 'Red',
      pos: [-86, 22],
      cls: 'HU',
      peakWindKmh: 280,
      segments: [],
      nhc: { name: 'Milton', classification: 'MH', windKmh: 260, pressureMb: 915, movementDir: 90, movementKmh: 15, updated: '2026-10-23T09:00:00Z' },
      updated: null,
    };
    const d = stormInfo(st, '#ff4d4d', NOW);
    expect(d.title).toBe('HURRICANE MILTON');
    expect(d.tiles.map((t) => `${t.label} ${t.value}`)).toEqual(['Class MH', 'Wind 260 km/h', 'Pressure 915 hPa', 'Moving E 15 km/h', 'GDACS impact High']);
    expect(d.status?.text).toBe('3 h ago');
  });

  it('describes a GDACS wildfire with its alert in the chip', () => {
    const e: GdacsEvent = { id: 'WF1023', type: 'WF', name: 'Portugal', country: 'Portugal', alert: 'Orange', pos: [-8, 40], from: '2026-10-20T00:00:00Z', to: null, url: 'https://www.gdacs.org/report.aspx?eventid=1023&eventtype=WF', areaHa: 12500 };
    const d = eventInfo(e, NOW);
    expect(d.title).toBe('WILDFIRE · PORTUGAL');
    expect(d.status).toEqual({ text: 'ORANGE', tone: 'warn' });
    expect(d.tiles.map((t) => t.label)).toEqual(['GDACS impact', 'Burned', 'Since']);
    expect(d.link?.text).toBe('GDACS');
  });

  it('describes a warning by its area and threats', () => {
    const w: SevereWarning = {
      id: 'urn:oid:1',
      event: 'Tornado Warning',
      areaDesc: 'Sedgwick, KS; Butler, KS',
      sent: '2026-10-23T11:50:00Z',
      expires: '2026-10-23T12:30:00Z',
      polygons: [],
      tags: ['OBSERVED', 'CONSIDERABLE'],
      extreme: true,
    };
    const d = warningInfo(w, '#ff0000', [-97.3, 37.7], NOW);
    expect(d.kind).toBe('EXTREME');
    expect(d.notes).toEqual(['Sedgwick, KS · Butler, KS']);
    expect(d.tiles).toEqual([
      { label: 'Until', value: '23 Oct 12:30 UTC' },
      { label: 'Threat', value: 'OBSERVED' },
      { label: 'Threat', value: 'CONSIDERABLE' },
    ]);
  });

  it('describes a launch on the pad, followable for its ascent', () => {
    const l: Launch = {
      id: 'abc',
      name: 'Falcon 9 Block 5 | Starlink Group 15-15',
      provider: 'SpaceX',
      rocket: 'Falcon 9 Block 5',
      mission: 'Starlink Group 15-15',
      orbit: 'Low Earth Orbit',
      net: '2026-10-23T14:00:00Z',
      status: { abbrev: 'Go', name: 'Go for Launch' },
      pad: { name: 'SLC-4E', location: 'Vandenberg SFB, CA, USA', lat: 34.632, lon: -120.611 },
      webcastLive: false,
    };
    const d = launchDetail(launchState(l, new Date(NOW)), '#ff9f43');
    expect(d.title).toBe('Falcon 9 · Starlink Group 15-15');
    expect(d.kind).toBe('COUNTDOWN');
    expect(d.tiles[0]).toEqual({ label: 'Clock', value: 'T−02:00:00' });
    expect(d.notes[0]).toBe('SpaceX · SLC-4E');
    expect(d.followable).toBe(true);
  });
});
