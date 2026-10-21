import { describe, expect, it } from 'vitest';
import { dropWeakEchoes, latestFrame, mercatorV, radarZoom, tileUrls, TILE_PX } from '../radar';

// Shape of api.rainviewer.com/public/weather-maps.json on 2026-10-21 (free tier: no nowcast).
const MAPS = {
  version: '2.0',
  generated: 1792620623,
  host: 'https://tilecache.rainviewer.com',
  radar: {
    past: [
      { time: 1792620600, path: '/v2/radar/f281ab9683e9' },
      { time: 1792620000, path: '/v2/radar/43156112929b' },
    ],
    nowcast: [],
  },
  satellite: { infrared: [] },
};

describe('RainViewer radar', () => {
  it('takes the newest past frame, whatever the order', () => {
    expect(latestFrame(MAPS)).toEqual({ time: 1792620600, base: 'https://tilecache.rainviewer.com/v2/radar/f281ab9683e9' });
    expect(latestFrame({ ...MAPS, radar: { past: [] } })).toBeUndefined();
    expect(latestFrame(null)).toBeUndefined();
  });

  it('lists a whole zoom level of 512 px tiles in the free colour scheme', () => {
    const tiles = tileUrls(latestFrame(MAPS)!, 2);
    expect(tiles).toHaveLength(16);
    expect(tiles[5]).toEqual({ x: 1, y: 1, url: 'https://tilecache.rainviewer.com/v2/radar/f281ab9683e9/512/2/1/1/2/1_1.png' });
    expect(TILE_PX).toBe(512);
  });

  it('fetches finer tiles once zoomed in', () => {
    expect(radarZoom(1)).toBe(2);
    expect(radarZoom(2)).toBe(3);
  });

  it('maps latitude to Web Mercator rows', () => {
    expect(mercatorV(0)).toBeCloseTo(0.5, 12);
    expect(mercatorV(85.0511287798)).toBeCloseTo(0, 6);
    expect(mercatorV(-85.0511287798)).toBeCloseTo(1, 6);
    expect(mercatorV(45)).toBeCloseTo(0.3597, 4);
  });

  it('keeps 15 dBZ and up (opaque in the colour table), drops the translucent band below', () => {
    const px = new Uint8ClampedArray([
      0x88, 0xdd, 0xee, 0xff, // 15 dBZ: kept
      0xde, 0xd0, 0x97, 0xbe, // 14 dBZ: dropped
      0x63, 0x61, 0x59, 0x14, // −10 dBZ: dropped
      0, 0, 0, 0, // no echo
    ]);
    expect(dropWeakEchoes(px)).toBe(2);
    expect(Array.from(px)).toEqual([0x88, 0xdd, 0xee, 0xff, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
  });
});
