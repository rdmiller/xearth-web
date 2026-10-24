// Land surface temperature: how hot the ground itself is, from the VIIRS instruments on NOAA-20,
// NOAA-21 and Suomi NPP and the MODIS instruments on Aqua and Terra (NASA LANCE, via GIBS). Not
// the air temperature a forecast gives: a desert's sand at 2 pm runs 20–30 °C above the air, and
// a clear night's ground below it. It's clear-sky only, so where clouds sat during every pass
// there's none.
//
// Each satellite's day is its swaths, a day pass (~1:30 pm, local) and a night pass (~1:30 am),
// so one alone leaves gaps between swaths and under clouds. They're filled in priority order:
// VIIRS's three, today then yesterday, then MODIS's two. The three VIIRS cross at the same local
// time, so they agree (a median difference of 0 K on 2026-10-23); Aqua's and Terra's orbits have
// drifted, Terra's to mid-morning, and read 4–7 K cooler by day, so they only fill what VIIRS
// missed on both days. On 2026-10-24 that saw 84% of the land outside Antarctica by day with VIIRS
// alone and 89% with MODIS (82% and 89% by night); what's left is cloud.
//
// GIBS colours them all with one map (MODIS_Land_Surface_Temp, 200–350 K in 0.6 K bins), and
// every pixel of every PNG was an exact colour of it, so each is read back to °C as sst.ts reads
// MUR, and the globe draws it in its own ramp. Its WMS answers a satellite's missing day with a
// transparent picture, so a satellite that's down only leaves gaps.
//
// The near-real-time passes have bad pixels: on 2026-10-23 VIIRS's had 1–53 a pass in the open
// top bin (350 K, 77 °C, or more), in cloudy tropics, some at night, so that bin is no data. Below
// it, single texels still run 15 °C or more from their neighbours (~0.8% of them by day), up to
// 76 °C at night in Colombia, so the readout's hottest is a block's median, not one texel.

import { fetchField, reader, SST_H, SST_W } from './sst';
import { formatCoordinates } from './places';

export type LstMode = 'off' | 'auto' | 'day' | 'night';
export type LstSide = 'day' | 'night';

export interface LstSat {
  /** The start of its GIBS layer names. */
  id: string;
  name: string;
  instrument: 'VIIRS' | 'MODIS';
}

/** In the order they fill each day: VIIRS's three, then MODIS's two (see above). */
export const LST_SATS: readonly LstSat[] = [
  { id: 'VIIRS_NOAA20', name: 'NOAA-20', instrument: 'VIIRS' },
  { id: 'VIIRS_NOAA21', name: 'NOAA-21', instrument: 'VIIRS' },
  { id: 'VIIRS_SNPP', name: 'Suomi NPP', instrument: 'VIIRS' },
  { id: 'MODIS_Aqua', name: 'Aqua', instrument: 'MODIS' },
  { id: 'MODIS_Terra', name: 'Terra', instrument: 'MODIS' },
];

export const lstLayer = (sat: LstSat, side: LstSide) => `${sat.id}_Land_Surface_Temp_${side === 'day' ? 'Day' : 'Night'}`;

/** The passes a mode draws: `auto` puts the afternoon's on the sunlit side and the night's on the dark. */
export const lstSides = (mode: LstMode): LstSide[] => (mode === 'auto' ? ['day', 'night'] : mode === 'off' ? [] : [mode]);

/** Today's passes fill in through the day, so it's looked at hourly. */
export const LST_CHECK_MS = 60 * 60_000;
/** A day's picture is final once fetched this long after the day ends: passes land in GIBS ~3 h after they're taken. */
export const LST_SETTLE_MS = 6 * 60 * 60_000;
const DAY_MS = 86_400_000;

/** The UTC days it's drawn from, newest first: today, filling in, and yesterday. */
export function lstDates(now: Date): [string, string] {
  const day = (t: number) => new Date(t).toISOString().slice(0, 10);
  return [day(now.getTime()), day(now.getTime() - DAY_MS)];
}

