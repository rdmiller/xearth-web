// Launch mode: upcoming launches from Launch Library 2, and — for Starlink
// missions — SpaceX's pre-launch orbit prediction (via CelesTrak SupGP).
//
// No launch provider publishes live telemetry. So the phases are:
//   countdown  pad marker, T−hh:mm:ss, status
//   ascent     T0 → ~T+8.5 min: a synthesised arc from the pad up to the
//              predicted orbit (labelled "approx.")
//   coast      engine cut-off → deploy: the stack on SpaceX's predicted orbit
//   deployed   after the exact deploy time: one satellite's predicted orbit
// Launches without a predicted orbit get the countdown and an "in flight"
// marker on the pad, but no invented trajectory.

import type { SatRec } from 'satellite.js';
import { EARTH_RADIUS_KM, positionAt, satrecFor, type Elements } from './satellites';
import { dot, fromLatLon, normalize, scale, type Vec3 } from './vec';

/** Falcon 9 second-stage engine cut-off is ~T+8.5 min on Starlink flights. */
export const ASCENT_S = 510;
/** Show countdowns this far ahead. */
export const COUNTDOWN_AHEAD_MS = 48 * 3_600_000;
/** Keep following a deployed stack this long. */
export const DEPLOYED_FOR_MS = 6 * 3_600_000;
/** Launches with no trajectory data stay "in flight" on the pad this long. */
export const INFLIGHT_FOR_MS = 10 * 60_000;
/** A pre-launch opportunity counts as the launch's if within this of its NET. */
const MATCH_MS = 3 * 60_000;

export interface PrelaunchVariant {
  file: string;
  launch: string;
  deploy: string;
  windowStart?: string | null;
  windowEnd?: string | null;
  stack: Elements;
  single: Elements;
}

export interface Launch {
  id: string;
  name: string;
  provider: string;
  rocket: string;
  mission: string;
  orbit?: string | null;
  net: string;
  windowStart?: string | null;
  windowEnd?: string | null;
  status: { abbrev: string; name: string };
  pad: { name: string; location: string; lat: number; lon: number };
  webcastLive: boolean;
  prelaunch?: { title: string; variants: PrelaunchVariant[] };
}

export interface LaunchManifest {
  generated: string;
  launches: Launch[];
}

export function isLaunchManifest(v: unknown): v is LaunchManifest {
  const m = v as Partial<LaunchManifest> | null;
  return !!m && typeof m.generated === 'string' && Array.isArray(m.launches);
}

/** The pre-launch opportunity matching the launch's current NET (primary or a backup). */
export function pickVariant(l: Launch): PrelaunchVariant | undefined {
  const net = Date.parse(l.net);
  let best: PrelaunchVariant | undefined;
  let gap = MATCH_MS;
  for (const v of l.prelaunch?.variants ?? []) {
    const g = Math.abs(Date.parse(v.launch) - net);
    if (g <= gap) {
      best = v;
      gap = g;
    }
  }
  return best;
}

export type LaunchPhase = 'countdown' | 'ascent' | 'coast' | 'deployed' | 'inflight' | 'done';

export interface LaunchState {
  launch: Launch;
  phase: LaunchPhase;
  /** Seconds since T0 (negative before liftoff). */
  t: number;
  /** T0 in ms (the matched opportunity's launch time, else the NET). */
  t0: number;
  pad: Vec3;
  /** The vehicle (or stack / satellite), Earth radii; the pad before liftoff. */
  pos: Vec3;
  /** Earth-fixed speed, km/s, and altitude, km (absent before liftoff). */
  speed?: number;
  altKm?: number;
  /** Seconds from T0 to deployment, when known. */
  deployT?: number;
  /** True for the synthesised ascent (no published trajectory). */
  approximate: boolean;
}

const smooth = (a: number, b: number, s: number) => a + (b - a) * s;

/**
 * A point on the synthesised ascent: the direction slerps from the pad to the
 * predicted orbit position at engine cut-off while altitude follows an S-curve,
 * u²(3−2u) — close to a typical Falcon 9 profile (~10 km at T+1:00, ~50–80 km at
 * main-engine cut-off ~T+2:30, ~200 km by T+6:00).
 *
 * Downrange progress is a cubic with zero slope at liftoff (the rocket climbs
 * before it pitches over) and slope `endRate` at cut-off — set from the orbit's
 * own angular rate there, so the arc hands over to the orbit without a lurch.
 * `endRate` is capped below 3, beyond which the cubic would dip backward early.
 */
