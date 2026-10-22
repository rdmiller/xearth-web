import { describe, expect, it } from 'vitest';
import {
  ageFraction,
  FeedLog,
  formatAgeShort,
  formatCountdown,
  formatStamp,
  freshness,
  shortCountdown,
  toMs,
  waitFraction,
} from '../feeds';
import { hotkeyByKey } from '../hotkeys';
import { defaults, parseSettings, toQuery } from '../params';

const T0 = Date.parse('2026-10-22T12:00:00Z');
const MIN = 60_000;

describe('feed log', () => {
  it('records a scheduled check: busy while it runs, the next due an interval after it started', () => {
    const log = new FeedLog();
    log.begin('storms', T0, 15 * MIN);
    expect(log.get('storms')).toMatchObject({ busy: true, startedAt: T0, nextAt: T0 + 15 * MIN });
    log.done('storms', T0 + 2000, '2026-10-22T11:51:00Z');
    expect(log.get('storms')).toMatchObject({
      busy: false,
      checkedAt: T0 + 2000,
      dataAt: Date.parse('2026-10-22T11:51:00Z'),
      changedAt: T0 + 2000,
      nextAt: T0 + 15 * MIN,
    });
  });

  it('counts a change only when the data time moves', () => {
    const log = new FeedLog();
    log.done('fires', T0, '2026-10-22T11:50:00Z');
    log.done('fires', T0 + 15 * MIN, '2026-10-22T11:50:00Z');
    expect(log.get('fires').changedAt).toBe(T0);
    log.done('fires', T0 + 30 * MIN, '2026-10-22T12:50:00Z');
    expect(log.get('fires').changedAt).toBe(T0 + 30 * MIN);
  });

  it('keeps the data it had through a failure, and clears the error on the next success', () => {
    const log = new FeedLog();
    log.done('quakes', T0, T0 - MIN);
    log.begin('quakes', T0 + 5 * MIN, 5 * MIN);
    log.fail('quakes', T0 + 5 * MIN + 100, new Error('503 usgs'));
    expect(log.get('quakes')).toMatchObject({ busy: false, error: '503 usgs', dataAt: T0 - MIN });
    log.done('quakes', T0 + 10 * MIN, T0 + 9 * MIN);
    expect(log.get('quakes').error).toBeUndefined();
  });

  it('a check off the schedule leaves the next one where it was; stopping clears it', () => {
    const log = new FeedLog();
    log.begin('radar', T0, 5 * MIN);
    log.begin('radar', T0 + MIN);
    expect(log.get('radar').nextAt).toBe(T0 + 5 * MIN);
    log.stop('radar');
    expect(log.get('radar')).toMatchObject({ nextAt: undefined, busy: false });
  });

  it('reads ISO strings, HTTP dates and epoch ms, and ignores nonsense', () => {
    expect(toMs('2026-10-22T12:00:00Z')).toBe(T0);
    expect(toMs('Thu, 22 Oct 2026 12:00:00 GMT')).toBe(T0);
    expect(toMs(T0)).toBe(T0);
    expect(toMs('soon')).toBeUndefined();
    expect(toMs(null)).toBeUndefined();
    expect(toMs(undefined)).toBeUndefined();
  });
});

describe('freshness', () => {
  it('is fresh up to the usual age, late to twice it, stale beyond', () => {
    expect(freshness(30 * MIN, 60 * MIN)).toBe('fresh');
    expect(freshness(60 * MIN, 60 * MIN)).toBe('fresh');
    expect(freshness(61 * MIN, 60 * MIN)).toBe('late');
    expect(freshness(120 * MIN, 60 * MIN)).toBe('late');
    expect(freshness(121 * MIN, 60 * MIN)).toBe('stale');
  });

  it('fills the bar halfway at the usual age, and all the way at stale', () => {
    expect(ageFraction(0, 60 * MIN)).toBe(0);
    expect(ageFraction(60 * MIN, 60 * MIN)).toBe(0.5);
    expect(ageFraction(10 * 60 * MIN, 60 * MIN)).toBe(1);
    expect(ageFraction(-MIN, 60 * MIN)).toBe(0); // a clock a little ahead of ours
  });

  it('runs the ring from 0 just after a check to 1 when the next is due', () => {
    expect(waitFraction(T0 + 10 * MIN, 10 * MIN, T0)).toBe(0);
    expect(waitFraction(T0 + 10 * MIN, 10 * MIN, T0 + 5 * MIN)).toBe(0.5);
    expect(waitFraction(T0 + 10 * MIN, 10 * MIN, T0 + 11 * MIN)).toBe(1);
  });
});

describe('feed times in words', () => {
  it('counts down in m:ss, then hours', () => {
    expect(formatCountdown(42_000)).toBe('0:42');
    expect(formatCountdown(41_200)).toBe('0:42'); // rounds up: never shows 0:00 early
    expect(formatCountdown(12 * MIN + 5000)).toBe('12:05');
    expect(formatCountdown(65 * MIN)).toBe('1 h 05');
    expect(formatCountdown(-5000)).toBe('0:00');
  });

  it('squeezes the countdown into a ring', () => {
    expect(shortCountdown(42_000)).toBe('42s');
    expect(shortCountdown(12 * MIN + 5000)).toBe('12m');
    expect(shortCountdown(125 * MIN)).toBe('2h');
  });

  it('gives ages in seconds, minutes, hours, days', () => {
    expect(formatAgeShort(40_000)).toBe('40 s');
    expect(formatAgeShort(12 * MIN)).toBe('12 min');
    expect(formatAgeShort(3 * 60 * MIN)).toBe('3 h');
    expect(formatAgeShort(3 * 24 * 60 * MIN)).toBe('3 days');
  });

  it('stamps times as UTC, with the date when not today', () => {
    expect(formatStamp(Date.parse('2026-10-22T11:50:00Z'), T0)).toBe('11:50Z');
    expect(formatStamp(Date.parse('2026-10-21T18:00:00Z'), T0)).toBe('21 Oct 18:00Z');
  });
});

describe('feeds setting', () => {
  it('is off by default, round-trips through the URL, and toggles with Shift+U', () => {
    expect(defaults().feeds).toBe(false);
    const on = parseSettings('?feeds=1');
    expect(on.feeds).toBe(true);
    expect(toQuery(on)).toBe('?feeds=1');
    expect(hotkeyByKey('shift+u')?.description).toMatch(/feeds/i);
  });
});
