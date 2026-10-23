import { describe, expect, it } from 'vitest';
import fdsn from './fixtures/emsc-fdsn-2026-10-23.json';
import { backoffMs, EmscQuakes, emscQuake, emscQueryUrl, isEmscFeed, mergeQuakes, regionName, type EmscFeature } from '../emsc';
import type { Quake } from '../hazards';

const now = Date.parse('2026-10-23T19:15:00Z');
const features = (fdsn as { features: EmscFeature[] }).features;

describe('EMSC’s day', () => {
  it('reads FDSN GeoJSON', () => {
    expect(isEmscFeed(fdsn)).toBe(true);
    expect(isEmscFeed({ features: [{ properties: {} }] })).toBe(false);
  });

  it('keeps M2.5+ earthquakes in Europe and the Mediterranean, and nothing else', () => {
    const kept = features.map((f) => emscQuake(f, now)).filter((q): q is Quake => !!q);
    expect(kept).toHaveLength(12); // of 25: small ones, unconfirmed events and quakes elsewhere go
    const sicily = kept.find((q) => q.id === '20261023_0000322')!;
    expect(sicily).toMatchObject({ mag: 2.5, place: 'Sicily, Italy', source: 'EMSC', tsunami: false, alert: null });
    expect(sicily.time).toBe(Date.parse('2026-10-23T17:52:17.45Z'));
  });

  it('drops a quake more than a day old', () => {
    const f = features[0];
    expect(emscQuake(f, Date.parse(f.properties.time) + 86_400_001)).toBeNull();
  });

  it('writes region names as names', () => {
    expect(regionName('WESTERN TURKEY')).toBe('Western Turkey');
    expect(regionName('SICILY, ITALY')).toBe('Sicily, Italy');
    expect(regionName('CRETE, GREECE')).toBe('Crete, Greece');
    expect(regionName('STRAIT OF GIBRALTAR')).toBe('Strait of Gibraltar');
    expect(regionName('NEAR COAST OF WESTERN TURKEY')).toBe('Near Coast of Western Turkey');
  });

  it('asks FDSN for the last day, M2.5+, in the region', () => {
    const u = new URL(emscQueryUrl(now));
    expect(u.origin + u.pathname).toBe('https://www.seismicportal.eu/fdsnws/event/1/query');
    expect(u.searchParams.get('starttime')).toBe('2026-10-22T19:15:00');
    expect([u.searchParams.get('minmag'), u.searchParams.get('minlat'), u.searchParams.get('maxlat'), u.searchParams.get('minlon'), u.searchParams.get('maxlon')]).toEqual([
      '2.5',
      '25',
      '72',
      '-30',
      '50',
    ]);
  });
});

const quake = (id: string, mag: number, time: string, lat: number, lon: number, source?: 'EMSC'): Quake => ({
  id,
  mag,
  place: '',
  time: Date.parse(time),
  lat,
  lon,
  depthKm: 10,
  tsunami: false,
  alert: null,
  source,
});

describe('USGS and EMSC together', () => {
  it('shows a quake both have once, as USGS’s, and keeps EMSC’s others', () => {
    // USGS and EMSC located this one 3 s and ~11 km apart (as on 2026-10-23).
    const usgs = [quake('us7000abcd', 4.4, '2026-10-23T10:00:00Z', 38.1, 22.4)];
    const emsc = [quake('20261023_1', 4.3, '2026-10-23T10:00:03Z', 38.2, 22.4, 'EMSC'), quake('20261023_2', 2.7, '2026-10-23T11:00:00Z', 37.5, 15.0, 'EMSC')];
    expect(mergeQuakes(usgs, emsc).map((q) => q.id)).toEqual(['us7000abcd', '20261023_2']);
  });

  it('keeps two quakes apart in time or place', () => {
    const usgs = [quake('us1', 3.0, '2026-10-23T10:00:00Z', 38.0, 22.0)];
    const later = quake('e1', 3.0, '2026-10-23T10:02:00Z', 38.0, 22.0, 'EMSC');
    const farther = quake('e2', 3.0, '2026-10-23T10:00:00Z', 40.0, 22.0, 'EMSC');
    expect(mergeQuakes(usgs, [later, farther])).toHaveLength(3);
  });
});

describe('the push feed', () => {
  it('adds a pushed quake, revises it, and drops it when it falls below M2.5', () => {
    const day = new EmscQuakes();
    day.setDay(features, now);
    expect(day.list(now)).toHaveLength(12);
    const f: EmscFeature = { properties: { unid: 'new', time: '2026-10-23T19:10:00Z', lat: 37.9, lon: 14.9, depth: 8, mag: 3.1, evtype: 'ke', flynn_region: 'SICILY, ITALY' } };
    expect(day.upsert(f, now)).toBe(true);
    expect(day.list(now)).toHaveLength(13);
    expect(day.upsert({ properties: { ...f.properties, mag: 3.4 } }, now)).toBe(true);
    expect(day.list(now).find((q) => q.id === 'new')?.mag).toBe(3.4);
    expect(day.upsert({ properties: { ...f.properties, mag: 2.2 } }, now)).toBe(true); // revised down: gone
    expect(day.list(now)).toHaveLength(12);
    expect(day.upsert({ properties: { ...f.properties, unid: 'small', mag: 1.1 } }, now)).toBe(false); // never shown: no change
  });

  it('waits longer after each drop, up to a minute', () => {
    expect([0, 1, 2, 3, 4, 10].map(backoffMs)).toEqual([5_000, 10_000, 20_000, 40_000, 60_000, 60_000]);
  });
});
