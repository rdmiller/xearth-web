// What it's like at a place right now, for the card shown after a search: the weather and
// the day's sunrise and sunset (Open-Meteo, CC BY 4.0; CORS-enabled, no key), air quality
// (Open-Meteo's CAMS air-quality API), NWS alerts for the point (US only), and whatever the
// app's own hazard layers have nearby — storms, quakes, GDACS events, lightning, fires and
// tsunami bulletins.

import { eventTitle, impactLevel, stormTitle, type EventManifest, type FireManifest, type LightningManifest, type Quake, type StormManifest } from './hazards';
import type { TsunamiManifest } from './tsunami';
import { DEG } from './vec';

export const FORECAST_URL = 'https://api.open-meteo.com/v1/forecast';
export const AIR_QUALITY_URL = 'https://air-quality-api.open-meteo.com/v1/air-quality';
export const NWS_POINT_ALERTS_URL = 'https://api.weather.gov/alerts/active';

export function forecastUrl(lat: number, lon: number): string {
  const q = new URLSearchParams({
    latitude: lat.toFixed(4),
    longitude: lon.toFixed(4),
    current: 'temperature_2m,apparent_temperature,relative_humidity_2m,weather_code,wind_speed_10m,wind_direction_10m,wind_gusts_10m,is_day',
    daily: 'sunrise,sunset,daylight_duration,temperature_2m_max,temperature_2m_min,uv_index_max',
    timezone: 'auto',
    forecast_days: '1',
  });
  return `${FORECAST_URL}?${q}`;
}

export const airQualityUrl = (lat: number, lon: number) =>
  `${AIR_QUALITY_URL}?${new URLSearchParams({ latitude: lat.toFixed(4), longitude: lon.toFixed(4), current: 'us_aqi' })}`;

export const nwsPointAlertsUrl = (lat: number, lon: number) => `${NWS_POINT_ALERTS_URL}?point=${lat.toFixed(4)},${lon.toFixed(4)}`;

/** NWS covers the US and its territories; elsewhere its point query is a 400, so don't ask. */
export function inNwsArea(lat: number, lon: number): boolean {
  const box = (s: number, n: number, w: number, e: number) => lat >= s && lat <= n && lon >= w && lon <= e;
  return (
    box(24, 50, -125, -66) || // contiguous states
    box(51, 72, -180, -129) || box(51, 56, 172, 180) || // Alaska, Aleutians
    box(18.5, 22.5, -161, -154) || // Hawaii
    box(17.5, 18.6, -68, -64.5) || // Puerto Rico, US Virgin Islands
    box(13, 21, 144, 146.5) || // Guam, Northern Marianas
    box(-14.6, -14, -171, -169) // American Samoa
  );
}

// ---- weather -------------------------------------------------------------------------------

export interface LocalWeather {
  timezone: string;
  /** "GMT+1", "PDT" */
  tzAbbr: string;
  utcOffsetS: number;
  tempC: number;
  feelsC: number;
  humidity: number;
  code: number;
  windKmh: number;
  windDir: number;
  gustKmh: number;
  isDay: boolean;
  hiC: number | null;
  loC: number | null;
  uv: number | null;
  /** Local "07:36"; null when the sun doesn't rise or set today. */
  sunrise: string | null;
  sunset: string | null;
  daylightS: number | null;
}

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const first = (v: unknown): unknown => (Array.isArray(v) ? v[0] : undefined);
const clock = (iso: unknown): string | null => (typeof iso === 'string' && /T\d\d:\d\d/.test(iso) ? iso.slice(11, 16) : null);

