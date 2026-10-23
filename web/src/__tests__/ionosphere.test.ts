import { describe, expect, it } from 'vitest';
import drapText from './fixtures/drap-2026-10-23.txt?raw';
import {
  DRAP_FULL,
  drapGrid,
  drapSummary,
  GRID_H,
  GRID_W,
  isTecManifest,
  parseDrap,
  sampleGrid,
  TEC_FULL,
  tecGrid,
  tecSummary,
  type TecManifest,
} from '../ionosphere';
import { HOTKEYS } from '../hotkeys';
import { defaults, parseSettings, toQuery, type Settings } from '../params';

const TEC: TecManifest = {
  generated: '2026-10-23T02:50:00Z',
  source: 'NOAA SWPC GloTEC',
  time: '2026-10-23T01:55:00Z',
  tecMax: 80,
  lon0: -135,
  lat0: 45,
  dlon: 90,
  dlat: -90,
  nlon: 4,
  nlat: 2,
  // Tenths of a TECU, north row first: 10, 20, 30, 40 TECU along 45°N, then 80 everywhere at 45°S.
  tec: [100, 200, 300, 400, 800, 800, 800, null],
  anomaly: [0, 0, 0, 0, 0, 0, 0, 0],
};

describe('D-RAP (SWPC, 2026-10-23)', () => {
  const d = parseDrap(drapText)!;

  it('reads the 4° × 2° table and its header', () => {
    expect(d.lons).toHaveLength(90);
    expect([d.lons[0], d.lons[89]]).toEqual([-178, 178]);
    expect([d.lats[0], d.lats[d.lats.length - 1]]).toEqual([89, -89]);
    expect(d.mhz).toHaveLength(d.lons.length * d.lats.length);
    expect(d.valid).toBe('2026-10-23T02:16:00Z');
    expect(d.xray).toBe('Normal X-ray Background');
    expect(d.proton).toBe('Normal Proton Background');
    expect(d.max).toBeGreaterThan(0);
  });

  it('says what’s absorbed and only names a driver when it isn’t normal', () => {
    expect(drapSummary(d)).toMatch(/^HF absorbed up to \d+\.\d MHz · quiet · 02:16 UTC$/);
    expect(drapSummary({ ...d, xray: 'X-ray flux is above M1', max: 18.4 })).toBe('HF absorbed up to 18.4 MHz · X-ray flux is above M1 · 02:16 UTC');
  });

  it('puts it on the aurora’s 1° grid as bytes of 35 MHz', () => {
    const g = drapGrid(d);
    expect(g).toHaveLength(GRID_W * GRID_H);
    // 89°N, 178°W is the table's own first value.
    expect(g[1 * GRID_W + 2]).toBe(Math.round((d.mhz[0] / DRAP_FULL) * 255));
    // Under the Sun (9°S, 146°E) it peaked at 3.4 MHz; the night side had none.
    expect(g[(90 + 9) * GRID_W + (146 + 180)]).toBe(Math.round((3.4 / DRAP_FULL) * 255));
    expect(g[(90 - 9) * GRID_W + (-34 + 180)]).toBe(0);
  });

  it('rejects something that isn’t the table', () => {
    expect(parseDrap('<html>Service unavailable</html>')).toBeNull();
  });
});

describe('GloTEC grid (pipeline)', () => {
  it('recognises the manifest', () => {
    expect(isTecManifest(TEC)).toBe(true);
    expect(isTecManifest({ ...TEC, tec: [1, 2] })).toBe(false);
  });

  it('samples bilinearly, wrapping round the date line', () => {
    expect(sampleGrid(TEC.tec, TEC, -135, 45)).toBe(100);
    expect(sampleGrid(TEC.tec, TEC, -90, 45)).toBe(150);
    // Halfway from 135°E round to 135°W: between 400 and 100.
    expect(sampleGrid(TEC.tec, TEC, 180, 45)).toBe(250);
    // North of the grid takes its edge row; a null counts as nothing.
    expect(sampleGrid(TEC.tec, TEC, -135, 80)).toBe(100);
    expect(sampleGrid(TEC.tec, TEC, 135, -45)).toBe(0);
  });

  it('maps TEC to bytes of 120 TECU, and summarises the range', () => {
    const g = tecGrid(TEC);
    expect(g[(90 - 45) * GRID_W + (-135 + 180)]).toBe(Math.round((10 / TEC_FULL) * 255));
    expect(tecSummary(TEC)).toBe('TEC 10–80 TECU · 01:55 UTC');
  });
});

describe('ionosphere setting', () => {
  it('is off by default and reads tec / drap', () => {
    expect(parseSettings('').iono).toBe('off');
    expect(parseSettings('?iono=drap').iono).toBe('drap');
    expect(parseSettings('?iono=1').iono).toBe('tec');
    expect(parseSettings('?iono=0').iono).toBe('off');
    expect(toQuery({ ...defaults(), iono: 'tec' })).toBe('?iono=tec');
  });

  it('Shift+I cycles electron content → HF absorption → off', () => {
    let s: Settings = defaults();
    const key = HOTKEYS.find((h) => h.keys.includes('shift+i'))!;
    const ctx = { settings: s, update: (p: Partial<Settings>) => (s = ctx.settings = { ...s, ...p }), toast: () => undefined };
    const seen = [1, 2, 3].map(() => (key.run(ctx as never, {} as KeyboardEvent), s.iono));
    expect(seen).toEqual(['tec', 'drap', 'off']);
  });
});
