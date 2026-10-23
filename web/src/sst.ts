// Sea surface temperature, and how far it is from usual, from the GHRSST MUR analysis (JPL,
// via NASA GIBS): a daily, gap-free blend of satellite and in-situ SST. MUR (0.01°) asked for at
// 0.25° is plenty for a whole globe: two 1440 × 720 PNGs (~880 KB) a day. Not MUR25: its
// anomaly comes in ~1° squares (in GIBS's own picture, and as blocks on the globe), where MUR's
// at the same size has none and gives the same Niño 3.4 (+2.67 against +2.68 °C on 2026-10-22).
//
// GIBS colours both, so each colour is read back to its value through GIBS's own colour maps
// (baked in below and tested against the real files) and the globe draws them in its own
// ramps: a cool-to-warm temperature scale, and for the anomaly the blue–white–red that public
// anomaly maps use, faint near zero so the big departures — El Niño, marine heatwaves — stand
// out at a glance. MUR's anomaly is against MUR's own 2003–2014 mean, not NOAA's 1991–2020:
// for Niño 3.4 in October 2026 MUR said +2.7 °C where NOAA CPC's weekly OISST said +3.3, though
// both had the region at 30.0 °C. So the readout gives the region's temperature too, and names
// the anomaly's baseline. (CPC's file has no CORS: the official index would need the pipeline.)
//
// A marine heatwave proper (Hobday et al. 2016: above the seasonal 90th percentile for 5+
// days) needs a percentile climatology GIBS doesn't serve, so the readout only counts the
// ocean that's much warmer than usual (+2 °C or more), and doesn't call it a heatwave.

import { GIBS_BASE, newestDate } from './gibs';

export type SstMode = 'off' | 'temp' | 'anomaly';

export const SST_LAYER = 'GHRSST_L4_MUR_Sea_Surface_Temperature';
export const ANOMALY_LAYER = 'GHRSST_L4_MUR_Sea_Surface_Temperature_Anomalies';
const GIBS_WMS = 'https://gibs.earthdata.nasa.gov/wms/epsg4326/best/wms.cgi';
/** The 0.25° grid it's asked for on, whole globe, row 0 at 90°N. */
export const SST_W = 1440;
export const SST_H = 720;
/** GIBS has each day the next, so an hourly look is plenty. */
export const SST_CHECK_MS = 60 * 60_000;

