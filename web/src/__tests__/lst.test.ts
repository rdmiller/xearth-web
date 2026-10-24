import { describe, expect, it, vi } from 'vitest';
import lstXml from './fixtures/gibs-lst-colormap-2026-10-24.xml?raw';
import {
  composite,
  encodeLst,
  fillOrder,
  hottest,
  LST_SATS,
  LstLoader,
  lstDates,
  lstLayer,
  lstSides,
  lstSummary,
  lstValue,
} from '../lst';
import { SST_H, SST_W } from '../sst';

/** Each data entry of GIBS's LST colour map: its colour and its bin's middle in K (open ends half a bin out). */
function entries(xml: string): { rgb: [number, number, number]; midK: number }[] {
  const rows = [...xml.matchAll(/<ColorMapEntry rgb="(\d+),(\d+),(\d+)" transparent="false" sourceValue="[^"]*" value="\[([\d.]+),([\d.]+)\)"/g)];
  return rows.map(([, r, g, b, lo, hi], i) => ({
    rgb: [+r, +g, +b],
    midK: i === 0 ? Number(hi) - 0.3 : i === rows.length - 1 ? Number(rows[i - 1][5]) + 0.3 : (Number(lo) + Number(hi)) / 2,
  }));
}

describe('GIBS’s land surface temperature colours', () => {
  it('reads every colour back to its bin, 200–350 K in 0.6 K steps, in °C', () => {
    const e = entries(lstXml);
    expect(e).toHaveLength(252);
    for (const { rgb, midK } of e.slice(0, -1)) expect(lstValue(...rgb)).toBeCloseTo(midK - 273.15, 4);
    expect(lstValue(201, 0, 255)).toBeCloseTo(-73.45, 4);
    expect(lstValue(255, 4, 0)).toBeCloseTo(76.55, 4);
  });

  it('takes the open top bin (350 K or more: bad retrievals) as no data', () => {
    expect(entries(lstXml).at(-1)!.rgb).toEqual([255, 1, 0]);
    expect(lstValue(255, 1, 0)).toBeNaN();
  });

  it('names every MODIS and VIIRS layer the same way', () => {
    expect(LST_SATS.map((s) => lstLayer(s, 'day'))).toEqual([
      'VIIRS_NOAA20_Land_Surface_Temp_Day',
      'VIIRS_NOAA21_Land_Surface_Temp_Day',
      'VIIRS_SNPP_Land_Surface_Temp_Day',
      'MODIS_Aqua_Land_Surface_Temp_Day',
      'MODIS_Terra_Land_Surface_Temp_Day',
    ]);
    expect(lstLayer(LST_SATS[4], 'night')).toBe('MODIS_Terra_Land_Surface_Temp_Night');
  });
});

describe('filling the gaps', () => {
  it('takes today and yesterday (UTC)', () => {
    expect(lstDates(new Date('2026-11-01T00:30:00Z'))).toEqual(['2026-11-01', '2026-10-31']);
  });

  it('fills from VIIRS on both days before MODIS', () => {
    const order = fillOrder(['2026-10-24', '2026-10-23']).map(({ sat, date }) => `${sat.name} ${date.slice(8)}`);
    expect(order).toEqual([
      'NOAA-20 24', 'NOAA-21 24', 'Suomi NPP 24',
      'NOAA-20 23', 'NOAA-21 23', 'Suomi NPP 23',
      'Aqua 24', 'Terra 24', 'Aqua 23', 'Terra 23',
    ]);
  });

  it('takes each texel from the first field that has it', () => {
    const f = (...v: number[]) => new Float32Array(v);
    const out = composite([f(1, NaN, NaN, NaN), undefined, f(2, 2, NaN, NaN), f(3, 3, 3, NaN)], 4);
    expect(Array.from(out.slice(0, 3))).toEqual([1, 2, 3]);
    expect(out[3]).toBeNaN();
  });

  it('draws the afternoon’s and the night’s as the mode asks', () => {
    expect(lstSides('auto')).toEqual(['day', 'night']);
    expect(lstSides('night')).toEqual(['night']);
    expect(lstSides('off')).toEqual([]);
  });
});

describe('the texture', () => {
  it('packs the afternoon in r over b and the night in g over a (−80…80 °C), all zero where unseen', () => {
    const rgba = encodeLst(new Float32Array([-80, 0, 80, NaN]), new Float32Array([NaN, 80, -80, NaN]), 4);
    expect(Array.from(rgba)).toEqual([0, 0, 255, 0, 128, 255, 255, 255, 255, 0, 255, 255, 0, 0, 0, 0]);
    expect(Array.from(encodeLst(new Float32Array([0]), undefined, 1))).toEqual([128, 0, 255, 0]);
  });

  /** A field of `base` over a 5 × 5 patch centred on (y, x), NaN elsewhere. */
  function patch(y: number, x: number, base: number): Float32Array {
    const f = new Float32Array(SST_W * SST_H).fill(NaN);
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) f[(y + dy) * SST_W + ((x + dx + SST_W) % SST_W)] = base;
    return f;
  }

  it('finds the hottest place by a block’s median, and where it is on the 0.25° grid', () => {
    const f = patch(240, 950, 50);
    f[240 * SST_W + 950] = 64; // 29.875°N, 57.625°E
    f[239 * SST_W + 950] = 66;
    f[241 * SST_W + 950] = 62;
    f[240 * SST_W + 951] = 61;
    f[240 * SST_W + 949] = 63;
    expect(hottest(f)).toEqual({ c: 61, lat: 29.875, lon: 57.625 });
    expect(hottest(new Float32Array(SST_W * SST_H).fill(NaN))).toBeUndefined();
  });

  it('ignores a lone bad texel, and a block mostly unseen', () => {
    const f = patch(240, 950, 30);
    f[240 * SST_W + 950] = 76; // a spike: the block's median stays 30
    f[100 * SST_W + 100] = 70; // alone
    expect(hottest(f)!.c).toBe(30);
  });

  it('wraps blocks across the date line', () => {
    expect(hottest(patch(300, 0, 40))).toEqual({ c: 40, lat: 15.125, lon: -179.875 });
  });
});

