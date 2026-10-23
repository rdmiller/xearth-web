// The ISS telemetry window: instruments, not rows of text.
//
//   ORBIT    two stat tiles, altitude and speed, each with its change and a sparkline of the
//            last 15 minutes (hover one to read off any point), then how far the TLE
//            prediction sits from the telemetry
//   CABIN    meters for pressure, temperature, O2, CO2 and gyroscope momentum, each marking
//            its normal band and coloured by where the value sits (cyan, amber, red)
//   ARRAYS   dials for the Sun's beta angle and the two solar array joints
//
// Values only change about once a second, so the DOM is built once and touched only when a
// reading moves. While the station is out of signal, the instruments dim: the values are
// the last ones received, and the header says how old.

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

export class IssPanelView {
  private readonly content: HTMLElement;
  private readonly time: HTMLElement;
  private readonly chips: HTMLElement;
  private readonly alt = new SparkTile('Altitude', (v) => `${v.toFixed(1)} km`, (d) => `${signed(d, 1)} km`, 2);
  private readonly speed = new SparkTile('Speed', (v) => `${v.toFixed(3)} km/s`, (d) => `${signed(d * 1000, 1)} m/s`, 0.002);
  private readonly tle: HTMLElement;
  private readonly meters = METERS.map((m) => new Meter(m));
  private readonly dials = { beta: new Dial('Sun β', 'beta'), stbd: new Dial('Array stbd', 'joint'), port: new Dial('Array port', 'joint') };
  private readonly foot: HTMLElement;
  private chipKey = '';

  constructor(private readonly toast: Toast) {
    this.content = el('div', 'iss-content');
    const meta = el('div', 'iss-meta');
    this.time = el('span', 'iss-time');
    this.chips = el('span', 'iss-chips');
    meta.append(this.time, this.chips);

    const tiles = el('div', 'iss-tiles');
    tiles.append(this.alt.el, this.speed.el);
    this.tle = el('div', 'iss-note');

    const meters = el('div', 'iss-meters');
    meters.append(...this.meters.map((m) => m.el));

    const dials = el('div', 'iss-dials');
    dials.append(this.dials.beta.el, this.dials.stbd.el, this.dials.port.el);

    this.foot = el('div', 'iss-note');
    this.content.append(meta, tiles, this.tle, meters, dials, this.foot);
    toast.body.append(this.content);
  }

  update(r: IssReadings | undefined) {
    this.toast.show(!!r);
    if (!r) return;
    const now = Date.now();
    this.toast.setStatus(`${r.aos ? '●' : '○'} ${r.status}`, r.aos ? 'ok' : 'warn');
    this.content.classList.toggle('los', !r.aos);
    put(this.time, r.gmt);

    const chips: [string, string][] = [
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
