// The ISS for its camera (issView.ts): NASA's model (public/models/iss.glb, from NASA 3D
// Resources' "International Space Station (ISS) (A)", NASA Ames; see scripts/bake-iss-model.mjs)
// cut into the parts that move, and posed from the telemetry.
//
//   body     everything inboard of the solar alpha rotary joints (SARJs)
//   port     the port truss outboard of its SARJ, which turns about the truss to follow the
//   stbd     Sun once an orbit; starboard likewise
//   wings    the eight solar array wings on them, each turned about its own mast by its beta
//            gimbal (BGA), named by power channel (1A, 3A, 3B, 1B starboard; 2A, 4A, 4B, 2B port)
//
// Model space, after the file's node transform, as measured from the model: x along the
// truss (+x port), y zenith, z forward. The truss runs along y = 1.49, z = 0.27; the wings lie
// in the plane z ≈ 0.27 on masts at x = ±8.35 (P4/S4) and ±11.69 (P6/S6), one wing toward
// zenith and one toward nadir on each. 25.6 units tip to tip, the real station's ~109 m.
//
// The joint angles' conventions, from the live stream on 2026-10-23 while the arrays tracked
// the Sun (22:19–22:21Z): the direction the arrays face, as a turn about the body's +Y
// (starboard) axis from +X (forward), was starboard SARJ + 90° = 90° − port SARJ, to 0.03°.
// The two wings on a mast read mirrored BGA angles (sum 360°) about 180° to starboard and 0°
// to port, so they share one physical tilt; which way that tilt leans (toward the orbit's
// north or south) couldn't be checked, the arrays then being parked ~46° off the Sun.

import type { Vec3 } from './vec';

export type Wing = '1A' | '3A' | '3B' | '1B' | '2A' | '4A' | '4B' | '2B';
export type IssPart = 'body' | 'port' | 'stbd' | Wing;
type Side = 'port' | 'stbd';

/** The truss line (y, z) in model space; the SARJs turn the outboard truss about it. */
const TRUSS_Y = 1.49;
const TRUSS_Z = 0.27;
/** Outboard of this |x|, the truss turns with its SARJ. */
const SARJ_X = 5.5;
/** Model units to metres: 25.62 units tip to tip, ~109 m on the station. */
export const ISS_METRES_PER_UNIT = 109 / 25.62;

/** Each wing: its side, its mast's x, and whether it reaches toward zenith (+y) as modelled. */
export const WINGS: readonly { wing: Wing; side: Side; mastX: number; up: boolean }[] = [
  { wing: '1A', side: 'stbd', mastX: -8.35, up: true },
  { wing: '3A', side: 'stbd', mastX: -8.35, up: false },
  { wing: '3B', side: 'stbd', mastX: -11.69, up: true },
  { wing: '1B', side: 'stbd', mastX: -11.69, up: false },
  { wing: '2A', side: 'port', mastX: 8.35, up: true },
  { wing: '4A', side: 'port', mastX: 8.35, up: false },
  { wing: '4B', side: 'port', mastX: 11.69, up: true },
  { wing: '2B', side: 'port', mastX: 11.69, up: false },
];

/**
 * Which tilt a BGA reading means, ±1. The mirrored readings fix every wing's tilt relative to
 * the others; this sets which way they all lean, which the stream hasn't yet shown (see top).
 */
const BGA_SIGN = 1;

// ---- reading the GLB -------------------------------------------------------------------

export interface MeshPrimitive {
  material: string;
  /** Linear RGB. */
  color: Vec3;
  /** Model space (the node transforms applied). */
  positions: Float32Array;
  normals: Float32Array;
  indices: Uint16Array | Uint32Array | Uint8Array;
}

interface GltfJson {
  scene?: number;
  scenes: { nodes: number[] }[];
  nodes: { mesh?: number; children?: number[]; matrix?: number[]; translation?: number[]; rotation?: number[]; scale?: number[] }[];
  meshes: { primitives: { attributes: Record<string, number>; indices?: number; material?: number; mode?: number }[] }[];
  materials?: { name?: string; pbrMetallicRoughness?: { baseColorFactor?: number[] } }[];
  accessors: { bufferView: number; byteOffset?: number; componentType: number; count: number; type: string }[];
  bufferViews: { byteOffset?: number; byteLength: number; byteStride?: number }[];
}

/** A column-major 4×4, as glTF writes them. */
type Mat4 = number[];

const IDENTITY: Mat4 = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

function mul4(a: Mat4, b: Mat4): Mat4 {
  const out = new Array<number>(16);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) out[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
  return out;
}

