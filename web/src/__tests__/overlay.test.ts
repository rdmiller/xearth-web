import { describe, expect, it } from 'vitest';
import { calloutRect, placeCallout, type Rect } from '../overlay';

const screen = { w: 800, h: 600 };

describe('placeCallout', () => {
  it('prefers the right, above the marker', () => {
    const taken: Rect[] = [];
    expect(placeCallout(400, 300, 60, taken, screen)).toBe('right');
    const r = taken[0];
    expect(r.x).toBeGreaterThan(400);
    expect(r.y + r.h).toBeLessThan(300);
  });

  it('flips left when the right is taken, and gives up when both are', () => {
    const taken: Rect[] = [calloutRect(400, 300, 60, 'right')];
    expect(placeCallout(400, 300, 60, taken, screen)).toBe('left');
    expect(placeCallout(400, 300, 60, taken, screen)).toBeNull();
  });

  it('never lets a label sit on another city’s marker', () => {
    const marker = { x: 445, y: 280, w: 10, h: 10 }; // right where the label would go
    expect(placeCallout(400, 300, 60, [marker], screen)).toBe('left');
  });

  it('flips left at the right edge of the screen', () => {
    expect(placeCallout(780, 300, 60, [], screen)).toBe('left');
  });

  it('drops the label rather than run it off the top', () => {
    expect(placeCallout(400, 10, 60, [], screen)).toBeNull();
  });

  it('keeps Paris readable beside London (the old overlap)', () => {
    // London 51.5N 0.1W and Paris 48.9N 2.4E sit ~20 px apart at default zoom.
    const taken: Rect[] = [
      { x: 395, y: 275, w: 10, h: 10 },
      { x: 412, y: 297, w: 10, h: 10 },
    ];
    const london = placeCallout(400, 280, 52, taken, screen);
    const paris = placeCallout(417, 302, 40, taken, screen);
    expect(london).not.toBeNull();
    expect(paris).not.toBeNull();
    const [a, b] = taken.slice(-2);
    const overlap = a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
    expect(overlap).toBe(false);
  });
});
