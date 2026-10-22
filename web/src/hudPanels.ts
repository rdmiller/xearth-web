// The frame-rate window: once drawn on the overlay canvas, now a toast window like the rest
// (toasts.ts). It updates every frame it's shown, so it only touches the DOM when what it
// shows has changed. (The ISS telemetry window is issView.ts.)

import type { PerfSummary } from './perf';
import type { Toast } from './toasts';

export interface PerfView {
  summary: PerfSummary;
  /** Recent frame intervals, ms, oldest first. */
  intervals: number[];
  /** How redraws are being scheduled ("continuous" or "on demand · every 1 s"). */
  mode: string;
  gpuAvailable: boolean;
}

const FRAME_60 = 1000 / 60;
const SPARK_H = 34;
const SPARK_BARS = 120;

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text = '') =>
  Object.assign(document.createElement(tag), { className, textContent: text });

/** Sets text only when it differs, so a steady panel costs no layout. */
function put(node: HTMLElement, text: string) {
  if (node.textContent !== text) node.textContent = text;
}

/** The frame-rate window: headline, a sparkline of frame intervals, then where the time goes. */
export class PerfPanel {
  private readonly fps: HTMLElement;
  private readonly ms: HTMLElement;
  private readonly spark: HTMLCanvasElement;
  private readonly values: HTMLElement[] = [];

  constructor(private readonly toast: Toast) {
    const head = el('div', 'perf-head');
    this.fps = el('span', 'perf-fps');
    this.ms = el('span', 'perf-ms');
    head.append(this.fps, this.ms);
    this.spark = el('canvas', 'perf-spark');
    this.spark.height = SPARK_H;
    this.spark.setAttribute('aria-hidden', 'true');
    const rows = el('dl', 'hud-rows');
    for (const k of ['worst', 'cpu', 'gpu', 'redraw']) {
      const v = el('dd', '');
      rows.append(el('dt', '', k), v);
      this.values.push(v);
    }
    toast.body.append(head, this.spark, rows);
  }

  update(p: PerfView | undefined) {
    this.toast.show(!!p);
    if (!p) return;
    const s = p.summary;
    const continuous = p.mode === 'continuous';
    put(this.fps, `${s.fps < 10 ? s.fps.toFixed(1) : Math.round(s.fps)} FPS`);
    put(this.ms, s.frameMs ? `${s.frameMs.toFixed(1)} ms` : '—');
    const [worst, cpu, gpu, redraw] = this.values;
    put(worst, continuous ? `${s.worstMs.toFixed(1)} ms · ${s.slow} slow` : '— (not animating)');
    put(
      cpu,
      `${s.cpuMs.toFixed(1)} ms  ${Object.entries(s.sections)
        .map(([k, v]) => `${k} ${v.toFixed(1)}`)
        .join(' · ')}`,
    );
    put(gpu, s.gpuMs !== null ? `${s.gpuMs.toFixed(1)} ms` : p.gpuAvailable ? 'measuring…' : 'n/a (no timer queries)');
    put(redraw, p.mode);
    this.sparkline(p.intervals, continuous);
  }

  /** Frame intervals, 0–50 ms, with 60 and 30 fps guides. */
  private sparkline(intervals: number[], continuous: boolean) {
    const c = this.spark;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = c.clientWidth || 1;
    if (c.width !== Math.round(w * dpr)) c.width = Math.round(w * dpr);
    if (c.height !== Math.round(SPARK_H * dpr)) c.height = Math.round(SPARK_H * dpr);
    const ctx = c.getContext('2d')!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, SPARK_H);
    const y = (ms: number) => SPARK_H - (Math.min(ms, 50) / 50) * SPARK_H;
    ctx.strokeStyle = 'rgba(98, 230, 255, 0.18)';
    ctx.setLineDash([2, 3]);
    for (const ms of [FRAME_60, FRAME_60 * 2]) {
      ctx.beginPath();
      ctx.moveTo(0, y(ms));
      ctx.lineTo(w, y(ms));
      ctx.stroke();
    }
    ctx.setLineDash([]);
    const bars = intervals.slice(-SPARK_BARS);
    const bw = w / SPARK_BARS;
    bars.forEach((ms, i) => {
      // Long gaps are deliberate when redrawing on demand, so don't colour them as hitches.
      ctx.fillStyle = !continuous
        ? 'rgba(175, 215, 240, 0.35)'
        : ms <= FRAME_60 * 1.25
          ? '#62e6ff'
          : ms <= FRAME_60 * 2.1
            ? '#ffc857'
            : '#ff5c7a';
      const top = y(ms);
      ctx.fillRect(w - (bars.length - i) * bw, top, Math.max(bw - 0.4, 0.6), SPARK_H - top);
    });
  }
}
