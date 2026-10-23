// The layer dock: floating buttons along the bottom, one per layer, grouped
// Earth / Sky / Hazards / Space / HUD. Each button runs the same hotkey as
// its key, so behaviour, toasts and multi-state cycles (stars, satellites,
// ISS telemetry) can't drift apart. Icons are Lucide's (ISC); aurora has no
// Lucide glyph, so it gets initials drawn in the same style.
//
// No panel: the buttons rise into view as the mouse nears the bottom of the
// window (the nearest grow a little, like a dock) and sink away when it
// leaves. A grip handle — the only way in on touch screens — pins them open,
// as does Shift+D; pinned or not is remembered per viewer. Keyboard focus
// inside the dock also keeps it shown.

import {
  Activity,
  AlignLeft,
  Cloud,
  createElement,
  Flame,
  Gauge,
  Grid3x3,
  Haze,
  Image as ImageIcon,
  Lightbulb,
  Mountain,
  ListTree,
  MapPin,
  Radar,
  Rocket,
  Satellite,
  Search,
  SatelliteDish,
  Snowflake,
  Sparkles,
  Sparkle,
  RadioTower,
  SunMoon,
  Timer,
  Tornado,
  TriangleAlert,
  CloudLightning,
  Waves,
  Zap,
  type IconNode,
} from 'lucide';
import type { Settings } from './params';

export interface DrawerItem {
  /** The hotkey this button runs ("c", "shift+r"). */
  key: string;
  label: string;
  /** A Lucide icon, or initials when the library has nothing fitting. */
  icon: IconNode | string;
  /** On, plus a small tag for the in-between states of cycling layers. */
  state(s: Settings): { on: boolean; tag?: string };
  /** A second, smaller button beside it (the satellite categories panel). */
  extra?: { icon: IconNode; label: string; action: 'satTree' };
  /** An action, not a layer: no on/off state. */
  momentary?: boolean;
}

export interface DrawerGroup {
  title: string;
  items: DrawerItem[];
}

const flag =
  (k: keyof Settings) =>
  (s: Settings): { on: boolean } => ({ on: !!s[k] });

export const DRAWER: DrawerGroup[] = [
  {
    title: 'Earth',
    items: [
      { key: 'c', label: 'Clouds', icon: Cloud, state: flag('clouds') },
      {
        key: 'shift+p',
        label: 'Imagery',
        icon: ImageIcon,
        state: (s) => ({ on: s.imagery !== 'painted', tag: s.imagery === 'live' ? 'LIVE' : s.imagery === 'daily' ? 'DAILY' : undefined }),
      },
      { key: 'shift+e', label: 'Terrain', icon: Mountain, state: flag('relief') },
      { key: 'n', label: 'Lights', icon: Lightbulb, state: flag('lights') },
      { key: 'i', label: 'Snow', icon: Snowflake, state: flag('snow') },
      { key: 'shift+r', label: 'Radar', icon: Radar, state: (s) => ({ on: s.radar, tag: s.radar && !s.imerg ? 'ONLY' : undefined }) },
      { key: 'shift+s', label: 'Smoke', icon: Haze, state: flag('smoke') },
      { key: 'g', label: 'Grid', icon: Grid3x3, state: flag('grid') },
    ],
  },
  {
    title: 'Sky',
    items: [
      { key: 's', label: 'Stars', icon: Sparkles, state: (s) => ({ on: s.stars !== 'off', tag: s.stars === 'photo' ? 'PHOTO' : undefined }) },
      { key: 'b', label: 'Sun·Moon', icon: SunMoon, state: flag('bodies') },
      { key: 'a', label: 'Aurora', icon: 'Au', state: flag('aurora') },
      { key: 'shift+m', label: 'Meteors', icon: Sparkle, state: flag('meteors') },
      {
        key: 'shift+i',
        label: 'Ionosphere',
        icon: RadioTower,
        state: (s) => ({ on: s.iono !== 'off', tag: s.iono === 'tec' ? 'TEC' : s.iono === 'drap' ? 'HF' : undefined }),
      },
    ],
  },
  {
    title: 'Hazards',
    items: [
      { key: 'w', label: 'Cyclones', icon: Tornado, state: flag('storms') },
      { key: 'shift+w', label: 'Severe', icon: CloudLightning, state: flag('severe') },
      { key: 'x', label: 'Fires', icon: Flame, state: flag('fires') },
      { key: 'q', label: 'Quakes', icon: Activity, state: flag('quakes') },
      { key: 'z', label: 'Lightning', icon: Zap, state: flag('lightning') },
      { key: 'y', label: 'Alerts', icon: TriangleAlert, state: flag('events') },
      { key: 'shift+t', label: 'Tsunami', icon: Waves, state: flag('tsunami') },
    ],
  },
  {
    title: 'Space',
    items: [
      {
        key: 'o',
        label: 'Satellites',
        icon: Satellite,
        state: (s) => ({ on: s.sats !== 'off', tag: s.sats === 'featured' ? 'NAMED' : undefined }),
        extra: { icon: ListTree, label: 'Satellite categories', action: 'satTree' },
      },
      { key: 'u', label: 'Launches', icon: Rocket, state: flag('launches') },
      { key: 'shift+l', label: 'ISS live', icon: SatelliteDish, state: (s) => ({ on: s.isslive !== 'off', tag: s.isslive === 'track' ? 'TRACK' : undefined }) },
    ],
  },
  {
    title: 'HUD',
    items: [
      { key: '/', label: 'Find', icon: Search, state: () => ({ on: false }), momentary: true },
      { key: 'm', label: 'Cities', icon: MapPin, state: flag('markers') },
      { key: 'l', label: 'Readout', icon: AlignLeft, state: flag('label') },
      { key: 'd', label: 'FPS', icon: Gauge, state: flag('fps') },
      { key: 'shift+u', label: 'Feeds', icon: Timer, state: flag('feeds') },
    ],
  },
];

