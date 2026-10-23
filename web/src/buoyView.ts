// A buoy's window, in the ISS telemetry window's style: instruments, not rows of text.
//
//   header   the buoy's id and name; a chip with how old its latest report is
//   meta     its kind and where it is
//   tiles    waves, water temperature, wind and pressure, each with its last 24 hours as a
//            sparkline (hover one to read off any hour); a DART buoy has one tile instead,
//            its water-column height every 15 minutes, where the tide shows
//   dials    wind and wave direction (where they come from)
//   foot     how far a drifter drifted, the pressure's tendency, the source
//
// The history comes in a separate file, fetched the first time a window opens; until then
// the tiles show the latest readings without sparklines.

import { buoyTitle, degC, drift, metres, ms, tendency, TYPE_COLOR, TYPE_LABEL, type Buoy, type BuoyHistory } from './buoys';
import { sparkPath, sparkScale } from './gauges';
import { attr, Dial, el, label, put, svg } from './issView';
import type { Toast } from './toasts';

const SPARK_W = 132;
const SPARK_H = 26;
const MIN = 60_000;
/** Older than this, a buoy's latest report reads as stale. */
const STALE_MS = 6 * 3_600_000;

const ago = (ms: number) => {
  const min = Math.max(0, Math.round(ms / MIN));
  return min < 90 ? `${min} min ago` : `${Math.round(min / 60)} h ago`;
};

/** A stat tile with a fixed history: label, value, change over the history, a sparkline to read off. */
class HistoryTile {
  readonly el: HTMLElement;
  private readonly value: HTMLElement;
  private readonly delta: HTMLElement;
  private readonly line: SVGPathElement;
  private readonly dot: SVGCircleElement;
  private readonly cross: SVGLineElement;
  private times: number[] = [];
  private values: number[] = [];
  private latest: number | undefined;
  private hover: number | undefined;

  constructor(
    name: string,
    private format: (v: number) => string,
    private formatChange: (d: number) => string,
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
    plot.addEventListener('pointermove', (e) => {
      const r = plot.getBoundingClientRect();
      this.hover = r.width ? (e.clientX - r.left) / r.width : undefined;
      this.draw();
    });
    plot.addEventListener('pointerleave', () => {
      this.hover = undefined;
      this.draw();
    });
    this.el.append(head, this.value, plot);
  }

  /** The latest reading, its history (times ms, values), and its formatters (units can change). */
  set(latest: number | null | undefined, times: number[], values: number[], format: (v: number) => string, formatChange = this.formatChange) {
    this.latest = latest ?? values[values.length - 1];
    this.times = times;
    this.values = values;
    this.format = format;
    this.formatChange = formatChange;
    this.el.hidden = this.latest === undefined && !values.length;
    this.draw();
  }

  private draw() {
    attr(this.line, 'd', sparkPath(this.values, SPARK_W, SPARK_H, this.minSpan));
    const n = this.values.length;
    if (this.hover !== undefined && n) {
      const i = Math.round(Math.max(0, Math.min(1, this.hover)) * (n - 1));
      const [x, y] = this.pointAt(i);
      for (const [node, k, v] of [
        [this.cross, 'x1', x],
        [this.cross, 'x2', x],
        [this.dot, 'cx', x],
        [this.dot, 'cy', y],
      ] as const)
        attr(node, k, v.toFixed(1));
      attr(this.cross, 'visibility', 'visible');
      attr(this.dot, 'visibility', 'visible');
      put(this.value, this.format(this.values[i]));
      put(this.delta, `${new Date(this.times[i]).toISOString().slice(11, 16)} UTC`);
      return;
    }
    attr(this.cross, 'visibility', 'hidden');
    if (this.latest === undefined) {
      put(this.value, '—');
      put(this.delta, '');
      attr(this.dot, 'visibility', 'hidden');
      return;
    }
    put(this.value, this.format(this.latest));
    if (n) {
      const [x, y] = this.pointAt(n - 1);
      attr(this.dot, 'cx', x.toFixed(1));
      attr(this.dot, 'cy', y.toFixed(1));
      attr(this.dot, 'visibility', 'visible');
    } else attr(this.dot, 'visibility', 'hidden');
    const hours = n > 1 ? Math.round((this.times[n - 1] - this.times[0]) / 3_600_000) : 0;
    put(this.delta, hours > 0 ? `${this.formatChange(this.values[n - 1] - this.values[0])} / ${hours} h` : '');
  }

  private pointAt(i: number): [number, number] {
    const { x, y } = sparkScale(this.values, SPARK_W, SPARK_H, this.minSpan);
    return [x(i), y(this.values[i])];
  }
}

const signed = (x: number, digits: number, unit: string) => `${x >= 0 ? '+' : '−'}${Math.abs(x).toFixed(digits)}${unit}`;

/** Hourly bins → the non-null ones, as times (ms) and values. */
function points(h: BuoyHistory | undefined, values: readonly (number | null)[] | undefined): { times: number[]; values: number[] } {
  const out = { times: [] as number[], values: [] as number[] };
  if (!h || !values) return out;
  const t0 = Date.parse(h.from);
  values.forEach((v, i) => {
    if (v === null) return;
    out.times.push(t0 + i * h.stepMin * MIN);
    out.values.push(v);
  });
  return out;
}

