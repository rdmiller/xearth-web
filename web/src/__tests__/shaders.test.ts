/// <reference types="node" />
import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { PROGRAMS } from '../renderer/shaders';

// Rules for what SwiftShader, Mesa and the GPU at hand accept but some WebGL 2 device
// doesn't. They catch known cases only: `pnpm check:shaders` compiles every program
// through ANGLE's Direct3D 11 backend (Chrome and Edge on Windows) for real, and CI runs it.

const src = new URL('../', import.meta.url);
const programs = Object.entries(PROGRAMS);

/** GLSL without its comments, so a commented-out line doesn't count. */
const code = (glsl: string) => glsl.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

/** Names of the functions a shader defines, once per definition. */
function definitions(glsl: string): string[] {
  return [...code(glsl).matchAll(/^\s*(?:(?:highp|mediump|lowp)\s+)?\w+\s+(\w+)\s*\([^)]*\)\s*\{/gm)]
    .map((m) => m[1])
    .filter((name) => !['if', 'for', 'while', 'switch'].includes(name));
}

describe('WebGL shaders', () => {
  it('are all listed, so the checks see every one', () => {
    let sources = 0;
    for (const f of readdirSync(src, { recursive: true, encoding: 'utf8' })) {
      if (/__tests__/.test(f)) continue;
      if (f.endsWith('.glsl')) sources++;
      else if (f.endsWith('.ts')) sources += readFileSync(new URL(f.replace(/\\/g, '/'), src), 'utf8').split('#version 300 es').length - 1;
    }
    expect(sources, 'a shader in src/ is missing from PROGRAMS in renderer/shaders.ts').toBe(programs.length * 2);
  });

  it.each(programs)('%s fits in the 16 texture units every WebGL 2 device has', (_, p) => {
    // MAX_TEXTURE_IMAGE_UNITS is at least 16, and many phones have exactly that: a 17th
    // sampler fails to link there and nowhere else. A new globe layer packs into an
    // existing texture (as aurora / TEC / D-RAP share one) rather than adding a sampler.
    for (const stage of [p.vert, p.frag]) {
      const samplers = code(stage).match(/^\s*uniform\s+(?:\w+\s+)?\w*sampler\w*\s+\w+/gm) ?? [];
      expect(samplers.length, samplers.join('\n')).toBeLessThanOrEqual(16);
    }
  });

  it.each(programs)('%s never overloads a function', (_, p) => {
    // ANGLE's D3D11 backend leans on HLSL's own overloading, so two GLSL signatures that
    // become one HLSL signature are a redefinition (X3003) and the program fails to compile,
    // at the first draw: the context is lost, on Windows only. Samplers do it — they're
    // passed as indices — as lodFor(sampler2D) and lodFor(sampler2DArray) did to the globe.
    // Distinct names never collide.
    for (const stage of [p.vert, p.frag]) {
      const names = definitions(stage);
      expect(names).toContain('main');
      expect(names.filter((n, i) => names.indexOf(n) !== i)).toEqual([]);
    }
  });

  it('would have caught the lodFor overload', () => {
    const overloaded = `
float lodFor(sampler2D t, float mu) { return 0.0; }
// float lodFor(sampler2D t) { return 0.0; }
float lodFor(sampler2DArray t, float mu) { return 0.0; }
void main() { if (true) { } }`;
    expect(definitions(overloaded)).toEqual(['lodFor', 'lodFor', 'main']);
  });
});
