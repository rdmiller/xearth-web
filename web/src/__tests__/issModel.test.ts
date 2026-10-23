/// <reference types="node" />
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ISS_BLANKET_NORMAL, issPartMatrices, jointsFromTelemetry, parseGlb, partOf, splitIss, sunTrackingJoints, WINGS, type IssPart } from '../issModel';
import type { Vec3 } from '../vec';

// The committed model itself.
const glb = readFileSync(new URL('../../public/models/iss.glb', import.meta.url));
const buffer = glb.buffer.slice(glb.byteOffset, glb.byteOffset + glb.byteLength);

/** A matrix applied to a point, and to a direction (made unit). */
const point = (m: Float32Array, p: Vec3): Vec3 => {
  const row = (r: number) => m[r] * p[0] + m[4 + r] * p[1] + m[8 + r] * p[2] + m[12 + r];
  return [row(0), row(1), row(2)];
};
const direction = (m: Float32Array, d: Vec3): Vec3 => {
  const v = [0, 1, 2].map((r) => m[r] * d[0] + m[4 + r] * d[1] + m[8 + r] * d[2]);
  const n = Math.hypot(v[0], v[1], v[2]);
  return [v[0] / n, v[1] / n, v[2] / n];
};
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

describe('the ISS model', () => {
  const prims = parseGlb(buffer);

  it("reads NASA's quantized model: ~172,000 triangles, 45.5 units tip to tip, the strays gone", () => {
    expect(prims.reduce((n, p) => n + p.indices.length / 3, 0)).toBe(172200);
    expect(prims.some((p) => p.material === 'lambert7SG.001')).toBe(true);
    let lo = [Infinity, Infinity, Infinity];
    let hi = [-Infinity, -Infinity, -Infinity];
    for (const p of prims) {
      for (let i = 0; i < p.positions.length; i += 3) {
        for (let k = 0; k < 3; k++) {
          lo[k] = Math.min(lo[k], p.positions[i + k]);
          hi[k] = Math.max(hi[k], p.positions[i + k]);
        }
      }
    }
    // The quantized positions land within ~1 cm (the 14-bit step) of the original's.
    expect(lo[2]).toBeCloseTo(-22.86, 1);
    expect(hi[2]).toBeCloseTo(22.68, 1);
    // Nothing up at y ≈ 41 any more, where the seven stray parts were.
    expect(hi[1]).toBeLessThan(26);
    for (const p of prims) {
      for (let i = 0; i < p.normals.length; i += 3 * 97) expect(Math.hypot(p.normals[i], p.normals[i + 1], p.normals[i + 2])).toBeCloseTo(1, 4);
    }
  });

  it('cuts it into the body, two sides and eight wings, losing no triangle', () => {
    const parts = splitIss(prims);
    expect([...parts.keys()].sort()).toEqual(['1A', '1B', '2A', '2B', '3A', '3B', '4A', '4B', 'body', 'port', 'stbd'].sort());
    const triangles = [...parts.values()].reduce((n, p) => n + p.positions.length / 9, 0);
    expect(triangles).toBe(172200);
    // Each wing is exactly its two blankets: 448 blanket triangles, 56 to a wing.
    for (const w of WINGS) expect(parts.get(w.wing)!.positions.length / 9).toBe(56);
  });

  it('keeps the hubs and radiators on the SARJ and the blankets on their wings', () => {
    // A radiator at the inner starboard mast, reaching toward nadir; a hub canister to port.
    expect(partOf([1.5, 10.75, 14.2], 'soyuz_blinn4SG.001')).toBe('stbd');
    expect(partOf([-1.0, 10.8, -14.9], 'anisotropic1SG.001')).toBe('port');
    expect(partOf([-1.09, 18, 14.0], 'lambert7SG.001')).toBe('1A');
    expect(partOf([-1.09, 3, 21.9], 'lambert7SG.001')).toBe('1B');
    expect(partOf([-1.09, 3, -21.0], 'lambert7SG.001')).toBe('2B');
    expect(partOf([0, 5, 3], 'anisotropic1SG.001')).toBe('body');
  });
});

