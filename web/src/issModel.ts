// The ISS for its camera (issView.ts): NASA's model (public/models/iss.glb, from NASA 3D
// Resources' "International Space Station (ISS) (B)", NASA / Michael D. Carbajal; see
// scripts/bake-iss-model.mjs) cut into the parts that move, and posed from the telemetry.
//
//   body     everything inboard of the solar alpha rotary joints (SARJs)
//   port     the port truss outboard of its SARJ, which turns about the truss to follow the
//   stbd     Sun once an orbit; starboard likewise
//   wings    the eight solar array wings on them, each turned about its own mast by its beta
//            gimbal (BGA), named by power channel (1A, 3A, 3B, 1B starboard; 2A, 4A, 4B, 2B port)
//
// Model space, after the file's node transforms, as measured from the model: x nadir, y
// forward, z along the truss (+z starboard: Kibo, with its exposed platform, is at −z). The
// truss runs along x = −1.09, y = 10.80; the sixteen blankets lie in the plane x ≈ −1.09 in
// pairs either side of masts at z = −21.165 (P6), −14.875 (P4), 14.685 (S4) and 20.985 (S6),
// one wing reaching forward and one aft on each, all facing zenith as modelled. 45.5 units tip
// to tip, the real station's ~109 m.
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

/** The truss line (x, y) in model space; the SARJs turn the outboard truss about it. */
const TRUSS_X = -1.09;
const TRUSS_Y = 10.8;
/** Outboard of this |z|, the truss turns with its SARJ (the batteries and radiators inboard don't). */
const SARJ_Z = 12;
/** The blankets' material. */
const BLANKETS = 'lambert7SG.001';
/** Model units to metres: 45.54 units tip to tip, ~109 m on the station. */
export const ISS_METRES_PER_UNIT = 109 / 45.54;
/** Where the arrays face as modelled (zenith: −model x, the body's −Z), as `facing` measures it. */
const MODELLED_FACING = 90;
/** The blankets' face as modelled, model space: toward zenith. */
export const ISS_BLANKET_NORMAL: Vec3 = [-1, 0, 0];

/** Each wing: its side, its mast's z, and whether it reaches forward (+y) as modelled. */
export const WINGS: readonly { wing: Wing; side: Side; mastZ: number; fore: boolean }[] = [
  { wing: '1A', side: 'stbd', mastZ: 14.685, fore: true },
  { wing: '3A', side: 'stbd', mastZ: 14.685, fore: false },
  { wing: '3B', side: 'stbd', mastZ: 20.985, fore: true },
  { wing: '1B', side: 'stbd', mastZ: 20.985, fore: false },
  { wing: '2A', side: 'port', mastZ: -14.875, fore: true },
  { wing: '4A', side: 'port', mastZ: -14.875, fore: false },
  { wing: '4B', side: 'port', mastZ: -21.165, fore: true },
  { wing: '2B', side: 'port', mastZ: -21.165, fore: false },
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
  indices: Uint32Array;
}

