// The layer drawer: a strip along the bottom with a toggle for every layer,
// grouped Earth / Sky / Hazards / Space / HUD. Each button runs the same
// hotkey as its key, so behaviour, toasts and multi-state cycles (stars,
// satellites, ISS telemetry) can't drift apart. Icons are Lucide's (ISC);
// aurora has no Lucide glyph, so it gets initials drawn in the same style.
//
// Opened and closed from its tab (or Shift+D); whether it's open is
// remembered per viewer.

import {
  Activity,
  AlignLeft,
  Cloud,
  createElement,
  Flame,
  Gauge,
  Grid3x3,
  Haze,
  Layers,
  Lightbulb,
  ListTree,
  MapPin,
  Radar,
  Rocket,
  Satellite,
  SatelliteDish,
  Snowflake,
  Sparkles,
  SunMoon,
  Tornado,
  TriangleAlert,
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
      { key: 'n', label: 'Lights', icon: Lightbulb, state: flag('lights') },
      { key: 'i', label: 'Snow', icon: Snowflake, state: flag('snow') },
      { key: 'shift+r', label: 'Radar', icon: Radar, state: flag('radar') },
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
    ],
  },
  {
    title: 'Hazards',
    items: [
      { key: 'w', label: 'Cyclones', icon: Tornado, state: flag('storms') },
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
      { key: 'm', label: 'Cities', icon: MapPin, state: flag('markers') },
      { key: 'l', label: 'Readout', icon: AlignLeft, state: flag('label') },
      { key: 'd', label: 'FPS', icon: Gauge, state: flag('fps') },
    ],
  },
];

const OPEN_KEY = 'xearth.drawer.open';

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
  /** The drawer opened, closed or changed height (CSS px covered at the bottom). */
  resized(inset: number): void;
}

export class Drawer {
  private readonly buttons: Button[] = [];
  private readonly body: HTMLElement;
  /** The satellite categories button, for the panel's aria-expanded. */
  satTreeButton: HTMLButtonElement | undefined;

  constructor(
    private readonly root: HTMLElement,
    private readonly handlers: DrawerHandlers,
  ) {
    const tab = document.createElement('button');
    tab.type = 'button';
    tab.className = 'drawer-tab';
    tab.setAttribute('aria-controls', 'drawer-body');
    tab.append(icon(Layers, 14), Object.assign(document.createElement('span'), { textContent: 'Layers' }));
    tab.addEventListener('click', () => this.toggle());

    this.body = document.createElement('div');
    this.body.id = 'drawer-body';
    this.body.className = 'drawer-body';
    this.body.setAttribute('role', 'toolbar');
    this.body.setAttribute('aria-label', 'Layers');
    for (const g of DRAWER) this.body.append(this.group(g));
    root.append(tab, this.body);

    let open = true;
    try {
      open = localStorage.getItem(OPEN_KEY) !== '0';
    } catch {
      // Storage blocked: start open.
    }
    this.toggle(open, false);
    new ResizeObserver(() => this.handlers.resized(this.inset)).observe(root);
  }

  private group(g: DrawerGroup): HTMLElement {
    const box = document.createElement('div');
    box.className = 'drawer-group';
    box.setAttribute('role', 'group');
    box.setAttribute('aria-label', g.title);
    const title = document.createElement('div');
    title.className = 'drawer-title';
    title.textContent = g.title;
    const row = document.createElement('div');
    row.className = 'drawer-row';
    for (const item of g.items) {
      const el = document.createElement('button');
      el.type = 'button';
      el.className = 'drawer-btn';
      el.title = `${item.label} (${this.handlers.keyLabel(item.key)})`;
      const glyph = typeof item.icon === 'string' ? Object.assign(document.createElement('span'), { className: 'initials', textContent: item.icon }) : icon(item.icon);
      const caption = Object.assign(document.createElement('span'), { className: 'caption', textContent: item.label });
      const tag = Object.assign(document.createElement('span'), { className: 'tag' });
      el.append(glyph, caption, tag);
      el.addEventListener('click', () => this.handlers.run(item.key));
      const cell = document.createElement('div');
      cell.className = 'drawer-cell';
      cell.append(el);
      if (item.extra) {
        const extra = document.createElement('button');
        extra.type = 'button';
        extra.className = 'drawer-extra';
        extra.title = `${item.extra.label} (Shift+O)`;
        extra.setAttribute('aria-label', item.extra.label);
        extra.append(icon(item.extra.icon, 14));
        extra.setAttribute('aria-controls', 'sat-tree');
        extra.setAttribute('aria-expanded', 'false');
        extra.addEventListener('click', () => this.handlers.openSatTree());
        cell.append(extra);
        this.satTreeButton = extra;
      }
      row.append(cell);
      this.buttons.push({ item, el, tag });
    }
    box.append(title, row);
    return box;
  }

  get open() {
    return this.root.classList.contains('open');
  }

  /** CSS px of screen the drawer (or just its tab) covers at the bottom. */
  get inset() {
    return Math.ceil(this.root.getBoundingClientRect().height);
  }

  toggle(open = !this.open, save = true) {
    this.root.classList.toggle('open', open);
    this.body.hidden = !open;
    (this.root.querySelector('.drawer-tab') as HTMLElement).setAttribute('aria-expanded', String(open));
    if (save) {
      try {
        localStorage.setItem(OPEN_KEY, open ? '1' : '0');
      } catch {
        // Storage blocked: just don't remember.
      }
    }
    this.handlers.resized(this.inset);
  }

  refresh(s: Settings) {
    for (const b of this.buttons) {
      const st = b.item.state(s);
      b.el.setAttribute('aria-pressed', String(st.on));
      b.tag.textContent = st.tag ?? '';
    }
  }
}
