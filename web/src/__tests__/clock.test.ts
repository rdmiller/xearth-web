import { describe, expect, it } from 'vitest';
import { clockAt, isLive, jumpTo, live, stepBy, withSpeed, type Clock } from '../clock';

const T0 = Date.parse('2026-10-24T12:00:00Z');
const HOUR = 3_600_000;
const at = (c: Clock, wall: number) => clockAt(c, wall).toISOString();

describe('clock', () => {
  it('live shows the wall clock itself', () => {
    const c = live(T0);
    expect(isLive(c)).toBe(true);
    expect(clockAt(c, T0 + 5000).getTime()).toBe(T0 + 5000);
  });

  it('a fixed start time runs at the speed from its anchor', () => {
    const c: Clock = { time: new Date('2000-01-01T00:00:00Z'), speed: 60, anchor: T0 };
    expect(isLive(c)).toBe(false);
    expect(at(c, T0)).toBe('2000-01-01T00:00:00.000Z');
    expect(at(c, T0 + 1000)).toBe('2000-01-01T00:01:00.000Z');
  });

  it('a rate with no start time runs from the real time at its anchor', () => {
    const c: Clock = { time: null, speed: 10, anchor: T0 };
    expect(isLive(c)).toBe(false);
    expect(clockAt(c, T0 + 1000).getTime()).toBe(T0 + 10_000);
  });

  it('runs backwards and stands still', () => {
    expect(clockAt({ time: new Date(T0), speed: -3600, anchor: T0 }, T0 + 2000).getTime()).toBe(T0 - 2 * HOUR);
    expect(clockAt({ time: new Date(T0), speed: 0, anchor: T0 }, T0 + 99_000).getTime()).toBe(T0);
  });

  it('withSpeed carries on from the moment shown', () => {
    const a: Clock = { time: new Date(T0), speed: 60, anchor: T0 };
    const b = withSpeed(a, -10, T0 + 1000); // shown: T0 + 1 min
    expect(clockAt(b, T0 + 1000).getTime()).toBe(T0 + 60_000);
    expect(clockAt(b, T0 + 2000).getTime()).toBe(T0 + 50_000);
    // From live: the present, then the new rate.
    const c = withSpeed(live(T0), 0, T0 + 1000);
    expect(clockAt(c, T0 + 9000).getTime()).toBe(T0 + 1000);
  });

  it('jumpTo keeps the rate', () => {
    const target = new Date('2027-08-02T10:07:00Z');
    const paused = jumpTo({ time: new Date(T0), speed: 0, anchor: T0 }, target, T0 + 5000);
    expect(at(paused, T0 + 60_000)).toBe('2027-08-02T10:07:00.000Z');
    // Live plays on from there in real time, no longer live.
    const fromLive = jumpTo(live(T0), target, T0);
    expect(isLive(fromLive)).toBe(false);
    expect(at(fromLive, T0 + 1000)).toBe('2027-08-02T10:07:01.000Z');
  });

  it('jumpTo copies the date rather than holding on to it', () => {
    const target = new Date(T0);
    const c = jumpTo(live(T0), target, T0);
    target.setTime(0);
    expect(clockAt(c, T0).getTime()).toBe(T0);
  });

  it('stepBy moves from the moment shown, either way', () => {
    const running: Clock = { time: new Date(T0), speed: 600, anchor: T0 };
    const fwd = stepBy(running, HOUR, T0 + 1000); // shown: T0 + 10 min
    expect(clockAt(fwd, T0 + 1000).getTime()).toBe(T0 + 10 * 60_000 + HOUR);
    expect(fwd.speed).toBe(600);
    const back = stepBy(live(T0), -24 * HOUR, T0);
    expect(clockAt(back, T0).getTime()).toBe(T0 - 24 * HOUR);
    expect(back.speed).toBe(1);
  });
});
