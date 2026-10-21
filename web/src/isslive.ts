// ISS live telemetry: NASA's public ISSLive stream — values from Mission
// Control's consoles, relayed by a Lightstreamer server at JSC and published at
// push.lightstreamer.com (adapter set ISSLIVE). The symbol list is NASA's
// PUIList.xml (via Lightstreamer's ISSLive example).
//
// What the dictionary's unit fields say isn't always what arrives; these were
// checked against the live stream on 2026-10-21:
//   * the J2000 state vector is in km and m/s (not ft): |r| = 6,797 km, |v| = 7.66 km/s,
//     and turned Earth-fixed it lands within ~1 km of SGP4 for the same instant;
//   * cabin pressure and partial pressures are mmHg (cabin 748), not psi;
//   * each update's TimeStamp is hours counted from 00:00 UTC on 31 December
//     (1 January 00:00 = 24 h); the state vector's own time tag is GPS seconds.
//
// The stream only moves while the ISS has a TDRS link (acquisition of signal,
// AOS). Out of signal (LOS) — or when the feed itself stalls — the server keeps
// serving the last values, so everything here is shown with its age.

import { j2000ToEarthFixed } from './astronomy';
import { EARTH_RADIUS_KM } from './satellites';
import type { Vec3 } from './vec';

export const ISSLIVE_SERVER = 'https://push.lightstreamer.com';
export const ISSLIVE_ADAPTER = 'ISSLIVE';

export const ISS_ITEMS = {
  gmt: 'TIME_000001',
  svX: 'USLAB000032',
  svY: 'USLAB000033',
  svZ: 'USLAB000034',
  svVx: 'USLAB000035',
  svVy: 'USLAB000036',
  svVz: 'USLAB000037',
  svTime: 'USLAB000102',
  cabinPressure: 'USLAB000058',
  cabinTemp: 'USLAB000059',
  ppO2: 'USLAB000053',
  ppCO2: 'USLAB000055',
  mass: 'USLAB000039',
  beta: 'USLAB000040',
  cmg: 'USLAB000010',
  attitudeFrame: 'USLAB000017',
  maneuver: 'USLAB000081',
  stationMode: 'USLAB000086',
  laptops: 'USLAB000087',
  sarjStarboard: 'S0000003',
  sarjPort: 'S0000004',
  kuVideo: 'USLAB000088',
} as const;
export type IssKey = keyof typeof ISS_ITEMS;

export const ISS_FIELDS = ['TimeStamp', 'Value', 'CalibratedData'] as const;

export interface IssValue {
  value: string;
  /** NASA's display form: enum names ("LVLH"), DDD/HH:MM:SS times. */
  calibrated: string;
  /** When Mission Control stamped it, ms. */
  t: number;
}
export type IssValues = Map<IssKey, IssValue>;

const HOUR = 3_600_000;
/** GPS − UTC since 2017 (no leap second announced since). */
export const GPS_UTC_OFFSET_S = 18;
const GPS_EPOCH = Date.UTC(1980, 0, 6);
const MMHG_PER_PSI = 51.715;
/** Older than this, the stream isn't live: no signal, or the feed has stalled. */
export const AOS_MAX_AGE_MS = 20_000;
/** Use the telemetry state vector for the ISS's position within this long of its epoch. */
export const STATE_VECTOR_MAX_AGE_MS = 120_000;

/** ISSLive TimeStamp (hours from 00:00 UTC on 31 Dec) → ms, in the year that puts it nearest `now`. */
export function issTime(hours: number, now: number): number {
  const year = new Date(now).getUTCFullYear();
  const t = Date.UTC(year, 0, 1) + (hours - 24) * HOUR;
  return t > now + 2 * 24 * HOUR ? Date.UTC(year - 1, 0, 1) + (hours - 24) * HOUR : t;
}

export function gpsToUtc(gpsSeconds: number): number {
  return GPS_EPOCH + (gpsSeconds - GPS_UTC_OFFSET_S) * 1000;
}

const num = (v: IssValues, k: IssKey) => {
  const x = Number(v.get(k)?.value);
  return v.has(k) && Number.isFinite(x) ? x : undefined;
};

/** Live (AOS) if Greenwich time has ticked recently; otherwise how old the newest value is. */
export function signal(v: IssValues, now: number): { aos: boolean; ageMs: number } | undefined {
  const t = v.get('gmt')?.t;
  if (t === undefined) return undefined;
  return { aos: now - t < AOS_MAX_AGE_MS, ageMs: Math.max(0, now - t) };
}

export interface StateVector {
  /** J2000, km and km/s. */
  r: Vec3;
  v: Vec3;
  /** Epoch, ms UTC. */
  t: number;
}

