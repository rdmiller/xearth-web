import { describe, expect, it } from 'vitest';
import { calloutRect, layoutSatLabels, placeCallout, type Rect } from '../overlay';

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

describe('layoutSatLabels', () => {
  const width = (t: string) => t.length * 6;
  const pt = (x: number, y: number, name: string) => ({ x, y, name, color: '#7dffa8' });

  it('moves a label to another side rather than dropping it', () => {
    const p = [pt(500, 300, 'GOES 19')];
    const right: Rect = { x: 505, y: 290, w: 100, h: 20 }; // e.g. a callout to its right
    expect(layoutSatLabels(p, [right], 1000, 600, width)[0].side).toBe('left');
    const sides: Rect = { x: 400, y: 294, w: 300, h: 10 }; // blocks left and right, not below
    expect(layoutSatLabels(p, [sides], 1000, 600, width)[0].side).toBe('below');
  });

  it('gives satellites a few pixels apart one shared label', () => {
    const out = layoutSatLabels([pt(500, 300, 'MTG-I2'), pt(503, 302, 'MTG-S1'), pt(800, 300, 'ELEKTRO-L 2')], [], 1000, 600, width);
    expect(out.map((l) => l.text)).toEqual(['MTG-I2 · MTG-S1', 'ELEKTRO-L 2']);
    const many = layoutSatLabels(['A', 'B', 'C', 'D'].map((n) => pt(100, 100, n)), [], 1000, 600, width);
    expect(many.map((l) => l.text)).toEqual(['A +3']);
  });

  it('keeps labels on screen and off reserved boxes', () => {
    const out = layoutSatLabels([pt(990, 300, 'GPS PRN 02')], [], 1000, 600, width);
    expect(out[0].side).toBe('left');
    const blocked: Rect[] = [{ x: 0, y: 0, w: 1000, h: 600 }];
    expect(layoutSatLabels([pt(500, 300, 'GPS PRN 02')], blocked, 1000, 600, width)).toEqual([]);
  });
});
