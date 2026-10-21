// Sun and Moon: one screen-aligned quad each, drawn after the stars and before
// the globe (so the Earth hides them). The fragment shader turns the quad into
// a sphere: a limb-darkened Sun with a glow, and a Moon lit by the real Sun
// direction (so it shows its phase) with faint earthshine and the LROC map.

import type { Vec3 } from '../vec';

const VERT = `#version 300 es
in vec2 aCorner;          // −1..1
uniform vec2 uCenter;     // clip space
uniform vec2 uHalf;       // quad half-size, clip space
uniform float uQuad;      // quad half-size in disc radii
out vec2 vQ;              // position in disc radii (1 = limb)
void main() {
  vQ = aCorner * uQuad;
  gl_Position = vec4(uCenter + aCorner * uHalf, 0.0, 1.0);
}`;

const FRAG = `#version 300 es
precision highp float;
in vec2 vQ;
uniform int uKind;        // 0 = Sun, 1 = Moon
uniform float uAA;        // antialiasing width, disc radii
uniform float uQuad;
uniform vec3 uRight;      // view basis at the body, Earth-fixed
uniform vec3 uUp;
uniform vec3 uBack;       // from the body toward the eye
uniform vec3 uSun;
uniform vec3 uMx;         // Moon frame: x toward Earth, y east, z north
uniform vec3 uMy;
uniform vec3 uMz;
uniform sampler2D uMoonTex;
uniform float uHasTex;
uniform sampler2D uSunTex;   // GOES SUVI image, Sun centred
uniform float uHasSunTex;
uniform float uSunLimb;      // limb radius as a fraction of the image width
out vec4 outColor;
const float PI = 3.14159265359;
void main() {
  float r = length(vQ);
  float cover = 1.0 - smoothstep(1.0 - uAA, 1.0 + uAA, r);
  if (uKind == 0) {
    // Limb-darkened photosphere plus a glow that fades out before the quad edge.
    float mu = sqrt(max(1.0 - r * r, 0.0));
    vec3 disc = vec3(1.0, 0.97, 0.9) * (0.4 + 0.6 * mu);
    float edge = 1.0 - smoothstep(0.6 * uQuad, uQuad, r);
    float glow = 0.55 * pow(1.0 / max(r, 1.0), 1.6) * edge;
    vec3 halo = vec3(1.0, 0.82, 0.55) * glow * (1.0 - cover);
    if (uHasSunTex > 0.5 && r < 1.45) {
      // GOES SUVI 304 Å: active regions and filaments on the disc, prominences just
      // off the limb — faded out before the image's caption (~1.5 solar radii below).
      vec3 img = texture(uSunTex, vec2(0.5 + vQ.x * uSunLimb, 0.5 - vQ.y * uSunLimb)).rgb;
      disc = img * 1.35;
      halo += img * (1.0 - smoothstep(1.15, 1.45, r)) * (1.0 - cover) * 0.9;
    }
    outColor = vec4(disc * cover + halo, 0.0); // additive
    return;
  }
  if (cover <= 0.0) discard;
  float nz = sqrt(max(1.0 - r * r, 0.0));
  vec3 n = normalize(vQ.x * uRight + vQ.y * uUp + nz * uBack);
  float lit = max(dot(n, uSun), 0.0);
  float earthshine = 0.035 * max(dot(n, uMx), 0.0);
  vec3 albedo = vec3(0.62);
  if (uHasTex > 0.5) {
    float lon = atan(dot(n, uMy), dot(n, uMx));
    float lat = asin(clamp(dot(n, uMz), -1.0, 1.0));
    albedo = texture(uMoonTex, vec2(lon / (2.0 * PI) + 0.5, 0.5 - lat / PI)).rgb;
  }
  vec3 col = albedo * (1.25 * lit + earthshine);
  outColor = vec4(col * cover, cover); // premultiplied over the stars
}`;

export interface BodyDraw {
  kind: 'sun' | 'moon';
  /** Centre in clip space. */
  center: [number, number];
  /** Disc radius in device px. */
  radiusPx: number;
  /** View basis at the body (Earth-fixed): screen right/up and from-body-to-eye. */
  right: Vec3;
  up: Vec3;
  back: Vec3;
  sun: Vec3;
  moonFrame?: { x: Vec3; y: Vec3; z: Vec3 };
}

