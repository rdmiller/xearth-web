// The time controls: a bar along the bottom, above the layer dock, to rewind, pause,
// fast-forward and step the clock, and get back to now. Each button runs the same hotkey
// as its key (as the dock's do), so behaviour and toasts can't drift apart.
//
// While the clock is live the bar comes and goes with the dock (mouse near the bottom, or
// the dock pinned); away from now it stays, so there's always a way back. Shift+C (or Time
// in the dock) keeps it on screen. Phones get a compact row: no step buttons (hold ⏪ / ⏩
// to step instead), and the date over the time.

import { createElement, FastForward, Pause, Play, Rewind, StepBack, StepForward, TriangleAlert, type IconNode } from 'lucide';
import { shortSpeed } from './hotkeys';

/** A hold on ⏪ / ⏩ turns into stepping after this long, then steps this often. */
export const HOLD_MS = 400;
export const HOLD_REPEAT_MS = 150;
/** Held this long, the steps grow from an hour to a day. */
export const HOLD_DAYS_AFTER_MS = 2000;

/** What a hold `heldMs` old steps by. */
export const holdStep = (heldMs: number): 'hour' | 'day' => (heldMs >= HOLD_DAYS_AFTER_MS ? 'day' : 'hour');

const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
const LONG_MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** The bar's date: "2026-10-24", or on a phone "OCT 24 2026". UTC. */
export function barDate(d: Date, compact: boolean): string {
  const iso = d.toISOString();
  return compact ? `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()} ${d.getUTCFullYear()}` : iso.slice(0, 10);
}

/** "14:32:07", UTC. */
export const barTime = (d: Date): string => d.toISOString().slice(11, 19);

/** What a screen reader hears for the date: "Simulated time: 24 October 2026, 14:32:07 UTC". */
export const spokenTime = (d: Date): string =>
  `Simulated time: ${d.getUTCDate()} ${LONG_MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}, ${barTime(d)} UTC`;

/** The gap between the bar and the dock (or the dock's grip) below it, CSS px. */
const GAP_PX = 8;

export interface TransportHandlers {
  /** Run the hotkey bound to `key`. */
  run(key: string): void;
  /** The moment on screen. */
  now(): Date;
  /** The rate chip: real time from the moment shown. */
  realTime(): void;
  /** The hazards chip: why they're gone. */
  explainHazards(): void;
  /**
   * The bar's footprint changed. `top`: CSS px from the bottom to its top while it's shown, else
   * 0 (for the status toast); `full`: its top with the dock fully shown, whether or not it is
   * now (what panels anchor to, so they don't move); `reserved`: what labels keep out of, only
   * while it's on screen for good (pinned, or away from now), not for a passing reveal.
   */
  resized(top: number, full: number, reserved: number): void;
}

export interface TransportState {
  speed: number;
  live: boolean;
  /** A hazard layer that's on is faded (hazardFade.ts). */
  hazardsFaded: boolean;
}

const PIN_KEY = 'xearth.transport.pinned';

function icon(node: IconNode, size = 18): SVGElement {
  const svg = createElement(node);
  svg.setAttribute('width', String(size));
  svg.setAttribute('height', String(size));
  svg.setAttribute('stroke-width', '1.8');
  svg.setAttribute('aria-hidden', 'true');
  return svg;
}

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text = '') =>
  Object.assign(document.createElement(tag), { className, textContent: text });

/** Sets text only when it differs, so a steady bar costs no layout. */
function put(node: HTMLElement, text: string) {
  if (node.textContent !== text) node.textContent = text;
}

export class Transport {
  private readonly play: HTMLButtonElement;
  private readonly playIcons = { play: icon(Play), pause: icon(Pause) };
  private readonly when: HTMLElement;
  private readonly date: HTMLElement;
  private readonly time: HTMLElement;
  private readonly rate: HTMLButtonElement;
  /** The rate again, as a tag over ⏯ on a phone, where the chip doesn't fit. */
  private readonly tag: HTMLElement;
  private readonly warn: HTMLElement;
  private readonly hazard: HTMLButtonElement;
  private readonly nowBtn: HTMLButtonElement;
  private readonly nowText: HTMLElement;
  private state: TransportState = { speed: 1, live: true, hazardsFaded: false };
  private pinnedOpen = false;
  private dock = { shown: 0, grip: 0, full: 0 };
  private visible = false;
  private height = 0;
  private tick: ReturnType<typeof setTimeout> | undefined;
  private published = '';
  /** A press that stepped (or slid off), so the click that ends it does nothing more. */
  private swallowClick = false;