/** Each source in the order it fills: VIIRS today, VIIRS yesterday, then MODIS the same. */
export function fillOrder(dates: readonly string[]): { sat: LstSat; date: string }[] {
  const by = (instrument: LstSat['instrument']) => dates.flatMap((date) => LST_SATS.filter((s) => s.instrument === instrument).map((sat) => ({ sat, date })));
  return [...by('VIIRS'), ...by('MODIS')];
}

/** GIBS's colour map MODIS_Land_Surface_Temp.xml (v1.3, 2026-10-24): r, g, b, bin middle °C (the open ends half a bin out). */
const LST_COLOURS = [
  201,0,255,-73.45, 197,0,255,-72.85, 193,0,255,-72.25, 189,0,255,-71.65, 185,0,255,-71.05,
  181,0,255,-70.45, 177,0,255,-69.85, 173,0,255,-69.25, 169,0,255,-68.65, 165,0,255,-68.05,
  161,0,255,-67.45, 157,0,255,-66.85, 153,0,255,-66.25, 149,0,255,-65.65, 145,0,255,-65.05,
  141,0,255,-64.45, 137,0,255,-63.85, 133,0,255,-63.25, 129,0,255,-62.65, 125,0,255,-62.05,
  121,0,255,-61.45, 117,0,255,-60.85, 113,0,255,-60.25, 109,0,255,-59.65, 105,0,255,-59.05,
  101,0,255,-58.45, 97,0,255,-57.85, 93,0,255,-57.25, 89,0,255,-56.65, 85,0,255,-56.05,
  81,0,255,-55.45, 77,0,255,-54.85, 73,0,255,-54.25, 69,0,255,-53.65, 65,0,255,-53.05,
  61,0,255,-52.45, 57,0,255,-51.85, 53,0,255,-51.25, 49,0,255,-50.65, 45,0,255,-50.05,
  41,0,255,-49.45, 37,0,255,-48.85, 33,0,255,-48.25, 29,0,255,-47.65, 25,0,255,-47.05,
  21,0,255,-46.45, 17,0,255,-45.85, 13,0,255,-45.25, 9,0,255,-44.65, 5,0,255,-44.05,
  1,0,255,-43.45, 0,10,255,-42.85, 0,15,255,-42.25, 0,20,255,-41.65, 0,26,255,-41.05,
  0,31,255,-40.45, 0,36,255,-39.85, 0,41,255,-39.25, 0,46,255,-38.65, 0,51,255,-38.05,
  0,56,255,-37.45, 0,61,255,-36.85, 0,66,255,-36.25, 0,71,255,-35.65, 0,77,255,-35.05,
  0,82,255,-34.45, 0,87,255,-33.85, 0,92,255,-33.25, 0,97,255,-32.65, 0,102,255,-32.05,
  0,107,255,-31.45, 0,112,255,-30.85, 0,117,255,-30.25, 0,122,255,-29.65, 0,128,255,-29.05,
  0,133,255,-28.45, 0,138,255,-27.85, 0,143,255,-27.25, 0,148,255,-26.65, 0,153,255,-26.05,
  0,158,255,-25.45, 0,163,255,-24.85, 0,168,255,-24.25, 0,173,255,-23.65, 0,179,255,-23.05,
  0,184,255,-22.45, 0,189,255,-21.85, 0,194,255,-21.25, 0,199,255,-20.65, 0,204,255,-20.05,
  0,209,255,-19.45, 0,214,255,-18.85, 0,219,255,-18.25, 0,224,255,-17.65, 0,230,255,-17.05,
  0,235,255,-16.45, 0,240,255,-15.85, 0,245,255,-15.25, 0,250,255,-14.65, 0,255,255,-14.05,
  4,255,247,-13.45, 11,255,230,-12.85, 15,255,222,-12.25, 18,255,213,-11.65, 22,255,205,-11.05,
  26,255,196,-10.45, 29,255,188,-9.85, 33,255,179,-9.25, 36,255,171,-8.65, 40,255,162,-8.05,
  44,255,154,-7.45, 47,255,145,-6.85, 51,255,137,-6.25, 55,255,128,-5.65, 58,255,120,-5.05,
  62,255,111,-4.45, 66,255,103,-3.85, 69,255,94,-3.25, 73,255,86,-2.65, 77,255,77,-2.05,
  80,255,69,-1.45, 84,255,60,-0.85, 87,255,52,-0.25, 91,255,43,0.35, 95,255,35,0.95,
  98,255,26,1.55, 102,255,18,2.15, 106,255,9,2.75, 109,255,1,3.35, 113,255,0,3.95, 117,255,0,4.55,
  120,255,0,5.15, 124,255,0,5.75, 128,255,0,6.35, 131,255,0,6.95, 135,255,0,7.55, 138,255,0,8.15,
  142,255,0,8.75, 146,255,0,9.35, 149,255,0,9.95, 153,255,0,10.55, 157,255,0,11.15,
  160,255,0,11.75, 164,255,0,12.35, 168,255,0,12.95, 171,255,0,13.55, 175,255,0,14.15,
  179,255,0,14.75, 182,255,0,15.35, 186,255,0,15.95, 189,255,0,16.55, 197,255,0,17.15,
  200,255,0,17.75, 204,255,0,18.35, 208,255,0,18.95, 211,255,0,19.55, 215,255,0,20.15,
  219,255,0,20.75, 222,255,0,21.35, 226,255,0,21.95, 230,255,0,22.55, 233,255,0,23.15,
  237,255,0,23.75, 240,255,0,24.35, 244,255,0,24.95, 248,255,0,25.55, 251,255,0,26.15,
  255,255,0,26.75, 255,253,0,27.35, 255,250,0,27.95, 255,247,0,28.55, 255,244,0,29.15,
  255,241,0,29.75, 255,238,0,30.35, 255,235,0,30.95, 255,232,0,31.55, 255,229,0,32.15,
  255,226,0,32.75, 255,223,0,33.35, 255,220,0,33.95, 255,217,0,34.55, 255,214,0,35.15,
  255,211,0,35.75, 255,208,0,36.35, 255,205,0,36.95, 255,202,0,37.55, 255,199,0,38.15,
  255,196,0,38.75, 255,193,0,39.35, 255,190,0,39.95, 255,187,0,40.55, 255,184,0,41.15,
  255,181,0,41.75, 255,178,0,42.35, 255,175,0,42.95, 255,172,0,43.55, 255,169,0,44.15,
  255,166,0,44.75, 255,163,0,45.35, 255,160,0,45.95, 255,157,0,46.55, 255,151,0,47.15,
  255,148,0,47.75, 255,145,0,48.35, 255,142,0,48.95, 255,139,0,49.55, 255,136,0,50.15,
  255,133,0,50.75, 255,130,0,51.35, 255,127,0,51.95, 255,124,0,52.55, 255,121,0,53.15,
  255,118,0,53.75, 255,115,0,54.35, 255,112,0,54.95, 255,109,0,55.55, 255,106,0,56.15,
  255,103,0,56.75, 255,100,0,57.35, 255,97,0,57.95, 255,94,0,58.55, 255,91,0,59.15, 255,88,0,59.75,
  255,85,0,60.35, 255,82,0,60.95, 255,79,0,61.55, 255,76,0,62.15, 255,73,0,62.75, 255,70,0,63.35,
  255,67,0,63.95, 255,64,0,64.55, 255,61,0,65.15, 255,58,0,65.75, 255,55,0,66.35, 255,52,0,66.95,
  255,49,0,67.55, 255,46,0,68.15, 255,43,0,68.75, 255,40,0,69.35, 255,37,0,69.95, 255,34,0,70.55,
  255,31,0,71.15, 255,28,0,71.75, 255,25,0,72.35, 255,22,0,72.95, 255,19,0,73.55, 255,16,0,74.15,
  255,13,0,74.75, 255,10,0,75.35, 255,7,0,75.95, 255,4,0,76.55, 255,1,0,77.15,
];

