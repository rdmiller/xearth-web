// App wiring: settings → clock → camera/sun → renderer + overlay, redrawn on a
// schedule (xearth's -wait), with hourly cloud maps faded in as they arrive
// and satellites propagated from CelesTrak elements.

import '@fontsource/chakra-petch/500.css';
import '@fontsource/chakra-petch/600.css';
import type { SatRec } from 'satellite.js';
import { subsolarPoint } from './astronomy';
import { CloudSync, type CloudStatus } from './cloudSync';
import { formatSpeed, helpRows, MAG_MAX, MAG_MIN, matchHotkey, type HotkeyContext } from './hotkeys';
import { drawOverlay, formatAge, UI_FONT, type SatelliteOverlay } from './overlay';
import { parseSettings, toQuery, type Settings } from './params';
import { GlobeRenderer } from './renderer/gl';
import type { WorkerRequest, WorkerResponse } from './satWorker';
import {
  FEATURED,
  isSatelliteManifest,
  orbitTrack,
  periodMinutes,
  positionAt,
  satrecFor,
  stateAt,
  type Elements,
  type SatelliteManifest,
} from './satellites';
import { decodeCatalog, litScreenFraction, photoMagShift, starFrame } from './stars';
import { dayTextureUrl, loadImage, nightTextureUrl } from './textures';
import { fromLatLon, toLatLon, type Vec3 } from './vec';
import { cameraFor, skyFocal, viewerLatLon, type TrackResolver } from './view';

const BASE = import.meta.env.BASE_URL;
const FADE_MS = 2500;
const TOAST_MS = 1400;

const globeCanvas = document.getElementById('globe') as HTMLCanvasElement;
const overlayCanvas = document.getElementById('overlay') as HTMLCanvasElement;
const help = document.getElementById('help') as HTMLElement;
const helpKeys = document.getElementById('help-keys') as HTMLElement;
const toastEl = document.getElementById('toast') as HTMLElement;

let settings: Settings = parseSettings(location.search);
/** Wall-clock moment that `settings.time` corresponds to. */
let clockStart = Date.now();
let note: string | undefined;

function simTime(): Date {
  if (!settings.time && settings.speed === 1) return new Date();
  const origin = settings.time ? settings.time.getTime() : clockStart;
  return new Date(origin + (Date.now() - clockStart) * settings.speed);
}

/** Label suffix for a clock that isn't simply "now". */
function clockLabel(): string | undefined {
  if (!settings.time && settings.speed === 1) return undefined;
  return settings.speed === 1 ? 'fixed start time' : formatSpeed(settings.speed).toLowerCase();
}

let renderer: GlobeRenderer;
try {
  renderer = new GlobeRenderer(globeCanvas);
} catch (err) {
  document.body.insertAdjacentHTML('beforeend', `<p class="fatal">${(err as Error).message}</p>`);
  throw err;
}

// ---- textures -------------------------------------------------------------
let dayUrl = '';
const missing = new Set<string>();

function updateNote() {
  note = missing.size ? 'textures missing — run `pnpm textures`' : undefined;
}

async function ensureDayTexture(date: Date) {
  const url = dayTextureUrl(BASE, date);
  if (url === dayUrl) return;
  dayUrl = url;
  try {
    renderer.setDay(await loadImage(url, renderer.maxTextureSize));
    missing.delete('day');
  } catch (err) {
    console.warn('day texture:', err);
    missing.add('day');
  }
  updateNote();
  requestRedraw();
}

loadImage(nightTextureUrl(BASE), renderer.maxTextureSize)
  .then((img) => renderer.setNight(img))
  .catch((err) => {
    console.warn('night texture:', err);
    missing.add('night');
  })
  .finally(() => {
    updateNote();
    requestRedraw();
  });

fetch(`${BASE}stars.json`)
  .then((r) => {
    if (!r.ok) throw new Error(`${r.status} stars.json`);
    return r.json();
  })
  .then((json) => {
    renderer.setStars(decodeCatalog(json));
    requestRedraw();
  })
  .catch((err) => console.warn('stars:', err));