  constructor(
    private readonly root: HTMLElement,
    private readonly handlers: TransportHandlers,
    private readonly small: MediaQueryList,
  ) {
    const button = (className: string, label: string, content: Node[], onClick: (e: MouseEvent) => void) => {
      const b = el('button', className);
      b.type = 'button';
      b.title = label;
      b.setAttribute('aria-label', label);
      b.append(...content);
      b.addEventListener('click', (e) => {
        if (this.swallowClick) {
          this.swallowClick = false;
          return;
        }
        onClick(e);
      });
      return b;
    };
    // Shift steps a day, as on the keys (where Shift types : and ").
    const back = button('t-btn t-step', 'Back an hour (;) · Shift: a day', [icon(StepBack)], (e) => handlers.run(e.shiftKey ? ':' : ';'));
    const rewind = button('t-btn', 'Rewind (<) · hold to step back', [icon(Rewind)], () => handlers.run('<'));
    this.play = button('t-btn t-play', 'Pause (Space)', [this.playIcons.pause], () => handlers.run(' '));
    this.tag = el('span', 't-tag');
    this.tag.setAttribute('aria-hidden', 'true');
    const forward = button('t-btn', 'Fast-forward (>) · hold to step forward', [icon(FastForward)], () => handlers.run('>'));
    const fwd = button('t-btn t-step', 'Forward an hour (\') · Shift: a day', [icon(StepForward)], (e) => handlers.run(e.shiftKey ? '"' : "'"));
    this.holdToStep(rewind, -1);
    this.holdToStep(forward, 1);

    // The date block. Wide: one line, "2026-10-24 14:32:07 UTC", then the rate chip. On a phone:
    // the date over the time, and the rate as a tag over ⏯.
    this.when = el('div', 't-when');
    this.when.setAttribute('role', 'group');
    this.date = el('span', 't-date');
    this.time = el('span', 't-time');
    this.warn = el('span', 't-warn');
    this.warn.append(icon(TriangleAlert, 12));
    this.warn.hidden = true;
    this.rate = button('t-rate', 'Real time', [], () => handlers.realTime());
    const day = el('span', 't-day');
    day.append(this.date, this.rate);
    const clock = el('span', 't-clock');
    clock.append(this.warn, this.time, el('span', 't-zone', 'UTC'));
    this.when.append(day, clock);

    this.hazard = button('t-hazard', 'Hazards hidden: their data shows now', [icon(TriangleAlert, 14), el('span', '', 'HAZARDS HIDDEN')], () => handlers.explainHazards());
    this.hazard.hidden = true;
    this.nowText = el('span', '', 'LIVE');
    this.nowBtn = button('t-now live', 'Live: showing now', [el('span', 'dot'), this.nowText], () => {
      if (!this.state.live) handlers.run('t');
    });

    root.append(back, rewind, this.play, forward, fwd, el('span', 't-sep'), this.when, el('span', 't-sep'), this.hazard, this.nowBtn);
    // A long press would otherwise open Android's menu over the button.
    root.addEventListener('contextmenu', (e) => e.preventDefault());
    root.addEventListener('focusin', () => this.apply());
    root.addEventListener('focusout', () => queueMicrotask(() => this.apply()));

    try {
      this.pinnedOpen = localStorage.getItem(PIN_KEY) === '1';
    } catch {
      // Storage blocked: start unpinned.
    }
    new ResizeObserver(() => {
      this.height = root.offsetHeight;
      this.apply();
    }).observe(root);
    small.addEventListener('change', () => this.render());
    document.addEventListener('visibilitychange', () => this.schedule());
    this.apply();
  }

