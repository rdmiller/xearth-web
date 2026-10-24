import { describe, expect, it } from 'vitest';
import { barDate, barTime, HOLD_DAYS_AFTER_MS, holdStep, spokenTime } from '../transport';

const d = new Date('2026-10-24T14:32:07.900Z');

describe('time controls', () => {
  it('shows the date in full, or short on a phone', () => {
    expect(barDate(d, false)).toBe('2026-10-24');
    expect(barDate(d, true)).toBe('OCT 24 2026');
    expect(barDate(new Date('1999-01-01T00:00:00Z'), true)).toBe('JAN 1 1999');
  });

  it('shows the time to the second, in UTC', () => {
    expect(barTime(d)).toBe('14:32:07');
  });

  it('says the time in full to a screen reader', () => {
    expect(spokenTime(d)).toBe('Simulated time: 24 October 2026, 14:32:07 UTC');
  });

  it('fits the narrowest phones: the short date is never longer than "SEP 30 2026"', () => {
    for (let m = 0; m < 12; m++) {
      const at = new Date(Date.UTC(2026, m, 28));
      expect(barDate(at, true).length).toBeLessThanOrEqual('SEP 30 2026'.length);
    }
  });

  it('a hold steps an hour at a time, then a day', () => {
    expect(holdStep(0)).toBe('hour');
    expect(holdStep(HOLD_DAYS_AFTER_MS - 1)).toBe('hour');
    expect(holdStep(HOLD_DAYS_AFTER_MS)).toBe('day');
  });
});
