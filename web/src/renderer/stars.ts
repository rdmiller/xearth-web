// Star layer: one GL point per catalogue star, drawn as a soft Gaussian dot
// with additive blending, underneath the globe pass.

import { appearanceBuffer, type StarCatalog } from '../stars';
import type { Camera } from '../view';

export const VERT = `#version 300 es
in vec3 aDir;      // J2000 unit vector
in vec3 aColor;    // sRGB, max channel 1
in vec2 aLook;     // peak, sigma (CSS px)
uniform mat3 uFrame;   // J2000 → Earth-fixed
uniform vec3 uDir;     // centre → viewer
uniform vec3 uRight;
uniform vec3 uUp;
uniform float uFocal;  // sky projection, Earth radii
uniform float uRadiusPx;
uniform vec2 uRes;
uniform float uDpr;
out vec3 vColor;
out float vPeak;
out float vSigma;
void main() {
  vec3 v = uFrame * aDir;
  float z = -dot(v, uDir);            // toward the screen's far side
  vec2 p = uFocal * vec2(dot(v, uRight), dot(v, uUp)) / max(z, 1e-4);
  vec2 clip = p * uRadiusPx / (0.5 * uRes);
  vSigma = aLook.y * uDpr;
  vPeak = aLook.x;
  vColor = aColor;
  bool show = z > 0.0 && aLook.x > 0.002;
  gl_Position = show ? vec4(clip, 0.0, 1.0) : vec4(2.0, 2.0, 2.0, 1.0);
  gl_PointSize = show ? min(ceil(vSigma * 6.0) + 1.0, 48.0) : 0.0;
}`;

export const FRAG = `#version 300 es
precision highp float;
in vec3 vColor;
in float vPeak;
in float vSigma;
out vec4 outColor;
void main() {
  vec2 d = (gl_PointCoord - 0.5) * (ceil(vSigma * 6.0) + 1.0);
  float g = vPeak * exp(-dot(d, d) / (2.0 * vSigma * vSigma));
  outColor = vec4(vColor * g, 0.0);
}`;

export interface StarFrameState {
  camera: Camera;
  focal: number;
  frame: Float32Array;
  radiusPx: number;
  dpr: number;
  magShift: number;
}

export class StarLayer {
  private readonly program: WebGLProgram;
  private readonly vao: WebGLVertexArrayObject;
  private readonly lookBuf: WebGLBuffer;
  private readonly uniforms = new Map<string, WebGLUniformLocation | null>();
  private catalog: StarCatalog | undefined;
  private look: Float32Array<ArrayBuffer> | undefined;
  private lastShift = NaN;

  constructor(
    private readonly gl: WebGL2RenderingContext,
    link: (vs: string, fs: string) => WebGLProgram,
  ) {
    this.program = link(VERT, FRAG);
    this.vao = gl.createVertexArray()!;
    this.lookBuf = gl.createBuffer()!;
  }

  private u(name: string) {
    if (!this.uniforms.has(name)) this.uniforms.set(name, this.gl.getUniformLocation(this.program, name));
    return this.uniforms.get(name)!;
  }

  private attrib(name: string, size: number, data: Float32Array | null, buf = this.gl.createBuffer()!) {
    const gl = this.gl;
    const loc = gl.getAttribLocation(this.program, name);
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    if (data) gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, size, gl.FLOAT, false, 0, 0);
  }

  setCatalog(cat: StarCatalog) {
    const gl = this.gl;
    this.catalog = cat;
    this.look = new Float32Array(cat.count * 2);
    this.lastShift = NaN;
    gl.bindVertexArray(this.vao);
    this.attrib('aDir', 3, cat.dir);
    this.attrib('aColor', 3, cat.color);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.lookBuf);
    gl.bufferData(gl.ARRAY_BUFFER, this.look.byteLength, gl.DYNAMIC_DRAW);
    this.attrib('aLook', 2, null, this.lookBuf);
    gl.bindVertexArray(null);
  }

  get loaded() {
    return !!this.catalog;
  }

  draw(f: StarFrameState, res: [number, number]) {
    const { gl, catalog, look } = this;
    if (!catalog || !look) return;
    // Brightness only changes with exposure; skip the re-upload otherwise.
    if (Math.abs(f.magShift - this.lastShift) > 0.02 || Number.isNaN(this.lastShift)) {
      appearanceBuffer(catalog, f.magShift, look);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.lookBuf);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, look);
      this.lastShift = f.magShift;
    }
    gl.useProgram(this.program);
    gl.bindVertexArray(this.vao);
    gl.uniformMatrix3fv(this.u('uFrame'), false, f.frame);
    gl.uniform3fv(this.u('uDir'), f.camera.dir);
    gl.uniform3fv(this.u('uRight'), f.camera.right);
    gl.uniform3fv(this.u('uUp'), f.camera.up);
    gl.uniform1f(this.u('uFocal'), f.focal);
    gl.uniform1f(this.u('uRadiusPx'), f.radiusPx);
    gl.uniform2f(this.u('uRes'), res[0], res[1]);
    gl.uniform1f(this.u('uDpr'), f.dpr);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE);
    gl.drawArrays(gl.POINTS, 0, catalog.count);
    gl.bindVertexArray(null);
  }
}