const binValue = reader(LST_COLOURS);
/** The open top bin (≥ 350 K) holds only bad retrievals: no data. */
const TOP_BIN_C = LST_COLOURS[LST_COLOURS.length - 1];

export const lstValue = (r: number, g: number, b: number): number => {
  const v = binValue(r, g, b);
  return v >= TOP_BIN_C ? NaN : v;
};

/** Each texel from the first field, in fill order, that has it; NaN where none does. */
export function composite(fields: readonly (Float32Array | undefined)[], n: number): Float32Array {
  const out = new Float32Array(n).fill(NaN);
  let left = n;
  for (const f of fields) {
    if (!f || !left) continue;
    for (let i = 0; i < n; i++) {
      if (Number.isNaN(out[i]) && !Number.isNaN(f[i])) {
        out[i] = f[i];
        left--;
      }
    }
  }
  return out;
}

/** The texture's range, °C: Antarctica's winter nights to the hottest deserts' afternoons. */
export const LST_RANGE = [-80, 80] as const;

/**
 * The afternoon and the night as one RGBA texture, each premultiplied by its own coverage:
 * r = the afternoon's temperature where b = 255, g = the night's where a = 255, all zero
 * where a pass saw nothing. So a mipmap's r / b is the mean of only the ground that was seen.
 */
