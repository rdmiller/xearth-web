import { describe, expect, it } from 'vitest';
import { fetchSpaceWeather, parseFlares, parseKp, SPACE_WEATHER_URLS, spaceWeatherLine, stormLevel } from '../spaceweather';

// Shapes and values as returned by SWPC on 2026-10-21 ~19:20Z.
const KP = [
  { time_tag: '2026-10-21T12:00:00', Kp: 2.67, a_running: 12, station_count: 6 },
  { time_tag: '2026-10-21T15:00:00', Kp: 3.33, a_running: 18, station_count: 6 },
];
const FLARES = [{ time_tag: '2026-10-21T19:21:00Z', current_class: 'B9.5', max_class: 'C1.3', max_time: '2026-10-21T10:58:00Z' }];
const WIND = [{ proton_speed: 453, time_tag: '2026-10-21T19:14:00Z' }];
const FIELD = [{ bt: 9, bz_gsm: -3, time_tag: '2026-10-21T19:14:00Z' }];

describe('space weather', () => {
  it('parses the four SWPC feeds into one line', async () => {
    const byUrl: Record<string, unknown> = {
      [SPACE_WEATHER_URLS.kp]: KP,
      [SPACE_WEATHER_URLS.flares]: FLARES,
      [SPACE_WEATHER_URLS.wind]: WIND,
      [SPACE_WEATHER_URLS.field]: FIELD,
    };
    const sw = await fetchSpaceWeather(async (url) => byUrl[url]);
    expect(sw).toMatchObject({ kp: 3.33, xray: 'B9.5', flare: { max: 'C1.3' }, windKms: 453, btNt: 9, bzNt: -3 });
    expect(spaceWeatherLine(sw)).toBe('space weather Kp 3.3 · X-ray B9.5 (last flare C1.3) · wind 453 km/s · Bz −3 nT');
  });

  it('keeps what it can when a feed fails', async () => {
    const sw = await fetchSpaceWeather(async (url) => {
      if (url === SPACE_WEATHER_URLS.kp) return KP;
      throw new Error('503');
    });
    expect(spaceWeatherLine(sw)).toBe('space weather Kp 3.3');
    expect(spaceWeatherLine({})).toBeUndefined();
  });

  it('names geomagnetic storms on the NOAA G scale', () => {
    expect(stormLevel(4.67)).toBeUndefined();
    expect(stormLevel(5)).toBe('G1');
    expect(stormLevel(7.33)).toBe('G3');
    expect(stormLevel(9)).toBe('G5');
    expect(spaceWeatherLine({ kp: 7.33 })).toBe('space weather Kp 7.3 (G3 storm)');
  });

  it('tolerates odd shapes', () => {
    expect(parseKp([])).toBeUndefined();
    expect(parseKp({})).toBeUndefined();
    expect(parseFlares([])).toEqual({ xray: undefined, flare: undefined });
  });
});
