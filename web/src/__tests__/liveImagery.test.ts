import { describe, expect, it } from 'vitest';
import { DETAIL_BELOW_DEG_PER_PX, rangeBounds } from '../gibs';
import {
  bestSource,
  discBox,
  discSize,
  getMapUrl,
  LIVE_SOURCES,
  liveRange,
  isBlankPixels,
  listTimes,
  parseGibsDomain,
  probeUrl,
  parseWmsTime,
  timesUrl,
  viewAngleDeg,
  wmsParts,
} from '../liveImagery';

const source = (key: string) => LIVE_SOURCES.find((s) => s.key === key)!;

describe('live imagery sources', () => {
  it('runs west to east: GOES-West, GOES-East, MTG', () => {
    expect(LIVE_SOURCES.map((s) => s.key)).toEqual(['goes-west', 'goes-east', 'mtg']);
  });

  it('picks the satellite seeing a place most face-on, and none over Asia', () => {
    expect(bestSource(19.4, -155.3)?.key).toBe('goes-west'); // Hawaii
    expect(bestSource(25.8, -80.2)?.key).toBe('goes-east'); // Miami
    expect(bestSource(-1.3, 36.8)?.key).toBe('mtg'); // Nairobi
    expect(bestSource(51.5, -0.1)?.key).toBe('mtg'); // London
    expect(bestSource(35.7, 139.7)).toBeUndefined(); // Tokyo: Himawari has no colour product
  });

  it('measures the view angle as a great circle from the sub-satellite point', () => {
    expect(viewAngleDeg(0, 0, 0)).toBeCloseTo(0);
    expect(viewAngleDeg(0, 60, 0)).toBeCloseTo(60);
    expect(viewAngleDeg(60, 0, 0)).toBeCloseTo(60);
    expect(viewAngleDeg(45, 45, 0)).toBeCloseTo(60); // cos γ = cos 45° · cos 45° = ½
  });
});

describe('WMS requests', () => {
  it('splits a box over the date line into two side-by-side parts', () => {
    const west = discBox(source('goes-west')); // 141.8°E … 56.2°W
    const parts = wmsParts(west, 1024);
    expect(parts).toHaveLength(2);
    expect(parts[0]).toMatchObject({ lon1: 180, x: 0 });
    expect(parts[0].lon0).toBeCloseTo(141.8);
    expect(parts[1]).toMatchObject({ lon0: -180, x: parts[0].width });
    expect(parts[1].lon1).toBeCloseTo(-56.2);
    expect(parts[0].width + parts[1].width).toBe(1024);
    expect(parts[0].width).toBe(Math.round((1024 * 38.2) / 162));
  });

  it('asks for one part when the box doesn’t cross ±180°', () => {
    expect(wmsParts(discBox(source('mtg')), 1536)).toEqual([{ lon0: -81, lon1: 81, x: 0, width: 1536 }]);
    // A box given past 180° (as tile columns can be) is brought back into range first.
    expect(wmsParts({ lon0: 190, lat1: 10, lonSpan: 20, latSpan: 20 }, 512)).toEqual([{ lon0: -170, lon1: -150, x: 0, width: 512 }]);
  });

  it('builds GetMap URLs with the latitude-first 1.3.0 box and the scan time', () => {
    const url = new URL(getMapUrl(source('goes-east'), '2026-10-23T00:10:00Z', { lon0: -156.2, lon1: 5.8, x: 0, width: 1024 }, -81, 81, 1024));
    expect(url.origin + url.pathname).toBe('https://gibs.earthdata.nasa.gov/wms/epsg4326/best/wms.cgi');
    expect(url.searchParams.get('LAYERS')).toBe('GOES-East_ABI_GeoColor');
    expect(url.searchParams.get('BBOX')).toBe('-81,-156.2,81,5.8');
    expect(url.searchParams.get('FORMAT')).toBe('image/jpeg');
    expect(url.searchParams.get('TIME')).toBe('2026-10-23T00:10:00Z');
    const mtg = new URL(getMapUrl(source('mtg'), '2026-10-23T00:40:00Z', { lon0: -81, lon1: 81, x: 0, width: 1024 }, -81, 81, 1024));
    expect(mtg.host).toBe('view.eumetsat.int');
    expect(mtg.searchParams.get('LAYERS')).toBe('mtg_fd:rgb_geocolour');
  });

  it('asks each server for its newest scan the cheap way', () => {
    const now = new Date('2026-10-23T01:02:34Z');
    expect(timesUrl(source('goes-west'), now)).toBe(
      'https://gibs.earthdata.nasa.gov/wmts/epsg4326/best/1.0.0/GOES-West_ABI_GeoColor/default/1km/all/2026-10-22T22:02:00Z--2026-10-23T01:02:00Z.xml',
    );
    expect(timesUrl(source('mtg'), now)).toBe(
      'https://view.eumetsat.int/geoserver/mtg_fd/rgb_geocolour/ows?service=WMS&request=GetCapabilities&version=1.3.0',
    );
  });
});

