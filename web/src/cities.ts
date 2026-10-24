// Marker set, in the spirit of xearth's built-in city list. [name, lat, lon]
// Zoomed in, more fill in from Natural Earth's places (worldCities.ts), and a city's card
// has its facts (cityFacts.ts) and Wikipedia's summary.

import { distanceKm } from './locale';
import type { WorldCityRow } from './worldCities';
import { fromLatLon, type Vec3 } from './vec';

export const CITIES: readonly (readonly [string, number, number])[] = [
  ['Anchorage', 61.22, -149.9],
  ['Vancouver', 49.28, -123.12],
  ['San Francisco', 37.77, -122.42],
  ['Los Angeles', 34.05, -118.24],
  ['Honolulu', 21.31, -157.86],
  ['Denver', 39.74, -104.99],
  ['Mexico City', 19.43, -99.13],
  ['Chicago', 41.88, -87.63],
  ['Washington', 38.91, -77.04],
  ['New York', 40.71, -74.01],
  ['Miami', 25.76, -80.19],
  ['Bogotá', 4.71, -74.07],
  ['Lima', -12.05, -77.04],
  ['Santiago', -33.45, -70.67],
  ['Buenos Aires', -34.6, -58.38],
  ['São Paulo', -23.55, -46.63],
  ['Reykjavík', 64.15, -21.94],
  ['London', 51.51, -0.13],
  ['Paris', 48.86, 2.35],
  ['Madrid', 40.42, -3.7],
  ['Rome', 41.9, 12.5],
  ['Berlin', 52.52, 13.4],
  ['Stockholm', 59.33, 18.07],
  ['Moscow', 55.76, 37.62],
  ['Istanbul', 41.01, 28.98],
  ['Cairo', 30.04, 31.24],
  ['Lagos', 6.52, 3.38],
  ['Nairobi', -1.29, 36.82],
  ['Johannesburg', -26.2, 28.05],
  ['Cape Town', -33.92, 18.42],
  ['Dubai', 25.2, 55.27],
  ['Tehran', 35.69, 51.39],
  ['Mumbai', 19.08, 72.88],
  ['Delhi', 28.61, 77.21],
  ['Bangkok', 13.76, 100.5],
  ['Singapore', 1.35, 103.82],
  ['Jakarta', -6.21, 106.85],
  ['Beijing', 39.9, 116.41],
  ['Shanghai', 31.23, 121.47],
  ['Hong Kong', 22.32, 114.17],
  ['Manila', 14.6, 120.98],
  ['Seoul', 37.57, 126.98],
  ['Tokyo', 35.68, 139.69],
  ['Perth', -31.95, 115.86],
  ['Sydney', -33.87, 151.21],
  ['Auckland', -36.85, 174.76],
  ['McMurdo', -77.85, 166.67],
];

// ---- cities that fill in as the view zooms ---------------------------------------------------
// Each baked city knows how far it is from the nearest city drawn before it (the list above,
// then the more important ones), and shows once that gap is wide enough on screen. Zooming in
// only ever adds cities, the ones already shown stay put, and no two are closer than the gap.

/** On-screen gap, CSS px, a city needs from every city drawn before it. */
export const CITY_GAP_PX = 110;
/**
 * Nor before 1.5× the scale Natural Earth would label it at on a web map (zoom z: 256·2^z px
 * around the equator), so the far-flung ones fill in by importance, not all at once.
 */
const ZOOM_PX = (1.5 * 256) / (2 * Math.PI);
/** Nor until the disc is this much larger than the whole-disc view: zoomed out, the list above is the look. */
export const CITY_MIN_FILL = 1.15;
const EARTH_KM = 6371;
/** A hand-picked city lends its facts from within this distance. */
const NEAR_KM = 25;

export interface WorldCity {
  /** Its row in worldCities.ts and cityFacts.ts. */
  row: number;
  name: string;
  lat: number;
  lon: number;
  pos: Vec3;
  /** Globe radius, CSS px, it shows from; Infinity for a hand-picked city's facts. */
  revealPx: number;
}

export function revealPx(gapKm: number, zoom: number): number {
  return gapKm > 0 ? Math.max((CITY_GAP_PX * EARTH_KM) / gapKm, ZOOM_PX * 2 ** zoom) : Infinity;
}

export function worldCities(rows: readonly WorldCityRow[]): WorldCity[] {
  return rows.map(([name, lat, lon, zoom, gap], row) => ({ row, name, lat, lon, pos: fromLatLon(lat, lon), revealPx: revealPx(gap, zoom) }));
}

let worldLoad: Promise<readonly WorldCity[]> | undefined;

