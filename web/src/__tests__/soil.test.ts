import { describe, expect, it } from 'vitest';
import smapXml from './fixtures/gibs-smap-colormap-2026-10-24.xml?raw';
import { dryShare, encodeSoil, ROOT_LAYER, soilDomainUrl, soilSummary, soilValue, SURFACE_LAYER } from '../soil';
import { SST_H, SST_W } from '../sst';

/** Each data entry of GIBS's SMAP colour map: its colour and its bin's bounds (the top's open). */
function entries(xml: string): { rgb: [number, number, number]; lo: number; hi: number }[] {
  const rows = [...xml.matchAll(/<ColorMapEntry rgb="(\d+),(\d+),(\d+)" transparent="false" sourceValue="[^"]*" value="\[([\d.]+),([^)]+)\)"/g)];
  return rows.map(([, r, g, b, lo, hi]) => ({ rgb: [+r, +g, +b], lo: Number(lo), hi: hi === '+INF' ? Infinity : Number(hi) }));
}

describe('GIBS’s soil moisture colours', () => {
  it('reads every colour back into its bin, 0–0.70 m³/m³ and an open top', () => {
    const e = entries(smapXml);
    expect(e).toHaveLength(255);
    // The file's bounds are rounded to 0.001: each value is within half a bin and that.
    for (const { rgb, lo, hi } of e.slice(0, -1)) {
      expect(soilValue(...rgb)).toBeGreaterThan(lo - 0.0005);
      expect(soilValue(...rgb)).toBeLessThan(hi + 0.0005);
    }
    expect(e.at(-1)!.rgb).toEqual([80, 80, 80]);
    expect(soilValue(80, 80, 80)).toBeGreaterThan(0.7);
  });

  it('takes a blend GIBS resampled to the nearest colour', () => {
    expect(soilValue(254, 163, 1)).toBeCloseTo(soilValue(255, 162, 0), 6);
  });

  it('names both depths and asks GIBS for the last ten days', () => {
    expect(SURFACE_LAYER).toBe('SMAP_L4_Analyzed_Surface_Soil_Moisture');
    expect(ROOT_LAYER).toBe('SMAP_L4_Analyzed_Root_Zone_Soil_Moisture');
    expect(soilDomainUrl(new Date('2026-10-24T09:00:00Z'))).toBe(
      'https://gibs.earthdata.nasa.gov/wmts/epsg4326/best/1.0.0/SMAP_L4_Analyzed_Surface_Soil_Moisture/default/2km/all/2026-10-14--2026-10-24.xml',
    );
  });
});

describe('the texture', () => {
  it('puts the top 5 cm in r and the root zone in g, alpha where there’s land', () => {
    const f = (...v: number[]) => new Float32Array(v);
    const out = encodeSoil(f(0, 0.375, NaN, 0.2), f(0.75, 0.9, NaN, NaN));
    expect(Array.from(out.slice(0, 8))).toEqual([0, 255, 0, 255, 128, 255, 0, 255]);
    expect(Array.from(out.slice(8, 12))).toEqual([0, 0, 0, 0]);
    // A depth missing borrows the other's.
    expect(out[12]).toBe(out[13]);
  });
});

describe('the readout', () => {
  it('counts the dry land by area', () => {
    const field = new Float32Array(SST_W * SST_H).fill(NaN);
    // One texel on the equator dry, one wet; one near the pole dry, which weighs next to nothing.
    field[360 * SST_W] = 0.05;
    field[360 * SST_W + 1] = 0.3;
    field[1 * SST_W] = 0.05;
    expect(dryShare(field)).toBeCloseTo(0.5, 2);
    expect(dryShare(new Float32Array(4).fill(NaN))).toBe(0);
  });

  it('gives the day, the depth, the scale and the dry share', () => {
    const f = { date: '2026-10-20', dry: { surface: 0.262, root: 0.21 } };
    expect(soilSummary('surface', f)).toBe('SMAP L4 20 Oct 12 UTC · top 5 cm · 0.05 m³/m³ brown → 0.5 blue · 26% of the land below 0.1');
    expect(soilSummary('root', f)).toContain('root zone, 0–100 cm · 0.05 m³/m³ brown → 0.5 blue · 21% of the land');
  });
});
