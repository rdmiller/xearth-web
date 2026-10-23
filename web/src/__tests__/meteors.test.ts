import { describe, expect, it } from 'vitest';
import {
  band,
  BANDS,
  decodeMeteors,
  fireballRows,
  isMeteorManifest,
  labelledFireballs,
  meteorSummary,
  OTHER_COLOR,
  SHOWER_COLORS,
  showerColors,
  showerName,
  type Fireball,
  type MeteorManifest,
} from '../meteors';
import { EARTH_RADIUS_KM } from '../satellites';
import { HOTKEYS } from '../hotkeys';
import { defaults, parseSettings } from '../params';

// [t, lat0, lon0, h0, lat1, lon1, h1, mag, shower, v] as the pipeline packs them.
const row = (t: number, shower: number, mag: number) => [t, 4550, 1025, 1104, 4520, 1075, 851, mag * 10, shower, 662];
const FIREBALLS: Fireball[] = [
  { time: '2026-10-04T03:14:45Z', lat: -41.8, lon: -173.1, alt: 26.9, vel: 13.8, energy: 5.4, impactKt: 0.18 },
  { time: '2026-09-11T01:12:11Z', lat: 54.4, lon: -100.1, alt: 38, vel: null, energy: 24.6, impactKt: 0.67 },
  { time: '2026-08-01T00:00:00Z', lat: 0, lon: 0, alt: null, vel: null, energy: 1, impactKt: 0.03 },
  { time: '2026-08-02T00:00:00Z', lat: 0, lon: 0, alt: null, vel: null, energy: 1, impactKt: 0.02 },
  { time: '2026-08-03T00:00:00Z', lat: 0, lon: 0, alt: null, vel: null, energy: 1, impactKt: 0.01 },
];
const M: MeteorManifest = {
  generated: '2026-10-23T03:00:00Z',
  source: 'test',
  from: '2026-10-20T20:55:07.408Z',
  to: '2026-10-21T20:55:07.408Z',
  showers: ['ORI', 'STA', 'XYZ', '...'],
  counts: { ORI: 1579, STA: 200, XYZ: 3, '...': 3300 },
  fields: ['t', 'lat0', 'lon0', 'h0', 'lat1', 'lon1', 'h1', 'mag', 'shower', 'v'],
  meteors: [...row(86_400, 0, -3), ...row(0, 1, 4), ...row(43_200, 2, 1), ...row(43_200, 3, 1)],
  fireballDays: 90,
  fireballs: FIREBALLS,
};

describe('meteors (GMN via the pipeline)', () => {
  it('recognises the manifest', () => {
    expect(isMeteorManifest(M)).toBe(true);
    expect(isMeteorManifest({ ...M, fields: ['t'] })).toBe(false);
  });

  it('colours the big showers and lumps the rest with the sporadics', () => {
    const { codes, colors } = showerColors(M);
    // XYZ has only 3 meteors: too few for a colour of its own.
    expect(codes).toEqual(['ORI', 'STA']);
    expect(colors).toEqual([SHOWER_COLORS[0], SHOWER_COLORS[1], OTHER_COLOR]);
  });

  it('puts each streak along its path at its height', () => {
    const s = decodeMeteors(M);
    expect(s).toHaveLength(4);
    const r = (p: readonly number[]) => Math.hypot(p[0], p[1], p[2]);
    expect(r(s[0].a)).toBeCloseTo(1 + 110.4 / EARTH_RADIUS_KM, 6);
    expect(r(s[0].b)).toBeCloseTo(1 + 85.1 / EARTH_RADIUS_KM, 6);
    expect(s.map((x) => x.color)).toEqual([0, 1, 2, 2]);
  });

  it('fades the faint and the old', () => {
    expect(band(-3, 0)).toBe(BANDS); // bright and newest
    expect(band(4, 0)).toBe(1); // at the limit of the cameras
    expect(band(-3, 1)).toBe(Math.round(BANDS * 0.4)); // bright but a day old
    const s = decodeMeteors(M);
    expect(s[0].band).toBeGreaterThan(s[1].band); // newest and brightest vs oldest and faintest
  });

  it('names showers, sporadics and unknown codes', () => {
    expect(showerName('ORI')).toBe('Orionids');
    expect(showerName('...')).toBe('sporadic');
    expect(showerName('XAR')).toBe('XAR');
  });

  it('summarises the day', () => {
    expect(meteorSummary(M)).toBe('4 in 24 h to 21 Oct 20:55 UTC · Orionids 1,579 · Southern Taurids 200 · 5 fireballs in 90 d');
  });
});

describe('fireballs (CNEOS)', () => {
  it('labels the last 30 days’ and the three biggest', () => {
    const now = Date.parse('2026-10-23T03:00:00Z');
    expect(labelledFireballs(FIREBALLS, now).map((f) => f.time)).toEqual(['2026-10-04T03:14:45Z', '2026-09-11T01:12:11Z', '2026-08-01T00:00:00Z']);
  });

  it('says how big, when and how high', () => {
    expect(fireballRows(FIREBALLS[0])).toEqual(['FIREBALL · 0.2 KT', '4 OCT 03:14 UTC · 27 KM UP · 14 KM/S']);
    expect(fireballRows(FIREBALLS[2])).toEqual(['FIREBALL · 0.03 KT', '1 AUG 00:00 UTC']);
  });
});

describe('meteors setting', () => {
  it('is off by default; Shift+M turns it on', () => {
    expect(defaults().meteors).toBe(false);
    expect(parseSettings('?meteors=1').meteors).toBe(true);
    expect(HOTKEYS.some((h) => h.keys.includes('shift+m'))).toBe(true);
  });
});
