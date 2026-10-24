// Rain and snow where there's no radar: NASA's IMERG, the GPM mission's merged satellite
// estimate, every 30 minutes for the whole globe, from NASA GIBS (CORS-enabled tiles).
//
// IMERG's near-real-time "early" run lands ~5 hours after the half hour it covers, so it
// only fills in where RainViewer has no radars (the oceans, most of Africa, much of Asia and
// South America); where radar sees, radar is fresher and wins. To read as one layer, the
// estimate is drawn in RainViewer's own colours: GIBS's palette is read back to a rate
// (mm/h, from GIBS's colour map), the rate turned into the reflectivity a radar would see,
// and that coloured from RainViewer's Universal Blue table, with the same cut the radar
// layer makes (15 dBZ for rain, 10 for snow).

const GIBS = 'https://gibs.earthdata.nasa.gov/wmts/epsg4326/best';
export const IMERG_LAYER = 'IMERG_Precipitation_Rate_30min';
export const IMERG_COLORMAP = 'https://gibs.earthdata.nasa.gov/colormaps/v1.3/GPM_Precipitation_Rate.xml';
/** GIBS's "2km" tile matrix, level 2: 5×3 tiles of 512 px, 0.140625° a pixel (IMERG is 0.1°). */
const LEVEL = 2;
const COLS = 5;
const ROWS = 3;
const TILE_PX = 512;
export const IMERG_WIDTH = COLS * TILE_PX; // 360°
export const IMERG_HEIGHT = IMERG_WIDTH / 2; // 180°: the third row runs past the South Pole
/** Look for a newer half hour this often (the estimate updates every 30 minutes). */
export const IMERG_CHECK_MS = 15 * 60_000;

export const tileUrl = (time: string, row: number, col: number) => `${GIBS}/${IMERG_LAYER}/default/${time}/2km/${LEVEL}/${row}/${col}.png`;

export function timesUrl(now: Date): string {
  const iso = (d: Date) => `${d.toISOString().slice(0, 16)}:00Z`;
  return `${GIBS}/1.0.0/${IMERG_LAYER}/default/2km/all/${iso(new Date(now.getTime() - 12 * 3_600_000))}--${iso(now)}.xml`;
}

/** The newest half hour in a DescribeDomains answer: `<Domain>start/end/PT30M,…</Domain>`. */
export function newestTime(xml: string): string | undefined {
  const list = /<Domain>([^<]*)<\/Domain>/.exec(xml)?.[1];
  const last = list?.split(',').pop()?.trim().split('/');
  const t = last && (last.length === 3 ? last[1] : last[0]);
  return t && Number.isFinite(Date.parse(t)) ? `${new Date(t).toISOString().slice(0, 19)}Z` : undefined;
}

// ---- rates ----------------------------------------------------------------------------------

export type Phase = 'rain' | 'snow';

/** GIBS palette colour (0xRRGGBB) → what it stands for. */
export type RateTable = Map<number, { phase: Phase; rate: number }>;

/**
 * GIBS's colour map for the layer: a "Rain Rate" and a "Snow Rate" map in mm/h, each entry a
 * colour for a range "[lo,hi)". A colour stands for its range's geometric middle.
 */
export function parseColormap(xml: string): RateTable {
  const table: RateTable = new Map();
  for (const [, title, body] of xml.matchAll(/<ColorMap\b[^>]*title="([^"]*)"[^>]*>([\s\S]*?)<\/ColorMap>/g)) {
    const phase: Phase | undefined = /rain/i.test(title) ? 'rain' : /snow/i.test(title) ? 'snow' : undefined;
    if (!phase) continue;
    for (const [entry] of body.matchAll(/<ColorMapEntry\b[^>]*\/>/g)) {
      if (/transparent="true"/.test(entry)) continue;
      const rgb = /rgb="(\d+),(\d+),(\d+)"/.exec(entry);
      const range = /value="\[([^,]+),([^)\]]+)[)\]]"/.exec(entry);
      if (!rgb || !range) continue;
      const lo = Number(range[1]);
      const hi = Number(range[2]);
      if (!Number.isFinite(lo) || lo <= 0) continue;
      const rate = Number.isFinite(hi) ? Math.sqrt(lo * hi) : lo * 1.06;
      table.set((Number(rgb[1]) << 16) | (Number(rgb[2]) << 8) | Number(rgb[3]), { phase, rate });
    }
  }
  return table;
}

/**
 * The reflectivity a radar would see: Marshall–Palmer Z = 200 R^1.6 for rain, and the US
 * radar network's default Z = 75 S² for snow (S as melted water, mm/h).
 */
export function dbz(phase: Phase, rate: number): number {
  return phase === 'rain' ? 10 * Math.log10(200 * rate ** 1.6) : 10 * Math.log10(75 * rate * rate);
}

/** RainViewer Universal Blue (rainviewer.com/files/rainviewer_api_colors_table.csv), opaque part: [dBZ, 0xRRGGBB], linear between. */
const RAIN_RAMP: [number, number][][] = [
  [[15, 0x88ddee], [20, 0x00a3e0], [25, 0x0077aa], [30, 0x005588], [34, 0x004768]],
  [[35, 0xffee00], [40, 0xffaa00], [44, 0xff8100]],
  [[45, 0xff4400], [50, 0xc10000], [54, 0x5d0000]],
  [[55, 0xffaaff], [64, 0xff4eff]],
  [[65, 0xffffff], [74, 0xffffff]],
  [[75, 0x00ff00], [95, 0x00ff00]],
];
const SNOW_RAMP: [number, number][][] = [[[10, 0xbfffff], [25, 0x5f9fff], [55, 0x003fff], [75, 0x0000ff], [95, 0x0000ff]]];
/** Below these the radar layer drops its echoes (radar.ts, dropWeakEchoes), so these do too. */
export const MIN_DBZ: Record<Phase, number> = { rain: 15, snow: 10 };

