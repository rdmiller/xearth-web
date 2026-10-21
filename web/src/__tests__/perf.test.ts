import { describe, expect, it } from 'vitest';
import { FrameStats } from '../perf';

describe('FrameStats', () => {
  it('counts frames in the last second and averages their intervals', () => {
    const s = new FrameStats();
    for (let k = 0; k <= 120; k++) s.record(k * (1000 / 60), { sim: 1, gl: 0.5 });
    const sum = s.summary(2000.5); // off the frame grid, so no float tie at the window edge
    expect(sum.fps).toBeCloseTo(60, 4); // intervals are stored as float32
    expect(sum.frameMs).toBeCloseTo(16.67, 1);
    expect(sum.cpuMs).toBeCloseTo(1.5);
    expect(sum.sections).toEqual({ sim: 1, gl: 0.5 });
    expect(sum.slow).toBe(0);
    expect(sum.gpuMs).toBeNull();
  });

  it('flags hitches: the worst interval and how many frames ran long', () => {
    const s = new FrameStats();
    let t = 0;
    for (let k = 0; k < 60; k++) {
      t += k % 20 === 10 ? 50 : 16.7; // three 50 ms hitches
      s.record(t, {});
    }
    const sum = s.summary(t);
    expect(sum.worstMs).toBeCloseTo(50);
    expect(sum.slow).toBe(3);
  });

  it('attaches late GPU timings to the frame they measured', () => {
    const s = new FrameStats();
    const a = s.record(0, {});
    s.record(16, {});
    s.recordGpu(a, 4);
    expect(s.summary(20).gpuMs).toBe(4);
    // Seconds later, with no new reading in the window, the last one still shows.
    s.record(5000, {});
    expect(s.summary(5000).gpuMs).toBe(4);
  });

  it('wraps without losing order and returns recent intervals oldest first', () => {
    const s = new FrameStats(8);
    for (let k = 0; k < 20; k++) s.record(k * 10 + (k === 19 ? 5 : 0), {});
    const recent = s.recentIntervals(3);
    expect(recent).toEqual([10, 10, 15]);
  });

  it('reports an on-demand cadence honestly (1 frame a second) given a wide enough window', () => {
    const s = new FrameStats();
    for (let k = 0; k < 5; k++) s.record(k * 1000, { sim: 0.4 });
    // A 1 s window can hold no whole interval at 1 Hz (the bug: "0 FPS, CPU 0.0").
    const sum = s.summary(4000, 3100);
    expect(sum.fps).toBeCloseTo(1, 6);
    expect(sum.cpuMs).toBeCloseTo(0.4, 6);
  });
});
