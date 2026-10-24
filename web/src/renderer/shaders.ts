// Every WebGL program the app links, by name. Not used to draw: each layer links its own.
// This is what the shader checks see — the static rules in shaders.test.ts, and the real
// Direct3D 11 compile in scripts/check-shaders.mjs — so a new program must be listed here
// (a test fails on any shader source in src/ that isn't).

import globeFrag from './globe.frag.glsl?raw';
import * as bodies from './bodies';
import * as globe from './gl';
import * as model from './model';
import * as points from './points';
import * as sats from './sats';
import * as stars from './stars';
import * as winds from './winds';

export interface ShaderProgram {
  vert: string;
  frag: string;
}

export const PROGRAMS: Record<string, ShaderProgram> = {
  globe: { vert: globe.VERT, frag: globeFrag },
  stars: { vert: stars.VERT, frag: stars.FRAG },
  sats: { vert: sats.VERT, frag: sats.FRAG },
  bodies: { vert: bodies.VERT, frag: bodies.FRAG },
  points: { vert: points.VERT, frag: points.FRAG },
  model: { vert: model.VERT, frag: model.FRAG },
  winds: { vert: winds.VERT, frag: winds.FRAG },
};
