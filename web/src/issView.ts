// The ISS telemetry window: instruments, not rows of text.
//
//   ORBIT    two stat tiles, altitude and speed, each with its change and a sparkline of the
//            last 15 minutes (hover one to read off any point), then how far the TLE
//            prediction sits from the telemetry
//   CABIN    meters for pressure, temperature, O2, CO2 and gyroscope momentum, each marking
//            its normal band and coloured by where the value sits (cyan, amber, red)
//   ARRAYS   dials for the Sun's beta angle and the two solar array joints
//   CAMERA   at the user's say-so, the view from 120 m above the station looking straight down
//            past it, travel at the top: the globe's layers and NASA's model of the station,
//            its arrays posed from the telemetry (the wheel zooms it)
//
// Values only change about once a second, so the DOM is built once and touched only when a
// reading moves. While the station is out of signal, the instruments dim: the values are
// the last ones received, and the header says how old.
//
// While the ISS is the thing clicked, the instruments move into its pick window (pickView.ts)
// instead, so there's one window for it, not two; the signal chip goes with them.

import { arcPath, fraction, polar, Series, severity, sparkPath, sparkScale, wrap360, type MeterScale } from './gauges';
import type { IssReadings } from './isslive';
import type { Toast } from './toasts';

const SVG = 'http://www.w3.org/2000/svg';
const MIN = 60_000;
/** Sparklines: 15 minutes (about a sixth of an orbit), a sample every 2 s. */
const SPAN_MS = 15 * MIN;
const SAMPLE_MS = 2000;
const SPARK_W = 132;
const SPARK_H = 26;

/**
 * Display bands, approximate and for reading at a glance — not flight rules. Cabin values
 * follow NASA's published ISS atmosphere norms (about 14.7 psi, 18–27 °C, ppO2 2.8–3.4 psi,
 * ppCO2 kept under ~3 mmHg); gyroscope momentum nears saturation towards 100 %.
 */
const METERS: { key: keyof IssReadings; label: string; unit: string; digits: number; scale: MeterScale }[] = [
  { key: 'cabinPsi', label: 'Pressure', unit: 'psi', digits: 2, scale: { min: 13.5, max: 15.5, ok: [14.2, 14.9], warn: [13.9, 15.2] } },
  { key: 'cabinTempC', label: 'Temp', unit: '°C', digits: 1, scale: { min: 14, max: 32, ok: [18, 27], warn: [16, 29] } },
  { key: 'o2Psi', label: 'O₂', unit: 'psi', digits: 2, scale: { min: 2.4, max: 3.8, ok: [2.8, 3.4], warn: [2.6, 3.6] } },
  { key: 'co2MmHg', label: 'CO₂', unit: 'mmHg', digits: 1, scale: { min: 0, max: 6, ok: [0, 3], warn: [0, 4] } },
  { key: 'cmgPct', label: 'CMG mom.', unit: '%', digits: 0, scale: { min: 0, max: 100, ok: [0, 70], warn: [0, 90] } },
];

export const el = <K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text = '') =>
  Object.assign(document.createElement(tag), { className, textContent: text });

