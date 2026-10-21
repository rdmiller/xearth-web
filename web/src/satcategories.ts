// Satellite categories: what the satellite tree shows, how the pipeline's
// CelesTrak groups split into them, and which are on.
//
// Two settings decide visibility. `sats` is the coarse mode the O key cycles
// (all → named only → off); `satshow` lists the categories ticked in the tree.
// A category shows when both allow it.

import type { SatMode, Settings } from './params';
import { FEATURED, type Elements, type SatelliteManifest } from './satellites';

export interface SatLeaf {
  key: string;
  label: string;
  /** Named satellites (FEATURED) by key; bulk categories by CelesTrak group and orbit. */
  featured?: string;
  group?: string;
  orbit?: (e: Elements) => boolean;
  color: string;
  /** Point size, CSS px — larger for the far, sparse constellations. */
  size?: number;
  /** Far constellations are drawn as hollow diamonds, so they don't read as stars. */
  shape?: 'dot' | 'diamond';
  /** Few enough to label (the tree offers a labels toggle). */
  labelable?: boolean;
}

export interface SatBranch {
  key: string;
  label: string;
  children: SatNode[];
}
export type SatNode = SatLeaf | SatBranch;

export const isBranch = (n: SatNode): n is SatBranch => 'children' in n;

/** Revolutions a day: [norad, epoch, n, …]. */
const meanMotion = (e: Elements) => e[2];

export const SAT_TREE: SatBranch = {
  key: 'all',
  label: 'Satellites',
  children: [
    {
      key: 'named',
      label: 'Tracked',
      children: FEATURED.map((f) => ({ key: f.key, label: f.name, featured: f.key, color: f.color })),
    },
    {
      key: 'comms',
      label: 'Communications',
      children: [{ key: 'starlink', label: 'Starlink', group: 'starlink', color: '#d1e6ff', size: 2.2 }],
    },
    {
      key: 'weather',
      label: 'Weather',
      children: [
        // GOES, Himawari, Meteosat/MTG, FengYun 2/4, INSAT, GK-2A, Elektro: 1 rev/day.
        { key: 'weather-geo', label: 'Geostationary', group: 'weather', orbit: (e) => meanMotion(e) < 1.1, color: '#7dffa8', size: 7, shape: 'diamond', labelable: true },
        // Arktika-M: a Molniya-type orbit, 2 rev/day.
        { key: 'weather-heo', label: 'Highly elliptical', group: 'weather', orbit: (e) => meanMotion(e) >= 1.1 && meanMotion(e) < 10, color: '#b9ff6b', size: 7, shape: 'diamond', labelable: true },
        // NOAA/JPSS, MetOp, FengYun 3, Meteor-M, DMSP, Sentinel-3, Tianmu, CYGNSS: ~14–16 rev/day.
        { key: 'weather-leo', label: 'Low Earth orbit', group: 'weather', orbit: (e) => meanMotion(e) >= 10, color: '#3fe0c5', size: 2.6, labelable: true },
      ],
    },
    {
      key: 'nav',
      label: 'Navigation',
      children: [
        { key: 'gps', label: 'GPS', group: 'gps-ops', color: '#ffd166', size: 7, shape: 'diamond', labelable: true },
        { key: 'glonass', label: 'GLONASS', group: 'glo-ops', color: '#ff8c69', size: 7, shape: 'diamond', labelable: true },
      ],
    },
  ],
};

export function leaves(node: SatNode = SAT_TREE): SatLeaf[] {
  return isBranch(node) ? node.children.flatMap(leaves) : [node];
}

export const ALL_LEAVES = leaves().map((l) => l.key);
/** The bulk (point-cloud) categories, in the order of their index in the GL layer. */
export const BULK_LEAVES = leaves().filter((l) => l.group);
/** Every far constellation (drawn as diamonds) is named; the dense low-orbit dots aren't. */
export const DEFAULT_LABELS = ['weather-geo', 'weather-heo', 'gps', 'glonass'];

export function findNode(key: string, node: SatNode = SAT_TREE): SatNode | undefined {
  if (node.key === key) return node;
  return isBranch(node) ? node.children.map((c) => findNode(key, c)).find(Boolean) : undefined;
}

/** Shown under the coarse mode and the tree's ticks? */
export function leafOn(leaf: SatLeaf, s: Pick<Settings, 'sats' | 'satshow'>): boolean {
  if (s.sats === 'off') return false;
  if (s.sats === 'featured' && !leaf.featured) return false;
  return s.satshow.includes(leaf.key);
}

