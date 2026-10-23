// Lightning over Europe, Africa and the Atlantic: the Lightning Imager on Meteosat Third
// Generation (MTG-I1, at 0°), which sees what GOES's mappers can't.
//
// EUMETSAT's EUMETView serves the instrument's Accumulated Flash Area as a WMS layer with CORS:
// a new frame every 5 minutes, each the flashes of those 5 minutes, coloured by how many
// flashes covered each ~2 km pixel (1 to 20+, YlOrRd, on a linear scale). The browser fetches
// the last six frames, the same 30-minute window as the GOES layer, reads the colours back to
// counts, and bins them into the same 0.1° cells, so both draw as one layer.
//
// Frames are fetched at 0.05° a pixel (~270 KB each). Over Africa and the Atlantic on
// 2026-10-23 that caught 97% of the 0.1° cells a 0.02° fetch found; 0.1° caught 88%.

import { parseWmsTime } from './liveImagery';

const WMS = 'https://view.eumetsat.int/geoserver/ows';
export const LI_LAYER = 'mtg_fd:li_afa';
/** The layer's extent (the disc lies within it). */
export const LI_BOX = { lat0: -70, lon0: -70, lat1: 70, lon1: 70 };
export const LI_DEG_PER_PX = 0.05;
export const LI_FRAME_MIN = 5;
export const LI_WINDOW_MIN = 30;
/** Matches the GOES layer's cells (pipeline/xearth_clouds/lightning.py). */
export const CELL_DEG = 0.1;

export const LI_TIMES_URL = `https://view.eumetsat.int/geoserver/mtg_fd/li_afa/ows?service=WMS&request=GetCapabilities&version=1.3.0`;

/** The legend's colour at each count from 1 to 20 (20 meaning 20 or more), sampled from EUMETView's legend. */
export const LI_RAMP: readonly (readonly [number, number, number])[] = [
  [255, 249, 189], [255, 242, 174], [255, 236, 159], [255, 228, 143], [254, 221, 129],
  [254, 212, 113], [254, 198, 98], [254, 185, 83], [254, 171, 72], [253, 157, 67],
  [253, 143, 61], [253, 119, 54], [252, 97, 47], [251, 76, 41], [242, 56, 36],
  [232, 38, 31], [222, 23, 29], [208, 13, 32], [195, 3, 36], [178, 0, 38],
];

const countCache = new Map<number, number>();

/** Flashes in a pixel, from its colour: the nearest of the legend's colours. */
export function flashCount(r: number, g: number, b: number): number {
  const key = (r << 16) | (g << 8) | b;
  let n = countCache.get(key);
  if (n === undefined) {
    let best = Infinity;
    n = 1;
    LI_RAMP.forEach(([R, G, B], i) => {
      const d = (r - R) ** 2 + (g - G) ** 2 + (b - B) ** 2;
      if (d < best) [best, n] = [d, i + 1];
    });
    countCache.set(key, n);
  }
  return n;
}

export function frameUrl(time: string): string {
  const { lat0, lon0, lat1, lon1 } = LI_BOX;
  const q = new URLSearchParams({
    service: 'WMS',
    request: 'GetMap',
    version: '1.3.0',
    layers: LI_LAYER,
    styles: '',
    crs: 'EPSG:4326',
    bbox: [lat0, lon0, lat1, lon1].join(','),
    width: String(Math.round((lon1 - lon0) / LI_DEG_PER_PX)),
    height: String(Math.round((lat1 - lat0) / LI_DEG_PER_PX)),
    format: 'image/png',
    transparent: 'true',
    time,
  });
  return `${WMS}?${q}`;
}

/** The frames making up the window that ends with `latest`, newest first. */
export function windowTimes(latest: string, windowMin = LI_WINDOW_MIN): string[] {
  const t = Date.parse(latest);
  return Array.from({ length: windowMin / LI_FRAME_MIN }, (_, i) => `${new Date(t - i * LI_FRAME_MIN * 60_000).toISOString().slice(0, 19)}Z`);
}

export const cellKey = (latI: number, lonI: number) => `${latI},${lonI}`;

/**
 * One frame's pixels (RGBA, row 0 at `box.lat1`) → flashes per 0.1° cell. A flash lights
 * every pixel its glow covered, so a cell takes its busiest pixel, not the sum.
 */
