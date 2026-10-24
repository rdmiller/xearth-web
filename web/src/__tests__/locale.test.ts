import { describe, expect, it } from 'vitest';
import {
  aqiAlert,
  clockMinutes,
  compass,
  conditionsLine,
  dayProgress,
  daylightText,
  decodeForecast,
  decodeNwsPointAlerts,
  detailLine,
  distanceKm,
  inNwsArea,
  localClock,
  nearbyHazards,
  offsetLabel,
  prefersImperial,
  sortAlerts,
  sunLine,
  titleCase,
  uvBand,
  weatherIcon,
  weatherWord,
} from '../locale';
import type { EventManifest, FireManifest, LightningManifest, Quake, StormManifest } from '../hazards';
import type { TsunamiManifest } from '../tsunami';

// Open-Meteo's answer for London, 2026-10-22 (trimmed to the fields asked for).
const LONDON = {
  utc_offset_seconds: 3600,
  timezone: 'Europe/London',
  timezone_abbreviation: 'GMT+1',
  current: {
    time: '2026-10-22T13:15',
    temperature_2m: 13.1,
    apparent_temperature: 9.7,
    relative_humidity_2m: 61,
    weather_code: 2,
    wind_speed_10m: 15.8,
    wind_direction_10m: 258,
    wind_gusts_10m: 33.5,
    is_day: 1,
  },
  daily: {
    time: ['2026-10-22'],
    sunrise: ['2026-10-22T07:36'],
    sunset: ['2026-10-22T17:52'],
    daylight_duration: [36988.14],
    temperature_2m_max: [13.9],
    temperature_2m_min: [8.8],
    uv_index_max: [1.3],
  },
};

describe('the weather, drawn', () => {
  it('picks a picture for the weather code, by day and night', () => {
    expect(weatherIcon(0, true)).toBe('clear');
    expect(weatherIcon(1, false)).toBe('clear-night');
    expect(weatherIcon(2, false)).toBe('partly-night');
    expect(weatherIcon(45)).toBe('fog');
    expect(weatherIcon(53)).toBe('drizzle');
    expect(weatherIcon(81)).toBe('rain');
    expect(weatherIcon(86)).toBe('snow');
    expect(weatherIcon(95)).toBe('thunder');
    expect(weatherIcon(99)).toBe('hail');
    expect(weatherIcon(1234)).toBe('cloudy');
  });

  it('finds how far through its day the sun is', () => {
    const w = decodeForecast(LONDON)!; // up 07:36, down 17:52, UTC+1
    expect(clockMinutes('07:36')).toBe(456);
    expect(clockMinutes(null)).toBeNull();
    expect(dayProgress(w, Date.parse('2026-10-22T06:36Z'))).toBe(0); // 07:36 there
    expect(dayProgress(w, Date.parse('2026-10-22T12:15Z'))).toBeCloseTo(339 / 616, 6);
    expect(dayProgress(w, Date.parse('2026-10-22T20:00Z'))).toBeGreaterThan(1);
    expect(dayProgress({ ...w, sunrise: null }, 0)).toBeNull();
  });

  it('bands the UV index and reads the daylight', () => {
    expect([1.3, 3, 7.9, 10, 11].map(uvBand)).toEqual(['low', 'moderate', 'high', 'very high', 'extreme']);
    expect(daylightText(36988)).toBe('10 h 16 min');
  });
});

describe('decodeForecast', () => {
  it('reads the current weather and the day', () => {
    const w = decodeForecast(LONDON)!;
    expect(w).toMatchObject({ tempC: 13.1, feelsC: 9.7, code: 2, isDay: true, sunrise: '07:36', sunset: '17:52', utcOffsetS: 3600, hiC: 13.9, loC: 8.8 });
  });

  it('drops the midnight-to-midnight times of a polar day', () => {
    const night = decodeForecast({ ...LONDON, daily: { sunrise: ['2026-10-22T00:00'], sunset: ['2026-10-22T00:00'], daylight_duration: [0] } })!;
    expect(night.sunrise).toBeNull();
    expect(sunLine(night)).toMatch(/^Polar night/);
    const day = decodeForecast({ ...LONDON, daily: { sunrise: ['2026-10-22T00:00'], sunset: ['2026-10-23T00:00'], daylight_duration: [86400] } })!;
    expect(sunLine(day)).toMatch(/^Midnight sun/);
  });

  it('is null without current conditions', () => {
    expect(decodeForecast({ daily: LONDON.daily })).toBeNull();
    expect(decodeForecast(null)).toBeNull();
  });
});

