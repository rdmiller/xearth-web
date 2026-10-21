import { describe, expect, it, vi } from 'vitest';
import { HOTKEYS, MAG_MAX, formatSpeed, helpRows, matchHotkey, nextSpeed, type HotkeyContext, type KeyLike } from '../hotkeys';
import { defaults, type Settings } from '../params';

function harness(initial: Partial<Settings> = {}) {
  let settings: Settings = { ...defaults(), lat: 20, lon: -75, ...initial };
  const ctx: HotkeyContext & { toasts: string[] } = {
    toasts: [],
    get settings() {
      return settings;
    },
    update: (patch) => {
      settings = { ...settings, ...patch };
    },
    viewer: () => ({ lat: 12, lon: 34 }),
    setSpeed: vi.fn((speed: number) => {
      settings = { ...settings, speed };
    }),
    goLive: vi.fn(() => {
      settings = { ...settings, speed: 1, time: null };
    }),
    previewLaunch: vi.fn(() => 'Falcon 9 · Starlink Group 15-15'),
    refreshClouds: vi.fn(),
    toggleFullscreen: vi.fn(),
    toggleHelp: vi.fn(),
    toggleSatTree: vi.fn(),
    toggleDrawer: vi.fn(),
    toast(m) {
      this.toasts.push(m);
    },
  };
  const press = (key: string, mods: Partial<KeyLike> = {}) => {
    const hk = matchHotkey({ key, ...mods });
    hk?.run(ctx, { key, ...mods });
    return hk;
  };
  return { ctx, press, get s() {
    return settings;
  } };
}