/** GIBS's colour map GHRSST_Sea_Surface_Temperature.xml (v1.3, 2026-10-23): r, g, b, bin middle °C. */
const SST_COLOURS = [
  43,0,26,-0.075, 45,0,28,0.075, 48,0,31,0.225, 51,0,34,0.375, 53,0,36,0.525, 56,0,39,0.675,
  59,0,43,0.825, 63,1,46,0.975, 66,1,50,1.125, 69,1,53,1.275, 72,1,57,1.425, 75,2,61,1.575,
  78,2,65,1.725, 81,2,69,1.875, 85,2,73,2.025, 88,2,77,2.175, 91,3,81,2.325, 95,3,85,2.475,
  98,3,89,2.625, 101,3,93,2.775, 105,4,97,2.925, 108,4,102,3.075, 112,5,106,3.225, 115,5,110,3.375,
  118,6,113,3.525, 120,6,115,3.675, 121,6,117,3.825, 122,6,119,3.975, 121,6,119,4.125,
  120,7,119,4.275, 117,7,117,4.425, 114,7,116,4.575, 111,7,114,4.725, 107,8,112,4.875,
  103,8,110,5.025, 98,8,108,5.175, 94,8,105,5.325, 90,9,103,5.475, 86,9,101,5.625, 81,9,99,5.775,
  77,9,97,5.925, 73,10,94,6.075, 69,10,92,6.225, 65,10,90,6.375, 61,10,88,6.525, 57,10,86,6.675,
  53,11,84,6.825, 48,11,81,6.975, 44,11,79,7.125, 40,11,77,7.275, 37,12,76,7.425, 34,13,75,7.575,
  32,14,75,7.725, 30,16,77,7.875, 30,18,78,8.025, 30,20,81,8.175, 30,22,84,8.325, 30,24,87,8.475,
  30,26,90,8.625, 31,28,93,8.775, 30,30,96,8.925, 30,33,99,9.075, 31,35,102,9.225, 31,37,105,9.375,
  31,39,108,9.525, 31,42,112,9.675, 31,44,115,9.825, 31,46,118,9.975, 31,48,121,10.125,
  31,50,124,10.275, 31,53,127,10.425, 31,55,130,10.575, 32,57,133,10.725, 32,59,136,10.875,
  32,61,139,11.025, 32,64,142,11.175, 32,66,145,11.325, 32,68,148,11.475, 32,70,151,11.625,
  33,73,155,11.775, 33,75,158,11.925, 33,78,161,12.075, 33,81,164,12.225, 34,84,167,12.375,
  34,87,170,12.525, 35,90,173,12.675, 35,93,176,12.825, 36,96,179,12.975, 36,100,182,13.125,
  37,103,185,13.275, 37,106,187,13.425, 38,110,190,13.575, 38,113,194,13.725, 39,117,197,13.875,
  40,120,200,14.025, 40,123,203,14.175, 41,127,206,14.325, 41,130,209,14.475, 42,133,212,14.625,
  42,136,215,14.775, 42,139,218,14.925, 43,142,221,15.075, 43,146,224,15.225, 44,149,227,15.375,
  44,152,230,15.525, 45,156,233,15.675, 46,159,236,15.825, 46,163,239,15.975, 47,166,242,16.125,
  48,170,245,16.275, 48,172,244,16.425, 47,173,240,16.575, 46,174,232,16.725, 45,174,222,16.875,
  43,173,208,17.025, 41,171,191,17.175, 39,168,171,17.325, 37,166,152,17.475, 35,164,133,17.625,
  32,163,113,17.775, 30,163,93,17.925, 27,165,72,18.075, 25,167,53,18.225, 26,170,37,18.375,
  28,175,23,18.525, 32,179,13,18.675, 38,183,6,18.825, 45,187,1,18.975, 55,190,0,19.125,
  66,194,0,19.275, 76,197,0,19.425, 87,201,0,19.575, 98,204,0,19.725, 109,207,0,19.875,
  120,211,0,20.025, 131,215,0,20.175, 142,218,0,20.325, 153,222,0,20.475, 165,225,0,20.625,
  176,229,0,20.775, 187,232,0,20.925, 197,236,0,21.075, 208,239,0,21.225, 219,243,0,21.375,
  229,246,0,21.525, 237,247,0,21.675, 243,247,0,21.825, 248,245,0,21.975, 252,243,0,22.125,
  254,239,0,22.275, 255,234,0,22.425, 255,228,0,22.575, 255,223,0,22.725, 255,217,0,22.875,
  255,212,0,23.025, 255,206,0,23.175, 255,201,0,23.325, 255,196,0,23.475, 255,191,0,23.625,
  255,185,0,23.775, 255,180,0,23.925, 255,175,0,24.075, 255,170,0,24.225, 255,164,0,24.375,
  255,159,0,24.525, 255,153,0,24.675, 255,148,0,24.825, 255,142,0,24.975, 255,137,0,25.125,
  255,131,0,25.275, 254,126,0,25.425, 253,122,0,25.575, 252,117,0,25.725, 251,113,0,25.875,
  250,109,0,26.025, 248,106,0,26.175, 246,102,0,26.325, 244,98,0,26.475, 242,95,0,26.625,
  240,91,0,26.775, 238,87,0,26.925, 236,83,0,27.075, 234,80,0,27.225, 232,76,0,27.375,
  230,73,0,27.525, 228,69,0,27.675, 226,66,0,27.825, 224,62,0,27.975, 222,59,0,28.125,
  220,55,0,28.275, 218,51,0,28.425, 216,48,0,28.575, 213,45,0,28.725, 210,42,0,28.875,
  206,39,0,29.025, 202,37,0,29.175, 197,34,0,29.325, 192,32,0,29.475, 187,31,0,29.625,
  181,29,0,29.775, 176,27,0,29.925, 171,25,0,30.075, 166,23,0,30.225, 161,21,0,30.375,
  156,20,0,30.525, 151,18,0,30.675, 145,16,0,30.825, 140,14,0,30.975, 135,12,0,31.125,
  130,10,0,31.275, 124,8,0,31.425, 120,7,0,31.575, 115,5,0,31.725, 110,3,0,31.9, 107,2,0,32.075,
];

/** GIBS's colour map GHRSST_Sea_Surface_Temperature_Anomalies.xml (v1.3, 2026-10-23): r, g, b, bin middle °C. */
const ANOMALY_COLOURS = [
  107,0,219,-3.05, 116,0,214,-2.95, 127,0,211,-2.85, 137,0,207,-2.75, 150,0,202,-2.65,
  145,9,204,-2.55, 127,26,209,-2.45, 96,49,220,-2.35, 65,75,230,-2.25, 34,100,241,-2.15,
  8,124,251,-2.05, 0,148,255,-1.95, 0,174,255,-1.85, 0,202,255,-1.75, 0,227,255,-1.65,
  3,248,250,-1.55, 24,252,229,-1.45, 47,255,206,-1.35, 71,255,182,-1.25, 96,255,158,-1.15,
  118,255,140,-1.05, 136,255,132,-0.95, 151,255,139,-0.85, 164,255,145,-0.75, 177,255,152,-0.65,
  189,254,158,-0.55, 191,244,163,-0.45, 191,232,169,-0.35, 191,219,176,-0.25, 191,208,182,-0.15,
  194,202,184,-0.05, 202,202,183,0.05, 213,213,172,0.15, 226,226,162,0.25, 237,237,152,0.35,
  249,248,141,0.45, 255,246,121,0.55, 255,234,94,0.65, 255,222,67,0.75, 255,208,37,0.85,
  255,194,9,0.95, 255,182,1,1.05, 255,170,0,1.15, 255,157,0,1.25, 255,145,0,1.35, 255,130,0,1.45,
  255,113,0,1.55, 255,89,0,1.65, 255,61,0,1.75, 255,33,0,1.85, 254,9,0,1.95, 249,1,19,2.05,
  243,0,45,2.15, 236,0,74,2.25, 230,0,103,2.35, 222,0,125,2.45, 211,0,133,2.55, 191,0,104,2.65,
  171,0,72,2.75, 154,0,44,2.85, 136,0,15,2.95, 128,0,0,3.05,
];

