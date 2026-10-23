import { describe, expect, it } from 'vitest';
import {
  buoyLine,
  buoySummary,
  buoyTitle,
  drift,
  ends,
  isBuoyHistory,
  isBuoyManifest,
  nearestBuoy,
  pickNearest,
  tendency,
  type Buoy,
  type BuoyManifest,
} from '../buoys';
import { HOTKEYS } from '../hotkeys';
import { defaults, parseSettings, toQuery } from '../params';

// As the pipeline wrote them on 2026-10-23.
const SF: Buoy = {
  id: '46026',
  type: 'moored',
  name: 'SAN FRANCISCO - 18NM West of San Francisco, CA',
  lat: 37.75,
  lon: -122.838,
  time: '2026-10-23T10:20:00.000Z',
  sst: 16.1,
  slp: 1015.4,
  wspd: 8,
  wdir: 320,
  gust: 9,
  wvht: 2.3,
  dpd: 9,
  mwd: 287,
};
const DRIFTER: Buoy = { id: '4402591', type: 'drifting', lat: 30.4, lon: -39.9, time: '2026-10-23T08:00:00.000Z', sst: 24.7, slp: 1017 };
const DART: Buoy = { id: '21415', type: 'dart', name: 'ATTU - 175 NM South of Attu, AK', lat: 50.12, lon: 171.867, time: '2026-10-23T06:00:00.000Z', height: 4718.005, event: false };
const M: BuoyManifest = {
  generated: '2026-10-23T10:48:00.000Z',
  source: 'NOAA OSMC; NOAA NDBC',
  from: '2026-10-22T11:00:00.000Z',
  to: '2026-10-23T11:00:00.000Z',
  counts: { moored: 1, drifting: 1, dart: 1 },
  buoys: [SF, DRIFTER, DART],
};

describe('buoys', () => {
  it('recognises both files', () => {
    expect(isBuoyManifest(M)).toBe(true);
    expect(isBuoyManifest({ buoys: 'x' })).toBe(false);
    expect(isBuoyHistory({ generated: 'x', from: 'x', stepMin: 60, hours: 24, series: {}, dart: {} })).toBe(true);
  });

  it('titles a buoy by id and NDBC’s place name, else by kind', () => {
    expect(buoyTitle(SF)).toBe('46026 · San Francisco');
    expect(buoyTitle(DART)).toBe('21415 · Attu');
    expect(buoyTitle(DRIFTER)).toBe('Drifting buoy 4402591');
  });

  it('picks the nearest dot within reach of a click', () => {
    const pts = [
      { x: 100, y: 100 },
      { x: 108, y: 100 },
      { x: 300, y: 300 },
    ];
    expect(pickNearest(pts, 106, 101, 12)).toBe(1);
    expect(pickNearest(pts, 200, 200, 12)).toBe(-1);
  });

  it('finds the nearest buoy to a place, but not a DART (no weather to report)', () => {
    const near = nearestBuoy(M.buoys, 37.77, -122.42, 150)!;
    expect(near.buoy.id).toBe('46026');
    expect(Math.round(near.km)).toBe(37);
    expect(nearestBuoy(M.buoys, 51, 172, 150)).toBeUndefined();
  });

  it('words the place card’s line in the viewer’s units', () => {
    expect(buoyLine(SF, 37, 265, false)).toBe('Buoy 46026 (37 km W): waves 2.3 m every 9 s · water 16.1°C · wind 29 km/h NW');
    expect(buoyLine(SF, 37, 265, true)).toBe('Buoy 46026 (23 mi W): waves 7.5 ft every 9 s · water 61°F · wind 18 mph NW');
  });

  it('says how far a drifter went', () => {
    const s = { lat: [null, 30.1, 30.2, null, 30.4], lon: [null, -40.2, -40.05, null, -39.9] };
    expect(drift(s)).toBe('drifted 44 km toward NE in 3 h');
    expect(drift({ lat: [30, 30], lon: [-40, -40] })).toBe('stayed put over 1 h');
    expect(drift({})).toBeUndefined();
  });

  it('reads the pressure’s 3-hour tendency', () => {
    expect(tendency([1016, 1015.4, 1014.6, 1013.9, null])).toEqual({ hPa: expect.closeTo(-2.1, 5), word: 'falling' });
    expect(tendency([1015, 1015.2, 1015.1, 1015.3])?.word).toBe('steady');
    expect(tendency([1015, null])).toBeUndefined();
    expect(ends([null, 1, null, 3, null])).toEqual({ first: 1, last: 3, i0: 1, i1: 3 });
  });

  it('summarises what’s reporting', () => {
    expect(buoySummary(M)).toBe('3 reporting · 1 drifting · 1 moored · 1 DART');
  });
});

describe('buoy settings', () => {
  it('is off by default, Shift+B turns it on, and a selected buoy goes in the link', () => {
    expect(defaults().buoys).toBe(false);
    expect(defaults().buoy).toBe('');
    expect(parseSettings('?buoys=1&buoy=46026')).toMatchObject({ buoys: true, buoy: '46026' });
    expect(toQuery({ ...defaults(), buoy: '46026' })).toBe('?buoy=46026');
    expect(HOTKEYS.some((h) => h.keys.includes('shift+b'))).toBe(true);
  });
});
