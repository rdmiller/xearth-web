// Compiles and draws every WebGL program (src/renderer/shaders.ts) in Chrome through ANGLE's
// Direct3D 11 backend: what Chrome and Edge use on Windows. ANGLE translates each shader to
// HLSL there, and a shader that SwiftShader or another GPU accepts can still fail to compile
// at its first draw and lose the context — the globe's lodFor sampler overloads did (X3003).
//
//   pnpm check:shaders          on this machine's GPU
//   pnpm check:shaders --warp   on WARP, Windows' software D3D11 (CI has no GPU)
//
// Windows only. Chrome runs with a throwaway profile, never yours: a page that loses the
// context has WebGL blocked, and after a few, so does every site until the browser exits.

import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const TIMEOUT_MS = 90_000;
/** What ANGLE logs when D3D rejects a translated shader, or Chrome gives up on the page's GPU use. */
const LOG_ERRORS = /error X\d{4}|Error compiling dynamic|caused context loss|blocked from accessing 3D APIs/i;

if (process.platform !== 'win32') {
  console.log('check:shaders: skipped — ANGLE\'s Direct3D 11 backend is Windows only.');
  process.exit(0);
}

const warp = process.argv.includes('--warp');
const angle = warp ? 'd3d11-warp' : 'd3d11';
const web = fileURLToPath(new URL('..', import.meta.url));

function findBrowser() {
  const roots = [process.env.PROGRAMFILES, process.env['PROGRAMFILES(X86)'], process.env.LOCALAPPDATA].filter(Boolean);
  const candidates = [
    process.env.CHROME_PATH,
    ...roots.map((r) => join(r, 'Google/Chrome/Application/chrome.exe')),
    ...roots.map((r) => join(r, 'Microsoft/Edge/Application/msedge.exe')),
  ];
  const found = candidates.find((p) => p && existsSync(p));
  if (!found) throw new Error('check:shaders: no Chrome or Edge found; set CHROME_PATH');
  return found;
}

let report;
const reported = new Promise((resolve) => (report = resolve));
const page = `<!doctype html><title>shader check</title><script type="module">
import { PROGRAMS } from '/src/renderer/shaders.ts';
import { checkPrograms } from '/src/renderer/shaderCheck.ts';
const send = (r) => fetch('/__shader-check', { method: 'POST', body: JSON.stringify(r) });
checkPrograms(PROGRAMS).then(send, (e) => send({ renderer: '?', results: { page: String(e) } }));
</script>`;

const server = await createServer({
  root: web,
  logLevel: 'error',
  server: { port: 0, host: '127.0.0.1' },
  plugins: [
    {
      name: 'shader-check',
      configureServer(s) {
        s.middlewares.use('/__shader-check', async (req, res) => {
          if (req.method === 'POST') {
            let body = '';
            for await (const chunk of req) body += chunk;
            res.end();
            report(JSON.parse(body));
          } else {
            res.setHeader('content-type', 'text/html');
            res.end(await s.transformIndexHtml('/__shader-check', page));
          }
        });
      },
    },
  ],
});
await server.listen();
const url = `${server.resolvedUrls.local[0]}__shader-check`;

const profile = await mkdtemp(join(tmpdir(), 'xearth-shader-check-'));
const browser = findBrowser();
const chrome = spawn(browser, [
  `--user-data-dir=${profile}`,
  '--headless=new',
  `--use-angle=${angle}`,
  '--ignore-gpu-blocklist',
  '--enable-logging',
  '--v=1',
  '--no-first-run',
  '--no-default-browser-check',
  '--disable-extensions',
  url,
], { stdio: 'ignore' });

let failed = false;
let timer;
try {
  const timeout = new Promise((_, reject) => (timer = setTimeout(() => reject(new Error(`no report in ${TIMEOUT_MS / 1000} s`)), TIMEOUT_MS)));
  const { renderer, results } = await Promise.race([reported, timeout]);
  console.log(`${browser}\n--use-angle=${angle}: ${renderer}\n`);
  // Not D3D11 means Chrome fell back (to SwiftShader, say), which proves nothing here.
  if (!/Direct3D11|D3D11/.test(renderer)) {
    console.error(`✗ not ANGLE's Direct3D 11 backend: ${renderer}`);
    failed = true;
  }
  for (const [name, error] of Object.entries(results)) {
    console.log(error ? `✗ ${name}: ${error}` : `✓ ${name}`);
    if (error) failed = true;
  }
} catch (err) {
  console.error(`✗ ${err.message}`);
  failed = true;
} finally {
  clearTimeout(timer);
  // The whole tree: the GPU process holds the profile's files open.
  spawnSync('taskkill', ['/pid', String(chrome.pid), '/T', '/F'], { stdio: 'ignore' });
  await server.close();
}

const log = await readFile(join(profile, 'chrome_debug.log'), 'utf8').catch(() => '');
const hits = [...new Set(log.split(/\r?\n/).filter((l) => LOG_ERRORS.test(l)))];
if (hits.length) {
  console.error(`\n✗ Chrome's log:\n${hits.slice(0, 20).join('\n')}`);
  failed = true;
}
await rm(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 }).catch(() => {});

if (failed) process.exit(1);
console.log('\nEvery program compiles and draws on Direct3D 11.');
