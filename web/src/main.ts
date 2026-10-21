// App wiring: settings → clock → camera/sun → renderer + overlay, redrawn on a
// schedule (xearth's -wait), with hourly cloud maps faded in as they arrive
// and satellites propagated from CelesTrak elements.

import '@fontsource/chakra-petch/500.css';
import '@fontsource/chakra-petch/600.css';
import type { SatRec } from 'satellite.js';
import { subsolarPoint } from './astronomy';
import { framingViewpoint, MOON_RADIUS_KM, placeBody, skyBodies, type SkyBodies } from './bodies';
import { describeCadence, redrawInterval } from './cadence';
import {
  flightPath,
  focusLaunch,
  formatClock,
  isLaunchManifest,
  launchState,
  shortRocket,
  type LaunchManifest,
  type LaunchPhase,
  type LaunchState,
} from './launches';
import { CloudSync, type CloudStatus } from './cloudSync';
import { formatSpeed, helpRows, MAG_MAX, MAG_MIN, matchHotkey, type HotkeyContext } from './hotkeys';
import {
  clearOverlaySprites,
  drawOverlay,
  formatAge,
  UI_FONT,
  type BodyMarker,
  type LaunchOverlay,
  type SatelliteOverlay,
} from './overlay';
import { FrameStats, GpuTimer } from './perf';
import { parseSettings, toQuery, type Settings } from './params';
import { GlobeRenderer } from './renderer/gl';
import type { WorkerRequest, WorkerResponse } from './satWorker';
import {
  FEATURED,
  isSatelliteManifest,
  periodMinutes,
  positionAt,
  satrecFor,
  stateAt,
  TrackCache,
  type Elements,
  type SatelliteManifest,
} from './satellites';
import { decodeCatalog, litScreenFraction, photoMagShift, starFrame } from './stars';
import { dayTextureUrl, loadImage, nightTextureUrl } from './textures';
import { cross, dot, fromLatLon, normalize, scale, sub, toLatLon, type Vec3 } from './vec';
import { cameraFor, ORTHO_SKY_FOCAL, skyFocal, viewerLatLon, type Camera, type TrackResolver } from './view';
import type { BodyDraw } from './renderer/bodies';

const BASE = import.meta.env.BASE_URL;
const FADE_MS = 2500;
const TOAST_MS = 1400;

const globeCanvas = document.getElementById('globe') as HTMLCanvasElement;
const overlayCanvas = document.getElementById('overlay') as HTMLCanvasElement;
const help = document.getElementById('help') as HTMLElement;
const helpKeys = document.getElementById('help-keys') as HTMLElement;
const toastEl = document.getElementById('toast') as HTMLElement;

let settings: Settings = parseSettings(location.search);
let note: string | undefined;

// Time is read on the frame's own vsync timestamp (performance.now's clock)
// rather than Date.now(), so motion advances by an even amount every frame.
let perfToWall = Date.now() - performance.now();

/** Wall-clock ms at a performance.now() timestamp. */
function wallAt(perfNow = performance.now()): number {
  // The two clocks drift apart over long runs (sleep, NTP); re-sync if they do.
  const drift = Date.now() - (performance.now() + perfToWall);
  if (Math.abs(drift) > 50) perfToWall += drift;
  return perfNow + perfToWall;
}

/** Wall-clock moment that `settings.time` corresponds to. */
let clockStart = wallAt();