interface GltfJson {
  scene?: number;
  scenes: { nodes: number[] }[];
  nodes: { mesh?: number; children?: number[]; matrix?: number[]; translation?: number[]; rotation?: number[]; scale?: number[] }[];
  meshes: { primitives: { attributes: Record<string, number>; indices?: number; material?: number; mode?: number }[] }[];
  materials?: { name?: string; pbrMetallicRoughness?: { baseColorFactor?: number[] } }[];
  accessors: { bufferView: number; byteOffset?: number; componentType: number; count: number; type: string; normalized?: boolean }[];
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

type TypedArrayOf = Float32ArrayConstructor | Uint32ArrayConstructor | Uint16ArrayConstructor | Int16ArrayConstructor | Uint8ArrayConstructor | Int8ArrayConstructor;

/** Each component type: its array, size, and largest value (what a normalized one divides by). */
const COMPONENT_TYPES: Record<number, { array: TypedArrayOf; size: number; max: number }> = {
  5126: { array: Float32Array, size: 4, max: 1 },
  5125: { array: Uint32Array, size: 4, max: 4294967295 },
  5123: { array: Uint16Array, size: 2, max: 65535 },
  5122: { array: Int16Array, size: 2, max: 32767 },
  5121: { array: Uint8Array, size: 1, max: 255 },
  5120: { array: Int8Array, size: 1, max: 127 },
};

/**
 * An accessor's values: indices as integers, everything else as floats, normalized integers
 * (KHR_mesh_quantization's positions and normals) turned back into −1…1.
 */
function readAccessor(json: GltfJson, bin: DataView, index: number): Float32Array | Uint32Array {
  const a = json.accessors[index];
  const view = json.bufferViews[a.bufferView];
  const n = COMPONENTS[a.type];
  const t = COMPONENT_TYPES[a.componentType];
  if (!n || !t) throw new Error(`glb: accessor ${index} has an unsupported type`);
  const stride = view.byteStride ?? n * t.size;
  const start = bin.byteOffset + (view.byteOffset ?? 0) + (a.byteOffset ?? 0);
  // glTF aligns accessors to their component size, so the data reads as a typed array (in
  // elements: stride / size apart), little-endian like every browser's.
  if (start % t.size || stride % t.size) throw new Error(`glb: accessor ${index} isn't aligned`);
  // (The binary chunk is a view of the fetched ArrayBuffer, never shared memory.)
  const src = new t.array(bin.buffer as ArrayBuffer, start, ((a.count - 1) * stride) / t.size + n);
  const step = stride / t.size;
  const integer = a.type === 'SCALAR' && !a.normalized && a.componentType !== 5126;
  const out = integer ? new Uint32Array(a.count * n) : new Float32Array(a.count * n);
  const scale = a.normalized ? 1 / t.max : 1;
  for (let i = 0; i < a.count; i++) {
    for (let k = 0; k < n; k++) {
      const v = src[i * step + k] * scale;
      out[i * n + k] = a.normalized && v < -1 ? -1 : v;
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
        const indices = p.indices !== undefined ? (readAccessor(json!, bin!, p.indices) as Uint32Array) : Uint32Array.from({ length: count }, (_, i) => i);
        for (let i = 0; i < count * 3; i += 3) {
          const x = pos[i], y = pos[i + 1], z = pos[i + 2];
          pos[i] = m[0] * x + m[4] * y + m[8] * z + m[12];
          pos[i + 1] = m[1] * x + m[5] * y + m[9] * z + m[13];
          pos[i + 2] = m[2] * x + m[6] * y + m[10] * z + m[14];
          // Normals turn with the node (its scale is uniform, as quantization's is), then are made unit again.
          const nx = nrm[i], ny = nrm[i + 1], nz = nrm[i + 2];
          const tx = m[0] * nx + m[4] * ny + m[8] * nz;
          const ty = m[1] * nx + m[5] * ny + m[9] * nz;
          const tz = m[2] * nx + m[6] * ny + m[10] * nz;
          const len = Math.hypot(tx, ty, tz) || 1;
          nrm[i] = tx / len;
          nrm[i + 1] = ty / len;
          nrm[i + 2] = tz / len;
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
  // A wing is its blankets: the nearest mast's, forward or aft of the truss. (The hubs, mast
  // canisters and radiators at the masts stay on the SARJ.)
  if (material === BLANKETS) {
    const fore = c[1] > TRUSS_Y;
    const near = WINGS.filter((w) => w.fore === fore).reduce((a, b) => (Math.abs(c[2] - b.mastZ) < Math.abs(c[2] - a.mastZ) ? b : a));
    return near.wing;
  }
  if (Math.abs(c[2]) <= SARJ_Z) return 'body';
  return c[2] > 0 ? 'stbd' : 'port';
}

/** Each part's triangles, unindexed: positions, normals and linear colours, three floats each. */
export type IssParts = Map<IssPart, { positions: Float32Array; normals: Float32Array; colors: Float32Array }>;

/**
 * The model's colours (linear RGB). Its materials are all the same flat grey, so the main ones
 * get the station's own: copper-gold arrays, white radiators and modules, light grey nodes.
 */
const COLORS: Record<string, Vec3> = {
  'lambert7SG.001': [0.2, 0.11, 0.035], // the main arrays' blankets
  'lambert4SG.001': [0.02, 0.03, 0.08], // Zvezda's and Zarya's arrays: dark blue cells
  'lambert3SG.001': [0.75, 0.75, 0.73], // the big radiators
  'soyuz_blinn4SG.001': [0.75, 0.75, 0.73], // the radiators by the masts
  'anisotropic1SG.001': [0.6, 0.6, 0.58], // the truss, Columbus, Kibo, the drums and canisters
  'blinn1SG.001': [0.6, 0.6, 0.6], // the Lab, the nodes, the Russian modules
};

/** A vertex normal this far off its triangle's face (cosine) is a box corner's average: use the face's. */
const SMOOTH_COS = 0.7;

export function splitIss(prims: MeshPrimitive[]): IssParts {
  // Two passes, so each part's arrays are made once at their size (the model has ~172,000
  // triangles: growing plain arrays took ~0.4 s): which part each triangle is, then the copy.
  const keys: IssPart[] = [];
  const index = new Map<IssPart, number>();
  const counts: number[] = [];
  const of = prims.map((prim) => {
    const { positions: P, indices: I } = prim;
    const parts = new Uint8Array(I.length / 3);
    for (let t = 0; t < parts.length; t++) {
      const a = I[t * 3] * 3, b = I[t * 3 + 1] * 3, c = I[t * 3 + 2] * 3;
      const part = partOf([(P[a] + P[b] + P[c]) / 3, (P[a + 1] + P[b + 1] + P[c + 1]) / 3, (P[a + 2] + P[b + 2] + P[c + 2]) / 3], prim.material);
      let k = index.get(part);
      if (k === undefined) {
        index.set(part, (k = keys.length));
        keys.push(part);
        counts.push(0);
      }
      parts[t] = k;
      counts[k]++;
    }
    return parts;
  });
  const out = keys.map((_, k) => ({ positions: new Float32Array(counts[k] * 9), normals: new Float32Array(counts[k] * 9), colors: new Float32Array(counts[k] * 9), at: 0 }));
  prims.forEach((prim, pi) => {
    const { positions: P, normals: N, indices: I } = prim;
    const color = COLORS[prim.material] ?? prim.color;
    const parts = of[pi];
    for (let t = 0; t < parts.length; t++) {
      const o = out[parts[t]];
      const v0 = I[t * 3] * 3, v1 = I[t * 3 + 1] * 3, v2 = I[t * 3 + 2] * 3;
      // The face's own normal, for vertex normals that are a box corner's average (the model
      // smooths its boxes' corners, which would shade a flat face in diagonal halves).
      const e1x = P[v1] - P[v0], e1y = P[v1 + 1] - P[v0 + 1], e1z = P[v1 + 2] - P[v0 + 2];
      const e2x = P[v2] - P[v0], e2y = P[v2 + 1] - P[v0 + 1], e2z = P[v2 + 2] - P[v0 + 2];
      let fx = e1y * e2z - e1z * e2y, fy = e1z * e2x - e1x * e2z, fz = e1x * e2y - e1y * e2x;
      const flen = Math.hypot(fx, fy, fz) || 1;
      fx /= flen;
      fy /= flen;
      fz /= flen;
      for (const v of [v0, v1, v2]) {
        const at = o.at;
        o.positions[at] = P[v];
        o.positions[at + 1] = P[v + 1];
        o.positions[at + 2] = P[v + 2];
        const d = N[v] * fx + N[v + 1] * fy + N[v + 2] * fz;
        if (Math.abs(d) >= SMOOTH_COS) {
          o.normals[at] = N[v];
          o.normals[at + 1] = N[v + 1];
          o.normals[at + 2] = N[v + 2];
        } else {
          const sign = d < 0 ? -1 : 1;
          o.normals[at] = fx * sign;
          o.normals[at + 1] = fy * sign;
          o.normals[at + 2] = fz * sign;
        }
        o.colors[at] = color[0];
        o.colors[at + 1] = color[1];
        o.colors[at + 2] = color[2];
        o.at += 3;
      }
    }
  });
  return new Map(keys.map((key, k) => [key, { positions: out[k].positions, normals: out[k].normals, colors: out[k].colors }]));
}

// ---- posing it ---------------------------------------------------------------------------

/** What the joints are doing, physically, degrees. */
export interface IssJointAngles {
  /** Where each side's arrays face: a turn about the body's +Y axis from +X (forward). */
  facing: Record<Side, number>;
  /** Each wing's tilt about its mast: how far its blankets' face leans out of the X–Z plane, toward the body's −Y. */
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
    tilt[w.wing] = reading === undefined ? 0 : BGA_SIGN * (w.side === 'stbd' ? 1 : -1) * (w.fore ? 1 : -1) * wrap180(reading - (w.side === 'stbd' ? 180 : 0));
  }
  return { facing, tilt };
}

/** The joints as if every array faced the Sun squarely (`sun`: its direction in the body frame). */
export function sunTrackingJoints(sun: Vec3): IssJointAngles {
  const len = Math.hypot(...sun) || 1;
  const a = (Math.atan2(-sun[2], sun[0]) * 180) / Math.PI;
  // The Sun's −Y component is how far the blankets must lean out of the X–Z plane.
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
const about = (axis: 'x' | 'y' | 'z', deg: number, through: Vec3): Affine => {
  const c = Math.cos((deg * Math.PI) / 180);
  const s = Math.sin((deg * Math.PI) / 180);
  const r = axis === 'x' ? [1, 0, 0, 0, c, -s, 0, s, c] : axis === 'y' ? [c, 0, s, 0, 1, 0, -s, 0, c] : [c, -s, 0, s, c, 0, 0, 0, 1];
  return compose(translate(through), compose({ r, t: [0, 0, 0] }, translate([-through[0], -through[1], -through[2]])));
};

/**
 * Model space to the body frame (x forward, y starboard, z nadir) in metres, about the truss's
 * middle (z = −0.09, halfway between the array tips): body x = model y, body y = model z,
 * body z = model x.
 */
const MODEL_TO_BODY: Affine = compose(
  { r: [0, 1, 0, 0, 0, 1, 1, 0, 0].map((v) => v * ISS_METRES_PER_UNIT), t: [0, 0, 0] },
  translate([-TRUSS_X, -TRUSS_Y, 0.09]),
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
  // Body +Y is model +z, so the arrays turn about model z, from where they face as modelled.
  const sideOf = (side: Side) => compose(station, about('z', j.facing[side] - MODELLED_FACING, [TRUSS_X, TRUSS_Y, 0]));
  const sides = { port: sideOf('port'), stbd: sideOf('stbd') };
  const out = new Map<IssPart, Float32Array>([
    ['body', toMat4(station)],
    ['port', toMat4(sides.port)],
    ['stbd', toMat4(sides.stbd)],
  ]);
  // A wing turns about its mast (model y): by −tilt, its zenith face (−x) leans toward −z, the body's −Y.
  for (const w of WINGS) out.set(w.wing, toMat4(compose(sides[w.side], about('y', -j.tilt[w.wing], [TRUSS_X, 0, w.mastZ]))));
  return out;
}