export class BuoyPanelView {
  private readonly content: HTMLElement;
  private readonly kind: HTMLElement;
  private readonly where: HTMLElement;
  private readonly waves: HistoryTile;
  private readonly water: HistoryTile;
  private readonly wind: HistoryTile;
  private readonly pressure: HistoryTile;
  private readonly column: HistoryTile;
  private readonly dials = { wind: new Dial('Wind from', 'joint'), waves: new Dial('Waves from', 'joint') };
  private readonly dialRow: HTMLElement;
  private readonly foot: HTMLElement;
  private imperial = false;

  constructor(private readonly toast: Toast) {
    this.content = el('div', 'iss-content buoy-content');
    const meta = el('div', 'iss-meta');
    this.kind = el('span', 'iss-chip');
    this.where = el('span', 'iss-time');
    meta.append(this.kind, this.where);
    const f1 = (u: string) => (d: number) => signed(d, 1, u);
    this.waves = new HistoryTile('Waves', (v) => `${v.toFixed(1)} m`, f1(' m'), 0.4);
    this.water = new HistoryTile('Water', (v) => `${v.toFixed(1)}°C`, f1('°'), 0.6);
    this.wind = new HistoryTile('Wind', (v) => `${v.toFixed(1)} m/s`, f1(' m/s'), 2);
    this.pressure = new HistoryTile('Pressure', (v) => `${v.toFixed(1)} hPa`, f1(' hPa'), 3);
    this.column = new HistoryTile('Water column', (v) => `${v.toFixed(3)} m`, (d) => signed(d, 3, ' m'), 0.05);
    // A DART buoy's one tile spans the window, so its tide gets the room.
    this.column.el.classList.add('wide');
    const tiles = el('div', 'iss-tiles buoy-tiles');
    tiles.append(this.waves.el, this.water.el, this.wind.el, this.pressure.el, this.column.el);
    this.dialRow = el('div', 'iss-dials');
    this.dialRow.append(this.dials.wind.el, this.dials.waves.el);
    this.foot = el('div', 'iss-note');
    this.content.append(meta, tiles, this.dialRow, this.foot);
    toast.body.append(this.content);
  }

  /** Show a buoy (or close with undefined); `history` once it has arrived. */
  update(b: Buoy | undefined, history: BuoyHistory | undefined, now: number, imperial: boolean) {
    this.toast.show(!!b);
    if (!b) return;
    this.imperial = imperial;
    this.toast.setTitle(buoyTitle(b));
    const age = now - Date.parse(b.time);
    this.toast.setStatus(ago(age), age > STALE_MS ? 'warn' : 'ok');
    this.content.classList.toggle('los', age > STALE_MS);
    put(this.kind, TYPE_LABEL[b.type]);
    this.kind.style.color = TYPE_COLOR[b.type];
    put(this.where, `${Math.abs(b.lat).toFixed(2)}°${b.lat >= 0 ? 'N' : 'S'} ${Math.abs(b.lon).toFixed(2)}°${b.lon >= 0 ? 'E' : 'W'}`);

    const s = history?.series[b.id];
    const dart = b.type === 'dart';
    const im = this.imperial;
    // Changes in the same units as the values: feet, °F and mph for a US viewer.
    const sign = (d: number) => (d >= 0 ? '+' : '−');
    const wv = points(history, s?.wvht);
    this.waves.set(dart ? null : b.wvht, wv.times, wv.values, (v) => `${metres(v, im)}${b.dpd && v === b.wvht ? ` · ${b.dpd} s` : ''}`, (d) => sign(d) + metres(Math.abs(d), im));
    const wt = points(history, s?.sst);
    this.water.set(dart ? null : b.sst, wt.times, wt.values, (v) => degC(v, im), (d) => `${sign(d)}${Math.abs(im ? (d * 9) / 5 : d).toFixed(1)}°`);
    const ws = points(history, s?.wspd);
    this.wind.set(dart ? null : b.wspd, ws.times, ws.values, (v) => ms(v, im), (d) => sign(d) + ms(Math.abs(d), im));
    const ps = points(history, s?.slp);
    this.pressure.set(dart ? null : b.slp, ps.times, ps.values, (v) => `${v.toFixed(1)} hPa`);
    // DART: the water column, every 15 minutes; the tide is the slow swing, a tsunami the fast one.
    const d = history?.dart[b.id];
    const t0 = history ? Date.parse(history.from) : 0;
    // Tiles with neither a latest value nor history hide themselves (a DART has no waves; a mooring no column).
    this.column.set(dart ? b.height : null, d ? d.t.map((m) => t0 + m * MIN) : [], d ? d.height : [], (v) => `${v.toFixed(3)} m`);

    this.dials.wind.update(b.wdir ?? undefined);
    this.dials.waves.update(b.mwd ?? undefined);
    this.dials.wind.el.hidden = b.wdir == null;
    this.dials.waves.el.hidden = b.mwd == null;
    this.dialRow.hidden = b.wdir == null && b.mwd == null;

    const tend = tendency(s?.slp);
    put(
      this.foot,
      [
        dart && b.event ? 'EVENT MODE: reporting every minute or faster' : '',
        b.type === 'drifting' || b.type === 'ice' ? drift(s, history?.stepMin) ?? '' : '',
        tend ? `pressure ${tend.word} ${Math.abs(tend.hPa).toFixed(1)} hPa / 3 h` : '',
        b.gust != null ? `gusts ${ms(b.gust, im)}` : '',
        history ? '' : 'loading the last 24 hours…',
      ]
        .filter(Boolean)
        .join(' · '),
    );
  }
}
