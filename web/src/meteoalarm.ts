// Europe's weather warnings: MeteoAlarm (EUMETNET) gathers the warnings of 38 national weather
// services. Its feeds send no CORS headers, so the pipeline (xearth_clouds/meteoalarm.py) keeps
// the warnings in force or starting within two days, in English, each with the outlines of the
// regions it covers. Drawn with the US severe weather (Shift+W), in MeteoAlarm's yellow, orange
// and red. Decoding and styling only; drawing is in overlay.ts.

import type { LocalAlert } from './locale';
import { inPolygon, utc, type PickDetail } from './picks';
import type { Polygon } from './severe';
import type { ToastTone } from './toasts';
import { clip } from './tsunami';

export interface AlarmWarning {
  id: string;
  /** ISO 3166 code of the service that issued it. */
  country: string;
  /** MeteoAlarm's awareness level: 2 yellow, 3 orange, 4 red. */
  level: number;
  /** MeteoAlarm's awareness type (TYPE_NAME); 0 if the service gave none. */
  type: number;
  event: string | null;
  headline: string | null;
  description: string | null;
  instruction: string | null;
  sender: string | null;
  web: string | null;
  sent: string | null;
  onset: string | null;
  expires: string;
  /** The areas as the warning names them, "; "-separated. */
  areas: string | null;
  /** Keys into the manifest's regions. */
  regions: string[];
}

export interface AlarmRegion {
  name: string;
  country: string;
  polygons: Polygon[];
}

export interface AlarmManifest {
  generated: string;
  source: string;
  countries: string[];
  failed: string[];
  lookaheadHours: number;
  /** Worst first, then soonest. */
  warnings: AlarmWarning[];
  regions: Record<string, AlarmRegion>;
  unplaced: string[];
}

export function isAlarmManifest(v: unknown): v is AlarmManifest {
  const m = v as Partial<AlarmManifest> | null;
  return !!m && typeof m.generated === 'string' && Array.isArray(m.warnings) && !!m.regions && typeof m.regions === 'object';
}

/** The pipeline runs hourly; a quarter-hourly look catches each run soon after. */
export const ALARM_CHECK_MS = 15 * 60_000;

/** MeteoAlarm's style guide's colours for its levels. */
export const LEVEL_COLOR: Record<number, string> = { 2: '#ffda22', 3: '#ff9300', 4: '#ff0000' };
export const LEVEL_NAME: Record<number, string> = { 2: 'Yellow', 3: 'Orange', 4: 'Red' };
const LEVEL_TONE: Record<number, ToastTone> = { 2: 'info', 3: 'warn', 4: 'bad' };

/** MeteoAlarm's awareness types (its CAP profile, v2.0; there's no 11). */
export const TYPE_NAME: Record<number, string> = {
  1: 'Wind',
  2: 'Snow or ice',
  3: 'Thunderstorm',
  4: 'Fog',
  5: 'High temperature',
  6: 'Low temperature',
  7: 'Coastal event',
  8: 'Forest fire',
  9: 'Avalanche',
  10: 'Rain',
  12: 'Flood',
  13: 'Rain flood',
  14: 'Marine hazard',
  15: 'Drought',
};

export const COUNTRY_NAME: Record<string, string> = {
  AT: 'Austria', BA: 'Bosnia and Herzegovina', BE: 'Belgium', BG: 'Bulgaria', CH: 'Switzerland', CY: 'Cyprus',
  CZ: 'Czechia', DE: 'Germany', DK: 'Denmark', EE: 'Estonia', ES: 'Spain', FI: 'Finland', FR: 'France',
  GB: 'United Kingdom', GR: 'Greece', HR: 'Croatia', HU: 'Hungary', IE: 'Ireland', IL: 'Israel', IS: 'Iceland',
  IT: 'Italy', LT: 'Lithuania', LU: 'Luxembourg', LV: 'Latvia', MD: 'Moldova', ME: 'Montenegro',
  MK: 'North Macedonia', MT: 'Malta', NL: 'Netherlands', NO: 'Norway', PL: 'Poland', PT: 'Portugal',
  RO: 'Romania', RS: 'Serbia', SE: 'Sweden', SI: 'Slovenia', SK: 'Slovakia', UA: 'Ukraine',
};

const typeName = (w: AlarmWarning) => TYPE_NAME[w.type] ?? 'Weather';
const countryName = (code: string) => COUNTRY_NAME[code] ?? code;