// ---- clouds -----------------------------------------------------------------
let cloudStatus: CloudStatus = { state: 'idle' };
let fadeStart = 0;

const clouds = new CloudSync<ImageBitmap>(
  new URL(settings.cloudsrc, location.href).href,
  {
    fetchJson: async (url) => {
      const r = await fetch(url, { cache: 'no-cache' });
      if (!r.ok) throw new Error(`${r.status} ${url}`);
      return r.json();
    },
    loadImage: (url) => loadImage(url, renderer.maxTextureSize),
  },
  (image) => {
    renderer.setClouds(image);
    if (renderer.cloudMix < 1) fadeStart = performance.now();
    requestRedraw();
  },
  (status) => {
    cloudStatus = status;
    requestRedraw();
  },
);

function syncClouds() {
  if (settings.clouds) clouds.start();
  else clouds.stop();
}

// ---- satellites ---------------------------------------------------------------
const SAT_POLL_MS = 30 * 60_000;
/** Simulated time between Starlink propagations (one SGP4 pass in the worker). */
const SAT_STEP_MS = 1000;
const ORBIT_STEPS = 160;

let satManifest: SatelliteManifest | undefined;
let satError: string | undefined;
const featuredRecs = new Map<string, { rec: SatRec; elements: Elements }>();
let bulkCount = 0;
let workerBusy = false;
let lastBulkTime = NaN;
let satTimer: ReturnType<typeof setInterval> | undefined;

const satWorker = new Worker(new URL('./satWorker.ts', import.meta.url), { type: 'module' });
satWorker.onmessage = (e: MessageEvent<WorkerResponse>) => {
  const m = e.data;
  workerBusy = false;
  if (m.type === 'loaded') {
    bulkCount = m.valid;
    lastBulkTime = NaN;
  } else {
    renderer.setSatellites(m.positions as Float32Array<ArrayBuffer>);
  }
  requestRedraw();
};

const post = (msg: WorkerRequest) => satWorker.postMessage(msg);

async function loadSatellites() {
  try {
    const url = new URL('latest.json', new URL(settings.satsrc, location.href)).href;
    const r = await fetch(url, { cache: 'no-cache' });
    if (!r.ok) throw new Error(`${r.status} ${url}`);
    const m: unknown = await r.json();
    if (!isSatelliteManifest(m)) throw new Error('satellites/latest.json is not a satellite manifest');
    satError = undefined;
    if (satManifest?.generated !== m.generated) {
      satManifest = m;
      featuredRecs.clear();
      for (const f of FEATURED) {
        const el = m.featured[String(f.norad)];
        const rec = el ? satrecFor(el) : null;
        if (rec && el) featuredRecs.set(f.key, { rec, elements: el });
      }
      workerBusy = true;
      post({ type: 'load', elements: m.groups.starlink ?? [] });
    }
  } catch (err) {
    satError = err instanceof Error ? err.message : String(err);
    console.warn('satellites:', err);
  }
  requestRedraw();
}

function syncSatellites() {
  clearInterval(satTimer);
  satTimer = undefined;
  if (settings.sats === 'off') return;
  void loadSatellites();
  satTimer = setInterval(loadSatellites, SAT_POLL_MS);
}

const resolveTrack: TrackResolver = (key, date) => {
  const rec = featuredRecs.get(key)?.rec;
  const p = rec ? positionAt(rec, date) : null;
  return p ? toLatLon(p) : null;
};

