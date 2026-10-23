// The ionosphere, from NOAA SWPC, as a colour wash ~300 km up, one of two ways:
//
//  * TEC: GloTEC's total electron content, every 10 minutes, via the pipeline (each map is
//    2.5 MB uncompressed at the source). Highest on the dayside either side of the magnetic
//    equator (the equatorial anomaly's two crests), lowest at night and near the poles. It's
//    what slows and bends GNSS signals.
//  * HF absorption: D-RAP, the highest radio frequency the D region is absorbing (1 dB),
//    straight from SWPC every 10 minutes (2.8 KB gzipped). Near zero most of the time; a
//    flare lights the sunlit side, a solar proton event the polar caps: HF radio blackouts.
//
// Both are resampled onto the aurora's 1° grid, so the three share one texture.

export type IonoMode = 'off' | 'tec' | 'drap';

/** The aurora's grid (hazards.ts AuroraGrid): 1°, longitude −180…179, latitude +90…−90. */
export const GRID_W = 360;
export const GRID_H = 181;

// ---- GloTEC (pipeline) ------------------------------------------------------------------

export interface TecManifest {
  generated: string;
  source: string;
  /** The map's time, ISO. */
  time: string;
  tecMax: number | null;
  lon0: number;
  lat0: number;
  dlon: number;
  dlat: number;
  nlon: number;
  nlat: number;
  /** Tenths of a TECU, north row first; null where there's no value. */
  tec: (number | null)[];
  anomaly: (number | null)[];
}

export function isTecManifest(v: unknown): v is TecManifest {
  const m = v as Partial<TecManifest> | null;
  return !!m && typeof m.time === 'string' && Array.isArray(m.tec) && typeof m.nlon === 'number' && typeof m.nlat === 'number' && m.tec.length === m.nlon * m.nlat;
}

// ---- D-RAP (browser) --------------------------------------------------------------------

export const DRAP_URL = 'https://services.swpc.noaa.gov/text/drap_global_frequencies.txt';

export interface Drap {
  /** "2026-10-23 02:16 UTC" as ISO. */
  valid: string | null;
  xray: string;
  proton: string;
  lons: number[];
  /** North first. */
  lats: number[];
  /** MHz, row by row. */
  mhz: Float32Array;
  max: number;
}

/**
 * SWPC's table: a "#" header (valid time, X-ray and proton messages), a row of longitudes,
 * a rule, then "lat | value value …" rows. Longitudes run −178…178 every 4°, latitudes
 * 89…−89 every 2°.
 */
export function parseDrap(text: string): Drap | null {
  const lines = text.split(/\r?\n/);
  const header = (name: string) => lines.find((l) => l.startsWith('#') && l.includes(name))?.split(':').slice(1).join(':').trim() ?? '';
  const validRaw = /Valid At\s*:\s*(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2})/.exec(text);
  const lonLine = lines.find((l) => !l.startsWith('#') && /^\s*-?\d+(\s+-?\d+){10,}\s*$/.test(l));
  if (!lonLine) return null;
  const lons = lonLine.trim().split(/\s+/).map(Number);
  const lats: number[] = [];
  const values: number[] = [];
  for (const l of lines) {
    const m = /^\s*(-?\d+)\s*\|(.*)$/.exec(l);
    if (!m) continue;
    const row = m[2].trim().split(/\s+/).map(Number);
    if (row.length !== lons.length || row.some((v) => !Number.isFinite(v))) continue;
    lats.push(Number(m[1]));
    values.push(...row);
  }
  if (!lats.length) return null;
  return {
    valid: validRaw ? `${validRaw[1]}T${validRaw[2]}:00Z` : null,
    xray: header('X-RAY Message'),
    proton: header('Proton Message'),
    lons,
    lats,
    mhz: Float32Array.from(values),
    max: Math.max(...values),
  };
}

// ---- onto the shared grid ----------------------------------------------------------------

/**
 * Bilinear sample of a regular lon/lat grid (row 0 at `lat0`, `dlat` < 0 going south),
 * longitude wrapping round; latitudes past the grid take its edge row.
 */
export function sampleGrid(
  values: ArrayLike<number | null>,
  g: { lon0: number; lat0: number; dlon: number; dlat: number; nlon: number; nlat: number },
  lon: number,
  lat: number,
): number {
  const x = (((lon - g.lon0) / g.dlon) % g.nlon + g.nlon) % g.nlon;
  const y = Math.max(0, Math.min(g.nlat - 1, (lat - g.lat0) / g.dlat));
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const x1 = (x0 + 1) % g.nlon;
  const y1 = Math.min(y0 + 1, g.nlat - 1);
  const fx = x - x0;
  const fy = y - y0;
  const v = (r: number, c: number) => values[r * g.nlon + c] ?? 0;
  return (v(y0, x0) * (1 - fx) + v(y0, x1) * fx) * (1 - fy) + (v(y1, x0) * (1 - fx) + v(y1, x1) * fx) * fy;
}

/** A field on the shared 1° grid as bytes: `value / full` of 255, clamped. */
export function toGrid(sample: (lon: number, lat: number) => number, full: number): Uint8Array {
  const out = new Uint8Array(GRID_W * GRID_H);
  for (let r = 0; r < GRID_H; r++) {
    for (let c = 0; c < GRID_W; c++) {
      out[r * GRID_W + c] = Math.max(0, Math.min(255, Math.round((sample(c - 180, 90 - r) / full) * 255)));
    }
  }
  return out;
}

/** Byte 255 in the texture: the top of each colour ramp (the shader mirrors these). */
export const TEC_FULL = 120; // TECU
export const DRAP_FULL = 35; // MHz, SWPC's own scale

export function tecGrid(m: TecManifest): Uint8Array {
  return toGrid((lon, lat) => sampleGrid(m.tec, m, lon, lat) / 10, TEC_FULL);
}

export function drapGrid(d: Drap): Uint8Array {
  const g = { lon0: d.lons[0], lat0: d.lats[0], dlon: d.lons[1] - d.lons[0], dlat: d.lats[1] - d.lats[0], nlon: d.lons.length, nlat: d.lats.length };
  return toGrid((lon, lat) => sampleGrid(d.mhz, g, lon, lat), DRAP_FULL);
}

// ---- readout -----------------------------------------------------------------------------

const hhmm = (iso: string | null) => (iso ? `${iso.slice(11, 16)} UTC` : '');

export function tecSummary(m: TecManifest): string {
  const values = m.tec.filter((v): v is number => v !== null).map((v) => v / 10);
  const lo = Math.round(Math.min(...values));
  const hi = Math.round(Math.max(...values));
  return `TEC ${lo}–${hi} TECU · ${hhmm(m.time)}`;
}

/** "HF absorbed up to 3.2 MHz · normal X-ray background" — the messages say what's driving it. */
export function drapSummary(d: Drap): string {
  const drivers = [d.xray, d.proton].filter((m) => m && !/^normal/i.test(m));
  const why = drivers.length ? drivers.join(' · ') : 'quiet';
  return `HF absorbed up to ${d.max.toFixed(1)} MHz · ${why} · ${hhmm(d.valid)}`;
}
