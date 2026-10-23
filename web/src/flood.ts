// Flood extent: NASA LANCE's daily global flood product (VIIRS on NOAA-20 and NOAA-21, via
// GIBS), with the GDACS flood markers in the events layer. Water seen where the reference maps
// have none is flood; where it's flooded in past years too, recurring flood. It's optical, so it
// can't see under cloud, and NASA says it isn't research grade. The 2-day composite is the
// middle way between the 1-day's cloud-shadow false floods and the 3-day's staleness (NASA
// recommends none of them over the others); VIIRS, not MODIS, as Terra and Aqua near their end.
//
// One 4096 × 2048 PNG (0.088°, ~640 KB) covers the world. Its flood pixels are scattered — on
// 2026-10-22 there were ~700 of 8 million — but they keep the floods' area: over South Sudan's
// Sudd it gave 0.123% flooded against 0.138% from a 0.01° picture of the same box. They're drawn
// as points, each its ground's size, as the FIRMS fires are, so they take no texture unit; zoomed
// in, the view's own box is asked for at up to the product's 250 m. Blue, as public flood maps
// draw flood water (and so never mistaken for the red-orange fires). Normal water and "not
// enough data" (cloud, mostly: 3.2 million of the picture's 8.4 million pixels that day) aren't
// drawn.

import { GIBS_BASE, newestDate } from './gibs';
import type { SurfacePoints } from './renderer/points';
import { fromLatLon } from './vec';

export const FLOOD_LAYER = 'VIIRS_Combined_Flood_2-Day';
const GIBS_WMS = 'https://gibs.earthdata.nasa.gov/wms/epsg4326/best/wms.cgi';
export const FLOOD_W = 4096;
export const FLOOD_H = 2048;
/** The product's pixel, degrees (250 m): no point asking for finer. */
export const NATIVE_DEG = 0.00225;
/** Today's composite fills in as the day's passes arrive, so it's asked for again this often. */
export const FLOOD_REFRESH_MS = 3 * 60 * 60_000;
/** How often to look for a new day. */
export const FLOOD_CHECK_MS = 60 * 60_000;

/** GIBS's MODIS_Flood.xml classes (shared by VIIRS): 2 recurring flood, 3 flood. */
export type FloodClass = 2 | 3;
export function floodClass(r: number, g: number, b: number): FloodClass | 0 {
  if (r === 250 && g === 30 && b === 36) return 3;
  if (r === 255 && g === 255 && b === 0) return 2;
  return 0;
}

/** A lat/lon box: west longitude, north latitude, spans (degrees). */
export interface FloodBox {
  lon0: number;
  lat1: number;
  lonSpan: number;
  latSpan: number;
}

export const WORLD: FloodBox = { lon0: -180, lat1: 90, lonSpan: 360, latSpan: 180 };

export interface FloodCell {
  lat: number;
  lon: number;
  cls: FloodClass;
  /** The pixel's ground area, km². */
  km2: number;
}

const KM_PER_DEG = 111.32;

/** A picture of a box (RGBA, row 0 at its north edge) → its flood and recurring-flood pixels. */
export function floodCells(rgba: Uint8ClampedArray, w: number, h: number, box: FloodBox): FloodCell[] {
  const degX = box.lonSpan / w;
  const degY = box.latSpan / h;
  const out: FloodCell[] = [];
  for (let y = 0; y < h; y++) {
    const lat = box.lat1 - (y + 0.5) * degY;
    const km2 = degX * degY * KM_PER_DEG * KM_PER_DEG * Math.cos((lat * Math.PI) / 180);
    for (let x = 0; x < w; x++) {
      const o = (y * w + x) * 4;
      if (rgba[o + 3] < 128) continue;
      const cls = floodClass(rgba[o], rgba[o + 1], rgba[o + 2]);
      if (cls) out.push({ lat, lon: box.lon0 + (x + 0.5) * degX, cls, km2 });
    }
  }
  return out;
}

/** Recurring flood is drawn paler and fainter than flood. */
export const RECURRING_INTENSITY = 0.35;

/** As SurfacePoints: flood intensity 1, recurring less; age 0; footprint the pixel's ground. */
export function floodPoints(cells: readonly FloodCell[]): SurfacePoints {
  const n = cells.length;
  const pos = new Float32Array(n * 3);
  const look = new Float32Array(n * 3);
  cells.forEach((c, i) => {
    pos.set(fromLatLon(c.lat, c.lon), i * 3);
    look[i * 3] = c.cls === 3 ? 1 : RECURRING_INTENSITY;
    look[i * 3 + 2] = Math.sqrt((c.km2 * 4) / Math.PI);
  });
  return { count: n, pos, look };
}

/** Flooded and recurring-flood area, km². */
export function floodArea(cells: readonly FloodCell[]): { flood: number; recurring: number } {
  let flood = 0;
  let recurring = 0;
  for (const c of cells) {
    if (c.cls === 3) flood += c.km2;
    else recurring += c.km2;
  }
  return { flood, recurring };
}

const inBox = (c: FloodCell, b: FloodBox) =>
  c.lat <= b.lat1 && c.lat >= b.lat1 - b.latSpan && ((((c.lon - b.lon0) % 360) + 360) % 360) <= b.lonSpan;

