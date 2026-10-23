import { describe, expect, it } from 'vitest';
import { fireFootprintKm, fireIntensity, firesWithin, joinFires, VIIRS_PIXEL_KM2 } from '../hazards';
import { frpPoints, frpRows, parseFrp, pixelAreaKm2, slotCells, slotUrl, windowFires, windowTimes, type FrpCell } from '../mtgFires';

/** Two pixels from EUMETView's 2026-10-23 15:10Z slot (Madagascar), as it serves them. */
const SLOT = {
  type: 'FeatureCollection',
  features: [
    { type: 'Feature', id: 'MTG_FD_L2P_FRP_2610231510_lod0.0', geometry: null, properties: { Lat: -23.157, Lon: 46.668, FRP: 40.21, Confidence: 90, VZA: 58.28 } },
    { type: 'Feature', id: 'MTG_FD_L2P_FRP_2610231510_lod0.1', geometry: null, properties: { Lat: -23.1674, Lon: 46.672, FRP: 56.95, Confidence: 98, VZA: 58.3 } },
  ],
};

const px = (lat: number, lon: number, frp: number, confidence = 90, vza = 0) => ({ lat, lon, frp, confidence, vza });

describe('MTG fire pixels', () => {
  it('reads EUMETView’s GeoJSON', () => {
    expect(parseFrp(SLOT)).toEqual([
      { lat: -23.157, lon: 46.668, frp: 40.21, confidence: 90, vza: 58.28 },
      { lat: -23.1674, lon: 46.672, frp: 56.95, confidence: 98, vza: 58.3 },
    ]);
  });

  it('rejects anything else, such as a GeoServer error', () => {
    expect(() => parseFrp({ error: 'timeout' })).toThrow(/FeatureCollection/);
  });

  it('sizes a pixel by how obliquely FCI sees it: 1 km² below the satellite, ~1.4 at 40°, ~2.2 at 58°', () => {
    expect(pixelAreaKm2(0)).toBeCloseTo(1, 6);
    expect(pixelAreaKm2(40)).toBeCloseTo(1.4, 1);
    expect(pixelAreaKm2(58.3)).toBeCloseTo(2.2, 1);
    expect(pixelAreaKm2(0.001)).toBeCloseTo(1, 4); // no jump just off nadir
  });
});

describe('slots to cells', () => {
  it('bins pixels into FIRMS’s 0.05° cells, summing power and ground, and drops the unconfident', () => {
    const cells = slotCells([
      px(10.0, 20.0, 12),
      px(10.01, 20.02, 8, 60, 40), // same cell (200, 400)
      px(10.06, 20.0, 5), // the next cell north
      px(10.0, 20.0, 99, 49), // under 50% confidence
    ]);
    expect([...cells.keys()]).toEqual(['200,400', '201,400']);
    const c = cells.get('200,400')!;
    expect(c.frp).toBe(20);
    expect(c.pixels).toBe(2);
    expect(c.areaKm2).toBeCloseTo(1 + pixelAreaKm2(40), 6);
  });

  it('shows each cell as its newest slot saw it, aged from that slot', () => {
    const cell = (frp: number): FrpCell => ({ latI: 1, lonI: 2, frp, pixels: 1, areaKm2: 1 });
    const now = Date.parse('2026-10-23T15:40:00Z');
    const fires = windowFires(
      [
        { time: '2026-10-23T14:40:00Z', cells: new Map([['1,2', cell(500)], ['3,4', { ...cell(7), latI: 3, lonI: 4 }]]) },
        { time: '2026-10-23T15:10:00Z', cells: new Map([['1,2', cell(30)]]) },
      ],
      now,
    );
    expect(fires.map((f) => [f.latI, f.frp, f.ageH])).toEqual([
      [1, 30, 0.5], // not 530: power is a rate
      [3, 7, 1],
    ]);
    expect(frpRows(fires)).toEqual([1, 2, 300, 1, 1, 3, 4, 70, 1, 1]);
  });

  it('draws a cell at its pixels’ ground, as FIRMS’s are drawn at theirs', () => {
    const p = frpPoints([{ latI: 0, lonI: 0, frp: 40, pixels: 4, areaKm2: 4, ageH: 0.25 }]);
    expect(p.count).toBe(1);
    expect(p.look[0]).toBeCloseTo(fireIntensity(40), 6);
    expect(p.look[1]).toBeCloseTo(0.25, 6);
    expect(p.look[2]).toBeCloseTo(Math.sqrt(16 / Math.PI), 6);
    // Four FCI pixels stand for far more ground than four VIIRS detections.
    expect(p.look[2]).toBeGreaterThan(fireFootprintKm(4) * 2);
    expect(VIIRS_PIXEL_KM2).toBeLessThan(pixelAreaKm2(0));
  });
});

describe('FIRMS and MTG together', () => {
  it('keeps both instruments’ points, and counts both', () => {
    const firms = frpPoints([{ latI: 1, lonI: 1, frp: 3, pixels: 2, areaKm2: 0.3, ageH: 6 }]);
    const mtg = frpPoints([
      { latI: 1, lonI: 1, frp: 9, pixels: 1, areaKm2: 1, ageH: 0.2 },
      { latI: 5, lonI: 5, frp: 50, pixels: 3, areaKm2: 4, ageH: 0.7 },
    ]);
    const both = joinFires(firms, undefined, mtg);
    expect(both.count).toBe(3);
    expect(Array.from(both.ageH)).toEqual([6, 0, 1]);
    expect(Array.from(both.look.slice(3, 6))).toEqual(Array.from(mtg.look.slice(0, 3)));
    expect(firesWithin(both, 1)).toEqual({ cells: 2, detections: 4 });
    expect(joinFires().count).toBe(0);
  });
});

describe('requests', () => {
  it('asks WFS for one slot’s pixels, only the fields used', () => {
    const url = new URL(slotUrl('2026-10-23T15:10:00Z'));
    expect(url.origin + url.pathname).toBe('https://view.eumetsat.int/geoserver/mtg_fd/ows');
    expect(url.searchParams.get('typeNames')).toBe('mtg_fd:frp');
    expect(url.searchParams.get('outputFormat')).toBe('application/json');
    expect(url.searchParams.get('propertyName')).toBe('Lat,Lon,FRP,Confidence,VZA');
    expect(url.searchParams.get('cql_filter')).toBe('time=2026-10-23T15:10:00Z');
  });

  it('makes the hour from six 10-minute slots, newest first', () => {
    expect(windowTimes('2026-10-23T15:10:00Z')).toEqual([
      '2026-10-23T15:10:00Z',
      '2026-10-23T15:00:00Z',
      '2026-10-23T14:50:00Z',
      '2026-10-23T14:40:00Z',
      '2026-10-23T14:30:00Z',
      '2026-10-23T14:20:00Z',
    ]);
  });
});
