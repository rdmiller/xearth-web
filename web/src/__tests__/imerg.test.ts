import { afterEach, describe, expect, it, vi } from 'vitest';
import colormapXml from './fixtures/gpm-colormap-2026-10-23.xml?raw';
import { dbz, IMERG_HEIGHT, IMERG_WIDTH, newestTime, parseColormap, recolour, recolourPixels, tileBitmap, tileUrl, timesUrl, universalBlue } from '../imerg';
import { coverageUrls } from '../radar';
import { HOTKEYS } from '../hotkeys';
import { defaults, type Settings } from '../params';

const table = parseColormap(colormapXml);

describe('IMERG from GIBS', () => {
  it('asks GIBS for the 2 km tiles and the newest half hour', () => {
    expect(tileUrl('2026-10-22T20:30:00Z', 1, 4)).toBe(
      'https://gibs.earthdata.nasa.gov/wmts/epsg4326/best/IMERG_Precipitation_Rate_30min/default/2026-10-22T20:30:00Z/2km/2/1/4.png',
    );
    expect(timesUrl(new Date('2026-10-23T02:10:30Z'))).toMatch(/\/2km\/all\/2026-10-22T14:10:00Z--2026-10-23T02:10:00Z\.xml$/);
    expect(newestTime('<Domain>2026-10-22T16:30:00Z/2026-10-22T20:30:00Z/PT30M</Domain>')).toBe('2026-10-22T20:30:00Z');
    expect(newestTime('<Domains/>')).toBeUndefined();
    expect([IMERG_WIDTH, IMERG_HEIGHT]).toEqual([2560, 1280]); // 0.140625° a pixel
  });

  it('reads GIBS’s colour map (2026-10-23) into rain and snow rates', () => {
    const phases = [...table.values()].map((v) => v.phase);
    expect(phases.filter((p) => p === 'rain').length).toBeGreaterThan(80);
    expect(phases.filter((p) => p === 'snow').length).toBeGreaterThan(50);
    // The palest green: rain of 0.1–0.106 mm/h.
    const lightest = table.get((0 << 16) | (118 << 8) | 78)!;
    expect(lightest.phase).toBe('rain');
    expect(lightest.rate).toBeCloseTo(0.103, 2);
    // The top entry, [53.09, +INF), stands just above its floor.
    expect(table.get((58 << 16) | (3 << 8) | 48)?.rate).toBeCloseTo(56.3, 0);
  });

  it('turns rates into the reflectivity a radar would see', () => {
    expect(dbz('rain', 1)).toBeCloseTo(23, 0); // 200 → 23 dBZ
    expect(dbz('rain', 0.316)).toBeCloseTo(15, 0); // the radar layer's cut
    expect(dbz('rain', 50)).toBeCloseTo(50.2, 0);
    expect(dbz('snow', Math.sqrt(10 / 75))).toBeCloseTo(10, 5);
  });

  it('colours them in RainViewer’s Universal Blue, cut where the radar is cut', () => {
    expect(universalBlue('rain', 14.9)).toBeNull();
    expect(universalBlue('rain', 15)).toBe(0x88ddee);
    expect(universalBlue('rain', 16)).toBe(0x6cd1eb); // the table's own 16 dBZ
    expect(universalBlue('rain', 21)).toBe(0x009ad5);
    expect(universalBlue('rain', 34.5)).toBe(0x004768); // between segments: the lower one's end
    expect(universalBlue('rain', 41)).toBe(0xff9f00);
    expect(universalBlue('rain', 46)).toBe(0xf23600);
    expect(universalBlue('snow', 9.9)).toBeNull();
    expect(universalBlue('snow', 10)).toBe(0xbfffff);
    expect(universalBlue('snow', 26)).toBe(0x5b9bff);
    expect(universalBlue('rain', 120)).toBe(0x00ff00);
  });

  it('recolours GIBS pixels, dropping drizzle and transparency', () => {
    expect(recolour(table, (0 << 16) | (118 << 8) | 78)).toBeNull(); // 0.1 mm/h: under 15 dBZ
    const px = new Uint8ClampedArray([
      191, 191, 191, 0, // no rain (transparent in GIBS)
      0, 118, 78, 255, // drizzle
      58, 3, 48, 255, // the heaviest
    ]);
    expect(recolourPixels(table, px)).toBeCloseTo(1 / 3);
    expect(Array.from(px.slice(0, 8))).toEqual([0, 0, 0, 0, 0, 0, 0, 0]);
    expect(px[11]).toBe(255);
  });

  describe('a tile GIBS doesn’t have', () => {
    afterEach(() => vi.unstubAllGlobals());
    const url = tileUrl('2026-10-24T04:00:00Z', 0, 0);

    it('is missing, not an error, when its CORS-less 404 arrives as a network error', async () => {
      vi.stubGlobal('fetch', () => Promise.reject(new TypeError('Failed to fetch')));
      await expect(tileBitmap(url)).resolves.toBeNull();
    });

    it('is missing on a readable 404, and a server error still throws', async () => {
      vi.stubGlobal('fetch', () => Promise.resolve(new Response('', { status: 404 })));
      await expect(tileBitmap(url)).resolves.toBeNull();
      vi.stubGlobal('fetch', () => Promise.resolve(new Response('', { status: 503 })));
      await expect(tileBitmap(url)).rejects.toThrow('503 GIBS IMERG tile');
    });
  });
});

describe('radar coverage', () => {
  it('asks for RainViewer’s coverage tiles at zoom 2', () => {
    const urls = coverageUrls('https://tilecache.rainviewer.com');
    expect(urls).toHaveLength(16);
    expect(urls[5].url).toBe('https://tilecache.rainviewer.com/v2/coverage/0/512/2/1/1/0/0_0.png');
  });
});

describe('Shift+R cycles the rain layers', () => {
  it('radar with satellite rain → radar only → off → both', () => {
    let s: Settings = defaults();
    const key = HOTKEYS.find((h) => h.keys.includes('shift+r'))!;
    const seen: string[] = [];
    const ctx = { settings: s, update: (p: Partial<Settings>) => (s = ctx.settings = { ...s, ...p }), toast: (t: string) => seen.push(t) };
    for (let i = 0; i < 3; i++) key.run(ctx as never, {} as KeyboardEvent);
    expect(s).toMatchObject({ radar: true, imerg: true });
    expect(seen).toEqual(['Radar only (RainViewer)', 'Radar off', 'Radar (RainViewer), and satellite rain where there’s none (NASA IMERG)']);
  });
});