function nodeMatrix(n: GltfJson['nodes'][number]): Mat4 {
  if (n.matrix) return n.matrix;
  const [x, y, z, w] = n.rotation ?? [0, 0, 0, 1];
  const [sx, sy, sz] = n.scale ?? [1, 1, 1];
  const [tx, ty, tz] = n.translation ?? [0, 0, 0];
  return [
    (1 - 2 * (y * y + z * z)) * sx, 2 * (x * y + z * w) * sx, 2 * (x * z - y * w) * sx, 0,
    2 * (x * y - z * w) * sy, (1 - 2 * (x * x + z * z)) * sy, 2 * (y * z + x * w) * sy, 0,
    2 * (x * z + y * w) * sz, 2 * (y * z - x * w) * sz, (1 - 2 * (x * x + y * y)) * sz, 0,
    tx, ty, tz, 1,
  ];
}

const COMPONENTS: Record<string, number> = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 };

function readAccessor(json: GltfJson, bin: DataView, index: number): Float32Array | Uint32Array | Uint16Array | Uint8Array {
  const a = json.accessors[index];
  const view = json.bufferViews[a.bufferView];
  const n = COMPONENTS[a.type];
  const size = { 5126: 4, 5125: 4, 5123: 2, 5121: 1 }[a.componentType];
  if (!n || !size) throw new Error(`glb: accessor ${index} has an unsupported type`);
  const stride = view.byteStride ?? n * size;
  const base = (view.byteOffset ?? 0) + (a.byteOffset ?? 0);
  const out =
    a.componentType === 5126 ? new Float32Array(a.count * n) : a.componentType === 5125 ? new Uint32Array(a.count * n) : a.componentType === 5123 ? new Uint16Array(a.count * n) : new Uint8Array(a.count * n);
  for (let i = 0; i < a.count; i++) {
    for (let k = 0; k < n; k++) {
      const at = base + i * stride + k * size;
      out[i * n + k] =
        a.componentType === 5126 ? bin.getFloat32(at, true) : a.componentType === 5125 ? bin.getUint32(at, true) : a.componentType === 5123 ? bin.getUint16(at, true) : bin.getUint8(at);
    }
  }
  return out;
}

/**
 * A binary glTF's triangles, in model space: each primitive's positions and normals with its
 * nodes' transforms applied, its indices, and its material's base colour. Enough for a model
 * with flat materials (no textures, skins or morphs), like NASA's ISS.
 */
export function parseGlb(buffer: ArrayBuffer): MeshPrimitive[] {
  const dv = new DataView(buffer);
  if (dv.getUint32(0, true) !== 0x46546c67) throw new Error('glb: not a binary glTF');
  let json: GltfJson | undefined;
  let bin: DataView | undefined;
  for (let off = 12; off + 8 <= buffer.byteLength; ) {
    const len = dv.getUint32(off, true);
    const type = dv.getUint32(off + 4, true);
    if (type === 0x4e4f534a) json = JSON.parse(new TextDecoder().decode(new Uint8Array(buffer, off + 8, len)));
    else if (type === 0x004e4942) bin = new DataView(buffer, off + 8, len);
    off += 8 + len;
  }
  if (!json || !bin) throw new Error('glb: missing its JSON or binary chunk');
  const out: MeshPrimitive[] = [];
  const visit = (index: number, parent: Mat4) => {
    const node = json!.nodes[index];
    const m = mul4(parent, nodeMatrix(node));
    if (node.mesh !== undefined) {
      for (const p of json!.meshes[node.mesh].primitives) {
        if ((p.mode ?? 4) !== 4 || p.attributes.POSITION === undefined || p.attributes.NORMAL === undefined) continue;
        const pos = readAccessor(json!, bin!, p.attributes.POSITION) as Float32Array;
        const nrm = readAccessor(json!, bin!, p.attributes.NORMAL) as Float32Array;
        const count = pos.length / 3;
        const indices = p.indices !== undefined ? (readAccessor(json!, bin!, p.indices) as Uint16Array | Uint32Array | Uint8Array) : Uint32Array.from({ length: count }, (_, i) => i);
        for (let i = 0; i < count; i++) {
          const [x, y, z] = [pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]];
          for (let r = 0; r < 3; r++) pos[i * 3 + r] = m[r] * x + m[4 + r] * y + m[8 + r] * z + m[12 + r];
          // Normals turn with the node (scale is uniform in this model), then are made unit again.
          const [nx, ny, nz] = [nrm[i * 3], nrm[i * 3 + 1], nrm[i * 3 + 2]];
          const t = [0, 1, 2].map((r) => m[r] * nx + m[4 + r] * ny + m[8 + r] * nz);
          const len = Math.hypot(t[0], t[1], t[2]) || 1;
          for (let r = 0; r < 3; r++) nrm[i * 3 + r] = t[r] / len;
        }
        const mat = p.material !== undefined ? json!.materials?.[p.material] : undefined;
        const c = mat?.pbrMetallicRoughness?.baseColorFactor ?? [0.8, 0.8, 0.8, 1];
        out.push({ material: mat?.name ?? '', color: [c[0], c[1], c[2]], positions: pos, normals: nrm, indices });
      }
    }
    for (const child of node.children ?? []) visit(child, m);
  };
  for (const n of json.scenes[json.scene ?? 0].nodes) visit(n, IDENTITY);
  return out;
}

