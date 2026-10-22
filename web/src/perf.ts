// Frame statistics for the frame-rate display (key D, ?fps=1). A fixed ring
// buffer, so measuring doesn't add garbage-collection pauses of its own.

export interface PerfSummary {
  /** Frame rate over the window: 1000 / mean frame interval. */
  fps: number;
  /** Mean interval between those frames, ms. */
  frameMs: number;
  /** Longest interval in the window, ms — the hitch you'd notice. */
  worstMs: number;
  /** Intervals in the window more than 1.5× the median (uneven pacing). */
  slow: number;
  /** Mean main-thread time per frame, ms, total and by section. */
  cpuMs: number;
  sections: Record<string, number>;
  /** Mean GPU time per frame, ms, when the browser exposes timer queries. */
  gpuMs: number | null;
}

export class FrameStats {
  private readonly at: Float64Array;
  private readonly interval: Float32Array;
  private readonly cpu: Float32Array;
  private readonly gpu: Float32Array;
  private readonly sections = new Map<string, Float32Array>();
  private head = 0;
  private count = 0;
  private lastAt = NaN;
  private lastGpu: number | null = null;

  constructor(readonly capacity = 240) {
    this.at = new Float64Array(capacity);
    this.interval = new Float32Array(capacity);
    this.cpu = new Float32Array(capacity);
    this.gpu = new Float32Array(capacity);
  }

  /** Record a frame that started at `at` (ms, same clock every call). */
  record(at: number, sections: Record<string, number>) {
    const i = this.head;
    this.at[i] = at;
    this.interval[i] = Number.isNaN(this.lastAt) ? NaN : at - this.lastAt;
    let total = 0;
    for (const [name, ms] of Object.entries(sections)) {
      let buf = this.sections.get(name);
      if (!buf) this.sections.set(name, (buf = new Float32Array(this.capacity).fill(NaN)));
      buf[i] = ms;
      total += ms;
    }
    this.cpu[i] = total;
    this.gpu[i] = NaN;
    this.lastAt = at;
    this.head = (i + 1) % this.capacity;
    this.count = Math.min(this.count + 1, this.capacity);
    return i;
  }

  /** The slot the next `record` will use (to tag a GPU query started this frame). */
  get nextSlot() {
    return this.head;
  }

  /** GPU timings arrive a few frames late; attach one to the frame it measured. */
  recordGpu(slot: number, ms: number) {
    this.gpu[slot] = ms;
    this.lastGpu = ms;
  }

  /** Indices of recorded frames, oldest first. */
  private *indices(): Generator<number> {
    for (let k = this.count; k > 0; k--) yield (this.head - k + this.capacity) % this.capacity;
  }

  /**
   * Stats over the frames in (now − windowMs, now]. When redrawing on demand,
   * pass a window spanning a few redraw intervals so it holds whole intervals.
   */
  summary(now: number, windowMs = 1000): PerfSummary {
    const inWindow = [...this.indices()].filter((i) => this.at[i] > now - windowMs);
    const intervals = inWindow.map((i) => this.interval[i]).filter((v) => !Number.isNaN(v));
    const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
    const sorted = [...intervals].sort((a, b) => a - b);
    const median = sorted.length ? sorted[Math.floor(sorted.length / 2)] : 0;
    const sections: Record<string, number> = {};
    for (const [name, buf] of this.sections) {
      sections[name] = mean(inWindow.map((i) => buf[i]).filter((v) => !Number.isNaN(v)));
    }
    const gpu = inWindow.map((i) => this.gpu[i]).filter((v) => !Number.isNaN(v));
    const frameMs = mean(intervals);
    return {
      fps: frameMs ? 1000 / frameMs : 0,
      frameMs,
      worstMs: sorted.length ? sorted[sorted.length - 1] : 0,
      slow: median ? intervals.filter((v) => v > median * 1.5).length : 0,
      cpuMs: mean(inWindow.map((i) => this.cpu[i])),
      sections,
      // On-demand redraws are a second apart and each result lands a frame
      // late, so fall back to the latest reading rather than flicker to none.
      gpuMs: gpu.length ? mean(gpu) : this.lastGpu,
    };
  }

  /** The most recent `n` frame intervals, oldest first (for the sparkline). */
  recentIntervals(n: number): number[] {
    return [...this.indices()]
      .slice(-n)
      .map((i) => this.interval[i])
      .filter((v) => !Number.isNaN(v));
  }
}

/**
 * Whether frames are too slow to afford the glass blur. Fed the interval between
 * back-to-back animated frames (on-demand redraws are slow on purpose and don't
 * count); trips once `share` of the last `size` frames took longer than `limitMs`,
 * and stays tripped, since blur coming and going would flicker. The blur's cost
 * is in the browser's compositor, which no WebGL timer sees, so frame pacing is
 * the measure.
 */
export class SlowFrames {
  private readonly ring: Uint8Array;
  private head = 0;
  private seen = 0;
  private slowCount = 0;
  tripped = false;

  constructor(
    readonly limitMs = 28,
    readonly size = 90,
    readonly share = 0.6,
  ) {
    this.ring = new Uint8Array(size);
  }

  /** Add one frame interval; true on the frame it trips. */
  add(intervalMs: number): boolean {
    if (this.tripped) return false;
    const slow = intervalMs > this.limitMs ? 1 : 0;
    this.slowCount += slow - this.ring[this.head];
    this.ring[this.head] = slow;
    this.head = (this.head + 1) % this.size;
    this.seen = Math.min(this.seen + 1, this.size);
    if (this.seen === this.size && this.slowCount >= this.share * this.size) this.tripped = true;
    return this.tripped;
  }
}

/**
 * GPU time per frame via EXT_disjoint_timer_query_webgl2. Results come back a
 * few frames later; `poll` hands each finished one to `onResult` with the
 * slot it was started for. Browsers may not expose the extension (it's often
 * disabled to blunt timing attacks) — then `available` is false.
 */
export class GpuTimer {
  private readonly ext: { TIME_ELAPSED_EXT: number; GPU_DISJOINT_EXT: number } | null;
  private readonly pending: { query: WebGLQuery; slot: number }[] = [];
  private active: WebGLQuery | null = null;

  constructor(private readonly gl: WebGL2RenderingContext) {
    this.ext = gl.getExtension('EXT_disjoint_timer_query_webgl2');
  }

  get available() {
    return !!this.ext;
  }

  begin() {
    if (!this.ext || this.active || this.pending.length > 8) return;
    const q = this.gl.createQuery();
    if (!q) return;
    this.gl.beginQuery(this.ext.TIME_ELAPSED_EXT, q);
    this.active = q;
  }

  end(slot: number) {
    if (!this.ext || !this.active) return;
    this.gl.endQuery(this.ext.TIME_ELAPSED_EXT);
    this.pending.push({ query: this.active, slot });
    this.active = null;
  }

  poll(onResult: (slot: number, ms: number) => void) {
    if (!this.ext) return;
    const gl = this.gl;
    const disjoint = gl.getParameter(this.ext.GPU_DISJOINT_EXT) as boolean;
    while (this.pending.length) {
      const { query, slot } = this.pending[0];
      if (!gl.getQueryParameter(query, gl.QUERY_RESULT_AVAILABLE)) break;
      this.pending.shift();
      if (!disjoint) onResult(slot, (gl.getQueryParameter(query, gl.QUERY_RESULT) as number) / 1e6);
      gl.deleteQuery(query);
    }
  }
}