export function stateVector(v: IssValues): StateVector | undefined {
  const [x, y, z] = [num(v, 'svX'), num(v, 'svY'), num(v, 'svZ')];
  const [vx, vy, vz] = [num(v, 'svVx'), num(v, 'svVy'), num(v, 'svVz')];
  const tag = num(v, 'svTime');
  if (tag === undefined || x === undefined || y === undefined || z === undefined) return undefined;
  if (vx === undefined || vy === undefined || vz === undefined) return undefined;
  return { r: [x, y, z], v: [vx / 1000, vy / 1000, vz / 1000], t: gpsToUtc(tag) };
}

const MU = 398600.4418; // km³/s²

/** Two-body motion from the state vector to `t` (RK4, ≤10 s steps): fine for the minute or two it's used. */
export function propagate(sv: StateVector, t: number): StateVector {
  const accel = (r: Vec3): Vec3 => {
    const k = -MU / Math.hypot(...r) ** 3;
    return [k * r[0], k * r[1], k * r[2]];
  };
  const add = (a: Vec3, b: Vec3, s: number): Vec3 => [a[0] + b[0] * s, a[1] + b[1] * s, a[2] + b[2] * s];
  let r = sv.r;
  let v = sv.v;
  const total = (t - sv.t) / 1000;
  const n = Math.max(1, Math.ceil(Math.abs(total) / 10));
  const h = total / n;
  for (let i = 0; i < n; i++) {
    const k1r = v, k1v = accel(r);
    const k2r = add(v, k1v, h / 2), k2v = accel(add(r, k1r, h / 2));
    const k3r = add(v, k2v, h / 2), k3v = accel(add(r, k2r, h / 2));
    const k4r = add(v, k3v, h), k4v = accel(add(r, k3r, h));
    const step = (x: Vec3, a: Vec3, b: Vec3, c: Vec3, d: Vec3, j: number) => x[j] + (h / 6) * (a[j] + 2 * b[j] + 2 * c[j] + d[j]);
    r = [step(r, k1r, k2r, k3r, k4r, 0), step(r, k1r, k2r, k3r, k4r, 1), step(r, k1r, k2r, k3r, k4r, 2)];
    v = [step(v, k1v, k2v, k3v, k4v, 0), step(v, k1v, k2v, k3v, k4v, 1), step(v, k1v, k2v, k3v, k4v, 2)];
  }
  return { r, v, t };
}

/** WGS-84 geodetic latitude, longitude (degrees) and height (km) from Earth-fixed km (Bowring). */
export function geodetic(p: Vec3): { lat: number; lon: number; altKm: number } {
  const a = 6378.137;
  const f = 1 / 298.257223563;
  const b = a * (1 - f);
  const e2 = f * (2 - f);
  const ep2 = (a * a - b * b) / (b * b);
  const rho = Math.hypot(p[0], p[1]);
  const th = Math.atan2(p[2] * a, rho * b);
  const lat = Math.atan2(p[2] + ep2 * b * Math.sin(th) ** 3, rho - e2 * a * Math.cos(th) ** 3);
  const n = a / Math.sqrt(1 - e2 * Math.sin(lat) ** 2);
  return {
    lat: (lat * 180) / Math.PI,
    lon: (Math.atan2(p[1], p[0]) * 180) / Math.PI,
    // Stable at every latitude (ρ / cos φ − N isn't, at the poles).
    altKm: rho * Math.cos(lat) + (p[2] + e2 * n * Math.sin(lat)) * Math.sin(lat) - n,
  };
}

/**
 * The ISS from telemetry at `date`: Earth-fixed position (Earth radii, like the
 * SGP4 path), geodetic point, and inertial speed — or undefined when there's no
 * state vector within STATE_VECTOR_MAX_AGE_MS of `date`.
 */
export function issFromTelemetry(v: IssValues, date: Date) {
  const sv = stateVector(v);
  if (!sv || Math.abs(date.getTime() - sv.t) > STATE_VECTOR_MAX_AGE_MS) return undefined;
  const now = propagate(sv, date.getTime());
  const km = j2000ToEarthFixed(now.r, date);
  return {
    pos: [km[0] / EARTH_RADIUS_KM, km[1] / EARTH_RADIUS_KM, km[2] / EARTH_RADIUS_KM] as Vec3,
    ...geodetic(km),
    speed: Math.hypot(...now.v),
  };
}

// ---- panel ---------------------------------------------------------------------------

const fixed = (x: number | undefined, d: number) => (x === undefined ? '—' : x.toFixed(d));
const label = (v: IssValues, k: IssKey) => v.get(k)?.calibrated.trim().toUpperCase() || '—';

function age(ms: number): string {
  const s = Math.round(ms / 1000);
  if (s < 120) return `${s} S`;
  if (s < 7200) return `${Math.round(s / 60)} MIN`;
  return `${Math.round(s / 3600)} H`;
}