// ---- cutting it into parts ---------------------------------------------------------------

/** Which part a triangle belongs to, by its centre (model space) and its material. */
export function partOf(c: Vec3, material: string): IssPart {
  if (Math.abs(c[0]) < SARJ_X) return 'body';
  const side: Side = c[0] > 0 ? 'port' : 'stbd';
  // A wing: its blankets and mast, clear of the truss and in the arrays' plane (the radiators
  // beside the masts lie just above the truss and reach forward, so they stay on the SARJ).
  const off = c[1] - TRUSS_Y;
  if ((material === 'ISSSolarPanels' || material === 'ISSMetal1') && Math.abs(c[2] - TRUSS_Z) < 0.6 && Math.abs(off) > 0.75) {
    const w = WINGS.find((w) => w.side === side && w.up === off > 0 && Math.abs(c[0] - w.mastX) < 1.3);
    if (w) return w.wing;
  }
  return side;
}

/** Each part's triangles, unindexed: positions, normals and linear colours, three floats each. */
export type IssParts = Map<IssPart, { positions: Float32Array; normals: Float32Array; colors: Float32Array }>;

export function splitIss(prims: MeshPrimitive[]): IssParts {
  const acc = new Map<IssPart, { p: number[]; n: number[]; c: number[] }>();
  for (const prim of prims) {
    const { positions: P, normals: N, indices: I, color } = prim;
    for (let t = 0; t + 2 < I.length; t += 3) {
      const v = [I[t], I[t + 1], I[t + 2]];
      const mid = (k: number) => (P[v[0] * 3 + k] + P[v[1] * 3 + k] + P[v[2] * 3 + k]) / 3;
      const c: Vec3 = [mid(0), mid(1), mid(2)];
      const part = partOf(c, prim.material);
      let a = acc.get(part);
      if (!a) acc.set(part, (a = { p: [], n: [], c: [] }));
      for (const i of v) {
        a.p.push(P[i * 3], P[i * 3 + 1], P[i * 3 + 2]);
        a.n.push(N[i * 3], N[i * 3 + 1], N[i * 3 + 2]);
        a.c.push(...color);
      }
    }
  }
  return new Map([...acc].map(([k, a]) => [k, { positions: new Float32Array(a.p), normals: new Float32Array(a.n), colors: new Float32Array(a.c) }]));
}

// ---- posing it ---------------------------------------------------------------------------

/** What the joints are doing, physically, degrees. */
export interface IssJointAngles {
  /** Where each side's arrays face: a turn about the body's +Y axis from +X (forward). */
  facing: Record<Side, number>;
  /** Each wing's tilt about its mast (toward +x in model space for a wing facing forward). */
  tilt: Record<Wing, number>;
}

/** The telemetry's readings (degrees), as isslive.ts's issJoints gives them. */
export interface IssJointReadings {
  sarjStarboard: number;
  sarjPort: number;
  bga: Partial<Record<Wing, number>>;
}

const wrap180 = (d: number) => ((((d + 180) % 360) + 360) % 360) - 180;

export function jointsFromTelemetry(r: IssJointReadings): IssJointAngles {
  const wrap360 = (d: number) => ((d % 360) + 360) % 360;
  const facing = { stbd: wrap360(r.sarjStarboard + 90), port: wrap360(90 - r.sarjPort) };
  const tilt = {} as Record<Wing, number>;
  for (const w of WINGS) {
    const reading = r.bga[w.wing];
    // Starboard reads about 180°, port about 0° and mirrored; a mast's two wings mirror again.
    tilt[w.wing] = reading === undefined ? 0 : BGA_SIGN * (w.side === 'stbd' ? 1 : -1) * (w.up ? 1 : -1) * wrap180(reading - (w.side === 'stbd' ? 180 : 0));
  }
  return { facing, tilt };
}

/** The joints as if every array faced the Sun squarely (`sun`: its direction in the body frame). */
export function sunTrackingJoints(sun: Vec3): IssJointAngles {
  const len = Math.hypot(...sun) || 1;
  const a = (Math.atan2(-sun[2], sun[0]) * 180) / Math.PI;
  // Model +x is the body's −Y, so the Sun's −Y component is how far the blankets tip toward +x.
  const lean = (Math.asin(Math.max(-1, Math.min(1, -sun[1] / len))) * 180) / Math.PI;
  const tilt = {} as Record<Wing, number>;
  for (const w of WINGS) tilt[w.wing] = lean;
  return { facing: { stbd: a, port: a }, tilt };
}