/** The dock starts appearing this far (CSS px) from the bottom edge, and is fully shown at FULL. */
export const REVEAL_START_PX = 160;
export const REVEAL_FULL_PX = 90;
/** Buttons within this many px (horizontally) of the pointer grow, up to MAGNIFY. */
const MAGNIFY_RADIUS_PX = 110;
const MAGNIFY = 0.16;

/** How shown the dock is (0–1) with the pointer `fromBottom` px above the bottom edge. */
export function revealFor(fromBottom: number): number {
  return Math.max(0, Math.min(1, (REVEAL_START_PX - fromBottom) / (REVEAL_START_PX - REVEAL_FULL_PX)));
}

/** Dock-style magnification for a button `dx` px (horizontally) from the pointer. */
export function magnifyFor(dx: number): number {
  const t = Math.max(0, 1 - Math.abs(dx) / MAGNIFY_RADIUS_PX);
  return 1 + MAGNIFY * t * t * (3 - 2 * t); // smoothstep, so neighbours ease rather than jump
}

const PIN_KEY = 'xearth.dock.pinned';

function icon(node: IconNode, size = 20): SVGElement {
  const svg = createElement(node);
  svg.setAttribute('width', String(size));
  svg.setAttribute('height', String(size));
  svg.setAttribute('stroke-width', '1.6');
  svg.setAttribute('aria-hidden', 'true');
  return svg;
}

interface Button {
  item: DrawerItem;
  el: HTMLButtonElement;
  tag: HTMLElement;
}

export interface DrawerHandlers {
  /** Run the hotkey bound to `key`. */
  run(key: string): void;
  openSatTree(): void;
  /** Describe a key for tooltips ("Shift+R"). */
  keyLabel(key: string): string;
  /**
   * The dock's footprint changed. `shown`: CSS px it covers at the bottom right now (it rises
   * and sinks with the pointer — fine for toasts, which nobody clicks); `full`: px it covers
   * when fully shown, which only changes with the window size — what panels the pointer has
   * to reach anchor to, so they don't move as it approaches; `reserved`: px labels keep out
   * of — only while pinned, since a passing reveal just floats over the map.
   */
  resized(shown: number, reserved: number, full: number): void;
}

export class Drawer {
  private readonly buttons: Button[] = [];
  private readonly dock: HTMLElement;
  private readonly handle: HTMLButtonElement;
  private pinned = false;
  private reveal = 0;
  private pointer: { x: number; y: number } | null = null;
  private frame = 0;
  /** The satellite categories button, for the panel's aria-expanded. */
  satTreeButton: HTMLButtonElement | undefined;

  constructor(
    private readonly root: HTMLElement,
    private readonly handlers: DrawerHandlers,
  ) {
    this.handle = document.createElement('button');
    this.handle.type = 'button';
    this.handle.className = 'dock-handle';
    this.handle.setAttribute('aria-controls', 'dock');
    this.handle.setAttribute('aria-label', 'Layer buttons (Shift+D)');
    this.handle.title = 'Pin the layer buttons (Shift+D)';
    this.handle.append(Object.assign(document.createElement('span'), { className: 'grip' }));
    this.handle.addEventListener('click', () => this.toggle());

    this.dock = document.createElement('div');
    this.dock.id = 'dock';
    this.dock.className = 'dock';
    this.dock.setAttribute('role', 'toolbar');
    this.dock.setAttribute('aria-label', 'Layers');
    for (const g of DRAWER) this.dock.append(this.group(g));
    root.append(this.dock, this.handle);

    try {
      this.pinned = localStorage.getItem(PIN_KEY) === '1';
    } catch {
      // Storage blocked: start unpinned.
    }

    // Mouse (and pen) proximity. Touch has no hover, so it goes through the handle.
    window.addEventListener('pointermove', (e) => {
      if (e.pointerType === 'touch') return;
      this.pointer = { x: e.clientX, y: e.clientY };
      this.schedule();
    });
    document.documentElement.addEventListener('pointerleave', () => {
      this.pointer = null;
      this.schedule();
    });
    window.addEventListener('blur', () => {
      this.pointer = null;
      this.schedule();
    });
    this.dock.addEventListener('focusin', () => this.schedule());
    this.dock.addEventListener('focusout', () => this.schedule());
    window.addEventListener('resize', () => this.schedule());
    this.apply();
  }

