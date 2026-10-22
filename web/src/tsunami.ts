// Tsunami alerts from NOAA, two ways:
//
//  * Bulletins from the two Tsunami Warning Centers (NTWC, Alaska; PTWC,
//    Hawaii) via the pipeline — tsunami.gov sends no CORS headers. These carry
//    the earthquake's epicentre and the category, worldwide (PTWC issues threat
//    messages for other Pacific, Indian Ocean and Caribbean nations).
//  * Live US tsunami warnings, watches and advisories from the NWS alerts API,
//    read by the browser every two minutes. An alert lists the coastal zones it
//    covers; a sample of them is fetched and lit along the coast.

import { SEV } from './tokens';

export interface TsunamiBulletin {
  id: string;
  /** NTWC or PTWC. */
  center: string;
  /** warning / threat / advisory / watch / cancellation / information */
  category: string;
  /** Epicentre region, e.g. "45 miles SE of Sand Point, Alaska". */
  region: string;
  lat: number;
  lon: number;
  magnitude: number | null;
  magnitudeType: string | null;
  issued: string | null;
  note: string | null;
  bulletin: string | null;
}

export interface TsunamiManifest {
  generated: string;
  centers: string[];
  maxAgeHours: number;
  bulletins: TsunamiBulletin[];
}

export function isTsunamiManifest(v: unknown): v is TsunamiManifest {
  const m = v as Partial<TsunamiManifest> | null;
  return !!m && typeof m.generated === 'string' && Array.isArray(m.bulletins);
}

/** Alerts (warning, threat, advisory, watch) show for the bulletin window; statements for a day. */
const STATEMENT_HOURS = 24;
/** Statements carry a label for this long, then just a marker. */
const STATEMENT_LABEL_HOURS = 6;

export const isAlertCategory = (c: string) => c === 'warning' || c === 'threat' || c === 'advisory' || c === 'watch';

export const TSUNAMI_COLOR: Record<string, string> = {
  warning: SEV.warning,
  threat: SEV.warning,
  advisory: SEV.watch,
  watch: '#ffd166',
  cancellation: '#8a9bb0',
  information: '#8fb8ff',
};

const hoursSince = (iso: string | null, now: number) => (iso ? (now - Date.parse(iso)) / 3_600_000 : Infinity);

export function tsunamiShown(b: TsunamiBulletin, now: number): boolean {
  return isAlertCategory(b.category) || hoursSince(b.issued, now) <= STATEMENT_HOURS;
}

export function tsunamiLabelled(b: TsunamiBulletin, now: number): boolean {
  return isAlertCategory(b.category) || hoursSince(b.issued, now) <= STATEMENT_LABEL_HOURS;
}

/** Collapse whitespace; past `max` characters, cut at a word and add an ellipsis. */
export function clip(text: string, max: number): string {
  const t = text.replace(/\s+/g, ' ').trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max - 1);
  const space = cut.lastIndexOf(' ');
  return `${(space > max / 2 ? cut.slice(0, space) : cut).replace(/[\s,;·.]+$/, '')}…`;
}

function ago(iso: string | null, now: number): string {
  const min = Math.round((now - Date.parse(iso ?? '')) / 60_000);
  if (!Number.isFinite(min)) return '';
  return min < 60 ? `${min} MIN AGO` : `${Math.round(min / 60)} H AGO`;
}

/** Callout rows: "TSUNAMI WARNING · PTWC", "M7.8 · OFF EAST COAST OF HONSHU", "12 MIN AGO · …note". */
export function tsunamiRows(b: TsunamiBulletin, now: number): string[] {
  const mag = b.magnitude != null ? `M${b.magnitude.toFixed(1)} · ` : '';
  const rows = [`TSUNAMI ${(b.category || 'bulletin').toUpperCase()} · ${b.center}`, clip(`${mag}${b.region.toUpperCase()}`, 48)];
  const last = [ago(b.issued, now), b.note ? b.note.toUpperCase().replace(/\.$/, '') : ''].filter(Boolean).join(' · ');
  if (last) rows.push(clip(last, 64));
  return rows;
}

// ---- NWS alerts API ------------------------------------------------------------------

/** Active tsunami alerts for US coasts (GeoJSON, CORS-enabled). Test messages are dropped below. */
export const NWS_TSUNAMI_URL =
  'https://api.weather.gov/alerts/active?event=Tsunami%20Warning,Tsunami%20Watch,Tsunami%20Advisory';

