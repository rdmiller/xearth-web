// App wiring: settings → clock → camera/sun → renderer + overlay, redrawn on a
// schedule (xearth's -wait), with hourly cloud maps faded in as they arrive
// and satellites propagated from CelesTrak elements.

import '@fontsource/chakra-petch/500.css';
import '@fontsource/chakra-petch/600.css';
import mono500 from '@fontsource/jetbrains-mono/files/jetbrains-mono-latin-500-normal.woff2?url';
import mono600 from '@fontsource/jetbrains-mono/files/jetbrains-mono-latin-600-normal.woff2?url';
import type { SatRec } from 'satellite.js';
import { subsolarPoint, sunDirection } from './astronomy';
import { framingViewpoint, MOON_RADIUS_KM, placeBody, skyBodies, type SkyBodies } from './bodies';
import { describeCadence, redrawInterval } from './cadence';
import { AOS_MAX_AGE_MS, IssLive, issFromTelemetry, issReadings } from './isslive';
import { FeedLog, type FeedState } from './feeds';
import { FeedBoard, type FeedRow } from './feedBoard';
import { PerfPanel } from './hudPanels';
import { IssPanelView } from './issView';
import { ToastManager } from './toasts';
import {
  BULK_LEAVES,
  bulkCatalog,
  bulkSummary,
  findNode,
  leafOn,
  rgb,
  shortName,
  toggleLabels,
  toggleNode,
  type BulkCatalog,
  type SatLeaf,
} from './satcategories';
import { SatTree } from './satTree';
import { Drawer } from './drawer';
import { addLabelled, decodeLabelled, formatCoordinates, glideAt, glideMs, isLabelled, LABELLED_KEY, removeLabelled, type Place } from './places';
import { PlaceCard, type PlaceReport } from './placeCard';
import {
  airQualityUrl,
  aqiAlert,
  decodeForecast,
  decodeNwsPointAlerts,
  forecastUrl,
  inNwsArea,
  nearbyHazards,
  nwsPointAlertsUrl,
  prefersImperial,
  type LocalAlert,
  type NearbySources,
} from './locale';
import { PlaceSearch } from './search';
import { decodeMeteors, fireballRows, isMeteorManifest, labelledFireballs, meteorSummary, showerColors, BANDS, type MeteorManifest } from './meteors';
import { chooseRange, DETAIL_BELOW_DEG_PER_PX, GibsDetail, NIGHT_LIGHTS, visibleBox, type Detail } from './gibs';
import { hhmm, LIVE_CHECK_MS, LIVE_MAX_SKEW_MS, LiveImagery, liveRange } from './liveImagery';
import { CELL_DEG, LI_WINDOW_MIN, LiWindow, mergeCells } from './mtgLightning';
import {
  decodeOutlook,
  decodeWarnings,
  densify,
  largestRing,
  NWS_WARNINGS_URL,
  outlookRows,
  outlookTop,
  ringCentre,
  severeSummary,
  SPC_DAY1_URL,
  WARNING_COLOR,
  WARNING_EVENTS,
  warningLabelled,
  warningRows,
  type Outlook,
  type Polygon,
  type SevereWarning,
} from './severe';
import { DRAP_URL, drapGrid, drapSummary, isTecManifest, parseDrap, tecGrid, tecSummary, type Drap, type TecManifest } from './ionosphere';
import {
  decodeNwsAlerts,
  isAlertCategory,
  isTsunamiManifest,
  NWS_TSUNAMI_URL,
  nwsColor,
  nwsRows,
  sampleZones,
  TSUNAMI_COLOR,
  tsunamiLabelled,
  tsunamiSummary,
  tsunamiRows,
  tsunamiShown,
  zoneCentroid,
  type NwsTsunamiAlert,
  type TsunamiManifest,
} from './tsunami';
import { apiHost, composeCoverage, composeRadar, COVERAGE_EVERY_MS, latestFrame, RAINVIEWER_API, radarZoom, type RadarFrame } from './radar';
import { IMERG_CHECK_MS, IMERG_COLORMAP, loadImerg, parseColormap, type ImergMap, type RateTable } from './imerg';
import { fetchSpaceWeather, spaceWeatherSummary, SUVI_LIMB, SUVI_URL, type SpaceWeather } from './spaceweather';
import {
  burnedRadiusKm,
  lightningPoints,
  EVENT_COLOR,
  eventDetail,
  eventSummary,
  eventSize,
  eventTitle,
  IMPACT_COLOR,
  impactLevel,
  isEventManifest,
  isLightningManifest,
  isSmokeManifest,
  isSnowIceManifest,
  labelledEvents,
  smokeSummary,
  decodeFires,
  fireMinIntensity,
  firesWithin,
  decodeOvation,
  decodeQuakes,
  isFireManifest,
  isOvation,
  isQuakeFeed,
  isStormManifest,
  labelledQuakes,
  OVATION_URL,
  quakeAge,
  quakeRadius,
  quakeStyle,
  stormClass,
  stormColor,
  stormDetail,
  stormTitle,
  USGS_QUAKES_URL,
  type AuroraGrid,
  type EventManifest,
  type FireManifest,
  type FirePoints,
  type LightningManifest,
  type Quake,
  type SmokeManifest,
  type SnowIceManifest,
  type StormManifest,
} from './hazards';
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
import { formatSpeed, helpRows, hotkeyByKey, MAG_MAX, MAG_MIN, matchHotkey, type HotkeyContext } from './hotkeys';
import {
  clearOverlaySprites,
  drawOverlay,
  PLACE_COLOR,
  UI_FONT,
  type BodyMarker,
  type EventOverlay,
  type MeteorOverlay,
  type SevereLabel,
  type SevereShape,
  type TsunamiOverlay,
  type ZoneOverlay,
  type LaunchOverlay,
  type QuakeOverlay,
  type ReadoutRow,
  type SatelliteOverlay,
  type SatLabelOverlay,
  type StormOverlay,
} from './overlay';
import { FrameStats, GpuTimer, SlowFrames } from './perf';
import { publishSeverity } from './tokens';
import { DATA_BASE, parseSettings, toQuery, type Settings } from './params';
import { GlobeRenderer } from './renderer/gl';
import type { WorkerRequest, WorkerResponse } from './satWorker';
import {
  EARTH_RADIUS_KM,
  FEATURED,
  inShadow,
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
import { dayTextureUrl, loadImage, nightTextureUrl, reliefUrl } from './textures';
import type { SurfaceRequest, SurfaceResponse } from './surfaceWorker';
import { cross, dot, fromLatLon, normalize, scale, sub, toLatLon, type Vec3 } from './vec';
import { cameraFor, ORTHO_SKY_FOCAL, pinchMag, skyFocal, unproject, viewerLatLon, type Camera, type TrackResolver } from './view';
import { Capacitor } from '@capacitor/core';
import type { BodyDraw } from './renderer/bodies';

// Chakra Petch has no tabular figures, so ticking numbers jitter sideways. "HUD Digits" is a
// monospace face limited to digits and numeric punctuation; it heads every UI font stack, so
// the browser takes those glyphs from it and everything else falls through to Chakra Petch.
const DIGITS = 'U+0030-0039, U+002B-002E, U+003A, U+00B0, U+2212'; // 0-9 + , - . : ° −
for (const [weight, url] of [['500', mono500], ['600', mono600]] as const) {
  document.fonts.add(new FontFace('HUD Digits', `url(${url}) format('woff2')`, { weight, unicodeRange: DIGITS }));
}

// Data-layer severity colours are defined in tokens.ts; CSS gets them as --sev-*.
publishSeverity(document.documentElement);

const BASE = import.meta.env.BASE_URL;
/** NASA textures are served with the data (they're ~40 MB, too big to bundle in an app). */
const TEXTURE_BASE = DATA_BASE || BASE;
const FADE_MS = 2500;
const TOAST_MS = 1400;

const globeCanvas = document.getElementById('globe') as HTMLCanvasElement;
const overlayCanvas = document.getElementById('overlay') as HTMLCanvasElement;
const help = document.getElementById('help') as HTMLElement;
const helpKeys = document.getElementById('help-keys') as HTMLElement;
const toastEl = document.getElementById('toast') as HTMLElement;

let settings: Settings = parseSettings(location.search);
let note: string | undefined;
/** Every polled source's checks, for the feeds dashboard (Shift+U). */
const feedLog = new FeedLog();

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

// Sun-lit terrain: the slope map ships with the app; the day texture is then the Blue
// Marble without NASA's own (fixed-light) shading. Either one missing — an older texture
// download, a failed fetch — falls back to the shaded day texture with no relief, so the
// ground is never shaded twice.
const RELIEF_EXAGGERATION = 30;
let reliefState: 'idle' | 'loading' | 'ready' | 'failed' = 'idle';
let plainDayMissing = false;
/** Whether the day texture on the GPU is the plain one. */
let dayIsPlain = false;

function ensureRelief() {
  if (!settings.relief || reliefState !== 'idle') return;
  reliefState = 'loading';
  fetch(reliefUrl(BASE))
    .then(async (r) => {
      if (!r.ok) throw new Error(`${r.status} ${r.url}`);
      // Data, not a picture: no colour management, or the slopes shift.
      renderer.setRelief(await createImageBitmap(await r.blob(), { colorSpaceConversion: 'none', premultiplyAlpha: 'none' }));
      reliefState = 'ready';
    })
    .catch((err) => {
      console.warn('relief:', err);
      reliefState = 'failed';
    })
    .finally(() => {
      dayUrl = ''; // pick the day texture again now that we know
      requestRedraw();
    });
}

/** The plain land + shaded water day texture, built in a worker (made on first use). */
let surfaceWorker: Worker | undefined;
let surfaceSeq = 0;
const surfaceJobs = new Map<number, { resolve: (b: ImageBitmap) => void; reject: (e: Error) => void }>();

function composeSurface(plainUrl: string, shadedUrl: string): Promise<ImageBitmap> {
  if (!surfaceWorker) {
    surfaceWorker = new Worker(new URL('./surfaceWorker.ts', import.meta.url), { type: 'module' });
    surfaceWorker.onmessage = (e: MessageEvent<SurfaceResponse>) => {
      const job = surfaceJobs.get(e.data.id);
      surfaceJobs.delete(e.data.id);
      if ('bitmap' in e.data) job?.resolve(e.data.bitmap);
      else job?.reject(new Error(e.data.error));
    };
  }
  const abs = (u: string) => new URL(u, location.href).href;
  const id = ++surfaceSeq;
  const request: SurfaceRequest = { id, plain: abs(plainUrl), shaded: abs(shadedUrl), relief: abs(reliefUrl(BASE)), maxSize: renderer.maxTextureSize };
  return new Promise((resolve, reject) => {
    surfaceJobs.set(id, { resolve, reject });
    surfaceWorker!.postMessage(request);
  });
}

/** Vertical exaggeration for the frame, or 0 while relief is off or can't be shown. */
function reliefStrength(): number {
  return settings.relief && reliefState === 'ready' && dayIsPlain ? RELIEF_EXAGGERATION * settings.reliefscale : 0;
}

async function ensureDayTexture(date: Date) {
  ensureRelief();
  const plain = settings.relief && reliefState === 'ready' && !plainDayMissing;
  const url = dayTextureUrl(TEXTURE_BASE, date, plain);
  if (url === dayUrl) return;
  dayUrl = url;
  try {
    if (plain) {
      // Plain land, NASA's shaded water (blendLand explains why).
      const bitmap = await composeSurface(url, dayTextureUrl(TEXTURE_BASE, date));
      if (dayUrl !== url) return void bitmap.close(); // the month or the setting moved on
      renderer.setDay(bitmap);
    } else {
      renderer.setDay(await loadImage(url, renderer.maxTextureSize));
    }
    dayIsPlain = plain;
    missing.delete('day');
  } catch (err) {
    if (plain) {
      console.warn('plain day texture missing, using the shaded one (run `pnpm textures`):', err);
      plainDayMissing = true;
      dayUrl = '';
      return ensureDayTexture(date);
    }
    console.warn('day texture:', err);
    missing.add('day');
  }
  updateNote();
  requestRedraw();
}

loadImage(nightTextureUrl(TEXTURE_BASE), renderer.maxTextureSize)
  .then((img) => renderer.setNight(img))
  .catch((err) => {
    console.warn('night texture:', err);
    missing.add('night');
  })
  .finally(() => {
    updateNote();
    requestRedraw();
  });

loadImage(`${TEXTURE_BASE}textures/moon.jpg`, renderer.maxTextureSize)
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
      feedLog.begin('clouds', Date.now());
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
    if (status.state === 'ok') feedLog.done('clouds', Date.now(), status.manifest.t);
    else if (status.state === 'error') feedLog.fail('clouds', Date.now(), status.message);
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
let catalog: BulkCatalog | undefined;
/** Labelable satellites per category: SGP4 records and short names, propagated on the main thread. */
const labelRecs = new Map<string, { rec: SatRec; name: string }[]>();
/** Which categories the GPU positions were propagated for. */
let activeKey = '';
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
  feedLog.begin('satellites', Date.now(), SAT_POLL_MS);
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
      catalog = bulkCatalog(m);
      renderer.setSatelliteCategories(catalog.category);
      labelRecs.clear();
      catalog.elements.forEach((el, i) => {
        const leaf = BULK_LEAVES[catalog!.category[i]];
        const name = catalog!.names.get(el[0]);
        const rec = leaf.labelable && name ? satrecFor(el) : null;
        if (rec && name) labelRecs.set(leaf.key, [...(labelRecs.get(leaf.key) ?? []), { rec, name: shortName(name) }]);
      });
      workerBusy = true;
      post({ type: 'load', elements: catalog.elements, category: catalog.category });
      satTree.refresh(settings, treeCounts());
    }
    feedLog.done('satellites', Date.now(), m.generated);
  } catch (err) {
    satError = err instanceof Error ? err.message : String(err);
    feedLog.fail('satellites', Date.now(), err);
    console.warn('satellites:', err);
  }
  requestRedraw();
}

