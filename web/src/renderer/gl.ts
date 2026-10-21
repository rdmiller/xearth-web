// WebGL2 plumbing: one program, one full-screen triangle, five textures.

import type { Camera } from '../view';
import type { Vec3 } from '../vec';
import fragSrc from './globe.frag.glsl?raw';

const VERT = `#version 300 es
in vec2 aPos;
void main() { gl_Position = vec4(aPos, 0.0, 1.0); }`;

export interface FrameState {
  camera: Camera;
  sun: Vec3;
  radiusPx: number;
  clouds: boolean;
  lights: boolean;
  grid: boolean;
  stars: boolean;
}

type Slot = 'day' | 'night' | 'cloudPrev' | 'cloudCur';
const UNIT: Record<Slot, number> = { day: 0, night: 1, cloudPrev: 2, cloudCur: 3 };
const SAMPLER: Record<Slot, string> = { day: 'uDay', night: 'uNight', cloudPrev: 'uCloudPrev', cloudCur: 'uCloudCur' };

export class GlobeRenderer {
  readonly gl: WebGL2RenderingContext;
  readonly maxTextureSize: number;
  private readonly program: WebGLProgram;
  private readonly uniforms = new Map<string, WebGLUniformLocation | null>();
  private readonly textures: Record<Slot, WebGLTexture>;
  private readonly loaded: Record<Slot, boolean> = { day: false, night: false, cloudPrev: false, cloudCur: false };
  private readonly aniso: EXT_texture_filter_anisotropic | null;
  /** 0 → previous cloud map, 1 → current; animated by the caller after setClouds. */
  cloudMix = 1;

  constructor(readonly canvas: HTMLCanvasElement) {
    const gl = canvas.getContext('webgl2', { antialias: false, alpha: false, preserveDrawingBuffer: false });
    if (!gl) throw new Error('WebGL2 is not available in this browser.');
    this.gl = gl;
    this.maxTextureSize = gl.getParameter(gl.MAX_TEXTURE_SIZE) as number;
    this.aniso = gl.getExtension('EXT_texture_filter_anisotropic');
    this.program = link(gl, VERT, fragSrc);

    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(this.program, 'aPos');
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);

    gl.useProgram(this.program);
    const blank = (rgba: number[]) => {
      const t = gl.createTexture()!;
      gl.bindTexture(gl.TEXTURE_2D, t);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(rgba));
      return t;
    };
    this.textures = {
      day: blank([16, 40, 96, 255]),
      night: blank([0, 0, 0, 255]),
      cloudPrev: blank([0, 0, 0, 255]),
      cloudCur: blank([0, 0, 0, 255]),
    };
    for (const slot of Object.keys(UNIT) as Slot[]) gl.uniform1i(this.u(SAMPLER[slot]), UNIT[slot]);
  }

  private u(name: string) {
    if (!this.uniforms.has(name)) this.uniforms.set(name, this.gl.getUniformLocation(this.program, name));
    return this.uniforms.get(name)!;
  }

  private upload(slot: Slot, image: TexImageSource) {
    const gl = this.gl;
    gl.activeTexture(gl.TEXTURE0 + UNIT[slot]);
    gl.bindTexture(gl.TEXTURE_2D, this.textures[slot]);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false); // row 0 = north = v 0
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    if (this.aniso) gl.texParameterf(gl.TEXTURE_2D, this.aniso.TEXTURE_MAX_ANISOTROPY_EXT, 8);
    this.loaded[slot] = true;
  }

  setDay(image: TexImageSource) {
    this.upload('day', image);
  }

  setNight(image: TexImageSource) {
    this.upload('night', image);
  }

  /** Show a new cloud map; the previous one is kept for a cross-fade (cloudMix 0 → 1). */
  setClouds(image: TexImageSource) {
    if (this.loaded.cloudCur) {
      [this.textures.cloudPrev, this.textures.cloudCur] = [this.textures.cloudCur, this.textures.cloudPrev];
      this.loaded.cloudPrev = true;
      this.cloudMix = 0;
    } else {
      this.cloudMix = 1;
    }
    this.upload('cloudCur', image);
    // The swap changed which texture object sits in each unit.
    const gl = this.gl;
    gl.activeTexture(gl.TEXTURE0 + UNIT.cloudPrev);
    gl.bindTexture(gl.TEXTURE_2D, this.textures.cloudPrev);
  }

  get hasClouds() {
    return this.loaded.cloudCur;
  }

  /** Match the drawing buffer to the canvas's CSS size × devicePixelRatio. */
  resize(): boolean {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.max(1, Math.round(this.canvas.clientWidth * dpr));
    const h = Math.max(1, Math.round(this.canvas.clientHeight * dpr));
    if (this.canvas.width === w && this.canvas.height === h) return false;
    this.canvas.width = w;
    this.canvas.height = h;
    return true;
  }

  render(f: FrameState) {
    const gl = this.gl;
    const { camera: cam } = f;
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.useProgram(this.program);
    for (const slot of Object.keys(UNIT) as Slot[]) {
      gl.activeTexture(gl.TEXTURE0 + UNIT[slot]);
      gl.bindTexture(gl.TEXTURE_2D, this.textures[slot]);
    }
    gl.uniform2f(this.u('uRes'), this.canvas.width, this.canvas.height);
    gl.uniform1f(this.u('uRadiusPx'), f.radiusPx);
    gl.uniform3fv(this.u('uDir'), cam.dir);
    gl.uniform3fv(this.u('uRight'), cam.right);
    gl.uniform3fv(this.u('uUp'), cam.up);
    gl.uniform1f(this.u('uDist'), cam.dist);
    gl.uniform1f(this.u('uFocal'), cam.focal);
    gl.uniform3fv(this.u('uSun'), f.sun);
    gl.uniform1f(this.u('uHasDay'), this.loaded.day ? 1 : 0);
    gl.uniform1f(this.u('uHasNight'), this.loaded.night ? 1 : 0);
    gl.uniform1f(this.u('uCloudMix'), this.cloudMix);
    gl.uniform1f(this.u('uCloudOn'), f.clouds && this.loaded.cloudCur ? 1 : 0);
    gl.uniform1f(this.u('uLights'), f.lights ? 1 : 0);
    gl.uniform1f(this.u('uGrid'), f.grid ? 1 : 0);
    gl.uniform1f(this.u('uStars'), f.stars ? 1 : 0);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
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
