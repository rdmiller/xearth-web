// Meteors: the last day of trajectories from the Global Meteor Network, and the fireballs
// NASA/JPL's CNEOS has listed in the last 90 days, both via the pipeline (meteors.py).
//
// GMN triangulates each meteor its cameras catch from two or more sites, so every one has a
// real path through the sky: where it lit up (~100–120 km) and where it burned out (~70–90 km).
// They're drawn as short streaks along that path, at that height, so a meteor sits in the
// right place and tilts with the view. The network's cameras are mostly in Europe, the
// Americas, Australia and New Zealand: where meteors show is also where cameras are.

import { EARTH_RADIUS_KM } from './satellites';
import { fromLatLon, type Vec3 } from './vec';

export interface Fireball {
  time: string;
  lat: number;
  lon: number;
  alt: number | null;
  vel: number | null;
  /** Radiated energy, 10^10 J. */
  energy: number | null;
  /** Estimated impact energy, kilotons of TNT. */
  impactKt: number | null;
}

export interface MeteorManifest {
  generated: string;
  source: string;
  from: string | null;
  to: string | null;
  /** IAU shower codes, most numerous first, sporadic ("...") last. */
  showers: string[];
  counts: Record<string, number>;
  fields: string[];
  /** Flat, FIELDS per meteor: t s, lat0, lon0 (0.01°), h0 (0.1 km), lat1, lon1, h1, mag (0.1), shower index, v (0.1 km/s). */
  meteors: number[];
  fireballDays: number;
  fireballs: Fireball[];
}

export const FIELDS = ['t', 'lat0', 'lon0', 'h0', 'lat1', 'lon1', 'h1', 'mag', 'shower', 'v'];
export const SPORADIC = '...';

export function isMeteorManifest(v: unknown): v is MeteorManifest {
  const m = v as Partial<MeteorManifest> | null;
  return !!m && Array.isArray(m.meteors) && Array.isArray(m.showers) && Array.isArray(m.fireballs) && m.fields?.join() === FIELDS.join();
}

/** IAU shower codes GMN sees most often; anything else is shown by its code. */
export const SHOWER_NAMES: Record<string, string> = {
  ORI: 'Orionids',
  STA: 'Southern Taurids',
  NTA: 'Northern Taurids',
  LEO: 'Leonids',
  GEM: 'Geminids',
  PER: 'Perseids',
  QUA: 'Quadrantids',
  LYR: 'Lyrids',
  ETA: 'η Aquariids',
  SDA: 'Southern δ Aquariids',
  CAP: 'α Capricornids',
  DRA: 'Draconids',
  URS: 'Ursids',
  MON: 'December Monocerotids',
  HYD: 'σ Hydrids',
  EGE: 'ε Geminids',
  LMI: 'Leonis Minorids',
  NOO: 'November Orionids',
  AND: 'Andromedids',
  COM: 'Comae Berenicids',
  KCG: 'κ Cygnids',
  SPE: 'September ε Perseids',
  AUR: 'Aurigids',
};

export const showerName = (code: string) => (code === SPORADIC ? 'sporadic' : (SHOWER_NAMES[code] ?? code));

/** The three biggest showers get a colour each; everything else (minor showers, sporadics) the last. */
export const SHOWER_COLORS = ['#ffcf6b', '#7fe3ff', '#d6a6ff'];
export const OTHER_COLOR = '#a9bcdb';
/** A named shower needs this many meteors in the day to get its own colour. */
const MIN_FOR_COLOR = 30;

/** Opacity bands: streaks are batched one path per colour and band. */
export const BANDS = 5;

export interface MeteorStreak {
  a: Vec3;
  b: Vec3;
  /** Index into colors(): 0–2 a shower's, 3 everything else. */
  color: number;
  /** 1…BANDS: brighter and newer is higher. */
  band: number;
  /** Peak absolute magnitude: −2 and brighter is drawn wider. */
  mag: number;
}

/** The colour per streak colour index, and the showers that have one, in that order. */
export function showerColors(m: MeteorManifest): { codes: string[]; colors: string[] } {
  const codes = m.showers.filter((c) => c !== SPORADIC && (m.counts[c] ?? 0) >= MIN_FOR_COLOR).slice(0, SHOWER_COLORS.length);
  return { codes, colors: [...SHOWER_COLORS.slice(0, codes.length), OTHER_COLOR] };
}