describe('weather lines', () => {
  const w = decodeForecast(LONDON)!;

  it('words WMO codes', () => {
    expect(weatherWord(0, false)).toBe('Clear night');
    expect(weatherWord(65)).toBe('Heavy rain');
    expect(weatherWord(95)).toBe('Thunderstorm');
    expect(weatherWord(42)).toBe('Unknown');
  });

  it('uses the viewer’s units', () => {
    expect(conditionsLine(w, false)).toBe('Partly cloudy · 13°C, feels 10°C');
    expect(conditionsLine(w, true)).toBe('Partly cloudy · 56°F, feels 49°F');
    expect(detailLine(w, false)).toBe('Wind WSW 16 km/h, gusts 34 · Humidity 61% · High 14° Low 9° · UV 1');
    expect(detailLine(w, true)).toBe('Wind WSW 10 mph, gusts 21 · Humidity 61% · High 57° Low 48° · UV 1');
  });

  it('gives sunrise, sunset and daylight', () => {
    expect(sunLine(w)).toBe('Sunrise 07:36 · Sunset 17:52 · 10 h 16 min of daylight');
  });

  it('picks units from the locale', () => {
    expect(prefersImperial('en-US')).toBe(true);
    expect(prefersImperial('en-GB')).toBe(false);
    expect(prefersImperial('fr')).toBe(false);
  });

  it('tells the local time and offset', () => {
    const now = Date.UTC(2026, 9, 22, 12, 15);
    expect(localClock(now, 3600)).toBe('13:15');
    expect(localClock(now, -7 * 3600)).toBe('05:15');
    expect(offsetLabel(19_800)).toBe('UTC+5:30');
    expect(offsetLabel(-28_800)).toBe('UTC−8');
    expect(offsetLabel(0)).toBe('UTC');
  });

  it('names compass points', () => {
    expect(compass(0)).toBe('N');
    expect(compass(359)).toBe('N');
    expect(compass(258)).toBe('WSW');
    expect(compass(270)).toBe('W');
    expect(compass(-45)).toBe('NW');
  });
});

describe('alerts', () => {
  it('reads NWS point alerts, one per event', () => {
    const feature = (event: string, severity: string, extra = {}) => ({
      properties: { event, severity, status: 'Actual', messageType: 'Alert', ends: '2026-10-22T18:00:00-07:00', senderName: 'NWS Seattle WA', ...extra },
    });
    const alerts = decodeNwsPointAlerts({
      features: [
        feature('Wind Advisory', 'Moderate'),
        feature('Flood Watch', 'Severe'),
        feature('Flood Watch', 'Severe'),
        feature('Red Flag Warning', 'Severe'),
        feature('Special Weather Statement', 'Moderate'),
        feature('Test Message', 'Unknown', { status: 'Test' }),
      ],
    });
    expect(alerts.map((a) => [a.title, a.level])).toEqual([
      ['Wind Advisory', 'advisory'],
      ['Flood Watch', 'watch'],
      ['Red Flag Warning', 'warning'],
      ['Special Weather Statement', 'info'],
    ]);
    expect(alerts[0].detail).toBe('until Oct 22 18:00 · NWS Seattle WA');
    expect(sortAlerts(alerts)[0].title).toBe('Red Flag Warning');
    expect(decodeNwsPointAlerts({})).toEqual([]);
  });

  it('flags air worse than moderate', () => {
    expect(aqiAlert({ current: { us_aqi: 42 } })).toBeNull();
    expect(aqiAlert({ current: { us_aqi: 120 } })).toMatchObject({ level: 'advisory', title: 'Air quality: Unhealthy for sensitive groups' });
    expect(aqiAlert({ current: { us_aqi: 230 } })).toMatchObject({ level: 'warning', detail: 'US AQI 230' });
    expect(aqiAlert({})).toBeNull();
  });

  it('asks NWS only about US places', () => {
    expect(inNwsArea(47.6, -122.3)).toBe(true); // Seattle
    expect(inNwsArea(61.2, -149.9)).toBe(true); // Anchorage
    expect(inNwsArea(21.3, -157.8)).toBe(true); // Honolulu
    expect(inNwsArea(18.4, -66.1)).toBe(true); // San Juan
    expect(inNwsArea(51.5, -0.12)).toBe(false); // London
    expect(inNwsArea(-33.9, 151.2)).toBe(false); // Sydney
  });
});