export class BodyLayer {
  private readonly program: WebGLProgram;
  private readonly vao: WebGLVertexArrayObject;
  private readonly uniforms = new Map<string, WebGLUniformLocation | null>();
  private readonly moonTex: WebGLTexture;
  private hasMoonTex = false;
  private readonly sunTex: WebGLTexture;
  private hasSunTex = false;
  private sunLimb = 0.3;

  constructor(
    private readonly gl: WebGL2RenderingContext,
    link: (vs: string, fs: string) => WebGLProgram,
  ) {
    this.program = link(VERT, FRAG);
    this.vao = gl.createVertexArray()!;
    gl.bindVertexArray(this.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(this.program, 'aCorner');
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null);
    this.moonTex = gl.createTexture()!;
    this.sunTex = gl.createTexture()!;
  }

  /** A full-disc solar image with the Sun centred; `limb` = limb radius / image width. */
  setSunTexture(image: TexImageSource, limb: number) {
    const gl = this.gl;
    gl.activeTexture(gl.TEXTURE6);
    gl.bindTexture(gl.TEXTURE_2D, this.sunTex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    this.hasSunTex = true;
    this.sunLimb = limb;
  }

  private u(name: string) {
    if (!this.uniforms.has(name)) this.uniforms.set(name, this.gl.getUniformLocation(this.program, name));
    return this.uniforms.get(name)!;
  }

  setMoonTexture(image: TexImageSource) {
    const gl = this.gl;
    gl.activeTexture(gl.TEXTURE4);
    gl.bindTexture(gl.TEXTURE_2D, this.moonTex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    this.hasMoonTex = true;
  }

  draw(bodies: BodyDraw[], res: [number, number]) {
    if (!bodies.length) return;
    const gl = this.gl;
    gl.useProgram(this.program);
    gl.bindVertexArray(this.vao);
    gl.activeTexture(gl.TEXTURE4);
    gl.bindTexture(gl.TEXTURE_2D, this.moonTex);
    gl.uniform1i(this.u('uMoonTex'), 4);
    gl.uniform1f(this.u('uHasTex'), this.hasMoonTex ? 1 : 0);
    gl.activeTexture(gl.TEXTURE6);
    gl.bindTexture(gl.TEXTURE_2D, this.sunTex);
    gl.uniform1i(this.u('uSunTex'), 6);
    gl.uniform1f(this.u('uHasSunTex'), this.hasSunTex ? 1 : 0);
    gl.uniform1f(this.u('uSunLimb'), this.sunLimb);
    gl.enable(gl.BLEND);
    for (const b of bodies) {
      // The Sun's glow needs room; the Moon's quad just covers the disc.
      const quadPx = b.kind === 'sun' ? Math.max(b.radiusPx * 9, 70) : b.radiusPx + 2;
      gl.uniform1i(this.u('uKind'), b.kind === 'sun' ? 0 : 1);
      gl.uniform2f(this.u('uCenter'), b.center[0], b.center[1]);
      gl.uniform2f(this.u('uHalf'), (2 * quadPx) / res[0], (2 * quadPx) / res[1]);
      gl.uniform1f(this.u('uQuad'), quadPx / Math.max(b.radiusPx, 0.5));
      gl.uniform1f(this.u('uAA'), 1.2 / Math.max(b.radiusPx, 0.5));
      gl.uniform3fv(this.u('uRight'), b.right);
      gl.uniform3fv(this.u('uUp'), b.up);
      gl.uniform3fv(this.u('uBack'), b.back);
      gl.uniform3fv(this.u('uSun'), b.sun);
      if (b.moonFrame) {
        gl.uniform3fv(this.u('uMx'), b.moonFrame.x);
        gl.uniform3fv(this.u('uMy'), b.moonFrame.y);
        gl.uniform3fv(this.u('uMz'), b.moonFrame.z);
      }
      if (b.kind === 'sun') gl.blendFunc(gl.ONE, gl.ONE);
      else gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
    }
    gl.bindVertexArray(null);
  }
}
