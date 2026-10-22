// App wiring: settings → clock → camera/sun → renderer + overlay, redrawn on a
// schedule (xearth's -wait), with hourly cloud maps faded in as they arrive
// and satellites propagated from CelesTrak elements.

import '@fontsource/chakra-petch/500.css';
import '@fontsource/chakra-petch/600.css';
import type { SatRec } from 'satellite.js';
import { subsolarPoint, sunDirection } from './astronomy';
import { framingViewpoint, MOON_RADIUS_KM, placeBody, skyBodies, type SkyBodies } from './bodies';
import { describeCadence, redrawInterval } from './cadence';
import { IssLive, issFromTelemetry, issPanel } from './isslive';
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
import { formatCoordinates, glideAt, glideMs, type Place } from './places';
import { PlaceSearch } from './search';
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
  tsunamiLine,
  tsunamiRows,
  tsunamiShown,
  zoneCentroid,
  type NwsTsunamiAlert,
  type TsunamiManifest,
} from './tsunami';
import { composeRadar, latestFrame, RAINVIEWER_API, radarZoom, type RadarFrame } from './radar';
import { fetchSpaceWeather, spaceWeatherLine, SUVI_LIMB, SUVI_URL, type SpaceWeather } from './spaceweather';
import {
  ALERT_COLOR,
  burnedRadiusKm,
  decodeLightning,
  EVENT_COLOR,
  eventDetail,
  eventLine,
  eventSize,
  eventTitle,
  impactLabel,
  isEventManifest,
  isLightningManifest,
  isSmokeManifest,
  isSnowIceManifest,
  labelledEvents,
  smokeLine,
  snowIceLine,
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
  formatAge,
  UI_FONT,
  type BodyMarker,
  type EventOverlay,
  type TsunamiOverlay,
  type ZoneOverlay,
  type LaunchOverlay,
  type QuakeOverlay,
  type SatelliteOverlay,
  type SatLabelOverlay,
  type StormOverlay,
} from './overlay';
import { FrameStats, GpuTimer } from './perf';
import { parseSettings, toQuery, type Settings } from './params';
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
import { dayTextureUrl, loadImage, nightTextureUrl } from './textures';
import { cross, dot, fromLatLon, normalize, scale, sub, toLatLon, type Vec3 } from './vec';
import { cameraFor, ORTHO_SKY_FOCAL, skyFocal, unproject, viewerLatLon, type Camera, type TrackResolver } from './view';
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

// ---- hazards: aurora, cyclones, fires, quakes, lightning, GDACS events, snow/ice -----
// Aurora and earthquakes come straight from NOAA SWPC and USGS (both CORS-enabled,
// small, updated every few minutes). The rest come from the pipeline: GDACS/NHC
// need merging, FIRMS is ~20 MB raw, GLM sits in buckets without CORS, and IMS
// needs reprojecting. Each polls only while shown.

let aurora: AuroraGrid | undefined;
let stormManifest: StormManifest | undefined;
let firePoints: FirePoints | undefined;
let quakes: Quake[] = [];
let lightningManifest: LightningManifest | undefined;
let eventManifest: EventManifest | undefined;
let snowIce: SnowIceManifest | undefined;
let smoke: SmokeManifest | undefined;
let tsunamiManifest: TsunamiManifest | undefined;
let nwsTsunami: NwsTsunamiAlert[] = [];
/** NWS zone URL → centroid [lon, lat] (null: no geometry). Zones don't move, so this is kept. */
const zoneCentroids = new Map<string, [number, number] | null>();
/** NWS alerts already announced with a toast. */
const announced = new Set<string>();
let radarFrame: RadarFrame | undefined;
let radarZoomShown = 0;
const radarCredit = document.getElementById('radar-credit') as HTMLElement;
let spaceWeather: SpaceWeather | undefined;

// The SUVI Sun image (~1 MB) is fetched only while the Sun is actually in frame.
const SUN_IMAGE_EVERY_MS = 15 * 60_000;
let sunImageAt = 0;
let sunImageTime: string | undefined;
let sunImageLoading = false;

