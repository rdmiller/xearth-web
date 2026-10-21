// Web Worker: SGP4 for the whole Starlink group (~10,700 satellites, ~20 ms
// a pass on a desktop, several times that on a phone) off the main thread.
// Each pass returns positions and Earth-fixed velocities; the renderer
// extrapolates between passes, so passes can be infrequent.

import type { SatRec } from 'satellite.js';
import { propagateAll, satrecFor, type Elements } from './satellites';

export type WorkerRequest = { type: 'load'; elements: Elements[] } | { type: 'propagate'; time: number };

export type WorkerResponse =
  | { type: 'loaded'; count: number; valid: number }
  | { type: 'positions'; time: number; positions: Float32Array; velocities: Float32Array; ok: number };

const ctx = self as unknown as {
  onmessage: ((e: MessageEvent<WorkerRequest>) => void) | null;
  postMessage(message: WorkerResponse, transfer?: Transferable[]): void;
};

let recs: (SatRec | null)[] = [];

ctx.onmessage = (e) => {
  const msg = e.data;
  if (msg.type === 'load') {
    recs = msg.elements.map(satrecFor);
    ctx.postMessage({ type: 'loaded', count: recs.length, valid: recs.filter(Boolean).length });
  } else {
    const positions = new Float32Array(recs.length * 3);
    const velocities = new Float32Array(recs.length * 3);
    const ok = propagateAll(recs, new Date(msg.time), positions, velocities);
    ctx.postMessage({ type: 'positions', time: msg.time, positions, velocities, ok }, [
      positions.buffer,
      velocities.buffer,
    ]);
  }
};