export function svg<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number> = {}): SVGElementTagNameMap[K] {
  const node = document.createElementNS(SVG, tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
  return node;
}

export function put(node: Element, text: string) {
  if (node.textContent !== text) node.textContent = text;
}

export function attr(node: Element, name: string, value: string) {
  if (node.getAttribute(name) !== value) node.setAttribute(name, value);
}

/** An instrument's name. Labels are set in capitals, but a Greek letter keeps its case (β, not Β). */
export function label(text: string): HTMLElement {
  const node = el('span', 'iss-label');
  for (const part of text.split(/([Ͱ-Ͽ])/)) {
    if (/^[Ͱ-Ͽ]$/.test(part)) node.append(el('span', 'greek', part));
    else if (part) node.append(document.createTextNode(part));
  }
  return node;
}

/** How long ago a sample was: seconds while recent, then minutes. */
const ago = (ms: number) => (ms < 90_000 ? `${Math.max(0, Math.round(ms / 1000))} s ago` : `${Math.round(ms / MIN)} min ago`);

const signed = (x: number, digits: number) => `${x >= 0 ? '+' : '−'}${Math.abs(x).toFixed(digits)}`;

/** A stat tile: label, value, change over the window, and a sparkline you can read with the pointer. */
class SparkTile {
  readonly el: HTMLElement;
  private readonly value: HTMLElement;
  private readonly delta: HTMLElement;
  private readonly line: SVGPathElement;
  private readonly dot: SVGCircleElement;
  private readonly cross: SVGLineElement;
  private readonly series = new Series(SPAN_MS, SAMPLE_MS);
  private hover: number | undefined;
  private current = '';

  constructor(
    name: string,
    /** The value as shown, and the change over the window as shown. */
    private readonly format: (v: number) => string,
    private readonly formatChange: (d: number) => string,
    /** The smallest vertical span drawn, in the reading's units (keeps noise flat). */
    private readonly minSpan: number,
  ) {
    this.el = el('div', 'iss-tile');
    const head = el('div', 'iss-tile-head');
    head.append(label(name), (this.delta = el('span', 'iss-delta')));
    this.value = el('div', 'iss-value', '—');
    const plot = svg('svg', { class: 'iss-spark', viewBox: `0 0 ${SPARK_W} ${SPARK_H}`, preserveAspectRatio: 'none', 'aria-hidden': 'true' });
    this.line = svg('path', { class: 'spark-line' });
    this.cross = svg('line', { class: 'spark-cross', y1: 0, y2: SPARK_H, visibility: 'hidden' });
    this.dot = svg('circle', { class: 'spark-dot', r: 2.5, visibility: 'hidden' });
    plot.append(this.line, this.cross, this.dot);
    // Hover: read off the sample under the pointer (the hit area is the whole plot).
    plot.addEventListener('pointermove', (e) => {
      const r = plot.getBoundingClientRect();
      this.hover = r.width ? (e.clientX - r.left) / r.width : undefined;
      this.draw(Date.now());
    });
    plot.addEventListener('pointerleave', () => {
      this.hover = undefined;
      this.draw(Date.now());
    });
    this.el.append(head, this.value, plot);
  }

  update(v: number | undefined, now: number) {
    if (v !== undefined && this.series.push(now, v)) this.draw(now);
    else if (v === undefined && this.current !== '—') this.draw(now);
  }

  private draw(now: number) {
    const values = this.series.values;
    const latest = values[values.length - 1];
    attr(this.line, 'd', sparkPath(values, SPARK_W, SPARK_H, this.minSpan));
    const pick = this.hover !== undefined ? this.series.at(this.hover) : undefined;
    if (pick) {
      // The point under the pointer: its value, and how long ago.
      const i = this.series.times.indexOf(pick.t);
      const [x, y] = this.pointAt(i);
      attr(this.cross, 'x1', x.toFixed(1));
      attr(this.cross, 'x2', x.toFixed(1));
      attr(this.dot, 'cx', x.toFixed(1));
      attr(this.dot, 'cy', y.toFixed(1));
      attr(this.cross, 'visibility', 'visible');
      put(this.value, this.format(pick.v));
      put(this.delta, ago(now - pick.t));
      this.current = 'hover';
      return;
    }
    attr(this.cross, 'visibility', 'hidden');
    if (latest === undefined) {
      attr(this.dot, 'visibility', 'hidden');
      put(this.value, '—');
      put(this.delta, '');
      this.current = '—';
      return;
    }
    // The newest point in the accent, like a stat tile's current period.
    const [x, y] = this.pointAt(values.length - 1);
    attr(this.dot, 'cx', x.toFixed(1));
    attr(this.dot, 'cy', y.toFixed(1));
    attr(this.dot, 'visibility', 'visible');
    put(this.value, this.format(latest));
    const change = this.series.change;
    const mins = Math.round((this.series.times[this.series.times.length - 1] - this.series.times[0]) / MIN);
    put(this.delta, change !== undefined && mins > 0 ? `${this.formatChange(change)} / ${mins} min` : '');
    this.current = 'latest';
  }

  /** Where sample i sits on the plot (the same scales as the line). */
  private pointAt(i: number): [number, number] {
    const values = this.series.values;
    const { x, y } = sparkScale(values, SPARK_W, SPARK_H, this.minSpan);
    return [x(i), y(values[i])];
  }
}

/** A meter: label, a bar on its track with the normal band marked, the value. */
class Meter {
  readonly el: HTMLElement;
  private readonly fill: HTMLElement;
  private readonly value: HTMLElement;

  constructor(private readonly spec: (typeof METERS)[number]) {
    this.el = el('div', 'iss-meter');
    const track = el('span', 'meter-track');
    const { min, max, ok } = spec.scale;
    // The normal band, as a lighter stretch of the track.
    const band = el('span', 'meter-band');
    band.style.left = `${fraction(ok[0], min, max) * 100}%`;
    band.style.width = `${(fraction(ok[1], min, max) - fraction(ok[0], min, max)) * 100}%`;
    this.fill = el('span', 'meter-fill');
    track.append(band, this.fill);
    track.title = `Normal ${ok[0]}–${ok[1]} ${spec.unit} (approximate)`;
    this.value = el('span', 'iss-meter-value', '—');
    this.el.append(label(spec.label), track, this.value);
  }

  update(r: IssReadings) {
    const v = r[this.spec.key] as number | undefined;
    if (v === undefined) {
      put(this.value, '—');
      this.fill.style.width = '0%';
      return;
    }
    const { min, max } = this.spec.scale;
    const width = `${(fraction(v, min, max) * 100).toFixed(1)}%`;
    if (this.fill.style.width !== width) this.fill.style.width = width;
    const sev = severity(v, this.spec.scale);
    if (this.el.dataset.sev !== sev) this.el.dataset.sev = sev;
    put(this.value, `${v.toFixed(this.spec.digits)} ${this.spec.unit}`);
  }
}

/** A dial for an angle: a semicircle for beta (±75°), a full turn for a rotary joint (or a compass bearing). */
export class Dial {
  readonly el: HTMLElement;
  private readonly needle: SVGLineElement;
  private readonly value: HTMLElement;
  /** The needle's turn, unwrapped, so a joint going past 360° moves on rather than spinning back. */
  private turn: number | undefined;

  constructor(
    name: string,
    private readonly kind: 'beta' | 'joint',
  ) {
    this.el = el('div', 'iss-dial');
    const face = svg('svg', { viewBox: '0 0 48 48', width: 48, height: 48, 'aria-hidden': 'true' });
    if (kind === 'beta') {
      // −75° … +75° across the top of the dial, 0 (Sun in the orbit plane) straight up.
      face.append(svg('path', { class: 'dial-track', d: arcPath(24, 28, 18, -90, 90) }));
      for (const deg of [-75, 0, 75]) {
        const [x0, y0] = polar(24, 28, 15, (deg * 90) / 75);
        const [x1, y1] = polar(24, 28, 21, (deg * 90) / 75);
        face.append(svg('line', { class: 'dial-tick', x1: x0, y1: y0, x2: x1, y2: y1 }));
      }
    } else {
      face.append(svg('circle', { class: 'dial-track', cx: 24, cy: 24, r: 18 }));
      const [x0, y0] = polar(24, 24, 15, 0);
      const [x1, y1] = polar(24, 24, 21, 0);
      face.append(svg('line', { class: 'dial-tick', x1: x0, y1: y0, x2: x1, y2: y1 }));
    }
    const cy = kind === 'beta' ? 28 : 24;
    this.needle = svg('line', { class: 'dial-needle', x1: 24, y1: cy, x2: 24, y2: cy - 16 });
    // Turned with CSS (not the transform attribute), so a new reading glides there.
    this.needle.style.transformOrigin = `24px ${cy}px`;
    face.append(this.needle, svg('circle', { class: 'dial-hub', cx: 24, cy, r: 2 }));
    this.value = el('span', 'iss-dial-value', '—');
    this.el.append(face, this.value, label(name));
  }

  update(deg: number | undefined) {
    if (deg === undefined) {
      put(this.value, '—');
      return attr(this.needle, 'visibility', 'hidden');
    }
    attr(this.needle, 'visibility', 'visible');
    const target = this.kind === 'beta' ? (Math.max(-75, Math.min(75, deg)) * 90) / 75 : wrap360(deg);
    // Joints take the short way round from where the needle is.
    this.turn =
      this.kind === 'joint' && this.turn !== undefined ? this.turn + ((((target - this.turn) % 360) + 540) % 360) - 180 : target;
    const transform = `rotate(${this.turn.toFixed(1)}deg)`;
    if (this.needle.style.transform !== transform) this.needle.style.transform = transform;
    put(this.value, `${this.kind === 'beta' ? deg.toFixed(1) : Math.round(wrap360(deg))}°`);
  }
}

/**
 * The camera's horizontal field of view, degrees: where it opens, and the wheel's range. Wider
 * than ~122° a 16:10 frame's corners pass the horizon, where the globe's glow (made for a
 * viewer far out in space) would fog the sky.
 */
const CAM_FOV = { start: 70, min: 30, max: 120 };
/** The camera frame's width over its height. */
const CAM_ASPECT = 16 / 10;

/**
 * The camera: the ISS from above, and the Earth below it. main.ts renders the frames
 * (GlobeRenderer's renderView, issModel.ts posing the station); this holds the toggle, the
 * frame and its zoom.
 */
export class IssCamera {
  readonly el: HTMLElement;
  /** Horizontal field of view, degrees. */
  fov = CAM_FOV.start;
  private readonly toggle: HTMLButtonElement;
  private readonly frame: HTMLElement;
  private readonly canvas: HTMLCanvasElement;
  private readonly caption: HTMLElement;
  private image: ImageData | null = null;
  private on = false;

  constructor(
    /** Open (true) or close (false) the camera. */
    onToggle: (on: boolean) => void,
    /** The field of view changed: draw again. */
    onZoom: () => void,
  ) {
    this.el = el('div', 'iss-cam');
    const head = el('div', 'iss-cam-head');
    this.toggle = el('button', 'iss-cam-toggle');
    this.toggle.type = 'button';
    this.toggle.addEventListener('click', () => onToggle(!this.on));
    head.append(label('Camera · 120 m above'), this.toggle);
    this.frame = el('div', 'iss-cam-frame');
    this.canvas = el('canvas', 'iss-cam-canvas');
    this.canvas.setAttribute('role', 'img');
    this.canvas.setAttribute('aria-label', 'The ISS from 120 m above, looking down past it at the Earth, rendered');
    this.caption = el('span', 'iss-cam-caption');
    this.frame.append(this.canvas, this.caption);
    this.frame.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        this.fov = Math.max(CAM_FOV.min, Math.min(CAM_FOV.max, this.fov * Math.exp(e.deltaY * 0.001)));
        onZoom();
      },
      { passive: false },
    );
    this.el.append(head, this.frame);
    this.show(false);
  }

  show(on: boolean) {
    if (on === this.on && this.toggle.textContent) return;
    this.on = on;
    this.frame.hidden = !on;
    this.toggle.setAttribute('aria-pressed', String(on));
    put(this.toggle, on ? 'Hide' : 'Show');
  }

  /** The frame to render, in device pixels; undefined while the camera's closed or not laid out. */
  size(): { width: number; height: number } | undefined {
    const w = this.on ? this.frame.clientWidth : 0;
    if (!w) return undefined;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    return { width: Math.round(w * dpr), height: Math.round((w / CAM_ASPECT) * dpr) };
  }

  /** Show a rendered frame: RGBA rows bottom to top, as WebGL reads them back; `note` ends the caption. */
  draw(pixels: Uint8Array, width: number, height: number, note = '') {
    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas.width = width;
      this.canvas.height = height;
      this.image = null;
    }
    const image = (this.image ??= new ImageData(width, height));
    const row = width * 4;
    for (let y = 0; y < height; y++) image.data.set(pixels.subarray((height - 1 - y) * row, (height - y) * row), y * row);
    this.canvas.getContext('2d')!.putImageData(image, 0, 0);
    put(this.caption, [`${Math.round(this.fov)}°`, 'travel ↑', note].filter(Boolean).join(' · '));
  }
}

