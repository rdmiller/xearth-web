import { describe, expect, it } from 'vitest';
import sstXml from './fixtures/gibs-sst-colormap-2026-10-23.xml?raw';
import anomalyXml from './fixtures/gibs-sst-anomaly-colormap-2026-10-23.xml?raw';
import {
  anomalyValue,
  boxMean,
  decode,
  encode,
  ensoWord,
  NINO34,
  SST_H,
  SST_W,
  sstDomainUrl,
  sstMapUrl,
  sstSummary,
  sstValue,
  warmShare,
} from '../sst';

/** Each data entry of a GIBS colour map: its colour and its bin's middle (open ends half a bin out). */
function entries(xml: string): { rgb: [number, number, number]; mid: number }[] {
  const rows = [...xml.matchAll(/<ColorMapEntry rgb="(\d+),(\d+),(\d+)" transparent="false" sourceValue="[[(]([-+\w.]+),([-+\w.]+)[\])]"/g)];
  const width = Math.min(...rows.filter((r) => !`${r[4]}${r[5]}`.includes('INF')).map((r) => Number(r[5]) - Number(r[4])));
  return rows.map(([, r, g, b, lo, hi]) => ({
    rgb: [+r, +g, +b],
    mid: lo === '-INF' ? Number(hi) - width / 2 : hi === '+INF' ? Number(lo) + width / 2 : (Number(lo) + Number(hi)) / 2,
  }));
}

describe('GIBS’s MUR colours', () => {
  it('reads every temperature colour back to its bin', () => {
    const e = entries(sstXml);
    expect(e).toHaveLength(215);
    for (const { rgb, mid } of e) expect(sstValue(...rgb)).toBeCloseTo(mid, 4);
  });

  it('reads every anomaly colour back to its bin, ±3 °C and beyond at the ends', () => {
    const e = entries(anomalyXml);
    expect(e).toHaveLength(62);
    for (const { rgb, mid } of e) expect(anomalyValue(...rgb)).toBeCloseTo(mid, 4);
    expect(anomalyValue(107, 0, 219)).toBeCloseTo(-3.05, 4);
    expect(anomalyValue(128, 0, 0)).toBeCloseTo(3.05, 4);
  });

  it('treats transparent pixels (land, ice) as no data', () => {
    const v = decode(new Uint8ClampedArray([128, 0, 0, 0, 128, 0, 0, 255]), 2, anomalyValue);
    expect(v[0]).toBeNaN();
    expect(v[1]).toBeCloseTo(3.05, 4);
  });
});

describe('the texture', () => {
  it('packs temperature (−2…34 °C) and anomaly (−4…+4 °C), with no data all zero', () => {
    const rgba = encode(new Float32Array([-2, 16, 34, NaN]), new Float32Array([-4, 0, 4, 1]));
    expect(Array.from(rgba)).toEqual([0, 0, 0, 255, 128, 128, 0, 255, 255, 255, 0, 255, 0, 0, 0, 0]);
  });
});

/** A full 0.25° field: `v` inside the box, `out` elsewhere, NaN on "land" rows. */
function field(box: typeof NINO34, v: number, out: number): Float32Array {
  const f = new Float32Array(SST_W * SST_H);
  for (let y = 0; y < SST_H; y++) {
    const lat = 90 - (y + 0.5) * 0.25;
    for (let x = 0; x < SST_W; x++) {
      const lon = -180 + (x + 0.5) * 0.25;
      const inside = lat >= box.lat0 && lat <= box.lat1 && lon >= box.lon0 && lon <= box.lon1;
      f[y * SST_W + x] = Math.abs(lat) > 80 ? NaN : inside ? v : out;
    }
  }
  return f;
}

describe('El Niño and much warmer than usual', () => {
  it('averages Niño 3.4 over just its box (5°S–5°N, 170°W–120°W)', () => {
    expect(boxMean(field(NINO34, 2.5, -1), NINO34)).toBeCloseTo(2.5, 6);
    expect(boxMean(field(NINO34, 2.5, -1), { lat0: -5, lat1: 5, lon0: -175, lon1: -120 })).toBeLessThan(2.5);
  });

  it('names the range by NOAA’s thresholds', () => {
    expect(ensoWord(2.7)).toBe('strong El Niño range');
    expect(ensoWord(1.2)).toBe('moderate El Niño range');
    expect(ensoWord(0.6)).toBe('El Niño range');
    expect(ensoWord(0.2)).toBe('neutral');
    expect(ensoWord(-0.7)).toBe('La Niña range');
    expect(ensoWord(-1.6)).toBe('strong La Niña range');
  });

  it('counts the ocean +2 °C or more above usual by area', () => {
    const all = field(NINO34, 3, 0);
    const share = warmShare(all);
    expect(share).toBeGreaterThan(0);
    expect(share).toBeLessThan(0.02);
    expect(warmShare(field(NINO34, 3, 3))).toBeCloseTo(1, 6);
  });

  it('says the day, the scale and, for the anomaly, Niño 3.4 with its baseline', () => {
    const f = { date: '2026-10-22', nino34: 2.68, nino34Sst: 29.99, warm: 0.108 };
    expect(sstSummary('temp', f)).toBe('MUR 22 Oct · 0 °C blue → 30 °C red');
    expect(sstSummary('anomaly', f)).toBe(
      'MUR 22 Oct · −3 blue → +3 °C red · Niño 3.4 30.0 °C, +2.7 °C vs 2003–14 (strong El Niño range) · 10.8% of the ocean +2 °C or more',
    );
  });
});

describe('requests', () => {
  it('asks GIBS for MUR’s days on its 1 km matrix, and its whole world at 0.25°', () => {
    expect(sstDomainUrl(new Date('2026-10-23T18:00:00Z'))).toContain('/GHRSST_L4_MUR_Sea_Surface_Temperature/default/1km/all/2026-10-13--2026-10-23.xml');
    const u = new URL(sstMapUrl('GHRSST_L4_MUR_Sea_Surface_Temperature_Anomalies', '2026-10-22'));
    expect(u.searchParams.get('BBOX')).toBe('-90,-180,90,180');
    expect([u.searchParams.get('WIDTH'), u.searchParams.get('HEIGHT')]).toEqual(['1440', '720']);
    expect(u.searchParams.get('FORMAT')).toBe('image/png');
    expect(u.searchParams.get('TIME')).toBe('2026-10-22');
  });
});