function simTime(perfNow?: number): Date {
  const wall = wallAt(perfNow);
  if (!settings.time && settings.speed === 1) return new Date(wall);
  const origin = settings.time ? settings.time.getTime() : clockStart;
  return new Date(origin + (wall - clockStart) * settings.speed);
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

loadImage(`${BASE}textures/moon.jpg`, renderer.maxTextureSize)
  .then((img) => {
    renderer.setMoon(img);
    requestRedraw();
  })
  .catch((err) => console.warn('moon texture:', err));

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
/**
 * Simulated time between Starlink SGP4 passes in the worker. In between, the
 * renderer moves each point along its velocity to the exact frame time
 * (error ~0.5·g·Δt²: ~0.4 km at 10 s, well under a pixel).
 */
const SAT_REFRESH_MS = 10_000;
/** Cap on extrapolation: past this a straight line visibly leaves the orbit. */
const SAT_MAX_EXTRAPOLATE_S = 60;
const ORBIT_STEPS = 160;

let satManifest: SatelliteManifest | undefined;
let satError: string | undefined;
const featuredRecs = new Map<string, { rec: SatRec; elements: Elements }>();
let bulkCount = 0;
let workerBusy = false;
/** Simulated time of the last pass requested, and of the positions now on the GPU. */
let requestedTime = NaN;
let bulkTime = NaN;
const tracks = new TrackCache();
let satTimer: ReturnType<typeof setInterval> | undefined;

const satWorker = new Worker(new URL('./satWorker.ts', import.meta.url), { type: 'module' });
satWorker.onmessage = (e: MessageEvent<WorkerResponse>) => {
  const m = e.data;
  workerBusy = false;
  if (m.type === 'loaded') {
    bulkCount = m.valid;
    requestedTime = NaN;
    bulkTime = NaN;
  } else {
    renderer.setSatellites(m.positions as Float32Array<ArrayBuffer>, m.velocities as Float32Array<ArrayBuffer>);
    bulkTime = m.time;
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
      tracks.clear();
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

// ---- launches -------------------------------------------------------------------
const LAUNCH_POLL_MS = 15 * 60_000;
/** Near T0, ask Launch Library for that one launch's latest NET/status this often. */
const LAUNCH_LIVE_MS = 5 * 60_000;
const LL2 = 'https://ll.thespacedevs.com/2.3.0';

let launchManifest: LaunchManifest | undefined;
let launchTimer: ReturnType<typeof setInterval> | undefined;
let lastLiveCheck = 0;
/** From the last frame: is a countdown on screen, is anything in flight (for redraw cadence). */
let launchFlags = { countdown: false, flying: false };

async function loadLaunches() {
  try {
    const url = new URL('latest.json', new URL(settings.launchsrc, location.href)).href;
    const r = await fetch(url, { cache: 'no-cache' });
    if (!r.ok) throw new Error(`${r.status} ${url}`);
    const m: unknown = await r.json();
    if (!isLaunchManifest(m)) throw new Error('launches/latest.json is not a launch manifest');
    launchManifest = m;
  } catch (err) {
    console.warn('launches:', err);
  }
  requestRedraw();
}

/**
 * Holds and scrubs move minute by minute, which the hourly manifest can't follow.
 * In live mode, within T−20…T+15 min, re-read that launch from Launch Library at
 * most every 5 minutes (its free tier allows ~15 requests an hour per client).
 */
async function refreshLiveLaunch() {
  if (!launchManifest || !settings.launches || settings.time || settings.speed !== 1) return;
  const now = Date.now();
  if (now - lastLiveCheck < LAUNCH_LIVE_MS) return;
  const soon = launchManifest.launches.find((l) => {
    const dt = Date.parse(l.net) - now;
    return dt < 20 * 60_000 && dt > -15 * 60_000;
  });
  if (!soon) return;
  lastLiveCheck = now;
  try {
    const r = await fetch(`${LL2}/launches/${soon.id}/?mode=normal`);
    if (!r.ok) throw new Error(`${r.status}`);
    const rec = await r.json();
    soon.net = rec.net ?? soon.net;
    soon.status = { abbrev: rec.status?.abbrev ?? soon.status.abbrev, name: rec.status?.name ?? soon.status.name };
    soon.webcastLive = !!rec.webcast_live;
    requestRedraw();
  } catch (err) {
    console.warn('launch status:', err);
  }
}
setInterval(() => void refreshLiveLaunch(), 60_000);

function syncLaunches() {
  clearInterval(launchTimer);
  launchTimer = undefined;
  if (!settings.launches) return;
  void loadLaunches();
  launchTimer = setInterval(() => void loadLaunches(), LAUNCH_POLL_MS);
}

function launchStates(date: Date): LaunchState[] {
  if (!settings.launches || !launchManifest) return [];
  return launchManifest.launches.map((l) => launchState(l, date)).filter((s) => s.phase !== 'done');
}

const PHASE_LABEL: Record<LaunchPhase, string> = {
  countdown: '',
  ascent: 'ASCENT (APPROX.)',
  coast: 'COAST · PREDICTED ORBIT',
  deployed: 'DEPLOYED',
  inflight: 'IN FLIGHT · NO TRAJECTORY DATA',
  done: '',
};

function launchOverlay(states: LaunchState[], focus: LaunchState | undefined) {
  const tracked = settings.view === 'track' && settings.track === 'launch';
  const overlays: LaunchOverlay[] = states.map((st) => {
    const l = st.launch;
    const flying = st.phase === 'ascent' || st.phase === 'coast' || st.phase === 'deployed';
    const numbers = [
      st.altKm !== undefined ? `${Math.round(st.altKm)} KM` : '',
      st.speed !== undefined ? `${st.speed.toFixed(1)} KM/S` : '',
    ]
      .filter(Boolean)
      .join(' · ');
    const detail = flying
      ? [PHASE_LABEL[st.phase], numbers].filter(Boolean)
      : st.phase === 'inflight'
        ? ['IN FLIGHT', 'NO TRAJECTORY DATA']
        : undefined;
    return {
      id: l.id,
      rocket: shortRocket(l.rocket).toUpperCase(),
      mission: l.mission.toUpperCase(),
      clock: formatClock(st.t),
      status: l.status.abbrev || '?',
      pad: st.pad,
      vehicle: flying ? st.pos : undefined,
      // The focused launch shows its whole predicted route, even before liftoff.
      path: flying || st === focus ? flightPath(st) : undefined,
      detail,
      focus: st === focus,
      tracked: tracked && st === focus,
    };
  });
  const f = focus;
  const line = f
    ? `launch ${shortRocket(f.launch.rocket)} · ${f.launch.mission} · ${formatClock(f.t)} · ${
        f.phase === 'countdown' ? f.launch.status.name || f.launch.status.abbrev : PHASE_LABEL[f.phase].toLowerCase()
      }`
    : undefined;
  return { overlays, line };
}

/**
 * Framing views (E): put the body just past the limb. In the sky projection the
 * disc spans atan(1 / focal) of sky, so aim ~1.35 disc radii off the line of sight.
 */
function framingOffsetDeg(): number {
  const focal = settings.dist > 1.0001 ? 1 / Math.tan(Math.asin(1 / settings.dist)) : ORTHO_SKY_FOCAL;
  return (Math.atan(1.35 / focal) * 180) / Math.PI;
}

const resolveTrack: TrackResolver = (key, date) => {
  if (key === 'sunrise' || key === 'moonrise') {
    const b = skyBodies(date);
    // Put the body on the screen's longer axis, where there's room beside the globe.
    const toward = globeCanvas.clientWidth >= globeCanvas.clientHeight ? 'east' : 'north';
    return framingViewpoint(key === 'sunrise' ? b.sunDir : b.moonPos, framingOffsetDeg(), toward);
  }
  if (key === 'launch') {
    const f = focusLaunch(launchStates(date));
    return f ? toLatLon(f.pos) : null;
  }
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
    const period = periodMinutes(entry.elements);
    const track = tracks.track(sat.key, entry.rec, date, period / 2, period / 2, period / ORBIT_STEPS, state.pos);
    return [{ sat, state, track }];
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

/** The Sun and Moon for this frame: GPU draws plus overlay markers, and whether the Sun is in shot. */
function bodiesFor(sky: SkyBodies, camera: Camera, radiusPx: number, w: number, h: number) {
  const focal = skyFocal(camera);
  const draws: BodyDraw[] = [];
  const markers: BodyMarker[] = [];
  let sunInShot = false;
  const entries = [
    // The Sun is effectively at infinity: any far point along its direction will do.
    { kind: 'sun' as const, pos: scale(sky.sunDir, 1e6), ang: sky.sunRadius },
    { kind: 'moon' as const, pos: sky.moonPos, ang: Math.asin(MOON_RADIUS_KM / Math.max(sky.moonDistKm, 1)) },
  ];
  for (const e of entries) {
    const p = placeBody(camera, focal, e.pos, e.ang * settings.bodyscale);
    markers.push({
      kind: e.kind,
      label: e.kind === 'sun' ? 'SUN' : `MOON · ${Math.round(sky.moonLit * 100)}% LIT`,
      x: p.x,
      y: p.y,
      radius: p.radius,
      ahead: p.ahead,
      occluded: p.occluded,
    });
    if (!p.ahead) continue;
    const cx = (p.x * radiusPx) / (0.5 * w);
    const cy = (p.y * radiusPx) / (0.5 * h);
    if (Math.abs(cx) > 1.5 || Math.abs(cy) > 1.5) continue;
    if (e.kind === 'sun' && !p.occluded && Math.abs(cx) < 1 && Math.abs(cy) < 1) sunInShot = true;
    // View basis at the body: screen right/up made perpendicular to the sight line.
    const back = scale(p.dir, -1);
    const right = normalize(sub(camera.right, scale(back, dot(camera.right, back))));
    const up = cross(back, right);
    draws.push({
      kind: e.kind,
      center: [cx, cy],
      radiusPx: p.radius * radiusPx,
      right,
      up,
      back,
      sun: sky.sunDir,
      moonFrame: e.kind === 'moon' ? sky.moonFrame : undefined,
    });
  }
  return { draws, markers, sunInShot };
}

function radiusCss() {
  return 0.5 * Math.min(globeCanvas.clientWidth, globeCanvas.clientHeight) * 0.9 * settings.mag;
}

// ---- frame-rate display ----------------------------------------------------------
const stats = new FrameStats();
const gpuTimer = new GpuTimer(renderer.gl);
/** How the next redraw is scheduled, for the frame-rate display. */
let renderMode = '';
/** Current redraw interval, s (0 = every frame); sizes the display's averaging window. */
let redrawEvery = 0;

function frame(now: number) {
  raf = 0;
  const t0 = performance.now();
  renderer.resize();
  const date = simTime(now);
  void ensureDayTexture(date);

  if (renderer.cloudMix < 1) {
    renderer.cloudMix = Math.min(1, (performance.now() - fadeStart) / FADE_MS);
  }

  const camera = cameraFor(settings, date, resolveTrack);
  const sun = subsolarPoint(date);
  const sunDir = fromLatLon(sun.lat, sun.lon);

  const showBulk = settings.sats === 'all' && bulkCount > 0;
  const tMs = date.getTime();
  if (showBulk && !workerBusy && !(Math.abs(tMs - requestedTime) < SAT_REFRESH_MS)) {
    workerBusy = true;
    requestedTime = tMs;
    post({ type: 'propagate', time: tMs });
  }
  const bulkDt = Math.max(-SAT_MAX_EXTRAPOLATE_S, Math.min(SAT_MAX_EXTRAPOLATE_S, (tMs - bulkTime) / 1000));
  const scale = globeCanvas.width / Math.max(globeCanvas.clientWidth, 1);
  const radiusPx = radiusCss() * scale;
  const bodies = settings.bodies
    ? bodiesFor(skyBodies(date), camera, radiusPx, globeCanvas.width, globeCanvas.height)
    : { draws: [], markers: [], sunInShot: false };
  // A camera exposed for the Sun itself shows no stars at all.
  const magShift =
    settings.stars === 'photo'
      ? photoMagShift(litScreenFraction(radiusPx, globeCanvas.width, globeCanvas.height, camera.dir, sunDir)) +
        (bodies.sunInShot ? 10 : 0)
      : 0;
  const satOverlay = satelliteOverlay(date, sunDir);
  const lStates = launchStates(date);
  const lFocus = focusLaunch(lStates);
  const launch = launchOverlay(lStates, lFocus);
  launchFlags = {
    countdown: lStates.some((s) => s.phase === 'countdown'),
    flying: lStates.some((s) => s.phase === 'ascent' || s.phase === 'coast' || s.phase === 'deployed'),
  };
  const t1 = performance.now();

  const slot = stats.nextSlot;
  if (settings.fps) gpuTimer.begin();
  renderer.render({
    camera,
    sun: sunDir,
    radiusPx,
    clouds: settings.clouds,
    lights: settings.lights,
    grid: settings.grid,
    stars: settings.stars === 'off' ? null : { frame: starFrame(date), focal: skyFocal(camera), magShift },
    satellites: showBulk && Number.isFinite(bulkTime) ? { dt: bulkDt } : null,
    bodies: bodies.draws,
    dpr: scale,
  });
  if (settings.fps) gpuTimer.end(slot);
  const t2 = performance.now();

  drawOverlay(overlayCanvas, {
    camera,
    radiusPx: radiusCss(),
    date,
    viewer: viewerLatLon(settings, date, resolveTrack),
    satellites: satOverlay,
    bodies: settings.bodies ? bodies.markers : undefined,
    launches: launch.overlays,
    launchLine: launch.line,
    perf: settings.fps
      ? {
          summary: stats.summary(now, Math.max(1000, redrawEvery * 3000 + 100)),
          intervals: stats.recentIntervals(120),
          mode: renderMode,
          gpuAvailable: gpuTimer.available,
        }
      : undefined,
    sun,
    markers: settings.markers,
    label: settings.label,
    clouds: settings.clouds,
    cloudStatus,
    clock: clockLabel(),
    note,
  });
  const t3 = performance.now();

  if (settings.fps) {
    stats.record(now, { sim: t1 - t0, gl: t2 - t1, overlay: t3 - t2 });
    gpuTimer.poll((s, ms) => stats.recordGpu(s, ms));
  }
  schedule();
}

function schedule() {
  clearTimeout(timer);
  if (document.hidden) return;
  let interval = redrawInterval({
    animating: renderer.cloudMix < 1 || dragging,
    leo: settings.sats !== 'off' || settings.view === 'orbit' || settings.view === 'track' || launchFlags.flying,
    speed: settings.speed,
    radiusPx: radiusCss(),
    wait: settings.wait,
  });
  // A countdown on screen ticks on every whole second of the (simulated) clock.
  if (launchFlags.countdown && interval > 0 && settings.speed !== 0) {
    const ms = simTime().getTime();
    const toNextSecond = (1000 - (((ms % 1000) + 1000) % 1000)) / 1000 / Math.abs(settings.speed);
    interval = Math.min(interval, Math.max(0.02, toNextSecond + 0.01));
  }
  renderMode = describeCadence(interval);
  redrawEvery = interval;
  if (interval === 0) raf ||= requestAnimationFrame(frame);
  else timer = setTimeout(requestRedraw, interval * 1000);
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
  const launchesBefore = settings.launches;
  settings = { ...settings, ...patch };
  if (settings.launches !== launchesBefore) syncLaunches();
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
    clockStart = wallAt();
    update({ time: now, speed });
  },
  goLive() {
    clockStart = wallAt();
    update({ time: null, speed: 1 });
  },
  previewLaunch() {
    if (!settings.launches) update({ launches: true });
    const upcoming = launchStates(simTime())
      .filter((s) => s.phase === 'countdown')
      .sort((a, b) => a.t0 - b.t0);
    // Prefer one with a predicted orbit: that's the one with something to watch.
    const next = upcoming.find((s) => s.deployT !== undefined) ?? upcoming[0];
    if (!next) return null;
    clockStart = wallAt();
    update({ time: new Date(next.t0 - 60_000), speed: 10, view: 'track', track: 'launch' });
    return `${shortRocket(next.launch.rocket)} · ${next.launch.mission}`;
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
  .then(() => {
    clearOverlaySprites(); // labels drawn before the font arrived used the fallback face
    requestRedraw();
  })
  .catch(() => {});

syncClouds();
syncSatellites();
syncLaunches();
requestRedraw();
