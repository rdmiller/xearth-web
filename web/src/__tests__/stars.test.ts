import { Body, GeoVector, MakeTime } from 'astronomy-engine';
import { describe, expect, it } from 'vitest';
import catalogJson from '../../public/stars.json';
import { subsolarPoint } from '../astronomy';
import {
  LIMIT_MAG,
  applyFrame,
  bvToTemperature,
  decodeCatalog,
  litScreenFraction,
  photoMagShift,
  starAppearance,
  starColor,
  starFrame,
} from '../stars';
import { toLatLon, wrapLon } from '../vec';

const catalog = decodeCatalog(catalogJson);

describe('catalog', () => {
  it('holds the whole naked-eye sky, brightest first', () => {
    expect(catalog.count).toBeGreaterThan(9000);
    expect(catalog.mag[0]).toBeCloseTo(-1.46, 2); // Sirius
    for (let i = 0; i < catalog.count * 3; i += 3) {
      expect(Math.hypot(catalog.dir[i], catalog.dir[i + 1], catalog.dir[i + 2])).toBeCloseTo(1, 5);
    }
  });

  it('puts Sirius at RA 6h45m, Dec −16.7°', () => {
    const [x, y, z] = catalog.dir.slice(0, 3);
    const ra = (Math.atan2(y, x) * 180) / Math.PI;
    expect(ra / 15).toBeCloseTo(6.752, 2);
    expect((Math.asin(z) * 180) / Math.PI).toBeCloseTo(-16.72, 1);
  });
});

describe('starFrame', () => {
  const date = new Date('2026-10-21T16:00:00Z');
  const m = starFrame(date);

  it('is a rotation', () => {
    const cols = [0, 3, 6].map((i) => [m[i], m[i + 1], m[i + 2]]);
    for (const c of cols) expect(Math.hypot(...c)).toBeCloseTo(1, 5);
    expect(cols[0][0] * cols[1][0] + cols[0][1] * cols[1][1] + cols[0][2] * cols[1][2]).toBeCloseTo(0, 5);
  });

  it('agrees with the subsolar point when fed the Sun’s J2000 direction', () => {
    const v = GeoVector(Body.Sun, MakeTime(date), false);
    const ll = toLatLon(applyFrame(m, [v.x, v.y, v.z]));
    const s = subsolarPoint(date); // includes aberration, ≤ 20″
    expect(Math.abs(ll.lat - s.lat)).toBeLessThan(0.01);
    expect(Math.abs(wrapLon(ll.lon - s.lon))).toBeLessThan(0.01);
  });

  it('keeps Polaris within a degree of the pole', () => {
    // RA 2h31m49s, Dec +89°15′51″ (J2000)
    const ra = (2 + 31 / 60 + 49 / 3600) * 15 * (Math.PI / 180);
    const dec = (89 + 15 / 60 + 51 / 3600) * (Math.PI / 180);
    const p = applyFrame(m, [Math.cos(dec) * Math.cos(ra), Math.cos(dec) * Math.sin(ra), Math.sin(dec)]);
    expect(toLatLon(p).lat).toBeGreaterThan(89);
  });

  it('turns once per sidereal day', () => {
    const later = starFrame(new Date(date.getTime() + 86_164_091)); // 23h56m04.091s
    for (let i = 0; i < 9; i++) expect(later[i]).toBeCloseTo(m[i], 3);
  });
});

describe('colour', () => {
  it('gives the Sun (B−V 0.65) about 5,780 K', () => {
    expect(bvToTemperature(0.65)).toBeGreaterThan(5700);
    expect(bvToTemperature(0.65)).toBeLessThan(5850);
  });

  it('tints hot stars blue and cool stars orange, gently', () => {
    const rigel = starColor(-0.03);
    const betelgeuse = starColor(1.85);
    expect(rigel[2]).toBeGreaterThan(rigel[0]);
    expect(betelgeuse[0]).toBeGreaterThan(betelgeuse[2]);
    for (const c of [...rigel, ...betelgeuse]) expect(c).toBeGreaterThan(0.4); // never saturated
    expect(Math.max(...rigel)).toBeCloseTo(1, 6);
  });
});

describe('starAppearance', () => {
  it('grows brighter and wider with every magnitude', () => {
    let prev = starAppearance(LIMIT_MAG);
    for (let m = LIMIT_MAG - 1; m >= -1.5; m -= 1) {
      const a = starAppearance(m);
      expect(a.peak).toBeGreaterThan(prev.peak);
      expect(a.sigma).toBeGreaterThanOrEqual(prev.sigma);
      prev = a;
    }
  });

  it('saves width for the brightest stars', () => {
    expect(starAppearance(4).sigma).toBeLessThan(0.8);
    expect(starAppearance(-1.46).sigma).toBeGreaterThan(2);
  });

  it('fades out over the magnitude past the limit', () => {
    expect(starAppearance(LIMIT_MAG + 0.5).peak).toBeLessThan(starAppearance(LIMIT_MAG).peak);
    expect(starAppearance(LIMIT_MAG + 1).peak).toBe(0);
  });

  it('dims faint stars out before bright ones under exposure', () => {
    expect(starAppearance(5, 3).peak).toBe(0);
    expect(starAppearance(0, 3).peak).toBeGreaterThan(0.5);
  });
});

describe('camera exposure', () => {
  it('leaves stars alone with no sunlit Earth in frame', () => {
    expect(photoMagShift(0)).toBe(0);
  });

  it('removes them all when a full sunlit disc fills the view', () => {
    const lit = litScreenFraction(450, 1000, 1000, [1, 0, 0], [1, 0, 0]);
    expect(lit).toBeGreaterThan(0.6);
    expect(photoMagShift(lit)) .toBeGreaterThan(LIMIT_MAG + 1.5);
  });

  it('counts only the sunlit share of the disc', () => {
    const full = litScreenFraction(300, 1000, 1000, [1, 0, 0], [1, 0, 0]);
    expect(litScreenFraction(300, 1000, 1000, [1, 0, 0], [0, 1, 0])).toBeCloseTo(full / 2);
    expect(litScreenFraction(300, 1000, 1000, [1, 0, 0], [-1, 0, 0])).toBe(0);
  });
});
