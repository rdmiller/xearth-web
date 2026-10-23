// US volcano alert levels: USGS's Volcano Hazards Program, through HANS (its notification
// service), with the GDACS events. HANS lists every volcano its observatories monitor (69 on
// 2026-10-23) with its ground-hazard alert level (NORMAL, ADVISORY, WATCH, WARNING) and its
// aviation colour code (GREEN, YELLOW, ORANGE, RED), with CORS — but no positions. Those come
// from the Smithsonian's Volcanoes of the World, joined on the volcano number and baked into
// usVolcanoes.ts (its WFS has no CORS).
//
// A HANS number the Smithsonian doesn't list may be a vent of a listed volcano: VOTW numbers a
// volcano's features by its last digit (Korovin, 311161, is a vent of the Atka Volcanic
// Complex, 311160), so the parent's position stands in. HANS also lists two regions ("Alaskan
// Volcanoes", "Cascade Range") with no number, which aren't places and aren't drawn.

import type { EventOverlay } from './overlay';
import type { PickDetail } from './picks';
import type { ToastTone } from './toasts';
import { US_VOLCANOES, type UsVolcanoRow } from './usVolcanoes';
import { fromLatLon } from './vec';

export const HANS_MONITORED = 'https://volcanoes.usgs.gov/hans-public/api/volcano/getMonitoredVolcanoes';
/** Notices go out daily at most for most volcanoes; a few an hour when one is erupting. */
export const HANS_CHECK_MS = 15 * 60_000;

export interface HansVolcano {
  volcano_name: string;
  vnum: string | null;
  /** "2026-10-22 19:49:57", UTC; null for a volcano with no notice (13 of 69 on 2026-10-23). */
  sent_utc: string | null;
  alert_level: string;
  color_code: string;
  obs_fullname: string;
  obs_abbr: string;
  notice_url: string;
  notice_data: string;
}

export function isHansList(v: unknown): v is HansVolcano[] {
  return Array.isArray(v) && v.every((x) => x && typeof x.volcano_name === 'string' && typeof x.alert_level === 'string' && typeof x.color_code === 'string');
}

/** USGS's aviation colour codes, as it draws them. */
export const AVIATION_COLOR: Record<string, string> = {
  GREEN: '#4caf50',
  YELLOW: '#ffd23f',
  ORANGE: '#ff8c1a',
  RED: '#ff3b30',
};
const UNKNOWN_COLOR = '#9aa5b1';
export const aviationColor = (code: string) => AVIATION_COLOR[code.toUpperCase()] ?? UNKNOWN_COLOR;

/** NORMAL 0, ADVISORY 1, WATCH 2, WARNING 3 (anything else, such as UNASSIGNED, -1). */
export function alertRank(level: string): number {
  return ['NORMAL', 'ADVISORY', 'WATCH', 'WARNING'].indexOf(level.toUpperCase());
}

export interface UsVolcano {
  hans: HansVolcano;
  vnum: number;
  name: string;
  lat: number;
  lon: number;
  elevation: number | null;
  type: string;
  lastEruption: number | null;
  /** Placed at its parent volcano's position (a vent the Smithsonian doesn't list on its own). */
  parent?: string;
}

const byNumber = new Map<number, UsVolcanoRow>(US_VOLCANOES.map((r) => [r[0], r]));

/** HANS's volcanoes with their Smithsonian positions; the names of those that can't be placed. */
export function placeVolcanoes(list: readonly HansVolcano[]): { placed: UsVolcano[]; unplaced: string[] } {
  const placed: UsVolcano[] = [];
  const unplaced: string[] = [];
  for (const h of list) {
    const vnum = h.vnum ? Number(h.vnum) : NaN;
    const exact = byNumber.get(vnum);
    const row = exact ?? byNumber.get(Math.floor(vnum / 10) * 10);
    if (!Number.isFinite(vnum) || !row) {
      unplaced.push(h.volcano_name);
      continue;
    }
    const [, name, lat, lon, elevation, type, lastEruption] = row;
    placed.push({ hans: h, vnum, name: h.volcano_name, lat, lon, elevation, type, lastEruption, parent: exact ? undefined : name });
  }
  // Most serious first, so their labels win a crowded spot; by name within a level, so the
  // order (and the labels) don't shift with HANS's.
  placed.sort((a, b) => alertRank(b.hans.alert_level) - alertRank(a.hans.alert_level) || a.name.localeCompare(b.name));
  return { placed, unplaced };
}

/** "Great Sitkin WATCH · Shishaldin, Kilauea, Ahyi Seamount ADVISORY · 63 normal". */
export function volcanoSummary(placed: readonly UsVolcano[]): string {
  const parts: string[] = [];
  for (const level of ['WARNING', 'WATCH', 'ADVISORY']) {
    const names = placed.filter((v) => v.hans.alert_level.toUpperCase() === level).map((v) => v.name);
    if (names.length) parts.push(`${names.join(', ')} ${level}`);
  }
  const normal = placed.filter((v) => alertRank(v.hans.alert_level) === 0).length;
  parts.push(`${normal} normal`);
  return parts.join(' · ');
}

