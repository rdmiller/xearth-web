// Web Worker: SGP4 for every bulk satellite (Starlink's ~11,100 plus the weather,
// GPS and GLONASS constellations; ~20 ms a pass on a desktop, several times that on
// a phone) off the main thread. Categories that are switched off are skipped.
// Each pass returns positions and Earth-fixed velocities; the renderer
// extrapolates between passes, so passes can be infrequent.

import type { SatRec } from 'satellite.js';
import { propagateAll, satrecFor, type Elements } from './satellites';

export type WorkerRequest =
  | { type: 'load'; elements: Elements[]; category: Uint8Array }
  | { type: 'propagate'; time: number; active: boolean[] };

export type WorkerResponse =
  | { type: 'loaded'; count: number; valid: number }
  | { type: 'positions'; time: number; positions: Float32Array; velocities: Float32Array; ok: number };

const ctx = self as unknown as {
  onmessage: ((e: MessageEvent<WorkerRequest>) => void) | null;
  postMessage(message: WorkerResponse, transfer?: Transferable[]): void;
};

let recs: (SatRec | null)[] = [];
let category: Uint8Array = new Uint8Array(0);

ctx.onmessage = (e) => {
  const msg = e.data;
  if (msg.type === 'load') {
    recs = msg.elements.map(satrecFor);
    category = msg.category;
    ctx.postMessage({ type: 'loaded', count: recs.length, valid: recs.filter(Boolean).length });
  } else {
    const positions = new Float32Array(recs.length * 3);
    const velocities = new Float32Array(recs.length * 3);
    const live = recs.map((r, i) => (msg.active[category[i]] ? r : null));
    const ok = propagateAll(live, new Date(msg.time), positions, velocities);
    ctx.postMessage({ type: 'positions', time: msg.time, positions, velocities, ok }, [
      positions.buffer,
      velocities.buffer,
    ]);
  }
};
