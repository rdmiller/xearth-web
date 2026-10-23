// Fires burning now over Europe, Africa and the Atlantic: Fire Radiative Power from the
// Flexible Combined Imager on Meteosat Third Generation (MTG-I1, at 0°). FIRMS's VIIRS
// passes over each place a few times a day; FCI sees the same fires every 10 minutes.
//
// EUMETView serves the product as a WFS layer with CORS: one point per fire pixel, with its
// power (MW) and EUMETSAT's confidence that it is a fire. The browser asks for one 10-minute
// slot at a time as GeoJSON (~4,000 pixels, ~100 KB gzipped on 2026-10-23), drops pixels
// under 50% confidence, and bins the rest into FIRMS's 0.05° cells, so both draw as one layer.
// Slots are listed ~20 minutes after their start. The last hour of them is kept, and a cell
// shows its newest slot's power: power is a rate, so slots aren't summed.

import { fireIntensity, type FirePoints } from './hazards';
import { parseWmsTime } from './liveImagery';
import { fromLatLon } from './vec';

const WFS = 'https://view.eumetsat.int/geoserver/mtg_fd/ows';
export const FRP_LAYER = 'mtg_fd:frp';
export const FRP_TIMES_URL = 'https://view.eumetsat.int/geoserver/mtg_fd/frp/ows?service=WMS&request=GetCapabilities&version=1.3.0';
export const FRP_SLOT_MIN = 10;
export const FRP_WINDOW_MIN = 60;
/** FIRMS's cells (pipeline/xearth_clouds/fires.py). */
export const FRP_CELL_DEG = 0.05;
/**
 * EUMETSAT's confidence (0–100) that a pixel is a fire. Below 50 were ~9% of pixels on
 * 2026-10-23 at 15:00Z, over half of those at exactly 1 (FIRMS likewise drops VIIRS's "low").
 */
export const MIN_CONFIDENCE = 50;
/** FCI's fire pixel at the sub-satellite point (EUMETView's product description: 1 km). */
export const FCI_PIXEL_KM = 1;

const R_EARTH = 6371;
const R_GEO = 42164;

/**
 * Ground area (km²) of an FCI pixel seen at viewing zenith angle `vzaDeg`: it grows with the
 * distance from the satellite, and again along the line of sight as the view grows oblique.
 */
export function pixelAreaKm2(vzaDeg: number): number {
  const vza = (Math.min(Math.max(vzaDeg, 0), 80) * Math.PI) / 180;
  const nadir = R_GEO - R_EARTH;
  // Off-nadir angle at the satellite, then the slant range by the law of sines.
  const eta = Math.asin((R_EARTH / R_GEO) * Math.sin(vza));
  const range = vza > 1e-6 ? (R_EARTH * Math.sin(vza - eta)) / Math.sin(eta) : nadir;
  return (FCI_PIXEL_KM * range / nadir) ** 2 / Math.cos(vza);
}

export interface FrpPixel {
  lat: number;
  lon: number;
  /** Fire radiative power, MW. */
  frp: number;
  confidence: number;
  /** Viewing zenith angle, degrees. */
  vza: number;
}

/** A slot's GeoJSON → its fire pixels. */
export function parseFrp(v: unknown): FrpPixel[] {
  const fc = v as { type?: string; features?: { properties?: Record<string, unknown> }[] } | null;
  if (fc?.type !== 'FeatureCollection' || !Array.isArray(fc.features)) throw new Error('EUMETView: not a FeatureCollection');
  const out: FrpPixel[] = [];
  for (const f of fc.features) {
    const p = f.properties ?? {};
    const [lat, lon, frp, confidence, vza] = [p.Lat, p.Lon, p.FRP, p.Confidence, p.VZA].map(Number);
    if ([lat, lon, frp].every(Number.isFinite)) out.push({ lat, lon, frp, confidence, vza: Number.isFinite(vza) ? vza : 0 });
  }
  return out;
}

export interface FrpCell {
  latI: number;
  lonI: number;
  /** Total power of the cell's pixels, MW. */
  frp: number;
  pixels: number;
  areaKm2: number;
}

export const cellKey = (latI: number, lonI: number) => `${latI},${lonI}`;

/** One slot's pixels → FIRMS's 0.05° cells, the confident ones only. */
export function slotCells(pixels: FrpPixel[]): Map<string, FrpCell> {
  const cells = new Map<string, FrpCell>();
  for (const px of pixels) {
    if (!(px.confidence >= MIN_CONFIDENCE)) continue;
    const latI = Math.round(px.lat / FRP_CELL_DEG);
    const lonI = Math.round(px.lon / FRP_CELL_DEG);
    const k = cellKey(latI, lonI);
    const c = cells.get(k) ?? cells.set(k, { latI, lonI, frp: 0, pixels: 0, areaKm2: 0 }).get(k)!;
    c.frp += px.frp;
    c.pixels++;
    c.areaKm2 += pixelAreaKm2(px.vza);
  }
  return cells;
}

