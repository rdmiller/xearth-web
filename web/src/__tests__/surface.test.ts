import { describe, expect, it } from 'vitest';
import {
  burnedRadiusKm,
  decodeLightning,
  eventDetail,
  eventLine,
  eventSize,
  eventTitle,
  isEventManifest,
  isLightningManifest,
  isSnowIceManifest,
  labelledEvents,
  lightningIntensity,
  smokeLine,
  snowIceLine,
  type GdacsEvent,
} from '../hazards';
import { toLatLon } from '../vec';

describe('lightning', () => {
  const m = {
    generated: '2026-10-21T21:57:26.775Z',
    source: 'NOAA GOES GLM L2 (GOES-19, GOES-18)',
    satellites: ['GOES-19', 'GOES-18'],
    windowMin: 30,
    latest: '2026-10-21T21:57:20.000Z',
    cellDeg: 0.1,
    flashes: 306,
    count: 2,
    // Two of the busiest cells from the 21:57Z run (Amazon), plus a lone flash.
    data: [-81, -653, 305, 1, 250, -800, 1, 29],
  };

  it('accepts the pipeline manifest and places cells at their centres', () => {
    expect(isLightningManifest(m)).toBe(true);
    expect(isLightningManifest({ ...m, windowMin: undefined })).toBe(false);
    const p = decodeLightning(m);
    expect(p.count).toBe(2);
    const ll = toLatLon([p.pos[0], p.pos[1], p.pos[2]]);
    expect(ll.lat).toBeCloseTo(-8.1, 5);
    expect(ll.lon).toBeCloseTo(-65.3, 5);
    expect(Array.from(p.look.slice(3, 6))).toEqual([expect.closeTo(0.15, 5), 29, 8]);
  });

  it('scales brightness with the log of the flash count', () => {
    expect(lightningIntensity(1)).toBeCloseTo(0.15);
    expect(lightningIntensity(300)).toBeCloseTo(1);
    expect(lightningIntensity(5000)).toBe(1);
    expect(lightningIntensity(17)).toBeGreaterThan(0.5);
  });
});

describe('snow and ice', () => {
  it('names both dates in the status line', () => {
    const m = { generated: '2026-10-21T22:00:00Z', source: 'IMS', image: 'snowice.png', ims: '2026-10-21', seaIceSouth: '2026-10-17' };
    expect(isSnowIceManifest(m)).toBe(true);
    expect(snowIceLine(m)).toBe('snow & ice 21 Oct (IMS) · Antarctic sea ice 17 Oct');
    expect(snowIceLine({ ...m, seaIceSouth: undefined })).toBe('snow & ice 21 Oct (IMS)');
  });
});

describe('GDACS events', () => {
  const ev = (over: Partial<GdacsEvent>): GdacsEvent => ({
    id: 'WF-1',
    type: 'WF',
    name: 'Australia',
    country: 'Australia',
    alert: 'Green',
    pos: [131.7, -18.3],
    from: '2026-10-15T00:00:00.000Z',
    to: '2026-10-21T00:00:00.000Z',
    url: '',
    ...over,
  });
  const now = Date.parse('2026-10-21T22:00:00Z');

  it('titles and details read like the other callouts', () => {
    expect(eventTitle(ev({ areaHa: 66445, name: 'Mozambique' }))).toBe('WILDFIRE · MOZAMBIQUE');
    expect(eventDetail(ev({ areaHa: 66445 }), now)).toBe('66,445 HA BURNED');
    const kanlaon = ev({ type: 'VO', name: 'Kanlaon', country: 'Philippines', alert: 'Orange', from: '2026-10-10T05:58:00.000Z' });
    expect(eventTitle(kanlaon)).toBe('ERUPTION · KANLAON');
    expect(eventDetail(kanlaon, now)).toBe('PHILIPPINES · 11 DAYS AGO');
    expect(eventDetail(ev({ type: 'FL', name: 'Italy', from: '2026-10-07T01:00:00.000Z' }), now)).toBe('SINCE 7 OCT');
  });

  it('labels floods, eruptions and alerts, but only the largest few green fires', () => {
    const fires = [1, 2, 3, 4, 5].map((i) => ev({ id: `WF-${i}`, areaHa: i * 1000 }));
    const all = [...fires, ev({ id: 'WF-9', alert: 'Orange', areaHa: 10 }), ev({ id: 'FL-1', type: 'FL' }), ev({ id: 'VO-1', type: 'VO' })];
    expect(labelledEvents(all).map((e) => e.id)).toEqual(['WF-3', 'WF-4', 'WF-5', 'WF-9', 'FL-1', 'VO-1']);
  });

  it('draws burned area to scale and alerts bigger', () => {
    expect(burnedRadiusKm(66445)).toBeCloseTo(14.54, 2); // 664 km² as a circle
    expect(eventSize('Red')).toBeGreaterThan(eventSize('Orange'));
    expect(eventSize('Orange')).toBeGreaterThan(eventSize('Green'));
  });

  it('summarises the counts', () => {
    const m = { generated: 'x', volcanoDays: 90, counts: { FL: 3, WF: 78, VO: 1 }, events: [] };
    expect(isEventManifest(m)).toBe(true);
    expect(eventLine(m)).toBe('GDACS 3 floods · 78 wildfires · 1 eruption (90 d)');
  });
});

describe('smoke', () => {
  it('summarises the analysis day, its end and the heavy plumes', () => {
    const m = { generated: 'x', date: '2026-10-21', image: 'smoke.png', plumes: { Light: 166, Medium: 60, Heavy: 8 }, latest: '2026-10-21T20:00:00.000Z' };
    expect(smokeLine(m)).toBe('smoke 21 Oct to 20:00Z (HMS): 234 plumes, 8 heavy');
    expect(smokeLine({ ...m, plumes: { Light: 1, Medium: 0, Heavy: 0 }, latest: null })).toBe('smoke 21 Oct (HMS): 1 plume');
  });
});

describe('GDACS impact levels', () => {
  it('reads alert colours as impact', async () => {
    const { impactLevel, IMPACT_COLOR } = await import('../hazards');
    expect(['Green', 'Orange', 'Red', 'red', ' Orange '].map(impactLevel)).toEqual([1, 2, 3, 3, 2]);
    expect(impactLevel('Unknown')).toBe(0);
    expect(impactLevel(null)).toBe(0);
    expect(IMPACT_COLOR[3]).toBe('#ff4d4d');
  });
});