/** The world's cells outside a zoomed-in box, and the box's own (finer) cells: one set. */
export function withDetail(world: readonly FloodCell[], detail: { box: FloodBox; cells: readonly FloodCell[] } | null): FloodCell[] {
  if (!detail) return [...world];
  return [...world.filter((c) => !inBox(c, detail.box)), ...detail.cells];
}

/** "flood ~1,234 km² · recurring ~56 km²" (from the world picture). */
export function floodSummary(date: string, cells: readonly FloodCell[]): string {
  const { flood, recurring } = floodArea(cells);
  const day = new Date(`${date}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
  const km = (v: number) => `~${Math.round(v).toLocaleString('en-GB')} km²`;
  return `VIIRS 2 days to ${day} · flood ${km(flood)} · recurring ${km(recurring)}`;
}

/** GIBS's list of the layer's days over the last ten. */
export function floodDomainUrl(now: Date): string {
  const day = (d: Date) => d.toISOString().slice(0, 10);
  return `${GIBS_BASE}/1.0.0/${FLOOD_LAYER}/default/250m/all/${day(new Date(now.getTime() - 10 * 86_400_000))}--${day(now)}.xml`;
}

/** GetMap for one part of a box (WMS 1.3.0 in EPSG:4326 orders the box latitude first). */
export function floodMapUrl(date: string, lon0: number, lon1: number, lat0: number, lat1: number, w: number, h: number): string {
  const q = new URLSearchParams({
    SERVICE: 'WMS',
    REQUEST: 'GetMap',
    VERSION: '1.3.0',
    LAYERS: FLOOD_LAYER,
    STYLES: '',
    CRS: 'EPSG:4326',
    BBOX: [lat0, lon0, lat1, lon1].map((v) => +v.toFixed(5)).join(','),
    WIDTH: String(w),
    HEIGHT: String(h),
    FORMAT: 'image/png',
    TIME: date,
  });
  return `${GIBS_WMS}?${q}`;
}

/** WMS won't wrap past ±180°: a box over the date line is asked for in two parts. */
export function boxParts(box: FloodBox, w: number): { lon0: number; lon1: number; x: number; width: number }[] {
  const lon0 = ((((box.lon0 + 180) % 360) + 360) % 360) - 180;
  const lon1 = lon0 + box.lonSpan;
  if (lon1 <= 180 + 1e-9) return [{ lon0, lon1: Math.min(lon1, 180), x: 0, width: w }];
  const w1 = Math.round((w * (180 - lon0)) / box.lonSpan);
  return [
    { lon0, lon1: 180, x: 0, width: w1 },
    { lon0: -180, lon1: lon1 - 360, x: w1, width: w - w1 },
  ];
}

/** A box's flood cells, at w × h pixels, in one or two requests. */
export async function fetchFloodCells(date: string, box: FloodBox, w: number, h: number, signal?: AbortSignal): Promise<FloodCell[]> {
  const out: FloodCell[] = [];
  const lat0 = box.lat1 - box.latSpan;
  for (const p of boxParts(box, w)) {
    const r = await fetch(floodMapUrl(date, p.lon0, p.lon1, lat0, box.lat1, p.width, h), { signal });
    if (!r.ok) throw new Error(`${r.status} GIBS ${FLOOD_LAYER}`);
    const blob = await r.blob();
    if (!blob.type.startsWith('image/')) throw new Error(`GIBS: ${(await blob.text()).slice(0, 120)}`);
    // Classes, not a picture: no colour management.
    const bmp = await createImageBitmap(blob, { colorSpaceConversion: 'none', premultiplyAlpha: 'none' });
    const c = new OffscreenCanvas(p.width, h);
    const g = c.getContext('2d', { willReadFrequently: true })!;
    g.drawImage(bmp, 0, 0);
    bmp.close();
    out.push(...floodCells(g.getImageData(0, 0, p.width, h).data, p.width, h, { lon0: p.lon0, lat1: box.lat1, lonSpan: p.lon1 - p.lon0, latSpan: box.latSpan }));
  }
  return out;
}

export async function newestFloodDate(now: Date): Promise<string> {
  const r = await fetch(floodDomainUrl(now), { cache: 'no-cache' });
  if (!r.ok) throw new Error(`${r.status} GIBS flood days`);
  const date = newestDate(await r.text());
  if (!date) throw new Error('GIBS lists no flood days');
  return date;
}

/**
 * The zoomed-in box: the view's, snapped out to a whole degree so a small pan doesn't ask
 * again, at the screen's resolution but no finer than the product's; null at globe zoom.
 */
export function detailRequest(view: { lat0: number; lat1: number; lon0: number; lon1: number }, degPerPx: number): { box: FloodBox; w: number; h: number } | null {
  if (degPerPx >= 0.03) return null;
  const lat1 = Math.min(90, Math.ceil(view.lat1));
  const lat0 = Math.max(-90, Math.floor(view.lat0));
  const lon0 = Math.floor(view.lon0);
  const lonSpan = Math.min(360, Math.ceil(view.lon1) - lon0);
  const per = Math.max(degPerPx, NATIVE_DEG);
  const scale = Math.min(1, 2048 / (lonSpan / per), 2048 / ((lat1 - lat0) / per));
  return {
    box: { lon0, lat1, lonSpan, latSpan: lat1 - lat0 },
    w: Math.max(1, Math.round((lonSpan / per) * scale)),
    h: Math.max(1, Math.round(((lat1 - lat0) / per) * scale)),
  };
}
