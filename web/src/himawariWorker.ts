// Web Worker: Himawari-9's two bands → cloud opacity (himawariCloud.ts) off the main thread —
// ~2.4 million pixels through the pipeline's recipe, a second or two on a desktop.

import { cloudAlpha, HIMAWARI_SUB_LON, infraredGrey, toAlpha, visAlpha, visibleGrey } from './himawariCloud';

export interface HimawariRequest {
  id: number;
  /** Scan time, Unix seconds (the visible band's Sun angles depend on it). */
  time: number;
  /** The pictures' lat/lon box (degrees) and size in pixels. */
  box: { lon0: number; lat1: number; lonSpan: number; latSpan: number };
  w: number;
  h: number;
  /** RGBA: Band 13 (PNG, its colours exact) and, by day, Band 3. */
  b13: ArrayBuffer;
  b03: ArrayBuffer | null;
  /** The month's Blue Marble (absolute URL): the visible band's clear-sky reference. */
  surface: string | null;
}

/** RGBA: r = opacity × valid, g = valid (255 where Himawari has data), as one texture. */
export type HimawariResponse = { id: number; rgba: ArrayBuffer; visible: boolean } | { id: number; error: string };

const ctx = self as unknown as {
  onmessage: ((e: MessageEvent<HimawariRequest>) => void) | null;
  postMessage(message: HimawariResponse, transfer?: Transferable[]): void;
};

// The Blue Marble's luminance at half size (0.067° → 0.13° a texel, near the pictures' 0.105°).
const SURFACE_W = 2700;
const SURFACE_H = 1350;
let surface: { url: string; lum: Uint8Array } | undefined;

async function surfaceLuminance(url: string): Promise<Uint8Array> {
  if (surface?.url === url) return surface.lum;
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${r.status} ${url}`);
  // A reference, not a picture: no colour management (convert.py reads the file's raw sRGB).
  const bmp = await createImageBitmap(await r.blob(), { colorSpaceConversion: 'none', premultiplyAlpha: 'none', resizeWidth: SURFACE_W, resizeHeight: SURFACE_H, resizeQuality: 'medium' });
  const c = new OffscreenCanvas(SURFACE_W, SURFACE_H);
  const g = c.getContext('2d', { willReadFrequently: true })!;
  g.drawImage(bmp, 0, 0);
  bmp.close();
  const px = g.getImageData(0, 0, SURFACE_W, SURFACE_H).data;
  const lum = new Uint8Array(SURFACE_W * SURFACE_H);
  for (let i = 0; i < lum.length; i++) lum[i] = Math.round(0.2126 * px[i * 4] + 0.7152 * px[i * 4 + 1] + 0.0722 * px[i * 4 + 2]);
  surface = { url, lum };
  return lum;
}

ctx.onmessage = async (e) => {
  const { id, time, box, w, h, b13, b03, surface: surfaceUrl } = e.data;
  try {
    const n = w * h;
    // ~3° × 15° blocks, as convert.py's 50 × 24 on GMGSI's grid; a disc doesn't wrap.
    const blocks = { blockRows: Math.round(box.latSpan / 3), blockCols: Math.round(box.lonSpan / 15), wrapX: false };
    const ir = toAlpha(infraredGrey(new Uint8ClampedArray(b13), n), w, h, blocks);
    let vis: Float32Array | null = null;
    if (b03 && surfaceUrl) {
      const lat = Array.from({ length: h }, (_, y) => box.lat1 - ((y + 0.5) * box.latSpan) / h);
      const lon = Array.from({ length: w }, (_, x) => box.lon0 + ((x + 0.5) * box.lonSpan) / w);
      const lum = await surfaceLuminance(surfaceUrl);
      const L = new Float32Array(n);
      for (let y = 0; y < h; y++) {
        const row = Math.min(SURFACE_H - 1, Math.max(0, Math.trunc(((90 - lat[y]) / 180) * SURFACE_H)));
        for (let x = 0; x < w; x++) {
          const col = Math.min(SURFACE_W - 1, Math.trunc(((((lon[x] + 180) % 360) + 360) % 360 / 360) * SURFACE_W));
          L[y * w + x] = lum[row * SURFACE_W + col] / 255;
        }
      }
      vis = visAlpha(visibleGrey(new Uint8ClampedArray(b03), n), ir, L, w, h, { lat, lon, time }, HIMAWARI_SUB_LON);
    }
    const a = cloudAlpha(ir, vis);
    const out = new Uint8Array(n * 4);
    for (let i = 0; i < n; i++) {
      const ok = Number.isFinite(a[i]);
      out[i * 4] = ok ? Math.round(a[i] * 255) : 0;
      out[i * 4 + 1] = ok ? 255 : 0;
      out[i * 4 + 3] = 255;
    }
    ctx.postMessage({ id, rgba: out.buffer, visible: !!vis }, [out.buffer]);
  } catch (err) {
    ctx.postMessage({ id, error: String(err) });
  }
};
