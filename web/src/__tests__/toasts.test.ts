import { describe, expect, it } from 'vitest';
import { slotFor } from '../toasts';

describe('toast window order', () => {
  it('puts a window after those ordered before it, whatever order they were added in', () => {
    expect(slotFor([], 2)).toBe(0);
    expect(slotFor([0, 1, 3], 2)).toBe(2); // feeds between ISS and the place card
    expect(slotFor([1, 2], 0)).toBe(0); // frame rate always on top
    expect(slotFor([0, 1, 2], 3)).toBe(3);
  });

  it('keeps windows of the same order in the order they were added', () => {
    expect(slotFor([1, 1], 1)).toBe(2);
  });
});