/** Begun (a warning with no onset is in force from when it was sent). */
export const started = (w: AlarmWarning, now: number) => !(Date.parse(w.onset ?? '') > now);
const live = (w: AlarmWarning, now: number) => Date.parse(w.expires) > now;

/** A region's worst level in force now, and its worst still to begin (0: none). */
export interface RegionState {
  now: number;
  soon: number;
}

export function regionStates(m: AlarmManifest, now: number): Map<string, RegionState> {
  const out = new Map<string, RegionState>();
  for (const w of m.warnings) {
    if (!live(w, now)) continue;
    const field = started(w, now) ? 'now' : 'soon';
    for (const key of w.regions) {
      if (!m.regions[key]) continue;
      const s = out.get(key) ?? { now: 0, soon: 0 };
      s[field] = Math.max(s[field], w.level);
      out.set(key, s);
    }
  }
  return out;
}

export interface AlarmGroup {
  level: number;
  /** Filled for warnings in force; outlined (dashed) where something worse is still to come. */
  upcoming: boolean;
  keys: string[];
}

/** Regions by how they're drawn: fills lowest level first, then the outlines, so the worst is on top. */
export function alarmGroups(states: Map<string, RegionState>): AlarmGroup[] {
  const groups = new Map<string, AlarmGroup>();
  const add = (level: number, upcoming: boolean, key: string) => {
    const id = `${upcoming}${level}`;
    if (!groups.has(id)) groups.set(id, { level, upcoming, keys: [] });
    groups.get(id)!.keys.push(key);
  };
  for (const [key, s] of states) {
    if (s.now) add(s.now, false, key);
    if (s.soon > s.now) add(s.soon, true, key);
  }
  return [...groups.values()].sort((a, b) => Number(a.upcoming) - Number(b.upcoming) || a.level - b.level);
}

/** A region's warnings still running: in force first, then worst first, then soonest. */
export function regionWarnings(m: AlarmManifest, key: string, now: number): AlarmWarning[] {
  return m.warnings
    .filter((w) => live(w, now) && w.regions.includes(key))
    .sort((a, b) => Number(started(b, now)) - Number(started(a, now)) || b.level - a.level || Date.parse(a.onset ?? '') - Date.parse(b.onset ?? ''));
}

/** "24 OCT 12:00Z". */
function zTime(iso: string): string {
  const d = new Date(iso);
  return `${d.getUTCDate()} ${d.toLocaleDateString('en-GB', { month: 'short', timeZone: 'UTC' }).toUpperCase()} ${d.toISOString().slice(11, 16)}Z`;
}

const when = (w: AlarmWarning, now: number) => (started(w, now) ? `until ${utc(w.expires)}` : `from ${utc(w.onset!)}`);

/** "Sat 12:00Z": short enough for a tile, and unambiguous within the two days warnings run to. */
function dayTime(iso: string): string {
  const d = new Date(iso);
  return `${d.toLocaleDateString('en-GB', { weekday: 'short', timeZone: 'UTC' })} ${d.toISOString().slice(11, 16)}Z`;
}

const tileWhen = (w: AlarmWarning, now: number) => (started(w, now) ? `until ${dayTime(w.expires)}` : `from ${dayTime(w.onset!)}`);

export function alarmInfo(m: AlarmManifest, key: string, now: number, centre: [number, number] | undefined): PickDetail | undefined {
  const region = m.regions[key];
  const warnings = regionWarnings(m, key, now);
  if (!region || !warnings.length) return undefined;
  const top = warnings[0];
  const shown = warnings.slice(0, 4);
  const tiles = shown.map((w) => ({ label: `${LEVEL_NAME[w.level]} · ${typeName(w)}`, value: tileWhen(w, now) }));
  tiles.push({ label: 'Country', value: countryName(region.country) });
  if (top.sender) tiles.push({ label: 'Issued by', value: top.sender });
  const notes = [top.headline ?? top.event, top.description, top.instruction].filter((s): s is string => !!s).map((s) => clip(s, 300));
  if (warnings.length > shown.length) notes.push(`${warnings.length - shown.length} more warning${warnings.length - shown.length === 1 ? '' : 's'} here`);
  return {
    title: region.name,
    kind: 'METEOALARM',
    color: LEVEL_COLOR[top.level],
    lat: centre?.[1],
    lon: centre?.[0],
    status: { text: `${LEVEL_NAME[top.level].toUpperCase()} · ${started(top, now) ? 'IN FORCE' : 'TO COME'}`, tone: LEVEL_TONE[top.level] },
    tiles,
    notes,
    link: top.web ? { href: top.web, text: top.sender ?? 'Warning' } : { href: 'https://meteoalarm.org/', text: 'MeteoAlarm' },
  };
}