describe('nearbyHazards', () => {
  const now = Date.UTC(2026, 9, 22, 12);
  // Kingston, Jamaica.
  const [lat, lon] = [17.97, -76.79];

  it('measures distance and bearing', () => {
    const d = distanceKm(51.5, -0.12, 48.86, 2.35); // London → Paris
    expect(d.km).toBeGreaterThan(335);
    expect(d.km).toBeLessThan(350);
    expect(compass(d.bearing)).toBe('SSE');
  });

  it('finds what the layers have near a place, and nothing far away', () => {
    const storms = {
      generated: '',
      storms: [
        { id: 'a', name: 'Melissa', source: '', alert: 'Red', pos: [-77.5, 16.8], cls: 'HU', peakWindKmh: 250, segments: [] },
        { id: 'b', name: 'Far', source: '', alert: 'Green', pos: [140, 20], cls: 'TS', peakWindKmh: 80, segments: [] },
      ],
    } as unknown as StormManifest;
    const quakes: Quake[] = [
      { id: 'q1', mag: 5.2, place: '', time: now - 3 * 3_600_000, lat: 18.5, lon: -77.5, depthKm: 10, tsunami: false, alert: null },
      { id: 'q2', mag: 6.8, place: '', time: now - 3_600_000, lat: 35, lon: 140, depthKm: 10, tsunami: false, alert: null },
      { id: 'q3', mag: 5.9, place: '', time: now - 3 * 86_400_000, lat: 18, lon: -76.8, depthKm: 10, tsunami: false, alert: null },
    ];
    const events = {
      generated: '',
      volcanoDays: 7,
      counts: { FL: 1, WF: 0, VO: 0 },
      events: [{ id: 'f', type: 'FL', name: 'Jamaica', country: 'Jamaica', alert: 'Orange', pos: [-77.2, 18.2], from: null, to: null, url: '' }],
    } as unknown as EventManifest;
    const lightning = { generated: '', source: '', satellites: [], windowMin: 15, latest: null, cellDeg: 0.1, flashes: 7, count: 2, data: [180, -768, 5, 2, 400, 400, 2, 1] } as LightningManifest;
    const fires = { generated: '', source: '', cellDeg: 0.1, detections: 3, count: 1, data: [180, -768, 50, 3, 3] } as FireManifest;
    const tsunami = {
      generated: '',
      centers: [],
      maxAgeHours: 24,
      bulletins: [{ id: 't', center: 'PTWC', category: 'threat', region: 'Caribbean Sea', lat: 17, lon: -78, magnitude: 7.1, magnitudeType: 'Mww', issued: null, note: null, bulletin: null }],
    } as TsunamiManifest;

    const alerts = nearbyHazards(lat, lon, { storms, quakes, events, lightning, fires, tsunami }, now);
    expect(alerts.map((a) => a.title)).toEqual([
      'Hurricane Melissa',
      'Tsunami threat (PTWC)',
      'M5.2 earthquake',
      'Flood · Jamaica',
      'Lightning nearby',
      'Active fires detected',
    ]);
    expect(alerts[0]).toMatchObject({ level: 'warning' });
    expect(alerts[2].detail).toMatch(/^\d+ km NW · 3 h ago$/);
    expect(alerts[3].detail).toMatch(/^\d+ km WNW$/);
    expect(alerts[3].impact).toBe(2);
    expect(alerts[0].impact).toBe(3);
    expect(alerts[4].detail).toBe('5 flashes within 50 km in the last 15 min');
    expect(alerts[5].detail).toBe('3 satellite detections within 25 km');
    expect(nearbyHazards(lat, lon, { storms, quakes, events, lightning, fires, tsunami }, now, true)[4].detail).toMatch(/within 30 mi/);
  });

  it('is empty with nothing loaded', () => {
    expect(nearbyHazards(lat, lon, {}, now)).toEqual([]);
  });
});

describe('titleCase', () => {
  it('softens HUD caps', () => {
    expect(titleCase('TROPICAL STORM MELISSA')).toBe('Tropical Storm Melissa');
    expect(titleCase('ERUPTION · ETNA')).toBe('Eruption · Etna');
  });
});