describe('the readout', () => {
  const f = {
    dates: ['2026-10-24', '2026-10-23'] as [string, string],
    instruments: ['VIIRS', 'MODIS'] as ('VIIRS' | 'MODIS')[],
    hottest: { c: 64.31, lat: 29.875, lon: 57.625 },
    warmestNight: { c: 33.04, lat: 26.125, lon: 50.375 },
  };

  it('says the days, the passes, the scale and the hottest ground', () => {
    expect(lstSummary('day', f)).toBe(
      'VIIRS/MODIS 23–24 Oct · afternoon (~1:30 pm) · −40 °C blue → 0 pale → 60 °C red · hottest 64.3 °C at 29.88°N 57.63°E',
    );
    expect(lstSummary('night', f)).toBe(
      'VIIRS/MODIS 23–24 Oct · night (~1:30 am) · −40 °C blue → 0 pale → 60 °C red · warmest night 33.0 °C at 26.13°N 50.38°E',
    );
    expect(lstSummary('auto', f)).toContain('afternoon by day, night by night');
    expect(lstSummary('auto', f)).toContain('hottest 64.3 °C');
    expect(lstSummary('auto', f)).toContain('warmest night 33.0 °C');
  });

  it('spans a month’s end', () => {
    expect(lstSummary('day', { ...f, dates: ['2026-11-01', '2026-10-31'], hottest: undefined })).toMatch(/^VIIRS\/MODIS 31 Oct–1 Nov · /);
  });
});

describe('fetching', () => {
  const N = SST_W * SST_H;
  const field = (v: number) => new Float32Array(N).fill(v);

  it('fetches the passes the mode needs, keeps yesterday’s once final, and today’s again each look', async () => {
    const fetch = vi.fn(async (layer: string, _date: string) => field(layer.startsWith('VIIRS') ? 30 : NaN));
    const loader = new LstLoader(fetch);
    const f = await loader.load(new Date('2026-10-24T14:00:00Z'), 'day');
    expect(fetch).toHaveBeenCalledTimes(10);
    expect(fetch.mock.calls.every(([layer]) => layer.endsWith('_Day'))).toBe(true);
    expect(f.instruments).toEqual(['VIIRS']);
    expect(f.hottest?.c).toBe(30);
    expect(f.warmestNight).toBeUndefined();

    fetch.mockClear();
    await loader.load(new Date('2026-10-24T15:00:00Z'), 'auto');
    // Night's ten, and the day's five for today; yesterday's day passes were fetched after 06:00.
    expect(fetch).toHaveBeenCalledTimes(15);
    expect(fetch.mock.calls.filter(([, date]) => date === '2026-10-23').every(([layer]) => layer.endsWith('_Night'))).toBe(true);
  });

  it('refetches yesterday’s until it’s final', async () => {
    const fetch = vi.fn(async () => field(10));
    const loader = new LstLoader(fetch);
    await loader.load(new Date('2026-10-24T02:00:00Z'), 'night');
    fetch.mockClear();
    await loader.load(new Date('2026-10-24T03:00:00Z'), 'night');
    expect(fetch).toHaveBeenCalledTimes(10);
  });

  it('draws what it has when a satellite fails, and fails only when nothing came', async () => {
    const some = vi.fn(async (layer: string) => {
      if (layer.startsWith('MODIS')) throw new Error('503');
      return field(5);
    });
    const f = await new LstLoader(some).load(new Date('2026-10-24T14:00:00Z'), 'night');
    expect(f.instruments).toEqual(['VIIRS']);
    await expect(new LstLoader(async () => Promise.reject(new Error('down'))).load(new Date(), 'day')).rejects.toThrow('down');
  });
});
