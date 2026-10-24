import { describe, expect, it } from 'vitest';
import { DRAWER, magnifyFor, revealFor, REVEAL_FULL_PX, REVEAL_START_PX } from '../drawer';
import { HAZARD_TREE } from '../hazardSources';
import { HOTKEYS, hotkeyByKey } from '../hotkeys';
import { defaults } from '../params';

const items = DRAWER.flatMap((g) => g.items);

describe('layer drawer', () => {
  it('has a button for every layer hotkey (the hazards: a row in their panel), and every button runs a real hotkey', () => {
    const inPanels = new Set(['shift+o', 'shift+z', ...HAZARD_TREE.map((n) => n.hotkey)]);
    expect([...inPanels].filter((k) => !hotkeyByKey(k))).toEqual([]);
    const layerKeys = HOTKEYS.filter((h) => h.group === 'Layers' && !inPanels.has(h.keys[0])).map((h) => h.keys[0]);
    const drawerKeys = items.map((i) => i.key);
    expect(drawerKeys.filter((k) => !hotkeyByKey(k))).toEqual([]);
    expect(layerKeys.filter((k) => !drawerKeys.includes(k))).toEqual([]);
    expect(new Set(drawerKeys).size).toBe(drawerKeys.length);
  });

  it('shows the default state, with tags for the in-between modes', () => {
    const s = defaults();
    const state = (key: string, over = {}) => items.find((i) => i.key === key)!.state({ ...s, ...over });
    expect(state('c')).toEqual({ on: true });
    expect(state('g')).toEqual({ on: false });
    expect(state('s', { stars: 'photo' })).toEqual({ on: true, tag: 'PHOTO' });
    expect(state('o', { sats: 'featured' })).toEqual({ on: true, tag: 'NAMED' });
    expect(state('o', { sats: 'off' })).toEqual({ on: false, tag: undefined });
    expect(state('shift+l')).toEqual({ on: true, tag: 'TRACK' });
    // Ash is off by default: seven of the eight hazards.
    expect(state('shift+x')).toEqual({ on: true, tag: '7/8' });
    expect(state('shift+x', { ash: true })).toEqual({ on: true, tag: undefined });
  });

  it('uses library icons, with initials only where Lucide has nothing (aurora)', () => {
    expect(items.filter((i) => typeof i.icon === 'string').map((i) => i.label)).toEqual(['Aurora']);
  });
});

describe('dock proximity', () => {
  it('fades in between REVEAL_START and REVEAL_FULL px from the bottom', () => {
    expect(revealFor(REVEAL_START_PX + 50)).toBe(0);
    expect(revealFor(REVEAL_START_PX)).toBe(0);
    expect(revealFor((REVEAL_START_PX + REVEAL_FULL_PX) / 2)).toBeCloseTo(0.5);
    expect(revealFor(REVEAL_FULL_PX)).toBe(1);
    expect(revealFor(0)).toBe(1);
  });

  it('magnifies the buttons nearest the pointer, easing out to their neighbours', () => {
    expect(magnifyFor(0)).toBeCloseTo(1.16);
    expect(magnifyFor(55)).toBeGreaterThan(1);
    expect(magnifyFor(55)).toBeLessThan(magnifyFor(20));
    expect(magnifyFor(-55)).toBeCloseTo(magnifyFor(55));
    expect(magnifyFor(200)).toBe(1);
  });
});
