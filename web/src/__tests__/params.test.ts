import { describe, expect, it } from 'vitest';
import { defaults, firstLoad, parseSettings, timezoneLongitude, toQuery } from '../params';

describe('parseSettings', () => {
  it('returns defaults for an empty query', () => {
    const d = defaults();
    expect(parseSettings('', d)).toEqual(d);
  });

  it('reads xearth-style settings and clamps out-of-range numbers', () => {
    const s = parseSettings('?view=sunrel&lat=120&lon=-30&wait=0&clouds=0&grid=1&time=2026-06-21T08:24:00Z');
    expect(s.view).toBe('sunrel');
    expect(s.lat).toBe(90);
    expect(s.lon).toBe(-30);
    expect(s.wait).toBe(1);
    expect(s.clouds).toBe(false);
    expect(s.grid).toBe(true);
    expect(s.time?.toISOString()).toBe('2026-06-21T08:24:00.000Z');
  });

  it('reads the star mode', () => {
    expect(parseSettings('?stars=photo').stars).toBe('photo');
    expect(parseSettings('?stars=0').stars).toBe('off');
    expect(parseSettings('?stars=1').stars).toBe('on');
  });

  it('reads the satellite settings', () => {
    expect(parseSettings('?sats=featured').sats).toBe('featured');
    expect(parseSettings('?sats=0').sats).toBe('off');
    expect(parseSettings('?view=track&track=SATGUS')).toMatchObject({ view: 'track', track: 'satgus' });
  });

  it('reads satellite categories and labels as comma lists, dropping unknown keys', () => {
    expect(parseSettings('?satshow=GPS,glonass,bogus').satshow).toEqual(['gps', 'glonass']);
    expect(parseSettings('?satshow=none').satshow).toEqual([]);
    expect(parseSettings('?satlabels=gps').satlabels).toEqual(['gps']);
    expect(parseSettings('').satlabels).toEqual(['weather-geo', 'weather-heo', 'gps', 'glonass', 'galileo', 'beidou']);
    // Listed in any order, written back in tree order; defaults stay out of the URL.
    const s = parseSettings('?satshow=glonass,gps');
    expect(toQuery(s)).toBe('?satshow=gps%2Cglonass');
    expect(toQuery({ ...s, satshow: [] })).toBe('?satshow=none');
    expect(toQuery(parseSettings(''))).toBe('');
  });

  it('reads the Sun/Moon settings and clamps bodyscale to 1–30', () => {
    expect(parseSettings('?bodies=0').bodies).toBe(false);
    expect(parseSettings('?bodyscale=12').bodyscale).toBe(12);
    expect(parseSettings('?bodyscale=0.2').bodyscale).toBe(1);
    expect(parseSettings('?bodyscale=99').bodyscale).toBe(30);
  });

  it('clamps the fire window to 1–24 hours (default 12)', () => {
    expect(parseSettings('').firehours).toBe(12);
    expect(parseSettings('?firehours=6').firehours).toBe(6);
    expect(parseSettings('?firehours=48').firehours).toBe(24);
    expect(parseSettings('?firehours=0').firehours).toBe(1);
  });

  it('reads the launch settings', () => {
    expect(parseSettings('?launches=0').launches).toBe(false);
    expect(parseSettings('?view=track&track=launch')).toMatchObject({ view: 'track', track: 'launch' });
  });

  it('ignores junk values', () => {
    const d = defaults();
    const s = parseSettings('?view=mars&mag=abc&time=yesterday', d);
    expect(s.view).toBe(d.view);
    expect(s.mag).toBe(d.mag);
    expect(s.time).toBeNull();
  });
});

describe('toQuery', () => {
  it('round-trips and omits defaults', () => {
    const d = defaults();
    expect(toQuery(d, d)).toBe('');
    const s = { ...d, view: 'moon' as const, mag: 1.5, stars: 'photo' as const };
    const q = toQuery(s, d);
    expect(q).toContain('view=moon');
    expect(q).not.toContain('lat=');
    expect(parseSettings(q, d)).toEqual(s);
  });
});

