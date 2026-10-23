import { describe, expect, it } from 'vitest';
import colormapXml from './fixtures/gibs-b13-colormap-2026-10-23.xml?raw';
import parity from './fixtures/himawari-parity-2026-10-23.json';
import { b13Temperature, cloudAlpha, infraredGrey, interpKnots, IR_KNOTS, subsolar, toAlpha, visAlpha, visibleGrey } from '../himawariCloud';

// The same integer formulas as the fixture's generator, so no inputs need storing.
function irInput(w: number, h: number): Float32Array {
  const g = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let v = 70 + 0.8 * y;
      if ((x * 7 + y * 13) % 29 < 6) v += 60 + ((x * 31 + y * 17) % 40);
      if (x >= 60 && x < 70 && y >= 10 && y < 20) v = 210;
      if ((x * 3 + y * 5) % 53 === 0) v = NaN;
      g[y * w + x] = v;
    }
  }
  return g;
}

function visInput(w: number, h: number) {
  const lat = Array.from({ length: h }, (_, y) => 20 - ((y + 0.5) * 5) / h);
  const lon = Array.from({ length: w }, (_, x) => 130 + ((x + 0.5) * 10) / w);
  const vis = new Float32Array(w * h);
  const ir = new Float32Array(w * h);
  const L = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const k = (x * 7 + y * 11) % 10;
      L[i] = k < 5 ? 0.1 : k < 9 ? 0.25 : (x + y) % 97 === 0 ? 0.5 : 0.1;
      const cloudy = (x * 13 + y * 7) % 23 < 4;
      ir[i] = cloudy ? 0.5 : ((x * y) % 5) * 0.01;
      vis[i] = (x * 5 + y * 3) % 61 === 0 ? NaN : 50 + ((x * 31 + y * 17) % 30) + (cloudy ? 90 : 0);
    }
  }
  return { vis, ir, L, lat, lon };
}

describe('Band 13 colours', () => {
  const entries = [...colormapXml.matchAll(/<ColorMapEntry rgb="(\d+),(\d+),(\d+)" transparent="false" sourceValue="\(([-+\w.]+),([-+\w.]+)[\])]/g)];

  it('reads every colour in GIBS’s colour map back to the middle of its bin', () => {
    expect(entries).toHaveLength(238);
    for (const [, r, g, b, lo, hi] of entries) {
      const l = lo === '-INF' ? Number(hi) - 0.5 : Number(lo);
      const u = hi === '+INF' ? l + 0.5 : Number(hi);
      expect(b13Temperature(+r, +g, +b)).toBeCloseTo((l + u) / 2, 6);
    }
  });

  it('keeps the two overlapping grey ramps apart by exact colour', () => {
    // 100 grey is ~+10 °C on the warm ramp; the cold ramp's greys sit a level away.
    const warm = b13Temperature(100, 100, 100);
    expect(warm).toBeGreaterThan(0);
    expect(warm).toBeLessThan(20);
    expect(b13Temperature(230, 230, 230)).toBeLessThan(-75);
  });

  it('maps temperature to GMGSI grey along the measured curve, held flat past its ends', () => {
    expect(interpKnots(0, IR_KNOTS)).toBe(116);
    expect(interpKnots(1, IR_KNOTS)).toBeCloseTo(113.5, 6);
    expect(interpKnots(-90, IR_KNOTS)).toBe(219);
    expect(interpKnots(40, IR_KNOTS)).toBe(64);
  });

  it('treats transparent Band 13 and black Band 3 as no data', () => {
    const px = new Uint8ClampedArray([100, 100, 100, 0, 100, 100, 100, 255]);
    const ir = infraredGrey(px, 2);
    expect(ir[0]).toBeNaN();
    expect(ir[1]).toBeCloseTo(interpKnots(b13Temperature(100, 100, 100), IR_KNOTS), 4); // ~19 °C → ~71
    const vis = visibleGrey(new Uint8ClampedArray([0, 0, 0, 255, 120, 120, 120, 255]), 2);
    expect(vis[0]).toBeNaN();
    expect(vis[1]).toBe(173);
  });
});

describe('parity with the pipeline (convert.py)', () => {
  it('finds the subsolar point as convert.subsolar does', () => {
    const [lat, lon] = subsolar(parity.vis_alpha.time);
    expect(lat).toBeCloseTo(parity.subsolar_0300[0], 6);
    expect(lon).toBeCloseTo(parity.subsolar_0300[1], 6);
  });

  it('gives to_alpha’s opacity from infrared grey, on GMGSI’s 50 × 24 wrapping blocks', () => {
    const { w, h, step, values } = parity.to_alpha;
    const a = toAlpha(irInput(w, h), w, h, { blockRows: 50, blockCols: 24, wrapX: true });
    values.forEach((v, k) => {
      if (v === null) expect(a[k * step]).toBeNaN();
      else expect(a[k * step]).toBeCloseTo(v, 4);
    });
  });

  it('gives vis_alpha’s opacity from visible grey, glint, Sun and surface included', () => {
    const { w, h, time, step, values, mean, nonzero } = parity.vis_alpha;
    const { vis, ir, L, lat, lon } = visInput(w, h);
    const a = visAlpha(vis, ir, L, w, h, { lat, lon, time }, 140.7);
    values.forEach((v, k) => expect(a[k * step]).toBeCloseTo(v, 4));
    expect(a.reduce((s, x) => s + x, 0) / a.length).toBeCloseTo(mean, 5);
    expect(a.filter((x) => x > 0).length).toBe(nonzero);
  });

  it('raises infrared to visible by day, and keeps no-data as no-data', () => {
    const out = cloudAlpha(new Float32Array([0.2, NaN, 0.7]), new Float32Array([0.5, 0.9, 0.1]));
    expect(out[0]).toBeCloseTo(0.5, 6);
    expect(out[1]).toBeNaN();
    expect(out[2]).toBeCloseTo(0.7, 6);
  });
});