function syncSatellites() {
  clearInterval(satTimer);
  satTimer = undefined;
  if (settings.sats === 'off') return feedLog.stop('satellites');
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
  feedLog.begin('launches', Date.now(), LAUNCH_POLL_MS);
  try {
    const url = new URL('latest.json', new URL(settings.launchsrc, location.href)).href;
    const r = await fetch(url, { cache: 'no-cache' });
    if (!r.ok) throw new Error(`${r.status} ${url}`);
    const m: unknown = await r.json();
    if (!isLaunchManifest(m)) throw new Error('launches/latest.json is not a launch manifest');
    launchManifest = m;
    feedLog.done('launches', Date.now(), m.generated);
  } catch (err) {
    feedLog.fail('launches', Date.now(), err);
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
  if (!settings.launches) return feedLog.stop('launches');
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
  const row: ReadoutRow | undefined = f && {
    key: 'launch',
    value: `${shortRocket(f.launch.rocket)} · ${f.launch.mission} · ${formatClock(f.t)} · ${
      f.phase === 'countdown' ? f.launch.status.name || f.launch.status.abbrev : PHASE_LABEL[f.phase].toLowerCase()
    }`,
  };
  return { overlays, row };
}

// ---- hazards: aurora, cyclones, fires, quakes, lightning, GDACS events, snow/ice -----
// Aurora and earthquakes come straight from NOAA SWPC and USGS (both CORS-enabled,
// small, updated every few minutes). The rest come from the pipeline: GDACS/NHC
// need merging, FIRMS is ~20 MB raw, GLM sits in buckets without CORS, and IMS
// needs reprojecting. Each polls only while shown.

let aurora: AuroraGrid | undefined;
let stormManifest: StormManifest | undefined;
let firePoints: FirePoints | undefined;
let fireManifest: FireManifest | undefined;
let quakes: Quake[] = [];
/** When USGS generated the feed now shown, ms. */
let quakesAt: number | undefined;
let lightningManifest: LightningManifest | undefined;
/** MTG Lightning Imager cells for the last 30 min, fetched by the browser (mtgLightning.ts). */
const liWindow = new LiWindow();
let liCells: number[] = [];
let eventManifest: EventManifest | undefined;
let snowIce: SnowIceManifest | undefined;
let smoke: SmokeManifest | undefined;
let tsunamiManifest: TsunamiManifest | undefined;
let nwsTsunami: NwsTsunamiAlert[] = [];
let severeWarnings: SevereWarning[] = [];
let spcOutlook: Outlook | null = null;
/** When the SPC outlook was last fetched: it changes a few times a day, so every 15 minutes is plenty. */
let spcCheckedAt = 0;
const SPC_EVERY_MS = 15 * 60_000;
/** NWS zone URL → centroid [lon, lat] (null: no geometry). Zones don't move, so this is kept. */
const zoneCentroids = new Map<string, [number, number] | null>();
/** NWS alerts already announced with a toast. */
const announced = new Set<string>();
let radarFrame: RadarFrame | undefined;
let radarZoomShown = 0;
/** Where RainViewer has radars (refetched daily), and NASA IMERG for everywhere it hasn't. */
let coverageAt = 0;
let imerg: ImergMap | undefined;
let imergCheckedAt = 0;
let imergTable: RateTable | undefined;
const radarCredit = document.getElementById('radar-credit') as HTMLElement;
const credits = document.getElementById('credits') as HTMLElement;
// The footer's "All credits" opens the help panel, where the full list is (H does the same).
credits.querySelector('button')?.addEventListener('click', () => {
  help.hidden = !help.hidden;
});

/** Screen boxes of visible DOM text over the globe, for canvas labels to keep clear of. */
function domRects(...els: HTMLElement[]): { x: number; y: number; w: number; h: number }[] {
  return els.flatMap((el) => {
    if (el.hidden) return [];
    const r = el.getBoundingClientRect();
    return r.width ? [{ x: r.left, y: r.top, w: r.width, h: r.height }] : [];
  });
}
let spaceWeather: SpaceWeather | undefined;

// The SUVI Sun image (~1 MB) is fetched only while the Sun is actually in frame.
const SUN_IMAGE_EVERY_MS = 15 * 60_000;
let sunImageAt = 0;
let sunImageTime: string | undefined;
let sunImageLoading = false;

async function loadSunImage() {
  if (sunImageLoading || Date.now() - sunImageAt < SUN_IMAGE_EVERY_MS) return;
  sunImageLoading = true;
  feedLog.begin('sun', Date.now(), SUN_IMAGE_EVERY_MS);
  try {
    const r = await fetch(SUVI_URL, { cache: 'no-cache' });
    if (!r.ok) throw new Error(`${r.status} ${SUVI_URL}`);
    const modified = r.headers.get('last-modified');
    renderer.setSun(await createImageBitmap(await r.blob()), SUVI_LIMB);
    sunImageTime = modified ? new Date(modified).toISOString().slice(11, 16) : undefined;
    sunImageAt = Date.now();
    feedLog.done('sun', sunImageAt, modified);
    requestRedraw();
  } catch (err) {
    console.warn('sun image:', err);
    sunImageAt = Date.now() - SUN_IMAGE_EVERY_MS + 60_000; // retry in a minute
    feedLog.fail('sun', Date.now(), err);
    feedLog.next('sun', sunImageAt + SUN_IMAGE_EVERY_MS);
  } finally {
    sunImageLoading = false;
  }
}

async function fetchJson(url: string): Promise<unknown> {
  const r = await fetch(url, { cache: 'no-cache' });
  if (!r.ok) throw new Error(`${r.status} ${url}`);
  return r.json();
}

const pipelineFile = (src: string) => new URL('latest.json', new URL(src, location.href)).href;

/** GOES and MTG lightning cells together (the pipeline's GOES cells are also 0.1°). */
function lightningData(): number[] {
  return mergeCells(lightningManifest?.data ?? [], liCells);
}

/** Both instruments' cells as one manifest, for the place card. */
function lightningLayer(): LightningManifest | undefined {
  if (!lightningManifest && !liCells.length) return undefined;
  const base = lightningManifest ?? { generated: liWindow.latest ?? '', source: '', satellites: [], latest: liWindow.latest ?? null, flashes: 0 };
  const data = lightningData();
  return { ...base, windowMin: LI_WINDOW_MIN, cellDeg: CELL_DEG, count: data.length / 4, data };
}

type HazardKey = 'aurora' | 'storms' | 'fires' | 'quakes' | 'lightning' | 'events' | 'snow' | 'radar' | 'smoke' | 'tsunami' | 'severe' | 'meteors';

/** `dataAt`: when the data now held was published, for the feeds dashboard. */
let meteorManifest: MeteorManifest | undefined;
/** Streaks on the globe, built once per load (their colours and bands don't change with the view). */
let meteorCache: MeteorOverlay | undefined;
function meteorOverlay(): MeteorOverlay | undefined {
  if (!settings.meteors || !meteorManifest) return undefined;
  if (!meteorCache) {
    const m = meteorManifest;
    const labelled = new Set(labelledFireballs(m.fireballs, Date.now()));
    meteorCache = {
      streaks: decodeMeteors(m),
      colors: showerColors(m).colors,
      bands: BANDS,
      fireballs: m.fireballs.map((f) => ({ pos: fromLatLon(f.lat, f.lon), rows: labelled.has(f) ? fireballRows(f) : undefined })),
    };
  }
  return meteorCache;
}

const HAZARDS: Record<HazardKey, { everyMs: number; load: () => Promise<void>; dataAt: () => string | number | undefined }> = {
  aurora: {
    everyMs: 10 * 60_000,
    load: async () => {
      const o = await fetchJson(OVATION_URL);
      if (!isOvation(o)) throw new Error('not an OVATION aurora forecast');
      aurora = decodeOvation(o);
      renderer.setAurora(aurora);
      // Space weather drives the aurora, so it refreshes with it.
      spaceWeather = await fetchSpaceWeather(fetchJson);
    },
    dataAt: () => aurora?.observed,
  },
  storms: {
    everyMs: 15 * 60_000,
    load: async () => {
      const m = await fetchJson(pipelineFile(settings.stormsrc));
      if (!isStormManifest(m)) throw new Error('storms/latest.json is not a storm manifest');
      stormManifest = m;
      stormCache = undefined;
    },
    dataAt: () => stormManifest?.generated,
  },
  fires: {
    everyMs: 30 * 60_000,
    load: async () => {
      const m = await fetchJson(pipelineFile(settings.firesrc));
      if (!isFireManifest(m)) throw new Error('fires/latest.json is not a fire manifest');
      fireManifest = m;
      firePoints = decodeFires(m);
      renderer.setFires(firePoints);
    },
    dataAt: () => fireManifest?.generated,
  },
  quakes: {
    everyMs: 5 * 60_000,
    load: async () => {
      const f = await fetchJson(USGS_QUAKES_URL);
      if (!isQuakeFeed(f)) throw new Error('not a USGS earthquake feed');
      quakes = decodeQuakes(f);
      quakesAt = (f as { metadata?: { generated?: number } }).metadata?.generated;
    },
    dataAt: () => quakesAt,
  },
  // GOES from the pipeline (NOAA's buckets have no CORS); MTG from EUMETSAT, which has, every
  // 5 minutes as its frames land. Either one alone still draws.
  lightning: {
    everyMs: 5 * 60_000,
    load: async () => {
      const [glm, li] = await Promise.allSettled([
        fetchJson(pipelineFile(settings.lightningsrc)).then((m) => {
          if (!isLightningManifest(m)) throw new Error('lightning/latest.json is not a lightning manifest');
          return m;
        }),
        liWindow.load(),
      ]);
      if (glm.status === 'fulfilled') lightningManifest = glm.value;
      if (li.status === 'fulfilled') liCells = li.value;
      if (glm.status === 'rejected' && li.status === 'rejected') throw glm.reason;
      if (glm.status === 'rejected') console.warn('lightning (GOES):', glm.reason);
      if (li.status === 'rejected') console.warn('lightning (MTG):', li.reason);
      renderer.setLightning(lightningPoints(lightningData(), CELL_DEG));
    },
    // The newest flash in either window. GOES's trails the pipeline's run by its processing time.
    dataAt: () => {
      const t = [lightningManifest?.latest ?? lightningManifest?.generated, liWindow.latest].map((v) => (v ? Date.parse(v) : NaN));
      const newest = Math.max(...t.filter(Number.isFinite));
      return Number.isFinite(newest) ? newest : undefined;
    },
  },
  events: {
    everyMs: 30 * 60_000,
    load: async () => {
      const m = await fetchJson(pipelineFile(settings.eventsrc));
      if (!isEventManifest(m)) throw new Error('events/latest.json is not a GDACS event manifest');
      eventManifest = m;
      eventCache = undefined;
    },
    dataAt: () => eventManifest?.generated,
  },
  snow: {
    everyMs: 60 * 60_000,
    load: async () => {
      const url = pipelineFile(settings.snowsrc);
      const m = await fetchJson(url);
      if (!isSnowIceManifest(m)) throw new Error('snowice/latest.json is not a snow-and-ice manifest');
      if (snowIce?.generated === m.generated) return;
      const r = await fetch(new URL(m.image, url).href, { cache: 'no-cache' });
      if (!r.ok) throw new Error(`${r.status} ${m.image}`);
      // A data image: no colour management, or the ice concentrations shift.
      renderer.setSnowIce(await createImageBitmap(await r.blob(), { colorSpaceConversion: 'none', premultiplyAlpha: 'none' }));
      snowIce = m;
    },
    dataAt: () => snowIce?.generated,
  },
  smoke: {
    everyMs: 30 * 60_000,
    load: async () => {
      const url = pipelineFile(settings.smokesrc);
      const m = await fetchJson(url);
      if (!isSmokeManifest(m)) throw new Error('smoke/latest.json is not an HMS smoke manifest');
      if (smoke?.generated === m.generated) return;
      const r = await fetch(new URL(m.image, url).href, { cache: 'no-cache' });
      if (!r.ok) throw new Error(`${r.status} ${m.image}`);
      renderer.setSmoke(await createImageBitmap(await r.blob(), { colorSpaceConversion: 'none', premultiplyAlpha: 'none' }));
      smoke = m;
    },
    dataAt: () => smoke?.generated,
  },
  // Live US alerts from NWS every 2 min (CORS-enabled); the centers' bulletins from the
  // pipeline alongside. During an alert, a sample of its coastal zones is fetched once each.
  tsunami: {
    everyMs: 2 * 60_000,
    load: async () => {
      const [m, nws] = await Promise.allSettled([fetchJson(pipelineFile(settings.tsunamisrc)), fetchJson(NWS_TSUNAMI_URL)]);
      if (m.status === 'fulfilled' && isTsunamiManifest(m.value)) tsunamiManifest = m.value;
      if (nws.status === 'rejected') throw nws.reason;
      nwsTsunami = decodeNwsAlerts(nws.value);
      const missing = [...new Set(nwsTsunami.flatMap((a) => sampleZones(a.zones)))].filter((z) => !zoneCentroids.has(z));
      await Promise.allSettled(
        missing.map(async (z) => zoneCentroids.set(z, zoneCentroid(((await fetchJson(z)) as { geometry?: unknown }).geometry))),
      );
      for (const a of nwsTsunami) {
        if (announced.has(a.id)) continue;
        announced.add(a.id);
        toast(`${a.event} in effect — ${a.areaDesc.split(';')[0]}`);
      }
      tsunamiCache = undefined;
    },
    dataAt: () => tsunamiManifest?.generated,
  },
  // GMN's daily trajectories and CNEOS's fireballs, via the pipeline (hourly; GMN's files
  // change a few times a day).
  meteors: {
    everyMs: 30 * 60_000,
    load: async () => {
      const m = await fetchJson(pipelineFile(settings.meteorsrc));
      if (!isMeteorManifest(m)) throw new Error('meteors/latest.json is not a meteor manifest');
      if (m.to !== meteorManifest?.to || m.fireballs.length !== meteorManifest?.fireballs.length) meteorCache = undefined;
      meteorManifest = m;
    },
    // The newest meteor, which trails the cameras by GMN's processing (hours).
    dataAt: () => meteorManifest?.to ?? meteorManifest?.generated,
  },
  // NWS storm-based warnings every 2 minutes (a tornado warning lasts ~30–45), SPC's outlook
  // every 15. Both CORS-enabled. A new tornado or extreme wind warning raises a toast.
  severe: {
    everyMs: 2 * 60_000,
    load: async () => {
      const wantSpc = Date.now() - spcCheckedAt >= SPC_EVERY_MS;
      const [nws, spc] = await Promise.allSettled([fetchJson(NWS_WARNINGS_URL), wantSpc ? fetchJson(SPC_DAY1_URL) : Promise.resolve(undefined)]);
      if (spc.status === 'fulfilled' && spc.value !== undefined) {
        spcOutlook = decodeOutlook(spc.value);
        spcCheckedAt = Date.now();
      } else if (spc.status === 'rejected') console.warn('SPC outlook:', spc.reason);
      if (nws.status === 'rejected') throw nws.reason;
      severeWarnings = decodeWarnings(nws.value);
      const fresh = severeWarnings.filter((w) => (w.event === 'Tornado Warning' || w.event === 'Extreme Wind Warning') && !announced.has(w.id));
      for (const w of fresh) announced.add(w.id);
      if (fresh.length > 3) toast(`${fresh.length} new tornado and extreme wind warnings`);
      else for (const w of fresh) toast(`${w.event} — ${w.areaDesc.split(';')[0]}`);
      severeCache = undefined;
    },
    dataAt: () => {
      const t = [...severeWarnings.map((w) => Date.parse(w.sent)), spcOutlook ? Date.parse(spcOutlook.issued) : NaN].filter(Number.isFinite);
      return t.length ? Math.max(...t) : undefined;
    },
  },
  // RainViewer publishes a frame every 10 min. Its tiles are fetched only for a new
  // frame (or a finer zoom), never while the tab is hidden: the free API asks for caching.
  radar: {
    everyMs: 5 * 60_000,
    load: async () => {
      if (document.hidden) return;
      const maps = await fetchJson(RAINVIEWER_API);
      void loadRainFill(maps);
      const frame = latestFrame(maps);
      if (!frame) throw new Error('RainViewer lists no radar frames');
      const zoom = radarZoom(settings.mag);
      if (frame.time === radarFrame?.time && zoom === radarZoomShown) return;
      const { canvas, failed } = await composeRadar(frame, zoom, async (u) => {
        const r = await fetch(u);
        if (!r.ok) throw new Error(`${r.status} ${u}`);
        return r.blob();
      });
      if (failed === 4 ** zoom) throw new Error('every radar tile failed');
      if (failed) console.warn(`radar: ${failed} of ${4 ** zoom} tiles failed`);
      renderer.setRadar(canvas);
      radarFrame = frame;
      radarZoomShown = zoom;
    },
    dataAt: () => radarFrame && radarFrame.time * 1000,
  },
};

/**
 * Satellite rain where there's no radar: RainViewer's coverage once a day, IMERG every 15
 * minutes. Each on its own, so neither failing holds up the radar. IMERG has its own card.
 */
async function loadRainFill(maps: unknown) {
  const host = apiHost(maps);
  if (host && Date.now() - coverageAt >= COVERAGE_EVERY_MS) {
    try {
      renderer.setRadarCoverage(
        await composeCoverage(host, async (u) => {
          const r = await fetch(u);
          if (!r.ok) throw new Error(`${r.status} ${u}`);
          return r.blob();
        }),
      );
      coverageAt = Date.now();
    } catch (err) {
      console.warn('radar coverage:', err);
    }
  }
  if (!settings.imerg || Date.now() - imergCheckedAt < IMERG_CHECK_MS) return;
  imergCheckedAt = Date.now();
  feedLog.begin('imerg', imergCheckedAt, IMERG_CHECK_MS);
  try {
    if (!imergTable) {
      const r = await fetch(IMERG_COLORMAP);
      if (!r.ok) throw new Error(`${r.status} GIBS colour map`);
      imergTable = parseColormap(await r.text());
    }
    const m = await loadImerg(imergTable);
    if (m.time !== imerg?.time) renderer.setImerg(m.image);
    imerg = m;
    feedLog.done('imerg', Date.now(), m.time);
  } catch (err) {
    feedLog.fail('imerg', Date.now(), err);
    console.warn('IMERG:', err);
  }
  requestRedraw();
}

// ---- ionosphere (NOAA SWPC) --------------------------------------------------------------
// One wash at a time, so only its source is fetched: GloTEC from the pipeline (each map is
// 2.5 MB at SWPC), D-RAP straight from SWPC (CORS-enabled, 2.8 KB gzipped). See ionosphere.ts.

let tecManifest: TecManifest | undefined;
let drap: Drap | undefined;
const IONO: Record<'tec' | 'drap', { everyMs: number; load: () => Promise<void>; dataAt: () => string | null | undefined }> = {
  tec: {
    // The pipeline refreshes it hourly; GloTEC itself every 10 minutes.
    everyMs: 15 * 60_000,
    load: async () => {
      const m = await fetchJson(pipelineFile(settings.ionosrc));
      if (!isTecManifest(m)) throw new Error('ionosphere/latest.json is not a GloTEC grid');
      if (m.time !== tecManifest?.time) renderer.setIonosphere(tecGrid(m), null);
      tecManifest = m;
    },
    dataAt: () => tecManifest?.time,
  },
  drap: {
    everyMs: 10 * 60_000,
    load: async () => {
      const r = await fetch(DRAP_URL, { cache: 'no-cache' });
      if (!r.ok) throw new Error(`${r.status} ${DRAP_URL}`);
      const d = parseDrap(await r.text());
      if (!d) throw new Error('the D-RAP table could not be read');
      renderer.setIonosphere(null, drapGrid(d));
      drap = d;
    },
    dataAt: () => drap?.valid,
  },
};
let ionoTimer: ReturnType<typeof setInterval> | undefined;

function runIono(mode: 'tec' | 'drap'): Promise<void> {
  feedLog.begin(mode, Date.now(), IONO[mode].everyMs);
  return IONO[mode]
    .load()
    .then(() => feedLog.done(mode, Date.now(), IONO[mode].dataAt()))
    .catch((err) => {
      feedLog.fail(mode, Date.now(), err);
      console.warn(`ionosphere (${mode}):`, err);
    })
    .finally(requestRedraw);
}

function syncIono() {
  clearInterval(ionoTimer);
  ionoTimer = undefined;
  feedLog.stop('tec');
  feedLog.stop('drap');
  const mode = settings.iono;
  if (mode === 'off') return;
  void runIono(mode);
  ionoTimer = setInterval(() => void runIono(mode), IONO[mode].everyMs);
}

const hazardTimers: Partial<Record<HazardKey, ReturnType<typeof setInterval>>> = {};

/** Load a layer once. `everyMs`: this is its scheduled check, and the next is due that long after. */
function runHazard(key: HazardKey, everyMs?: number): Promise<void> {
  feedLog.begin(key, Date.now(), everyMs);
  return HAZARDS[key]
    .load()
    .then(() => feedLog.done(key, Date.now(), HAZARDS[key].dataAt()))
    .catch((err) => {
      feedLog.fail(key, Date.now(), err);
      console.warn(`${key}:`, err);
    })
    .finally(requestRedraw);
}

function syncHazard(key: HazardKey) {
  clearInterval(hazardTimers[key]);
  delete hazardTimers[key];
  if (!settings[key]) return feedLog.stop(key);
  const { everyMs } = HAZARDS[key];
  void runHazard(key, everyMs);
  hazardTimers[key] = setInterval(() => void runHazard(key, everyMs), everyMs);
}

/** Storm drawing is fixed per manifest, so it's built once per load. */
let stormCache: StormOverlay[] | undefined;
function stormOverlays(): StormOverlay[] {
  if (!settings.storms || !stormManifest) return [];
  stormCache ??= stormManifest.storms.map((st) => ({
    title: stormTitle(st),
    detail: stormDetail(st),
    impact: impactLevel(st.alert),
    impactColor: IMPACT_COLOR[impactLevel(st.alert)],
    color: stormColor(stormClass(st)),
    pos: fromLatLon(st.pos[1], st.pos[0]),
    southern: st.pos[1] < 0,
    segments: st.segments.map(([lon1, lat1, lon2, lat2, cls, forecast]) => ({
      a: fromLatLon(lat1, lon1),
      b: fromLatLon(lat2, lon2),
      color: stormColor(cls),
      forecast: !!forecast,
    })),
  }));
  return stormCache;
}

/** Earthquake ages are against the real clock: the feed is live, not simulated. */
function quakeOverlays(): QuakeOverlay[] {
  if (!settings.quakes) return [];
  const now = Date.now();
  const labelled = new Set(labelledQuakes(quakes).map((q) => q.id));
  return quakes.map((q) => {
    const age = now - q.time;
    const style = quakeStyle(age);
    return {
      pos: fromLatLon(q.lat, q.lon),
      radius: quakeRadius(q.mag),
      color: style.color,
      alpha: style.alpha,
      fresh: age < 3_600_000,
      rows: labelled.has(q.id)
        ? [
            `M${q.mag.toFixed(1)} · ${quakeAge(age)}`,
            `${Math.round(q.depthKm)} KM DEEP${q.tsunami ? ' · TSUNAMI FLAG' : ''}`,
            q.place.toUpperCase().slice(0, 40),
          ]
        : undefined,
    };
  });
}

/** GDACS markers are fixed per manifest, apart from eruption ages (days), so built once per load. */
let eventCache: EventOverlay[] | undefined;
function eventOverlays(): EventOverlay[] {
  if (!settings.events || !eventManifest) return [];
  if (!eventCache) {
    const now = Date.now();
    const labelled = new Set(labelledEvents(eventManifest.events).map((e) => e.id));
    eventCache = eventManifest.events.map((e) => ({
      kind: e.type,
      pos: fromLatLon(e.pos[1], e.pos[0]),
      color: EVENT_COLOR[e.type],
      size: eventSize(e.alert),
      areaRadiusKm: e.areaHa ? burnedRadiusKm(e.areaHa) : undefined,
      rows: labelled.has(e.id)
        ? { title: eventTitle(e), detail: eventDetail(e, now), impact: impactLevel(e.alert), impactColor: IMPACT_COLOR[impactLevel(e.alert)] }
        : undefined,
    }));
  }
  return eventCache;
}

/** Tsunami markers change only with their data (and statements' label windows), so built per load. */
/** Polygons on the globe, built once per load: SPC's areas under NWS's warnings, the worst on top. */
let severeCache: { shapes: SevereShape[]; labels: SevereLabel[] } | undefined;
function severeOverlays(): { shapes: SevereShape[]; labels: SevereLabel[] } {
  if (!settings.severe) return { shapes: [], labels: [] };
  if (severeCache) return severeCache;
  const toGlobe = (polygons: Polygon[]) => polygons.map((p) => p.map((ring) => densify(ring).map(([lon, lat]) => fromLatLon(lat, lon))));
  const shapes: SevereShape[] = [];
  const labels: SevereLabel[] = [];
  for (const a of spcOutlook?.areas ?? []) {
    // General thunder covers half the country most days: a faint dashed edge, no fill.
    const tstm = a.level === 'TSTM';
    shapes.push({ polygons: toGlobe(a.polygons), stroke: a.stroke, fill: tstm ? undefined : a.fill, fillAlpha: 0.22, lineWidth: tstm ? 1 : 1.4, dashed: tstm });
  }
  const top = outlookTop(spcOutlook);
  const topRing = top && largestRing(top.polygons);
  if (spcOutlook && top && topRing) {
    const [lon, lat] = ringCentre(topRing);
    labels.push({ anchor: fromLatLon(lat, lon), color: top.stroke, rows: outlookRows(spcOutlook, top), optional: true });
  }
  const order = (w: SevereWarning) => WARNING_EVENTS.indexOf(w.event);
  for (const w of [...severeWarnings].sort((a, b) => order(a) - order(b))) {
    const color = WARNING_COLOR[w.event];
    shapes.push({ polygons: toGlobe(w.polygons), stroke: color, fill: color, fillAlpha: 0.28, lineWidth: w.event === 'Tornado Warning' ? 2 : 1.5 });
    const ring = largestRing(w.polygons);
    if (ring && warningLabelled(w)) {
      const [lon, lat] = ringCentre(ring);
      labels.push({ anchor: fromLatLon(lat, lon), color, rows: warningRows(w) });
    }
  }
  severeCache = { shapes, labels };
  return severeCache;
}

let tsunamiCache: { bulletins: TsunamiOverlay[]; zones: ZoneOverlay[]; at: number } | undefined;
function tsunamiOverlays(): { bulletins: TsunamiOverlay[]; zones: ZoneOverlay[] } {
  if (!settings.tsunami) return { bulletins: [], zones: [] };
  const now = Date.now();
  if (tsunamiCache && now - tsunamiCache.at < 60_000) return tsunamiCache;
  const bulletins = (tsunamiManifest?.bulletins ?? [])
    .filter((b) => tsunamiShown(b, now))
    .map((b) => ({
      pos: fromLatLon(b.lat, b.lon),
      color: TSUNAMI_COLOR[b.category] ?? TSUNAMI_COLOR.information,
      alert: isAlertCategory(b.category),
      rows: tsunamiLabelled(b, now) ? tsunamiRows(b, now) : undefined,
    }));
  const zones = nwsTsunami.flatMap((a) => {
    const points = sampleZones(a.zones)
      .map((z) => zoneCentroids.get(z))
      .filter((c): c is [number, number] => !!c)
      .map(([lon, lat]) => fromLatLon(lat, lon));
    if (!points.length) return [];
    const mid = normalize(points.reduce((s, p) => [s[0] + p[0], s[1] + p[1], s[2] + p[2]], [0, 0, 0]));
    const anchor = points.reduce((best, p) => (dot(p, mid) > dot(best, mid) ? p : best));
    return [{ points, anchor, color: nwsColor(a.event), rows: nwsRows(a) }];
  });
  tsunamiCache = { bulletins, zones, at: now };
  return tsunamiCache;
}

// ---- ISS live telemetry -----------------------------------------------------------------
// NASA's ISSLive stream. Updates arrive for ~20 items a second while the ISS has signal,
// so they ask for a redraw at most once a second. In the default "track" mode the stream
// is only opened while the ISS is being tracked.

let issRedrawPending = false;
const issLive = new IssLive(() => {
  if (issRedrawPending) return;
  issRedrawPending = true;
  setTimeout(() => {
    issRedrawPending = false;
    requestRedraw();
  }, 1000);
});

const trackingIss = () => settings.view === 'track' && settings.track === 'iss';
const issLiveWanted = () => settings.sats !== 'off' && (settings.isslive === 'on' || (settings.isslive === 'track' && trackingIss()));

function syncIssLive() {
  if (issLiveWanted()) issLive.start().catch((err) => console.warn('ISS live telemetry:', err));
  else issLive.stop();
}

/** The ISS from telemetry, when it's current for `date` (so never in simulated time). */
function issLiveState(date: Date, sun: Vec3) {
  if (!issLiveWanted()) return undefined;
  const t = issFromTelemetry(issLive.values, date);
  return t && { pos: t.pos, lat: t.lat, lon: t.lon, altKm: t.altKm, speed: t.speed, sunlit: !inShadow(t.pos, sun) };
}

function issPanelState(sun: Vec3) {
  if (!issLiveWanted()) return undefined;
  const now = new Date();
  const live = issLiveState(now, sun);
  const rec = featuredRecs.get('iss')?.rec;
  const sgp = live && rec ? positionAt(rec, now) : null;
  const deltaKm = live && sgp ? Math.hypot(live.pos[0] - sgp[0], live.pos[1] - sgp[1], live.pos[2] - sgp[2]) * EARTH_RADIUS_KM : undefined;
  return issReadings(issLive.values, now.getTime(), live && { altKm: live.altKm, speed: live.speed, deltaKm });
}

// ---- true-colour detail (NASA GIBS) --------------------------------------------------------
// Only when zoomed in past the Blue Marble's resolution, only for what's on screen, and only
// once the view settles; see gibs.ts.

// The zoomed-in picture is one texture, shared by both modes: each writes it only while its
// mode is the one chosen.
let detail: Detail | null = null;
const gibs = new GibsDetail((d) => {
  detail = d;
  if (settings.imagery !== 'daily') return;
  if (d) renderer.setDetail(d.image, d.bounds);
  else renderer.clearDetail();
  requestRedraw();
});

// ---- live imagery (GOES, MTG) ---------------------------------------------------------------
// Each satellite's disc, checked for a new scan every 5 minutes, and the view's own picture
// when zoomed in; see liveImagery.ts.

let liveDetail = false;
const live = new LiveImagery(
  (i, img) => {
    renderer.setLive(i, img.image, img.box, img.source.subLon, sunDirection(new Date(img.time)));
    requestRedraw();
  },
  (img) => {
    liveDetail = !!img;
    if (settings.imagery !== 'live') return;
    if (img) renderer.setDetail(img.image, img.box, { subLon: img.source.subLon, scanSun: sunDirection(new Date(img.time)) });
    else renderer.clearDetail();
    requestRedraw();
  },
);

/** Live pictures show the real now: a simulated time far from it gets the painted globe. */
const liveShown = (date: Date) => settings.imagery === 'live' && Math.abs(date.getTime() - Date.now()) < LIVE_MAX_SKEW_MS;

let liveTimer: ReturnType<typeof setInterval> | undefined;

function runLive(): Promise<void> {
  feedLog.begin('imagery', Date.now(), LIVE_CHECK_MS);
  return live
    .check()
    .then(() => {
      // The oldest disc on the globe: how far behind the mosaic is at worst.
      const t = [...live.discs.values()].map((d) => Date.parse(d.time));
      feedLog.done('imagery', Date.now(), t.length ? Math.min(...t) : undefined);
    })
    .catch((err) => {
      feedLog.fail('imagery', Date.now(), err);
      console.warn('live imagery:', err);
    })
    .finally(requestRedraw);
}

function syncLive() {
  clearInterval(liveTimer);
  liveTimer = undefined;
  if (settings.imagery !== 'live') return feedLog.stop('imagery');
  void runLive();
  liveTimer = setInterval(() => void runLive(), LIVE_CHECK_MS);
}

/** The newest night's lights (Black Marble nightly), the night side's counterpart, with either real-imagery mode. */
let nightDetail: Detail | null = null;
const gibsNight = new GibsDetail((d) => {
  nightDetail = d;
  if (d) renderer.setNightDetail(d.image, d.bounds);
  else renderer.clearNightDetail();
  requestRedraw();
}, NIGHT_LIGHTS);

/** Ask for the pictures this view needs (or none), given device px per Earth radius. */
function syncDetail(date: Date, radiusPx: number) {
  const degPerPx = 180 / Math.PI / Math.max(radiusPx, 1);
  // Everything on screen lies within this angle of the centre (the screen's half-diagonal).
  const r = Math.hypot(globeCanvas.width, globeCanvas.height) / 2 / Math.max(radiusPx, 1);
  const radiusDeg = r >= 1 ? 90 : (Math.asin(r) * 180) / Math.PI;
  const at = viewerLatLon(settings, date, resolveTrack);
  const box = visibleBox(at.lat, at.lon, radiusDeg);
  // Only the side that's on screen: the Sun's angle from the view's centre, give or take what's
  // visible, against the day (up to 96°: civil twilight's end) and the night (from 90°).
  const sun = subsolarPoint(date);
  const fromSun = (Math.acos(Math.max(-1, Math.min(1, dot(fromLatLon(at.lat, at.lon), fromLatLon(sun.lat, sun.lon))))) * 180) / Math.PI;
  const day = fromSun - radiusDeg < 96;
  const night = fromSun + radiusDeg > 90;
  gibs.want(settings.imagery === 'daily' && day ? chooseRange(box, degPerPx) : null, new Date());
  gibsNight.want(settings.imagery !== 'painted' && night ? chooseRange(box, degPerPx, NIGHT_LIGHTS.maxLevel) : null, new Date());
  if (liveShown(date)) {
    live.needDiscSize(radiusPx);
    // Its pictures are day-side only, so an all-night view asks for none.
    live.want(day ? liveRange(box, degPerPx, DETAIL_BELOW_DEG_PER_PX) : null, at);
  } else live.clear();
}

/** "106.6k", "940": counts in the readout. */
const compact = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n));

