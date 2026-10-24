// Soil moisture: how much water is in the ground, from NASA's SMAP (Soil Moisture Active
// Passive) satellite, via GIBS. SMAP's radiometer sees the top ~5 cm through its L-band
// microwaves, cloud or no cloud, but in 1,000 km swaths every two or three days. Its Level 4
// product fills the rest: NASA GMAO's land model, run every 3 hours with SMAP's brightness
// temperatures assimilated, gives a gap-free picture at 9 km of both the top 5 cm and the root
// zone (0–100 cm), the water crops and forests draw on and droughts drain. GIBS has its 12 UTC
// field each day, ~4 days behind.
//
// The two layers share one GIBS colour map (SMAP_Analyzed_Soil_Moisture, 0–0.70 m³/m³ in 254
// bins and an open top), and every pixel of both pictures on 2026-10-20 was an exact colour of
// it, so each is read back to m³/m³ as sst.ts reads MUR, and the globe draws it in its own ramp,
// brown when dry to blue when wet. The open top (0.70 or more) is real: the peat of the boreal
// forests and the Amazon's and Congo's wetlands, where the soil is mostly water.
//
// GIBS leaves the ice sheets and open water transparent, so Antarctica, Greenland and the sea
// stay as they are.

import { GIBS_BASE, newestDate } from './gibs';
import { fetchField, reader, SST_H, SST_W } from './sst';

export type SoilMode = 'off' | 'surface' | 'root';

export const SURFACE_LAYER = 'SMAP_L4_Analyzed_Surface_Soil_Moisture';
export const ROOT_LAYER = 'SMAP_L4_Analyzed_Root_Zone_Soil_Moisture';
/** GIBS has each day ~4 days on, so an hourly look is plenty. */
export const SOIL_CHECK_MS = 60 * 60_000;

