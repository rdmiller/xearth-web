// The time controls: a bar along the bottom, above the layer dock, to rewind, pause,
// fast-forward and step the clock, and get back to now. Each button runs the same hotkey
// as its key (as the dock's do), so behaviour and toasts can't drift apart.
//
// While the clock is live the bar comes and goes with the dock (mouse near the bottom, or
// the dock pinned); away from now it stays, so there's always a way back. Shift+C (or Time
// in the dock) keeps it on screen. Phones get a compact row: no step buttons (hold ⏪ / ⏩
// to step instead), and the date over the time.
//
// The date opens the picker (or Shift+G): a date and a time, in UTC or local time, presets
// (sunrise and sunset here, the next equinox or solstice, full and new moon), steps, and Go.
// A popover above the bar; on a phone, a sheet the bar's width.

import { createElement, FastForward, Pause, Play, Rewind, StepBack, StepForward, type IconNode } from 'lucide';
import { shortSpeed } from './hotkeys';
import { fromInputs, MAX_YEAR, MIN_YEAR, toInputs, type Moment } from './timePresets';

/** A hold on ⏪ / ⏩ turns into stepping after this long, then steps this often. */
export const HOLD_MS = 400;
export const HOLD_REPEAT_MS = 150;
/** Held this long, the steps grow from an hour to a day. */
export const HOLD_DAYS_AFTER_MS = 2000;

/** What a hold `heldMs` old steps by. */
export const holdStep = (heldMs: number): 'hour' | 'day' => (heldMs >= HOLD_DAYS_AFTER_MS ? 'day' : 'hour');

const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
const LONG_MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** Times show in UTC (as the readout) or the viewer's own time zone. */
export type Zone = 'utc' | 'local';

/** A moment's parts in a zone. */
function parts(d: Date, zone: Zone) {
  return zone === 'utc'
    ? { y: d.getUTCFullYear(), mo: d.getUTCMonth(), day: d.getUTCDate() }
    : { y: d.getFullYear(), mo: d.getMonth(), day: d.getDate() };
}

/** The bar's date: "2026-10-24", or on a phone "OCT 24 2026". */
export function barDate(d: Date, compact: boolean, zone: Zone = 'utc'): string {
  const { y, mo, day } = parts(d, zone);
  return compact ? `${MONTHS[mo]} ${day} ${y}` : toInputs(d, zone).date;
}

/** "14:32:07". */
export const barTime = (d: Date, zone: Zone = 'utc'): string => toInputs(d, zone).time;

/** "UTC", or the local zone's short name ("PDT", "GMT+2"). */
export function zoneName(d: Date, zone: Zone): string {
  if (zone === 'utc') return 'UTC';
  return new Intl.DateTimeFormat(undefined, { timeZoneName: 'short' }).formatToParts(d).find((p) => p.type === 'timeZoneName')?.value ?? 'local';
}

/** What a screen reader hears for the date: "Simulated time: 24 October 2026, 14:32:07 UTC". */
export function spokenTime(d: Date, zone: Zone = 'utc'): string {
  const { y, mo, day } = parts(d, zone);
  return `Simulated time: ${day} ${LONG_MONTHS[mo]} ${y}, ${barTime(d, zone)} ${zoneName(d, zone)}`;
}

/** The picker's presets, in its grid's order. */
export const PRESETS = [
  ['now', 'Now'],
  ['season', 'Equinox / solstice'],
  ['sunrise', 'Sunrise here'],
  ['sunset', 'Sunset here'],
  ['full', 'Full moon'],
  ['new', 'New moon'],
] as const;
export type PresetKey = (typeof PRESETS)[number][0];

/** The gap between the bar and the dock (or the dock's grip) below it, CSS px. */
const GAP_PX = 8;