export function ascentPoint(pad: Vec3, seco: Vec3, s: number, endRate = 2): Vec3 {
  const u = Math.max(0, Math.min(1, s));
  const a = normalize(pad);
  const b = normalize(seco);
  const omega = Math.acos(Math.max(-1, Math.min(1, dot(a, b))));
  const k = Math.max(0, Math.min(2.9, endRate));
  const g = u * u * (3 - 2 * u) + k * u * u * (u - 1); // Hermite: g(0)=0, g'(0)=0, g(1)=1, g'(1)=k
  const dir: Vec3 =
    omega < 1e-6
      ? a
      : (normalize([
          (Math.sin((1 - g) * omega) * a[0] + Math.sin(g * omega) * b[0]) / Math.sin(omega),
          (Math.sin((1 - g) * omega) * a[1] + Math.sin(g * omega) * b[1]) / Math.sin(omega),
          (Math.sin((1 - g) * omega) * a[2] + Math.sin(g * omega) * b[2]) / Math.sin(omega),
        ]) as Vec3);
  const r = smooth(1, Math.hypot(...seco), u * u * (3 - 2 * u));
  return scale(dir, r);
}

/** Satrecs are cached per elements array (they're immutable once published). */
const recCache = new WeakMap<Elements, SatRec | null>();
function rec(e: Elements): SatRec | null {
  if (!recCache.has(e)) recCache.set(e, satrecFor(e));
  return recCache.get(e)!;
}

function vehicleAt(v: PrelaunchVariant, t0: number, tSec: number, pad: Vec3): Vec3 | null {
  const deployT = (Date.parse(v.deploy) - t0) / 1000;
  if (tSec < ASCENT_S) {
    const stack = rec(v.stack);
    const seco = stack ? positionAt(stack, new Date(t0 + ASCENT_S * 1000)) : null;
    const after = stack ? positionAt(stack, new Date(t0 + (ASCENT_S + 1) * 1000)) : null;
    if (!seco || !after) return null;
    // Match the orbit's angular rate at cut-off: k = ω·T / Ω (Ω = pad→cut-off arc).
    const omegaRate = Math.acos(Math.max(-1, Math.min(1, dot(normalize(seco), normalize(after)))));
    const arc = Math.acos(Math.max(-1, Math.min(1, dot(normalize(pad), normalize(seco)))));
    return ascentPoint(pad, seco, tSec / ASCENT_S, arc > 1e-6 ? (omegaRate * ASCENT_S) / arc : 2);
  }
  const r = rec(tSec < deployT ? v.stack : v.single);
  return r ? positionAt(r, new Date(t0 + tSec * 1000)) : null;
}

export function launchState(l: Launch, date: Date): LaunchState {
  const v = pickVariant(l);
  const t0 = v ? Date.parse(v.launch) : Date.parse(l.net);
  const now = date.getTime();
  const t = (now - t0) / 1000;
  const pad = fromLatLon(l.pad.lat, l.pad.lon);
  const deployT = v ? (Date.parse(v.deploy) - t0) / 1000 : undefined;
  const base = { launch: l, t, t0, pad, approximate: false, deployT };

  if (t < 0) return { ...base, phase: now < t0 - COUNTDOWN_AHEAD_MS ? 'done' : 'countdown', pos: pad };
  if (!v || deployT === undefined) return { ...base, phase: now - t0 < INFLIGHT_FOR_MS ? 'inflight' : 'done', pos: pad };

  if (now - t0 > deployT * 1000 + DEPLOYED_FOR_MS) return { ...base, phase: 'done', pos: pad };
  const pos = vehicleAt(v, t0, t, pad);
  if (!pos) return { ...base, phase: 'done', pos: pad };
  const next = vehicleAt(v, t0, t + 1, pad);
  const speed = next ? Math.hypot(next[0] - pos[0], next[1] - pos[1], next[2] - pos[2]) * EARTH_RADIUS_KM : undefined;
  const phase: LaunchPhase = t < ASCENT_S ? 'ascent' : t < deployT ? 'coast' : 'deployed';
  return {
    ...base,
    phase,
    pos,
    speed,
    altKm: (Math.hypot(...pos) - 1) * EARTH_RADIUS_KM,
    approximate: phase === 'ascent',
  };
}

/** The drawn route runs this far past deployment; later, the path is this much of the orbit either side of now. */
const ORBIT_WINDOW_S = 25 * 60;

type Sample = { t: number; p: Vec3 };

/** Route samples per prediction: they only change when the prediction does. */
const routeCache = new WeakMap<PrelaunchVariant, { key: string; samples: Sample[]; deploy?: Vec3 }>();

/**
 * The predicted route, sampled once per prediction: dense through the ascent
 * (where the curve bends), sparser along the coast, then 25 min past deployment.
 */