export interface NwsTsunamiAlert {
  id: string;
  /** "Tsunami Warning" / "Tsunami Watch" / "Tsunami Advisory" */
  event: string;
  headline: string;
  areaDesc: string;
  sent: string;
  expires: string | null;
  /** Zone URLs (api.weather.gov/zones/…). */
  zones: string[];
}

interface NwsFeature {
  properties?: {
    id?: string;
    event?: string;
    status?: string;
    messageType?: string;
    headline?: string;
    areaDesc?: string;
    sent?: string;
    expires?: string | null;
    ends?: string | null;
    affectedZones?: string[];
  };
}

/** Real alerts only: NWS sends routine "Test" tsunami warnings through the same feed. */
export function decodeNwsAlerts(json: unknown): NwsTsunamiAlert[] {
  const features = (json as { features?: NwsFeature[] } | null)?.features;
  if (!Array.isArray(features)) return [];
  return features.flatMap((f) => {
    const p = f.properties;
    if (!p?.event?.startsWith('Tsunami') || p.status !== 'Actual' || p.messageType === 'Cancel') return [];
    return [
      {
        id: p.id ?? '',
        event: p.event,
        headline: p.headline ?? p.event,
        areaDesc: p.areaDesc ?? '',
        sent: p.sent ?? '',
        expires: p.ends ?? p.expires ?? null,
        zones: p.affectedZones ?? [],
      },
    ];
  });
}

/** At most `max` zones, spread evenly through the list (zones come grouped along the coast). */
export function sampleZones(zones: string[], max = 24): string[] {
  if (zones.length <= max) return zones;
  return Array.from({ length: max }, (_, i) => zones[Math.floor((i * zones.length) / max)]);
}

type Ring = [number, number][];

/** Vertex mean of a zone's largest outer ring: [lon, lat], or null without geometry. */
export function zoneCentroid(geometry: unknown): [number, number] | null {
  const g = geometry as { type?: string; coordinates?: unknown } | null;
  if (!g?.coordinates) return null;
  const rings: Ring[] =
    g.type === 'Polygon' ? [(g.coordinates as Ring[])[0]] : g.type === 'MultiPolygon' ? (g.coordinates as Ring[][]).map((p) => p[0]) : [];
  const ring = rings.filter(Boolean).sort((a, b) => b.length - a.length)[0];
  if (!ring?.length) return null;
  const [sx, sy] = ring.reduce(([x, y], [lon, lat]) => [x + lon, y + lat], [0, 0]);
  return [sx / ring.length, sy / ring.length];
}

export function nwsColor(event: string): string {
  return TSUNAMI_COLOR[event.replace('Tsunami ', '').toLowerCase()] ?? TSUNAMI_COLOR.information;
}

/** Callout rows for an NWS alert: event, the first named areas, and its end time. */
export function nwsRows(a: NwsTsunamiAlert): string[] {
  const areas = a.areaDesc.split(';').map((s) => s.trim()).filter(Boolean);
  const until = a.expires ? `UNTIL ${new Date(a.expires).toISOString().slice(11, 16)}Z · ` : '';
  const more = areas.length > 1 ? ` (+${areas.length - 1} MORE AREAS)` : '';
  return [`${a.event.toUpperCase()} · NWS`, clip((areas[0] ?? '').toUpperCase(), 44) + more, `${until}${a.zones.length} ZONES`];
}

/** The readout's tsunami row: NWS alerts in effect, then the warning centres' bulletins. */
export function tsunamiSummary(m: TsunamiManifest | undefined, nws: NwsTsunamiAlert[], now: number): string | undefined {
  const parts: string[] = [];
  for (const a of nws) parts.push(`${a.event.toUpperCase()} in effect`);
  const shown = m?.bulletins.filter((b) => tsunamiShown(b, now)) ?? [];
  const alerts = shown.filter((b) => isAlertCategory(b.category));
  if (alerts.length) parts.push(`${alerts.length} alert${alerts.length === 1 ? '' : 's'}`);
  const statements = shown.length - alerts.length;
  if (statements) parts.push(`${statements} statement${statements === 1 ? '' : 's'} in 24 h`);
  if (!parts.length && m) parts.push('no alerts');
  return parts.length ? parts.join(' · ') : undefined;
}