export function decodeForecast(json: unknown): LocalWeather | null {
  const j = json as { current?: Record<string, unknown>; daily?: Record<string, unknown>; utc_offset_seconds?: unknown; timezone?: unknown; timezone_abbreviation?: unknown } | null;
  const c = j?.current;
  if (!c || num(c.temperature_2m) === null || num(c.weather_code) === null) return null;
  const d = j.daily ?? {};
  const daylightS = num(first(d.daylight_duration));
  // A day with no sunrise or sunset comes back as midnight to midnight: drop the times.
  const polar = daylightS !== null && (daylightS < 60 || daylightS > 86_340);
  return {
    timezone: typeof j.timezone === 'string' ? j.timezone : 'UTC',
    tzAbbr: typeof j.timezone_abbreviation === 'string' ? j.timezone_abbreviation : '',
    utcOffsetS: num(j.utc_offset_seconds) ?? 0,
    tempC: c.temperature_2m as number,
    feelsC: num(c.apparent_temperature) ?? (c.temperature_2m as number),
    humidity: num(c.relative_humidity_2m) ?? NaN,
    code: c.weather_code as number,
    windKmh: num(c.wind_speed_10m) ?? NaN,
    windDir: num(c.wind_direction_10m) ?? NaN,
    gustKmh: num(c.wind_gusts_10m) ?? NaN,
    isDay: c.is_day === 1,
    hiC: num(first(d.temperature_2m_max)),
    loC: num(first(d.temperature_2m_min)),
    uv: num(first(d.uv_index_max)),
    sunrise: polar ? null : clock(first(d.sunrise)),
    sunset: polar ? null : clock(first(d.sunset)),
    daylightS,
  };
}

/** WMO weather interpretation codes, as Open-Meteo reports them. */
export function weatherWord(code: number, isDay = true): string {
  if (code === 0) return isDay ? 'Clear' : 'Clear night';
  if (code === 1) return 'Mainly clear';
  if (code === 2) return 'Partly cloudy';
  if (code === 3) return 'Overcast';
  if (code === 45 || code === 48) return code === 48 ? 'Freezing fog' : 'Fog';
  if (code >= 51 && code <= 55) return code === 51 ? 'Light drizzle' : code === 55 ? 'Heavy drizzle' : 'Drizzle';
  if (code === 56 || code === 57) return 'Freezing drizzle';
  if (code >= 61 && code <= 65) return code === 61 ? 'Light rain' : code === 65 ? 'Heavy rain' : 'Rain';
  if (code === 66 || code === 67) return 'Freezing rain';
  if (code >= 71 && code <= 75) return code === 71 ? 'Light snow' : code === 75 ? 'Heavy snow' : 'Snow';
  if (code === 77) return 'Snow grains';
  if (code >= 80 && code <= 82) return code === 82 ? 'Violent rain showers' : 'Rain showers';
  if (code === 85 || code === 86) return 'Snow showers';
  if (code === 95) return 'Thunderstorm';
  if (code === 96 || code === 99) return 'Thunderstorm with hail';
  return 'Unknown';
}

/** °F and mph for viewers in the US (and the two other places that use them). */
export function prefersImperial(locale: string): boolean {
  return /-(US|LR|MM)\b/i.test(locale);
}

export const temp = (c: number, imperial: boolean) => (imperial ? `${Math.round((c * 9) / 5 + 32)}°F` : `${Math.round(c)}°C`);
export const speed = (kmh: number, imperial: boolean) => (imperial ? `${Math.round(kmh / 1.609344)} mph` : `${Math.round(kmh)} km/h`);

const COMPASS = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
export const compass = (deg: number) => COMPASS[Math.round((((deg % 360) + 360) % 360) / 22.5) % 16];

/** "Partly cloudy · 13°C, feels 10°C" */
export function conditionsLine(w: LocalWeather, imperial: boolean): string {
  const feels = Math.abs(w.feelsC - w.tempC) >= 2 ? `, feels ${temp(w.feelsC, imperial)}` : '';
  return `${weatherWord(w.code, w.isDay)} · ${temp(w.tempC, imperial)}${feels}`;
}

/** "Wind WSW 16 km/h, gusts 34 · Humidity 61% · High 14° Low 9° · UV 1" */
export function detailLine(w: LocalWeather, imperial: boolean): string {
  const parts: string[] = [];
  if (Number.isFinite(w.windKmh)) {
    const gust = Number.isFinite(w.gustKmh) && w.gustKmh >= w.windKmh + 10 ? `, gusts ${speed(w.gustKmh, imperial).split(' ')[0]}` : '';
    parts.push(w.windKmh < 2 ? 'Calm' : `Wind ${Number.isFinite(w.windDir) ? `${compass(w.windDir)} ` : ''}${speed(w.windKmh, imperial)}${gust}`);
  }
  if (Number.isFinite(w.humidity)) parts.push(`Humidity ${Math.round(w.humidity)}%`);
  if (w.hiC !== null && w.loC !== null) parts.push(`High ${temp(w.hiC, imperial).slice(0, -1)} Low ${temp(w.loC, imperial).slice(0, -1)}`);
  if (w.uv !== null && w.uv >= 1) parts.push(`UV ${Math.round(w.uv)}`);
  return parts.join(' · ');
}

