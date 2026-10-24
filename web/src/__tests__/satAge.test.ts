import { describe, expect, it } from 'vitest';
import { elementsAge, epochMs, hiddenNote } from '../satAge';

const DAY = 86_400_000;
const EPOCH = Date.parse('2026-10-24T00:00:00Z');

describe('satellite elements age', () => {
  it('places satellites as usual within 30 days of their elements, either way', () => {
    expect(elementsAge(EPOCH, EPOCH)).toBe('ok');
    expect(elementsAge(EPOCH + 30 * DAY, EPOCH)).toBe('ok');
    expect(elementsAge(EPOCH - 30 * DAY, EPOCH)).toBe('ok');
  });

  it('marks them approximate past that, and drops them after a year', () => {
    expect(elementsAge(EPOCH + 31 * DAY, EPOCH)).toBe('approx');
    expect(elementsAge(EPOCH - 200 * DAY, EPOCH)).toBe('approx');
    expect(elementsAge(EPOCH + 365 * DAY, EPOCH)).toBe('approx');
    expect(elementsAge(EPOCH + 366 * DAY, EPOCH)).toBe('gone');
    expect(elementsAge(EPOCH - 3000 * DAY, EPOCH)).toBe('gone');
  });

  it('reads the epoch from an element set', () => {
    expect(epochMs([25544, EPOCH / 1000, 15.5])).toBe(EPOCH);
  });

  it('says when the hidden orbits are from', () => {
    expect(hiddenNote(EPOCH)).toBe('constellations hidden: orbits from 24 Oct 2026');
  });
});
