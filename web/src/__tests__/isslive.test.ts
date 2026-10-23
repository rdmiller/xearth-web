import { describe, expect, it } from 'vitest';
import {
  geodetic,
  gpsToUtc,
  issFromTelemetry,
  issJoints,
  issReadings,
  issTime,
  propagate,
  signal,
  stateVector,
  type IssKey,
  type IssValues,
} from '../isslive';
import { EARTH_RADIUS_KM, positionAt, satrecFor } from '../satellites';

// One snapshot from push.lightstreamer.com / ISSLIVE on 2026-10-21 (TimeStamp hours, Value, CalibratedData).
// It predates the array joints and attitude (see 'array joints' below), hence Partial.
const SNAPSHOT: Partial<Record<IssKey, [number, string, string]>> = {
  gmt: [7057.047477222218, '25405370918', '293/01:02:50'],
  svX: [7057.045445555515, '5989.706876034813', '5989.706876035'],
  svY: [7057.045445555515, '2326.9456637276407', '2326.945663728'],
  svZ: [7057.045445555515, '-2216.627180458573', '-2216.627180459'],
  svVx: [7057.045445555515, '-58.57216392924351', '-58.572163929'],
  svVy: [7057.045445555515, '5361.046242794326', '5361.046242794'],
  svVz: [7057.045445555515, '5471.600869451425', '5471.600869451'],
  svTime: [7057.045445555515, '1476579780.005723', '293/01:03:00'],
  cabinPressure: [7056.136528611117, '748.4522705078125', '748.45'],
  cabinTemp: [7057.003944999973, '23.449062347412109', '23.4'],
  ppO2: [7025.401667777764, '165.84898488028526', '165.85'],
  ppCO2: [7025.401667777764, '2.435097679888904', '2.44'],
  mass: [7025.400723333292, '485727.0625', '485727'],
  beta: [7057.0042494444715, '-15.6328125', '-15.63'],
  cmg: [7057.047334444456, '8.537454605102539', '8.54'],
  attitudeFrame: [6989.735860833327, '0', 'LVLH'],
  maneuver: [7025.400944444471, '0', 'FALSE'],
  stationMode: [7055.944305555556, '16', 'EXTERNAL OPS '],
  laptops: [7025.40094527781, '7', '7'],
  sarjStarboard: [7057.047388611105, '161.07479858398438', '161.07'],
  sarjPort: [7057.047388611105, '198.936767578125', '198.94'],
  kuVideo: [7025.400999722216, '1', 'ACTIVE'],
};
const NOW = Date.parse('2026-10-21T22:30:00Z');
const values = (): IssValues =>
  new Map(Object.entries(SNAPSHOT).map(([k, [h, value, calibrated]]) => [k as IssKey, { value, calibrated, t: issTime(h, NOW) }]));

// The ISS's CelesTrak elements from the same day (epoch 2026-10-21T01:08:59Z).
const ISS_ELEMENTS = [25544, 1792544939.47, 15.48967427, 0.00067597, 51.6327, 37.2623, 289.5321, 70.4938, 0.00018187691, 9.575e-5, 0.0];

describe('ISSLive time stamps', () => {
  it('counts hours from 00:00 UTC on 31 December', () => {
    expect(issTime(7057.045445555515, NOW) - Date.parse('2026-10-21T01:02:43.604Z')).toBeCloseTo(0, -1);
    expect(new Date(issTime(24, NOW)).toISOString()).toBe('2026-01-01T00:00:00.000Z');
    // Early in January, a stamp from late December belongs to the year before.
    expect(new Date(issTime(8760, Date.parse('2027-01-01T00:30:00Z'))).toISOString()).toBe('2026-12-31T00:00:00.000Z');
  });

  it("agrees with the state vector's GPS time tag, less the 18 leap seconds", () => {
    const tag = gpsToUtc(1476579780.005723);
    expect(new Date(tag).toISOString()).toBe('2026-10-21T01:02:42.005Z');
    expect(Math.abs(tag - issTime(7057.045445555515, NOW))).toBeLessThan(2000);
  });

  it('is LOS when Greenwich time has stopped ticking', () => {
    expect(signal(values(), NOW)).toMatchObject({ aos: false });
    expect(signal(values(), Date.parse('2026-10-21T01:03:00Z'))).toMatchObject({ aos: true });
    expect(signal(new Map(), NOW)).toBeUndefined();
  });
});