/** Raised ones larger and labelled; normal ones small and quiet: there are ~65 of them. */
export function volcanoOverlays(placed: readonly UsVolcano[]): EventOverlay[] {
  return placed.map((v) => {
    const rank = alertRank(v.hans.alert_level);
    return {
      kind: 'VO',
      pos: fromLatLon(v.lat, v.lon),
      color: aviationColor(v.hans.color_code),
      size: rank >= 1 ? 6 + rank : 3.5,
      rows: rank >= 1 ? { title: `${v.name.toUpperCase()} · ${v.hans.alert_level.toUpperCase()}`, detail: `${v.hans.color_code.toUpperCase()} · ${v.hans.obs_abbr.toUpperCase()}`, impact: 0, impactColor: '' } : undefined,
    };
  });
}

/** One volcano's part of a HANS notice: its one-line synopsis, the summary as text, its page. */
export interface NoticeSection {
  synopsis: string;
  summary: string;
  page?: string;
}

/** Notice HTML → plain text: tags dropped, common entities decoded, whitespace collapsed. */
export function htmlText(html: string): string {
  const named: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', deg: '°', ndash: '–', mdash: '—' };
  return html
    .replace(/<(br|\/p|\/div|\/li)\b[^>]*>/gi, ' ')
    .replace(/<[^>]*>/g, '')
    .replace(/&(#\d+|#x[0-9a-f]+|[a-z]+);/gi, (m, e: string) =>
      e[0] === '#' ? String.fromCodePoint(e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : Number(e.slice(1))) : (named[e.toLowerCase()] ?? m),
    )
    .replace(/\s+/g, ' ')
    .trim();
}

/** A notice's sections by volcano number. */
export function noticeSections(notice: unknown): Map<string, NoticeSection> {
  const out = new Map<string, NoticeSection>();
  const sections = (notice as { notice_sections?: unknown })?.notice_sections;
  if (!Array.isArray(sections)) return out;
  for (const s of sections as Record<string, unknown>[]) {
    if (s.vnum == null) continue;
    out.set(String(s.vnum), {
      synopsis: htmlText(String(s.synopsis ?? '')),
      summary: htmlText(String(s.summary ?? '')),
      page: typeof s.vUrl === 'string' && /^https:\/\//.test(s.vUrl) ? s.vUrl : undefined,
    });
  }
  return out;
}

const TONE: Record<number, ToastTone> = { 0: 'ok', 1: 'warn', 2: 'warn', 3: 'bad' };

/** HANS's "2026-10-22 19:49:57" (UTC) as ms; NaN for none. */
export const sentMs = (sent: string | null) => (sent ? Date.parse(`${sent.replace(' ', 'T')}Z`) : NaN);

/** The newest notice in the list, ms (for the feeds window), or undefined. */
export function newestNotice(list: readonly HansVolcano[]): number | undefined {
  const t = list.map((v) => sentMs(v.sent_utc)).filter(Number.isFinite);
  return t.length ? Math.max(...t) : undefined;
}

/** "22 Oct 19:49 UTC" from HANS's "2026-10-22 19:49:57". */
const sentLabel = (sent: string) => {
  const d = new Date(`${sent.replace(' ', 'T')}Z`);
  return Number.isFinite(d.getTime())
    ? `${d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' })} ${d.toISOString().slice(11, 16)} UTC`
    : sent;
};

/** A summary longer than this is cut at a sentence, the rest a click away (the notice). */
const SUMMARY_MAX = 420;

function shorten(text: string): string {
  if (text.length <= SUMMARY_MAX) return text;
  const cut = text.slice(0, SUMMARY_MAX);
  const end = cut.lastIndexOf('. ');
  return `${end > 120 ? cut.slice(0, end + 1) : cut.trimEnd()} …`;
}

/** The pick window: alert level and colour code, where it's watched from, the latest notice. */
export function volcanoInfo(v: UsVolcano, section?: NoticeSection | null): PickDetail {
  const rank = alertRank(v.hans.alert_level);
  const tiles = [
    { label: 'Alert level', value: v.hans.alert_level.toUpperCase() },
    { label: 'Aviation code', value: v.hans.color_code.toUpperCase() },
    { label: 'Observatory', value: v.hans.obs_fullname },
  ];
  if (v.hans.sent_utc) tiles.push({ label: 'Notice', value: sentLabel(v.hans.sent_utc) });
  if (v.elevation != null) tiles.push({ label: 'Elevation', value: `${v.elevation.toLocaleString('en-US')} m` });
  if (v.type) tiles.push({ label: 'Type', value: v.type });
  if (v.lastEruption != null) tiles.push({ label: 'Last eruption', value: v.lastEruption < 0 ? `${-v.lastEruption} BCE` : String(v.lastEruption) });
  const notes: string[] = [];
  if (section?.synopsis) notes.push(section.synopsis);
  if (section?.summary && section.summary !== section.synopsis) notes.push(shorten(section.summary));
  if (section === undefined && v.hans.sent_utc) notes.push('Loading the latest notice…');
  if (v.parent) notes.push(`Shown at the ${v.parent}, which it's part of.`);
  return {
    title: v.name,
    kind: 'US VOLCANO',
    color: aviationColor(v.hans.color_code),
    lat: v.lat,
    lon: v.lon,
    status: rank >= 0 ? { text: `${v.hans.alert_level.toUpperCase()} · ${v.hans.color_code.toUpperCase()}`, tone: TONE[rank] } : undefined,
    tiles,
    notes,
    link: /^https:\/\//.test(v.hans.notice_url) ? { href: v.hans.notice_url, text: 'USGS notice' } : undefined,
  };
}