function satelliteOverlay(date: Date, sun: Vec3): SatelliteOverlay | undefined {
  if (settings.sats === 'off') return undefined;
  if (!satManifest) return { featured: [], summary: satError ? 'satellites unavailable' : 'satellites loading…' };
  const featured = FEATURED.flatMap((sat) => {
    const entry = featuredRecs.get(sat.key);
    const state = entry ? stateAt(entry.rec, date, sun) : null;
    if (!entry || !state) return [];
    const half = periodMinutes(entry.elements) / 2;
    return [{ sat, state, track: orbitTrack(entry.rec, date, half, half, ORBIT_STEPS) }];
  });
  const fetched = formatAge(new Date(satManifest.generated), new Date());
  const bulk = settings.sats === 'all' && bulkCount ? `${bulkCount.toLocaleString()} Starlink · ` : '';
  return {
    featured,
    tracking: settings.view === 'track' ? settings.track : undefined,
    summary: `satellites ${bulk}elements fetched ${fetched}${satError ? ' (update failed)' : ''}`,
  };
}

// ---- frame & schedule -------------------------------------------------------
let timer: ReturnType<typeof setTimeout> | undefined;
let raf = 0;

function radiusCss() {
  return 0.5 * Math.min(globeCanvas.clientWidth, globeCanvas.clientHeight) * 0.9 * settings.mag;
}

function frame() {
  raf = 0;
  renderer.resize();
  const date = simTime();
  void ensureDayTexture(date);

  if (renderer.cloudMix < 1) {
    renderer.cloudMix = Math.min(1, (performance.now() - fadeStart) / FADE_MS);
  }

  const camera = cameraFor(settings, date, resolveTrack);
  const sun = subsolarPoint(date);
  const sunDir = fromLatLon(sun.lat, sun.lon);

  const showBulk = settings.sats === 'all' && bulkCount > 0;
  if (showBulk && !workerBusy && !(Math.abs(date.getTime() - lastBulkTime) < SAT_STEP_MS)) {
    workerBusy = true;
    lastBulkTime = date.getTime();
    post({ type: 'propagate', time: lastBulkTime });
  }
  const scale = globeCanvas.width / Math.max(globeCanvas.clientWidth, 1);
  const radiusPx = radiusCss() * scale;
  const magShift =
    settings.stars === 'photo'
      ? photoMagShift(litScreenFraction(radiusPx, globeCanvas.width, globeCanvas.height, camera.dir, sunDir))
      : 0;
  renderer.render({
    camera,
    sun: sunDir,
    radiusPx,
    clouds: settings.clouds,
    lights: settings.lights,
    grid: settings.grid,
    stars: settings.stars === 'off' ? null : { frame: starFrame(date), focal: skyFocal(camera), magShift },
    satellites: showBulk,
    dpr: scale,
  });
  drawOverlay(overlayCanvas, {
    camera,
    radiusPx: radiusCss(),
    date,
    viewer: viewerLatLon(settings, date, resolveTrack),
    satellites: satelliteOverlay(date, sunDir),
    sun,
    markers: settings.markers,
    label: settings.label,
    clouds: settings.clouds,
    cloudStatus,
    clock: clockLabel(),
    note,
  });
  schedule();
}

function schedule() {
  clearTimeout(timer);
  if (document.hidden) return;
  const animating = renderer.cloudMix < 1 || dragging || (settings.speed !== 1 && settings.speed !== 0);
  if (animating) {
    raf ||= requestAnimationFrame(frame);
  } else {
    // Satellites cross ~4° of arc a minute, so keep them moving smoothly.
    const wait = settings.sats === 'off' ? settings.wait : Math.min(settings.wait, 1);
    timer = setTimeout(requestRedraw, wait * 1000);
  }
}

function requestRedraw() {
  clearTimeout(timer);
  raf ||= requestAnimationFrame(frame);
}

document.addEventListener('visibilitychange', () => {
  if (!document.hidden) {
    requestRedraw();
    if (settings.clouds) void clouds.check();
  }
});
window.addEventListener('resize', requestRedraw);

// ---- settings changes ---------------------------------------------------------
let urlTimer: ReturnType<typeof setTimeout> | undefined;

