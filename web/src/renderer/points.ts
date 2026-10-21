// Surface point layers: one GL point per cell on the globe, drawn after it —
// fires (NASA FIRMS) and lightning (GOES GLM) share this, each with its own style.
//
// Drawn to scale: each point is its footprint on the ground (never under the
// style's minimum size), so at globe zoom a cell is a pixel or two and only
// grows to its true extent when zoomed in. Brightness carries intensity.
// Points blend "over" (premultiplied), not additively, so dense clusters stay
// clusters instead of blooming into continuous sheets.

import type { Camera } from '../view';
import type { Vec3 } from '../vec';

export interface SurfacePoints {
  count: number;
  /** Unit-sphere position per cell, Earth-fixed. */
  pos: Float32Array;
  /** Per cell: intensity 0…1, age (in the layer's window units), footprint diameter km. */
  look: Float32Array;
}

export interface PointStyle {
  /** Colour at intensity 0 and at 1. */
  low: [number, number, number];
  high: [number, number, number];
  /** Brightness on the day side (the night side is 1). */
  day: number;
  /** Brightness left at the far end of the age window. */
  fadeTo: number;
  /** Smallest point, device px. */
  minPx: number;
}

/** Red-orange throughout, so fires never read as the yellow-white of city lights. */
export const FIRE_STYLE: PointStyle = { low: [1.0, 0.22, 0.04], high: [1.0, 0.55, 0.12], day: 0.35, fadeTo: 0.45, minPx: 1 };

/** Blue-white sparks, fading out across the window. */
export const LIGHTNING_STYLE: PointStyle = { low: [0.42, 0.58, 1.0], high: [0.9, 0.94, 1.0], day: 0.6, fadeTo: 0.2, minPx: 1.5 };

const VERT = `#version 300 es
in vec3 aPos;      // unit sphere, Earth-fixed
in vec3 aLook;     // intensity 0..1, age, footprint diameter km
uniform vec3 uDir;
uniform vec3 uRight;
uniform vec3 uUp;
uniform float uDist;
uniform float uFocal;
uniform float uRadiusPx;   // device px per Earth radius
uniform vec2 uRes;
uniform vec3 uSun;
uniform float uWindow;     // show cells at most this old
uniform float uMinI;       // hide cells dimmer than this (zoom-dependent)
uniform float uDay;
uniform float uFadeTo;
uniform float uMinPx;
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
  float fade = mix(1.0, uFadeTo, clamp(age / max(uWindow, 1.0), 0.0, 1.0));
  float strong = uMinI > 0.0 ? smoothstep(uMinI * 0.8, uMinI, aLook.x) : 1.0;
  vHeat = aLook.x;
  vAlpha = (0.3 + 0.7 * aLook.x) * mix(uDay, 1.0, night) * fade * strong;
  vSize = max(uMinPx, aLook.z * uRadiusPx / 6371.0);
  bool show = facing && age <= uWindow && vAlpha > 0.02;
  gl_Position = show ? vec4(q * uRadiusPx / (0.5 * uRes), 0.0, 1.0) : vec4(2.0, 2.0, 2.0, 1.0);
  gl_PointSize = show ? vSize : 0.0;
}`;

const FRAG = `#version 300 es
precision highp float;
in float vAlpha;
in float vHeat;
in float vSize;
uniform vec3 uLow;
uniform vec3 uHigh;
out vec4 outColor;
void main() {
  // Single-pixel points fill their pixel; larger ones are soft-edged discs.
  float r = length(gl_PointCoord - 0.5) * 2.0;
  float disc = vSize < 2.0 ? 1.0 : 1.0 - smoothstep(0.7, 1.0, r);
  float a = vAlpha * disc;
  vec3 c = mix(uLow, uHigh, vHeat);
  outColor = vec4(c * a, a); // premultiplied, blended "over"
}`;

export interface PointFrameState {
  camera: Camera;
  radiusPx: number;
  sun: Vec3;
  /** Oldest age shown, in the same units as the points' ages. */
  window: number;
  minIntensity: number;
}

export class SurfacePointLayer {
  private readonly program: WebGLProgram;
  private readonly vao: WebGLVertexArrayObject;
  private readonly posBuf: WebGLBuffer;
  private readonly lookBuf: WebGLBuffer;
  private readonly uniforms = new Map<string, WebGLUniformLocation | null>();
  private count = 0;

  constructor(
    private readonly gl: WebGL2RenderingContext,
    link: (vs: string, fs: string) => WebGLProgram,
    private readonly style: PointStyle,
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

  setPoints(p: SurfacePoints) {
    const gl = this.gl;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.posBuf);
    gl.bufferData(gl.ARRAY_BUFFER, p.pos, gl.STATIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.lookBuf);
    gl.bufferData(gl.ARRAY_BUFFER, p.look, gl.STATIC_DRAW);
    this.count = p.count;
  }

  draw(f: PointFrameState, res: [number, number]) {
    if (!this.count) return;
    const gl = this.gl;
    const s = this.style;
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
    gl.uniform1f(this.u('uWindow'), f.window);
    gl.uniform1f(this.u('uMinI'), f.minIntensity);
    gl.uniform1f(this.u('uDay'), s.day);
    gl.uniform1f(this.u('uFadeTo'), s.fadeTo);
    gl.uniform1f(this.u('uMinPx'), s.minPx);
    gl.uniform3fv(this.u('uLow'), s.low);
    gl.uniform3fv(this.u('uHigh'), s.high);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.drawArrays(gl.POINTS, 0, this.count);
    gl.bindVertexArray(null);
  }
}
