import { describe, expect, it } from 'vitest';
import { DRAWER } from '../drawer';
import { HOTKEYS, hotkeyByKey } from '../hotkeys';
import { defaults } from '../params';

const items = DRAWER.flatMap((g) => g.items);

describe('layer drawer', () => {
  it('has a button for every layer hotkey, and every button runs a real hotkey', () => {
    const layerKeys = HOTKEYS.filter((h) => h.group === 'Layers' && h.keys[0] !== 'shift+o').map((h) => h.keys[0]);
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
  });

  it('uses library icons, with initials only where Lucide has nothing (aurora)', () => {
    expect(items.filter((i) => typeof i.icon === 'string').map((i) => i.label)).toEqual(['Aurora']);
  });
});
