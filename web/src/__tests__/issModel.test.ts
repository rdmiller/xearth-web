/// <reference types="node" />
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { issPartMatrices, jointsFromTelemetry, parseGlb, partOf, splitIss, sunTrackingJoints, WINGS, type IssPart } from '../issModel';
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

  it("reads NASA's model: six materials, ~6,600 triangles, 25.6 units tip to tip", () => {
    expect(prims.map((p) => p.material).sort()).toEqual(['Brown', 'ISSDarkMetal', 'ISSGray2', 'ISSMetal1', 'ISSSolarPanels', 'ISSWhiteMetal']);
    expect(prims.reduce((n, p) => n + p.indices.length / 3, 0)).toBe(6642);
    const xs = prims.flatMap((p) => Array.from(p.positions.filter((_, i) => i % 3 === 0)));
    expect(Math.min(...xs)).toBeCloseTo(-12.81, 1);
    expect(Math.max(...xs)).toBeCloseTo(12.81, 1);
    for (const p of prims) for (let i = 0; i < p.normals.length; i += 3) expect(Math.hypot(p.normals[i], p.normals[i + 1], p.normals[i + 2])).toBeCloseTo(1, 4);
  });

  it('cuts it into the body, two sides and eight wings, losing no triangle', () => {
    const parts = splitIss(prims);
    expect([...parts.keys()].sort()).toEqual(['1A', '1B', '2A', '2B', '3A', '3B', '4A', '4B', 'body', 'port', 'stbd'].sort());
    const triangles = [...parts.values()].reduce((n, p) => n + p.positions.length / 9, 0);
    expect(triangles).toBe(6642);
    // Each wing has its two blankets (48 vertices each, 2 × 16 triangles at least) and they're all alike.
    const sizes = WINGS.map((w) => parts.get(w.wing)!.positions.length / 9);
    expect(Math.min(...sizes)).toBeGreaterThanOrEqual(32);
    expect(new Set(sizes).size).toBeLessThanOrEqual(2);
  });

  it('keeps the radiators on the SARJ and the blankets on their wings', () => {
    // A radiator by the inner port mast: just above the truss, reaching forward.
    expect(partOf([7.9, 1.6, 2.5], 'ISSGray2')).toBe('port');
    expect(partOf([8.0, 5.0, 0.27], 'ISSSolarPanels')).toBe('2A');
    expect(partOf([-11.2, -3.0, 0.27], 'ISSSolarPanels')).toBe('1B');
    expect(partOf([3.0, 1.49, 0.27], 'ISSMetal1')).toBe('body');
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
      const onTruss: Vec3 = [side === 'port' ? 9 : -9, 1.49, 0.27];
      const a = point(m.get('body')!, onTruss);
      const b = point(m.get(side)!, onTruss);
      for (let k = 0; k < 3; k++) expect(b[k]).toBeCloseTo(a[k], 6);
    }
  });

  it('faces a wing as its SARJ says: forward at 270° starboard, and round about the body y axis', () => {
    for (const sarj of [270, 0, 57.5]) {
      const m = issPartMatrices(jointsFromTelemetry({ sarjStarboard: sarj, sarjPort: 360 - sarj, bga: {} }));
      const a = ((sarj + 90) * Math.PI) / 180;
      for (const wing of ['1A', '2B'] as IssPart[]) {
        const n = direction(m.get(wing)!, [0, 0, 1]);
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
      for (const w of WINGS) expect(dot(direction(m.get(w.wing)!, [0, 0, 1]), sun)).toBeCloseTo(1, 6);
    }
  });

  it('takes the attitude quaternion as a rotation, in metres', () => {
    const q = [0.9971362948417664, 0.006585242692381144, -0.06696869432926178, -0.03449666127562523];
    const m = issPartMatrices(sunTrackingJoints([1, 0, 0]), q).get('body')!;
    const cols = [0, 1, 2].map((c) => [m[c * 4], m[c * 4 + 1], m[c * 4 + 2]] as Vec3);
    const k = Math.hypot(...cols[0]);
    expect(k).toBeCloseTo(109 / 25.62, 6);
    expect(dot(cols[0], cols[1]) / k / k).toBeCloseTo(0, 6);
    // About 8° of pitch: model +z (the body's forward) tips well off LVLH +x but stays near it.
    const fwd = direction(m, [0, 0, 1]);
    expect(fwd[0]).toBeGreaterThan(0.98);
    expect(fwd[0]).toBeLessThan(0.999);
  });
});
