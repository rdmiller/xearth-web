// Satellite layer: one GL point per satellite at its real 3-D position, drawn
// after the globe. Occlusion by the Earth and the Earth's shadow are both
// worked out per point in the vertex shader. Positions come from an SGP4 pass
// at one moment; the shader carries each point along its velocity to the
// exact time of the frame (error ~0.5·g·Δt², ~0.4 km after 10 s).

import type { Camera } from '../view';
import type { Vec3 } from '../vec';

const VERT = `#version 300 es
in vec3 aPos;            // Earth-fixed, Earth radii; the origin means "no position"
in vec3 aVel;            // Earth-fixed, Earth radii per second
in float aCat;           // category: index into the colour / size / on tables
uniform vec3 uColors[8];
uniform float uSizes[8]; // CSS px; 0 = category off
uniform float uShapes[8]; // 0 = soft dot, 1 = hollow diamond
uniform float uDt;       // seconds from the SGP4 pass to this frame
uniform vec3 uDir;
uniform vec3 uRight;
uniform vec3 uUp;
uniform float uDist;     // 0 = orthographic
uniform float uFocal;
uniform float uRadiusPx;
uniform vec2 uRes;
uniform vec3 uSun;
uniform float uDpr;
out float vLight;
out vec3 vColor;
flat out float vShape;
void main() {
  int cat = int(aCat + 0.5);
  vColor = uColors[cat];
  vShape = uShapes[cat];
  bool ok = dot(aPos, aPos) > 0.5 && uSizes[cat] > 0.0;
  vec3 p = aPos + aVel * uDt;
  vec2 q;
  bool hidden;
  if (uDist <= 0.0) {
    q = vec2(dot(p, uRight), dot(p, uUp));
    hidden = dot(p, uDir) < 0.0 && length(q) < 1.0;      // behind the disc
  } else {
    vec3 eye = uDir * uDist;
    vec3 d = p - eye;
    float depth = -dot(d, uDir);
    q = uFocal * vec2(dot(d, uRight), dot(d, uUp)) / max(depth, 1e-4);
    float a = dot(d, d);
    float b = dot(eye, d);
    float c = dot(eye, eye) - 1.0;
    float disc = b * b - a * c;
    float t1 = (-b - sqrt(max(disc, 0.0))) / a;
    hidden = depth <= 0.0 || (disc > 0.0 && t1 > 0.0 && t1 < 0.999999); // Earth in the way
  }
  // Earth's shadow: a one-radius cylinder pointing away from the Sun.
  float s = dot(p, uSun);
  float perp = sqrt(max(dot(p, p) - s * s, 0.0));
  float lit = s >= 0.0 ? 1.0 : smoothstep(0.995, 1.005, perp);
  vLight = mix(0.14, 1.0, lit);
  bool show = ok && !hidden;
  gl_Position = show ? vec4(q * uRadiusPx / (0.5 * uRes), 0.0, 1.0) : vec4(2.0, 2.0, 2.0, 1.0);
  gl_PointSize = show ? uSizes[cat] * uDpr : 0.0;
}`;

const FRAG = `#version 300 es
precision highp float;
in float vLight;
in vec3 vColor;
flat in float vShape;
out vec4 outColor;
void main() {
  float a;
  if (vShape > 0.5) {
    // Hollow diamond with a pip in the middle: unmistakably not a star.
    vec2 c = abs(gl_PointCoord - 0.5) * 2.0;
    float d = c.x + c.y;
    float edge = 1.0 - smoothstep(0.12, 0.26, abs(d - 0.78));
    float pip = 1.0 - smoothstep(0.18, 0.3, d);
    a = max(edge, pip) * vLight;
  } else {
    float r = length(gl_PointCoord - 0.5) * 2.0;
    a = (1.0 - smoothstep(0.45, 1.0, r)) * vLight * 0.9;
  }
  outColor = vec4(vColor * a, a); // premultiplied
}`;

/** A bulk category's look: colour (0–1 RGB) and point size in CSS px, 0 when off. */
export interface SatCategoryLook {
  color: [number, number, number];
  size: number;
  diamond?: boolean;
}

