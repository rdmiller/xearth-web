import { describe, expect, it } from 'vitest';
import fixture from './fixtures/meteoalarm-2026-10-23.json';
import {
  alarmGroups,
  alarmInfo,
  alarmRows,
  alarmSummary,
  freshRed,
  inMeteoAlarmArea,
  isAlarmManifest,
  labelledAlarms,
  labelRegion,
  placeAlarms,
  redToast,
  regionStates,
  regionWarnings,
  type AlarmManifest,
} from '../meteoalarm';

// The pipeline's output for real warnings from seven countries' feeds, 2026-10-23 19:31 UTC:
// a red wind warning on the Harz above 1000 m, yellow ones around it and in Belgium and
// Switzerland in force; orange gales off north-west Ireland and yellow rain there and wind in
// Croatia still to come.
const m = fixture as unknown as AlarmManifest;
const NOW = Date.parse('2026-10-23T19:31:00Z');
const HARZ = 'DE093';

describe('MeteoAlarm warnings', () => {
  it('reads the manifest', () => {
    expect(isAlarmManifest(m)).toBe(true);
    expect(isAlarmManifest({ generated: 'x', warnings: [] })).toBe(false);
  });

  it('gives each region its worst warning in force and its worst to come', () => {
    const s = regionStates(m, NOW);
    expect(s.get(HARZ)).toEqual({ now: 4, soon: 0 }); // red over the yellow
    expect(s.get('BE009')).toEqual({ now: 2, soon: 0 });
    expect(s.get('EI820')).toEqual({ now: 0, soon: 3 });
    expect(s.get('HR-08')).toEqual({ now: 0, soon: 2 });
    expect(s.size).toBe(Object.keys(m.regions).length);
    // Once they've all run out, nothing's left.
    expect(regionStates(m, Date.parse('2026-10-26T00:00:00Z')).size).toBe(0);
  });

  it('draws fills lowest level first, then the outlines of what’s to come', () => {
    const groups = alarmGroups(regionStates(m, NOW)).map((g) => [g.upcoming, g.level, g.keys.length]);
    expect(groups).toEqual([
      [false, 2, 5],
      [false, 4, 1],
      [true, 2, 10],
      [true, 3, 5],
    ]);
  });

  it('lists a region’s warnings, in force and worst first', () => {
    expect(regionWarnings(m, HARZ, NOW).map((w) => w.level)).toEqual([4, 2]);
    // Next morning the yellow has run out and the red is still on.
    expect(regionWarnings(m, HARZ, Date.parse('2026-10-24T03:00:00Z')).map((w) => w.level)).toEqual([4]);
  });

  it('opens a window on the region', () => {
    const info = alarmInfo(m, HARZ, NOW, [10.9, 51.7])!;
    expect(info.title).toBe('Kreis Harz - Bergland (Oberharz)');
    expect(info.color).toBe('#ff0000');
    expect(info.status).toEqual({ text: 'RED · IN FORCE', tone: 'bad' });
    expect(info.tiles).toEqual([
      { label: 'Red · Wind', value: 'until Sat 12:00Z' },
      { label: 'Yellow · Wind', value: 'until Sat 02:00Z' },
      { label: 'Country', value: 'Germany' },
      { label: 'Issued by', value: 'Deutscher Wetterdienst' },
    ]);
    expect(info.notes[0]).toBe('Official SEVERE WEATHER WARNING of HURRICANE-FORCE GUSTS');
    expect(info.link).toEqual({ href: 'https://dwd.de/warnungen', text: 'Deutscher Wetterdienst' });
    const ireland = alarmInfo(m, 'EI820', NOW, undefined)!;
    expect(ireland.status).toEqual({ text: 'ORANGE · TO COME', tone: 'warn' });
    expect(ireland.tiles[0]).toEqual({ label: 'Orange · Wind', value: 'from Sat 17:00Z' });
    expect(alarmInfo(m, 'nowhere', NOW, undefined)).toBeUndefined();
  });

  it('links to MeteoAlarm instead of a warning page that is not https', () => {
    const hostile = structuredClone(m);
    for (const w of hostile.warnings) w.web = 'javascript:alert(document.domain)';
    expect(alarmInfo(hostile, HARZ, NOW, undefined)!.link).toEqual({ href: 'https://meteoalarm.org/', text: 'MeteoAlarm' });
  });

  it('labels and announces red warnings, once', () => {
    const reds = labelledAlarms(m, NOW);
    expect(reds).toHaveLength(1);
    expect(labelRegion(m, reds[0])).toBe(HARZ);
    expect(alarmRows(m, reds[0], HARZ, NOW)).toEqual(['RED WIND WARNING', 'KREIS HARZ - BERGLAND (OBERHARZ)', 'GERMANY · UNTIL 24 OCT 12:00Z']);
    const announced = new Set<string>();
    expect(freshRed(m, announced, NOW)).toEqual(reds);
    expect(freshRed(m, announced, NOW)).toEqual([]);
    expect(redToast(m, reds[0])).toBe('Red wind warning — Kreis Harz - Bergland (Oberharz), Germany');
  });

  it('sums up regions by level', () => {
    expect(alarmSummary(m, NOW)).toBe('1 red · 5 yellow regions · 15 more to come');
    expect(alarmSummary({ ...m, warnings: [] }, NOW)).toBe('no warnings in force');
  });

  it('tells a place in the Harz about its warnings', () => {
    const brocken = placeAlarms(m, 51.8, 10.62, NOW);
    expect(brocken).toEqual([
      { level: 'warning', title: 'Red wind warning', detail: 'until 24 Oct 12:00 UTC · Deutscher Wetterdienst' },
      { level: 'advisory', title: 'Yellow wind warning', detail: 'until 24 Oct 02:00 UTC · Deutscher Wetterdienst' },
    ]);
    expect(placeAlarms(m, 48.86, 2.35, NOW)).toEqual([]); // Paris: nothing in this sample
    expect(inMeteoAlarmArea(51.8, 10.62)).toBe(true);
    expect(inMeteoAlarmArea(28.3, -16.5)).toBe(true); // Tenerife
    expect(inMeteoAlarmArea(40.7, -74)).toBe(false);
  });
});