export class IssPanelView {
  readonly camera: IssCamera;
  private readonly content: HTMLElement;
  private readonly time: HTMLElement;
  private readonly chips: HTMLElement;
  private readonly tiles: HTMLElement;
  private readonly alt = new SparkTile('Altitude', (v) => `${v.toFixed(1)} km`, (d) => `${signed(d, 1)} km`, 2);
  private readonly speed = new SparkTile('Speed', (v) => `${v.toFixed(3)} km/s`, (d) => `${signed(d * 1000, 1)} m/s`, 0.002);
  private readonly tle: HTMLElement;
  private readonly meters = METERS.map((m) => new Meter(m));
  private readonly dials = { beta: new Dial('Sun β', 'beta'), stbd: new Dial('Array stbd', 'joint'), port: new Dial('Array port', 'joint') };
  private readonly foot: HTMLElement;
  private chipKey = '';

  constructor(
    private readonly toast: Toast,
    /** Open or close the camera; the field of view changed. */
    onCamera: (on: boolean) => void,
    onZoom: () => void,
  ) {
    this.camera = new IssCamera(onCamera, onZoom);
    this.content = el('div', 'iss-content');
    const meta = el('div', 'iss-meta');
    this.time = el('span', 'iss-time');
    this.chips = el('span', 'iss-chips');
    meta.append(this.time, this.chips);

    const tiles = (this.tiles = el('div', 'iss-tiles'));
    tiles.append(this.alt.el, this.speed.el);
    this.tle = el('div', 'iss-note');

    const meters = el('div', 'iss-meters');
    meters.append(...this.meters.map((m) => m.el));

    const dials = el('div', 'iss-dials');
    dials.append(this.dials.beta.el, this.dials.stbd.el, this.dials.port.el);

    this.foot = el('div', 'iss-note');
    this.content.append(meta, tiles, this.tle, meters, dials, this.foot, this.camera.el);
    toast.body.append(this.content);
  }

