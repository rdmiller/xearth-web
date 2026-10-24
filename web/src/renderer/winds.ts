// Wind trails (winds.ts) on a WebGL2 canvas of their own over the globe's, redrawn every
// display frame while the globe keeps to its own cadence. No textures: each trail segment is
// an instance, a quad between two of a particle's kept positions, read straight from the
// slot-major trail buffer (segment s of particle i: slot s and slot s + 1, which is N points
// further on). Segments fade along the trail; the one from the head back round to the
// oldest slot, and any that join two lives of a particle, aren't drawn.

import type { Camera } from '../view';
import { POINT_FLOATS, RAMP_STRETCH, TRAIL_SLOTS, WIND_RAMP, type WindMode } from '../winds';

export const VERT = `#version 300 es
in vec4 aA;        // older end: Earth-fixed unit vector, life id
in vec4 aB;        // newer end
in float aSpeed;   // m/s at the newer end
uniform int uCount;    // particles per slot
uniform int uHead;
uniform float uPhase;  // 0..1 through the current tick
uniform vec3 uDir;
uniform vec3 uRight;
uniform vec3 uUp;
uniform float uDist;
uniform float uFocal;
uniform float uRadiusPx;   // device px per Earth radius
uniform vec2 uRes;
uniform float uHalfWidth;  // device px
uniform vec4 uRamp[${WIND_RAMP.length}]; // m/s, r, g, b
out vec4 vColor;
out float vAcross;

const int SLOTS = ${TRAIL_SLOTS};

// Screen position in device px from the centre, and how squarely the point faces the viewer.
vec3 place(vec3 p) {
  if (uDist <= 0.0) return vec3(vec2(dot(p, uRight), dot(p, uUp)) * uRadiusPx, dot(p, uDir));
  vec3 eye = uDir * uDist;
  vec3 d = p - eye;
  float depth = max(-dot(d, uDir), 1e-4);
  return vec3(uFocal * vec2(dot(d, uRight), dot(d, uUp)) / depth * uRadiusPx, dot(p, normalize(eye - p)));
}

vec3 ramp(float v) {
  vec3 c = uRamp[0].yzw;
  for (int i = 1; i < ${WIND_RAMP.length}; i++) {
    float t = clamp((v - uRamp[i - 1].x) / (uRamp[i].x - uRamp[i - 1].x), 0.0, 1.0);
    c = v > uRamp[i - 1].x ? mix(uRamp[i - 1].yzw, uRamp[i].yzw, t) : c;
  }
  return c;
}

void main() {
  int slot = gl_InstanceID / uCount;
  // Slots back from the head to this segment's newer end.
  int age = (uHead - (slot + 1) + 2 * SLOTS) % SLOTS;
  bool ok = slot != uHead && aA.w >= 0.0 && aA.w == aB.w;
  vec3 a = place(aA.xyz);
  vec3 b = place(aB.xyz);
  vec2 dir = b.xy - a.xy;
  float len = length(dir);
  ok = ok && a.z > 0.0 && b.z > 0.0 && len < uRes.y * 0.25;
  int corner = gl_VertexID;
  bool newer = corner >= 2;
  vec2 along = len > 1e-3 ? dir / len : vec2(1.0, 0.0);
  vec2 across = vec2(-along.y, along.x);
  float side = (corner == 0 || corner == 2) ? -1.0 : 1.0;
  vec3 e = newer ? b : a;
  // Half a pixel past each end too, so the joins between segments don't show.
  vec2 xy = e.xy + across * side * uHalfWidth + along * (newer ? 0.5 : -0.5);
  float fade = 1.0 - (float(age + (newer ? 0 : 1)) + uPhase) / float(SLOTS - 1);
  float limb = smoothstep(0.0, 0.12, e.z);
  float calm = mix(0.35, 1.0, smoothstep(0.0, uRamp[2].x, aSpeed));
  float alpha = clamp(fade, 0.0, 1.0) * limb * calm;
  vColor = vec4(ramp(aSpeed), alpha);
  vAcross = side;
  gl_Position = ok ? vec4(xy / (0.5 * uRes), 0.0, 1.0) : vec4(2.0, 2.0, 2.0, 1.0);
}`;

export const FRAG = `#version 300 es
precision highp float;
in vec4 vColor;
in float vAcross;
uniform float uHalfWidth;
out vec4 outColor;
void main() {
  // Soft edges: full in the middle, nothing half a pixel past the line's width.
  float d = abs(vAcross) * uHalfWidth;
  float a = vColor.a * clamp(uHalfWidth - d + 0.5, 0.0, 1.0);
  outColor = vec4(vColor.rgb * a, a); // premultiplied
}`;

