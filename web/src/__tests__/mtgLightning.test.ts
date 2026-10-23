import { describe, expect, it } from 'vitest';
import { flashCount, frameCells, frameUrl, LI_RAMP, mergeCells, windowCells, windowTimes } from '../mtgLightning';

/** An RGBA image of `w`×`h`, transparent but for the given pixels. */
function image(w: number, h: number, px: { x: number; y: number; rgb: readonly number[] }[]) {
  const a = new Uint8ClampedArray(w * h * 4);
  for (const { x, y, rgb } of px) a.set([...rgb, 255], (y * w + x) * 4);
  return a;
}

describe('MTG Lightning Imager colours', () => {
  it('reads each legend colour back as its count', () => {
    LI_RAMP.forEach(([r, g, b], i) => expect(flashCount(r, g, b)).toBe(i + 1));
  });

  it('reads the colours seen in a real frame (2026-10-23) to the nearest count', () => {
    expect(flashCount(254, 249, 189)).toBe(1);
    expect(flashCount(254, 243, 173)).toBe(2);
    expect(flashCount(254, 213, 113)).toBe(6);
    expect(flashCount(177, 1, 38)).toBe(20); // the 20+ cap
  });
});

describe('frames to cells', () => {
  it('bins pixels into the GOES layer’s 0.1° cells, keeping each cell’s busiest pixel', () => {
    // 4×2 px of 0.05° over cells 100 and 101 (centred on 10.0° and 10.1°) in row 1 (0.1°N).
    const box = { lat0: 0.05, lat1: 0.15, lon0: 9.95, lon1: 10.15 };
    const px = image(4, 2, [
      { x: 0, y: 0, rgb: LI_RAMP[2] }, // 3
      { x: 1, y: 1, rgb: LI_RAMP[6] }, // 7, same cell: the cell takes 7, not 10
      { x: 3, y: 0, rgb: LI_RAMP[0] }, // 1
    ]);
    const cells = frameCells(px, 4, 2, box);
    expect(Object.fromEntries(cells)).toEqual({ '1,100': 7, '1,101': 1 });
  });

  it('sums a cell over the window and ages it by its newest frame', () => {
    const latest = '2026-10-23T00:50:00Z';
    const times = windowTimes(latest);
    expect(times).toEqual(['2026-10-23T00:50:00Z', '2026-10-23T00:45:00Z', '2026-10-23T00:40:00Z', '2026-10-23T00:35:00Z', '2026-10-23T00:30:00Z', '2026-10-23T00:25:00Z']);
    const data = windowCells(
      [
        { time: times[2], cells: new Map([['5,10', 4]]) },
        { time: times[4], cells: new Map([['5,10', 2], ['-3,7', 1]]) },
      ],
      latest,
    );
    const rows = [];
    for (let i = 0; i < data.length; i += 4) rows.push(data.slice(i, i + 4));
    expect(rows).toEqual(
      expect.arrayContaining([
        [5, 10, 6, 10],
        [-3, 7, 1, 20],
      ]),
    );
  });

  it('asks for the whole layer at 0.05° a pixel, as a transparent PNG', () => {
    const url = new URL(frameUrl('2026-10-23T00:50:00Z'));
    expect(url.searchParams.get('layers')).toBe('mtg_fd:li_afa');
    expect(url.searchParams.get('bbox')).toBe('-70,-70,70,70');
    expect([url.searchParams.get('width'), url.searchParams.get('height')]).toEqual(['2800', '2800']);
    expect(url.searchParams.get('transparent')).toBe('true');
  });
});

describe('GOES and MTG together', () => {
  it('takes the larger count and the newer age where both see a cell', () => {
    const goes = [5, 10, 12, 18, 1, 1, 3, 2];
    const mtg = [5, 10, 4, 6, 40, 20, 2, 0];
    const merged = mergeCells(goes, mtg);
    const rows = [];
    for (let i = 0; i < merged.length; i += 4) rows.push(merged.slice(i, i + 4));
    expect(rows).toEqual([
      [5, 10, 12, 6],
      [1, 1, 3, 2],
      [40, 20, 2, 0],
    ]);
  });
});
