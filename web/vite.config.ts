import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Relative base so the build works from any path (GitHub Pages project
  // sites, a subfolder, or `vite preview`).
  base: './',
  build: { target: 'es2022' },
  test: { environment: 'node' },
});