/** "Sunrise 07:36 · Sunset 17:52 · 10 h 16 min of daylight", or the polar cases. */
export function sunLine(w: LocalWeather): string {
  if (w.daylightS !== null && w.daylightS < 60) return 'Polar night: the sun stays below the horizon today';
  if (w.daylightS !== null && w.daylightS > 86_340) return 'Midnight sun: the sun stays above the horizon today';
  const parts: string[] = [];
  if (w.sunrise) parts.push(`Sunrise ${w.sunrise}`);
  if (w.sunset) parts.push(`Sunset ${w.sunset}`);
  if (w.daylightS !== null) parts.push(`${daylightText(w.daylightS)} of daylight`);
  return parts.join(' · ');
}

/** "10 h 16 min" */
export function daylightText(s: number): string {
  const m = Math.round(s / 60);
  return `${Math.floor(m / 60)} h ${m % 60} min`;
}

/** The picture for a WMO weather code, by day or night. */
export type WeatherIcon = 'clear' | 'clear-night' | 'partly' | 'partly-night' | 'cloudy' | 'fog' | 'drizzle' | 'rain' | 'snow' | 'thunder' | 'hail';

export function weatherIcon(code: number, isDay = true): WeatherIcon {
  if (code === 0 || code === 1) return isDay ? 'clear' : 'clear-night';
  if (code === 2) return isDay ? 'partly' : 'partly-night';
  if (code === 3) return 'cloudy';
  if (code === 45 || code === 48) return 'fog';
  if ((code >= 51 && code <= 57) || code === 66) return 'drizzle';
  if ((code >= 61 && code <= 65) || code === 67 || (code >= 80 && code <= 82)) return 'rain';
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return 'snow';
  if (code === 95) return 'thunder';
  if (code === 96 || code === 99) return 'hail';
  return 'cloudy';
}

/** Minutes after midnight of a "07:36" clock, or null. */
export function clockMinutes(hhmm: string | null): number | null {
  const m = hhmm?.match(/^(\d\d):(\d\d)$/);
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

/**
 * How far through today's daylight the place is now: 0 at sunrise, 1 at sunset (below 0
 * before, above 1 after), or null without both times (polar night, midnight sun).
 */
export function dayProgress(w: LocalWeather, now: number): number | null {
  const rise = clockMinutes(w.sunrise);
  const set = clockMinutes(w.sunset);
  if (rise === null || set === null || set <= rise) return null;
  const local = clockMinutes(localClock(now, w.utcOffsetS))!;
  return (local - rise) / (set - rise);
}

/** The WHO's UV index bands. */
export function uvBand(uv: number): 'low' | 'moderate' | 'high' | 'very high' | 'extreme' {
  return uv < 3 ? 'low' : uv < 6 ? 'moderate' : uv < 8 ? 'high' : uv < 11 ? 'very high' : 'extreme';
}

/** The place's wall-clock time now, "14:05", from its UTC offset. */
export function localClock(now: number, utcOffsetS: number): string {
  return new Date(now + utcOffsetS * 1000).toISOString().slice(11, 16);
}

/** "UTC+5:30", "UTC−8", "UTC" */
export function offsetLabel(utcOffsetS: number): string {
  if (!utcOffsetS) return 'UTC';
  const m = Math.round(Math.abs(utcOffsetS) / 60);
  return `UTC${utcOffsetS < 0 ? '−' : '+'}${Math.floor(m / 60)}${m % 60 ? `:${String(m % 60).padStart(2, '0')}` : ''}`;
}

// ---- alerts --------------------------------------------------------------------------------

export type AlertLevel = 'warning' | 'watch' | 'advisory' | 'info';

export interface LocalAlert {
  level: AlertLevel;
  title: string;
  detail: string;
  /** GDACS impact level 1–3, shown as a meter. */
  impact?: number;
}

const LEVEL_ORDER: Record<AlertLevel, number> = { warning: 0, watch: 1, advisory: 2, info: 3 };

export function sortAlerts(alerts: LocalAlert[]): LocalAlert[] {
  return [...alerts].sort((a, b) => LEVEL_ORDER[a.level] - LEVEL_ORDER[b.level]);
}

function nwsLevel(event: string, severity: string): AlertLevel {
  const e = event.toLowerCase();
  if (/warning|emergency/.test(e) || severity === 'Extreme') return 'warning';
  if (/watch/.test(e)) return 'watch';
  if (/advisory/.test(e) || severity === 'Severe') return 'advisory';
  return 'info';
}

function shortTime(iso: string): string {
  // NWS times carry the zone's offset: show its wall clock, "Oct 22 18:00".
  const m = iso.match(/^\d{4}-(\d\d)-(\d\d)T(\d\d:\d\d)/);
  if (!m) return '';
  const month = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][Number(m[1]) - 1];
  return `${month} ${Number(m[2])} ${m[3]}`;
}