export interface TransportHandlers {
  /** Run the hotkey bound to `key`. */
  run(key: string): void;
  /** The moment on screen. */
  now(): Date;
  /** The rate chip: real time from the moment shown. */
  realTime(): void;
  /** Show a moment, keeping the rate. */
  jumpTo(date: Date): void;
  /** Go to a preset; what it went to, or why it couldn't. */
  preset(key: PresetKey): Moment | string;
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
}

const PIN_KEY = 'xearth.transport.pinned';
const ZONE_KEY = 'xearth.time.zone';

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
  private readonly when: HTMLButtonElement;
  private readonly zoneText: HTMLElement;
  private readonly date: HTMLElement;
  private readonly time: HTMLElement;
  private readonly rate: HTMLButtonElement;
  /** The rate again, as a tag over ⏯ on a phone, where the chip doesn't fit. */
  private readonly tag: HTMLElement;
  private readonly nowBtn: HTMLButtonElement;
  private readonly nowText: HTMLElement;
  private state: TransportState = { speed: 1, live: true };
  private pinnedOpen = false;
  private dock = { shown: 0, grip: 0, full: 0 };
  private visible = false;
  private height = 0;
  private tick: ReturnType<typeof setTimeout> | undefined;
  private published = '';
  /** A press that stepped (or slid off), so the click that ends it does nothing more. */
  private swallowClick = false;
  private zone: Zone;
  /** The picker, built when first opened. */
  private picker?: Picker;

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

    // The date block, which opens the picker. Wide: one line, "2026-10-24 14:32:07 UTC", then
    // the rate chip. On a phone: the date over the time, and the rate as a tag over ⏯.
    this.when = button('t-when', '', [], (e) => this.togglePicker(e.detail === 0));
    this.when.setAttribute('aria-haspopup', 'dialog');
    this.when.setAttribute('aria-expanded', 'false');
    this.when.setAttribute('aria-controls', 'time-picker');
    this.when.title = 'Go to a date and time (Shift+G)';
    this.date = el('span', 't-date');
    this.time = el('span', 't-time');
    this.zoneText = el('span', 't-zone', 'UTC');
    const day = el('span', 't-day');
    day.append(this.date);
    const clock = el('span', 't-clock');
    clock.append(this.time, this.zoneText);
    this.when.append(day, clock);
    this.rate = button('t-rate', 'Real time', [], () => handlers.realTime());

    this.nowText = el('span', '', 'LIVE');
    this.nowBtn = button('t-now live', 'Live: showing now', [el('span', 'dot'), this.nowText], () => {
      if (!this.state.live) handlers.run('t');
    });

    root.append(back, rewind, this.play, forward, fwd, el('span', 't-sep'), this.when, this.rate, el('span', 't-sep'), this.nowBtn);
    // A long press would otherwise open Android's menu over the button.
    root.addEventListener('contextmenu', (e) => e.preventDefault());
    root.addEventListener('focusin', () => this.apply());
    root.addEventListener('focusout', () => queueMicrotask(() => this.apply()));

    // Local time by default on a phone, whose own date and time dialogs are local; UTC (as the
    // readout) elsewhere.
    let zone: string | null = null;
    try {
      this.pinnedOpen = localStorage.getItem(PIN_KEY) === '1';
      zone = localStorage.getItem(ZONE_KEY);
    } catch {
      // Storage blocked: start unpinned, in the default zone.
    }
    this.zone = zone === 'utc' || zone === 'local' ? zone : small.matches ? 'local' : 'utc';
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

  get pickerOpen() {
    return !!this.picker?.open;
  }

  /** Open the picker (`keyboard`: and put focus in it), or close it. */
  togglePicker(keyboard = false, open = !this.pickerOpen) {
    if (open) {
      this.picker ??= new Picker(this.root, this.when, this.handlers, {
        zone: () => this.zone,
        setZone: (z) => this.setZone(z),
        changed: () => this.apply(),
      });
      this.picker.show(keyboard);
    } else this.picker?.hide();
    this.apply();
  }

  private setZone(zone: Zone) {
    this.zone = zone;
    try {
      localStorage.setItem(ZONE_KEY, zone);
    } catch {
      // Storage blocked: just don't remember.
    }
    this.render();
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

  /** The clock's rate and whether it's live. Cheap to call every frame. */
  refresh(next: TransportState) {
    const s = this.state;
    if (s.speed === next.speed && s.live === next.live) return;
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
    this.apply();
    this.schedule();
  }

  /** Shown: away from now, pinned, with the dock, or while it has the keyboard. */
  private apply() {
    const { live } = this.state;
    const dockShown = this.dock.shown > 0;
    // Keyboard focus only: a click focuses its button too, and the bar should still go after.
    const focused = !!this.root.querySelector(':focus-visible');
    const picking = this.pickerOpen;
    const visible = !live || this.pinnedOpen || dockShown || focused || picking;
    this.root.classList.toggle('picking', picking);
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
    put(this.date, barDate(d, compact, this.zone));
    put(this.time, barTime(d, this.zone));
    put(this.zoneText, zoneName(d, this.zone));
    put(this.rate, shortSpeed(this.state.speed));
    put(this.tag, this.state.speed === 1 ? '' : shortSpeed(this.state.speed));
    this.rate.disabled = this.state.speed === 1;
    const spoken = `${spokenTime(d, this.zone)}. Change`;
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

interface PickerZone {
  zone(): Zone;
  setZone(zone: Zone): void;
  /** Opened or closed. */
  changed(): void;
}

/** "Full moon · 2026-10-26 04:12 UTC" */
const describe = (m: Moment, zone: Zone) => `${m.name} · ${barDate(m.date, false, zone)} ${barTime(m.date, zone).slice(0, 5)} ${zoneName(m.date, zone)}`;

/**
 * The time picker: the date and time inputs (the browser's own pickers: wheels on iOS, dialogs
 * on Android), UTC or local, presets, steps and Go. It sits inside the bar, so the bar stays
 * while it's open. Closes on Go, Escape, a press outside it, or a swipe down its handle.
 */
class Picker {
  readonly root: HTMLElement;
  open = false;
  private readonly date: HTMLInputElement;
  private readonly time: HTMLInputElement;
  private readonly zoneBtns: Record<Zone, HTMLButtonElement>;
  private readonly note: HTMLElement;
  private readonly go: HTMLButtonElement;

  constructor(
    bar: HTMLElement,
    private readonly opener: HTMLButtonElement,
    private readonly handlers: TransportHandlers,
    private readonly z: PickerZone,
  ) {
    this.root = el('div', 't-picker glass');
    this.root.id = 'time-picker';
    this.root.setAttribute('role', 'dialog');
    this.root.setAttribute('aria-label', 'Go to a date and time');
    this.root.hidden = true;

    const btn = (className: string, text: string, onClick: () => void, label?: string) => {
      const b = el('button', className, text);
      b.type = 'button';
      if (label) b.setAttribute('aria-label', label);
      b.addEventListener('click', onClick);
      return b;
    };

    // On a phone: a handle to swipe the sheet away (or tap).
    const handle = btn('t-handle', '', () => {}, 'Close');
    let downY: number | undefined;
    handle.addEventListener('pointerdown', (e) => (downY = e.clientY));
    handle.addEventListener('pointerup', (e) => {
      if (downY !== undefined && e.clientY - downY > -10) this.close();
      downY = undefined;
    });

    const head = el('div', 't-head');
    const title = el('span', 't-title', 'Go to');
    const zones = el('div', 't-zones');
    zones.setAttribute('role', 'group');
    zones.setAttribute('aria-label', 'Time zone');
    this.zoneBtns = {
      utc: btn('t-seg', 'UTC', () => this.setZone('utc')),
      local: btn('t-seg', 'Local', () => this.setZone('local')),
    };
    zones.append(this.zoneBtns.utc, this.zoneBtns.local);
    head.append(title, zones);

    const fields = el('div', 't-fields');
    this.date = Object.assign(document.createElement('input'), { type: 'date', className: 't-input', min: `${MIN_YEAR}-01-01`, max: `${MAX_YEAR}-12-31` });
    this.date.setAttribute('aria-label', 'Date');
    this.time = Object.assign(document.createElement('input'), { type: 'time', className: 't-input', step: '1' });
    this.time.setAttribute('aria-label', 'Time');
    for (const input of [this.date, this.time]) {
      input.addEventListener('input', () => this.validate());
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') this.submit();
      });
    }
    fields.append(this.date, this.time);

    const presets = el('div', 't-presets');
    for (const [key, label] of PRESETS) {
      presets.append(
        btn('t-preset', label, () => {
          const m = handlers.preset(key);
          if (typeof m === 'string') return this.say(m);
          this.fill();
          this.say(describe(m, this.z.zone()));
        }),
      );
    }

    // Steps, keeping the picker open: the inputs follow.
    const steps = el('div', 't-steps');
    for (const [text, key, label] of [
      ['−1 d', ':', 'Back a day'],
      ['−1 h', ';', 'Back an hour'],
      ['+1 h', "'", 'Forward an hour'],
      ['+1 d', '"', 'Forward a day'],
    ] as const) {
      steps.append(
        btn('t-stepbtn', text, () => {
          handlers.run(key);
          this.fill();
          this.say('');
        }, label),
      );
    }

    this.note = el('p', 't-note');
    this.note.setAttribute('role', 'status');
    this.go = btn('t-go', 'Go', () => this.submit());
    const foot = el('div', 't-foot');
    foot.append(this.note, this.go);

    this.root.append(handle, head, fields, presets, steps, foot);
    bar.append(this.root);

    // A press anywhere else closes it (the date block toggles it itself).
    document.addEventListener(
      'pointerdown',
      (e) => {
        if (this.open && e.target instanceof Node && !this.root.contains(e.target) && !this.opener.contains(e.target)) this.close();
      },
      true,
    );
    this.root.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      this.close();
      this.opener.focus();
    });
  }

  show(keyboard: boolean) {
    this.open = true;
    this.root.hidden = false;
    this.root.classList.add('shown');
    this.opener.setAttribute('aria-expanded', 'true');
    this.root.scrollTop = 0; // a short sheet opens at its top, Go in sight
    this.syncZone();
    this.fill();
    this.say('');
    // Only from the keyboard: on a phone, focusing the date would pop its wheel straight away.
    if (keyboard) this.date.focus();
  }

  hide() {
    if (!this.open) return;
    const hadFocus = this.root.contains(document.activeElement);
    this.open = false;
    this.root.hidden = true;
    this.root.classList.remove('shown');
    this.opener.setAttribute('aria-expanded', 'false');
    if (hadFocus) this.opener.focus();
  }

  private close() {
    this.hide();
    this.z.changed();
  }

  private setZone(zone: Zone) {
    // The same moment, in the other zone.
    const at = fromInputs(this.date.value, this.time.value, this.z.zone());
    this.z.setZone(zone);
    this.syncZone();
    this.fill(at ?? undefined);
  }

  private syncZone() {
    const zone = this.z.zone();
    for (const k of ['utc', 'local'] as const) this.zoneBtns[k].setAttribute('aria-pressed', String(k === zone));
  }

  /** The inputs from a moment (the one on screen by default). */
  private fill(at = this.handlers.now()) {
    const v = toInputs(at, this.z.zone());
    this.date.value = v.date;
    this.time.value = v.time;
    this.validate();
  }

  private validate(): Date | null {
    const at = fromInputs(this.date.value, this.time.value, this.z.zone());
    this.date.setAttribute('aria-invalid', String(!at));
    this.go.disabled = !at;
    return at;
  }

  private say(text: string) {
    this.note.textContent = text;
  }

  private submit() {
    const at = this.validate();
    if (!at) return this.say(`A date from ${MIN_YEAR} to ${MAX_YEAR}`);
    this.handlers.jumpTo(at);
    this.close();
  }
}
