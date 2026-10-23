import { describe, expect, it } from 'vitest';
import { ASH_SOURCES, ashSourceAt, ashVolcanoes, maskAshNoData, seenBy, volcanoLine } from '../ash';
import type { GdacsEvent } from '../hazards';
import { bestSource, discBox, wmsParts } from '../liveImagery';

const eruption = (name: string, country: string, lon: number, lat: number, from: string | null): GdacsEvent => ({
  id: `VO-${name}`,
  type: 'VO',
  name,
  country,
  alert: 'Orange',
  pos: [lon, lat],
  from,
  to: from,
  url: '',
});

describe('which Ash RGB shows a volcano', () => {
  it('uses MSG 0° where it sees well, the Indian Ocean disc east of it, else the Geo Ring', () => {
    expect(ashSourceAt(37.75, 15.0)?.key).toBe('ash-msg'); // Etna
    expect(ashSourceAt(-1.52, 29.25)?.key).toBe('ash-msg'); // Nyiragongo
    expect(ashSourceAt(-6.1, 105.42)?.key).toBe('ash-iodc'); // Krakatau, 60° from 45.5°E
    expect(ashSourceAt(14.01, 121.0)?.key).toBe('ash-ring'); // Taal: past both discs
    expect(ashSourceAt(19.42, -155.29)?.key).toBe('ash-ring'); // Kīlauea
    expect(ashSourceAt(-77.53, 167.15)).toBeUndefined(); // Erebus: past the Geo Ring's reach
  });

  it('asks for the Geo Ring as the whole world in one request, and never picks it as a disc', () => {
    const ring = ASH_SOURCES.find((s) => s.global)!;
    expect(ring.layer).toBe('mumi:wideareacoverage_rgb_ash');
    expect(discBox(ring)).toEqual({ lon0: -180, lat1: 90, lonSpan: 360, latSpan: 180 });
    expect(wmsParts(discBox(ring), 1024)).toEqual([{ lon0: -180, lon1: 180, x: 0, width: 1024 }]);
    expect(bestSource(14, 121, ASH_SOURCES)).toBeUndefined();
  });
});

describe('the toast’s eruptions', () => {
  const now = Date.parse('2026-10-23T18:00:00Z');
  const list = ashVolcanoes(
    [
      eruption('Krakatau', 'Indonesia', 105.42, -6.1, '2026-09-04T21:00:00Z'),
      eruption('Kanlaon', 'Philippines', 123.13, 10.41, '2026-10-10T05:58:00Z'),
      eruption('Nameless', 'Nowhere', 0, 0, null),
      { ...eruption('Flood', 'X', 0, 0, '2026-10-22T00:00:00Z'), type: 'FL' },
    ],
    now,
  );

  it('lists GDACS’s eruptions only, newest first, undated last', () => {
    expect(list.map((v) => v.event.name)).toEqual(['Kanlaon', 'Krakatau', 'Nameless']);
    expect(list.map((v) => v.daysAgo)).toEqual([13, 48, undefined]);
  });

  it('says which picture shows each, and how often it’s new', () => {
    expect(volcanoLine(list[0])).toBe('erupted 10 Oct · 13 d ago · Geo Ring · every 3 h');
    // en-GB's September is "Sep" or "Sept" depending on the ICU version.
    expect(volcanoLine(list[1])).toMatch(/^erupted 4 Sept? · 48 d ago · Meteosat-9 · every 15 min$/);
    expect(volcanoLine(list[2])).toBe('date unknown · MSG 0° · every 15 min');
    expect(seenBy(undefined)).toBe('outside the ash pictures');
  });
});

describe('no data', () => {
  it('makes white transparent, and the pale JPEG band around it, but not the picture beyond', () => {
    // One row: white, a pale blend (weakest channel ~0.7), then real colours.
    const row = [
      [255, 255, 255],
      [200, 255, 180],
      [120, 200, 60],
      [100, 180, 240],
      [90, 60, 20],
      [30, 40, 120],
    ];
    const px = new Uint8ClampedArray(row.flatMap(([r, g, b]) => [r, g, b, 255]));
    maskAshNoData(px, row.length, 1);
    const alpha = Array.from({ length: row.length }, (_, i) => px[i * 4 + 3]);
    expect(alpha).toEqual([0, 0, 0, 0, 255, 255]);
    expect(Array.from(px.slice(16, 20))).toEqual([90, 60, 20, 255]);
  });

  it('keeps the palest desert pink, which a lower cutoff would have holed', () => {
    const px = new Uint8ClampedArray([236, 224, 238, 255]); // weakest channel 224, the Sahara's palest
    maskAshNoData(px, 1, 1);
    expect(px[3]).toBe(255);
  });
});