/** The region a warning's label goes on: its largest (by vertices, as the US warnings' labels). */
export function labelRegion(m: AlarmManifest, w: AlarmWarning): string | undefined {
  let best: string | undefined;
  let most = -1;
  for (const key of w.regions) {
    const n = m.regions[key]?.polygons.reduce((s, p) => s + (p[0]?.length ?? 0), 0) ?? -1;
    if (n > most) [best, most] = [key, n];
  }
  return best;
}

/** Red warnings get a label; the rest are only coloured in. */
export function labelledAlarms(m: AlarmManifest, now: number): AlarmWarning[] {
  return m.warnings.filter((w) => w.level >= 4 && live(w, now));
}

/** "RED WIND WARNING", "KREIS HARZ - BERGLAND (OBERHARZ) +3", "UNTIL 24 OCT 12:00Z". */
export function alarmRows(m: AlarmManifest, w: AlarmWarning, key: string, now: number): string[] {
  const name = m.regions[key]?.name ?? countryName(w.country);
  const more = w.regions.length > 1 ? ` +${w.regions.length - 1}` : '';
  const until = started(w, now) ? `UNTIL ${zTime(w.expires)}` : `FROM ${zTime(w.onset!)}`;
  return [`${LEVEL_NAME[w.level].toUpperCase()} ${typeName(w).toUpperCase()} WARNING`, clip(name.toUpperCase(), 40) + more, `${countryName(w.country).toUpperCase()} · ${until}`];
}

/** Red warnings not yet announced, in force or to come. Marks them announced. */
export function freshRed(m: AlarmManifest, announced: Set<string>, now: number): AlarmWarning[] {
  const fresh = labelledAlarms(m, now).filter((w) => !announced.has(w.id));
  for (const w of fresh) announced.add(w.id);
  return fresh;
}

/** "Red wind warning — Kreis Harz - Bergland (Oberharz), Germany". */
export function redToast(m: AlarmManifest, w: AlarmWarning): string {
  const key = labelRegion(m, w);
  const name = (key && m.regions[key]?.name) || w.areas || '';
  const more = w.regions.length > 1 ? ` +${w.regions.length - 1}` : '';
  return `Red ${typeName(w).toLowerCase()} warning — ${clip(name, 48)}${more}, ${countryName(w.country)}`;
}

/** The readout's row: "1 red · 30 orange · 420 yellow regions · 60 to come". */
export function alarmSummary(m: AlarmManifest, now: number): string {
  const counts = new Map<number, number>();
  let soon = 0;
  for (const s of regionStates(m, now).values()) {
    if (s.now) counts.set(s.now, (counts.get(s.now) ?? 0) + 1);
    else if (s.soon) soon++;
  }
  const parts = [4, 3, 2].filter((l) => counts.get(l)).map((l) => `${counts.get(l)} ${LEVEL_NAME[l].toLowerCase()}`);
  const total = [...counts.values()].reduce((a, b) => a + b, 0);
  const warned = parts.length ? `${parts.join(' · ')} region${total === 1 ? '' : 's'}` : 'no warnings in force';
  return soon ? `${warned} · ${soon} more to come` : warned;
}

/** Roughly MeteoAlarm's members, the Azores and Canaries to Ukraine and Israel: where a place card asks. */
export function inMeteoAlarmArea(lat: number, lon: number): boolean {
  return lat >= 27 && lat <= 72 && lon >= -32 && lon <= 45;
}

/** A place's warnings for its card: one per level, type and start, worst first. */
export function placeAlarms(m: AlarmManifest, lat: number, lon: number, now: number): LocalAlert[] {
  const here = new Set(Object.entries(m.regions).filter(([, r]) => r.polygons.some((p) => inPolygon(lon, lat, p))).map(([k]) => k));
  if (!here.size) return [];
  const seen = new Set<string>();
  const out: LocalAlert[] = [];
  for (const w of m.warnings) {
    const id = `${w.level} ${w.type} ${w.onset}`;
    if (!live(w, now) || seen.has(id) || !w.regions.some((k) => here.has(k))) continue;
    seen.add(id);
    out.push({
      level: w.level >= 3 ? 'warning' : 'advisory',
      title: `${LEVEL_NAME[w.level]} ${typeName(w).toLowerCase()} warning`,
      detail: [when(w, now), w.sender].filter(Boolean).join(' · '),
    });
  }
  return out;
}