/** A point `km` above the ground, in Earth radii. */
const above = (lat: number, lon: number, km: number): Vec3 => {
  const p = fromLatLon(lat, lon);
  const r = 1 + km / EARTH_RADIUS_KM;
  return [p[0] * r, p[1] * r, p[2] * r];
};

/**
 * Brightness from peak magnitude (−4 bright, +4 faint) times age (the newest full, the day's
 * oldest at 40%), as one of BANDS bands.
 */
export function band(mag: number, ageFraction: number): number {
  const bright = Math.max(0.15, Math.min(1, (4 - mag) / 7));
  const age = 1 - 0.6 * Math.max(0, Math.min(1, ageFraction));
  return Math.max(1, Math.round(bright * age * BANDS));
}

export function decodeMeteors(m: MeteorManifest): MeteorStreak[] {
  const n = FIELDS.length;
  const { codes } = showerColors(m);
  const colorOf = new Map(codes.map((c, i) => [c, i]));
  const span = m.from && m.to ? (Date.parse(m.to) - Date.parse(m.from)) / 1000 : 86_400;
  const out: MeteorStreak[] = [];
  for (let i = 0; i + n <= m.meteors.length; i += n) {
    const [t, lat0, lon0, h0, lat1, lon1, h1, mag10, shower] = m.meteors.slice(i, i + n);
    const mag = mag10 / 10;
    out.push({
      a: above(lat0 / 100, lon0 / 100, h0 / 10),
      b: above(lat1 / 100, lon1 / 100, h1 / 10),
      color: colorOf.get(m.showers[shower]) ?? codes.length,
      band: band(mag, 1 - t / span),
      mag,
    });
  }
  return out;
}

// ---- fireballs ----------------------------------------------------------------------------

/** Label the last 30 days' fireballs, and the three biggest of the 90 anyway. */
export function labelledFireballs(f: Fireball[], now: number): Fireball[] {
  const recent = f.filter((b) => now - Date.parse(b.time) <= 30 * 86_400_000);
  const biggest = [...f].sort((a, b) => (b.impactKt ?? 0) - (a.impactKt ?? 0)).slice(0, 3);
  return f.filter((b) => recent.includes(b) || biggest.includes(b));
}

const day = (iso: string) => new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' }).toUpperCase();

/** "FIREBALL · 0.67 KT", "11 SEP 01:12 UTC · 38 KM UP · 21 KM/S". */
export function fireballRows(f: Fireball): string[] {
  const kt = f.impactKt != null ? ` · ${f.impactKt < 0.1 ? f.impactKt.toFixed(2) : f.impactKt.toFixed(1)} KT` : '';
  const detail = [`${day(f.time)} ${f.time.slice(11, 16)} UTC`, f.alt != null ? `${Math.round(f.alt)} KM UP` : '', f.vel != null ? `${Math.round(f.vel)} KM/S` : '']
    .filter(Boolean)
    .join(' · ');
  return [`FIREBALL${kt}`, detail];
}

// ---- readout -------------------------------------------------------------------------------

/** "5,841 in 24 h to 21 Oct 20:55 UTC · Orionids 1,579 · 8 fireballs in 90 d". */
export function meteorSummary(m: MeteorManifest): string {
  const n = Math.floor(m.meteors.length / FIELDS.length);
  const to = m.to ? `${day(m.to).replace(/^(\d+) (\w)(\w+)$/, (_, d, a, b) => `${d} ${a}${b.toLowerCase()}`)} ${m.to.slice(11, 16)} UTC` : '';
  const { codes } = showerColors(m);
  const showers = codes.map((c) => `${showerName(c)} ${(m.counts[c] ?? 0).toLocaleString('en-US')}`);
  const fireballs = `${m.fireballs.length} fireball${m.fireballs.length === 1 ? '' : 's'} in ${m.fireballDays} d`;
  return [`${n.toLocaleString('en-US')} in 24 h${to ? ` to ${to}` : ''}`, ...showers, fireballs].join(' · ');
}
