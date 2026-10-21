import { describe, expect, it } from 'vitest';
import {
  clip,
  decodeNwsAlerts,
  isTsunamiManifest,
  nwsColor,
  nwsRows,
  sampleZones,
  TSUNAMI_COLOR,
  tsunamiLabelled,
  tsunamiLine,
  tsunamiRows,
  tsunamiShown,
  zoneCentroid,
  type TsunamiBulletin,
  type TsunamiManifest,
} from '../tsunami';

const NOW = Date.parse('2026-10-21T22:30:00Z');

// As published by the pipeline from tsunami.gov on 2026-10-21 (two NTWC/PTWC information statements).
const SAND_POINT: TsunamiBulletin = {
  id: 'NTWC-96108cb5',
  center: 'NTWC',
  category: 'information',
  region: '45 miles SE of Sand Point, Alaska',
  lat: 54.634,
  lon: -160.218,
  magnitude: 5.0,
  magnitudeType: 'Ml',
  issued: '2026-10-20T10:45:01.000Z',
  note: 'There is NO tsunami danger from this earthquake.',
  bulletin: null,
};

// An archived NWS alert of 2026-10-21, trimmed: NWS sends routine "Test" warnings through the live feed.
const NWS_TEST = {
  features: [
    {
      properties: {
        id: 'urn:oid:2.49.0.1.840.0.e448',
        event: 'Tsunami Warning',
        status: 'Test',
        messageType: 'Alert',
        headline: 'TEST Tsunami Warning issued October 21 at 9:31AM PDT',
        areaDesc: 'San Pablo Bay, Suisun Bay, the West Delta and  the San Francisco Bay north of the Bay Bridge; San Francisco Bay South of the Bay Bridge; San Diego County Coastal Areas',
        sent: '2026-10-21T09:31:00-07:00',
        ends: '2026-10-21T10:31:00-07:00',
        affectedZones: ['https://api.weather.gov/zones/forecast/PZZ530', 'https://api.weather.gov/zones/forecast/PZZ531'],
      },
    },
  ],
};

describe('tsunami bulletins', () => {
  it('shows alerts for the whole window, statements for a day, and labels statements for 6 h', () => {
    const fresh = { ...SAND_POINT, issued: '2026-10-21T20:30:00.000Z' };
    expect(tsunamiShown(SAND_POINT, NOW)).toBe(false); // 36 h old
    expect(tsunamiShown(fresh, NOW)).toBe(true);
    expect(tsunamiLabelled(fresh, NOW)).toBe(true);
    expect(tsunamiLabelled({ ...fresh, issued: '2026-10-21T10:30:00.000Z' }, NOW)).toBe(false);
    const warning = { ...SAND_POINT, category: 'warning' };
    expect(tsunamiShown(warning, NOW) && tsunamiLabelled(warning, NOW)).toBe(true);
  });

  it('reads as category, magnitude and region, then age and note', () => {
    expect(tsunamiRows({ ...SAND_POINT, issued: '2026-10-21T20:30:00.000Z' }, NOW)).toEqual([
      'TSUNAMI INFORMATION · NTWC',
      'M5.0 · 45 MILES SE OF SAND POINT, ALASKA',
      '2 H AGO · THERE IS NO TSUNAMI DANGER FROM THIS EARTHQUAKE',
    ]);
    expect(TSUNAMI_COLOR.warning).not.toBe(TSUNAMI_COLOR.information);
  });

  it('clips long text at a word, never mid-word', () => {
    expect(clip('HAZARDOUS TSUNAMI WAVES ARE FORECAST FOR SOME COASTS', 40)).toBe('HAZARDOUS TSUNAMI WAVES ARE FORECAST…');
    expect(clip('the  West Delta', 40)).toBe('the West Delta');
  });

  it('summarises NWS alerts first, then the centers', () => {
    const m: TsunamiManifest = { generated: 'x', centers: ['NTWC', 'PTWC'], maxAgeHours: 48, bulletins: [SAND_POINT] };
    expect(isTsunamiManifest(m)).toBe(true);
    expect(tsunamiLine(m, [], NOW)).toBe('no tsunami alerts');
    const alert = { id: 'a', event: 'Tsunami Warning', headline: '', areaDesc: '', sent: '', expires: null, zones: [] };
    const warn = { ...SAND_POINT, category: 'warning' };
    expect(tsunamiLine({ ...m, bulletins: [warn] }, [alert], NOW)).toBe('TSUNAMI WARNING in effect (NWS) · 1 tsunami alert (NTWC/PTWC)');
    expect(tsunamiLine(undefined, [], NOW)).toBeUndefined();
  });
});

describe('NWS tsunami alerts', () => {
  it('drops test messages and keeps real ones', () => {
    expect(decodeNwsAlerts(NWS_TEST)).toEqual([]);
    const real = { features: [{ properties: { ...NWS_TEST.features[0].properties, status: 'Actual' } }] };
    const [a] = decodeNwsAlerts(real);
    expect(a).toMatchObject({ event: 'Tsunami Warning', expires: '2026-10-21T10:31:00-07:00', zones: NWS_TEST.features[0].properties.affectedZones });
    expect(decodeNwsAlerts({ features: [{ properties: { ...real.features[0].properties, messageType: 'Cancel' } }] })).toEqual([]);
    expect(decodeNwsAlerts(null)).toEqual([]);
  });

  it('labels with the event, first area and end time', () => {
    const [a] = decodeNwsAlerts({ features: [{ properties: { ...NWS_TEST.features[0].properties, status: 'Actual' } }] });
    expect(nwsRows(a)).toEqual([
      'TSUNAMI WARNING · NWS',
      'SAN PABLO BAY, SUISUN BAY, THE WEST DELTA… (+2 MORE AREAS)',
      'UNTIL 17:31Z · 2 ZONES',
    ]);
    expect(nwsColor('Tsunami Advisory')).toBe(TSUNAMI_COLOR.advisory);
  });

  it('samples zones evenly and finds a centroid for polygons and multipolygons', () => {
    const zones = Array.from({ length: 100 }, (_, i) => `z${i}`);
    expect(sampleZones(zones, 4)).toEqual(['z0', 'z25', 'z50', 'z75']);
    expect(sampleZones(zones.slice(0, 3))).toHaveLength(3);
    const square = [[-122, 37], [-121, 37], [-121, 38], [-122, 38]];
    expect(zoneCentroid({ type: 'Polygon', coordinates: [square] })).toEqual([-121.5, 37.5]);
    expect(zoneCentroid({ type: 'MultiPolygon', coordinates: [[[[0, 0], [1, 0], [0, 1]]], [square]] })).toEqual([-121.5, 37.5]);
    expect(zoneCentroid(null)).toBeNull();
  });
});
