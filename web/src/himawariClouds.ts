// Live clouds over Asia and the west Pacific: Himawari-9's infrared (Band 13) and visible
// (Band 3) pictures from NASA GIBS for the newest scan it has drawn, turned into cloud opacity
// in a worker by the hourly cloud map's own recipe (himawariCloud.ts). The globe uses them in
// place of the hourly map over Himawari's disc, faded toward its limb.
//
// Both are WMS requests on the globe's lat/lon grid, like the live colour discs, at 1536 px
// (0.105°, near the hourly map's 0.088°). Band 13 has to be PNG — its colours are data, and
// JPEG's noise mixes up its two grey ramps — ~2.4 MB a scan; Band 3, plain grey, is JPEG,
// ~340 KB, and only fetched while the Sun is up somewhere on the disc. GIBS lists a scan ~30
// minutes after it's taken and draws it some while later, so they're about an hour old.

import { HIMAWARI_SUB_LON, subsolar } from './himawariCloud';
import { discBox, fetchServedTime, GIBS_WMS, getMapUrl, viewAngleDeg, wmsParts, type LiveBox, type LiveSource } from './liveImagery';
import type { HimawariRequest, HimawariResponse } from './himawariWorker';

export const HIMAWARI_IR: LiveSource = {
  key: 'himawari-ir',
  name: 'Himawari-9',
  subLon: HIMAWARI_SUB_LON,
  wms: GIBS_WMS,
  layer: 'Himawari_AHI_Band13_Clean_Infrared',
  times: 'gibs',
  format: 'image/png',
  matrix: '2km',
};

export const HIMAWARI_VIS: LiveSource = { ...HIMAWARI_IR, key: 'himawari-vis', layer: 'Himawari_AHI_Band3_Red_Visible_1km', format: undefined, matrix: '1km' };

export const HIMAWARI_PX = 1536;
/** A scan comes every 10 minutes (but for 02:40 and 14:40, its daily housekeeping). */
export const HIMAWARI_CHECK_MS = 10 * 60_000;

/** One band's picture of the box, its pixels exactly as served (no colour management). */
async function fetchBand(s: LiveSource, time: string, box: LiveBox, size: number): Promise<ImageData> {
  const canvas = new OffscreenCanvas(size, size);
  const g = canvas.getContext('2d', { willReadFrequently: true })!;
  const lat0 = box.lat1 - box.latSpan;
  await Promise.all(
    wmsParts(box, size).map(async (p) => {
      const r = await fetch(getMapUrl(s, time, p, lat0, box.lat1, size));
      if (!r.ok) throw new Error(`${r.status} GIBS ${s.layer}`);
      const blob = await r.blob();
      if (!blob.type.startsWith('image/')) throw new Error(`GIBS: ${(await blob.text()).slice(0, 120)}`);
      const bmp = await createImageBitmap(blob, { colorSpaceConversion: 'none', premultiplyAlpha: 'none' });
      g.drawImage(bmp, p.x, 0, p.width, size);
      bmp.close();
    }),
  );
  return g.getImageData(0, 0, size, size);
}

/** Is the Sun up anywhere on the disc (within 81° of 140.7°E) at this time? */
export function sunOnDisc(time: string): boolean {
  const [lat, lon] = subsolar(Date.parse(time) / 1000);
  return viewAngleDeg(lat, lon, HIMAWARI_SUB_LON) < 90 + 81;
}

export interface HimawariFrame {
  time: string;
  box: LiveBox;
  w: number;
  h: number;
  /** r = opacity × valid, g = valid. */
  rgba: Uint8Array;
  /** Whether the visible band was used (by day, with a surface map). */
  visible: boolean;
}

export class HimawariClouds {
  /** The scan now shown. */
  time: string | undefined;
  visible = false;
  private worker: Worker | undefined;
  private seq = 0;
  private readonly jobs = new Map<number, { resolve: (r: { rgba: ArrayBuffer; visible: boolean }) => void; reject: (e: Error) => void }>();

  constructor(
    private readonly onFrame: (f: HimawariFrame) => void,
    /** The Blue Marble for a scan time (absolute URL), or null without one. */
    private readonly surfaceFor: (time: string) => string | null,
  ) {}

  private process(req: Omit<HimawariRequest, 'id'>): Promise<{ rgba: ArrayBuffer; visible: boolean }> {
    if (!this.worker) {
      this.worker = new Worker(new URL('./himawariWorker.ts', import.meta.url), { type: 'module' });
      this.worker.onmessage = (e: MessageEvent<HimawariResponse>) => {
        const job = this.jobs.get(e.data.id);
        this.jobs.delete(e.data.id);
        if ('rgba' in e.data) job?.resolve(e.data);
        else job?.reject(new Error(e.data.error));
      };
    }
    const id = ++this.seq;
    return new Promise((resolve, reject) => {
      this.jobs.set(id, { resolve, reject });
      this.worker!.postMessage({ ...req, id }, [req.b13, ...(req.b03 ? [req.b03] : [])]);
    });
  }

  /** Look for a newer drawn scan; fetch and process it if there is one. */
  async check(now = new Date()): Promise<void> {
    const time = await fetchServedTime(HIMAWARI_IR, now, this.time);
    if (time === this.time) return;
    const box = discBox(HIMAWARI_IR);
    // Without the visible band (night, or a failed fetch) it's infrared only, as convert.py is.
    const [ir, vis] = await Promise.all([
      fetchBand(HIMAWARI_IR, time, box, HIMAWARI_PX),
      sunOnDisc(time) ? fetchBand(HIMAWARI_VIS, time, box, HIMAWARI_PX).catch((err) => (console.warn('Himawari visible band:', err), null)) : null,
    ]);
    const out = await this.process({
      time: Date.parse(time) / 1000,
      box,
      w: HIMAWARI_PX,
      h: HIMAWARI_PX,
      b13: ir.data.buffer as ArrayBuffer,
      b03: vis ? (vis.data.buffer as ArrayBuffer) : null,
      surface: this.surfaceFor(time),
    });
    this.time = time;
    this.visible = out.visible;
    this.onFrame({ time, box, w: HIMAWARI_PX, h: HIMAWARI_PX, rgba: new Uint8Array(out.rgba), visible: out.visible });
  }
}
