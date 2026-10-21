import { describe, expect, it } from 'vitest';
import {
  ALL_LEAVES,
  BULK_LEAVES,
  bulkCatalog,
  bulkSummary,
  findNode,
  leafOn,
  nodeState,
  shortName,
  toggleLabels,
  toggleNode,
  type SatLeaf,
} from '../satcategories';
import type { SatelliteManifest } from '../satellites';

// [norad, epoch, mean motion, …]: just enough for the split by orbit.
const row = (norad: number, n: number) => [norad, 1792544939, n, 0.0001, 0.1, 0, 0, 0, 0, 0, 0];
const MANIFEST: SatelliteManifest = {
  generated: '2026-10-21T22:00:00Z',
  source: 'test',
  fields: [],
  featured: {},
  groups: {
    starlink: [row(44713, 15.06), row(44714, 15.06)],
    weather: [row(60133, 1.0027), row(56756, 2.0064), row(43013, 14.1953), row(54234, 14.1955)],
    'gps-ops': [row(28474, 2.0055)],
    'glo-ops': [row(32275, 2.13)],
  },
  names: {
    weather: { 60133: 'GOES 19', 56756: 'ARKTIKA-M 1', 43013: 'NOAA 20 (JPSS-1)', 54234: 'NOAA 21 (JPSS-2)' },
    'gps-ops': { 28474: 'GPS BIIR-13 (PRN 02)' },
    'glo-ops': { 32275: 'COSMOS 2433 (720)' },
  },
};
const leaf = (key: string) => findNode(key) as SatLeaf;
const ALL = { sats: 'all' as const, satshow: [...ALL_LEAVES] };

describe('satellite categories', () => {
  it('splits the weather group by orbit and keeps one category index per satellite', () => {
    const c = bulkCatalog(MANIFEST);
    expect(c.counts).toEqual({ starlink: 2, 'weather-geo': 1, 'weather-heo': 1, 'weather-leo': 2, gps: 1, glonass: 1 });
    expect(c.elements).toHaveLength(8);
    expect(Array.from(c.category)).toEqual([0, 0, 1, 2, 3, 3, 4, 5]);
    expect(BULK_LEAVES.map((l) => l.key)).toEqual(['starlink', 'weather-geo', 'weather-heo', 'weather-leo', 'gps', 'glonass']);
    expect(c.names.get(60133)).toBe('GOES 19');
    expect(BULK_LEAVES.length).toBeLessThanOrEqual(8); // the GL layer's table size
  });

  it('shortens names for labels', () => {
    expect(shortName('GPS BIIR-13 (PRN 02)')).toBe('GPS PRN 02');
    expect(shortName('COSMOS 2433 (720)')).toBe('GLONASS 720');
    expect(shortName('METEOSAT-12 (MTG-I1)')).toBe('METEOSAT-12');
    expect(shortName('NOAA 20 (JPSS-1)')).toBe('NOAA 20');
    expect(shortName('GOES 19')).toBe('GOES 19');
  });

  it('shows a category only when the mode and the tree both allow it', () => {
    expect(leafOn(leaf('gps'), ALL)).toBe(true);
    expect(leafOn(leaf('gps'), { ...ALL, sats: 'featured' })).toBe(false);
    expect(leafOn(leaf('iss'), { ...ALL, sats: 'featured' })).toBe(true);
    expect(leafOn(leaf('iss'), { ...ALL, sats: 'off' })).toBe(false);
    expect(leafOn(leaf('gps'), { sats: 'all', satshow: ['iss'] })).toBe(false);
  });

  it('marks a branch mixed when only some of it shows', () => {
    const s = { sats: 'all' as const, satshow: ['weather-geo', 'gps', 'glonass'] };
    expect(nodeState(findNode('weather')!, s)).toBe('mixed');
    expect(nodeState(findNode('nav')!, s)).toBe('on');
    expect(nodeState(findNode('comms')!, s)).toBe('off');
    expect(nodeState(findNode('all')!, s)).toBe('mixed');
  });

  it('toggles a branch: off when fully on, else all on', () => {
    const off = toggleNode(findNode('weather')!, ALL);
    expect(off.satshow).not.toContain('weather-geo');
    expect(off.sats).toBe('all');
    const on = toggleNode(findNode('weather')!, { sats: 'all', satshow: ['weather-geo'] });
    expect(on.satshow).toEqual(['weather-geo', 'weather-heo', 'weather-leo']);
    expect(toggleNode(findNode('all')!, ALL)).toEqual({ sats: 'off', satshow: [] });
  });

  it('keeps what was visible when ticking in "named only" mode, rather than reviving everything', () => {
    const next = toggleNode(leaf('starlink'), { sats: 'featured', satshow: [...ALL_LEAVES] });
    expect(next).toEqual({ sats: 'all', satshow: ['iss', 'tiangong', 'satgus', 'starlink'] });
  });

  it('toggles labels per category', () => {
    expect(toggleLabels(leaf('gps'), ['weather-geo'])).toEqual(['weather-geo', 'gps']);
    expect(toggleLabels(leaf('weather-geo'), ['weather-geo'])).toEqual([]);
  });

  it('summarises what is on, weather orbits together', () => {
    const c = bulkCatalog(MANIFEST);
    expect(bulkSummary(c, ALL)).toBe('2 Starlink · 4 weather · 1 GPS · 1 GLONASS');
    expect(bulkSummary(c, { sats: 'all', satshow: ['weather-geo', 'gps'] })).toBe('1 weather · 1 GPS');
    expect(bulkSummary(undefined, ALL)).toBe('');
  });
});
