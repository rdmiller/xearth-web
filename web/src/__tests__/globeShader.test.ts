/// <reference types="node" />
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const frag = readFileSync(new URL('../renderer/globe.frag.glsl', import.meta.url), 'utf8');

describe('globe fragment shader', () => {
  it('fits in the 16 texture units every WebGL 2 device has', () => {
    // MAX_TEXTURE_IMAGE_UNITS is at least 16, and many phones have exactly that: a 17th
    // sampler fails to link there and nowhere else. A new globe layer packs into an
    // existing texture (as aurora / TEC / D-RAP share one) rather than adding a sampler.
    const samplers = frag.match(/^\s*uniform\s+\w*sampler\w*\s+\w+/gm) ?? [];
    expect(samplers.length).toBeGreaterThan(0);
    expect(samplers.length, samplers.join('\n')).toBeLessThanOrEqual(16);
  });
});
