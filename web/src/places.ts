// Going to a place: coordinates typed in any usual form, the app's own city
// list (instant, offline), and anywhere else via Open-Meteo's geocoder
// (GeoNames data, CC BY 4.0; CORS-enabled, no key). Plus the great-circle
// glide the view takes to get there.

import { CITIES } from './cities';
import { dot, fromLatLon, normalize, toLatLon, type Vec3 } from './vec';

export interface Place {
  name: string;
  /** Region and country, or what kind of result it is. */
  detail: string;
  lat: number;
  lon: number;
}

export const GEOCODER_URL = 'https://geocoding-api.open-meteo.com/v1/search';

// ---- coordinates ---------------------------------------------------------------------------

const HALF = /^([+-]?\d+(?:\.\d+)?)\s*°?\s*(?:(\d+(?:\.\d+)?)\s*['′]\s*)?(?:(\d+(?:\.\d+)?)\s*(?:["″]|'')\s*)?([NSEW])?$/i;

function parseHalf(s: string): { value: number; hemi?: string } | null {
  const m = s.trim().match(HALF);
  if (!m) return null;
  const [, d, min, sec, hemi] = m;
  const sign = d.startsWith('-') ? -1 : 1;
  const value = sign * (Math.abs(Number(d)) + Number(min ?? 0) / 60 + Number(sec ?? 0) / 3600);
  if (Number(min ?? 0) >= 60 || Number(sec ?? 0) >= 60) return null;
  return { value, hemi: hemi?.toUpperCase() };
}

/**
 * "40.71, -74.01" · "40.71 -74.01" · "40.71N 74.01W" · "40°42′51″N 74°0′21″W" ·
 * "74W 40N" (hemisphere letters fix the order) → { lat, lon }, or null.
 */
export function parseCoordinates(text: string): { lat: number; lon: number } | null {
  const t = text.trim().replace(/\s+/g, ' ');
  if (!/\d/.test(t)) return null;
  let parts: string[];
  if (/[,;]/.test(t)) parts = t.split(/\s*[,;]\s*/);
  else {
    // Split after the first hemisphere letter if there is one, else on the space.
    const m = t.match(/^(.*?[NSEW])\s*(.+)$/i);
    parts = m && /\d/.test(m[1]) ? [m[1], m[2]] : t.split(' ');
  }
  if (parts.length !== 2) return null;
  let a = parseHalf(parts[0]);
  let b = parseHalf(parts[1]);
  if (!a || !b) return null;
  if ((a.hemi === 'E' || a.hemi === 'W') && (b.hemi === 'N' || b.hemi === 'S' || !b.hemi)) [a, b] = [b, a];
  if ((a.hemi && !'NS'.includes(a.hemi)) || (b.hemi && !'EW'.includes(b.hemi))) return null;
  const lat = a.hemi === 'S' ? -Math.abs(a.value) : a.value;
  const lon = b.hemi === 'W' ? -Math.abs(b.value) : b.value;
  if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  return { lat, lon };
}

export function formatCoordinates(lat: number, lon: number): string {
  return `${Math.abs(lat).toFixed(2)}°${lat >= 0 ? 'N' : 'S'} ${Math.abs(lon).toFixed(2)}°${lon >= 0 ? 'E' : 'W'}`;
}

// ---- names -------------------------------------------------------------------------------

/** Lowercase, accents off: "São Paulo" ≈ "sao paulo". */
export function fold(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
}

/** The app's own cities that start with (then contain) the text. */
export function searchCities(text: string, max = 5): Place[] {
  const q = fold(text);
  if (q.length < 2) return [];
  const hits = CITIES.filter(([name]) => fold(name).includes(q));
  hits.sort(([a], [b]) => Number(!fold(a).startsWith(q)) - Number(!fold(b).startsWith(q)));
  return hits.slice(0, max).map(([name, lat, lon]) => ({ name, detail: 'City', lat, lon }));
}

interface GeocoderResult {
  name: string;
  latitude: number;
  longitude: number;
  admin1?: string;
  country?: string;
  feature_code?: string;
}

const FEATURE: Record<string, string> = { MT: 'Mountain', VLC: 'Volcano', ISL: 'Island', LK: 'Lake', PK: 'Peak', BAY: 'Bay', CAPE: 'Cape' };

export function decodeGeocoder(json: unknown): Place[] {
  const results = (json as { results?: GeocoderResult[] } | null)?.results;
  if (!Array.isArray(results)) return [];
  return results
    .filter((r) => Number.isFinite(r.latitude) && Number.isFinite(r.longitude))
    .map((r) => {
      const where = [r.admin1, r.country].filter(Boolean).join(', ');
      const kind = r.feature_code ? FEATURE[r.feature_code] : undefined;
      return { name: r.name, detail: [kind, where].filter(Boolean).join(' · '), lat: r.latitude, lon: r.longitude };
    });
}

export async function geocode(text: string, signal?: AbortSignal): Promise<Place[]> {
  const url = `${GEOCODER_URL}?${new URLSearchParams({ name: text.trim(), count: '8', language: 'en', format: 'json' })}`;
  const r = await fetch(url, { signal });
  if (!r.ok) throw new Error(`${r.status} geocoder`);
  return decodeGeocoder(await r.json());
}

/** Local cities first; geocoder results that duplicate one (same name within ~30 km) are dropped. */
export function mergePlaces(local: Place[], remote: Place[]): Place[] {
  const near = (a: Place, b: Place) => fold(a.name) === fold(b.name) && Math.abs(a.lat - b.lat) < 0.3 && Math.abs(a.lon - b.lon) < 0.3;
  return [...local, ...remote.filter((r) => !local.some((l) => near(l, r)))];
}

// ---- the glide -----------------------------------------------------------------------------

/** How long to glide between two points: quick for a hop, ~1.5 s for the far side of the world. */
export function glideMs(from: Vec3, to: Vec3): number {
  const angle = Math.acos(Math.max(-1, Math.min(1, dot(from, to))));
  return 450 + 1050 * (angle / Math.PI);
}

const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);

/** Viewpoint `t` (0–1, eased) of the way along the great circle from one lat/lon to another. */
export function glideAt(from: { lat: number; lon: number }, to: { lat: number; lon: number }, t: number): { lat: number; lon: number } {
  const a = fromLatLon(from.lat, from.lon);
  const b = fromLatLon(to.lat, to.lon);
  const k = easeInOut(Math.max(0, Math.min(1, t)));
  const omega = Math.acos(Math.max(-1, Math.min(1, dot(a, b))));
  if (omega < 1e-6) return to;
  // Antipodes have no unique great circle: go via a point a quarter-turn round.
  if (Math.PI - omega < 1e-3) {
    const mid = fromLatLon(0, from.lon + 90);
    return k < 0.5 ? glideAt(from, toLatLon(mid), k * 2) : glideAt(toLatLon(mid), to, k * 2 - 1);
  }
  const sa = Math.sin((1 - k) * omega) / Math.sin(omega);
  const sb = Math.sin(k * omega) / Math.sin(omega);
  return toLatLon(normalize([a[0] * sa + b[0] * sb, a[1] * sa + b[1] * sb, a[2] * sa + b[2] * sb]));
}