describe('posing the ISS', () => {
  // The live stream at 2026-10-23T22:19:21Z, when the Sun was 147.77° round from forward.
  const SAMPLE = {
    sarjStarboard: 57.506675720214844,
    sarjPort: 302.471923828125,
    bga: { '1A': 133.4, '3A': 226.5, '3B': 133.4, '1B': 226.7, '2A': 46.2, '4A': 313.6, '4B': 47.0, '2B': 309.4 },
  };

  it("reads the SARJs as where the arrays face, both sides agreeing with the Sun's place", () => {
    const j = jointsFromTelemetry(SAMPLE);
    expect(j.facing.stbd).toBeCloseTo(147.51, 1);
    expect(j.facing.port).toBeCloseTo(147.53, 1);
  });

  it('reads the mirrored BGAs as the same lean on all eight wings', () => {
    // That afternoon every wing leaned 46–51° the same way (2B the most), parked off the Sun.
    const tilts = Object.values(jointsFromTelemetry(SAMPLE).tilt);
    expect(tilts).toHaveLength(8);
    for (const t of tilts) expect(Math.sign(t)).toBe(Math.sign(tilts[0]));
    for (const t of tilts) expect(Math.abs(t)).toBeGreaterThan(45);
    for (const t of tilts) expect(Math.abs(t)).toBeLessThan(52);
  });

  it('turns the arrays about the truss, so the truss line stays put', () => {
    const m = issPartMatrices(jointsFromTelemetry(SAMPLE));
    for (const side of ['port', 'stbd'] as const) {
      const onTruss: Vec3 = [-1.09, 10.8, side === 'port' ? -18 : 18];
      const a = point(m.get('body')!, onTruss);
      const b = point(m.get(side)!, onTruss);
      // Float32 matrices, points ~40 m out: equal to well under a millimetre.
      for (let k = 0; k < 3; k++) expect(b[k]).toBeCloseTo(a[k], 4);
    }
  });

  it('faces a wing as its SARJ says: forward at 270° starboard, and round about the body y axis', () => {
    for (const sarj of [270, 0, 57.5]) {
      const m = issPartMatrices(jointsFromTelemetry({ sarjStarboard: sarj, sarjPort: 360 - sarj, bga: {} }));
      const a = ((sarj + 90) * Math.PI) / 180;
      for (const wing of ['1A', '2B'] as IssPart[]) {
        const n = direction(m.get(wing)!, ISS_BLANKET_NORMAL);
        expect(Math.abs(dot(n, [Math.cos(a), 0, -Math.sin(a)]))).toBeCloseTo(1, 6);
      }
    }
  });

  it('turned to the Sun, every blanket faces it squarely', () => {
    const suns: Vec3[] = [
      [-0.846, -0.013, -0.533],
      [0.3, 0.5, 0.8],
      [0, -0.9, 0.2],
    ];
    for (const s of suns) {
      const len = Math.hypot(...s);
      const sun: Vec3 = [s[0] / len, s[1] / len, s[2] / len];
      const m = issPartMatrices(sunTrackingJoints(sun));
      for (const w of WINGS) expect(dot(direction(m.get(w.wing)!, ISS_BLANKET_NORMAL), sun)).toBeCloseTo(1, 6);
    }
  });

  it('takes the attitude quaternion as a rotation, in metres', () => {
    const q = [0.9971362948417664, 0.006585242692381144, -0.06696869432926178, -0.03449666127562523];
    const m = issPartMatrices(sunTrackingJoints([1, 0, 0]), q).get('body')!;
    const cols = [0, 1, 2].map((c) => [m[c * 4], m[c * 4 + 1], m[c * 4 + 2]] as Vec3);
    const k = Math.hypot(...cols[0]);
    expect(k).toBeCloseTo(109 / 45.54, 6);
    expect(dot(cols[0], cols[1]) / k / k).toBeCloseTo(0, 6);
    // About 8° of pitch: model +y (the body's forward) tips well off LVLH +x but stays near it.
    const fwd = direction(m, [0, 1, 0]);
    expect(fwd[0]).toBeGreaterThan(0.98);
    expect(fwd[0]).toBeLessThan(0.999);
  });
});