export interface SatFrameState {
  camera: Camera;
  categories: SatCategoryLook[];
  /** Seconds from the positions' SGP4 pass to this frame (simulated time). */
  dt: number;
  radiusPx: number;
  sun: Vec3;
  dpr: number;
}

export class SatLayer {
  private readonly program: WebGLProgram;
  private readonly vao: WebGLVertexArrayObject;
  private readonly buf: WebGLBuffer;
  private readonly velBuf: WebGLBuffer;
  private readonly catBuf: WebGLBuffer;
  private readonly uniforms = new Map<string, WebGLUniformLocation | null>();
  private count = 0;
  private capacity = 0;

  constructor(
    private readonly gl: WebGL2RenderingContext,
    link: (vs: string, fs: string) => WebGLProgram,
  ) {
    this.program = link(VERT, FRAG);
    this.vao = gl.createVertexArray()!;
    this.buf = gl.createBuffer()!;
    this.velBuf = gl.createBuffer()!;
    this.catBuf = gl.createBuffer()!;
    gl.bindVertexArray(this.vao);
    for (const [name, buf] of [
      ['aPos', this.buf],
      ['aVel', this.velBuf],
    ] as const) {
      gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      const loc = gl.getAttribLocation(this.program, name);
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, 3, gl.FLOAT, false, 0, 0);
    }
    gl.bindBuffer(gl.ARRAY_BUFFER, this.catBuf);
    const cat = gl.getAttribLocation(this.program, 'aCat');
    gl.enableVertexAttribArray(cat);
    gl.vertexAttribPointer(cat, 1, gl.UNSIGNED_BYTE, false, 0, 0);
    gl.bindVertexArray(null);
  }

  /** Each satellite's category, in the same order as the positions. */
  setCategories(category: Uint8Array) {
    const gl = this.gl;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.catBuf);
    gl.bufferData(gl.ARRAY_BUFFER, category, gl.STATIC_DRAW);
  }

  private u(name: string) {
    if (!this.uniforms.has(name)) this.uniforms.set(name, this.gl.getUniformLocation(this.program, name));
    return this.uniforms.get(name)!;
  }

  setPositions(xyz: Float32Array<ArrayBuffer>, vel: Float32Array<ArrayBuffer>) {
    const gl = this.gl;
    const grow = xyz.byteLength > this.capacity;
    for (const [buf, data] of [
      [this.buf, xyz],
      [this.velBuf, vel],
    ] as const) {
      gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      if (grow) gl.bufferData(gl.ARRAY_BUFFER, data, gl.DYNAMIC_DRAW);
      else gl.bufferSubData(gl.ARRAY_BUFFER, 0, data);
    }
    if (grow) this.capacity = xyz.byteLength;
    this.count = xyz.length / 3;
  }

  clear() {
    this.count = 0;
  }

  draw(f: SatFrameState, res: [number, number]) {
    if (!this.count) return;
    const gl = this.gl;
    gl.useProgram(this.program);
    gl.bindVertexArray(this.vao);
    gl.uniform3fv(this.u('uDir'), f.camera.dir);
    gl.uniform3fv(this.u('uRight'), f.camera.right);
    gl.uniform3fv(this.u('uUp'), f.camera.up);
    gl.uniform1f(this.u('uDist'), f.camera.dist);
    gl.uniform1f(this.u('uFocal'), f.camera.focal);
    gl.uniform1f(this.u('uRadiusPx'), f.radiusPx);
    gl.uniform2f(this.u('uRes'), res[0], res[1]);
    gl.uniform3fv(this.u('uSun'), f.sun);
    gl.uniform1f(this.u('uDt'), f.dt);
    gl.uniform1f(this.u('uDpr'), f.dpr);
    const colors = new Float32Array(24);
    const sizes = new Float32Array(8);
    const shapes = new Float32Array(8);
    f.categories.slice(0, 8).forEach((c, i) => {
      colors.set(c.color, i * 3);
      sizes[i] = c.size;
      shapes[i] = c.diamond ? 1 : 0;
    });
    gl.uniform3fv(this.u('uColors'), colors);
    gl.uniform1fv(this.u('uSizes'), sizes);
    gl.uniform1fv(this.u('uShapes'), shapes);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.drawArrays(gl.POINTS, 0, this.count);
    gl.bindVertexArray(null);
  }
}
