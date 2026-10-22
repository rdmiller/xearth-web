import { describe, expect, it, vi } from 'vitest';
import { CloudSync, type CloudManifest } from '../cloudSync';
import { cloudNote, wrapValue } from '../overlay';

// Same naming as the pipeline (`clouds-20261021T1500Z.webp`): no colons, which
// `new URL` would otherwise read as a scheme.
const manifest = (t: string, url = `clouds-${t.replace(/[-:]/g, '').slice(0, 13)}Z.webp`): CloudManifest => ({
  t,
  url,
  width: 4096,
  height: 2048,
  source: 'test',
  coverage: [-72.7, 72.7],
});

describe('CloudSync', () => {
  it('loads a new map, skips an unchanged one, and resolves image URLs against latest.json', async () => {
    let current = manifest('2026-10-21T15:00:00Z');
    const loadImage = vi.fn(async (url: string) => url);
    const onImage = vi.fn();
    const sync = new CloudSync('https://example.test/app/clouds/', { fetchJson: async () => current, loadImage }, onImage);

    expect(await sync.check()).toBe(true);
    expect(loadImage).toHaveBeenLastCalledWith('https://example.test/app/clouds/clouds-20261021T1500Z.webp');
    expect(await sync.check()).toBe(false);
    expect(loadImage).toHaveBeenCalledTimes(1);

    current = manifest('2026-10-21T16:00:00Z');
    expect(await sync.check()).toBe(true);
    expect(onImage).toHaveBeenCalledTimes(2);
  });

  it('reports errors without losing the map already shown', async () => {
    let fail = false;
    const sync = new CloudSync(
      'https://example.test/',
      {
        fetchJson: async () => {
          if (fail) throw new Error('offline');
          return manifest('2026-10-21T15:00:00Z');
        },
        loadImage: async () => 'img',
      },
      () => {},
    );
    await sync.check();
    fail = true;
    expect(await sync.check()).toBe(false);
    expect(sync.status).toMatchObject({ state: 'error', message: 'offline', manifest: { t: '2026-10-21T15:00:00Z' } });
  });

  it('rejects something that is not a manifest', async () => {
    const sync = new CloudSync('https://example.test/', { fetchJson: async () => ({ hello: 1 }), loadImage: async () => 'x' }, () => {});
    await sync.check();
    expect(sync.status.state).toBe('error');
  });

  it('shares one in-flight check between concurrent callers', async () => {
    const fetchJson = vi.fn(async () => manifest('2026-10-21T15:00:00Z'));
    const sync = new CloudSync('https://example.test/', { fetchJson, loadImage: async () => 'x' }, () => {});
    await Promise.all([sync.check(), sync.check(), sync.check()]);
    expect(fetchJson).toHaveBeenCalledTimes(1);
  });
});

describe('cloud status in the readout', () => {
  const now = new Date('2026-10-21T16:24:00Z');
  it('speaks up only while there are no clouds to show (their times are in the feeds window)', () => {
    const m = manifest('2026-10-21T15:00:00Z');
    expect(cloudNote({ state: 'idle' }, true)).toBe('loading…');
    expect(cloudNote({ state: 'error', message: 'x' }, true)).toBe('unavailable');
    expect(cloudNote({ state: 'ok', manifest: m, checkedAt: now }, true)).toBeUndefined();
    expect(cloudNote({ state: 'error', message: 'x', manifest: m }, true)).toBeUndefined(); // still showing the last map
    expect(cloudNote({ state: 'idle' }, false)).toBeUndefined();
  });
});

describe('readout wrapping', () => {
  const measure = (t: string) => t.length * 10; // 10 px a character
  it('fills each line up to the width, breaking only at the separators', () => {
    expect(wrapValue('Kp 4.0 · X-ray B5.8 · wind 463 km/s · Bz 0 nT', 240, measure)).toEqual(['Kp 4.0 · X-ray B5.8', 'wind 463 km/s · Bz 0 nT']);
    expect(wrapValue('peak 36 %', 200, measure)).toEqual(['peak 36 %']);
  });

  it('gives an over-long part a line of its own rather than cutting it', () => {
    expect(wrapValue('Long March 6A · Unknown Payload Name Here · T−1d', 100, measure)).toEqual(['Long March 6A', 'Unknown Payload Name Here', 'T−1d']);
  });
});
