// European and Mediterranean earthquakes from EMSC (the Euro-Mediterranean Seismological
// Centre), with USGS's. USGS's day feed has few small quakes outside the US: on 2026-10-23 it
// had 4 M2.5+ in Europe and the Mediterranean in 24 hours, where EMSC had 73 — all 4 of USGS's
// among them, within 3 s and 11 km. So EMSC's M2.5+ quakes in its own region are added, the
// same threshold as USGS's feed, and any USGS has too is shown once (USGS's, with its tsunami
// flag and PAGER alert).
//
// EMSC's FDSN service (CORS) gives the last day on load; its push feed — a WebSocket that sends
// each quake as it's published or revised — keeps it current, so a quake shows within moments
// of EMSC putting it out rather than at the next 5-minute poll.

import type { Quake } from './hazards';

export const EMSC_FDSN = 'https://www.seismicportal.eu/fdsnws/event/1/query';
export const EMSC_PUSH = 'wss://www.seismicportal.eu/standing_order/websocket';
/** EMSC's own region, roughly: Europe, the Mediterranean, the Middle East's west, North Africa. */
export const EURO_MED = { lat0: 25, lat1: 72, lon0: -30, lon1: 50 };
export const EMSC_MIN_MAG = 2.5;
const DAY_MS = 86_400_000;

/** One EMSC event (FDSN GeoJSON, and the push feed's `data`). */
export interface EmscFeature {
  id?: string;
  properties: {
    unid: string;
    time: string;
    lat: number;
    lon: number;
    depth: number;
    mag: number | null;
    magtype?: string;
    flynn_region?: string;
    evtype?: string;
    auth?: string;
  };
}

export function isEmscFeed(v: unknown): v is { features: EmscFeature[] } {
  const f = (v as { features?: unknown })?.features;
  return Array.isArray(f) && f.every((x) => x && typeof x.properties?.unid === 'string');
}

export function emscQueryUrl(now: number): string {
  const q = new URLSearchParams({
    format: 'json',
    starttime: new Date(now - DAY_MS).toISOString().slice(0, 19),
    minmag: String(EMSC_MIN_MAG),
    minlat: String(EURO_MED.lat0),
    maxlat: String(EURO_MED.lat1),
    minlon: String(EURO_MED.lon0),
    maxlon: String(EURO_MED.lon1),
    limit: '1000',
  });
  return `${EMSC_FDSN}?${q}`;
}

/** "WESTERN TURKEY" → "Western Turkey" (EMSC's Flinn–Engdahl regions are upper case); "of", "the" and "and" stay small. */
export function regionName(s: string): string {
  const words = s.toLowerCase().replace(/(^|[\s\-(/])(\p{L})/gu, (_, a: string, b: string) => a + b.toUpperCase());
  return words.replace(/(?<!^)\b(Of|The|And)\b/g, (w) => w.toLowerCase());
}

/** EMSC's event types: known and suspected earthquakes (not blasts, not unconfirmed). */
const QUAKE_TYPES = new Set(['ke', 'se']);

/** An EMSC event as a Quake, if it's an earthquake of M2.5+ in the region within the day. */
export function emscQuake(f: EmscFeature, now: number): Quake | null {
  const p = f.properties;
  const time = Date.parse(p.time.endsWith('Z') ? p.time : `${p.time}Z`);
  if (p.mag == null || p.mag < EMSC_MIN_MAG || !Number.isFinite(time) || now - time > DAY_MS) return null;
  if (p.evtype && !QUAKE_TYPES.has(p.evtype)) return null;
  if (p.lat < EURO_MED.lat0 || p.lat > EURO_MED.lat1 || p.lon < EURO_MED.lon0 || p.lon > EURO_MED.lon1) return null;
  return {
    id: p.unid,
    mag: p.mag,
    place: p.flynn_region ? regionName(p.flynn_region) : '',
    time,
    lat: p.lat,
    lon: p.lon,
    depthKm: p.depth,
    tsunami: false,
    alert: null,
    source: 'EMSC',
  };
}

const km = (a: Quake, b: Quake) => {
  const r = Math.PI / 180;
  const c = Math.sin(a.lat * r) * Math.sin(b.lat * r) + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.cos((a.lon - b.lon) * r);
  return 6371 * Math.acos(Math.min(1, Math.max(-1, c)));
};

/** Within a minute and 100 km: the same quake, located twice. */
export const SAME_QUAKE = { ms: 60_000, km: 100 };

/** USGS's quakes and EMSC's, each quake once (USGS's where both have it), largest first. */
export function mergeQuakes(usgs: readonly Quake[], emsc: readonly Quake[]): Quake[] {
  const extra = emsc.filter((e) => !usgs.some((u) => Math.abs(u.time - e.time) <= SAME_QUAKE.ms && km(u, e) <= SAME_QUAKE.km));
  return [...usgs, ...extra].sort((a, b) => b.mag - a.mag);
}

/** The day's EMSC quakes, kept by id, so the push feed's updates replace what the query gave. */
export class EmscQuakes {
  private readonly byId = new Map<string, Quake>();

  /** Replace with a fresh day (the query). */
  setDay(features: readonly EmscFeature[], now: number): void {
    this.byId.clear();
    for (const f of features) this.upsert(f, now);
  }

  /** A pushed event: added, revised (it may drop below M2.5 or out of the region), or dropped. */
  upsert(f: EmscFeature, now: number): boolean {
    const q = emscQuake(f, now);
    const had = this.byId.has(f.properties.unid);
    if (q) this.byId.set(q.id, q);
    else this.byId.delete(f.properties.unid);
    return !!q || had;
  }

  /** Those still within the day. */
  list(now: number): Quake[] {
    for (const [id, q] of this.byId) if (now - q.time > DAY_MS) this.byId.delete(id);
    return [...this.byId.values()];
  }
}

/** Reconnect after a drop: 5 s, doubling, at most a minute. */
export const backoffMs = (attempt: number) => Math.min(60_000, 5_000 * 2 ** attempt);

/**
 * EMSC's push feed while it's wanted: each message `{ action: 'create' | 'update', data: feature }`
 * goes to `onEvent`. Drops reconnect with backoff; `close()` stops for good.
 */
export class EmscPush {
  private ws: WebSocket | undefined;
  private attempt = 0;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private stopped = false;
  /** When the last message arrived, ms (for the feeds window). */
  lastAt: number | undefined;

  constructor(private readonly onEvent: (f: EmscFeature, action: string) => void) {
    this.open();
  }

  private open() {
    if (this.stopped) return;
    const ws = new WebSocket(EMSC_PUSH);
    this.ws = ws;
    ws.onopen = () => {
      this.attempt = 0;
    };
    ws.onmessage = (e) => {
      try {
        const m = JSON.parse(String(e.data)) as { action?: string; data?: EmscFeature };
        if (m.data?.properties?.unid) {
          this.lastAt = Date.now();
          this.onEvent(m.data, m.action ?? 'update');
        }
      } catch {
        // not a quake message: ignore
      }
    };
    ws.onclose = () => {
      if (this.stopped) return;
      this.timer = setTimeout(() => this.open(), backoffMs(this.attempt++));
    };
  }

  close() {
    this.stopped = true;
    clearTimeout(this.timer);
    this.ws?.close();
  }
}