/** GIBS's colour map SMAP_Analyzed_Soil_Moisture.xml (v1.3, 2026-10-24): r, g, b, bin middle m³/m³ (the open top half a bin out). */
const SOIL_COLOURS = [
  255,162,0,0.00138, 255,165,0,0.00413, 255,167,0,0.00689, 255,170,0,0.00965, 255,172,0,0.01240,
  255,174,0,0.01516, 255,177,0,0.01791, 255,179,0,0.02067, 255,181,0,0.02343, 255,184,0,0.02618,
  255,186,0,0.02894, 255,189,0,0.03169, 255,191,0,0.03445, 255,193,0,0.03720, 255,196,0,0.03996,
  255,198,0,0.04272, 255,200,0,0.04547, 255,203,0,0.04823, 255,205,0,0.05098, 255,208,0,0.05374,
  255,210,0,0.05650, 255,212,0,0.05925, 255,215,0,0.06201, 255,217,0,0.06476, 255,219,0,0.06752,
  255,222,0,0.07028, 255,224,0,0.07303, 255,227,0,0.07579, 255,229,0,0.07854, 255,231,0,0.08130,
  255,234,0,0.08406, 255,236,0,0.08681, 255,238,0,0.08957, 255,241,0,0.09232, 255,243,0,0.09508,
  255,246,0,0.09783, 255,248,0,0.10059, 255,249,0,0.10335, 255,250,0,0.10610, 255,251,0,0.10886,
  255,253,0,0.11161, 255,255,0,0.11437, 255,254,0,0.11713, 249,252,0,0.11988, 243,249,0,0.12264,
  237,246,0,0.12539, 231,243,0,0.12815, 225,240,0,0.13091, 219,237,0,0.13366, 213,234,0,0.13642,
  208,231,0,0.13917, 202,228,0,0.14193, 196,225,0,0.14469, 190,222,0,0.14744, 184,219,0,0.15020,
  178,216,0,0.15295, 172,213,0,0.15571, 166,210,0,0.15846, 160,207,0,0.16122, 154,204,0,0.16398,
  148,201,0,0.16673, 142,198,0,0.16949, 136,195,0,0.17224, 130,193,0,0.17500, 125,190,0,0.17776,
  119,187,0,0.18051, 113,184,0,0.18327, 107,181,0,0.18602, 101,178,0,0.18878, 95,175,0,0.19154,
  89,172,0,0.19429, 83,169,0,0.19705, 77,166,0,0.19980, 71,163,0,0.20256, 65,160,0,0.20531,
  59,157,0,0.20807, 53,154,0,0.21083, 47,151,0,0.21358, 42,148,0,0.21634, 36,145,0,0.21909,
  30,142,0,0.22185, 24,139,0,0.22461, 18,136,0,0.22736, 12,133,0,0.23012, 6,130,0,0.23287,
  0,130,0,0.23563, 0,130,6,0.23839, 0,133,12,0.24114, 0,136,19,0.24390, 0,139,25,0.24665,
  0,143,31,0.24941, 0,146,37,0.25217, 0,149,44,0.25492, 0,152,50,0.25768, 0,155,56,0.26043,
  0,158,62,0.26319, 0,161,68,0.26594, 0,164,75,0.26870, 0,168,81,0.27146, 0,171,87,0.27421,
  0,174,93,0.27697, 0,177,100,0.27972, 0,180,106,0.28248, 0,183,112,0.28524, 0,186,118,0.28799,
  0,189,124,0.29075, 0,193,131,0.29350, 0,196,137,0.29626, 0,199,143,0.29902, 0,202,149,0.30177,
  0,205,155,0.30453, 0,208,162,0.30728, 0,211,168,0.31004, 0,214,174,0.31280, 0,218,180,0.31555,
  0,221,187,0.31831, 0,224,193,0.32106, 0,227,199,0.32382, 0,230,205,0.32657, 0,233,211,0.32933,
  0,236,218,0.33209, 0,239,224,0.33484, 0,243,230,0.33760, 0,246,236,0.34035, 0,249,243,0.34311,
  0,252,249,0.34587, 0,254,255,0.34862, 0,255,255,0.35138, 0,253,255,0.35413, 0,249,255,0.35689,
  0,243,255,0.35965, 0,237,255,0.36240, 0,231,255,0.36516, 0,225,255,0.36791, 0,219,255,0.37067,
  0,213,255,0.37343, 0,208,255,0.37618, 0,202,255,0.37894, 0,196,255,0.38169, 0,190,255,0.38445,
  0,184,255,0.38720, 0,178,255,0.38996, 0,172,255,0.39272, 0,166,255,0.39547, 0,160,255,0.39823,
  0,154,255,0.40098, 0,148,255,0.40374, 0,142,255,0.40650, 0,136,255,0.40925, 0,130,255,0.41201,
  0,125,255,0.41476, 0,119,255,0.41752, 0,113,255,0.42028, 0,107,255,0.42303, 0,101,255,0.42579,
  0,95,255,0.42854, 0,89,255,0.43130, 0,83,255,0.43406, 0,77,255,0.43681, 0,71,255,0.43957,
  0,65,255,0.44232, 0,59,255,0.44508, 0,53,255,0.44783, 0,47,255,0.45059, 0,42,255,0.45335,
  0,36,255,0.45610, 0,30,255,0.45886, 0,24,255,0.46161, 0,18,255,0.46437, 0,12,255,0.46713,
  0,6,255,0.46988, 0,0,255,0.47264, 0,0,251,0.47539, 0,0,248,0.47815, 0,0,244,0.48091,
  0,0,241,0.48366, 0,0,237,0.48642, 0,0,233,0.48917, 0,0,230,0.49193, 0,0,226,0.49469,
  0,0,223,0.49744, 0,0,219,0.50020, 0,0,215,0.50295, 0,0,212,0.50571, 0,0,208,0.50846,
  0,0,205,0.51122, 0,0,201,0.51398, 0,0,197,0.51673, 0,0,194,0.51949, 0,0,190,0.52224,
  0,0,187,0.52500, 0,0,183,0.52776, 0,0,179,0.53051, 0,0,176,0.53327, 0,0,172,0.53602,
  0,0,168,0.53878, 0,0,165,0.54154, 0,0,161,0.54429, 0,0,158,0.54705, 0,0,154,0.54980,
  0,0,150,0.55256, 0,0,147,0.55531, 0,0,143,0.55807, 0,0,140,0.56083, 0,0,136,0.56358,
  0,0,132,0.56634, 0,0,129,0.56909, 0,0,125,0.57185, 0,0,122,0.57461, 0,0,118,0.57736,
  0,0,114,0.58012, 0,0,111,0.58287, 0,0,107,0.58563, 0,0,104,0.58839, 0,0,100,0.59114,
  2,2,100,0.59390, 4,4,100,0.59665, 6,6,100,0.59941, 8,8,100,0.60217, 10,10,100,0.60492,
  12,12,100,0.60768, 14,14,100,0.61043, 16,16,100,0.61319, 18,18,100,0.61594, 20,20,100,0.61870,
  22,22,100,0.62146, 24,24,100,0.62421, 26,26,100,0.62697, 28,28,100,0.62972, 30,30,100,0.63248,
  32,32,100,0.63524, 34,34,90,0.63799, 36,36,90,0.64075, 38,38,90,0.64350, 40,40,90,0.64626,
  42,42,90,0.64902, 44,44,90,0.65177, 46,46,90,0.65453, 48,48,90,0.65728, 50,50,90,0.66004,
  52,52,90,0.66280, 54,54,90,0.66555, 56,56,90,0.66831, 58,58,90,0.67106, 60,60,80,0.67382,
  62,62,80,0.67657, 64,64,80,0.67933, 66,66,80,0.68209, 68,68,80,0.68484, 70,70,80,0.68760,
  72,72,80,0.69035, 74,74,80,0.69311, 76,76,80,0.69587, 78,78,80,0.69862, 80,80,80,0.70138,
];

