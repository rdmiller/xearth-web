// Web Worker: builds the Sun-lit globe's day texture (see blendLand) off the main thread —
// three images decoded and ~15 million pixels blended, about half a second on a desktop.

import { blendLand } from './textures';

export interface SurfaceRequest {
  id: number;
  /** Absolute URLs: the plain and shaded Blue Marble for the month, and the relief map. */
  plain: string;
  shaded: string;
  relief: string;
  /** The GPU's largest texture: bigger images are scaled down to fit. */
  maxSize: number;
}

export type SurfaceResponse = { id: number; bitmap: ImageBitmap } | { id: number; error: string };

const ctx = self as unknown as {
  onmessage: ((e: MessageEvent<SurfaceRequest>) => void) | null;
  postMessage(message: SurfaceResponse, transfer?: Transferable[]): void;
};

async function decode(url: string, w?: number, h?: number, data = false): Promise<ImageBitmap> {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${r.status} ${url}`);
  const blob = await r.blob();
  // The relief map is data: no colour management.
  const opts: ImageBitmapOptions = data ? { colorSpaceConversion: 'none', premultiplyAlpha: 'none' } : {};
  return createImageBitmap(blob, w && h ? { ...opts, resizeWidth: w, resizeHeight: h, resizeQuality: 'high' } : opts);
}

ctx.onmessage = async (e) => {
  const { id, plain, shaded, relief, maxSize } = e.data;
  try {
    let land = await decode(plain);
    const factor = Math.min(1, maxSize / Math.max(land.width, land.height));
    const w = Math.floor(land.width * factor);
    const h = Math.floor(land.height * factor);
    if (factor < 1) {
      land.close();
      land = await decode(plain, w, h);
    }
    const [water, mask] = await Promise.all([decode(shaded, w, h), decode(relief, w, h, true)]);
    const canvas = new OffscreenCanvas(w, h);
    const g = canvas.getContext('2d', { willReadFrequently: true })!;
    const read = (b: ImageBitmap) => {
      g.drawImage(b, 0, 0, w, h);
      b.close();
      return g.getImageData(0, 0, w, h);
    };
    const waterPx = read(water);
    const maskPx = read(mask);
    const landPx = read(land);
    blendLand(landPx.data, waterPx.data, maskPx.data);
    g.putImageData(landPx, 0, 0);
    const bitmap = canvas.transferToImageBitmap();
    ctx.postMessage({ id, bitmap }, [bitmap]);
  } catch (err) {
    ctx.postMessage({ id, error: String(err) });
  }
};
