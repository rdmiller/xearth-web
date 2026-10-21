// Stand-in for satellite.js's optional WASM builds (#wasm-single-thread,
// #wasm-multi-thread), aliased in vite.config.ts so ~300 KB of unused WASM glue
// isn't emitted. This app only uses the plain-JS SGP4.
export default async function createWasmModule(): Promise<never> {
  throw new Error('satellite.js WASM runtimes are not bundled in xearth-web');
}
