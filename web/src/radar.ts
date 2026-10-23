// Weather radar from RainViewer: a composite of 1,200+ radars in 150+ countries,
// a new frame every 10 minutes. The free API is CORS-enabled, so the browser
// reads it directly: the frame list, then that frame's Web Mercator tiles,
// stitched into one square texture the globe shader samples in Mercator.
//
// Terms: free for personal and educational use, with a visible credit linking
// to rainviewer.com, and responses should be cached — so a frame's tiles are
// fetched once, only when a new frame is published, and only while shown.

export const RAINVIEWER_API = 'https://api.rainviewer.com/public/weather-maps.json';
export const RAINVIEWER_CREDIT = 'https://www.rainviewer.com/';

/** Tile edge, px. 512 halves the request count against 256 at the same resolution. */
export const TILE_PX = 512;
/** Colour scheme 2 ("Universal Blue", the free tier's), smoothed, with snow coloured apart from rain. */
const SCHEME = '2/1_1';

export interface RadarFrame {
  /** Unix seconds. */
  time: number;
  /** Tile URL prefix, e.g. https://tilecache.rainviewer.com/v2/radar/f281ab9683e9 */
  base: string;
}

interface WeatherMaps {
  host?: string;
  radar?: { past?: { time: number; path: string }[] };
}

export function latestFrame(json: unknown): RadarFrame | undefined {
  const m = json as WeatherMaps | null;
  const past = m?.radar?.past;
  if (!m?.host || !Array.isArray(past) || !past.length) return undefined;
  const last = past.reduce((a, b) => (b.time > a.time ? b : a));
  return { time: last.time, base: `${m.host}${last.path}` };
}

/**
 * Tile zoom for the view: 2 (4×4 tiles, 2048 px ≈ 20 km/px at the equator) for the
 * whole globe, 3 (8×8, 4096 px) once it's magnified enough for that to show.
 */
export function radarZoom(mag: number): number {
  return mag >= 2 ? 3 : 2;
}

export function tileUrls(frame: RadarFrame, zoom: number): { x: number; y: number; url: string }[] {
  const n = 2 ** zoom;
  const out = [];
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) out.push({ x, y, url: `${frame.base}/${TILE_PX}/${zoom}/${x}/${y}/${SCHEME}.png` });
  }
  return out;
}

/**
 * In the Universal Blue table (rainviewer.com/files/rainviewer_api_colors_table.csv),
 * −10…14 dBZ are translucent grey-beige and 15 dBZ and up opaque blue → red. The
 * translucent band is mostly not rain: clear-air returns, and at dusk the rings of
 * birds and insects around every radar site. Keeping only opaque pixels cuts there,
 * at 15 dBZ, where many radar displays start. Pixels are RGBA, straight alpha.
 */
export function dropWeakEchoes(rgba: Uint8ClampedArray): number {
  let dropped = 0;
  for (let i = 3; i < rgba.length; i += 4) {
    if (rgba[i] !== 0 && rgba[i] < 255) {
      rgba[i - 3] = rgba[i - 2] = rgba[i - 1] = rgba[i] = 0;
      dropped++;
    }
  }
  return dropped;
}

/**
 * Where RainViewer has radars at all, as the same Web Mercator tiles: opaque black where
 * none sees, clear where one does. IMERG (imerg.ts) fills in only where there's none. It
 * hardly changes, so it's fetched at zoom 2 and kept for the day.
 */
export const COVERAGE_ZOOM = 2;
export const COVERAGE_EVERY_MS = 24 * 3_600_000;

export function coverageUrls(host: string, zoom = COVERAGE_ZOOM): { x: number; y: number; url: string }[] {
  const n = 2 ** zoom;
  const out = [];
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) out.push({ x, y, url: `${host}/v2/coverage/0/${TILE_PX}/${zoom}/${x}/${y}/0/0_0.png` });
  }
  return out;
}

/** The coverage tiles as one canvas; a tile that fails counts as no radar (opaque), so IMERG shows there. */
export async function composeCoverage(host: string, fetchBlob: (url: string) => Promise<Blob>): Promise<OffscreenCanvas> {
  const n = 2 ** COVERAGE_ZOOM;
  const canvas = new OffscreenCanvas(n * TILE_PX, n * TILE_PX);
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  await Promise.allSettled(
    coverageUrls(host).map(async (t) => {
      const bmp = await createImageBitmap(await fetchBlob(t.url), { premultiplyAlpha: 'none' });
      ctx.clearRect(t.x * TILE_PX, t.y * TILE_PX, TILE_PX, TILE_PX);
      ctx.drawImage(bmp, t.x * TILE_PX, t.y * TILE_PX);
      bmp.close();
    }),
  );
  return canvas;
}

/** The API's tile host, e.g. https://tilecache.rainviewer.com. */
export function apiHost(json: unknown): string | undefined {
  return (json as WeatherMaps | null)?.host;
}

/** Latitude → Mercator v (0 at the top edge, ±85.05° at the edges). */
export function mercatorV(latDeg: number): number {
  const phi = (latDeg * Math.PI) / 180;
  return 0.5 - Math.log(Math.tan(Math.PI / 4 + phi / 2)) / (2 * Math.PI);
}

/**
 * Fetch a frame's tiles and draw them into one canvas, keeping echoes of 15 dBZ
 * and up. A tile that fails is left empty (no radar there this frame) rather
 * than failing the whole frame.
 */
export async function composeRadar(
  frame: RadarFrame,
  zoom: number,
  fetchBlob: (url: string) => Promise<Blob>,
): Promise<{ canvas: OffscreenCanvas; failed: number }> {
  const n = 2 ** zoom;
  const canvas = new OffscreenCanvas(n * TILE_PX, n * TILE_PX);
  const ctx = canvas.getContext('2d')!;
  const tiles = tileUrls(frame, zoom);
  const results = await Promise.allSettled(
    tiles.map(async (t) => {
      // No colour management: these are data colours, matched to a legend.
      const bmp = await createImageBitmap(await fetchBlob(t.url), { colorSpaceConversion: 'none', premultiplyAlpha: 'none' });
      ctx.drawImage(bmp, t.x * TILE_PX, t.y * TILE_PX);
      bmp.close();
    }),
  );
  // Tiles are drawn 1:1, so opaque pixels keep their exact colours for the cut.
  const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
  dropWeakEchoes(img.data);
  ctx.putImageData(img, 0, 0);
  return { canvas, failed: results.filter((r) => r.status === 'rejected').length };
}
