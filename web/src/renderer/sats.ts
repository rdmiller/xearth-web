// Satellite layer: one GL point per satellite at its real 3-D position, drawn
// after the globe. Occlusion by the Earth and the Earth's shadow are both
// worked out per point in the vertex shader.

import type { Camera } from '../view';
import type { Vec3 } from '../vec';

const VERT = `#version 300 es
in vec3 aPos;            // Earth-fixed, Earth radii; the origin means "no position"
uniform vec3 uDir;
uniform vec3 uRight;
uniform vec3 uUp;
uniform float uDist;     // 0 = orthographic
uniform float uFocal;
uniform float uRadiusPx;
uniform vec2 uRes;
uniform vec3 uSun;
uniform float uSize;
out float vLight;
void main() {
  vec3 p = aPos;
  bool ok = dot(p, p) > 0.5;
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
  gl_PointSize = show ? uSize : 0.0;
}`;

const FRAG = `#version 300 es
precision highp float;
in float vLight;
uniform vec3 uColor;
out vec4 outColor;
void main() {
  float r = length(gl_PointCoord - 0.5) * 2.0;
  float a = (1.0 - smoothstep(0.45, 1.0, r)) * vLight * 0.9;
  outColor = vec4(uColor * a, a); // premultiplied
}`;

export interface SatFrameState {
  camera: Camera;
  radiusPx: number;
  sun: Vec3;
  dpr: number;
}

export class SatLayer {
  private readonly program: WebGLProgram;
  private readonly vao: WebGLVertexArrayObject;
  private readonly buf: WebGLBuffer;
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
    gl.bindVertexArray(this.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buf);
    const loc = gl.getAttribLocation(this.program, 'aPos');
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 3, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null);
  }

  private u(name: string) {
    if (!this.uniforms.has(name)) this.uniforms.set(name, this.gl.getUniformLocation(this.program, name));
    return this.uniforms.get(name)!;
  }

  setPositions(xyz: Float32Array<ArrayBuffer>) {
    const gl = this.gl;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buf);
    if (xyz.byteLength > this.capacity) {
      gl.bufferData(gl.ARRAY_BUFFER, xyz, gl.DYNAMIC_DRAW);
      this.capacity = xyz.byteLength;
    } else {
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, xyz);
    }
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
    gl.uniform1f(this.u('uSize'), 2.2 * f.dpr);
    gl.uniform3f(this.u('uColor'), 0.82, 0.9, 1.0);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.drawArrays(gl.POINTS, 0, this.count);
    gl.bindVertexArray(null);
  }
}