/**
 * The readout's rows for the data layers on: what each shows, one row apiece. When it was
 * fetched, and from where, is the feeds window's job (and the credits line's).
 */
function layerRows(): ReadoutRow[] {
  const rows: ReadoutRow[] = [];
  const add = (key: string, value: string | undefined) => value && rows.push({ key, value });
  const perPx = (level: number) => {
    const km = (0.5625 / 2 ** level) * 111.32;
    return `${km < 1 ? `${Math.round(km * 1000)} m` : `${km.toFixed(1)} km`}/px`;
  };
  if (settings.imagery === 'daily' && detail) {
    const day = new Date(`${detail.date}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
    add('imagery', `${day} · ${perPx(detail.level)}`);
  }
  if (settings.imagery === 'live' && live.discs.size) {
    const times = [...live.discs.values()].map((d) => d.time).sort();
    const span = times[0] === times[times.length - 1] ? hhmm(times[0]) : `${hhmm(times[0])}–${hhmm(times[times.length - 1])}`;
    add('imagery', `live ${span} UTC${live.detail && liveDetail ? ` · ${live.detail.source.name} ${perPx(live.detail.level)}` : ''}`);
  }
  if (settings.imagery !== 'painted' && nightDetail) {
    const night = new Date(`${nightDetail.date}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
    add('lights', `${night} · ${perPx(nightDetail.level)}`);
  }
  if (settings.radar && settings.imerg && imerg) {
    add('rain', `radar now · satellite ${imerg.time.slice(11, 16)} UTC where no radar`);
  }
  if (settings.smoke && smoke) add('smoke', smokeSummary(smoke));
  if (settings.aurora && aurora) add('aurora', `peak ${aurora.peak} %`);
  if (settings.iono === 'tec' && tecManifest) add('ionosphere', tecSummary(tecManifest));
  if (settings.iono === 'drap' && drap) add('ionosphere', drapSummary(drap));
  // Space weather comes with the aurora (the same NOAA SWPC fetch), so it sits beside it.
  if (settings.aurora && spaceWeather) add('space wx', spaceWeatherSummary(spaceWeather));
  if (settings.storms && stormManifest) add('cyclones', String(stormManifest.storms.length));
  if (settings.fires && firePoints) add('fires', `${compact(firesWithin(firePoints, settings.firehours).detections)} in ${settings.firehours} h`);
  if (settings.quakes && quakes.length) add('quakes', `${quakes.length} M2.5+ in 24 h`);
  if (settings.lightning && (lightningManifest || liCells.length)) {
    // GOES counts flashes; MTG's frames give flashes per pixel, so it counts the 0.1° cells lit.
    const goes = lightningManifest ? `GOES ${compact(lightningManifest.flashes)} flashes` : undefined;
    const mtg = liCells.length ? `MTG ${compact(liCells.length / 4)} cells lit` : undefined;
    add('lightning', [goes, mtg, `${LI_WINDOW_MIN} min`].filter(Boolean).join(' · '));
  }
  if (settings.events && eventManifest) add('GDACS', eventSummary(eventManifest));
  if (settings.tsunami) add('tsunami', tsunamiSummary(tsunamiManifest, nwsTsunami, Date.now()));
  if (settings.meteors && meteorManifest) add('meteors', meteorSummary(meteorManifest));
  if (settings.severe && feedLog.get('severe').checkedAt !== undefined) add('severe', severeSummary(severeWarnings, spcOutlook));
  return rows;
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
  if (key === 'iss') {
    const live = issLiveState(date, sunDirection(date));
    if (live) return toLatLon(live.pos);
  }
  const rec = featuredRecs.get(key)?.rec;
  const p = rec ? positionAt(rec, date) : null;
  return p ? toLatLon(p) : null;
};

function satelliteOverlay(date: Date, sun: Vec3): SatelliteOverlay | undefined {
  if (settings.sats === 'off') return undefined;
  if (!satManifest) return { featured: [], summary: satError ? 'unavailable' : 'loading…' };
  const featured = FEATURED.flatMap((sat) => {
    if (!leafOn(findNode(sat.key) as SatLeaf, settings)) return [];
    const entry = featuredRecs.get(sat.key);
    const live = sat.key === 'iss' ? issLiveState(date, sun) : undefined;
    const state = live ?? (entry ? stateAt(entry.rec, date, sun) : null);
    if (!entry || !state) return [];
    const period = periodMinutes(entry.elements);
    const track = tracks.track(sat.key, entry.rec, date, period / 2, period / 2, period / ORBIT_STEPS, state.pos);
    return [{ sat, state, track, live: !!live }];
  });
  // The groups shown, or with only the named ones on, their names.
  const summary = bulkSummary(catalog, settings) || featured.map((f) => f.sat.name).join(' · ');
  return { featured, tracking: settings.view === 'track' ? settings.track : undefined, summary };
}

/** Name labels for the categories ticked for labels (a few dozen SGP4 runs a frame at most). */
function satLabels(date: Date): SatLabelOverlay[] {
  if (!settings.satlabels.length) return [];
  return BULK_LEAVES.filter((l) => l.labelable && settings.satlabels.includes(l.key) && leafOn(l, settings)).flatMap((leaf) =>
    (labelRecs.get(leaf.key) ?? []).flatMap(({ rec, name }) => {
      const pos = positionAt(rec, date);
      return pos ? [{ pos, name, color: leaf.color }] : [];
    }),
  );
}

// ---- satellite tree -----------------------------------------------------------------

const satTree = new SatTree(document.getElementById('sat-tree') as HTMLElement, {
  toggle: (node) => update(toggleNode(node, settings)),
  toggleLabels: (leaf) => update({ satlabels: toggleLabels(leaf, settings.satlabels) }),
});

// ---- layer dock ----------------------------------------------------------------------
// Its buttons run the hotkeys, so they behave exactly like the keys (toasts included).

let drawerInset = 0;
let drawerShown = -1;
let drawerFull = -1;
const drawer = new Drawer(document.getElementById('drawer') as HTMLElement, {
  run(key) {
    const hk = hotkeyByKey(key);
    const k = key.replace('shift+', '');
    hk?.run(hotkeyContext, { key: k, shiftKey: key.startsWith('shift+') });
  },
  openSatTree: () => satTree.toggle(),
  keyLabel: (key) => hotkeyByKey(key)?.label ?? key.toUpperCase(),
  resized(shown, reserved, full) {
    // Toasts follow the dock as it rises and sinks…
    if (shown !== drawerShown) {
      drawerShown = shown;
      document.documentElement.style.setProperty('--drawer-h', `${shown}px`);
    }
    // …but the satellite panel stays put above where the dock is when fully shown, so it
    // doesn't move under the pointer as the pointer nears the bottom edge.
    if (full !== drawerFull) {
      drawerFull = full;
      document.documentElement.style.setProperty('--dock-full', `${full}px`);
    }
    // …but labels on the globe only make room while it's pinned open.
    if (reserved === drawerInset) return;
    drawerInset = reserved;
    // Deferred: the dock reports its size while this module is still initialising.
    queueMicrotask(requestRedraw);
  },
});
satTree.opener = drawer.satTreeButton;

// ---- feeds dashboard -----------------------------------------------------------------
// A card for each source on screen: how old its data is, and when the app checks again.

const MIN = 60_000;
/** Pipeline layers are rebuilt every hour at :50, then deployed within minutes. */
const PIPELINE_FRESH = 90 * MIN;

/** Each source's card, in the dock's order. `freshMs`: how old its newest data normally gets. */
const FEEDS: { key: string; label: string; source: string; freshMs: number; on: () => boolean; everyMs?: number }[] = [
  // Scans land in NOAA's bucket 35–45 min after the hour and the pipeline runs at :50.
  { key: 'clouds', label: 'Clouds', source: 'NOAA GMGSI', freshMs: 2 * 60 * MIN, on: () => settings.clouds, everyMs: clouds.intervalMs },
  // GOES scans land in GIBS ~50 min after they're taken, MTG's in EUMETView ~20.
  { key: 'imagery', label: 'Live imagery', source: 'GOES · MTG', freshMs: 60 * MIN, on: () => settings.imagery === 'live', everyMs: LIVE_CHECK_MS },
  { key: 'snow', label: 'Snow & ice', source: 'NOAA IMS', freshMs: PIPELINE_FRESH, on: () => settings.snow },
  { key: 'radar', label: 'Radar', source: 'RainViewer', freshMs: 20 * MIN, on: () => settings.radar },
  // The early run lands ~5 h after its half hour.
  { key: 'imerg', label: 'Satellite rain', source: 'NASA IMERG', freshMs: 6 * 60 * MIN, on: () => settings.radar && settings.imerg, everyMs: IMERG_CHECK_MS },
  { key: 'smoke', label: 'Smoke', source: 'NOAA HMS', freshMs: PIPELINE_FRESH, on: () => settings.smoke },
  { key: 'sun', label: 'Sun image', source: 'GOES SUVI', freshMs: 30 * MIN, on: () => settings.bodies && feedLog.get('sun').startedAt !== undefined, everyMs: SUN_IMAGE_EVERY_MS },
  { key: 'aurora', label: 'Aurora', source: 'NOAA SWPC', freshMs: 20 * MIN, on: () => settings.aurora },
  { key: 'tec', label: 'Ionosphere TEC', source: 'SWPC GloTEC', freshMs: PIPELINE_FRESH, on: () => settings.iono === 'tec', everyMs: 15 * MIN },
  { key: 'drap', label: 'HF absorption', source: 'SWPC D-RAP', freshMs: 20 * MIN, on: () => settings.iono === 'drap', everyMs: 10 * MIN },
  { key: 'storms', label: 'Cyclones', source: 'GDACS · NHC', freshMs: PIPELINE_FRESH, on: () => settings.storms },
  { key: 'fires', label: 'Fires', source: 'NASA FIRMS', freshMs: PIPELINE_FRESH, on: () => settings.fires },
  { key: 'quakes', label: 'Quakes', source: 'USGS', freshMs: 10 * MIN, on: () => settings.quakes },
  { key: 'lightning', label: 'Lightning', source: 'GOES GLM · MTG LI', freshMs: PIPELINE_FRESH, on: () => settings.lightning },
  { key: 'events', label: 'Alerts', source: 'GDACS', freshMs: PIPELINE_FRESH, on: () => settings.events },
  { key: 'severe', label: 'Severe weather', source: 'NWS · SPC', freshMs: 15 * MIN, on: () => settings.severe },
  { key: 'tsunami', label: 'Tsunami', source: 'NOAA · NWS', freshMs: PIPELINE_FRESH, on: () => settings.tsunami },
  // GMN's newest trajectories are hours behind its cameras, and its daily file a day.
  { key: 'meteors', label: 'Meteors', source: 'GMN · NASA/JPL', freshMs: 12 * 60 * MIN, on: () => settings.meteors },
  // CelesTrak updates elements every 2 h; the pipeline refetches them at most every 3 h.
  { key: 'satellites', label: 'Satellites', source: 'CelesTrak', freshMs: 4 * 60 * MIN, on: () => settings.sats !== 'off', everyMs: SAT_POLL_MS },
  { key: 'launches', label: 'Launches', source: 'Launch Library 2', freshMs: PIPELINE_FRESH, on: () => settings.launches, everyMs: LAUNCH_POLL_MS },
];

function feedRows(): FeedRow[] {
  const rows: FeedRow[] = FEEDS.filter((f) => f.on()).map((f) => {
    const hazard = HAZARDS[f.key as HazardKey];
    const state: FeedState = f.key === 'clouds' ? { ...feedLog.get('clouds'), nextAt: clouds.nextCheckAt } : feedLog.get(f.key);
    // The Sun image is only fetched while the Sun is in frame.
    const note = f.key === 'sun' ? 'when in view' : undefined;
    return { key: f.key, label: f.label, source: f.source, freshMs: f.freshMs, everyMs: f.everyMs ?? hazard?.everyMs, state, note };
  });
  // A stream, not a poll: its age is that of the newest value received.
  if (issLiveWanted()) {
    let newest: number | undefined;
    for (const v of issLive.values.values()) newest = Math.max(newest ?? v.t, v.t);
    rows.push({ key: 'iss', label: 'ISS telemetry', source: 'NASA ISSLive', freshMs: AOS_MAX_AGE_MS, live: true, state: { busy: false, dataAt: newest } });
  }
  return rows;
}

// ---- toast windows --------------------------------------------------------------------
// Every window down the right edge, in one column, in this order (see toasts.ts).

const toasts = new ToastManager(document.getElementById('toasts') as HTMLElement);
// Labels on the globe keep clear of the windows, so they move when one opens or closes.
toasts.onChange = () => queueMicrotask(requestRedraw);
const perfPanel = new PerfPanel(toasts.add({ id: 'perf', title: 'Frame rate', order: 0, shrink: 0, onClose: () => update({ fps: false }) }));
const issPanelView = new IssPanelView(
  toasts.add({ id: 'iss', title: 'ISS · NASA live telemetry', order: 1, shrink: 0, onClose: () => update({ isslive: 'off' }) }),
);
const feedBoard = new FeedBoard(toasts.add({ id: 'feeds', title: 'Data feeds', order: 2, onClose: () => update({ feeds: false }) }), feedRows);
const placeToast = toasts.add({
  id: 'place-card',
  title: 'Place',
  order: 3,
  accent: PLACE_COLOR,
  shrink: 0,
  maxShare: 0.5,
  onClose: () => placeCard.hide(),
});

// ---- going to a place ------------------------------------------------------------------
// From the search box or a double-click: glide along the great circle to it (a fixed
// view, zoom unchanged), then mark it with a reticle and its name for a while.

const TARGET_MS = 12_000;
let target: { pos: Vec3; name: string; until: number } | undefined;
let glideFrame = 0;

/** `label`: the name beside the reticle ('' for a labelled place, which shows its own). */
function goTo(place: Place, label = place.name.toUpperCase()) {
  cancelAnimationFrame(glideFrame);
  const from = viewerLatLon(settings, simTime(), resolveTrack);
  const to = { lat: place.lat, lon: place.lon };
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const ms = reduce ? 0 : glideMs(fromLatLon(from.lat, from.lon), fromLatLon(to.lat, to.lon));
  target = { pos: fromLatLon(to.lat, to.lon), name: label, until: Date.now() + TARGET_MS };
  setTimeout(requestRedraw, TARGET_MS + 50);
  const start = performance.now();
  const step = () => {
    const t = ms ? (performance.now() - start) / ms : 1;
    const p = glideAt(from, to, t);
    update({ view: 'fixed', lat: p.lat, lon: p.lon });
    if (t < 1) glideFrame = requestAnimationFrame(step);
  };
  step();
}

// ---- places from the search: a label, and a card with the weather and alerts there --------

function readLabelled(): Place[] {
  try {
    return decodeLabelled(localStorage.getItem(LABELLED_KEY));
  } catch {
    return [];
  }
}

let labelled = readLabelled();
let placeLabels = labelled.map(({ name, lat, lon }) => ({ name, lat, lon }));

function setLabelled(list: Place[]) {
  labelled = list;
  placeLabels = list.map(({ name, lat, lon }) => ({ name, lat, lon }));
  try {
    localStorage.setItem(LABELLED_KEY, JSON.stringify(list));
  } catch {
    // Private browsing or storage blocked: the labels last for this visit.
  }
  requestRedraw();
}

const imperial = prefersImperial(navigator.language || 'en');
const placeCard = new PlaceCard(placeToast, {
  unlabel: (place) => setLabelled(removeLabelled(labelled, place)),
});

/** Pipeline and USGS files fetched for a place card when their layer isn't loading them. */
const onDemand = new Map<string, { at: number; value: Promise<unknown> }>();
const ON_DEMAND_MS = 10 * 60_000;

function onDemandJson(url: string): Promise<unknown> {
  const hit = onDemand.get(url);
  if (hit && Date.now() - hit.at < ON_DEMAND_MS) return hit.value;
  const value = fetchJson(url);
  value.catch(() => onDemand.delete(url));
  onDemand.set(url, { at: Date.now(), value });
  return value;
}

/** A layer's data: what it already holds while it's on, else fetched for the card. */
async function layerData<T>(on: boolean, have: T | undefined, url: string, check: (v: unknown) => v is T): Promise<T | undefined> {
  if (on && have) return have;
  const v = await onDemandJson(url);
  return check(v) ? v : undefined;
}

async function nearbySources(): Promise<NearbySources> {
  const [storms, events, quakeList, lightning, fires, tsunami] = await Promise.allSettled([
    layerData(settings.storms, stormManifest, pipelineFile(settings.stormsrc), isStormManifest),
    layerData(settings.events, eventManifest, pipelineFile(settings.eventsrc), isEventManifest),
    settings.quakes && quakes.length ? Promise.resolve(quakes) : onDemandJson(USGS_QUAKES_URL).then((f) => (isQuakeFeed(f) ? decodeQuakes(f) : [])),
    layerData(settings.lightning, lightningLayer(), pipelineFile(settings.lightningsrc), isLightningManifest),
    layerData(settings.fires, fireManifest, pipelineFile(settings.firesrc), isFireManifest),
    layerData(settings.tsunami, tsunamiManifest, pipelineFile(settings.tsunamisrc), isTsunamiManifest),
  ]);
  const value = <T,>(r: PromiseSettledResult<T>) => (r.status === 'fulfilled' ? r.value : undefined);
  return { storms: value(storms), events: value(events), quakes: value(quakeList), lightning: value(lightning), fires: value(fires), tsunami: value(tsunami) };
}

/** A place card's own requests give up after this, so it never sits on "Checking…". */
const PLACE_FETCH_MS = 12_000;

async function getJson(url: string, init?: RequestInit): Promise<unknown> {
  const r = await fetch(url, { ...init, signal: AbortSignal.timeout(PLACE_FETCH_MS) });
  if (!r.ok) throw new Error(`${r.status} ${url}`);
  return r.json();
}

/** Alerts for a place: NWS (US), air quality, and the hazard layers' data nearby. */
async function placeAlerts(place: Place): Promise<Required<Pick<PlaceReport, 'alerts' | 'checked'>>> {
  const { lat, lon } = place;
  const nws = inNwsArea(lat, lon);
  const [air, nwsAlerts, nearby] = await Promise.allSettled([
    getJson(airQualityUrl(lat, lon)).then(aqiAlert),
    nws ? getJson(nwsPointAlertsUrl(lat, lon), { headers: { Accept: 'application/geo+json' } }).then(decodeNwsPointAlerts) : Promise.resolve([]),
    nearbySources().then((src) => nearbyHazards(lat, lon, src, Date.now(), imperial)),
  ]);
  const alerts: LocalAlert[] = [];
  const checked: string[] = [];
  if (nws && nwsAlerts.status === 'fulfilled') {
    alerts.push(...nwsAlerts.value);
    checked.push('NWS');
  }
  if (air.status === 'fulfilled') {
    if (air.value) alerts.push(air.value);
    checked.push('air quality');
  }
  if (nearby.status === 'fulfilled') {
    alerts.push(...nearby.value);
    checked.push('nearby hazards');
  }
  for (const r of [air, nwsAlerts, nearby]) if (r.status === 'rejected') console.warn('place card:', r.reason);
  return { alerts, checked };
}

/** A place picked in the search: go there, label it, and show what it's like there. */
function goToSearched(place: Place) {
  setLabelled(addLabelled(labelled, place));
  goTo(place, '');
  placeCard.show(place, isLabelled(labelled, place));
  // Weather and alerts fill in as each arrives.
  getJson(forecastUrl(place.lat, place.lon))
    .then(decodeForecast)
    .catch((err) => (console.warn('place card:', err), null))
    .then((weather) => placeCard.fill(place, { weather }, imperial));
  void placeAlerts(place).then((part) => placeCard.fill(place, part, imperial));
}

const search = new PlaceSearch(document.getElementById('search') as HTMLElement, { go: goToSearched, recent: () => labelled, toast });

// Double-click (or double-tap) a point on the globe to centre on it.
overlayCanvas.addEventListener('dblclick', (e) => {
  const r = overlayCanvas.getBoundingClientRect();
  const R = radiusCss();
  const p = unproject(cameraFor(settings, simTime(), resolveTrack), (e.clientX - r.left - r.width / 2) / R, -(e.clientY - r.top - r.height / 2) / R);
  if (!p) return;
  const ll = toLatLon(p);
  goTo({ name: formatCoordinates(ll.lat, ll.lon), detail: '', ...ll });
});

/** Satellites per category for the tree: the bulk counts, and 1 for each named one we have. */
function treeCounts(): Record<string, number> {
  const counts: Record<string, number> = { ...(catalog?.counts ?? {}) };
  for (const f of FEATURED) if (featuredRecs.has(f.key)) counts[f.key] = 1;
  return counts;
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
      label:
        e.kind === 'sun'
          ? sunImageTime
            ? `SUN · SUVI 304 Å ${sunImageTime}Z`
            : 'SUN'
          : `MOON · ${Math.round(sky.moonLit * 100)}% LIT`,
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
  if (draws.some((d) => d.kind === 'sun')) void loadSunImage();
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
/** Last readout bottom edge sent to CSS as --readout-bottom (only written when it changes). */
let lastReadoutBottom = -1;
/** Too slow for the glass blur: html.lite swaps it for solid panels. */
const slowFrames = new SlowFrames();
/** When the last frame drawn back to back (continuous redraws) started, or 0. */
let lastAnimatedAt = 0;

function frame(now: number) {
  raf = 0;
  if (redrawEvery === 0 && lastAnimatedAt && slowFrames.add(now - lastAnimatedAt)) document.documentElement.classList.add('lite');
  lastAnimatedAt = redrawEvery === 0 ? now : 0;
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

  const active = BULK_LEAVES.map((l) => leafOn(l, settings));
  const showBulk = bulkCount > 0 && active.some(Boolean);
  // A category just switched on has no positions yet: propagate again now.
  if (active.join() !== activeKey) {
    activeKey = active.join();
    requestedTime = NaN;
  }
  const tMs = date.getTime();
  if (showBulk && !workerBusy && !(Math.abs(tMs - requestedTime) < SAT_REFRESH_MS)) {
    workerBusy = true;
    requestedTime = tMs;
    post({ type: 'propagate', time: tMs, active });
  }
  const satLooks = BULK_LEAVES.map((l, i) => ({ color: rgb(l.color), size: active[i] ? (l.size ?? 2.2) : 0, diamond: l.shape === 'diamond' }));
  const bulkDt = Math.max(-SAT_MAX_EXTRAPOLATE_S, Math.min(SAT_MAX_EXTRAPOLATE_S, (tMs - bulkTime) / 1000));
  const scale = globeCanvas.width / Math.max(globeCanvas.clientWidth, 1);
  const radiusPx = radiusCss() * scale;
  syncDetail(date, radiusPx);
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
    satellites: showBulk && Number.isFinite(bulkTime) ? { dt: bulkDt, categories: satLooks } : null,
    bodies: bodies.draws,
    aurora: settings.aurora,
    iono: settings.iono,
    fires: settings.fires
      ? { windowH: settings.firehours, minIntensity: fireMinIntensity(6371 / Math.max(radiusPx, 1)) }
      : null,
    lightning: settings.lightning && (lightningManifest || liCells.length) ? { windowMin: LI_WINDOW_MIN } : null,
    snowIce: settings.snow,
    radar: settings.radar,
    imerg: settings.radar && settings.imerg,
    smoke: settings.smoke,
    detail: settings.imagery === 'daily' ? !!detail : liveShown(date) && liveDetail,
    live: liveShown(date),
    nightDetail: settings.imagery !== 'painted' && !!nightDetail,
    relief: reliefStrength(),
    dpr: scale,
  });
  if (settings.fps) gpuTimer.end(slot);
  const t2 = performance.now();

  const readoutBottom = drawOverlay(overlayCanvas, {
    camera,
    radiusPx: radiusCss(),
    date,
    viewer: viewerLatLon(settings, date, resolveTrack),
    satellites: satOverlay,
    satLabels: satLabels(date),
    bodies: settings.bodies ? bodies.markers : undefined,
    launches: launch.overlays,
    storms: stormOverlays(),
    quakes: quakeOverlays(),
    meteors: meteorOverlay(),
    events: eventOverlays(),
    tsunami: tsunamiOverlays().bulletins,
    tsunamiZones: tsunamiOverlays().zones,
    severe: severeOverlays().shapes,
    severeLabels: severeOverlays().labels,
    bottomInset: drawerInset,
    panels: [...toasts.rects(), ...domRects(credits, radarCredit)],
    target: target && target.until > Date.now() ? target : undefined,
    places: placeLabels,
    rows: [...(launch.row ? [launch.row] : []), ...layerRows()],
    sun,
    markers: settings.markers,
    label: settings.label,
    clouds: settings.clouds,
    cloudStatus,
    clock: clockLabel(),
    note,
  });
  // On phones the toast column starts below the readout instead of covering it.
  if (readoutBottom !== lastReadoutBottom) {
    lastReadoutBottom = readoutBottom;
    document.documentElement.style.setProperty('--readout-bottom', `${readoutBottom}px`);
  }
  issPanelView.update(issPanelState(sunDir));
  perfPanel.update(
    settings.fps
      ? {
          summary: stats.summary(now, Math.max(1000, redrawEvery * 3000 + 100)),
          intervals: stats.recentIntervals(120),
          mode: slowFrames.tripped ? `${renderMode} · solid glass` : renderMode,
          gpuAvailable: gpuTimer.available,
        }
      : undefined,
  );
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
  lastAnimatedAt = 0; // the gap while hidden isn't a slow frame
  if (!document.hidden) {
    requestRedraw();
    if (settings.clouds) void clouds.check();
  }
});
window.addEventListener('resize', requestRedraw);