export function encodeLst(day: Float32Array | undefined, night: Float32Array | undefined, n: number): Uint8Array {
  const out = new Uint8Array(n * 4);
  const [lo, hi] = LST_RANGE;
  const scale = (v: number) => Math.round(Math.min(1, Math.max(0, (v - lo) / (hi - lo))) * 255);
  for (let i = 0; i < n; i++) {
    if (day && !Number.isNaN(day[i])) {
      out[i * 4] = scale(day[i]);
      out[i * 4 + 2] = 255;
    }
    if (night && !Number.isNaN(night[i])) {
      out[i * 4 + 1] = scale(night[i]);
      out[i * 4 + 3] = 255;
    }
  }
  return out;
}

export interface LstSpot {
  c: number;
  lat: number;
  lon: number;
}

/** Of a 3 × 3 block, at least this many seen for its median to count: most of ~80 km square. */
const BLOCK_MIN = 7;

/**
 * The hottest place: the highest median of a 3 × 3 block of texels (on the 0.25° grid, wrapping
 * in longitude), most of it seen, and the block's middle. One bad texel can't make it.
 */
export function hottest(field: Float32Array): LstSpot | undefined {
  let best = -Infinity;
  let at = -1;
  const block: number[] = [];
  for (let y = 1; y < SST_H - 1; y++) {
    for (let x = 0; x < SST_W; x++) {
      if (Number.isNaN(field[y * SST_W + x])) continue;
      block.length = 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const v = field[(y + dy) * SST_W + ((x + dx + SST_W) % SST_W)];
          if (!Number.isNaN(v)) block.push(v);
        }
      }
      if (block.length < BLOCK_MIN) continue;
      block.sort((a, b) => a - b);
      const m = block.length % 2 ? block[block.length >> 1] : (block[block.length / 2 - 1] + block[block.length / 2]) / 2;
      if (m > best) [best, at] = [m, y * SST_W + x];
    }
  }
  if (at < 0) return undefined;
  const y = Math.floor(at / SST_W);
  return { c: best, lat: 90 - (y + 0.5) * 0.25, lon: -180 + ((at % SST_W) + 0.5) * 0.25 };
}

export interface LstFrame {
  /** Today and yesterday (UTC). */
  dates: [string, string];
  rgba: Uint8Array;
  /** The hottest afternoon ground, and the warmest at night (hottest()), when those passes were fetched. */
  hottest?: LstSpot;
  warmestNight?: LstSpot;
  /** The instruments that filled anything. */
  instruments: LstSat['instrument'][];
}