describe('newest scan times', () => {
  it('reads GIBS DescribeDomains (as served on 2026-10-23)', () => {
    const xml =
      "<Domains xmlns='http://www.opengis.net/wmts/1.0/domains' xmlns:ows='http://www.opengis.net/ows/1.1'><SpaceDomain><BoundingBox crs='urn:ogc:def:crs:OGC:2:84' miny='-90' maxy='90' minx='-180' maxx='180'/></SpaceDomain><DimensionDomain><ows:Identifier>time</ows:Identifier><Domain>2026-10-22T23:10:00Z/2026-10-23T00:10:00Z/PT10M</Domain><Size>1</Size></DimensionDomain></Domains>";
    expect(parseGibsDomain(xml).slice(0, 3)).toEqual(['2026-10-23T00:10:00Z', '2026-10-23T00:00:00Z', '2026-10-22T23:50:00Z']);
    expect(parseGibsDomain('<Domains></Domains>')).toEqual([]);
  });

  it('lists every scan newest first, keeping the gaps GIBS leaves (as on 2026-10-23)', () => {
    const xml = '<Domain>2026-10-23/2026-10-23T00:10:00Z/PT10M,2026-10-23T00:40:00Z/2026-10-23T00:40:00Z/PT10M</Domain>';
    expect(parseGibsDomain(xml)).toEqual(['2026-10-23T00:40:00Z', '2026-10-23T00:10:00Z', '2026-10-23T00:00:00Z']);
  });

  it('stops at a dozen scans, however long the interval', () => {
    const times = listTimes('2024-09-23T00:00:00.000Z/2026-10-23T00:40:00.000Z/PT10M');
    expect(times).toHaveLength(12);
    expect(times[0]).toBe('2026-10-23T00:40:00Z');
    expect(times[11]).toBe('2026-10-22T22:50:00Z');
  });

  it('reads the time dimension of GeoServer capabilities, preferring its default', () => {
    const xml = `<Layer><Name>li_afa</Name><Dimension name="time" default="2026-10-23T00:50:00Z" units="ISO8601">2025-05-30T15:00:00.000Z/2026-10-23T00:50:00.000Z/PT5M</Dimension></Layer>`;
    expect(parseWmsTime(xml)).toBe('2026-10-23T00:50:00Z');
    const noDefault = `<Dimension units="ISO8601" name="time">2024-09-23T00:00:00.000Z/2026-10-23T00:40:00.000Z/PT10M</Dimension>`;
    expect(parseWmsTime(noDefault)).toBe('2026-10-23T00:40:00Z');
    expect(parseWmsTime('<Dimension name="elevation">0</Dimension>')).toBeUndefined();
  });
});

describe('sizes and ranges', () => {
  it('calls an all-black picture blank, and anything with GeoColor’s night ground not', () => {
    const px = (rgb: number[], n = 16) => new Uint8ClampedArray(Array.from({ length: n }, () => [...rgb, 255]).flat());
    expect(isBlankPixels(px([0, 0, 0]))).toBe(true);
    expect(isBlankPixels(px([3, 2, 4]))).toBe(true); // JPEG noise on black
    expect(isBlankPixels(px([18, 24, 40]))).toBe(false); // the dark blue-grey of its night side
    const one = px([0, 0, 0]);
    one.set([200, 200, 200], 8);
    expect(isBlankPixels(one)).toBe(false);
  });

  it('probes the middle of each disc with a small picture', () => {
    const url = new URL(probeUrl(LIVE_SOURCES[0], '2026-10-23T00:10:00Z'));
    expect(url.searchParams.get('BBOX')).toBe('-40,-177.2,40,-97.2');
    expect([url.searchParams.get('WIDTH'), url.searchParams.get('HEIGHT')]).toEqual(['64', '64']);
  });

  it('fetches discs big enough for the globe on screen, up to 2048 px', () => {
    expect(discSize(300)).toBe(1024);
    expect(discSize(500)).toBe(1536);
    expect(discSize(700)).toBe(2048);
    expect(discSize(5000)).toBe(2048);
  });

  it('asks for a zoomed-in picture only past the Blue Marble, and no finer than ~1 km', () => {
    const box = { lat0: 20, lat1: 30, lon0: -90, lon1: -80 };
    expect(liveRange(box, 0.2, DETAIL_BELOW_DEG_PER_PX)).toBeNull();
    const r = liveRange(box, 0.001, DETAIL_BELOW_DEG_PER_PX)!;
    expect(r.level).toBeLessThanOrEqual(6);
    expect((r.col1 - r.col0 + 1) * (r.row1 - r.row0 + 1)).toBeLessThanOrEqual(16);
    const b = rangeBounds(r);
    expect(b.lon0).toBeLessThanOrEqual(-90);
    expect(b.lon0 + b.lonSpan).toBeGreaterThanOrEqual(-80);
  });
});