  /**
   * Press and hold: past HOLD_MS a tap turns into stepping, an hour at a time, then a day
   * after HOLD_DAYS_AFTER_MS, until the finger lifts or slides off.
   */
  private holdToStep(b: HTMLButtonElement, dir: 1 | -1) {
    let start = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const stop = () => {
      clearTimeout(timer);
      timer = undefined;
    };
    const step = () => {
      this.swallowClick = true;
      const day = holdStep(performance.now() - start) === 'day';
      this.handlers.run(dir > 0 ? (day ? '"' : "'") : day ? ':' : ';');
      timer = setTimeout(step, HOLD_REPEAT_MS);
    };
    b.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      this.swallowClick = false;
      start = performance.now();
      b.setPointerCapture(e.pointerId);
      stop();
      timer = setTimeout(step, HOLD_MS);
    });
    for (const type of ['pointerup', 'pointercancel', 'lostpointercapture'] as const) b.addEventListener(type, stop);
    // Sliding off the button (capture keeps the events here) stops the steps, and lets the
    // press go without a click, as a plain button would.
    b.addEventListener('pointermove', (e) => {
      if (!timer) return;
      const r = b.getBoundingClientRect();
      if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) {
        stop();
        this.swallowClick = true;
      }
    });
  }

  get pinned() {
    return this.pinnedOpen;
  }

  /** Keep the bar on screen, or let it come and go with the dock. */
  toggle(pin = !this.pinnedOpen): boolean {
    this.pinnedOpen = pin;
    try {
      localStorage.setItem(PIN_KEY, pin ? '1' : '0');
    } catch {
      // Storage blocked: just don't remember.
    }
    this.apply();
    return pin;
  }

  /** Where the dock is: CSS px from the bottom to its top while shown (else 0), its grip's top, and its top fully shown. */
  setDock(shown: number, grip: number, full: number) {
    if (shown === this.dock.shown && grip === this.dock.grip && full === this.dock.full) return;
    this.dock = { shown, grip, full };
    this.apply();
  }

  /** The clock's rate and whether it's live, and whether hazards are faded. Cheap to call every frame. */
  refresh(next: TransportState) {
    const s = this.state;
    if (s.speed === next.speed && s.live === next.live && s.hazardsFaded === next.hazardsFaded) return;
    this.state = next;
    const paused = next.speed === 0;
    this.play.replaceChildren(paused ? this.playIcons.play : this.playIcons.pause, this.tag);
    this.play.setAttribute('aria-pressed', String(paused));
    const playLabel = paused ? 'Play (Space)' : 'Pause (Space)';
    this.play.title = playLabel;
    this.play.setAttribute('aria-label', playLabel);
    this.nowBtn.classList.toggle('live', next.live);
    this.nowBtn.setAttribute('aria-disabled', String(next.live));
    const nowLabel = next.live ? 'Live: showing now' : 'Back to now (T)';
    this.nowBtn.title = nowLabel;
    this.nowBtn.setAttribute('aria-label', nowLabel);
    put(this.nowText, next.live ? 'LIVE' : 'NOW');
    this.hazard.hidden = !next.hazardsFaded;
    this.warn.hidden = !next.hazardsFaded;
    this.apply();
    this.schedule();
  }

  /** Shown: away from now, pinned, with the dock, or while it has the keyboard. */
  private apply() {
    const { live } = this.state;
    const dockShown = this.dock.shown > 0;
    // Keyboard focus only: a click focuses its button too, and the bar should still go after.
    const focused = !!this.root.querySelector(':focus-visible');
    const visible = !live || this.pinnedOpen || dockShown || focused;
    if (visible !== this.visible) {
      this.visible = visible;
      this.root.classList.toggle('shown', visible);
      // Hidden buttons can't be clicked or tabbed to by accident; the keyboard way in is Shift+C.
      this.root.inert = !visible;
      this.schedule();
    }
    const base = Math.max(this.dock.shown, this.dock.grip) + GAP_PX;
    this.root.style.bottom = `${base}px`;
    const top = visible ? base + this.height : 0;
    const full = Math.max(this.dock.full, this.dock.grip) + GAP_PX + this.height;
    const reserved = visible && (!live || this.pinnedOpen) ? top : 0;
    const key = `${top}|${full}|${reserved}`;
    if (key !== this.published) {
      this.published = key;
      this.handlers.resized(top, full, reserved);
    }
  }

  /** The date and time on the bar. */
  private render() {
    const d = this.handlers.now();
    const compact = this.small.matches;
    put(this.date, barDate(d, compact));
    put(this.time, barTime(d));
    put(this.rate, shortSpeed(this.state.speed));
    put(this.tag, this.state.speed === 1 ? '' : shortSpeed(this.state.speed));
    this.rate.disabled = this.state.speed === 1;
    const spoken = spokenTime(d);
    if (this.when.getAttribute('aria-label') !== spoken) this.when.setAttribute('aria-label', spoken);
  }

  /** Tick while shown: on each whole second at real time, four times a second when fast. */
  private schedule() {
    clearTimeout(this.tick);
    if (!this.visible || document.hidden) return;
    this.render();
    const { speed } = this.state;
    const ms = this.handlers.now().getTime();
    const delay = speed === 0 ? 1000 : speed === 1 ? 1000 - (((ms % 1000) + 1000) % 1000) + 5 : 250;
    this.tick = setTimeout(() => this.schedule(), delay);
  }
}
