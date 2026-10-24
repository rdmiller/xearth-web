import { describe, expect, it } from 'vitest';
import {
  CITIES,
  CITY_GAP_PX,
  cityNear,
  decodeWikidataTitle,
  decodeWikipediaSummary,
  factLines,
  populationText,
  revealPx,
  worldCities,
  type CityFacts,
} from '../cities';
import { CITY_FACTS, COUNTRIES } from '../cityFacts';
import { sameName } from '../places';
import { dot, fromLatLon } from '../vec';
import { WORLD_CITIES } from '../worldCities';

const world = worldCities(WORLD_CITIES);
const shown = (radiusPx: number) => world.filter((c) => c.revealPx <= radiusPx);

describe('cities filling in as the view zooms', () => {
  it('shows a city once its gap spans the minimum on screen, and not before its label zoom', () => {
    expect(revealPx(0, 3)).toBe(Infinity);
    // 637 km is a tenth of an Earth radius: 1,100 px of radius puts it 110 px away.
    expect(revealPx(637.1, 1)).toBeCloseTo(CITY_GAP_PX * 10, 0);
    // A lone city waits for its label zoom: 1.5 × 256 · 2^5 / 2π px.
    expect(revealPx(5000, 5)).toBeCloseTo((1.5 * 256 * 32) / (2 * Math.PI), 6);
  });

  it('only ever adds cities as the globe grows', () => {
    let before = new Set<number>();
    for (const r of [500, 800, 1500, 3000, 8000, 20000]) {
      const now = new Set(shown(r).map((c) => c.row));
      for (const row of before) expect(now.has(row)).toBe(true);
      expect(now.size).toBeGreaterThan(before.size);
      before = now;
    }
  });

  it('keeps every city it shows the gap away from every city drawn before it', () => {
    for (const r of [1500, 4000]) {
      const drawn = [...CITIES.map(([, lat, lon]) => fromLatLon(lat, lon)), ...shown(r).map((c) => c.pos)];
      let closest = Infinity;
      shown(r).forEach((c, i) => {
        // Only those before it: the hand-picked ones, then the rows above.
        for (let j = 0; j < CITIES.length + i; j++) closest = Math.min(closest, Math.acos(Math.min(1, dot(c.pos, drawn[j]))) * r);
      });
      expect(closest).toBeGreaterThanOrEqual(CITY_GAP_PX - 1);
    }
  });

  it('starts with the biggest names', () => {
    const first = shown(1500).map((c) => c.name);
    expect(first).toContain('Toronto');
    expect(first).not.toContain('Kawasaki');
  });

  it('has a facts row beside every hand-picked city', () => {
    expect(CITY_FACTS.length).toBe(WORLD_CITIES.length);
    for (const [name, lat, lon] of CITIES) {
      const c = cityNear(world, lat, lon, (w) => w.revealPx === Infinity);
      expect(c, name).toBeDefined();
    }
    const tokyo = cityNear(world, 35.68, 139.69, (w) => w.revealPx === Infinity)!;
    const [pop, country, , kind, qid] = CITY_FACTS[tokyo.row];
    expect([COUNTRIES[country], kind, qid]).toEqual(['Japan', 1, 1490]);
    expect(pop).toBeGreaterThan(30e6);
  });

  it('finds a searched place by name nearby', () => {
    const c = cityNear(world, 41.88, -87.65, (w) => sameName(w.name, 'Chicago'));
    expect(c?.name).toBe('Chicago');
    expect(cityNear(world, 41.88, -87.65, (w) => sameName(w.name, 'Lima'))).toBeUndefined();
  });
});

describe('city facts', () => {
  const facts = (f: Partial<CityFacts>): CityFacts => ({ population: 0, country: 'Japan', region: 'Tokyo', kind: 'place', wikidata: null, ...f });

  it('reads populations at a sensible precision', () => {
    expect(populationText(35_700_000)).toBe('36 million');
    expect(populationText(2_140_000)).toBe('2.1 million');
    expect(populationText(1_000_000)).toBe('1 million');
    expect(populationText(412_000)).toBe('412,000');
  });

  it('says what kind of capital it is', () => {
    expect(factLines(facts({ kind: 'capital', population: 35_700_000 }))).toEqual(['Capital of Japan', 'Metro population 36 million']);
    expect(factLines(facts({ kind: 'regional capital', region: 'Illinois', country: 'United States of America' }))).toEqual(['Capital of Illinois']);
    expect(factLines(facts({ kind: 'station', population: 1000 }))).toEqual(['Research station', 'Population 1,000']);
    expect(factLines(facts({}))).toEqual([]);
  });
});

describe('Wikipedia', () => {
  it('takes the English article from Wikidata', () => {
    const j = { entities: { Q1490: { sitelinks: { enwiki: { site: 'enwiki', title: 'Tokyo' } } } } };
    expect(decodeWikidataTitle(j, 'Q1490')).toBe('Tokyo');
    expect(decodeWikidataTitle({ entities: { Q1: { sitelinks: {} } } }, 'Q1')).toBeNull();
    expect(decodeWikidataTitle(null, 'Q1')).toBeNull();
  });

  it('reads a summary, and skips a disambiguation page', () => {
    const page = { type: 'standard', description: 'Capital of Japan', extract: 'Tokyo is…', content_urls: { desktop: { page: 'https://en.wikipedia.org/wiki/Tokyo' } } };
    expect(decodeWikipediaSummary(page)).toEqual({ description: 'Capital of Japan', extract: 'Tokyo is…', url: 'https://en.wikipedia.org/wiki/Tokyo' });
    expect(decodeWikipediaSummary({ ...page, type: 'disambiguation' })).toBeNull();
    expect(decodeWikipediaSummary({ ...page, extract: '' })).toBeNull();
  });
});

describe('sameName', () => {
  it('matches a name with its longer form, and ignores accents', () => {
    expect(sameName('Washington', 'Washington, D.C.')).toBe(true);
    expect(sameName('Bogotá', 'Bogota')).toBe(true);
    expect(sameName('Paris', 'London')).toBe(false);
    expect(sameName('', 'London')).toBe(false);
  });
});
