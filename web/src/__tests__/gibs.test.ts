import { describe, expect, it } from 'vitest';
import {
  chooseRange,
  degPerTexel,
  DETAIL_BELOW_DEG_PER_PX,
  matrixSize,
  MAX_TILES,
  mosaicDate,
  rangeBounds,
  tileCount,
  tileRange,
  tileSpanDeg,
  tileUrl,
  visibleBox,
} from '../gibs';

describe('GIBS 250m tile matrix', () => {
  it('matches the WMTSCapabilities sizes (2×1 at level 0 … 320×160 at level 8)', () => {
    expect([0, 1, 2, 3, 8].map((l) => matrixSize(l))).toEqual([
      { cols: 2, rows: 1 },
      { cols: 3, rows: 2 },
      { cols: 5, rows: 3 },
      { cols: 10, rows: 5 },
      { cols: 320, rows: 160 },
    ]);
    expect(tileSpanDeg(3)).toBe(36);
    expect(degPerTexel(8) * 111.32 * 1000).toBeCloseTo(244.6, 1); // the "250 m" level
  });

  it('builds tile URLs, wrapping columns round the date line', () => {
    expect(tileUrl('2026-10-21', 3, 2, 5)).toBe(
      'https://gibs.earthdata.nasa.gov/wmts/epsg4326/best/VIIRS_NOAA20_CorrectedReflectance_TrueColor/default/2026-10-21/250m/3/2/5.jpg',
    );
    expect(tileUrl('2026-10-21', 3, 2, 10)).toMatch(/\/3\/2\/0\.jpg$/);
    expect(tileUrl('2026-10-21', 3, 2, -1)).toMatch(/\/3\/2\/9\.jpg$/);
  });

  it('uses yesterday (UTC), the newest complete mosaic', () => {
    expect(mosaicDate(new Date('2026-10-22T03:00:00Z'))).toBe('2026-10-21');
  });
});

describe('choosing tiles for the view', () => {
  it('covers the visible box, across the date line too', () => {
    const r = tileRange({ lat0: 30, lat1: 50, lon0: 170, lon1: 190 }, 5); // 9° tiles
    expect(r).toMatchObject({ col0: 38, col1: 41, row0: 4, row1: 6 });
    const b = rangeBounds(r);
    expect(b).toEqual({ lon0: 162, lat1: 54, lonSpan: 36, latSpan: 27 });
  });

  it('widens the box in longitude toward the poles, and takes all longitudes at a pole', () => {
    expect(visibleBox(60, 10, 5).lon1 - visibleBox(60, 10, 5).lon0).toBeGreaterThan(20);
    expect(visibleBox(88, 10, 5)).toMatchObject({ lon0: -180, lon1: 180 });
  });

  it('stays off until zoomed past the Blue Marble, then picks a level near a screen pixel', () => {
    const box = visibleBox(43.5, -96.7, 3);
    expect(chooseRange(box, DETAIL_BELOW_DEG_PER_PX)).toBeNull();
    expect(chooseRange(box, 0.05)!.level).toBe(3);
    expect(chooseRange(visibleBox(43.5, -96.7, 0.4), 0.0025)!.level).toBe(8);
  });

  it('never asks for more than MAX_TILES, using a coarser level instead', () => {
    const r = chooseRange(visibleBox(0, 0, 25), 0.004)!;
    expect(tileCount(r)).toBeLessThanOrEqual(MAX_TILES);
    expect(r.level).toBeLessThan(7);
  });
});