// ---- settings changes ---------------------------------------------------------
let urlTimer: ReturnType<typeof setTimeout> | undefined;
let radarZoomTimer: ReturnType<typeof setTimeout> | undefined;

function update(patch: Partial<Settings>) {
  const cloudsBefore = settings.clouds;
  const ionoBefore = settings.iono;
  const magBefore = settings.mag;
  const imergBefore = settings.imerg;
  const satsBefore = settings.sats;
  const launchesBefore = settings.launches;
  const imageryBefore = settings.imagery;
  const hazardsBefore = Object.fromEntries((Object.keys(HAZARDS) as HazardKey[]).map((k) => [k, settings[k]]));
  settings = { ...settings, ...patch };
  if (settings.launches !== launchesBefore) syncLaunches();
  for (const key of Object.keys(hazardsBefore) as HazardKey[]) {
    if (settings[key] !== hazardsBefore[key]) syncHazard(key);
  }
  if (settings.clouds !== cloudsBefore) syncClouds();
  if (settings.imagery !== imageryBefore) syncLive();
  if (settings.iono !== ionoBefore) syncIono();
  syncIssLive();
  satTree.refresh(settings, treeCounts());
  drawer.refresh(settings);
  feedBoard.show(settings.feeds);
  // RainViewer's credit link shows whenever radar does.
  radarCredit.hidden = !settings.radar;
  // Zooming past the radar's detail threshold fetches the finer tiles (once it settles).
  // Satellite rain switched back on: load it now rather than at the next radar check.
  if (settings.radar && settings.imerg && !imergBefore) {
    imergCheckedAt = 0;
    void runHazard('radar');
  }
  if (!settings.imerg || !settings.radar) feedLog.stop('imerg');
  if (settings.radar && radarZoom(settings.mag) !== radarZoom(magBefore)) {
    clearTimeout(radarZoomTimer);
    radarZoomTimer = setTimeout(() => void runHazard('radar'), 800);
  }
  if ((settings.sats === 'off') !== (satsBefore === 'off')) syncSatellites();
  clearTimeout(urlTimer);
  urlTimer = setTimeout(() => history.replaceState(null, '', `${location.pathname}${toQuery(settings)}`), 300);
  requestRedraw();
}