const spot = (s: LstSpot) => `${s.c.toFixed(1)} °C at ${formatCoordinates(s.lat, s.lon)}`;

/** "23–24 Oct", or "31 Oct–1 Nov" */
function span(newest: string, oldest: string): string {
  const fmt = (d: string, month: boolean) =>
    new Date(`${d}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', ...(month ? { month: 'short' } : {}), timeZone: 'UTC' });
  return `${fmt(oldest, oldest.slice(0, 7) !== newest.slice(0, 7))}–${fmt(newest, true)}`;
}

const PASSES: Record<Exclude<LstMode, 'off'>, string> = {
  auto: 'afternoon by day, night by night',
  day: 'afternoon (~1:30 pm)',
  night: 'night (~1:30 am)',
};

/** The readout: sources and days, which passes, the scale, and the hottest ground. */
export function lstSummary(mode: Exclude<LstMode, 'off'>, f: Pick<LstFrame, 'dates' | 'hottest' | 'warmestNight' | 'instruments'>): string {
  const parts = [`${f.instruments.join('/') || 'VIIRS'} ${span(...f.dates)}`, PASSES[mode], '−40 °C blue → 0 pale → 60 °C red'];
  if (mode !== 'night' && f.hottest) parts.push(`hottest ${spot(f.hottest)}`);
  if (mode !== 'day' && f.warmestNight) parts.push(`warmest night ${spot(f.warmestNight)}`);
  return parts.join(' · ');
}

/**
 * Fetches each satellite's day and night pictures for today and yesterday, as the mode needs
 * them, and keeps them: today's are fetched again at each look, as its passes land, and
 * yesterday's until they're final; switching modes fetches only the passes not yet held.
 */
export class LstLoader {
  private readonly held = new Map<string, { field: Float32Array; at: number }>();

  constructor(private readonly fetchLayer: (layer: string, date: string) => Promise<Float32Array> = (layer, date) => fetchField(layer, date, lstValue)) {}

  async load(now: Date, mode: LstMode): Promise<LstFrame> {
    const dates = lstDates(now);
    for (const k of this.held.keys()) if (!dates.some((d) => k.endsWith(`/${d}`))) this.held.delete(k);
    const sides = lstSides(mode);
    const order = fillOrder(dates);
    const want = sides.flatMap((side) => order.map(({ sat, date }) => ({ key: `${lstLayer(sat, side)}/${date}`, layer: lstLayer(sat, side), date })));
    const stale = want.filter(({ key, date }) => {
      const h = this.held.get(key);
      return !h || h.at < Date.parse(`${date}T00:00:00Z`) + DAY_MS + LST_SETTLE_MS;
    });
    const got = await Promise.allSettled(
      stale.map(async ({ key, layer, date }) => this.held.set(key, { field: await this.fetchLayer(layer, date), at: now.getTime() })),
    );
    const failed = got.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
    if (failed.length && want.every(({ key }) => !this.held.has(key))) throw failed[0].reason;

    const n = SST_W * SST_H;
    const instruments = new Set<LstSat['instrument']>();
    const side = (s: LstSide) => {
      if (!sides.includes(s)) return undefined;
      const fields = order.map(({ sat, date }) => this.held.get(`${lstLayer(sat, s)}/${date}`)?.field);
      fields.forEach((f, i) => f?.some((v) => !Number.isNaN(v)) && instruments.add(order[i].sat.instrument));
      return composite(fields, n);
    };
    const day = side('day');
    const night = side('night');
    return {
      dates,
      rgba: encodeLst(day, night, n),
      hottest: day && hottest(day),
      warmestNight: night && hottest(night),
      instruments: (['VIIRS', 'MODIS'] as const).filter((i) => instruments.has(i)),
    };
  }
}