describe('timezoneLongitude', () => {
  it('maps UTC offsets to the zone’s central meridian', () => {
    expect(timezoneLongitude(0)).toBe(0);
    expect(timezoneLongitude(300)).toBe(-75); // UTC−5
    expect(timezoneLongitude(-540)).toBe(135); // UTC+9
  });
});

describe('relief settings', () => {
  it('is on at the default strength unless the URL says otherwise', () => {
    expect(parseSettings('').relief).toBe(true);
    expect(parseSettings('').reliefscale).toBe(1);
    expect(parseSettings('?relief=0').relief).toBe(false);
    expect(parseSettings('?reliefscale=2.5').reliefscale).toBe(2.5);
    expect(parseSettings('?reliefscale=99').reliefscale).toBe(5);
    expect(parseSettings('?reliefscale=0').reliefscale).toBe(0.1);
  });

  it('round-trips through the URL', () => {
    const s = { ...defaults(), relief: false, reliefscale: 2 };
    const back = parseSettings(toQuery(s));
    expect(back.relief).toBe(false);
    expect(back.reliefscale).toBe(2);
  });
});

describe('imagery setting', () => {
  it('defaults to live and reads the three modes', () => {
    expect(parseSettings('').imagery).toBe('live');
    expect(parseSettings('?imagery=daily').imagery).toBe('daily');
    expect(parseSettings('?imagery=PAINTED').imagery).toBe('painted');
    expect(parseSettings('?imagery=junk').imagery).toBe('live');
  });

  it('still reads the older truecolor flag: 0 = painted, 1 = daily', () => {
    expect(parseSettings('?truecolor=0').imagery).toBe('painted');
    expect(parseSettings('?truecolor=1').imagery).toBe('daily');
    expect(parseSettings('?truecolor=0&imagery=live').imagery).toBe('live');
  });

  it('round-trips through the URL', () => {
    expect(toQuery({ ...defaults(), imagery: 'painted' })).toBe('?imagery=painted');
    expect(parseSettings(toQuery({ ...defaults(), imagery: 'daily' })).imagery).toBe('daily');
  });
});

describe('readout setting', () => {
  it('reads label=short, and the old on/off switch', () => {
    expect(parseSettings('').label).toBe('on');
    expect(parseSettings('?label=short').label).toBe('short');
    expect(parseSettings('?label=0').label).toBe('off');
    expect(parseSettings('?label=1').label).toBe('on');
    expect(toQuery({ ...defaults(), label: 'short' })).toBe('?label=short');
  });
});

describe('firstLoad', () => {
  it('is the defaults on a large screen', () => {
    expect(firstLoad({ small: false, w: 1920, h: 1080 })).toEqual(defaults());
  });

  it('starts a phone zoomed in and its readout short, and says so in a link', () => {
    const s = firstLoad({ small: true, w: 390, h: 844 });
    expect(s).toEqual({ ...defaults(), mag: 2.48, label: 'short' });
    // Links are written against the plain defaults, so one made on a phone opens the same anywhere.
    expect(toQuery(s)).toBe('?mag=2.48&label=short');
  });

  it('zooms until the disc just overflows the height, either way up', () => {
    const disc = (w: number, h: number) => 0.9 * Math.min(w, h) * firstLoad({ small: true, w, h }).mag;
    // Upright: past the top and bottom by a little, past the sides by much more.
    expect(disc(390, 844) / 844).toBeCloseTo(1.03, 2);
    expect(disc(390, 844) - 390).toBeGreaterThan(5 * (disc(390, 844) - 844));
    // On its side: clipped top and bottom only.
    expect(disc(844, 390) / 390).toBeCloseTo(1.03, 2);
    expect(disc(844, 390)).toBeLessThan(844);
  });
});