describe('matchHotkey', () => {
  it('is case-insensitive and leaves modifier chords to the browser', () => {
    expect(matchHotkey({ key: 'C' })?.description).toBe('Clouds');
    expect(matchHotkey({ key: 'c', ctrlKey: true })).toBeUndefined();
    expect(matchHotkey({ key: 'r', metaKey: true })).toBeUndefined(); // reload
    expect(matchHotkey({ key: '`' })).toBeUndefined(); // still unbound
  });

  it('uses a Shift binding when there is one, else the plain key', () => {
    expect(matchHotkey({ key: 'R', shiftKey: true })?.description).toBe('Weather radar (RainViewer)');
    expect(matchHotkey({ key: 'S', shiftKey: true })?.description).toBe('Smoke plumes (NOAA HMS)');
    expect(matchHotkey({ key: 'r' })?.description).toBe('Check for new clouds now');
    expect(matchHotkey({ key: 'C', shiftKey: true })?.description).toBe('Clouds');
    expect(matchHotkey({ key: '?', shiftKey: true })?.description).toBe('This help');
    expect(matchHotkey({ key: 'T', shiftKey: true })?.description).toBe('Tsunami alerts (NOAA)');
  });

  it('Shift+O opens the satellite panel; Esc closes it with help', () => {
    const h = harness();
    h.press('O', { shiftKey: true });
    expect(h.ctx.toggleSatTree).toHaveBeenCalledWith();
    h.press('Escape');
    expect(h.ctx.toggleSatTree).toHaveBeenLastCalledWith(false);
    expect(h.ctx.toggleHelp).toHaveBeenLastCalledWith(false);
  });

  it('O back on with nothing ticked in the tree ticks everything', () => {
    const h = harness({ sats: 'off', satshow: [] });
    h.press('o');
    expect(h.s.sats).toBe('all');
    expect(h.s.satshow.length).toBeGreaterThan(5);
  });

  it('tracking a named satellite ticks it in the tree', () => {
    const h = harness({ satshow: ['starlink'] });
    h.press('6');
    expect(h.s.satshow).toContain('iss');
  });

  it('Shift+L cycles ISS telemetry: while tracking → always → off', () => {
    const h = harness();
    const seen = [1, 2, 3].map(() => (h.press('L', { shiftKey: true }), h.s.isslive));
    expect(seen).toEqual(['on', 'off', 'track']);
  });

  it('ignores auto-repeat for toggles but not for pan/zoom', () => {
    expect(matchHotkey({ key: 'c', repeat: true })).toBeUndefined();
    expect(matchHotkey({ key: 'ArrowLeft', repeat: true })).toBeDefined();
    expect(matchHotkey({ key: '+', repeat: true })).toBeDefined();
  });

  it('never binds one key twice', () => {
    const keys = HOTKEYS.flatMap((h) => h.keys);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe('layer toggles', () => {
  it.each([
    ['c', 'clouds'],
    ['n', 'lights'],
    ['g', 'grid'],
    ['m', 'markers'],
    ['l', 'label'],
  ] as const)('%s toggles %s and says so', (key, field) => {
    const h = harness();
    const before = h.s[field];
    h.press(key);
    expect(h.s[field]).toBe(!before);
    expect(h.ctx.toasts.at(-1)).toMatch(before ? / off$/ : / on$/);
    h.press(key);
    expect(h.s[field]).toBe(before);
  });
});

describe('satellite keys', () => {
  it('O cycles all → named only → off', () => {
    const h = harness();
    const seen = [1, 2, 3].map(() => (h.press('o'), h.s.sats));
    expect(seen).toEqual(['featured', 'off', 'all']);
  });

  it('6/7/8 track the ISS, Tiangong and Mark Rober’s SAT GUS, turning satellites back on', () => {
    const h = harness({ sats: 'off' });
    h.press('8');
    expect(h.s).toMatchObject({ view: 'track', track: 'satgus', sats: 'featured' });
    expect(h.ctx.toasts.at(-1)).toMatch(/SAT GUS.*Mark Rober/);
    h.press('6');
    expect(h.s.track).toBe('iss');
    h.press('7');
    expect(h.s.track).toBe('tiangong');
  });

  it('arrows leave the track view for a fixed one where the satellite was', () => {
    const h = harness({ view: 'track', track: 'iss' });
    h.press('ArrowUp');
    expect(h.s).toMatchObject({ view: 'fixed', lat: 17, lon: 34 });
  });
});

describe('hazard keys', () => {
  it.each([
    ['a', 'aurora'],
    ['w', 'storms'],
    ['x', 'fires'],
    ['q', 'quakes'],
    ['z', 'lightning'],
    ['y', 'events'],
    ['i', 'snow'],
  ] as const)('%s toggles %s', (key, field) => {
    const h = harness();
    const before = h.s[field];
    h.press(key);
    expect(h.s[field]).toBe(!before);
  });
});

describe('launch keys', () => {
  it('U toggles launches; J follows the next launch, turning them back on', () => {
    const h = harness();
    h.press('u');
    expect(h.s.launches).toBe(false);
    h.press('j');
    expect(h.s).toMatchObject({ view: 'track', track: 'launch', launches: true });
  });

  it('K previews the next launch and says which', () => {
    const h = harness();
    h.press('k');
    expect(h.ctx.previewLaunch).toHaveBeenCalled();
    expect(h.ctx.toasts.at(-1)).toMatch(/Preview: Falcon 9 · Starlink Group 15-15/);
  });
});

describe('Sun and Moon keys', () => {
  it('B toggles them; E frames the Sun, then the Moon, turning them back on', () => {
    const h = harness();
    h.press('b');
    expect(h.s.bodies).toBe(false);
    h.press('e');
    expect(h.s).toMatchObject({ view: 'track', track: 'sunrise', bodies: true });
    h.press('e');
    expect(h.s.track).toBe('moonrise');
    h.press('e');
    expect(h.s.track).toBe('sunrise');
  });
});

describe('S cycles the star modes', () => {
  it('on → camera exposure → off → on', () => {
    const h = harness();
    const seen = [1, 2, 3].map(() => (h.press('s'), h.s.stars));
    expect(seen).toEqual(['photo', 'off', 'on']);
    expect(h.ctx.toasts).toEqual(['Stars: camera exposure', 'Stars off', 'Stars on']);
  });
});

describe('view keys', () => {
  it('1 freezes the view where it is; 2 faces the Sun; 3/4 switch mode', () => {
    const h = harness({ view: 'moon' });
    h.press('1');
    expect(h.s).toMatchObject({ view: 'fixed', lat: 12, lon: 34 });
    h.press('2');
    expect(h.s).toMatchObject({ view: 'sunrel', lat: 0, lon: 0 });
    h.press('3');
    expect(h.s.view).toBe('orbit');
    h.press('4');
    expect(h.s.view).toBe('moon');
  });

  it('5 puts the dusk line down the middle', () => {
    const h = harness();
    h.press('5');
    expect(h.s).toMatchObject({ view: 'sunrel', lat: 0, lon: 90 });
  });

  it('V cycles through the five modes', () => {
    const h = harness({ view: 'fixed' });
    const seen = [1, 2, 3, 4, 5].map(() => (h.press('v'), h.s.view));
    expect(seen).toEqual(['sunrel', 'orbit', 'moon', 'track', 'fixed']);
  });

  it('arrows move a fixed view, shift an offset in sunrel, and freeze orbit/moon first', () => {
    const fixed = harness({ view: 'fixed', lat: 0, lon: 178 });
    fixed.press('ArrowRight');
    expect(fixed.s.lon).toBe(-177); // wrapped
    fixed.press('ArrowUp', { shiftKey: true });
    expect(fixed.s.lat).toBe(15);

    const sun = harness({ view: 'sunrel', lat: 0, lon: 0 });
    sun.press('ArrowLeft');
    expect(sun.s).toMatchObject({ view: 'sunrel', lon: -5 });

    const moon = harness({ view: 'moon' });
    moon.press('ArrowDown');
    expect(moon.s).toMatchObject({ view: 'fixed', lat: 7, lon: 34 });
  });

  it('latitude stops at the poles', () => {
    const h = harness({ view: 'fixed', lat: 88 });
    h.press('ArrowUp', { shiftKey: true });
    expect(h.s.lat).toBe(90);
  });

  it('zoom is clamped; 0 resets zoom and rotation', () => {
    const h = harness();
    for (let i = 0; i < 30; i++) h.press('+');
    expect(h.s.mag).toBe(MAG_MAX);
    h.press(']');
    expect(h.s.rot).toBe(-15);
    h.press('0');
    expect(h.s).toMatchObject({ mag: 1, rot: 0 });
  });

  it('P toggles perspective', () => {
    const h = harness();
    h.press('p');
    expect(h.s.dist).toBe(3);
    h.press('p');
    expect(h.s.dist).toBe(0);
  });
});

describe('time keys', () => {
  it('Space pauses and resumes at the previous speed', () => {
    const h = harness({ speed: 60 });
    h.press(' ');
    expect(h.s.speed).toBe(0);
    h.press(' ');
    expect(h.s.speed).toBe(60);
  });

  it('. and , walk the speed ladder through pause into reverse', () => {
    const h = harness();
    h.press('.');
    expect(h.s.speed).toBe(10);
    h.press(',');
    h.press(',');
    expect(h.s.speed).toBe(0);
    h.press(',');
    expect(h.s.speed).toBe(-1);
  });

  it('T returns to now', () => {
    const h = harness({ speed: 600 });
    h.press('t');
    expect(h.ctx.goLive).toHaveBeenCalled();
    expect(h.s.speed).toBe(1);
  });
});

describe('helpers', () => {
  it('nextSpeed saturates at the ends', () => {
    expect(nextSpeed(86400, 1)).toBe(86400);
    expect(nextSpeed(-3600, -1)).toBe(-3600);
    expect(nextSpeed(30, 1)).toBe(60); // off-ladder values snap to the next rung
  });

  it('formatSpeed reads naturally', () => {
    expect(formatSpeed(0)).toBe('Paused');
    expect(formatSpeed(1)).toBe('Real time');
    expect(formatSpeed(60)).toBe('1 min per second');
    expect(formatSpeed(-3600)).toBe('Backwards, 1 h per second');
    expect(formatSpeed(86400)).toBe('1 day per second');
  });

  it('help lists every hotkey once, grouped', () => {
    const rows = helpRows().flatMap((g) => g.rows);
    expect(rows).toHaveLength(HOTKEYS.length);
    expect(helpRows().map((g) => g.group)).toEqual(['Layers', 'View', 'Time', 'App']);
  });
});
