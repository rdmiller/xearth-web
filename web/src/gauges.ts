// Small instruments for the HUD windows: meters (a value against its limits), angle dials
// and sparklines, as pure geometry and scales, plus the short history a sparkline draws.
// The windows (hudPanels.ts) turn these into SVG.

export type Severity = 'ok' | 'warn' | 'bad';

/** A meter's scale. Inside `ok` reads normal; inside `warn` (but outside `ok`) a caution. */
export interface MeterScale {
  min: number;
  max: number;
  ok: [number, number];
  warn: [number, number];
}

export function fraction(v: number, min: number, max: number): number {
  return max > min ? Math.max(0, Math.min(1, (v - min) / (max - min))) : 0;
}

export function severity(v: number, s: MeterScale): Severity {
  const within = ([lo, hi]: [number, number]) => v >= lo && v <= hi;
  return within(s.ok) ? 'ok' : within(s.warn) ? 'warn' : 'bad';
}

/**
 * A sparkline's scales across a w × h box (SVG y, down): sample index → x, value → y. The
 * vertical scale spans the data, but never less than `minSpan`, so sensor noise isn't blown
 * up into mountains.
 */
export function sparkScale(values: readonly number[], w: number, h: number, minSpan = 0) {
  let lo = Math.min(...values);
  let hi = Math.max(...values);
  if (hi - lo < minSpan) {
    const mid = (hi + lo) / 2;
    lo = mid - minSpan / 2;
    hi = mid + minSpan / 2;
  }
  const pad = 1.5; // keep the 1.5 px stroke inside the box
  return {
    x: (i: number) => (values.length === 1 ? w : (i / (values.length - 1)) * w),
    y: (v: number) => (hi > lo ? pad + (1 - (v - lo) / (hi - lo)) * (h - 2 * pad) : h / 2),
  };
}

/** An SVG path through `values` on sparkScale's scales. */
export function sparkPath(values: readonly number[], w: number, h: number, minSpan = 0): string {
  if (!values.length) return '';
  const { x, y } = sparkScale(values, w, h, minSpan);
  return values.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)} ${y(v).toFixed(1)}`).join(' ');
}

/** The point on a circle at `deg` clockwise from 12 o'clock. */
export function polar(cx: number, cy: number, r: number, deg: number): [number, number] {
  const a = (deg * Math.PI) / 180;
  return [cx + r * Math.sin(a), cy - r * Math.cos(a)];
}

/** An SVG arc from `fromDeg` clockwise to `toDeg` (degrees clockwise from 12 o'clock). */
export function arcPath(cx: number, cy: number, r: number, fromDeg: number, toDeg: number): string {
  const sweep = toDeg - fromDeg;
  if (Math.abs(sweep) >= 360) toDeg = fromDeg + 359.99;
  const [x0, y0] = polar(cx, cy, r, fromDeg);
  const [x1, y1] = polar(cx, cy, r, toDeg);
  const large = Math.abs(toDeg - fromDeg) > 180 ? 1 : 0;
  return `M${x0.toFixed(2)} ${y0.toFixed(2)} A${r} ${r} 0 ${large} ${toDeg >= fromDeg ? 1 : 0} ${x1.toFixed(2)} ${y1.toFixed(2)}`;
}

/** Angles from telemetry wrap: bring any value into 0–360. */
export const wrap360 = (deg: number) => ((deg % 360) + 360) % 360;

/**
 * A rolling record of one reading for a sparkline: at most one sample per `everyMs`, and
 * nothing older than `spanMs` behind the newest.
 */
export class Series {
  private readonly t: number[] = [];
  private readonly v: number[] = [];

  constructor(
    readonly spanMs: number,
    readonly everyMs: number,
  ) {}

  /** Record a sample; false when it came too soon after the last one to keep. */
  push(t: number, v: number): boolean {
    const last = this.t[this.t.length - 1];
    if (last !== undefined && t < last) this.clear(); // time went backwards: start again
    else if (last !== undefined && t - last < this.everyMs) return false;
    this.t.push(t);
    this.v.push(v);
    while (this.t.length && this.t[0] < t - this.spanMs) {
      this.t.shift();
      this.v.shift();
    }
    return true;
  }

  clear() {
    this.t.length = 0;
    this.v.length = 0;
  }

  get values(): readonly number[] {
    return this.v;
  }

  get times(): readonly number[] {
    return this.t;
  }

  /** Newest minus oldest value, or undefined with fewer than two samples. */
  get change(): number | undefined {
    return this.v.length > 1 ? this.v[this.v.length - 1] - this.v[0] : undefined;
  }

  /** The sample nearest a fraction (0–1) of the way along, for a hover readout. */
  at(f: number): { t: number; v: number } | undefined {
    if (!this.v.length) return undefined;
    const i = Math.round(Math.max(0, Math.min(1, f)) * (this.v.length - 1));
    return { t: this.t[i], v: this.v[i] };
  }
}
