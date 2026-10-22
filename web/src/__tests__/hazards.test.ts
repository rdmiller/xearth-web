import { describe, expect, it } from 'vitest';
// The pipeline's storms/latest.json from 2026-10-21, pinned (the live file is generated and gitignored).
import stormJson from './fixtures/storms-2026-10-21.json';
import {
  basinWord,
  decodeFires,
  decodeOvation,
  fireFootprintKm,
  fireMinIntensity,
  fireSizePx,
  firesWithin,
  fireIntensity,
  stormClass,
  stormColor,
  stormDetail,
  stormTitle,
  type Storm,
} from '../hazards';
import { toLatLon } from '../vec';

describe('decodeOvation', () => {
  it('re-grids [lon 0…359, lat −90…90] to rows from the north pole and columns from −180°', () => {
    const g = decodeOvation({
      'Observation Time': '2026-10-21T18:13:00Z',
      'Forecast Time': '2026-10-21T19:13:00Z',
      coordinates: [
        [0, 90, 7], // Greenwich at the pole → row 0, column 180
        [270, 65, 42], // 90°W, 65°N → row 25, column 90
        [359, -90, 3], // 1°W at the south pole → row 180, column 179
      ],
    });
    expect([g.width, g.height]).toEqual([360, 181]);
    expect(g.data[0 * 360 + 180]).toBe(7);
    expect(g.data[25 * 360 + 90]).toBe(42);
    expect(g.data[180 * 360 + 179]).toBe(3);
    expect(g.peak).toBe(42);
    expect(g.forecast).toBe('2026-10-21T19:13:00Z');
  });

  it('drops the feed’s equatorial artefact ring (values at −3…0° latitude)', () => {
    const g = decodeOvation({
      'Observation Time': '',
      'Forecast Time': '',
      coordinates: [
        [10, 0, 11],
        [10, -3, 1],
        [10, 25, 9],
      ],
    });
    expect(g.data[90 * 360 + 190]).toBe(0);
    expect(g.data[93 * 360 + 190]).toBe(0);
    expect(g.data[65 * 360 + 190]).toBe(9); // 25°N is kept
    expect(g.peak).toBe(9);
  });
});

describe('storms', () => {
  const storms = stormJson.storms as unknown as Storm[];
  const champi = storms.find((s) => s.name === 'Champi')!;
  const td = storms.find((s) => s.name === 'Twenty-Two-E')!;

  it('names mature cyclones by basin', () => {
    expect(basinWord(127.9, 19.3)).toBe('TYPHOON');
    expect(basinWord(-60, 20)).toBe('HURRICANE');
    expect(basinWord(-150, 15)).toBe('HURRICANE'); // Central Pacific
    expect(basinWord(88, 15)).toBe('CYCLONE'); // Bay of Bengal
    expect(basinWord(150, -18)).toBe('CYCLONE'); // southern hemisphere
  });

  it('titles a GDACS typhoon and an NHC depression from today’s data', () => {
    expect(stormTitle(champi)).toBe('TYPHOON CHAMPI');
    expect(stormDetail(champi)).toBe('PEAK 296 KM/H'); // the impact is drawn as a meter
    // NHC's own classification wins over GDACS's forecast-derived class.
    expect(stormClass(td)).toBe('TD');
    expect(stormTitle(td)).toBe('TROPICAL DEPRESSION TWENTY-TWO-E');
    expect(stormDetail(td)).toBe('56 KM/H · 1005 MB · W 11 KM/H');
  });

  it('colours by class', () => {
    expect(stormColor('TD')).toBe('#5ebaff');
    expect(stormColor('MH')).toBe('#ff6060');
    expect(stormColor('??')).toBe('#c8d6e5');
  });
});

describe('fires', () => {
  it('places cells at their centres and scales brightness by fire power', () => {
    const f = decodeFires({
      generated: '',
      source: '',
      cellDeg: 0.05,
      detections: 3,
      count: 2,
      data: [600, -2400, 15, 2, 1, -400, 2700, 25000, 20, 2],
    });
    expect(f.count).toBe(2);
    const a = toLatLon([f.pos[0], f.pos[1], f.pos[2]]);
    expect(a.lat).toBeCloseTo(30, 4);
    expect(a.lon).toBeCloseTo(-120, 4);
    const b = toLatLon([f.pos[3], f.pos[4], f.pos[5]]);
    expect(b.lat).toBeCloseTo(-20, 4);
    expect(b.lon).toBeCloseTo(135, 4);
    expect(f.look[0]).toBeLessThan(f.look[3]); // intensity: 1.5 MW vs 2,500 MW
    expect([f.look[1], f.look[4]]).toEqual([2, 20]); // hours since the latest detection
    expect(f.look[2]).toBeCloseTo(fireFootprintKm(1), 6); // one detection
    expect(f.look[5]).toBeCloseTo(fireFootprintKm(2), 6); // two
  });

  it('sizes a fire by the ground its detections can cover, never below a device pixel', () => {
    // One 375 m VIIRS pixel ≈ a 0.42 km circle; 100 merged detections ≈ 4.2 km.
    expect(fireFootprintKm(1)).toBeCloseTo(0.423, 2);
    expect(fireFootprintKm(100)).toBeCloseTo(4.23, 1);
    // Whole-globe zoom (~730 device px per Earth radius ≈ 8.7 km/px): a pixel at most.
    expect(fireSizePx(fireFootprintKm(100), 730)).toBe(1);
    // Zoomed so a pixel is ~0.5 km: the same cell is drawn ~8 px across.
    expect(fireSizePx(fireFootprintKm(100), 6371 / 0.5)).toBeCloseTo(8.5, 0);
  });

  it('hides weak fires when zoomed out, none when zoomed in', () => {
    expect(fireMinIntensity(8.7)).toBeCloseTo(fireIntensity(3.85), 6);
    expect(fireMinIntensity(20)).toBeCloseTo(fireIntensity(4), 6); // capped at 4 MW
    expect(fireMinIntensity(1)).toBe(0);
    expect(fireMinIntensity(0.3)).toBe(0);
  });

  it('counts detections within the window', () => {
    const f = decodeFires({ generated: '', source: '', cellDeg: 0.05, detections: 9, count: 3, data: [0, 0, 10, 1, 4, 1, 1, 10, 11, 3, 2, 2, 10, 20, 2] });
    expect(firesWithin(f, 12)).toEqual({ cells: 2, detections: 7 });
    expect(firesWithin(f, 24)).toEqual({ cells: 3, detections: 9 });
  });

  it('maps fire radiative power onto 0…1 on a log scale', () => {
    expect(fireIntensity(0)).toBe(0);
    expect(fireIntensity(1)).toBeCloseTo(0.086, 2);
    expect(fireIntensity(100_000)).toBe(1);
  });
});
