import { describe, expect, it } from 'vitest';
import stormJson from '../../public/storms/latest.json';
import {
  basinWord,
  decodeFires,
  decodeOvation,
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
    expect(stormDetail(champi)).toBe('PEAK 296 KM/H · RED ALERT');
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
    expect(f.look[0]).toBeLessThan(f.look[2]); // 1.5 MW vs 2,500 MW
    expect(f.look[1]).toBeGreaterThan(f.look[3]); // 2 h old vs 20 h old
  });

  it('maps fire radiative power onto 0…1 on a log scale', () => {
    expect(fireIntensity(0)).toBe(0);
    expect(fireIntensity(1)).toBeCloseTo(0.086, 2);
    expect(fireIntensity(100_000)).toBe(1);
  });
});
