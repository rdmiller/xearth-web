import { describe, expect, it } from 'vitest';
import monitored from './fixtures/hans-monitored-2026-10-23.json';
import notice from './fixtures/hans-notice-avo-2026-10-22.json';
import { alertRank, aviationColor, htmlText, isActive, isHansList, newestNotice, noticeSections, placeVolcanoes, volcanoInfo, volcanoOverlays, volcanoSummary, type HansVolcano } from '../usgsVolcanoes';

const list = monitored as HansVolcano[];
const { placed, unplaced } = placeVolcanoes(list);
const find = (name: string) => placed.find((v) => v.name === name)!;

describe('placing HANS’s volcanoes at the Smithsonian’s positions', () => {
  it('reads HANS’s list', () => {
    expect(isHansList(monitored)).toBe(true);
    expect(isHansList([{ name: 'x' }])).toBe(false);
  });

  it('places all but the two regions with no number (2026-10-23: 67 of 69)', () => {
    expect(list).toHaveLength(69);
    expect(placed).toHaveLength(67);
    expect(unplaced.sort()).toEqual(['Alaskan Volcanoes', 'Cascade Range']);
  });

  it('finds the calderas in the Pleistocene list, and a vent at its volcano', () => {
    expect([find('Long Valley Caldera').lat, find('Long Valley Caldera').lon]).toEqual([37.7, -118.87]);
    expect(find('Yellowstone').parent).toBeUndefined();
    const korovin = find('Korovin');
    expect(korovin.parent).toBe('Atka Volcanic Complex');
    expect([korovin.lat, korovin.lon]).toEqual([52.331, -174.139]);
  });

  it('puts the most serious first, and says who’s raised', () => {
    expect(placed.slice(0, 4).map((v) => v.name)).toEqual(['Great Sitkin', 'Ahyi Seamount', 'Kilauea', 'Shishaldin']);
    expect(volcanoSummary(placed)).toBe('Great Sitkin WATCH · Ahyi Seamount, Kilauea, Shishaldin ADVISORY');
    expect(volcanoSummary(placed.filter((v) => alertRank(v.hans.alert_level) === 0))).toBe('all normal');
  });
});

describe('on the globe', () => {
  it('draws only the active volcanoes, large and labelled in their aviation colour', () => {
    const o = volcanoOverlays(placed);
    expect(o).toHaveLength(4);
    const sitkin = o[0];
    expect(sitkin.color).toBe(aviationColor('ORANGE'));
    expect(sitkin.size).toBe(8);
    expect(sitkin.rows).toEqual({ title: 'GREAT SITKIN · WATCH', detail: 'ORANGE · AVO', impact: 0, impactColor: '' });
    expect(o.every((x) => x.rows && x.color !== aviationColor('GREEN'))).toBe(true);
  });

  it('counts a raised level or a raised aviation code as activity, not NORMAL/GREEN', () => {
    expect(isActive(find('Great Sitkin'))).toBe(true);
    expect(isActive(find('Yellowstone'))).toBe(false);
    const yellowOnly = { ...find('Yellowstone'), hans: { ...find('Yellowstone').hans, color_code: 'YELLOW' } };
    expect(isActive(yellowOnly)).toBe(true);
  });

  it('ranks the alert levels, and colours an unknown code grey', () => {
    expect(['NORMAL', 'ADVISORY', 'WATCH', 'WARNING', 'UNASSIGNED'].map(alertRank)).toEqual([0, 1, 2, 3, -1]);
    expect(aviationColor('UNASSIGNED')).toBe('#9aa5b1');
  });
});

describe('the latest notice', () => {
  const sections = noticeSections(notice);

  it('reads each volcano’s synopsis, summary and page from a HANS notice', () => {
    const s = sections.get('311120')!;
    expect(s.synopsis).toBe('AVO Great Sitkin ORANGE/WATCH - Slow eruption of lava within the summit crater continues.');
    expect(s.summary).toMatch(/^Lava continues to erupt slowly within the summit crater of Great Sitkin Volcano/);
    expect(s.summary).not.toMatch(/<|>/);
    expect(s.page).toBe('https://www.avo.alaska.edu/activity/GreatSitkin.php');
  });

  it('turns HTML into plain text', () => {
    expect(htmlText('<p>Ash &amp; gas<br/>at 3,000&nbsp;m &#8211; &#x2014; done</p>')).toBe('Ash & gas at 3,000 m – — done');
  });

  it('fills the window: level and code, observatory, notice, the synopsis', () => {
    const sitkin = find('Great Sitkin');
    const d = volcanoInfo(sitkin, sections.get('311120'));
    expect(d.title).toBe('Great Sitkin');
    expect(d.status).toEqual({ text: 'WATCH · ORANGE', tone: 'warn' });
    expect(d.tiles.slice(0, 4)).toEqual([
      { label: 'Alert level', value: 'WATCH' },
      { label: 'Aviation code', value: 'ORANGE' },
      { label: 'Observatory', value: 'Alaska Volcano Observatory' },
      { label: 'Notice', value: '22 Oct 19:49 UTC' },
    ]);
    expect(d.notes[0]).toMatch(/Slow eruption of lava/);
    expect(d.notes[1].length).toBeLessThanOrEqual(422);
    expect(d.link?.href).toMatch(/^https:\/\/volcanoes\.usgs\.gov\/hans-public\/notice\//);
  });

  it('copes with a volcano that has no notice: no time, nothing to load (2026-10-23: 13 of them)', () => {
    expect(list.filter((v) => !v.sent_utc)).toHaveLength(13);
    const shasta = volcanoInfo(find('Mount Shasta'), null);
    expect(shasta.tiles.map((t) => t.label)).not.toContain('Notice');
    expect(shasta.notes).toEqual([]);
    expect(newestNotice(list)).toBe(Date.parse('2026-10-23T18:11:41Z')); // the Cascade Range's update
  });

  it('says it’s loading, and where a vent is drawn', () => {
    expect(volcanoInfo(find('Korovin'), undefined).notes).toEqual(['Loading the latest notice…', 'Shown at the Atka Volcanic Complex, which it’s part of.'.replace('’', "'")]);
  });
});