export const soilValue = reader(SOIL_COLOURS);

/** The texture's range, m³/m³: bone dry to the wettest peat. */
export const SOIL_RANGE = [0, 0.75] as const;

/**
 * Both depths as one RGBA texture: r = the top 5 cm, g = the root zone (each scaled to the
 * range), a = 255 where there's data and all zero where not, premultiplied by construction as
 * the SST's is.
 */
export function encodeSoil(surface: Float32Array, root: Float32Array): Uint8Array {
  const out = new Uint8Array(surface.length * 4);
  const [lo, hi] = SOIL_RANGE;
  const scale = (v: number) => Math.round(Math.min(1, Math.max(0, (v - lo) / (hi - lo))) * 255);
  for (let i = 0; i < surface.length; i++) {
    const s = surface[i];
    const r = root[i];
    if (Number.isNaN(s) && Number.isNaN(r)) continue;
    // One without the other (none seen on 2026-10-20) borrows its partner's.
    out[i * 4] = scale(Number.isNaN(s) ? r : s);
    out[i * 4 + 1] = scale(Number.isNaN(r) ? s : r);
    out[i * 4 + 3] = 255;
  }
  return out;
}

/** The share of the land seen (by area) drier than `below` m³/m³: deserts, and drought. */
export function dryShare(field: Float32Array, below = 0.1): number {
  let dry = 0;
  let all = 0;
  for (let y = 0; y < SST_H; y++) {
    const w = Math.cos(((90 - (y + 0.5) * 0.25) * Math.PI) / 180);
    for (let x = 0; x < SST_W; x++) {
      const v = field[y * SST_W + x];
      if (Number.isNaN(v)) continue;
      all += w;
      if (v < below) dry += w;
    }
  }
  return all ? dry / all : 0;
}

export interface SoilFrame {
  date: string;
  rgba: Uint8Array;
  /** The share of the land drier than 0.1 m³/m³, at each depth. */
  dry: { surface: number; root: number };
}

const DEPTH: Record<Exclude<SoilMode, 'off'>, string> = { surface: 'top 5 cm', root: 'root zone, 0–100 cm' };

/** The readout: the day, the depth, the scale and how much of the land is dry. */
export function soilSummary(mode: Exclude<SoilMode, 'off'>, f: Pick<SoilFrame, 'date' | 'dry'>): string {
  const day = new Date(`${f.date}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
  const dry = f.dry[mode];
  return `SMAP L4 ${day} 12 UTC · ${DEPTH[mode]} · 0.05 m³/m³ brown → 0.5 blue · ${(dry * 100).toFixed(0)}% of the land below 0.1`;
}

/** GIBS's list of SMAP L4's days over the last ten (it's ~4 days behind). */
export function soilDomainUrl(now: Date): string {
  const day = (d: Date) => d.toISOString().slice(0, 10);
  return `${GIBS_BASE}/1.0.0/${SURFACE_LAYER}/default/2km/all/${day(new Date(now.getTime() - 10 * 86_400_000))}--${day(now)}.xml`;
}

/** The newest day's two depths, fetched when GIBS has a day newer than `have`. */
export async function loadSoil(now: Date, have?: string): Promise<SoilFrame | null> {
  const r = await fetch(soilDomainUrl(now), { cache: 'no-cache' });
  if (!r.ok) throw new Error(`${r.status} GIBS SMAP days`);
  const date = newestDate(await r.text());
  if (!date) throw new Error('GIBS lists no SMAP days');
  if (date === have) return null;
  const [surface, root] = await Promise.all([fetchField(SURFACE_LAYER, date, soilValue), fetchField(ROOT_LAYER, date, soilValue)]);
  return { date, rgba: encodeSoil(surface, root), dry: { surface: dryShare(surface), root: dryShare(root) } };
}