async function loadSunImage() {
  if (sunImageLoading || Date.now() - sunImageAt < SUN_IMAGE_EVERY_MS) return;
  sunImageLoading = true;
  try {
    const r = await fetch(SUVI_URL, { cache: 'no-cache' });
    if (!r.ok) throw new Error(`${r.status} ${SUVI_URL}`);
    const modified = r.headers.get('last-modified');
    renderer.setSun(await createImageBitmap(await r.blob()), SUVI_LIMB);
    sunImageTime = modified ? new Date(modified).toISOString().slice(11, 16) : undefined;
    sunImageAt = Date.now();
    requestRedraw();
  } catch (err) {
    console.warn('sun image:', err);
    sunImageAt = Date.now() - SUN_IMAGE_EVERY_MS + 60_000; // retry in a minute
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

type HazardKey = 'aurora' | 'storms' | 'fires' | 'quakes' | 'lightning' | 'events' | 'snow' | 'radar' | 'smoke' | 'tsunami';

const HAZARDS: Record<HazardKey, { everyMs: number; load: () => Promise<void> }> = {
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
  },
  storms: {
    everyMs: 15 * 60_000,
    load: async () => {
      const m = await fetchJson(pipelineFile(settings.stormsrc));
      if (!isStormManifest(m)) throw new Error('storms/latest.json is not a storm manifest');
      stormManifest = m;
      stormCache = undefined;
    },
  },
  fires: {
    everyMs: 30 * 60_000,
    load: async () => {
      const m = await fetchJson(pipelineFile(settings.firesrc));
      if (!isFireManifest(m)) throw new Error('fires/latest.json is not a fire manifest');
      firePoints = decodeFires(m);
      renderer.setFires(firePoints);
    },
  },
  quakes: {
    everyMs: 5 * 60_000,
    load: async () => {
      const f = await fetchJson(USGS_QUAKES_URL);
      if (!isQuakeFeed(f)) throw new Error('not a USGS earthquake feed');
      quakes = decodeQuakes(f);
    },
  },
  lightning: {
    everyMs: 15 * 60_000,
    load: async () => {
      const m = await fetchJson(pipelineFile(settings.lightningsrc));
      if (!isLightningManifest(m)) throw new Error('lightning/latest.json is not a lightning manifest');
      lightningManifest = m;
      renderer.setLightning(decodeLightning(m));
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
  },
  // RainViewer publishes a frame every 10 min. Its tiles are fetched only for a new
  // frame (or a finer zoom), never while the tab is hidden: the free API asks for caching.
  radar: {
    everyMs: 5 * 60_000,
    load: async () => {
      if (document.hidden) return;
      const frame = latestFrame(await fetchJson(RAINVIEWER_API));
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
  },
};

const hazardTimers: Partial<Record<HazardKey, ReturnType<typeof setInterval>>> = {};

function syncHazard(key: HazardKey) {
  clearInterval(hazardTimers[key]);
  delete hazardTimers[key];
  if (!settings[key]) return;
  const run = () =>
    HAZARDS[key]
      .load()
      .catch((err) => console.warn(`${key}:`, err))
      .finally(requestRedraw);
  void run();
  hazardTimers[key] = setInterval(run, HAZARDS[key].everyMs);
}

/** Storm drawing is fixed per manifest, so it's built once per load. */
let stormCache: StormOverlay[] | undefined;
function stormOverlays(): StormOverlay[] {
  if (!settings.storms || !stormManifest) return [];
  stormCache ??= stormManifest.storms.map((st) => ({
    title: stormTitle(st),
    detail: stormDetail(st),
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
        ? { title: eventTitle(e), detail: eventDetail(e, now), impact: impactLabel(e.alert), impactColor: ALERT_COLOR[e.alert] ?? '#c8d6e5' }
        : undefined,
    }));
  }
  return eventCache;
}

function surfaceLine(): string | undefined {
  const parts: string[] = [];
  if (settings.lightning && lightningManifest) {
    const n = lightningManifest.flashes;
    const end = lightningManifest.latest?.slice(11, 16);
    parts.push(`lightning ${n >= 1000 ? `${(n / 1000).toFixed(1)}k` : n} flashes (${lightningManifest.windowMin} min${end ? ` to ${end}Z` : ''}, GOES)`);
  }
  if (settings.events && eventManifest) parts.push(eventLine(eventManifest));
  return parts.length ? parts.join(' · ') : undefined;
}

/** Tsunami markers change only with their data (and statements' label windows), so built per load. */
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
  return issPanel(issLive.values, now.getTime(), live && { altKm: live.altKm, speed: live.speed, deltaKm });
}

function weatherLine(): string | undefined {
  const parts: string[] = [];
  if (settings.radar && radarFrame) parts.push(`radar ${new Date(radarFrame.time * 1000).toISOString().slice(11, 16)}Z (RainViewer)`);
  if (settings.smoke && smoke) parts.push(smokeLine(smoke));
  if (settings.snow && snowIce) parts.push(snowIceLine(snowIce));
  return parts.length ? parts.join(' · ') : undefined;
}

function hazardLine(): string | undefined {
  const parts: string[] = [];
  if (settings.aurora && aurora) parts.push(`aurora ${aurora.forecast.slice(11, 16)}Z (peak ${aurora.peak}%)`);
  if (settings.storms && stormManifest) {
    const n = stormManifest.storms.length;
    parts.push(`${n} tropical cyclone${n === 1 ? '' : 's'}`);
  }
  if (settings.fires && firePoints) {
    const n = firesWithin(firePoints, settings.firehours).detections;
    parts.push(`fires ${n >= 1000 ? `${(n / 1000).toFixed(1)}k` : n} (last ${settings.firehours} h)`);
  }
  if (settings.quakes && quakes.length) parts.push(`${quakes.length} quakes M2.5+ (24 h)`);
  if (settings.tsunami) {
    const t = tsunamiLine(tsunamiManifest, nwsTsunami, Date.now());
    if (t) parts.push(t);
  }
  return parts.length ? parts.join(' · ') : undefined;
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
  if (!satManifest) return { featured: [], summary: satError ? 'satellites unavailable' : 'satellites loading…' };
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
  const fetched = formatAge(new Date(satManifest.generated), new Date());
  const shown = bulkSummary(catalog, settings);
  const bulk = shown ? `${shown} · ` : '';
  return {
    featured,
    tracking: settings.view === 'track' ? settings.track : undefined,
    summary: `satellites ${bulk}elements fetched ${fetched}${satError ? ' (update failed)' : ''}`,
  };
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
const drawer = new Drawer(document.getElementById('drawer') as HTMLElement, {
  run(key) {
    const hk = hotkeyByKey(key);
    const k = key.replace('shift+', '');
    hk?.run(hotkeyContext, { key: k, shiftKey: key.startsWith('shift+') });
  },
  openSatTree: () => satTree.toggle(),
  keyLabel: (key) => hotkeyByKey(key)?.label ?? key.toUpperCase(),
  resized(shown, reserved) {
    // Toasts and the satellite panel sit above the dock whenever it's showing…
    if (shown !== drawerShown) {
      drawerShown = shown;
      document.documentElement.style.setProperty('--drawer-h', `${shown}px`);
    }
    // …but labels on the globe only make room while it's pinned open.
    if (reserved === drawerInset) return;
    drawerInset = reserved;
    // Deferred: the dock reports its size while this module is still initialising.
    queueMicrotask(requestRedraw);
  },
});
satTree.opener = drawer.satTreeButton;

// ---- going to a place ------------------------------------------------------------------
// From the search box or a double-click: glide along the great circle to it (a fixed
// view, zoom unchanged), then mark it with a reticle and its name for a while.

const TARGET_MS = 12_000;
let target: { pos: Vec3; name: string; until: number } | undefined;
let glideFrame = 0;

function goTo(place: Place) {
  cancelAnimationFrame(glideFrame);
  const from = viewerLatLon(settings, simTime(), resolveTrack);
  const to = { lat: place.lat, lon: place.lon };
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const ms = reduce ? 0 : glideMs(fromLatLon(from.lat, from.lon), fromLatLon(to.lat, to.lon));
  target = { pos: fromLatLon(to.lat, to.lon), name: place.name.toUpperCase(), until: Date.now() + TARGET_MS };
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

const search = new PlaceSearch(document.getElementById('search') as HTMLElement, { go: goTo, toast });

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
    fires: settings.fires
      ? { windowH: settings.firehours, minIntensity: fireMinIntensity(6371 / Math.max(radiusPx, 1)) }
      : null,
    lightning: settings.lightning && lightningManifest ? { windowMin: lightningManifest.windowMin } : null,
    snowIce: settings.snow,
    radar: settings.radar,
    smoke: settings.smoke,
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
    satLabels: satLabels(date),
    bodies: settings.bodies ? bodies.markers : undefined,
    launches: launch.overlays,
    launchLine: launch.line,
    storms: stormOverlays(),
    quakes: quakeOverlays(),
    events: eventOverlays(),
    tsunami: tsunamiOverlays().bulletins,
    tsunamiZones: tsunamiOverlays().zones,
    issPanel: issPanelState(sunDir),
    hazardLine: hazardLine(),
    surfaceLine: surfaceLine(),
    bottomInset: drawerInset,
    target: target && target.until > Date.now() ? target : undefined,
    weatherLine: weatherLine(),
    spaceLine: settings.aurora && spaceWeather ? spaceWeatherLine(spaceWeather) : undefined,
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
let radarZoomTimer: ReturnType<typeof setTimeout> | undefined;

function update(patch: Partial<Settings>) {
  const cloudsBefore = settings.clouds;
  const magBefore = settings.mag;
  const satsBefore = settings.sats;
  const launchesBefore = settings.launches;
  const hazardsBefore = Object.fromEntries((Object.keys(HAZARDS) as HazardKey[]).map((k) => [k, settings[k]]));
  settings = { ...settings, ...patch };
  if (settings.launches !== launchesBefore) syncLaunches();
  for (const key of Object.keys(hazardsBefore) as HazardKey[]) {
    if (settings[key] !== hazardsBefore[key]) syncHazard(key);
  }
  if (settings.clouds !== cloudsBefore) syncClouds();
  syncIssLive();
  satTree.refresh(settings, treeCounts());
  drawer.refresh(settings);
  // RainViewer's credit link shows whenever radar does.
  radarCredit.hidden = !settings.radar;
  // Zooming past the radar's detail threshold fetches the finer tiles (once it settles).
  if (settings.radar && radarZoom(settings.mag) !== radarZoom(magBefore)) {
    clearTimeout(radarZoomTimer);
    radarZoomTimer = setTimeout(() => void HAZARDS.radar.load().catch((err) => console.warn('radar:', err)).finally(requestRedraw), 800);
  }
  if ((settings.sats === 'off') !== (satsBefore === 'off')) syncSatellites();
  clearTimeout(urlTimer);
  urlTimer = setTimeout(() => history.replaceState(null, '', `${location.pathname}${toQuery(settings)}`), 300);
  requestRedraw();
}

// Drag to look around (switches to a fixed viewpoint), wheel to zoom.
let dragging = false;
let last = { x: 0, y: 0 };

overlayCanvas.addEventListener('pointerdown', (e) => {
  cancelAnimationFrame(glideFrame); // grabbing the globe stops a glide in progress
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
Promise.all([`500 11px ${UI_FONT}`, `600 11px ${UI_FONT}`].map((f) => document.fonts.load(f)))
  .then(() => {
    clearOverlaySprites(); // labels drawn before the font arrived used the fallback face
    requestRedraw();
  })
  .catch(() => {});

syncClouds();
syncSatellites();
syncLaunches();
for (const key of Object.keys(HAZARDS) as HazardKey[]) syncHazard(key);
radarCredit.hidden = !settings.radar;
syncIssLive();
satTree.refresh(settings, treeCounts());
drawer.refresh(settings);
requestRedraw();