/** The baked cities (a separate chunk, ~100 KB gzipped), loaded once. */
export function loadWorldCities(): Promise<readonly WorldCity[]> {
  worldLoad ??= import('./worldCities').then(
    (m) => worldCities(m.WORLD_CITIES),
    (err) => {
      worldLoad = undefined; // try again next time
      throw err;
    },
  );
  return worldLoad;
}

/** The baked city nearest (lat, lon) within 25 km that `same` accepts. */
export function cityNear(list: readonly WorldCity[], lat: number, lon: number, same: (c: WorldCity) => boolean): WorldCity | undefined {
  let best: WorldCity | undefined;
  let bestKm = NEAR_KM;
  for (const c of list) {
    if (Math.abs(c.lat - lat) > 0.5) continue;
    const { km } = distanceKm(lat, lon, c.lat, c.lon);
    if (km < bestKm && same(c)) [best, bestKm] = [c, km];
  }
  return best;
}

// ---- facts -------------------------------------------------------------------------------

export type CityKind = 'place' | 'capital' | 'regional capital' | 'station';
const KINDS: readonly CityKind[] = ['place', 'capital', 'regional capital', 'station'];

export interface CityFacts {
  /** Natural Earth's metro estimate; 0 when it has none. */
  population: number;
  country: string;
  region: string;
  kind: CityKind;
  /** "Q1490", or null. */
  wikidata: string | null;
}

let factsLoad: Promise<(row: number) => CityFacts | undefined> | undefined;

/** A baked city's facts (another chunk, loaded the first time a city's card opens). */
export function loadCityFacts(): Promise<(row: number) => CityFacts | undefined> {
  factsLoad ??= import('./cityFacts').then(
    ({ CITY_FACTS, COUNTRIES, REGIONS }) =>
      (row) => {
        const f = CITY_FACTS[row];
        if (!f) return undefined;
        const [population, country, region, kind, qid] = f;
        return { population, country: COUNTRIES[country] ?? '', region: REGIONS[region] ?? '', kind: KINDS[kind] ?? 'place', wikidata: qid ? `Q${qid}` : null };
      },
    (err) => {
      factsLoad = undefined;
      throw err;
    },
  );
  return factsLoad;
}

/** "35.7 million", "412,000", "8,500" */
export function populationText(n: number): string {
  if (n >= 1e6) return `${(n / 1e6).toFixed(n >= 1e7 ? 0 : 1).replace(/\.0$/, '')} million`;
  return Math.round(n).toLocaleString('en-US');
}

/** The card's subtitle: "Illinois, United States of America". */
export const cityWhere = (f: CityFacts) => [f.region, f.country].filter(Boolean).join(', ');

/** The card's facts: "Capital of Japan", "Metro population 35.7 million". */
export function factLines(f: CityFacts): string[] {
  const lines: string[] = [];
  if (f.kind === 'capital' && f.country) lines.push(`Capital of ${f.country}`);
  else if (f.kind === 'regional capital' && f.region) lines.push(`Capital of ${f.region}`);
  else if (f.kind === 'station') lines.push('Research station');
  if (f.population > 0) lines.push(`${f.kind === 'station' ? 'Population' : 'Metro population'} ${populationText(f.population)}`);
  return lines;
}

// ---- Wikipedia ---------------------------------------------------------------------------
// The Wikidata item Natural Earth links → its English Wikipedia article (Wikidata's API, CC0)
// → the article's summary (Wikipedia's REST API, CC BY-SA). Both CORS-enabled, no key.

export const wikidataTitleUrl = (qid: string) =>
  `https://www.wikidata.org/w/api.php?${new URLSearchParams({ action: 'wbgetentities', ids: qid, props: 'sitelinks', sitefilter: 'enwiki', format: 'json', origin: '*' })}`;

export function decodeWikidataTitle(json: unknown, qid: string): string | null {
  const title = (json as { entities?: Record<string, { sitelinks?: { enwiki?: { title?: unknown } } }> } | null)?.entities?.[qid]?.sitelinks?.enwiki?.title;
  return typeof title === 'string' && title ? title : null;
}

export const wikipediaSummaryUrl = (title: string) => `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title.replace(/ /g, '_'))}`;

export interface CityAbout {
  /** "Capital and most populous city in Japan" */
  description: string;
  /** The article's opening paragraph, plain text. */
  extract: string;
  url: string;
}

export function decodeWikipediaSummary(json: unknown): CityAbout | null {
  const j = json as { type?: unknown; description?: unknown; extract?: unknown; content_urls?: { desktop?: { page?: unknown } } } | null;
  const url = j?.content_urls?.desktop?.page;
  if (!j || j.type === 'disambiguation' || typeof j.extract !== 'string' || !j.extract || typeof url !== 'string') return null;
  return { description: typeof j.description === 'string' ? j.description : '', extract: j.extract, url };
}
