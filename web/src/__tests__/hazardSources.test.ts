import { describe, expect, it } from 'vitest';
import { ALL_HAZARD_SOURCES, HAZARD_TREE, hazardsOn, hazardState, sourceOn, sourcesKey, stormsFrom, toggleHazard } from '../hazardSources';
import type { Storm } from '../hazards';
import { defaults, parseSettings, toQuery, type Settings } from '../params';

const layer = (key: string) => HAZARD_TREE.find((n) => n.key === key)!;
const source = (key: string) => HAZARD_TREE.flatMap((n) => n.children).find((c) => c.key === key)!;
const apply = (s: Settings, key: string) => ({ ...s, ...toggleHazard(key.includes('.') ? source(key) : layer(key), s) });

describe('hazard tree', () => {
  it('has every source under its own layer, keyed layer.source', () => {
    for (const n of HAZARD_TREE) for (const c of n.children) expect(c.key).toBe(`${n.key}.${c.key.split('.')[1]}`);
    expect(new Set(ALL_HAZARD_SOURCES).size).toBe(ALL_HAZARD_SOURCES.length);
  });

  it('starts with every source of the layers on', () => {
    const s = defaults();
    expect(hazardState(layer('quakes'), s)).toBe('on');
    expect(hazardState(layer('ash'), s)).toBe('off');
    expect(sourceOn('quakes.emsc', s)).toBe(true);
    expect(hazardsOn(s)).toBe(7);
  });

  it('unticking a source leaves the layer mixed; unticking its last switches the layer off', () => {
    let s = apply(defaults(), 'quakes.emsc');
    expect(s.hazoff).toEqual(['quakes.emsc']);
    expect(hazardState(layer('quakes'), s)).toBe('mixed');
    s = apply(s, 'quakes.usgs');
    expect(s.quakes).toBe(false);
    expect(s.hazoff).toEqual([]); // the Q key brings it back whole
  });

  it('ticking a source of a layer that is off switches it on with just that one', () => {
    const s = apply({ ...defaults(), fires: false }, 'fires.mtg');
    expect(s.fires).toBe(true);
    expect(sourceOn('fires.mtg', s)).toBe(true);
    expect(sourceOn('fires.firms', s)).toBe(false);
  });

  it('a mixed layer ticks fully on, then off', () => {
    let s = apply(apply(defaults(), 'severe.spc'), 'tsunami.nws');
    s = apply(s, 'severe');
    expect(hazardState(layer('severe'), s)).toBe('on');
    expect(s.hazoff).toEqual(['tsunami.nws']); // other layers keep their ticks
    s = apply(s, 'severe');
    expect(s.severe).toBe(false);
  });

  it('a single-source layer is a plain switch', () => {
    expect(apply(defaults(), 'ash').ash).toBe(true);
    expect(apply({ ...defaults(), ash: true }, 'ash').ash).toBe(false);
  });

  it('says when a layer or its sources change', () => {
    const s = defaults();
    expect(sourcesKey('quakes', apply(s, 'quakes.emsc'))).not.toBe(sourcesKey('quakes', s));
    expect(sourcesKey('fires', apply(s, 'quakes.emsc'))).toBe(sourcesKey('fires', s));
  });

  it('keeps the unticked sources in the link, dropping unknown keys', () => {
    const s = apply(defaults(), 'lightning.mtg');
    expect(toQuery(s)).toBe('?hazoff=lightning.mtg');
    expect(parseSettings('?hazoff=lightning.mtg,bogus').hazoff).toEqual(['lightning.mtg']);
    expect(toQuery(defaults())).toBe('');
  });
});

describe('cyclones by source', () => {
  const nhc = { name: 'Milton', classification: 'HU', windKmh: 250, pressureMb: 905, movementDir: 90, movementKmh: 15, updated: '' };
  const base: Omit<Storm, 'id'> = { name: 'Milton', source: 'GDACS', alert: 'Red', pos: [-90, 23], cls: 'HU', peakWindKmh: 280, segments: [[0, 0, 1, 1, 'HU', 0]], updated: null };
  const both: Storm = { ...base, id: 'gdacs-1', nhc };
  const gdacsOnly: Storm = { ...base, id: 'gdacs-2' };
  const nhcOnly: Storm = { ...base, id: 'nhc-al01', source: 'NHC', alert: '', cls: '', peakWindKmh: null, segments: [], nhc };
  const all = [both, gdacsOnly, nhcOnly];

  it('keeps them all with both sources', () => {
    expect(stormsFrom(all, true, true)).toEqual(all);
  });

  it('without NHC: GDACS storms, without NHC details', () => {
    expect(stormsFrom(all, true, false).map((s) => [s.id, s.nhc])).toEqual([
      ['gdacs-1', undefined],
      ['gdacs-2', undefined],
    ]);
  });

  it('without GDACS: what NHC has, on its details alone', () => {
    const out = stormsFrom(all, false, true);
    expect(out.map((s) => s.id)).toEqual(['gdacs-1', 'nhc-al01']);
    expect(out[0]).toMatchObject({ source: 'NHC', segments: [], alert: '', peakWindKmh: null, nhc });
  });

  it('neither: none', () => {
    expect(stormsFrom(all, false, false)).toEqual([]);
  });
});