describe('ISS state vector', () => {
  it('is km and m/s, whatever the dictionary says (|r| ≈ 6,797 km, |v| ≈ 7.66 km/s)', () => {
    const sv = stateVector(values())!;
    expect(Math.hypot(...sv.r)).toBeCloseTo(6797.4, 0);
    expect(Math.hypot(...sv.v)).toBeCloseTo(7.6605, 3);
  });

  it('lands within a couple of km of SGP4 for the same instant once precessed to the equator of date', () => {
    const sv = stateVector(values())!;
    const at = new Date(sv.t);
    const live = issFromTelemetry(values(), at)!;
    const sgp = positionAt(satrecFor(ISS_ELEMENTS)!, at)!;
    const km = Math.hypot(live.pos[0] - sgp[0], live.pos[1] - sgp[1], live.pos[2] - sgp[2]) * EARTH_RADIUS_KM;
    expect(km).toBeLessThan(3);
    expect(live.altKm).toBeGreaterThan(400);
    expect(live.altKm).toBeLessThan(430);
  });

  it('is only used near its epoch', () => {
    const sv = stateVector(values())!;
    expect(issFromTelemetry(values(), new Date(sv.t + 60_000))).toBeDefined();
    expect(issFromTelemetry(values(), new Date(sv.t + 10 * 60_000))).toBeUndefined();
  });

  it('propagates along the orbit (two-body, energy kept)', () => {
    const sv = stateVector(values())!;
    const later = propagate(sv, sv.t + 60_000);
    const moved = Math.hypot(later.r[0] - sv.r[0], later.r[1] - sv.r[1], later.r[2] - sv.r[2]);
    expect(moved).toBeCloseTo(459.5, 0); // ~7.66 km/s for a minute, along a slight curve
    const energy = (s: typeof sv) => Math.hypot(...s.v) ** 2 / 2 - 398600.4418 / Math.hypot(...s.r);
    expect(energy(later)).toBeCloseTo(energy(sv), 6);
  });

  it('turns Earth-fixed km into WGS-84 latitude, longitude and height', () => {
    expect(geodetic([6778.137, 0, 0])).toMatchObject({ lat: 0, lon: 0 });
    expect(geodetic([6778.137, 0, 0]).altKm).toBeCloseTo(400, 6);
    expect(geodetic([0, 0, 6356.752 + 400]).lat).toBeCloseTo(90, 6);
    expect(geodetic([0, 0, 6356.752 + 400]).altKm).toBeCloseTo(400, 2);
  });
});

describe('ISS readings', () => {
  it('reads the snapshot in display units, with the signal age', () => {
    const r = issReadings(values(), NOW)!;
    expect(r).toMatchObject({
      aos: false,
      status: 'LOS · 21 H',
      gmt: '21 OCT 01:02:50Z',
      mode: 'EXTERNAL OPS',
      attitude: 'LVLH',
      maneuvering: false,
      kuVideo: 'ACTIVE',
      orbit: undefined,
      laptops: 7,
    });
    // Cabin and partial pressures arrive in mmHg: shown in psi, CO2 left in mmHg.
    expect(r.cabinPsi).toBeCloseTo(14.47, 2);
    expect(r.o2Psi).toBeCloseTo(3.21, 2);
    expect(r.co2MmHg).toBeCloseTo(2.44, 2);
    expect(r.cabinTempC).toBeCloseTo(23.4, 1);
    expect(r.cmgPct).toBeCloseTo(8.54, 2);
    expect(r.betaDeg).toBeCloseTo(-15.63, 2);
    expect(r.sarjStarboardDeg).toBeCloseTo(161.07, 2);
    expect(r.sarjPortDeg).toBeCloseTo(198.94, 2);
    expect(r.massKg).toBeCloseTo(485727, 0);
  });

  it('carries the trajectory when there is a current state vector', () => {
    const orbit = { altKm: 418.24, speed: 7.6605, deltaKm: 0.93 };
    expect(issReadings(values(), NOW, orbit)!.orbit).toEqual(orbit);
  });

  it('leaves out what the stream has not sent', () => {
    const v = values();
    v.delete('ppCO2');
    v.delete('sarjPort');
    const r = issReadings(v, NOW)!;
    expect(r.co2MmHg).toBeUndefined();
    expect(r.sarjPortDeg).toBeUndefined();
  });
});

describe('array joints', () => {
  // From the live stream at 2026-10-23T22:19:21Z (day 296 of the year: 24 × 296 = 7104 h is 00:00 that day).
  const at = 7104 + 22 + 19 / 60 + 21 / 3600;
  const JOINTS: Partial<Record<IssKey, string>> = {
    sarjStarboard: '57.50667572021484375',
    sarjPort: '302.471923828125',
    bga1A: '133.4',
    bga3A: '226.5',
    bga2B: '309.4',
    q0: '0.9971362948417664',
    q1: '0.006585242692381144',
    q2: '-0.06696869432926178',
    q3: '-0.03449666127562523',
  };
  const now = Date.parse('2026-10-23T22:19:30Z');
  const map = (entries: Partial<Record<IssKey, string>>): IssValues =>
    new Map(Object.entries(entries).map(([k, value]) => [k as IssKey, { value: value!, calibrated: value!, t: issTime(at, now) }]));

  it('reads both SARJs, the BGAs that have come, and the attitude quaternion', () => {
    const j = issJoints(map(JOINTS))!;
    expect(j.sarjStarboard).toBeCloseTo(57.507, 3);
    expect(j.sarjPort).toBeCloseTo(302.472, 3);
    expect(j.bga).toEqual({ '1A': 133.4, '3A': 226.5, '2B': 309.4 });
    expect(j.q).toHaveLength(4);
    expect(new Date(j.t).toISOString()).toBe('2026-10-23T22:19:21.000Z');
  });

  it('leaves the quaternion out until all four parts have come, and everything until both SARJs have', () => {
    const { q3: _q3, ...three } = JOINTS;
    expect(issJoints(map(three))!.q).toBeUndefined();
    const { sarjPort: _port, ...oneSarj } = JOINTS;
    expect(issJoints(map(oneSarj))).toBeUndefined();
  });
});