/** A colour map as a reader: exact colours straight from a table, others (GIBS's resampling blends) to the nearest. */
function reader(table: readonly number[]) {
  const n = table.length / 4;
  const cache = new Map<number, number>();
  for (let i = 0; i < n; i++) cache.set((table[i * 4] << 16) | (table[i * 4 + 1] << 8) | table[i * 4 + 2], table[i * 4 + 3]);
  return (r: number, g: number, b: number): number => {
    const key = (r << 16) | (g << 8) | b;
    let v = cache.get(key);
    if (v === undefined) {
      let best = Infinity;
      v = NaN;
      for (let i = 0; i < n; i++) {
        const d = (r - table[i * 4]) ** 2 + (g - table[i * 4 + 1]) ** 2 + (b - table[i * 4 + 2]) ** 2;
        if (d < best) [best, v] = [d, table[i * 4 + 3]];
      }
      cache.set(key, v);
    }
    return v;
  };
}

export const sstValue = reader(SST_COLOURS);
export const anomalyValue = reader(ANOMALY_COLOURS);

/** A GIBS picture (RGBA) back to values; NaN where transparent (land, sea ice, no data). */
export function decode(rgba: Uint8ClampedArray, n: number, value: (r: number, g: number, b: number) => number): Float32Array {
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const o = i * 4;
    out[i] = rgba[o + 3] < 128 ? NaN : value(rgba[o], rgba[o + 1], rgba[o + 2]);
  }
  return out;
}

/** Texture ranges: temperature −2…34 °C in r, anomaly −4…+4 °C in g. */
export const TEMP_RANGE = [-2, 34] as const;
export const ANOMALY_RANGE = [-4, 4] as const;

/**
 * Both fields as one RGBA texture: r = temperature, g = anomaly (each scaled to its range),
 * a = 255 where there's data and all zero where not, so it's premultiplied by construction
 * and the shader can divide a mipmap's average by its alpha.
 */
export function encode(temp: Float32Array, anomaly: Float32Array): Uint8Array {
  const out = new Uint8Array(temp.length * 4);
  const scale = (v: number, [lo, hi]: readonly [number, number]) => Math.round(Math.min(1, Math.max(0, (v - lo) / (hi - lo))) * 255);
  for (let i = 0; i < temp.length; i++) {
    if (!Number.isFinite(temp[i])) continue;
    out[i * 4] = scale(temp[i], TEMP_RANGE);
    out[i * 4 + 1] = Number.isFinite(anomaly[i]) ? scale(anomaly[i], ANOMALY_RANGE) : scale(0, ANOMALY_RANGE);
    out[i * 4 + 3] = 255;
  }
  return out;
}

/** Mean of a field over a lat/lon box, by area (cos latitude), on the 0.25° grid. */
export function boxMean(field: Float32Array, box: { lat0: number; lat1: number; lon0: number; lon1: number }): number {
  let sum = 0;
  let wsum = 0;
  for (let y = 0; y < SST_H; y++) {
    const lat = 90 - (y + 0.5) * 0.25;
    if (lat < box.lat0 || lat > box.lat1) continue;
    const w = Math.cos((lat * Math.PI) / 180);
    for (let x = 0; x < SST_W; x++) {
      const lon = -180 + (x + 0.5) * 0.25;
      const v = field[y * SST_W + x];
      if (lon < box.lon0 || lon > box.lon1 || !Number.isFinite(v)) continue;
      sum += v * w;
      wsum += w;
    }
  }
  return wsum ? sum / wsum : NaN;
}

/** The Niño 3.4 region: 5°S–5°N, 170°W–120°W. */
export const NINO34 = { lat0: -5, lat1: 5, lon0: -170, lon1: -120 };

