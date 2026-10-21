// Fire layer: one GL point per FIRMS cell on the surface, drawn after the globe.
//
// Drawn to scale: each point is the footprint of its detected VIIRS pixels
// (never under one device pixel), so at globe zoom a fire is a single pixel and
// only grows to its true extent when zoomed in. Brightness carries fire power.
// Points blend "over" (premultiplied), not additively, so dense clusters stay
// clusters instead of blooming into continuous orange sheets.

import type { FirePoints } from '../hazards';
import type { Camera } from '../view';
import type { Vec3 } from '../vec';

const VERT = `#version 300 es
in vec3 aPos;      // unit sphere, Earth-fixed
in vec3 aLook;     // intensity 0..1, hours since latest detection, footprint diameter km
uniform vec3 uDir;
uniform vec3 uRight;
uniform vec3 uUp;
uniform float uDist;
uniform float uFocal;
uniform float uRadiusPx;   // device px per Earth radius
uniform vec2 uRes;
uniform vec3 uSun;
uniform float uWindowH;    // show detections at most this old
uniform float uMinI;       // hide fires dimmer than this (zoom-dependent)
out float vAlpha;
out float vHeat;
out float vSize;
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
  float age = aLook.y;
  float k = dot(aPos, uSun);
  float night = 1.0 - smoothstep(-0.12, 0.02, k);
  float fade = mix(1.0, 0.45, clamp(age / max(uWindowH, 1.0), 0.0, 1.0));
  float strong = uMinI > 0.0 ? smoothstep(uMinI * 0.8, uMinI, aLook.x) : 1.0;
  vHeat = aLook.x;
  vAlpha = (0.3 + 0.7 * aLook.x) * mix(0.35, 1.0, night) * fade * strong;
  vSize = max(1.0, aLook.z * uRadiusPx / 6371.0);
  bool show = facing && age <= uWindowH && vAlpha > 0.02;
  gl_Position = show ? vec4(q * uRadiusPx / (0.5 * uRes), 0.0, 1.0) : vec4(2.0, 2.0, 2.0, 1.0);
  gl_PointSize = show ? vSize : 0.0;
}`;

const FRAG = `#version 300 es
precision highp float;
in float vAlpha;
in float vHeat;
in float vSize;
out vec4 outColor;
void main() {
  // Single-pixel points fill their pixel; larger ones are soft-edged discs.
  float r = length(gl_PointCoord - 0.5) * 2.0;
  float disc = vSize < 2.0 ? 1.0 : 1.0 - smoothstep(0.7, 1.0, r);
  float a = vAlpha * disc;
  // Red-orange throughout, so fires never read as the yellow-white of city lights.
  vec3 c = mix(vec3(1.0, 0.22, 0.04), vec3(1.0, 0.55, 0.12), vHeat);
  outColor = vec4(c * a, a); // premultiplied, blended "over"
}`;

export interface FireFrameState {
  camera: Camera;
  radiusPx: number;
  sun: Vec3;
  windowH: number;
  minIntensity: number;
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
    for (const [name, buf] of [
      ['aPos', this.posBuf],
      ['aLook', this.lookBuf],
    ] as const) {
      gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      const loc = gl.getAttribLocation(this.program, name);
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, 3, gl.FLOAT, false, 0, 0);
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
    gl.uniform1f(this.u('uWindowH'), f.windowH);
    gl.uniform1f(this.u('uMinI'), f.minIntensity);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.drawArrays(gl.POINTS, 0, this.count);
    gl.bindVertexArray(null);
  }
}