export type TriState = 'on' | 'off' | 'mixed';

export function nodeState(node: SatNode, s: Pick<Settings, 'sats' | 'satshow'>): TriState {
  const on = leaves(node).map((l) => leafOn(l, s));
  return on.every(Boolean) ? 'on' : on.some(Boolean) ? 'mixed' : 'off';
}

/**
 * Clicking a node: if it's fully on, turn its categories off, else turn them all on.
 * Everything else stays exactly as it looks, whatever the coarse mode was: the result
 * is the visible set as `satshow` with the mode at "all" (or "off" when nothing's left).
 */
export function toggleNode(node: SatNode, s: Pick<Settings, 'sats' | 'satshow'>): Pick<Settings, 'sats' | 'satshow'> {
  const keys = new Set(leaves(node).map((l) => l.key));
  const turnOn = nodeState(node, s) !== 'on';
  const satshow = leaves()
    .filter((l) => (keys.has(l.key) ? turnOn : leafOn(l, s)))
    .map((l) => l.key);
  const sats: SatMode = satshow.length ? 'all' : 'off';
  return { sats, satshow };
}

/** '#7dffa8' → [0.49, 1, 0.66] */
export function rgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

export function toggleLabels(leaf: SatLeaf, labels: string[]): string[] {
  return labels.includes(leaf.key) ? labels.filter((k) => k !== leaf.key) : [...labels, leaf.key];
}

// ---- splitting the manifest ---------------------------------------------------------------

export interface BulkCatalog {
  /** Elements for every bulk satellite, category by category. */
  elements: Elements[];
  /** BULK_LEAVES index per satellite. */
  category: Uint8Array;
  /** Satellites per leaf key. */
  counts: Record<string, number>;
  /** Names for the labelable leaves (NORAD → name). */
  names: Map<number, string>;
}

export function bulkCatalog(m: SatelliteManifest): BulkCatalog {
  const elements: Elements[] = [];
  const cats: number[] = [];
  const counts: Record<string, number> = {};
  BULK_LEAVES.forEach((leaf, i) => {
    const rows = (m.groups[leaf.group!] ?? []).filter((e) => !leaf.orbit || leaf.orbit(e));
    counts[leaf.key] = rows.length;
    for (const e of rows) {
      elements.push(e);
      cats.push(i);
    }
  });
  const names = new Map<number, string>();
  for (const group of Object.values(m.names ?? {})) {
    for (const [norad, name] of Object.entries(group)) names.set(Number(norad), name);
  }
  return { elements, category: Uint8Array.from(cats), counts, names };
}

/**
 * A label-sized name: "GOES 19", "METEOSAT-12", "NOAA 21", "GPS PRN 22", "GLONASS 730" / "GLONASS 702K".
 * CelesTrak's names carry launch designations and slot numbers in brackets.
 */
export function shortName(name: string): string {
  const n = name.replace(/\s+/g, ' ').trim();
  const prn = n.match(/^GPS .*\(PRN (\d+)\)$/);
  if (prn) return `GPS PRN ${prn[1]}`;
  // GLONASS slot/serial numbers; the newer GLONASS-K series carry a K ("702K").
  const glo = n.match(/^COSMOS \d+ \((\d+K?)\)$/);
  if (glo) return `GLONASS ${glo[1]}`;
  // "METEOSAT-12 (MTG-I1)" → "METEOSAT-12"; "NOAA 20 (JPSS-1)" → "NOAA 20"; "EWS-G2 (GOES 15)" stays as named.
  return n.replace(/\s*\(.*\)$/, '');
}

/** "11,149 Starlink · 73 weather · 32 GPS · 28 GLONASS" — what's on, weather orbits summed. */
export function bulkSummary(c: BulkCatalog | undefined, s: Pick<Settings, 'sats' | 'satshow'>): string {
  if (!c) return '';
  const totals = new Map<string, number>();
  for (const l of BULK_LEAVES) {
    if (!leafOn(l, s) || !c.counts[l.key]) continue;
    const name = l.key.startsWith('weather') ? 'weather' : l.label;
    totals.set(name, (totals.get(name) ?? 0) + c.counts[l.key]);
  }
  return [...totals].map(([name, n]) => `${n.toLocaleString('en-US')} ${name}`).join(' · ');
}