/** An affine map: a 3×3 (row-major) and then a translation. */
interface Affine {
  r: number[];
  t: Vec3;
}

const compose = (a: Affine, b: Affine): Affine => {
  const r = new Array<number>(9);
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) r[i * 3 + j] = a.r[i * 3] * b.r[j] + a.r[i * 3 + 1] * b.r[3 + j] + a.r[i * 3 + 2] * b.r[6 + j];
  const row = (i: number) => a.r[i * 3] * b.t[0] + a.r[i * 3 + 1] * b.t[1] + a.r[i * 3 + 2] * b.t[2] + a.t[i];
  return { r, t: [row(0), row(1), row(2)] };
};
const translate = (t: Vec3): Affine => ({ r: [1, 0, 0, 0, 1, 0, 0, 0, 1], t });
const about = (axis: 'x' | 'y', deg: number, through: Vec3): Affine => {
  const c = Math.cos((deg * Math.PI) / 180);
  const s = Math.sin((deg * Math.PI) / 180);
  const r = axis === 'x' ? [1, 0, 0, 0, c, -s, 0, s, c] : [c, 0, s, 0, 1, 0, -s, 0, c];
  return compose(translate(through), compose({ r, t: [0, 0, 0] }, translate([-through[0], -through[1], -through[2]])));
};

/**
 * Model space to the body frame (x forward, y starboard, z nadir) in metres, about the truss's
 * middle: body x = model z, body y = −model x, body z = −model y.
 */
const MODEL_TO_BODY: Affine = compose(
  { r: [0, 0, 1, -1, 0, 0, 0, -1, 0].map((v) => v * ISS_METRES_PER_UNIT), t: [0, 0, 0] },
  translate([0, -TRUSS_Y, -TRUSS_Z]),
);

/** LVLH from the body frame: the transpose of the attitude quaternion's matrix (scalar first). */
function lvlhFromBody(q: readonly number[]): Affine {
  const [q0, q1, q2, q3] = q;
  const n = Math.hypot(q0, q1, q2, q3) || 1;
  const [a, b, c, d] = [q0 / n, q1 / n, q2 / n, q3 / n];
  // C (LVLH → body), as NASA's and the ISS Mimic's dashboards decode it; its transpose goes back.
  const C = [
    a * a + b * b - c * c - d * d, 2 * (b * c + a * d), 2 * (b * d - a * c),
    2 * (b * c - a * d), a * a - b * b + c * c - d * d, 2 * (c * d + a * b),
    2 * (b * d + a * c), 2 * (c * d - a * b), a * a - b * b - c * c + d * d,
  ];
  return { r: [C[0], C[3], C[6], C[1], C[4], C[7], C[2], C[5], C[8]], t: [0, 0, 0] };
}

/** A column-major 4×4 for WebGL from an affine map. */
const toMat4 = (a: Affine) => new Float32Array([a.r[0], a.r[3], a.r[6], 0, a.r[1], a.r[4], a.r[7], 0, a.r[2], a.r[5], a.r[8], 0, a.t[0], a.t[1], a.t[2], 1]);

/**
 * Each part's matrix, model space to LVLH metres (x forward, y right, z down) about the
 * station's middle: a wing turns on its mast, then with its side about the truss, then the
 * whole station takes its attitude (`q`, relative to LVLH, scalar first; level without it).
 */
export function issPartMatrices(j: IssJointAngles, q?: readonly number[]): Map<IssPart, Float32Array> {
  const station = compose(q ? lvlhFromBody(q) : { r: [1, 0, 0, 0, 1, 0, 0, 0, 1], t: [0, 0, 0] }, MODEL_TO_BODY);
  // Turning by `a` about body +Y is turning by −a about model +x (body +Y is model −x).
  const sideOf = (side: Side) => compose(station, about('x', -j.facing[side], [0, TRUSS_Y, TRUSS_Z]));
  const sides = { port: sideOf('port'), stbd: sideOf('stbd') };
  const out = new Map<IssPart, Float32Array>([
    ['body', toMat4(station)],
    ['port', toMat4(sides.port)],
    ['stbd', toMat4(sides.stbd)],
  ]);
  // As modelled the blankets face ±z (body ±X), so facing 0° is the model's own pose.
  for (const w of WINGS) out.set(w.wing, toMat4(compose(sides[w.side], about('y', j.tilt[w.wing], [w.mastX, 0, TRUSS_Z]))));
  return out;
}
