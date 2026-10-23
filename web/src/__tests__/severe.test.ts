import { describe, expect, it } from 'vitest';
import nwsJson from './fixtures/nws-warnings-2026-10-23.json';
import spcJson from './fixtures/spc-day1-2026-10-23.json';
import {
  decodeOutlook,
  decodeWarnings,
  densify,
  NWS_WARNINGS_URL,
  outlookRows,
  outlookTop,
  polygonsOf,
  severeSummary,
  warningLabelled,
  warningRows,
  warningTags,
  type SevereWarning,
} from '../severe';

const square: [number, number][] = [
  [-97, 37],
  [-96.8, 37],
  [-96.8, 37.2],
  [-97, 37.2],
  [-97, 37],
];

const feature = (event: string, props: Record<string, unknown> = {}, geometry: unknown = { type: 'Polygon', coordinates: [square] }) => ({
  geometry,
  properties: { id: `id-${event}`, event, status: 'Actual', messageType: 'Alert', areaDesc: 'Sedgwick, KS; Butler, KS', sent: '2026-10-23T01:40:00-05:00', expires: '2026-10-23T02:30:00-05:00', ...props },
});

describe('NWS storm-based warnings', () => {
  it('asks only for the warning types drawn as polygons, real ones only', () => {
    const url = new URL(NWS_WARNINGS_URL);
    expect(url.host).toBe('api.weather.gov');
    expect(url.searchParams.get('status')).toBe('actual');
    expect(url.searchParams.get('event')?.split(',')).toContain('Tornado Warning');
    expect(url.searchParams.get('event')).not.toMatch(/Watch/);
  });

  it('decodes live warnings (2026-10-23), with NWS’s own threat tags', () => {
    const w = decodeWarnings(nwsJson);
    expect(w.map((x) => x.event)).toEqual(['Flash Flood Warning', 'Severe Thunderstorm Warning']);
    expect(w[0].tags).toEqual(['OBSERVED']);
    expect(w[1].tags).toEqual(['60 MPH']);
    expect(w.every((x) => x.polygons.length && x.polygons[0][0].length >= 4)).toBe(true);
    expect(w.some(warningLabelled)).toBe(false); // neither is a tornado or "destructive"
  });

  it('drops tests, cancellations, other events and warnings without a polygon', () => {
    const w = decodeWarnings({
      features: [
        feature('Tornado Warning', { status: 'Test' }),
        feature('Tornado Warning', { messageType: 'Cancel' }),
        feature('Flood Warning'),
        feature('Severe Thunderstorm Warning', {}, null),
        feature('Tornado Warning'),
      ],
    });
    expect(w.map((x) => x.event)).toEqual(['Tornado Warning']);
    expect(decodeWarnings(null)).toEqual([]);
  });

  it('tags the threat and marks the extreme ones', () => {
    expect(warningTags({ tornadoDetection: ['OBSERVED'], tornadoDamageThreat: ['CONSIDERABLE'], maxHailSize: ['1.75'], maxWindGust: ['0 MPH'] })).toEqual([
      'OBSERVED',
      '1.75 IN HAIL',
      'CONSIDERABLE',
    ]);
    const [pds] = decodeWarnings({ features: [feature('Tornado Warning', { parameters: { tornadoDetection: ['OBSERVED'], tornadoDamageThreat: ['CONSIDERABLE'] } })] });
    expect(pds.extreme).toBe(true);
    const [svr] = decodeWarnings({ features: [feature('Severe Thunderstorm Warning', { parameters: { thunderstormDamageThreat: ['DESTRUCTIVE'], maxWindGust: ['80 MPH'] } })] });
    expect(svr.extreme).toBe(true);
    expect(warningLabelled(svr)).toBe(true);
  });

  it('labels a warning with its threat, first area and end time', () => {
    const [w] = decodeWarnings({ features: [feature('Tornado Warning', { parameters: { tornadoDetection: ['RADAR INDICATED'] } })] });
    expect(warningRows(w)).toEqual(['TORNADO WARNING · RADAR INDICATED', 'SEDGWICK, KS +1', 'UNTIL 07:30Z']);
  });

  it('reads MultiPolygons too', () => {
    expect(polygonsOf({ type: 'MultiPolygon', coordinates: [[square], [square]] })).toHaveLength(2);
    expect(polygonsOf({ type: 'Point', coordinates: [0, 0] })).toEqual([]);
  });
});

describe('SPC day-1 outlook', () => {
  it('decodes the live outlook (2026-10-23) low to high, in SPC’s colours, holes and all', () => {
    const o = decodeOutlook(spcJson)!;
    expect(o.areas.map((a) => a.level)).toEqual(['TSTM', 'MRGL', 'SLGT']);
    expect(o.areas[2]).toMatchObject({ name: 'Slight Risk', stroke: '#DDAA00', fill: '#FFE066' });
    // Non-layered: Marginal has a hole where Slight sits.
    expect(o.areas[1].polygons[0].length).toBe(2);
    expect(o.expires).toBe('2026-10-23T12:00:00+00:00');
    const top = outlookTop(o)!;
    expect(top.level).toBe('SLGT');
    expect(outlookRows(o, top)).toEqual(['SPC DAY 1 · SLIGHT RISK', 'SEVERE STORMS OUTLOOK · UNTIL 12:00Z']);
  });

  it('labels nothing below Slight Risk', () => {
    const o = decodeOutlook(spcJson)!;
    expect(outlookTop({ ...o, areas: o.areas.slice(0, 2) })).toBeUndefined();
    expect(outlookTop(null)).toBeUndefined();
  });
});

describe('drawing helpers', () => {
  it('adds points along long edges so they follow the globe', () => {
    const d = densify([
      [0, 0],
      [3, 0],
    ]);
    expect(d).toEqual([
      [0, 0],
      [1, 0],
      [2, 0],
      [3, 0],
    ]);
    expect(densify(square)).toEqual(square); // short edges stay as they are
  });

  it('summarises warnings and the outlook for the readout', () => {
    const w = (event: SevereWarning['event']) => ({ event }) as SevereWarning;
    const o = decodeOutlook(spcJson);
    expect(severeSummary([w('Tornado Warning'), w('Flash Flood Warning'), w('Tornado Warning')], o)).toBe('2 tornado · 1 flash flood warnings · SPC slight risk');
    expect(severeSummary([], o)).toBe('no warnings · SPC slight risk');
    expect(severeSummary([], null)).toBe('no warnings');
  });
});