/** A reflectivity's colour in Universal Blue (0xRRGGBB), or null below the cut. */
export function universalBlue(phase: Phase, z: number): number | null {
  if (z < MIN_DBZ[phase]) return null;
  const ramps = phase === 'rain' ? RAIN_RAMP : SNOW_RAMP;
  const zc = Math.min(z, 95);
  const seg = [...ramps].reverse().find((r) => zc >= r[0][0]) ?? ramps[0];
  for (let i = 1; i < seg.length; i++) {
    const [z0, c0] = seg[i - 1];
    const [z1, c1] = seg[i];
    if (zc <= z1 || i === seg.length - 1) {
      const t = Math.max(0, Math.min(1, (zc - z0) / (z1 - z0)));
      // Truncated, as the table's own steps are (16 dBZ is 0x6cd1eb).
      const mix = (shift: number) => Math.floor(((c0 >> shift) & 255) + (((c1 >> shift) & 255) - ((c0 >> shift) & 255)) * t + 1e-9);
      return (mix(16) << 16) | (mix(8) << 8) | mix(0);
    }
  }
  return seg[0][1];
}

/** GIBS colour → Universal Blue colour (0xRRGGBB) or null (no rain, or below the cut). */
export function recolour(table: RateTable, rgb: number): number | null {
  const v = table.get(rgb);
  return v ? universalBlue(v.phase, dbz(v.phase, v.rate)) : null;
}

// ---- assembling the globe -------------------------------------------------------------------

export interface ImergMap {
  /** Start of the half hour, ISO. */
  time: string;
  /** Equirectangular, 0.140625° a pixel, row 0 at 90°N; straight alpha. */
  image: OffscreenCanvas;
  /** Share of the globe with rain or snow over the cut. */
  wet: number;
}

/** One tile, or null when GIBS doesn't have it (yet). */
export async function tileBitmap(url: string): Promise<ImageBitmap | null> {
  // GIBS sends its 404s without CORS headers, so a missing tile reaches the page as a
  // network error (and a CORS error in the console), not a readable 404: both mean missing.
  const r = await fetch(url).catch(() => null);
  if (!r || r.status === 404) return null;
  if (!r.ok) throw new Error(`${r.status} GIBS IMERG tile`);
  // Data colours, matched to a table: no colour management.
  return createImageBitmap(await r.blob(), { colorSpaceConversion: 'none', premultiplyAlpha: 'none' });
}

/**
 * The newest half hour GIBS lists whose tiles are there (a listed one can still 404 for a
 * few minutes), drawn into one image in Universal Blue.
 */
export async function loadImerg(table: RateTable, now = new Date()): Promise<ImergMap> {
  const r = await fetch(timesUrl(now), { cache: 'no-cache' });
  if (!r.ok) throw new Error(`${r.status} GIBS IMERG times`);
  const newest = newestTime(await r.text());
  if (!newest) throw new Error('GIBS lists no IMERG times');
  for (let back = 0; back < 4; back++) {
    const time = `${new Date(Date.parse(newest) - back * 30 * 60_000).toISOString().slice(0, 19)}Z`;
    const tiles = await Promise.all(
      Array.from({ length: ROWS * COLS }, (_, i) => tileBitmap(tileUrl(time, Math.floor(i / COLS), i % COLS))),
    );
    if (tiles.some((t) => !t)) {
      for (const t of tiles) t?.close();
      continue;
    }
    const canvas = new OffscreenCanvas(IMERG_WIDTH, IMERG_HEIGHT);
    const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
    tiles.forEach((t, i) => {
      ctx.drawImage(t!, (i % COLS) * TILE_PX, Math.floor(i / COLS) * TILE_PX);
      t!.close();
    });
    const img = ctx.getImageData(0, 0, IMERG_WIDTH, IMERG_HEIGHT);
    const wet = recolourPixels(table, img.data);
    ctx.putImageData(img, 0, 0);
    return { time, image: canvas, wet };
  }
  throw new Error(`IMERG ${newest} and the hour before it aren't in GIBS yet (or its tiles can't be reached)`);
}

/** In place: GIBS colours → Universal Blue, everything else transparent. Returns the wet share. */
export function recolourPixels(table: RateTable, rgba: Uint8ClampedArray): number {
  const cache = new Map<number, number>();
  let wet = 0;
  for (let i = 0; i < rgba.length; i += 4) {
    if (rgba[i + 3] < 128) {
      rgba[i] = rgba[i + 1] = rgba[i + 2] = rgba[i + 3] = 0;
      continue;
    }
    const key = (rgba[i] << 16) | (rgba[i + 1] << 8) | rgba[i + 2];
    let c = cache.get(key);
    if (c === undefined) cache.set(key, (c = recolour(table, key) ?? -1));
    if (c < 0) {
      rgba[i] = rgba[i + 1] = rgba[i + 2] = rgba[i + 3] = 0;
      continue;
    }
    rgba[i] = c >> 16;
    rgba[i + 1] = (c >> 8) & 255;
    rgba[i + 2] = c & 255;
    rgba[i + 3] = 255;
    wet++;
  }
  return wet / (rgba.length / 4);
}
