// A 3D model in front of the camera: the ISS, under its own camera (issModel.ts poses it). Drawn
// over the globe in GlobeRenderer.renderView's frame, with its own depth buffer; the Earth is
// ~400 km further off, so the model always covers it.
//
// The frame is the station's LVLH, in metres: x forward, y to the right, z down. The eye sits
// `height` m above the model's origin looking straight down, framed as nadirCamera frames the
// globe (travel at the top, `focal` for the field of view), so the two line up.

import type { Vec3 } from '../vec';

export const VERT = `#version 300 es
in vec3 aPos;
in vec3 aNormal;
in vec3 aColor;
uniform mat4 uModel;      // model space → LVLH metres
uniform float uHeight;    // eye above the origin, m
uniform float uScale;     // focal × radiusPx: pixels per unit of x/depth
uniform vec2 uHalfRes;
out vec3 vNormal;
out vec3 vColor;
out vec3 vToEye;
// The station is ~120 m below the eye, its arrays reaching ~40 m either way: a tight range
// keeps the depth buffer fine enough for parts a few centimetres apart.
const float NEAR = 10.0;
const float FAR = 1000.0;
void main() {
  vec4 p = uModel * vec4(aPos, 1.0);
  float d = p.z + uHeight;  // depth below the eye
  // Screen right is LVLH y, screen up is LVLH x; dividing by w = d gives the perspective.
  gl_Position = vec4(vec2(p.y, p.x) * uScale / uHalfRes, (d * (FAR + NEAR) - 2.0 * FAR * NEAR) / (FAR - NEAR), d);
  vNormal = mat3(uModel) * aNormal;
  vColor = aColor;
  vToEye = vec3(0.0, 0.0, -uHeight) - p.xyz;
}`;

export const FRAG = `#version 300 es
precision highp float;
in vec3 vNormal;
in vec3 vColor;
in vec3 vToEye;
uniform vec3 uSun;        // LVLH
uniform float uLit;       // 0 in the Earth's shadow
uniform float uEarthshine;
out vec4 outColor;
void main() {
  vec3 v = normalize(vToEye);
  vec3 n = normalize(vNormal);
  n = dot(n, v) < 0.0 ? -n : n; // every surface is two-sided
  float sun = max(dot(n, uSun), 0.0) * uLit;
  float earth = max(n.z, 0.0) * uEarthshine; // the Earth is straight down (+z)
  vec3 c = vColor * (0.03 + 1.1 * sun + 0.35 * earth);
  c += vec3(0.3) * pow(max(dot(n, normalize(uSun + v)), 0.0), 30.0) * uLit;
  outColor = vec4(pow(c, vec3(1.0 / 2.2)), 1.0);
}`;

export interface ModelDraw {
  /** Each part's matrix (column-major, model space → LVLH metres), by the key it was set with. */
  parts: Map<string, Float32Array>;
  /** The eye's height above the model's origin, m. */
  height: number;
  /** Unit vector toward the Sun, LVLH. */
  sun: Vec3;
  /** 1 in sunlight, 0 in the Earth's shadow. */
  lit: number;
  /** Light off the Earth below, 0–1: bright over the day side, none over the night. */
  earthshine: number;
}

interface Part {
  vao: WebGLVertexArrayObject;
  count: number;
}

export class ModelLayer {
  private readonly program: WebGLProgram;
  private readonly parts = new Map<string, Part>();
  private readonly uniforms = new Map<string, WebGLUniformLocation | null>();

  constructor(
    private readonly gl: WebGL2RenderingContext,
    link: (vs: string, fs: string) => WebGLProgram,
  ) {
    this.program = link(VERT, FRAG);
  }

  private u(name: string) {
    if (!this.uniforms.has(name)) this.uniforms.set(name, this.gl.getUniformLocation(this.program, name));
    return this.uniforms.get(name)!;
  }

  /** The model's parts: unindexed triangles, three floats a vertex for each attribute. */
  setParts(parts: Map<string, { positions: Float32Array; normals: Float32Array; colors: Float32Array }>) {
    const gl = this.gl;
    for (const [key, p] of parts) {
      const vao = gl.createVertexArray()!;
      gl.bindVertexArray(vao);
      for (const [name, data] of [['aPos', p.positions], ['aNormal', p.normals], ['aColor', p.colors]] as const) {
        const buf = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, buf);
        gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
        const loc = gl.getAttribLocation(this.program, name);
        gl.enableVertexAttribArray(loc);
        gl.vertexAttribPointer(loc, 3, gl.FLOAT, false, 0, 0);
      }
      this.parts.set(key, { vao, count: p.positions.length / 3 });
    }
    gl.bindVertexArray(null);
  }

  /** Draw over what's in the frame; it needs a depth buffer. `scale`: focal × radiusPx. */
  draw(d: ModelDraw, scale: number, res: [number, number]) {
    if (!this.parts.size) return;
    const gl = this.gl;
    gl.useProgram(this.program);
    gl.disable(gl.BLEND);
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LESS);
    gl.clear(gl.DEPTH_BUFFER_BIT);
    gl.uniform1f(this.u('uHeight'), d.height);
    gl.uniform1f(this.u('uScale'), scale);
    gl.uniform2f(this.u('uHalfRes'), res[0] / 2, res[1] / 2);
    gl.uniform3fv(this.u('uSun'), d.sun);
    gl.uniform1f(this.u('uLit'), d.lit);
    gl.uniform1f(this.u('uEarthshine'), d.earthshine);
    for (const [key, m] of d.parts) {
      const part = this.parts.get(key);
      if (!part) continue;
      gl.uniformMatrix4fv(this.u('uModel'), false, m);
      gl.bindVertexArray(part.vao);
      gl.drawArrays(gl.TRIANGLES, 0, part.count);
    }
    gl.bindVertexArray(null);
    gl.disable(gl.DEPTH_TEST);
  }
}
