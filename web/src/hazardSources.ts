// The hazard tree: what the hazards panel shows, each hazard layer with the sources
// it draws from, and which are on.
//
// Two settings decide visibility. Each layer's own flag (`quakes`, `fires`, …) is
// what its hotkey switches; `hazoff` lists the sources unticked in the panel. A
// source shows when its layer is on and it isn't listed. Unticking a layer's last
// source switches the layer off instead, so its key brings it back whole.

import type { Settings } from './params';
import type { Storm } from './hazards';

export type HazardLayer = 'storms' | 'severe' | 'fires' | 'quakes' | 'lightning' | 'events' | 'ash' | 'tsunami';

export interface HazardSource {
  /** `layer.source`, as listed in `hazoff`. */
  key: string;
  label: string;
  layer: HazardLayer;
}

export interface HazardNode {
  key: HazardLayer;
  label: string;
  /** The hotkey that switches the layer (hotkeys.ts). */
  hotkey: string;
  /** None for a layer with a single source. */
  children: HazardSource[];
}

export type HazardTreeNode = HazardNode | HazardSource;

export const isHazardLayer = (n: HazardTreeNode): n is HazardNode => 'children' in n;

const node = (key: HazardLayer, label: string, hotkey: string, sources: [string, string][] = []): HazardNode => ({
  key,
  label,
  hotkey,
  children: sources.map(([k, l]) => ({ key: `${key}.${k}`, label: l, layer: key })),
});

/** In the dock's old order. */
export const HAZARD_TREE: HazardNode[] = [
  node('storms', 'Cyclones', 'w', [
    ['gdacs', 'GDACS'],
    ['nhc', 'NOAA NHC'],
  ]),
  node('severe', 'Severe weather', 'shift+w', [
    ['nws', 'NWS warnings'],
    ['spc', 'SPC outlook'],
    ['meteoalarm', 'MeteoAlarm'],
  ]),
  node('fires', 'Fires', 'x', [
    ['firms', 'NASA FIRMS'],
    ['mtg', 'MTG FRP'],
  ]),
  node('quakes', 'Earthquakes', 'q', [
    ['usgs', 'USGS'],
    ['emsc', 'EMSC'],
  ]),
  node('lightning', 'Lightning', 'z', [
    ['glm', 'GOES GLM'],
    ['mtg', 'MTG LI'],
  ]),
  node('events', 'Alerts', 'y', [
    ['gdacs', 'GDACS events'],
    ['flood', 'NASA flood extent'],
    ['hans', 'USGS volcanoes'],
  ]),
  node('ash', 'Volcanic ash', 'shift+a'),
  node('tsunami', 'Tsunami', 'shift+t', [
    ['centers', 'Warning centers'],
    ['nws', 'NWS alerts'],
  ]),
];

export const HAZARD_LAYERS = HAZARD_TREE.map((n) => n.key);
export const HAZARD_SOURCES = HAZARD_TREE.flatMap((n) => n.children);
export const ALL_HAZARD_SOURCES = HAZARD_SOURCES.map((s) => s.key);

type HazardSettings = Pick<Settings, HazardLayer | 'hazoff'>;

/** A source shown: its layer on, and not unticked. */
export function sourceOn(key: string, s: HazardSettings): boolean {
  const layer = key.split('.')[0] as HazardLayer;
  return !!s[layer] && !s.hazoff.includes(key);
}

export type TriState = 'on' | 'off' | 'mixed';

export function hazardState(n: HazardTreeNode, s: HazardSettings): TriState {
  if (!isHazardLayer(n)) return sourceOn(n.key, s) ? 'on' : 'off';
  if (!s[n.key]) return 'off';
  if (!n.children.length) return 'on';
  const on = n.children.map((c) => sourceOn(c.key, s));
  return on.every(Boolean) ? 'on' : on.some(Boolean) ? 'mixed' : 'off';
}

/**
 * Clicking a row: a layer fully on goes off, else on with every source; a source flips,
 * and everything else stays as it looks. A layer off has every source looking off, so
 * ticking one source of it switches the layer on with just that one.
 */
export function toggleHazard(n: HazardTreeNode, s: HazardSettings): Partial<HazardSettings> {
  const layer = isHazardLayer(n) ? n : HAZARD_TREE.find((l) => l.key === n.layer)!;
  const mine = new Set(layer.children.map((c) => c.key));
  const others = s.hazoff.filter((k) => !mine.has(k));
  if (isHazardLayer(n)) {
    return hazardState(n, s) === 'on' ? { [n.key]: false } : { [n.key]: true, hazoff: others };
  }
  const shown = layer.children.filter((c) => (c.key === n.key ? !sourceOn(c.key, s) : sourceOn(c.key, s))).map((c) => c.key);
  // Nothing left: the layer goes off, with its sources all ticked for when it comes back.
  if (!shown.length) return { [layer.key]: false, hazoff: others };
  return { [layer.key]: true, hazoff: [...others, ...layer.children.filter((c) => !shown.includes(c.key)).map((c) => c.key)] };
}

/** Which of a layer's sources are shown, as a string to compare before and after a change. */
export function sourcesKey(layer: HazardLayer, s: HazardSettings): string {
  const n = HAZARD_TREE.find((l) => l.key === layer)!;
  return [s[layer], ...n.children.map((c) => sourceOn(c.key, s))].map(Number).join('');
}

/** Hazard layers on, of all of them: the dock button's tag. */
export function hazardsOn(s: HazardSettings): number {
  return HAZARD_TREE.filter((n) => hazardState(n, s) !== 'off').length;
}

/**
 * The cyclones from the sources shown. The pipeline merges NHC's details into GDACS's
 * storm where they match, and adds NHC's others on their own (`nhc-` ids): without NHC
 * those go and the rest lose NHC's details; without GDACS only what NHC has stays, on
 * NHC's details alone (GDACS's track and impact go with it).
 */
export function stormsFrom(storms: readonly Storm[], gdacs: boolean, nhc: boolean): Storm[] {
  return storms.flatMap((st): Storm[] => {
    const fromNhc = st.id.startsWith('nhc-');
    if (gdacs && nhc) return [st];
    if (gdacs) return fromNhc ? [] : [{ ...st, nhc: undefined }];
    if (nhc && st.nhc) return [fromNhc ? st : { ...st, source: 'NHC', alert: '', cls: '', peakWindKmh: null, segments: [] }];
    return [];
  });
}