  /**
   * Show the readings (or close with undefined). `dock`: show them there, in another window,
   * rather than in this one, which stays closed; their orbit tiles hide while there's no state
   * vector, since that window then shows the predicted orbit's.
   */
  update(r: IssReadings | undefined, dock?: HTMLElement) {
    const home = dock ?? this.toast.body;
    if (this.content.parentElement !== home) home.append(this.content);
    this.toast.show(!!r && !dock);
    if (!r) return;
    const now = Date.now();
    const signal = `${r.aos ? '●' : '○'} ${r.status}`;
    this.toast.setStatus(signal, r.aos ? 'ok' : 'warn');
    this.content.classList.toggle('los', !r.aos);
    this.tiles.hidden = !!dock && !r.orbit;
    put(this.time, r.gmt);

    const chips: [string, string][] = [
      ...(dock ? ([[signal, r.aos ? '' : 'warn']] as [string, string][]) : []),
      [r.mode, ''],
      [r.attitude, ''],
      ...(r.maneuvering ? ([['Maneuvering', 'warn']] as [string, string][]) : []),
      [`Ku ${r.kuVideo}`, ''],
    ];
    const key = chips.map((c) => c.join(':')).join('|');
    if (key !== this.chipKey) {
      this.chipKey = key;
      this.chips.replaceChildren(
        ...chips.map(([text, tone]) => {
          const chip = el('span', 'iss-chip', text);
          if (tone) chip.dataset.tone = tone;
          return chip;
        }),
      );
    }

    this.alt.update(r.orbit?.altKm, now);
    this.speed.update(r.orbit?.speed, now);
    put(
      this.tle,
      r.orbit?.deltaKm !== undefined
        ? `Predicted orbit (TLE) ${r.orbit.deltaKm.toFixed(1)} km from telemetry`
        : r.orbit
          ? ''
          : 'No current state vector: orbit from TLE only',
    );
    for (const m of this.meters) m.update(r);
    this.dials.beta.update(r.betaDeg);
    this.dials.stbd.update(r.sarjStarboardDeg);
    this.dials.port.update(r.sarjPortDeg);
    put(
      this.foot,
      [r.massKg !== undefined ? `${Math.round(r.massKg).toLocaleString('en-US')} kg` : '', r.laptops !== undefined ? `${r.laptops} laptops` : '']
        .filter(Boolean)
        .join(' · '),
    );
  }
}