/** NWS active alerts for a point → one entry per event (repeats from several offices merged). */
export function decodeNwsPointAlerts(json: unknown): LocalAlert[] {
  const features = (json as { features?: { properties?: Record<string, unknown> }[] } | null)?.features;
  if (!Array.isArray(features)) return [];
  const seen = new Set<string>();
  const out: LocalAlert[] = [];
  for (const f of features) {
    const p = f.properties ?? {};
    const event = typeof p.event === 'string' ? p.event : '';
    if (!event || p.status !== 'Actual' || p.messageType === 'Cancel' || seen.has(event)) continue;
    seen.add(event);
    const until = typeof p.ends === 'string' ? p.ends : typeof p.expires === 'string' ? p.expires : '';
    const sender = typeof p.senderName === 'string' ? p.senderName : 'NWS';
    out.push({ level: nwsLevel(event, String(p.severity ?? '')), title: event, detail: [until && `until ${shortTime(until)}`, sender].filter(Boolean).join(' · ') });
  }
  return out;
}

const AQI_BANDS: [number, string, AlertLevel][] = [
  [300, 'Hazardous', 'warning'],
  [200, 'Very unhealthy', 'warning'],
  [150, 'Unhealthy', 'advisory'],
  [100, 'Unhealthy for sensitive groups', 'advisory'],
];

/** An alert only once the air is worse than "moderate" (US AQI over 100). */
export function aqiAlert(json: unknown): LocalAlert | null {
  const aqi = num((json as { current?: { us_aqi?: unknown } } | null)?.current?.us_aqi);
  if (aqi === null) return null;
  const band = AQI_BANDS.find(([above]) => aqi > above);
  return band ? { level: band[2], title: `Air quality: ${band[1]}`, detail: `US AQI ${Math.round(aqi)}` } : null;
}

// ---- nearby hazards from the app's own layers ------------------------------------------------

const EARTH_KM = 6371;

/** Great-circle distance (km) and initial bearing (degrees) from a to b. */
export function distanceKm(lat1: number, lon1: number, lat2: number, lon2: number): { km: number; bearing: number } {
  const p1 = lat1 * DEG;
  const p2 = lat2 * DEG;
  const dl = (lon2 - lon1) * DEG;
  const h = Math.sin((p2 - p1) / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
  const km = 2 * EARTH_KM * Math.asin(Math.min(1, Math.sqrt(h)));
  const bearing = Math.atan2(Math.sin(dl) * Math.cos(p2), Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dl)) / DEG;
  return { km, bearing: (bearing + 360) % 360 };
}

/** "120 km NE" — the hazard's direction from the place — or "nearby" under 10 km. */
function where(km: number, bearing: number, imperial: boolean): string {
  if (km < 10) return 'nearby';
  return `${imperial ? `${Math.round(km / 1.609344)} mi` : `${Math.round(km)} km`} ${compass(bearing)}`;
}

function ago(ms: number): string {
  const min = Math.max(0, Math.round(ms / 60_000));
  return min < 60 ? `${min} min ago` : `${Math.round(min / 60)} h ago`;
}

export interface NearbySources {
  storms?: StormManifest;
  events?: EventManifest;
  quakes?: Quake[];
  lightning?: LightningManifest;
  fires?: FireManifest;
  tsunami?: TsunamiManifest;
}

/** How close each kind of hazard has to be to count as "here". */
export const NEARBY_KM = { storm: 800, volcano: 150, event: 300, quakeBig: 300, quakeSmall: 50, lightning: 50, fire: 25, tsunami: 1000 };