export function frameCells(rgba: Uint8ClampedArray, width: number, height: number, box = LI_BOX): Map<string, number> {
  const cells = new Map<string, number>();
  const degX = (box.lon1 - box.lon0) / width;
  const degY = (box.lat1 - box.lat0) / height;
  for (let y = 0; y < height; y++) {
    const lat = box.lat1 - (y + 0.5) * degY;
    const latI = Math.round(lat / CELL_DEG);
    for (let x = 0; x < width; x++) {
      const o = (y * width + x) * 4;
      if (rgba[o + 3] < 128) continue;
      const lonI = Math.round((box.lon0 + (x + 0.5) * degX) / CELL_DEG);
      const k = cellKey(latI, lonI);
      const n = flashCount(rgba[o], rgba[o + 1], rgba[o + 2]);
      if (n > (cells.get(k) ?? 0)) cells.set(k, n);
    }
  }
  return cells;
}

export interface LiFrame {
  time: string;
  cells: Map<string, number>;
}

/**
 * Frames → the GOES layer's cell format: flat [lat_index, lon_index, flashes, minutes_ago],
 * flashes summed over the frames and the age that of the newest frame with any.
 */
export function windowCells(frames: LiFrame[], latest: string): number[] {
  const end = Date.parse(latest);
  const acc = new Map<string, [number, number]>();
  for (const f of frames) {
    const age = Math.max(0, Math.round((end - Date.parse(f.time)) / 60_000));
    for (const [k, n] of f.cells) {
      const c = acc.get(k);
      if (c) {
        c[0] += n;
        c[1] = Math.min(c[1], age);
      } else acc.set(k, [n, age]);
    }
  }
  const out: number[] = [];
  for (const [k, [n, age]] of acc) {
    const [latI, lonI] = k.split(',').map(Number);
    out.push(latI, lonI, n, age);
  }
  return out;
}

/**
 * GOES and MTG cells together. Where both see a cell (the Atlantic and eastern South America)
 * it takes the larger count and the newer age, as the pipeline does for GOES-East and West.
 */
export function mergeCells(a: number[], b: number[]): number[] {
  const acc = new Map<string, [number, number, number, number]>();
  for (const data of [a, b]) {
    for (let i = 0; i + 3 < data.length; i += 4) {
      const k = cellKey(data[i], data[i + 1]);
      const c = acc.get(k);
      if (c) {
        c[2] = Math.max(c[2], data[i + 2]);
        c[3] = Math.min(c[3], data[i + 3]);
      } else acc.set(k, [data[i], data[i + 1], data[i + 2], data[i + 3]]);
    }
  }
  return [...acc.values()].flat();
}

/** The newest frame's time, from the layer's own capabilities (~7 KB). */
export async function fetchLatestLi(signal?: AbortSignal): Promise<string> {
  const r = await fetch(LI_TIMES_URL, { signal, cache: 'no-cache' });
  if (!r.ok) throw new Error(`${r.status} EUMETView capabilities`);
  const t = parseWmsTime(await r.text());
  if (!t) throw new Error('EUMETView lists no Lightning Imager times');
  return t;
}

async function fetchFrame(time: string): Promise<LiFrame> {
  const r = await fetch(frameUrl(time));
  if (!r.ok) throw new Error(`${r.status} EUMETView lightning frame`);
  const blob = await r.blob();
  if (!blob.type.startsWith('image/')) throw new Error(`EUMETView: ${(await blob.text()).slice(0, 120)}`);
  // Exact colours: no colour management, no premultiplying.
  const bmp = await createImageBitmap(blob, { colorSpaceConversion: 'none', premultiplyAlpha: 'none' });
  const canvas = new OffscreenCanvas(bmp.width, bmp.height);
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(bmp, 0, 0);
  bmp.close();
  return { time, cells: frameCells(ctx.getImageData(0, 0, canvas.width, canvas.height).data, canvas.width, canvas.height) };
}

/** Keeps the last 30 minutes of frames, fetching only the ones it hasn't got. */
export class LiWindow {
  private readonly frames = new Map<string, LiFrame>();
  latest: string | undefined;

  async load(): Promise<number[]> {
    const latest = await fetchLatestLi();
    const times = windowTimes(latest);
    const missing = times.filter((t) => !this.frames.has(t));
    const got = await Promise.allSettled(missing.map(fetchFrame));
    for (const g of got) if (g.status === 'fulfilled') this.frames.set(g.value.time, g.value);
    if (!this.frames.has(latest)) {
      const err = got.find((g) => g.status === 'rejected') as PromiseRejectedResult | undefined;
      throw err?.reason ?? new Error('no Lightning Imager frame');
    }
    for (const t of this.frames.keys()) if (!times.includes(t)) this.frames.delete(t);
    this.latest = latest;
    return windowCells([...this.frames.values()], latest);
  }
}