export interface IssPanel {
  aos: boolean;
  /** "AOS" or "LOS · 21 H" */
  status: string;
  rows: string[];
}

/**
 * The telemetry panel: signal, then trajectory, attitude, cabin, power and
 * station rows. `orbit` is the telemetry-derived position, with how far the
 * TLE-propagated ISS sits from it (km), when there's a current state vector.
 */
export function issPanel(v: IssValues, now: number, orbit?: { altKm: number; speed: number; deltaKm?: number }): IssPanel | undefined {
  const sig = signal(v, now);
  if (!sig) return undefined;
  // The station's own clock, decoded (NASA's display form counts days from 0, so reads a day early).
  const gmt = new Date(v.get('gmt')!.t);
  const day = gmt.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' }).toUpperCase();
  const rows = [`GMT ${day} ${gmt.toISOString().slice(11, 19)}Z · MODE ${label(v, 'stationMode')}`];
  if (orbit) {
    const delta = orbit.deltaKm !== undefined ? ` · Δ TLE ${orbit.deltaKm.toFixed(1)} KM` : '';
    rows.push(`ALT ${orbit.altKm.toFixed(1)} KM · ${orbit.speed.toFixed(2)} KM/S${delta}`);
  }
  const maneuver = v.get('maneuver')?.value === '1' ? ' · MANEUVERING' : '';
  rows.push(`ATTITUDE ${label(v, 'attitudeFrame')} · CMG MOMENTUM ${fixed(num(v, 'cmg'), 0)} %${maneuver}`);
  const cabin = num(v, 'cabinPressure');
  const o2 = num(v, 'ppO2');
  rows.push(
    `CABIN ${fixed(cabin === undefined ? undefined : cabin / MMHG_PER_PSI, 2)} PSI · ${fixed(num(v, 'cabinTemp'), 1)} °C · ` +
      `O2 ${fixed(o2 === undefined ? undefined : o2 / MMHG_PER_PSI, 2)} PSI · CO2 ${fixed(num(v, 'ppCO2'), 1)} MMHG`,
  );
  rows.push(`SUN β ${fixed(num(v, 'beta'), 1)}° · SOLAR ARRAYS ${fixed(num(v, 'sarjStarboard'), 0)}° / ${fixed(num(v, 'sarjPort'), 0)}°`);
  const mass = num(v, 'mass');
  rows.push(
    `MASS ${mass === undefined ? '—' : Math.round(mass).toLocaleString('en-US')} KG · ${fixed(num(v, 'laptops'), 0)} LAPTOPS · KU VIDEO ${label(v, 'kuVideo')}`,
  );
  return { aos: sig.aos, status: sig.aos ? 'AOS' : `LOS · ${age(sig.ageMs)}`, rows };
}

// ---- stream ----------------------------------------------------------------------------

/**
 * The Lightstreamer connection, loaded only when telemetry is wanted (the
 * client library is ~50 KB gzipped). One MERGE subscription, snapshot first,
 * at most one update a second per item.
 */
export class IssLive {
  readonly values: IssValues = new Map();
  status = 'DISCONNECTED';
  private client: { disconnect(): void; unsubscribe(s: unknown): void } | undefined;
  private starting = false;

  constructor(private readonly onChange: () => void) {}

  async start() {
    if (this.client || this.starting) return;
    this.starting = true;
    try {
      const { LightstreamerClient, Subscription } = await import('lightstreamer-client-web');
      const byItem = new Map<string, IssKey>(Object.entries(ISS_ITEMS).map(([k, id]) => [id, k as IssKey]));
      const client = new LightstreamerClient(ISSLIVE_SERVER, ISSLIVE_ADAPTER);
      const sub = new Subscription('MERGE', Object.values(ISS_ITEMS), [...ISS_FIELDS]);
      sub.setRequestedSnapshot('yes');
      sub.setRequestedMaxFrequency(1);
      sub.addListener({
        onItemUpdate: (u) => {
          const key = byItem.get(u.getItemName());
          const hours = Number(u.getValue('TimeStamp'));
          if (!key || !Number.isFinite(hours)) return;
          this.values.set(key, {
            value: u.getValue('Value') ?? '',
            calibrated: u.getValue('CalibratedData') ?? '',
            t: issTime(hours, Date.now()),
          });
          this.onChange();
        },
      });
      client.addListener({
        onStatusChange: (s) => {
          this.status = s;
          this.onChange();
        },
      });
      client.subscribe(sub);
      client.connect();
      this.client = client;
    } finally {
      this.starting = false;
    }
  }

  stop() {
    this.client?.disconnect();
    this.client = undefined;
    this.status = 'DISCONNECTED';
  }

  get connected() {
    return this.status.startsWith('CONNECTED');
  }
}
