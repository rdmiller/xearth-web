import { describe, expect, it } from 'vitest';
import {
  ASCENT_S,
  ascentPoint,
  flightPath,
  focusLaunch,
  formatClock,
  launchState,
  pickVariant,
  shortRocket,
  type Launch,
} from '../launches';
import { EARTH_RADIUS_KM } from '../satellites';
import { dot, fromLatLon, normalize, toLatLon } from '../vec';
// The pipeline's launches/latest.json from 2026-10-21, pinned (the live file is generated and gitignored).
import manifest from './fixtures/launches-2026-10-21.json';

// Real pipeline output (2026-10-21): Starlink G15-15, Vandenberg, T0 23:02:41Z, deploy 00:04:56.560Z.
const g1515 = (manifest.launches as unknown as Launch[]).find((l) => l.mission === 'Starlink Group 15-15')!;
const T0 = Date.parse('2026-10-21T23:02:41Z');
const at = (sec: number) => new Date(T0 + sec * 1000);

describe('pickVariant', () => {
  it('uses the primary opportunity, or a backup when the NET moves to it', () => {
    expect(pickVariant(g1515)?.file).toBe('starlink-g15-15');
    expect(pickVariant({ ...g1515, net: '2026-10-21T23:15:19Z' })?.file).toBe('starlink-g15-15b2');
    expect(pickVariant({ ...g1515, net: '2026-10-22T09:00:00Z' })).toBeUndefined();
  });
});

describe('launchState through a Starlink flight', () => {
  it('counts down on the pad before T0', () => {
    const s = launchState(g1515, at(-3600));
    expect(s.phase).toBe('countdown');
    expect(formatClock(s.t)).toBe('T−01:00:00');
    expect(toLatLon(s.pos).lat).toBeCloseTo(34.632, 3);
  });

  it('climbs during the (approximate) ascent along a plausible Falcon 9 profile', () => {
    const early = launchState(g1515, at(60));
    const meco = launchState(g1515, at(150));
    const late = launchState(g1515, at(ASCENT_S - 1));
    expect(early.phase).toBe('ascent');
    expect(early.approximate).toBe(true);
    expect(early.altKm!).toBeGreaterThan(5); // ~12 km for a real Falcon 9
    expect(early.altKm!).toBeLessThan(20);
    expect(meco.altKm!).toBeGreaterThan(40); // ~65 km at main-engine cut-off
    expect(meco.altKm!).toBeLessThan(90);
    // Insertion orbit ~260 km: by cut-off the stack is near it, near orbital speed.
    expect(late.altKm!).toBeGreaterThan(200);
    expect(late.altKm!).toBeLessThan(320);
    expect(late.speed!).toBeGreaterThan(6.5);
  });

  it('joins the predicted orbit without a jump or a lurch at engine cut-off', () => {
    const before = launchState(g1515, at(ASCENT_S - 0.5)).pos;
    const after = launchState(g1515, at(ASCENT_S + 0.5)).pos;
    const gapKm = Math.hypot(before[0] - after[0], before[1] - after[1], before[2] - after[2]) * EARTH_RADIUS_KM;
    expect(gapKm).toBeLessThan(15); // ~7.5 km/s × 1 s, plus a little
    const vIn = launchState(g1515, at(ASCENT_S - 2)).speed!;
    const vOut = launchState(g1515, at(ASCENT_S + 2)).speed!;
    expect(Math.abs(vIn - vOut)).toBeLessThan(1); // was 5.8 vs 7.4 km/s with a plain ease-in
  });

  it('coasts on the predicted orbit, then deploys at the exact time', () => {
    const deployT = (Date.parse('2026-10-22T00:04:56.560Z') - T0) / 1000;
    expect(launchState(g1515, at(deployT - 1)).phase).toBe('coast');
    const d = launchState(g1515, at(deployT + 1));
    expect(d.phase).toBe('deployed');
    expect(d.approximate).toBe(false);
    expect(d.speed!).toBeGreaterThan(7.2);
    expect(launchState(g1515, at(deployT + 7 * 3600)).phase).toBe('done');
  });

  it('heads up the 70° plane: the ground track leaves Vandenberg southward or northward, not east', () => {
    const pad = fromLatLon(34.632, -120.611);
    const seco = launchState(g1515, at(ASCENT_S)).pos;
    const ll = toLatLon(seco);
    expect(Math.abs(ll.lat - 34.632)).toBeGreaterThan(10);
    expect(dot(normalize(seco), pad)).toBeGreaterThan(0.8); // within ~37° of the pad
  });

  it('gives a launch with no predicted orbit a countdown and an in-flight marker, never a made-up path', () => {
    const plain: Launch = { ...g1515, prelaunch: undefined };
    expect(launchState(plain, at(-10)).phase).toBe('countdown');
    const s = launchState(plain, at(120));
    expect(s.phase).toBe('inflight');
    expect(flightPath(s).flown).toEqual([]);
    expect(launchState(plain, at(3600)).phase).toBe('done');
  });
});

describe('ascentPoint', () => {
  it('starts at the pad and ends at the cut-off point', () => {
    const pad = fromLatLon(28.5, -80.6);
    const seco: [number, number, number] = [0.5, -0.8, 0.45];
    expect(ascentPoint(pad, seco, 0)).toEqual(pad.map((v) => expect.closeTo(v, 9)));
    const end = ascentPoint(pad, seco, 1);
    seco.forEach((v, i) => expect(end[i]).toBeCloseTo(v, 9));
  });
});

describe('flightPath', () => {
  it('splits at now: flown behind, ahead to deployment', () => {
    const s = launchState(g1515, at(300));
    const p = flightPath(s);
    expect(p.flown.length).toBeGreaterThan(10);
    expect(p.ahead.length).toBeGreaterThan(50);
    expect(p.deploy).toBeDefined();
  });
});

describe('helpers', () => {
  it('formats mission clocks', () => {
    expect(formatClock(-15_727)).toBe('T−04:22:07');
    expect(formatClock(192.4)).toBe('T+00:03:12');
    expect(formatClock(-2 * 86400 - 5)).toBe('T−2d 00:00:05');
  });

  it('shortens rocket names', () => {
    expect(shortRocket('Falcon 9 Block 5')).toBe('Falcon 9');
    expect(shortRocket('Electron')).toBe('Electron');
  });

  it('focuses a launch in flight over the next one', () => {
    const flying = launchState(g1515, at(200));
    const next = launchState({ ...g1515, id: 'b', net: '2026-10-22T07:00:00Z', prelaunch: undefined }, at(200));
    expect(focusLaunch([next, flying])?.launch.id).toBe(g1515.id);
    expect(focusLaunch([next])?.launch.id).toBe('b');
  });

  it('keeps following a mission for half an hour after deployment, then moves on', () => {
    const deployT = (Date.parse('2026-10-22T00:04:56.560Z') - T0) / 1000;
    const next = (sec: number) => launchState({ ...g1515, id: 'b', net: '2026-10-22T07:00:00Z', prelaunch: undefined }, at(sec));
    const justDeployed = launchState(g1515, at(deployT + 60));
    expect(focusLaunch([next(deployT + 60), justDeployed])?.launch.id).toBe(g1515.id);
    const later = launchState(g1515, at(deployT + 40 * 60));
    expect(focusLaunch([next(deployT + 40 * 60), later])?.launch.id).toBe('b');
  });
});