/** NOAA's ONI thresholds, read loosely: a day's value isn't a three-month mean. */
export function ensoWord(a: number): string {
  if (!Number.isFinite(a)) return '';
  const strength = Math.abs(a) >= 1.5 ? 'strong ' : Math.abs(a) >= 1 ? 'moderate ' : '';
  if (a >= 0.5) return `${strength}El Niño range`;
  if (a <= -0.5) return `${strength}La Niña range`;
  return 'neutral';
}

/** The share of the ocean (by area) at least `above` °C warmer than usual. */
export function warmShare(anomaly: Float32Array, above = 2): number {
  let hot = 0;
  let all = 0;
  for (let y = 0; y < SST_H; y++) {
    const w = Math.cos(((90 - (y + 0.5) * 0.25) * Math.PI) / 180);
    for (let x = 0; x < SST_W; x++) {
      const v = anomaly[y * SST_W + x];
      if (!Number.isFinite(v)) continue;
      all += w;
      if (v >= above) hot += w;
    }
  }
  return all ? hot / all : 0;
}

/** "+2.1 °C" */
export const signed = (v: number) => `${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(1)} °C`;

/** The readout: the day's date, then per mode its scale, and Niño 3.4 and the much-warmer share with the anomaly. */
export function sstSummary(mode: SstMode, f: Pick<SstFrame, 'date' | 'nino34' | 'nino34Sst' | 'warm'>): string {
  const day = new Date(`${f.date}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
  if (mode === 'temp') return `MUR ${day} · 0 °C blue → 30 °C red`;
  const nino = Number.isFinite(f.nino34)
    ? ` · Niño 3.4 ${f.nino34Sst.toFixed(1)} °C, ${signed(f.nino34)} vs 2003–14 (${ensoWord(f.nino34)})`
    : '';
  return `MUR ${day} · −3 blue → +3 °C red${nino} · ${(f.warm * 100).toFixed(1)}% of the ocean +2 °C or more`;
}

/** GIBS's list of MUR's days over the last ten (it's a day behind). */
export function sstDomainUrl(now: Date): string {
  const day = (d: Date) => d.toISOString().slice(0, 10);
  return `${GIBS_BASE}/1.0.0/${SST_LAYER}/default/1km/all/${day(new Date(now.getTime() - 10 * 86_400_000))}--${day(now)}.xml`;
}

export function sstMapUrl(layer: string, date: string): string {
  const q = new URLSearchParams({
    SERVICE: 'WMS',
    REQUEST: 'GetMap',
    VERSION: '1.3.0',
    LAYERS: layer,
    STYLES: '',
    CRS: 'EPSG:4326',
    BBOX: '-90,-180,90,180',
    WIDTH: String(SST_W),
    HEIGHT: String(SST_H),
    FORMAT: 'image/png',
    TIME: date,
  });
  return `${GIBS_WMS}?${q}`;
}

async function fetchField(layer: string, date: string, value: (r: number, g: number, b: number) => number): Promise<Float32Array> {
  const r = await fetch(sstMapUrl(layer, date));
  if (!r.ok) throw new Error(`${r.status} GIBS ${layer}`);
  const blob = await r.blob();
  if (!blob.type.startsWith('image/')) throw new Error(`GIBS: ${(await blob.text()).slice(0, 120)}`);
  // The colours are data: no colour management.
  const bmp = await createImageBitmap(blob, { colorSpaceConversion: 'none', premultiplyAlpha: 'none' });
  const c = new OffscreenCanvas(SST_W, SST_H);
  const g = c.getContext('2d', { willReadFrequently: true })!;
  g.drawImage(bmp, 0, 0, SST_W, SST_H);
  bmp.close();
  return decode(g.getImageData(0, 0, SST_W, SST_H).data, SST_W * SST_H, value);
}

export interface SstFrame {
  date: string;
  rgba: Uint8Array;
  /** Niño 3.4's mean anomaly (vs 2003–2014) and mean temperature, °C. */
  nino34: number;
  nino34Sst: number;
  /** The share of the ocean +2 °C or more above usual. */
  warm: number;
}

/** The newest day's two fields, fetched when GIBS has a day newer than `have`. */
export async function loadSst(now: Date, have?: string): Promise<SstFrame | null> {
  const r = await fetch(sstDomainUrl(now), { cache: 'no-cache' });
  if (!r.ok) throw new Error(`${r.status} GIBS MUR days`);
  const date = newestDate(await r.text());
  if (!date) throw new Error('GIBS lists no MUR days');
  if (date === have) return null;
  const [temp, anomaly] = await Promise.all([fetchField(SST_LAYER, date, sstValue), fetchField(ANOMALY_LAYER, date, anomalyValue)]);
  return { date, rgba: encode(temp, anomaly), nino34: boxMean(anomaly, NINO34), nino34Sst: boxMean(temp, NINO34), warm: warmShare(anomaly) };
}