export interface WindFrame {
  camera: Camera;
  /** Device px per Earth radius. */
  radiusPx: number;
  dpr: number;
  mode: Exclude<WindMode, 'off'>;
  head: number;
  phase: number;
}

/** CSS px. */
const LINE_WIDTH = 1.35;

export class WindLayer {
  readonly gl: WebGL2RenderingContext;
  private readonly program: WebGLProgram;
  private readonly vao: WebGLVertexArrayObject;
  private readonly buf: WebGLBuffer;
  private readonly uniforms = new Map<string, WebGLUniformLocation | null>();
  private readonly ramp = new Float32Array(WIND_RAMP.length * 4);
  private drawn = false;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly capacity: number,
  ) {
    const gl = canvas.getContext('webgl2', { antialias: false, alpha: true, premultipliedAlpha: true, preserveDrawingBuffer: false });
    if (!gl) throw new Error('WebGL2 is not available in this browser.');
    this.gl = gl;
    this.program = link(gl, VERT, FRAG);
    this.vao = gl.createVertexArray()!;
    this.buf = gl.createBuffer()!;
    gl.bindVertexArray(this.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buf);
    gl.bufferData(gl.ARRAY_BUFFER, (TRAIL_SLOTS + 1) * capacity * POINT_FLOATS * 4, gl.DYNAMIC_DRAW);
    const stride = POINT_FLOATS * 4;
    const slotBytes = capacity * stride;
    const attr = (name: string, size: number, offset: number) => {
      const loc = gl.getAttribLocation(this.program, name);
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, size, gl.FLOAT, false, stride, offset);
      gl.vertexAttribDivisor(loc, 1);
    };
    attr('aA', 4, 0);
    attr('aB', 4, slotBytes);
    attr('aSpeed', 1, slotBytes + 16);
    gl.bindVertexArray(null);
  }

  private u(name: string) {
    if (!this.uniforms.has(name)) this.uniforms.set(name, this.gl.getUniformLocation(this.program, name));
    return this.uniforms.get(name)!;
  }

  /** Match the drawing buffer to the canvas's CSS size × devicePixelRatio (as the globe's). */
  resize(dpr: number) {
    const w = Math.max(1, Math.round(this.canvas.clientWidth * dpr));
    const h = Math.max(1, Math.round(this.canvas.clientHeight * dpr));
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
  }

  /** Copy these whole slots of `trail` to the GPU. */
  upload(trail: Float32Array, slots: number[]) {
    const gl = this.gl;
    const n = this.capacity * POINT_FLOATS;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buf);
    for (const s of slots) gl.bufferSubData(gl.ARRAY_BUFFER, s * n * 4, trail, s * n, n);
  }

  draw(f: WindFrame) {
    const gl = this.gl;
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.useProgram(this.program);
    gl.bindVertexArray(this.vao);
    const stretch = RAMP_STRETCH[f.mode];
    WIND_RAMP.forEach(([v, r, g, b], i) => this.ramp.set([v * stretch, r, g, b], i * 4));
    gl.uniform4fv(this.u('uRamp'), this.ramp);
    gl.uniform1i(this.u('uCount'), this.capacity);
    gl.uniform1i(this.u('uHead'), f.head);
    gl.uniform1f(this.u('uPhase'), f.phase);
    gl.uniform3fv(this.u('uDir'), f.camera.dir);
    gl.uniform3fv(this.u('uRight'), f.camera.right);
    gl.uniform3fv(this.u('uUp'), f.camera.up);
    gl.uniform1f(this.u('uDist'), f.camera.dist);
    gl.uniform1f(this.u('uFocal'), f.camera.focal);
    gl.uniform1f(this.u('uRadiusPx'), f.radiusPx);
    gl.uniform2f(this.u('uRes'), this.canvas.width, this.canvas.height);
    gl.uniform1f(this.u('uHalfWidth'), (LINE_WIDTH * f.dpr) / 2);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, TRAIL_SLOTS * this.capacity);
    gl.bindVertexArray(null);
    this.drawn = true;
  }

  /** Blank the canvas (the layer off). */
  clear() {
    if (!this.drawn) return;
    const gl = this.gl;
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    this.drawn = false;
  }
}

function compile(gl: WebGL2RenderingContext, type: number, src: string) {
  const s = gl.createShader(type)!;
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(`shader: ${gl.getShaderInfoLog(s)}`);
  return s;
}

function link(gl: WebGL2RenderingContext, vs: string, fs: string) {
  const p = gl.createProgram()!;
  gl.attachShader(p, compile(gl, gl.VERTEX_SHADER, vs));
  gl.attachShader(p, compile(gl, gl.FRAGMENT_SHADER, fs));
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(`program: ${gl.getProgramInfoLog(p)}`);
  return p;
}
