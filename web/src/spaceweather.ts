// Space weather from NOAA SWPC: the planetary K index, GOES X-ray class, the
// latest flare, and the solar wind at L1 — four tiny CORS-enabled endpoints —
// plus the GOES SUVI image of the Sun for the Sun disc.

const SWPC = 'https://services.swpc.noaa.gov';
export const SPACE_WEATHER_URLS = {
  kp: `${SWPC}/products/noaa-planetary-k-index.json`,
  flares: `${SWPC}/json/goes/primary/xray-flares-latest.json`,
  wind: `${SWPC}/products/summary/solar-wind-speed.json`,
  field: `${SWPC}/products/summary/solar-wind-mag-field.json`,
} as const;

/** GOES-19 SUVI 304 Å composite (1280 px, solar north up, refreshed every few minutes). */
export const SUVI_URL = `${SWPC}/images/animations/suvi/primary/304/latest.png`;
/** Solar limb radius as a fraction of the SUVI image width (measured: 391–392 px of 1280). */
export const SUVI_LIMB = 0.306;

export interface SpaceWeather {
  kp?: number;
  kpTime?: string;
  /** Current GOES 0.1–0.8 nm flux class, e.g. "B9.5". */
  xray?: string;
  /** Peak class and time of the latest flare. */
  flare?: { max: string; at: string };
  windKms?: number;
  btNt?: number;
  bzNt?: number;
}

type Json = unknown;

export function parseKp(rows: Json): { kp: number; time: string } | undefined {
  if (!Array.isArray(rows) || !rows.length) return undefined;
  const last = rows[rows.length - 1] as { Kp?: number; time_tag?: string };
  return typeof last?.Kp === 'number' ? { kp: last.Kp, time: last.time_tag ?? '' } : undefined;
}

export function parseFlares(rows: Json): Pick<SpaceWeather, 'xray' | 'flare'> {
  const f = (Array.isArray(rows) ? rows[0] : undefined) as
    | { current_class?: string; max_class?: string; max_time?: string }
    | undefined;
  return {
    xray: f?.current_class,
    flare: f?.max_class && f.max_time ? { max: f.max_class, at: f.max_time } : undefined,
  };
}

export function parseWind(rows: Json): number | undefined {
  const r = (Array.isArray(rows) ? rows[0] : undefined) as { proton_speed?: number } | undefined;
  return typeof r?.proton_speed === 'number' ? r.proton_speed : undefined;
}

export function parseField(rows: Json): { bt?: number; bz?: number } {
  const r = (Array.isArray(rows) ? rows[0] : undefined) as { bt?: number; bz_gsm?: number } | undefined;
  return { bt: r?.bt, bz: r?.bz_gsm };
}

/** Fetch all four; any one failing just leaves its fields out. */
export async function fetchSpaceWeather(fetchJson: (url: string) => Promise<Json>): Promise<SpaceWeather> {
  const [kp, flares, wind, field] = await Promise.allSettled(
    [SPACE_WEATHER_URLS.kp, SPACE_WEATHER_URLS.flares, SPACE_WEATHER_URLS.wind, SPACE_WEATHER_URLS.field].map(fetchJson),
  );
  const value = <T>(r: PromiseSettledResult<Json>, parse: (j: Json) => T): T | undefined =>
    r.status === 'fulfilled' ? parse(r.value) : undefined;
  const k = value(kp, parseKp);
  const fl = value(flares, parseFlares);
  const fi = value(field, parseField);
  return {
    kp: k?.kp,
    kpTime: k?.time,
    xray: fl?.xray,
    flare: fl?.flare,
    windKms: value(wind, parseWind),
    btNt: fi?.bt,
    bzNt: fi?.bz,
  };
}

/** NOAA geomagnetic storm scale from Kp: 5 → G1 … 9 → G5. */
export function stormLevel(kp: number): string | undefined {
  return kp >= 5 ? `G${Math.min(5, Math.floor(kp) - 4)}` : undefined;
}

const minus = (n: number) => (n < 0 ? `−${Math.abs(n)}` : `${n}`);

/** The readout's space-weather row: geomagnetic, then solar, then solar wind. */
export function spaceWeatherSummary(sw: SpaceWeather): string | undefined {
  const parts: string[] = [];
  if (sw.kp !== undefined) {
    const g = stormLevel(sw.kp);
    parts.push(`Kp ${sw.kp.toFixed(1)}${g ? ` (${g} storm)` : ''}`);
  }
  if (sw.xray) parts.push(`X-ray ${sw.xray}`);
  if (sw.flare) parts.push(`last flare ${sw.flare.max}`);
  if (sw.windKms !== undefined) parts.push(`wind ${sw.windKms} km/s`);
  if (sw.bzNt !== undefined) parts.push(`Bz ${minus(sw.bzNt)} nT`);
  return parts.length ? parts.join(' · ') : undefined;
}
