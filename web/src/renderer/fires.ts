// Fire layer: one GL point per FIRMS cell on the surface, drawn after the
// globe. Glowing on the night side (where fires are seen from orbit), faint by
// day; size and brightness from fire radiative power, dimmed with age.

import type { FirePoints } from '../hazards';
import type { Camera } from '../view';
import type { Vec3 } from '../vec';

const VERT = `#version 300 es
in vec3 aPos;      // unit sphere, Earth-fixed
in vec2 aLook;     // intensity, recency
uniform vec3 uDir;
uniform vec3 uRight;
uniform vec3 uUp;
uniform float uDist;
uniform float uFocal;
uniform float uRadiusPx;
uniform vec2 uRes;
uniform vec3 uSun;
uniform float uDpr;
out float vBright;
out float vHeat;
void main() {
  vec3 p = aPos * 1.0005;
  vec2 q;
  bool facing;
  if (uDist <= 0.0) {
    q = vec2(dot(p, uRight), dot(p, uUp));
    facing = dot(p, uDir) > 0.0;
  } else {
    vec3 eye = uDir * uDist;
    vec3 d = p - eye;
    float depth = -dot(d, uDir);
    q = uFocal * vec2(dot(d, uRight), dot(d, uUp)) / max(depth, 1e-4);
    facing = dot(p, eye - p) > 0.0 && depth > 0.0;
  }
  float k = dot(aPos, uSun);
  float night = 1.0 - smoothstep(-0.12, 0.02, k);
  vHeat = aLook.x;
  vBright = aLook.x * mix(0.3, 1.0, night) * mix(0.35, 1.0, aLook.y);
  bool show = facing && vBright > 0.01;
  gl_Position = show ? vec4(q * uRadiusPx / (0.5 * uRes), 0.0, 1.0) : vec4(2.0, 2.0, 2.0, 1.0);
  gl_PointSize = show ? (1.4 + 3.2 * aLook.x) * uDpr : 0.0;
}`;

const FRAG = `#version 300 es
precision highp float;
in float vBright;
in float vHeat;
out vec4 outColor;
void main() {
  float r = length(gl_PointCoord - 0.5) * 2.0;
  float a = (1.0 - smoothstep(0.2, 1.0, r)) * vBright;
  // Red-orange throughout, so fires never read as the yellow-white of city lights.
  vec3 c = mix(vec3(1.0, 0.22, 0.04), vec3(1.0, 0.55, 0.12), vHeat);
  outColor = vec4(c * a, 0.0); // additive
}`;

export interface FireFrameState {
  camera: Camera;
  radiusPx: number;
  sun: Vec3;
  dpr: number;
}

export class FireLayer {
  private readonly program: WebGLProgram;
  private readonly vao: WebGLVertexArrayObject;
  private readonly posBuf: WebGLBuffer;
  private readonly lookBuf: WebGLBuffer;
  private readonly uniforms = new Map<string, WebGLUniformLocation | null>();
  private count = 0;

  constructor(
    private readonly gl: WebGL2RenderingContext,
    link: (vs: string, fs: string) => WebGLProgram,
  ) {
    this.program = link(VERT, FRAG);
    this.vao = gl.createVertexArray()!;
    this.posBuf = gl.createBuffer()!;
    this.lookBuf = gl.createBuffer()!;
    gl.bindVertexArray(this.vao);
    for (const [name, buf, size] of [
      ['aPos', this.posBuf, 3],
      ['aLook', this.lookBuf, 2],
    ] as const) {
      gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      const loc = gl.getAttribLocation(this.program, name);
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, size, gl.FLOAT, false, 0, 0);
    }
    gl.bindVertexArray(null);
  }

  private u(name: string) {
    if (!this.uniforms.has(name)) this.uniforms.set(name, this.gl.getUniformLocation(this.program, name));
    return this.uniforms.get(name)!;
  }

  setFires(f: FirePoints) {
    const gl = this.gl;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.posBuf);
    gl.bufferData(gl.ARRAY_BUFFER, f.pos, gl.STATIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.lookBuf);
    gl.bufferData(gl.ARRAY_BUFFER, f.look, gl.STATIC_DRAW);
    this.count = f.count;
  }

  draw(f: FireFrameState, res: [number, number]) {
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
    gl.uniform1f(this.u('uDpr'), f.dpr);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE);
    gl.drawArrays(gl.POINTS, 0, this.count);
    gl.bindVertexArray(null);
  }
}
