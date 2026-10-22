import { describe, expect, it } from 'vitest';
import { blendLand, dayTextureUrl, nightTextureUrl, reliefUrl } from '../textures';

describe('texture urls', () => {
  const oct = new Date(Date.UTC(2026, 9, 22));

  it('picks the month’s Blue Marble, shaded or plain', () => {
    expect(dayTextureUrl('/x/', oct)).toBe('/x/textures/day-10.jpg');
    expect(dayTextureUrl('/x/', oct, true)).toBe('/x/textures/surface-10.jpg');
    expect(dayTextureUrl('https://data.example/', new Date(Date.UTC(2026, 0, 31, 23)), true)).toBe('https://data.example/textures/surface-01.jpg');
  });

  it('serves the relief map with the app and the rest with the data', () => {
    expect(reliefUrl('/xearth-web/')).toBe('/xearth-web/relief.webp');
    expect(nightTextureUrl('/x/')).toBe('/x/textures/night.jpg');
  });
});

describe('blendLand', () => {
  it('takes land from the plain image and water from the shaded one', () => {
    const plain = new Uint8ClampedArray([201, 169, 118, 255, 2, 5, 20, 255, 100, 100, 100, 255]);
    const shaded = new Uint8ClampedArray([190, 160, 110, 255, 13, 36, 78, 255, 0, 0, 0, 255]);
    const mask = new Uint8ClampedArray([127, 127, 255, 255, 128, 128, 0, 255, 128, 128, 51, 255]);
    blendLand(plain, shaded, mask);
    expect([...plain.slice(0, 8)]).toEqual([201, 169, 118, 255, 13, 36, 78, 255]);
    expect([...plain.slice(8)]).toEqual([20, 20, 20, 255]); // a coast texel, 20 % land
  });
});
