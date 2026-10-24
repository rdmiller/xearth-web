// Compile, link and draw each program once, for scripts/check-shaders.mjs. ANGLE's Direct3D 11
// backend translates GLSL to HLSL and compiles the pixel shader only at the first draw (its
// "dynamic" executables), so a program can link and still fail there, losing the context:
// linking proves nothing, and every program is drawn, as triangles and as points.

import type { ShaderProgram } from './shaders';

export interface ShaderCheckReport {
  /** The unmasked renderer: says which ANGLE backend and GPU did the compiling. */
  renderer: string;
  /** Each program's failure, or null when it compiled, linked and drew. */
  results: Record<string, string | null>;
}

const G = WebGL2RenderingContext;
const SAMPLERS = new Set<number>([
  G.SAMPLER_2D, G.SAMPLER_3D, G.SAMPLER_CUBE, G.SAMPLER_2D_SHADOW, G.SAMPLER_2D_ARRAY, G.SAMPLER_2D_ARRAY_SHADOW,
  G.SAMPLER_CUBE_SHADOW, G.INT_SAMPLER_2D, G.INT_SAMPLER_3D, G.INT_SAMPLER_CUBE, G.INT_SAMPLER_2D_ARRAY,
  G.UNSIGNED_INT_SAMPLER_2D, G.UNSIGNED_INT_SAMPLER_3D, G.UNSIGNED_INT_SAMPLER_CUBE, G.UNSIGNED_INT_SAMPLER_2D_ARRAY,
]);

/** A loss is reported a little after the draw that caused it. */
const LOSS_WAIT_MS = 500;

export async function checkPrograms(programs: Record<string, ShaderProgram>): Promise<ShaderCheckReport> {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 16;
  const gl = canvas.getContext('webgl2');
  if (!gl) return { renderer: 'none', results: { webgl2: 'no WebGL 2 context' } };
  const info = gl.getExtension('WEBGL_debug_renderer_info');
  const renderer = String(gl.getParameter(info ? info.UNMASKED_RENDERER_WEBGL : gl.RENDERER));
  const results: Record<string, string | null> = {};
  for (const [name, p] of Object.entries(programs)) {
    if (gl.isContextLost()) {
      results[name] = 'not checked: the context was already lost';
      continue;
    }
    results[name] = checkProgram(gl, p);
    await new Promise((r) => setTimeout(r, LOSS_WAIT_MS));
    if (gl.isContextLost()) results[name] ??= 'the context was lost drawing it';
  }
  return { renderer, results };
}

function checkProgram(gl: WebGL2RenderingContext, { vert, frag }: ShaderProgram): string | null {
  const p = gl.createProgram()!;
  for (const [type, src] of [[gl.VERTEX_SHADER, vert], [gl.FRAGMENT_SHADER, frag]] as const) {
    const s = gl.createShader(type)!;
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) return `compile: ${gl.getShaderInfoLog(s)}`;
    gl.attachShader(p, s);
  }
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) return `link: ${gl.getProgramInfoLog(p)}`;
  gl.useProgram(p);
  // Every sampler on its own unit: two sampler types on one unit (they all start on 0) is an
  // invalid draw, refused before it ever reaches D3D. Nothing bound samples as black.
  let unit = 0;
  for (let i = 0; i < gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS); i++) {
    const u = gl.getActiveUniform(p, i)!;
    if (SAMPLERS.has(u.type)) gl.uniform1iv(gl.getUniformLocation(p, u.name), Array.from({ length: u.size }, () => unit++));
  }
  gl.bindVertexArray(gl.createVertexArray());
  while (gl.getError() !== gl.NO_ERROR && !gl.isContextLost());
  gl.drawArraysInstanced(gl.TRIANGLES, 0, 3, 2);
  gl.drawArrays(gl.POINTS, 0, 1);
  gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4)); // waits for the GPU
  if (gl.isContextLost()) return 'the context was lost drawing it';
  const err = gl.getError();
  return err === gl.NO_ERROR ? null : `draw: GL error 0x${err.toString(16)}`;
}