// Drag to look around (switches to a fixed viewpoint), wheel to zoom.
let dragging = false;
let last = { x: 0, y: 0 };

// One pointer drags; two pinch to zoom (touch screens). Lifting one finger of a pinch
// carries on as a drag with the other.
const pointers = new Map<number, { x: number; y: number }>();
let pinch: { spread: number; mag: number } | null = null;
const spread = () => {
  const [a, b] = [...pointers.values()];
  return Math.hypot(a.x - b.x, a.y - b.y);
};

overlayCanvas.addEventListener('pointerdown', (e) => {
  cancelAnimationFrame(glideFrame); // grabbing the globe stops a glide in progress
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  overlayCanvas.setPointerCapture(e.pointerId);
  if (pointers.size >= 2) {
    dragging = false;
    pinch = { spread: spread(), mag: settings.mag };
    return;
  }
  dragging = true;
  last = { x: e.clientX, y: e.clientY };
  const here = viewerLatLon(settings, simTime(), resolveTrack);
  if (settings.view !== 'fixed') update({ view: 'fixed', lat: here.lat, lon: here.lon, rot: 0 });
});

overlayCanvas.addEventListener('pointermove', (e) => {
  if (!pointers.has(e.pointerId)) return;
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (pinch && pointers.size >= 2) {
    update({ mag: pinchMag(pinch.mag, pinch.spread, spread(), MAG_MIN, MAG_MAX) });
    return;
  }
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

const endDrag = (e: PointerEvent) => {
  pointers.delete(e.pointerId);
  if (pointers.size < 2) pinch = null;
  const rest = [...pointers.values()][0];
  if (rest) {
    dragging = true;
    last = { ...rest };
  } else {
    dragging = false;
    requestRedraw();
  }
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
  toggleSatTree(open) {
    satTree.toggle(open);
  },
  toggleDrawer() {
    drawer.toggle();
  },
  openSearch() {
    search.toggle(true);
  },
  toast,
};

window.addEventListener('keydown', (e) => {
  // Events aimed at the window or document (not an element) have no closest().
  const target = e.target instanceof Element ? e.target : null;
  if (target?.closest('textarea, select, [contenteditable], input:not([type="checkbox"])')) return;
  // In the satellite panel, Space and Enter work its checkboxes and buttons.
  if (target?.closest('#sat-tree') && (e.key === ' ' || e.key === 'Enter')) return;
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
// The sample text covers both faces: a letter for Chakra Petch, a digit for HUD Digits.
Promise.all([`500 11px ${UI_FONT}`, `600 11px ${UI_FONT}`].map((f) => document.fonts.load(f, 'A0')))
  .then(() => {
    clearOverlaySprites(); // labels drawn before the font arrived used the fallback face
    requestRedraw();
  })
  .catch(() => {});

syncClouds();
syncSatellites();
syncLaunches();
for (const key of Object.keys(HAZARDS) as HazardKey[]) syncHazard(key);
syncLive();
syncIono();

// Installed web app / Android TWA: an offline shell (public/sw.js). Not inside the
// Capacitor app, whose files are bundled; there, Android's back button closes panels.
if (Capacitor.isNativePlatform()) {
  void import('@capacitor/app').then(({ App }) =>
    App.addListener('backButton', () => {
      if (search.open) search.toggle(false);
      else if (satTree.open) satTree.toggle(false);
      else if (!help.hidden) help.hidden = true;
      else void App.minimizeApp();
    }),
  );
} else if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  navigator.serviceWorker.register(new URL('sw.js', document.baseURI)).catch((err) => console.warn('service worker:', err));
}
radarCredit.hidden = !settings.radar;
syncIssLive();
satTree.refresh(settings, treeCounts());
drawer.refresh(settings);
feedBoard.show(settings.feeds);
requestRedraw();
