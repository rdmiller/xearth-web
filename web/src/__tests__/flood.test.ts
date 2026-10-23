import { describe, expect, it } from 'vitest';
import colormapXml from './fixtures/gibs-flood-colormap-2026-10-23.xml?raw';
import { boxParts, detailRequest, floodArea, floodCells, floodClass, floodMapUrl, floodPoints, floodSummary, RECURRING_INTENSITY, withDetail, WORLD, type FloodCell } from '../flood';

describe('GIBS’s flood classes', () => {
  it('reads flood and recurring flood from the colour map, and nothing else', () => {
    const tags = [...colormapXml.matchAll(/<ColorMapEntry [^>]*>/g)].map((m) => m[0]);
    const byValue = Object.fromEntries(
      tags.flatMap((t) => {
        const rgb = /rgb="(\d+),(\d+),(\d+)"/.exec(t)!;
        const v = /sourceValue="(\d+)"/.exec(t)?.[1];
        return v ? [[v, [+rgb[1], +rgb[2], +rgb[3]] as const]] : [];
      }),
    );
    expect(floodClass(...byValue['3'])).toBe(3); // Flood
    expect(floodClass(...byValue['2'])).toBe(2); // Recurring Flood
    expect(floodClass(...byValue['1'])).toBe(0); // Surface Water: normal, not drawn
    expect(floodClass(...byValue['255'])).toBe(0); // Insufficient Data
  });
});

describe('pixels to cells', () => {
  // 2 × 2 px over 0–2°N, 10–12°E: flood, recurring flood, surface water, transparent.
  const px = new Uint8ClampedArray([250, 30, 36, 255, 255, 255, 0, 255, 50, 210, 245, 255, 0, 0, 0, 0]);
  const cells = floodCells(px, 2, 2, { lon0: 10, lat1: 2, lonSpan: 2, latSpan: 2 });

  it('places each flood pixel at its centre with its ground area', () => {
    expect(cells.map((c) => [c.lat, c.lon, c.cls])).toEqual([
      [1.5, 10.5, 3],
      [1.5, 11.5, 2],
    ]);
    expect(cells[0].km2).toBeCloseTo(111.32 * 111.32 * Math.cos((1.5 * Math.PI) / 180), 3);
  });

  it('sums the area of each class', () => {
    const a = floodArea(cells);
    expect(a.flood).toBeCloseTo(cells[0].km2, 6);
    expect(a.recurring).toBeCloseTo(cells[1].km2, 6);
  });

  it('draws flood brighter than recurring flood, each at its ground’s size', () => {
    const p = floodPoints(cells);
    expect(p.count).toBe(2);
    expect(p.look[0]).toBe(1);
    expect(p.look[3]).toBeCloseTo(RECURRING_INTENSITY, 6);
    expect(p.look[2]).toBeCloseTo(Math.sqrt((cells[0].km2 * 4) / Math.PI), 4);
  });

  it('says how much is flooded, from the world picture', () => {
    const c: FloodCell[] = [
      { lat: 0, lon: 0, cls: 3, km2: 1200.4 },
      { lat: 0, lon: 1, cls: 3, km2: 34 },
      { lat: 0, lon: 2, cls: 2, km2: 56 },
    ];
    expect(floodSummary('2026-10-23', c)).toBe('VIIRS 2 days to 23 Oct · flood ~1,234 km² · recurring ~56 km²');
  });
});

describe('zoomed in', () => {
  it('asks only past ~3 km a pixel, for the view snapped to whole degrees, no finer than 250 m', () => {
    expect(detailRequest({ lat0: 40.2, lat1: 45.7, lon0: 9.3, lon1: 14.1 }, 0.05)).toBeNull();
    const near = detailRequest({ lat0: 40.2, lat1: 45.7, lon0: 9.3, lon1: 14.1 }, 0.004);
    expect(near?.box).toEqual({ lon0: 9, lat1: 46, lonSpan: 6, latSpan: 6 });
    expect([near?.w, near?.h]).toEqual([1500, 1500]);
    const closest = detailRequest({ lat0: 43.2, lat1: 43.4, lon0: 11.1, lon1: 11.3 }, 0.0005);
    expect([closest?.w, closest?.h]).toEqual([444, 444]); // 1° at the product's 0.00225°
    const wide = detailRequest({ lat0: -10, lat1: 20, lon0: 0, lon1: 40 }, 0.01);
    expect(Math.max(wide!.w, wide!.h)).toBe(2048);
  });

  it('swaps the world’s cells inside the box for the finer ones', () => {
    const world: FloodCell[] = [
      { lat: 43.3, lon: 11.2, cls: 3, km2: 90 },
      { lat: 10, lon: 30, cls: 3, km2: 90 },
    ];
    const fine: FloodCell[] = [{ lat: 43.31, lon: 11.21, cls: 3, km2: 0.06 }];
    const out = withDetail(world, { box: { lon0: 11, lat1: 44, lonSpan: 1, latSpan: 1 }, cells: fine });
    expect(out.map((c) => c.lon)).toEqual([30, 11.21]);
    expect(withDetail(world, null)).toHaveLength(2);
  });

  it('splits a box over the date line into two requests', () => {
    expect(boxParts({ lon0: 178, lat1: 0, lonSpan: 4, latSpan: 2 }, 400)).toEqual([
      { lon0: 178, lon1: 180, x: 0, width: 200 },
      { lon0: -180, lon1: -178, x: 200, width: 200 },
    ]);
    expect(boxParts(WORLD, 4096)).toEqual([{ lon0: -180, lon1: 180, x: 0, width: 4096 }]);
  });

  it('asks WMS for the box latitude first, as a PNG for the day', () => {
    const u = new URL(floodMapUrl('2026-10-22', 10, 12, 40, 42, 800, 800));
    expect(u.searchParams.get('LAYERS')).toBe('VIIRS_Combined_Flood_2-Day');
    expect(u.searchParams.get('BBOX')).toBe('40,10,42,12');
    expect(u.searchParams.get('FORMAT')).toBe('image/png');
    expect(u.searchParams.get('TIME')).toBe('2026-10-22');
  });
});
