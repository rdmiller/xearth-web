// App wiring: settings → clock → camera/sun → renderer + overlay, redrawn on a
// schedule (xearth's -wait), with hourly cloud maps faded in as they arrive.

import { subsolarPoint } from './astronomy';
import { CloudSync, type CloudStatus } from './cloudSync';
import { drawOverlay } from './overlay';
import { parseSettings, toQuery, type Settings } from './params';
import { GlobeRenderer } from './renderer/gl';
import { dayTextureUrl, loadImage, nightTextureUrl } from './textures';
import { fromLatLon } from './vec';
import { cameraFor, viewerLatLon, type ViewMode } from './view';

const BASE = import.meta.env.BASE_URL;
const FADE_MS = 2500;
const VIEW_ORDER: ViewMode[] = ['fixed', 'sunrel', 'orbit', 'moon'];

const globeCanvas = document.getElementById('globe') as HTMLCanvasElement;
const overlayCanvas = document.getElementById('overlay') as HTMLCanvasElement;
const help = document.getElementById('help') as HTMLElement;

let settings: Settings = parseSettings(location.search);
const clockStart = Date.now();
let note: string | undefined;

function simTime(): Date {
  if (!settings.time && settings.speed === 1) return new Date();
  const origin = settings.time ? settings.time.getTime() : clockStart;
  return new Date(origin + (Date.now() - clockStart) * settings.speed);
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

  const camera = cameraFor(settings, date);
  const sun = subsolarPoint(date);
  const scale = globeCanvas.width / Math.max(globeCanvas.clientWidth, 1);
  renderer.render({
    camera,
    sun: fromLatLon(sun.lat, sun.lon),
    radiusPx: radiusCss() * scale,
    clouds: settings.clouds,
    lights: settings.lights,
    grid: settings.grid,
    stars: settings.stars,
  });
  drawOverlay(overlayCanvas, {
    camera,
    radiusPx: radiusCss(),
    date,
    viewer: viewerLatLon(settings, date),
    sun,
    markers: settings.markers,
    label: settings.label,
    clouds: settings.clouds,
    cloudStatus,
    note,
  });
  schedule();
}

function schedule() {
  clearTimeout(timer);
  if (document.hidden) return;
  const animating = renderer.cloudMix < 1 || dragging || settings.speed !== 1;
  if (animating) {
    raf ||= requestAnimationFrame(frame);
  } else {
    timer = setTimeout(requestRedraw, settings.wait * 1000);
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
  settings = { ...settings, ...patch };
  if (settings.clouds !== cloudsBefore) syncClouds();
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
  const here = viewerLatLon(settings, simTime());
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
    update({ mag: Math.max(0.2, Math.min(8, settings.mag * Math.exp(-e.deltaY * 0.0015))) });
  },
  { passive: false },
);

const TOGGLES: Record<string, keyof Settings> = {
  c: 'clouds',
  n: 'lights',
  g: 'grid',
  m: 'markers',
  l: 'label',
  s: 'stars',
};

window.addEventListener('keydown', (e) => {
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  const key = e.key.toLowerCase();
  const toggle = TOGGLES[key];
  if (toggle) {
    update({ [toggle]: !settings[toggle] } as Partial<Settings>);
  } else if (key === 'v') {
    const here = viewerLatLon(settings, simTime());
    const next = VIEW_ORDER[(VIEW_ORDER.indexOf(settings.view) + 1) % VIEW_ORDER.length];
    update(next === 'fixed' ? { view: next, lat: here.lat, lon: here.lon } : { view: next, lat: 0, lon: 0 });
  } else if (key === 'f') {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void document.documentElement.requestFullscreen();
  } else if (key === 'h' || key === '?') {
    help.hidden = !help.hidden;
  } else if (key === 'escape') {
    help.hidden = true;
  }
});

syncClouds();
requestRedraw();