function update(patch: Partial<Settings>) {
  const cloudsBefore = settings.clouds;
  const satsBefore = settings.sats;
  settings = { ...settings, ...patch };
  if (settings.clouds !== cloudsBefore) syncClouds();
  if ((settings.sats === 'off') !== (satsBefore === 'off')) syncSatellites();
  clearTimeout(urlTimer);
  urlTimer = setTimeout(() => history.replaceState(null, '', `${location.pathname}${toQuery(settings)}`), 300);
  requestRedraw();
}

// Drag to look around (switches to a fixed viewpoint), wheel to zoom.
let dragging = false;
let last = { x: 0, y: 0 };

overlayCanvas.addEventListener('pointerdown', (e) => {
  dragging = true;
  last = { x: e.clientX, y: e.clientY };
  overlayCanvas.setPointerCapture(e.pointerId);
  const here = viewerLatLon(settings, simTime(), resolveTrack);
  if (settings.view !== 'fixed') update({ view: 'fixed', lat: here.lat, lon: here.lon, rot: 0 });
});

overlayCanvas.addEventListener('pointermove', (e) => {
  if (!dragging) return;
  const degPerPx = 180 / Math.PI / radiusCss();
  const dx = e.clientX - last.x;
  const dy = e.clientY - last.y;
  last = { x: e.clientX, y: e.clientY };
  update({
    lat: Math.max(-90, Math.min(90, settings.lat + dy * degPerPx)),
    lon: ((settings.lon - dx * degPerPx + 540) % 360) - 180,
  });
});

const endDrag = () => {
  dragging = false;
  requestRedraw();
};
overlayCanvas.addEventListener('pointerup', endDrag);
overlayCanvas.addEventListener('pointercancel', endDrag);

overlayCanvas.addEventListener(
  'wheel',
  (e) => {
    e.preventDefault();
    update({ mag: Math.max(MAG_MIN, Math.min(MAG_MAX, settings.mag * Math.exp(-e.deltaY * 0.0015))) });
  },
  { passive: false },
);

// ---- hotkeys ------------------------------------------------------------------
let toastTimer: ReturnType<typeof setTimeout> | undefined;

function toast(message: string) {
  toastEl.textContent = message;
  toastEl.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove('show'), TOAST_MS);
}

const hotkeyContext: HotkeyContext = {
  get settings() {
    return settings;
  },
  update,
  viewer: () => viewerLatLon(settings, simTime(), resolveTrack),
  setSpeed(speed) {
    // Re-anchor so the displayed moment carries on from where it is.
    const now = simTime();
    clockStart = Date.now();
    update({ time: now, speed });
  },
  goLive() {
    clockStart = Date.now();
    update({ time: null, speed: 1 });
  },
  refreshClouds: () => {
    if (!settings.clouds) update({ clouds: true });
    else void clouds.check();
  },
  toggleFullscreen() {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void document.documentElement.requestFullscreen();
  },
  toggleHelp(open) {
    help.hidden = open === undefined ? !help.hidden : !open;
  },
  toast,
};

window.addEventListener('keydown', (e) => {
  const target = e.target as HTMLElement | null;
  if (target?.closest('input, textarea, select, [contenteditable]')) return;
  const hk = matchHotkey(e);
  if (!hk) return;
  e.preventDefault(); // Space would scroll, arrows would pan the page
  hk.run(hotkeyContext, e);
});

helpKeys.innerHTML = helpRows()
  .map(
    ({ group, rows }) =>
      `<h3>${group}</h3><table>${rows
        .map((r) => `<tr><td><kbd>${r.label}</kbd></td><td>${r.description}</td></tr>`)
        .join('')}</table>`,
  )
  .join('');

// Canvas text doesn't trigger web-font loading; ask for the HUD font, redraw once it's in.
Promise.all([`500 11px ${UI_FONT}`, `600 11px ${UI_FONT}`].map((f) => document.fonts.load(f)))
  .then(requestRedraw)
  .catch(() => {});

syncClouds();
syncSatellites();
requestRedraw();