export interface FrpSlot {
  time: string;
  cells: Map<string, FrpCell>;
}

export interface FrpFire extends FrpCell {
  /** Hours from the start of the cell's newest slot to `now`. */
  ageH: number;
}

/** The window's cells, each as its newest slot saw it. */
export function windowFires(slots: FrpSlot[], now: number): FrpFire[] {
  const out = new Map<string, FrpFire>();
  for (const s of [...slots].sort((a, b) => b.time.localeCompare(a.time))) {
    const ageH = Math.max(0, (now - Date.parse(s.time)) / 3_600_000);
    for (const [k, c] of s.cells) if (!out.has(k)) out.set(k, { ...c, ageH });
  }
  return [...out.values()];
}

/** Drawn like FIRMS's cells, each at the size of its pixels' ground. */
export function frpPoints(fires: FrpFire[]): FirePoints {
  const n = fires.length;
  const pos = new Float32Array(n * 3);
  const look = new Float32Array(n * 3);
  const ageH = new Uint8Array(n);
  const detections = new Uint16Array(n);
  fires.forEach((f, i) => {
    pos.set(fromLatLon(f.latI * FRP_CELL_DEG, f.lonI * FRP_CELL_DEG), i * 3);
    look[i * 3] = fireIntensity(f.frp);
    look[i * 3 + 1] = f.ageH;
    look[i * 3 + 2] = Math.sqrt((f.areaKm2 * 4) / Math.PI);
    ageH[i] = Math.min(255, Math.round(f.ageH));
    detections[i] = Math.min(65535, f.pixels);
  });
  return { count: n, pos, look, ageH, detections };
}

/** In the FIRMS manifest's format: flat [lat_index, lon_index, frp_mw×10, hours_ago, detections]. */
export function frpRows(fires: FrpFire[]): number[] {
  return fires.flatMap((f) => [f.latI, f.lonI, Math.round(f.frp * 10), Math.round(f.ageH), f.pixels]);
}

export function slotUrl(time: string): string {
  const q = new URLSearchParams({
    service: 'WFS',
    version: '2.0.0',
    request: 'GetFeature',
    typeNames: FRP_LAYER,
    outputFormat: 'application/json',
    propertyName: 'Lat,Lon,FRP,Confidence,VZA',
    cql_filter: `time=${time}`,
  });
  return `${WFS}?${q}`;
}

/** The slots making up the window that ends with `latest`, newest first. */
export function windowTimes(latest: string, windowMin = FRP_WINDOW_MIN): string[] {
  const t = Date.parse(latest);
  return Array.from({ length: windowMin / FRP_SLOT_MIN }, (_, i) => `${new Date(t - i * FRP_SLOT_MIN * 60_000).toISOString().slice(0, 19)}Z`);
}

/** The newest slot's time, from the layer's own capabilities (~8 KB). */
export async function fetchLatestFrp(signal?: AbortSignal): Promise<string> {
  const r = await fetch(FRP_TIMES_URL, { signal, cache: 'no-cache' });
  if (!r.ok) throw new Error(`${r.status} EUMETView capabilities`);
  const t = parseWmsTime(await r.text());
  if (!t) throw new Error('EUMETView lists no fire radiative power times');
  return t;
}

async function fetchSlot(time: string): Promise<FrpSlot> {
  const r = await fetch(slotUrl(time));
  if (!r.ok) throw new Error(`${r.status} EUMETView fire radiative power`);
  return { time, cells: slotCells(parseFrp(await r.json())) };
}

/** Keeps the last hour of slots, fetching only the ones it hasn't got. */
export class FrpWindow {
  private readonly slots = new Map<string, FrpSlot>();
  latest: string | undefined;
  /** Confident fire pixels in the window's slots, each cell counted once (its newest slot). */
  pixels = 0;

  async load(now = Date.now()): Promise<FrpFire[]> {
    const latest = await fetchLatestFrp();
    const times = windowTimes(latest);
    // One at a time, newest first: EUMETView turns away bursts ("lower your request rate").
    let failed: unknown;
    for (const t of times) {
      if (this.slots.has(t)) continue;
      try {
        this.slots.set(t, await fetchSlot(t));
      } catch (err) {
        failed ??= err;
      }
    }
    if (!this.slots.has(latest)) throw failed ?? new Error('no fire radiative power slot');
    for (const t of this.slots.keys()) if (!times.includes(t)) this.slots.delete(t);
    this.latest = latest;
    const fires = windowFires([...this.slots.values()], now);
    this.pixels = fires.reduce((n, f) => n + f.pixels, 0);
    return fires;
  }
}