export function nearbyHazards(lat: number, lon: number, src: NearbySources, now: number, imperial = false): LocalAlert[] {
  const out: LocalAlert[] = [];
  const at = (la: number, lo: number) => distanceKm(lat, lon, la, lo);

  for (const s of src.storms?.storms ?? []) {
    const d = at(s.pos[1], s.pos[0]);
    if (d.km <= NEARBY_KM.storm) {
      const cls = (s.nhc?.classification || s.cls || '').toUpperCase();
      out.push({
        level: cls === 'HU' || cls === 'MH' || d.km < 300 ? 'warning' : 'watch',
        title: titleCase(stormTitle(s)),
        detail: where(d.km, d.bearing, imperial),
        impact: impactLevel(s.alert) || undefined,
      });
    }
  }

  for (const b of src.tsunami?.bulletins ?? []) {
    const d = at(b.lat, b.lon);
    const cat = b.category.toLowerCase();
    if (d.km > NEARBY_KM.tsunami || cat === 'cancellation' || cat === 'information') continue;
    const level: AlertLevel = cat === 'warning' || cat === 'threat' ? 'warning' : cat === 'watch' ? 'watch' : 'advisory';
    out.push({ level, title: `Tsunami ${cat} (${b.center})`, detail: `${b.region} · ${where(d.km, d.bearing, imperial)}` });
  }

  // The nearest strong quake in the last day, else the nearest one close by.
  const day = (src.quakes ?? []).filter((q) => now - q.time < 86_400_000).map((q) => ({ q, d: at(q.lat, q.lon) }));
  const quake =
    day.filter(({ q, d }) => q.mag >= 4.5 && d.km <= NEARBY_KM.quakeBig).sort((a, b) => b.q.mag - a.q.mag)[0] ??
    day.filter(({ d }) => d.km <= NEARBY_KM.quakeSmall).sort((a, b) => b.q.mag - a.q.mag)[0];
  if (quake) {
    const { q, d } = quake;
    out.push({ level: q.mag >= 6 ? 'warning' : q.mag >= 4.5 ? 'advisory' : 'info', title: `M${q.mag.toFixed(1)} earthquake`, detail: `${where(d.km, d.bearing, imperial)} · ${ago(now - q.time)}` });
  }

  for (const e of src.events?.events ?? []) {
    const d = at(e.pos[1], e.pos[0]);
    if (d.km > (e.type === 'VO' ? NEARBY_KM.volcano : NEARBY_KM.event)) continue;
    const alert = e.alert.toLowerCase();
    out.push({
      level: alert === 'red' ? 'warning' : alert === 'orange' ? 'advisory' : 'info',
      title: titleCase(eventTitle(e)),
      detail: where(d.km, d.bearing, imperial),
      impact: impactLevel(e.alert) || undefined,
    });
  }

  const lightning = src.lightning;
  if (lightning) {
    let flashes = 0;
    let nearest = Infinity;
    for (let i = 0; i + 3 < lightning.data.length; i += 4) {
      const d = at(lightning.data[i] * lightning.cellDeg, lightning.data[i + 1] * lightning.cellDeg);
      if (d.km > NEARBY_KM.lightning) continue;
      flashes += lightning.data[i + 2];
      nearest = Math.min(nearest, d.km);
    }
    if (flashes) {
      out.push({
        level: nearest < 15 ? 'advisory' : 'info',
        title: 'Lightning nearby',
        detail: `${flashes} flash${flashes === 1 ? '' : 'es'} within ${imperial ? '30 mi' : `${NEARBY_KM.lightning} km`} in the last ${lightning.windowMin} min`,
      });
    }
  }

  const fires = src.fires;
  if (fires) {
    let detections = 0;
    let nearest = Infinity;
    for (let i = 0; i + 4 < fires.data.length; i += 5) {
      const d = at(fires.data[i] * fires.cellDeg, fires.data[i + 1] * fires.cellDeg);
      if (d.km > NEARBY_KM.fire) continue;
      detections += fires.data[i + 4];
      nearest = Math.min(nearest, d.km);
    }
    if (detections) {
      out.push({
        level: nearest < 5 ? 'advisory' : 'info',
        title: 'Active fires detected',
        detail: `${detections} satellite detection${detections === 1 ? '' : 's'} within ${imperial ? '15 mi' : `${NEARBY_KM.fire} km`}`,
      });
    }
  }

  return out;
}

/** "TROPICAL STORM MELISSA" → "Tropical Storm Melissa" (the layers' labels are HUD caps). */
export function titleCase(s: string): string {
  return s.toLowerCase().replace(/(^|[\s(·/-])(\p{L})/gu, (_, sep: string, ch: string) => sep + ch.toUpperCase());
}