  private group(g: DrawerGroup): HTMLElement {
    const box = document.createElement('div');
    box.className = 'dock-group';
    box.setAttribute('role', 'group');
    box.setAttribute('aria-label', g.title);
    for (const item of g.items) {
      const el = document.createElement('button');
      el.type = 'button';
      el.className = 'dock-btn';
      el.title = `${item.label} (${this.handlers.keyLabel(item.key)})`;
      el.setAttribute('aria-label', item.label);
      const glyph =
        typeof item.icon === 'string'
          ? Object.assign(document.createElement('span'), { className: 'initials', textContent: item.icon })
          : icon(item.icon);
      const caption = Object.assign(document.createElement('span'), { className: 'caption', textContent: item.label });
      caption.setAttribute('aria-hidden', 'true');
      const tag = Object.assign(document.createElement('span'), { className: 'tag' });
      el.append(glyph, caption, tag);
      el.addEventListener('click', () => this.handlers.run(item.key));
      const cell = document.createElement('div');
      cell.className = 'dock-cell';
      cell.append(el);
      if (item.extra) {
        const extra = document.createElement('button');
        extra.type = 'button';
        extra.className = 'dock-extra';
        extra.title = `${item.extra.label} (Shift+O)`;
        extra.setAttribute('aria-label', item.extra.label);
        extra.setAttribute('aria-controls', 'sat-tree');
        extra.setAttribute('aria-expanded', 'false');
        extra.append(icon(item.extra.icon, 12));
        extra.addEventListener('click', () => this.handlers.openSatTree());
        cell.append(extra);
        this.satTreeButton = extra;
      }
      box.append(cell);
      this.buttons.push({ item, el, tag });
    }
    return box;
  }

  private schedule() {
    this.frame ||= requestAnimationFrame(() => {
      this.frame = 0;
      this.apply();
    });
  }

  /** Work out how shown the dock is, and size the buttons near the pointer. */
  private apply() {
    const h = window.innerHeight;
    const near = this.pointer ? revealFor(h - this.pointer.y) : 0;
    const focused = this.dock.contains(document.activeElement);
    this.reveal = this.pinned || focused ? 1 : near;
    const shown = this.reveal > 0.02;
    this.root.style.setProperty('--reveal', this.reveal.toFixed(3));
    this.root.classList.toggle('shown', shown);
    this.root.classList.toggle('pinned', this.pinned);
    // Hidden buttons can't be clicked or tabbed to by accident; the keyboard way in is Shift+D.
    this.dock.inert = !shown;
    this.handle.setAttribute('aria-expanded', String(this.pinned));

    const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
    for (const b of this.buttons) {
      let scale = 1;
      if (this.pointer && !reduce && this.reveal > 0.5) {
        const r = b.el.getBoundingClientRect();
        scale = magnifyFor(this.pointer.x - (r.left + r.width / 2));
      }
      b.el.style.setProperty('--mag', scale.toFixed(3));
    }

    const dockTop = Math.ceil(h - this.dock.getBoundingClientRect().top);
    // Layout height, which the reveal's transform doesn't change: the dock fully shown.
    const full = Math.ceil(this.root.offsetHeight + parseFloat(getComputedStyle(this.root).bottom || '0'));
    this.handlers.resized(shown ? dockTop : 0, this.pinned ? full : 0, full);
  }

  get open() {
    return this.pinned;
  }

  /** Pin the dock open, or unpin it (it then follows the mouse again). */
  toggle(pin = !this.pinned) {
    this.pinned = pin;
    try {
      localStorage.setItem(PIN_KEY, pin ? '1' : '0');
    } catch {
      // Storage blocked: just don't remember.
    }
    this.apply();
  }

  refresh(s: Settings) {
    for (const b of this.buttons) {
      const st = b.item.state(s);
      if (b.item.momentary) b.el.removeAttribute('aria-pressed');
      else b.el.setAttribute('aria-pressed', String(st.on));
      b.tag.textContent = st.tag ?? '';
    }
  }
}
