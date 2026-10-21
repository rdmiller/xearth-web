import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// satellite.js's entry re-exports an optional WASM bulk propagator (top-level
// await, Node built-ins, ~300 KB). We only use the plain-JS SGP4, but the
// package doesn't declare itself side-effect free. So: the WASM loaders'
// dynamic imports point at a stub, and the bundler is told the WASM half has no
// side effects so the rest tree-shakes away. (Vite 8 bundles with Rolldown.)
const noWasm = fileURLToPath(new URL('./src/vendor/no-satellite-wasm.ts', import.meta.url));
const treeshake = {
  moduleSideEffects: (id: string) => !/satellite\.js[\\/](dist[\\/]wasm|wasm-build)[\\/]/.test(id),
};

export default defineConfig({
  // Relative base so the build works from any path (GitHub Pages project
  // sites, a subfolder, or `vite preview`).
  base: './',
  resolve: {
    alias: [
      { find: '#wasm-single-thread', replacement: noWasm },
      { find: '#wasm-multi-thread', replacement: noWasm },
    ],
  },
  build: { target: 'es2022', rolldownOptions: { treeshake } },
  // The SGP4 worker is an ES module worker (supported by all current browsers).
  worker: { format: 'es', rolldownOptions: { treeshake } },
  test: { environment: 'node' },
});