function route(v: PrelaunchVariant, t0: number, pad: Vec3, deployT: number, steps: number) {
  const key = `${t0}|${pad.join(',')}|${steps}`;
  const hit = routeCache.get(v);
  if (hit?.key === key) return hit;
  const end = deployT + ORBIT_WINDOW_S;
  const times: number[] = [];
  for (let i = 0; i <= 30; i++) times.push((ASCENT_S * i) / 30);
  for (let i = 1; i <= steps; i++) times.push(ASCENT_S + ((end - ASCENT_S) * i) / steps);
  const samples = times.flatMap((t) => {
    const p = vehicleAt(v, t0, t, pad);
    return p ? [{ t, p }] : [];
  });
  const entry = { key, samples, deploy: vehicleAt(v, t0, deployT, pad) ?? undefined };
  routeCache.set(v, entry);
  return entry;
}

/** Orbit samples around now, per prediction: resampled once a minute. */
const orbitCache = new WeakMap<PrelaunchVariant, { key: string; samples: Sample[] }>();

/** The deployed satellite's predicted orbit, ±ORBIT_WINDOW_S around tSec, on a whole-minute grid. */
function orbitAround(v: PrelaunchVariant, t0: number, pad: Vec3, tSec: number): Sample[] {
  const m = Math.floor(tSec / 60);
  const key = `${t0}|${m}`;
  const hit = orbitCache.get(v);
  if (hit?.key === key) return hit.samples;
  const w = ORBIT_WINDOW_S / 60;
  const samples: Sample[] = [];
  for (let i = m - w; i <= m + w + 1; i++) {
    const p = vehicleAt(v, t0, i * 60, pad);
    if (p) samples.push({ t: i * 60, p });
  }
  orbitCache.set(v, { key, samples });
  return samples;
}

/**
 * The flight path for drawing: the ascent arc and coast up to deployment, then
 * 25 min past it; once the satellite is beyond that, its orbit 25 min either
 * side of now. Split at "now" into flown and ahead. Built from cached samples,
 * so a frame only does the split.
 */
export function flightPath(s: LaunchState, steps = 90): { flown: Vec3[]; ahead: Vec3[]; deploy?: Vec3 } {
  const v = pickVariant(s.launch);
  if (!v || s.deployT === undefined) return { flown: [], ahead: [] };
  const r = route(v, s.t0, s.pad, s.deployT, steps);
  // Past the route's end, follow the satellite on its own orbit: joining the
  // route's end to it would draw a straight chord across the globe.
  const following = s.phase === 'deployed' && s.t > s.deployT + ORBIT_WINDOW_S;
  const samples = following ? orbitAround(v, s.t0, s.pad, s.t) : r.samples;
  // Before deployment, stop the drawn route at deployment; after, run to the samples' end.
  const end = s.phase === 'deployed' ? Infinity : Math.max(s.deployT, s.t);
  const flown: Vec3[] = [];
  const ahead: Vec3[] = [];
  for (const { t, p } of samples) {
    if (t > end) break;
    (t <= s.t ? flown : ahead).push(p);
  }
  if (s.t >= 0 && s.phase !== 'countdown') {
    flown.push(s.pos);
    ahead.unshift(s.pos);
  }
  return { flown, ahead, deploy: r.deploy };
}

/** "T−04:21:07" / "T+00:03:12". */
export function formatClock(t: number): string {
  const sign = t < 0 ? '−' : '+';
  let s = Math.floor(Math.abs(t));
  const d = Math.floor(s / 86400);
  s -= d * 86400;
  const hh = String(Math.floor(s / 3600)).padStart(2, '0');
  const mm = String(Math.floor((s % 3600) / 60)).padStart(2, '0');
  const ss = String(s % 60).padStart(2, '0');
  return `T${sign}${d ? `${d}d ` : ''}${hh}:${mm}:${ss}`;
}

/** Short rocket name for crowded pad labels: "Falcon 9 Block 5" → "Falcon 9". */
export function shortRocket(name: string): string {
  return name.replace(/\s+Block\s+\d+$/i, '').trim();
}

/** A just-deployed mission keeps the focus this long, so you see the deployment. */
export const FOCUS_AFTER_DEPLOY_S = 30 * 60;

/** The launch to follow: one in flight (or just deployed), else the next to lift off. */
export function focusLaunch(states: LaunchState[]): LaunchState | undefined {
  const active = states.filter(
    (s) =>
      s.phase === 'ascent' ||
      s.phase === 'coast' ||
      s.phase === 'inflight' ||
      (s.phase === 'deployed' && s.deployT !== undefined && s.t < s.deployT + FOCUS_AFTER_DEPLOY_S),
  );
  if (active.length) return active.sort((a, b) => b.t0 - a.t0)[0];
  const next = states.filter((s) => s.phase === 'countdown').sort((a, b) => a.t0 - b.t0)[0];
  if (next) return next;
  return states.filter((s) => s.phase === 'deployed').sort((a, b) => b.t0 - a.t0)[0];
}
