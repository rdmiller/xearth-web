// Live imagery: today's geostationary colour pictures on the day side, MTG's ~20 minutes old
// and GOES's about an hour (GIBS's WMS draws a scan a while after it's listed; see isBlankPixels).
//
// Three satellites see most of the world between them: GOES-West over the Pacific, GOES-East
// over the Americas and the Atlantic (both GeoColor, from NASA GIBS) and Meteosat Third
// Generation over Europe and Africa (GeoColour, from EUMETSAT's EUMETView). Both servers are
// WMS with CORS, so the browser asks for a JPEG of each satellite's disc on the globe's own
// latitude/longitude grid; a new scan lands every 10 minutes. Meteosat-9's Indian Ocean
// service (IODC, at 45.5°E) fills in east of MTG's limb, over the Indian Ocean and western
// and central Asia, every 15 minutes: Natural Colour Enhanced, not GeoColour (the server has
// none for it), so it shows only where MTG can't. East Asia and the west Pacific (Himawari)
// have no colour product on either server, so the painted globe shows there.
//
// The pictures are already lit by the real Sun, and their night side is a different product
// (infrared cloud over a static city-lights map), so the shader uses them only where the Sun
// is well up and fades each satellite out toward its limb, where the view is too oblique.
//
// Zoomed in past the Blue Marble, the satellite looking most nearly straight down at the
// view's centre is asked for just what's on screen, down to ~1 km a pixel.

import { degPerTexel, rangeBounds, tileRange, tileCount, type Box, type TileRange } from './gibs';

export interface LiveSource {
  key: string;
  /** Short name for the readout and the feeds card. */
  name: string;
  /** Longitude of the point below the satellite. */
  subLon: number;
  /** WMS endpoint (GetMap) and layer. */
  wms: string;
  layer: string;
  /** Where the newest scan's time comes from. */
  times: 'gibs' | 'eumetsat';
  /** Shown only where the other satellites leave gaps (a different look, or older and coarser). */
  fill?: boolean;
  /**
   * The product is empty on the night side (Natural Colour stops ~1–3° after sunset), so a
   * blank picture there means night, not an unrendered scan: the newest listed scan is used.
   */
  dayOnly?: boolean;
  /** GetMap's format: JPEG unless the colours are data (Himawari's Band 13 is read back to temperatures). */
  format?: 'image/png';
  /** GIBS's tile-matrix set, for its list of times (GOES GeoColor is 1km). */
  matrix?: string;
}

export const GIBS_WMS = 'https://gibs.earthdata.nasa.gov/wms/epsg4326/best/wms.cgi';
const EUMETSAT_WMS = 'https://view.eumetsat.int/geoserver/ows';

/**
 * West to east. GOES-18 is GOES-West at 137.2°W, GOES-19 GOES-East at 75.2°W, MTG-I1 at 0° and
 * Meteosat-9 (IODC) at 45.5°E (EUMETView's layer box is centred on 41.5°E, but its disc isn't).
 */
export const LIVE_SOURCES: readonly LiveSource[] = [
  { key: 'goes-west', name: 'GOES-West', subLon: -137.2, wms: GIBS_WMS, layer: 'GOES-West_ABI_GeoColor', times: 'gibs' },
  { key: 'goes-east', name: 'GOES-East', subLon: -75.2, wms: GIBS_WMS, layer: 'GOES-East_ABI_GeoColor', times: 'gibs' },
  { key: 'mtg', name: 'MTG', subLon: 0, wms: EUMETSAT_WMS, layer: 'mtg_fd:rgb_geocolour', times: 'eumetsat' },
  { key: 'iodc', name: 'Meteosat-9', subLon: 45.5, wms: EUMETSAT_WMS, layer: 'msg_iodc:rgb_naturalenhncd', times: 'eumetsat', fill: true, dayOnly: true },
];

/** Each disc is fetched as this box around the sub-satellite point; past ~81° there's only space. */
export const DISC_HALF_DEG = 81;
/** Beyond this angle from the sub-satellite point the shader has faded a satellite out. */
export const LIMB_DEG = 72;
/** Look for a new scan this often (a scan comes every 10 minutes). */
export const LIVE_CHECK_MS = 5 * 60_000;
/** Live pictures only match a clock within this of now; a simulated time shows the painted globe. */
export const LIVE_MAX_SKEW_MS = 30 * 60_000;
/** Zoomed-in requests: no finer than the instruments' ~1 km, and at most 4×4 GIBS-sized tiles. */
export const LIVE_MAX_LEVEL = 6;
const LIVE_MAX_TILES = 16;
const TILE_PX = 512;

/** Disc request sizes (px a side), chosen by how big the globe is on screen. */
export const DISC_SIZES = [1024, 1536, 2048] as const;

/** The smallest disc size that gives a screen pixel at least one image pixel at the globe's centre. */
export function discSize(radiusPx: number): number {
  const need = (2 * DISC_HALF_DEG * Math.PI) / 180 * radiusPx;
  return DISC_SIZES.find((s) => s >= need) ?? DISC_SIZES[DISC_SIZES.length - 1];
}

/** Great-circle angle (degrees) between a point and the point below a satellite. */
export function viewAngleDeg(lat: number, lon: number, subLon: number): number {
  const r = Math.PI / 180;
  const c = Math.cos(lat * r) * Math.cos((lon - subLon) * r);
  return Math.acos(Math.max(-1, Math.min(1, c))) / r;
}

/**
 * The satellite seeing a point most nearly face-on, if any sees it well enough to use; a fill
 * satellite only where none of the others does, as on the globe.
 */
export function bestSource(lat: number, lon: number, sources: readonly LiveSource[] = LIVE_SOURCES): LiveSource | undefined {
  const pick = (fill: boolean) => {
    let best: LiveSource | undefined;
    let bestAngle = LIMB_DEG - 4;
    for (const s of sources) {
      if (!!s.fill !== fill) continue;
      const a = viewAngleDeg(lat, lon, s.subLon);
      if (a < bestAngle) [best, bestAngle] = [s, a];
    }
    return best;
  };
  return pick(false) ?? pick(true);
}

/** A lat/lon box for the shader and for requests: west lon, north lat, spans (degrees). */
export interface LiveBox {
  lon0: number;
  lat1: number;
  lonSpan: number;
  latSpan: number;
}

export function discBox(s: LiveSource): LiveBox {
  return { lon0: s.subLon - DISC_HALF_DEG, lat1: DISC_HALF_DEG, lonSpan: 2 * DISC_HALF_DEG, latSpan: 2 * DISC_HALF_DEG };
}

/** One WMS request: its part of the box in degrees and where it goes in the image (px). */
export interface WmsPart {
  lon0: number;
  lon1: number;
  x: number;
  width: number;
}

/**
 * WMS servers won't wrap past ±180°, so a box over the date line is asked for in two parts,
 * drawn side by side. `width` is the whole image's.
 */
export function wmsParts(box: LiveBox, width: number): WmsPart[] {
  const lon0 = ((((box.lon0 + 180) % 360) + 360) % 360) - 180;
  const lon1 = lon0 + box.lonSpan;
  if (lon1 <= 180 + 1e-9) return [{ lon0, lon1: Math.min(lon1, 180), x: 0, width }];
  const w1 = Math.round((width * (180 - lon0)) / box.lonSpan);
  return [
    { lon0, lon1: 180, x: 0, width: w1 },
    { lon0: -180, lon1: lon1 - 360, x: w1, width: width - w1 },
  ];
}

/** GetMap for one part. WMS 1.3.0 in EPSG:4326 orders the box latitude first. */
export function getMapUrl(s: LiveSource, time: string, part: WmsPart, lat0: number, lat1: number, height: number): string {
  const q = new URLSearchParams({
    SERVICE: 'WMS',
    REQUEST: 'GetMap',
    VERSION: '1.3.0',
    LAYERS: s.layer,
    STYLES: '',
    CRS: 'EPSG:4326',
    BBOX: [lat0, part.lon0, lat1, part.lon1].map((v) => +v.toFixed(4)).join(','),
    WIDTH: String(part.width),
    HEIGHT: String(height),
    FORMAT: s.format ?? 'image/jpeg',
    TIME: time,
  });
  return `${s.wms}?${q}`;
}

/** Where to ask for the newest scan's time: a few hundred bytes from GIBS, ~7 KB from EUMETSAT. */
export function timesUrl(s: LiveSource, now: Date): string {
  if (s.times === 'gibs') {
    const iso = (d: Date) => `${d.toISOString().slice(0, 16)}:00Z`;
    const since = new Date(now.getTime() - 3 * 3_600_000);
    return `https://gibs.earthdata.nasa.gov/wmts/epsg4326/best/1.0.0/${s.layer}/default/${s.matrix ?? '1km'}/all/${iso(since)}--${iso(now)}.xml`;
  }
  // GeoServer's per-layer virtual service: the capabilities of just this layer.
  const [ws, name] = s.layer.split(':');
  return `https://view.eumetsat.int/geoserver/${ws}/${name}/ows?service=WMS&request=GetCapabilities&version=1.3.0`;
}

/** Normalise "2026-10-23T00:40:00.000Z" to "2026-10-23T00:40:00Z". */
const tidy = (t: string | undefined) => (t && Number.isFinite(Date.parse(t)) ? `${new Date(t).toISOString().slice(0, 19)}Z` : undefined);

/**
 * The times in an ISO 8601 list of instants and start/end/PTnM intervals, newest first, at
 * most `max` of them. Lists can have gaps (GIBS skips scans it never got), so the intervals
 * are expanded rather than the newest end assumed to be the only one that matters.
 */
export function listTimes(list: string, max = 12): string[] {
  const out = new Set<number>();
  for (const item of list.split(',').map((t) => t.trim()).filter(Boolean)) {
    const [a, b, period] = item.split('/');
    const step = /^PT(\d+)M$/.exec(period ?? '');
    const end = Date.parse(b ?? a);
    if (!Number.isFinite(end)) continue;
    if (!step) {
      out.add(end);
      continue;
    }
    const start = Date.parse(a);
    for (let t = end, n = 0; t >= start && n < max; t -= Number(step[1]) * 60_000, n++) out.add(t);
  }
  return [...out]
    .sort((x, y) => y - x)
    .slice(0, max)
    .map((t) => tidy(new Date(t).toISOString())!);
}

/** GIBS DescribeDomains: `<Domain>start/end/PT10M,…</Domain>`, newest first. */
export function parseGibsDomain(xml: string): string[] {
  const m = /<Domain>([^<]*)<\/Domain>/.exec(xml);
  return m ? listTimes(m[1]) : [];
}

/** GeoServer capabilities: the time dimension, newest first (its default, the newest, leads). */
export function parseWmsTimes(xml: string): string[] {
  const m = /<Dimension\b([^>]*\bname="time"[^>]*)>([^<]*)<\/Dimension>/.exec(xml);
  if (!m) return [];
  const dflt = tidy(/\bdefault="([^"]*)"/.exec(m[1])?.[1]);
  const times = listTimes(m[2]);
  return dflt && !times.includes(dflt) ? [dflt, ...times] : times;
}

/** The newest time in GeoServer capabilities. */
export const parseWmsTime = (xml: string): string | undefined => parseWmsTimes(xml)[0];

/**
 * GIBS's WMS answers with an all-black JPEG, not an error, for a scan it hasn't rendered yet,
 * and it renders them some while after the tiles are published (on 2026-10-23, 00:40Z was
 * listed at 01:20 and still black at 01:40). Real GeoColor is never black: even its night
 * side has a blue-grey ground. So a picture with no pixel above the JPEG's noise is blank.
 */
export function isBlankPixels(rgba: Uint8ClampedArray): boolean {
  for (let i = 0; i < rgba.length; i += 4) if (rgba[i] > 6 || rgba[i + 1] > 6 || rgba[i + 2] > 6) return false;
  return true;
}

function isBlank(bmp: ImageBitmap): boolean {
  const c = new OffscreenCanvas(32, 32);
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(bmp, 0, 0, 32, 32);
  return isBlankPixels(ctx.getImageData(0, 0, 32, 32).data);
}

/**
 * The tiles' grid (as in gibs.ts) for a zoomed-in request: the finest level no finer than a
 * screen pixel or the instruments' ~1 km, then coarser until it fits in 4×4 tiles. Snapping
 * to tiles means a small pan doesn't ask again. Null at globe zoom (the discs serve then).
 */
export function liveRange(box: Box, degPerPx: number, detailBelow: number): TileRange | null {
  if (degPerPx >= detailBelow) return null;
  let level = 2;
  while (level < LIVE_MAX_LEVEL && degPerTexel(level + 1) >= degPerPx * 0.75) level++;
  let r = tileRange(box, level);
  while (tileCount(r) > LIVE_MAX_TILES && level > 2) r = tileRange(box, --level);
  return tileCount(r) <= LIVE_MAX_TILES ? r : null;
}

export interface LiveImage {
  source: LiveSource;
  /** Scan time, ISO. */
  time: string;
  image: OffscreenCanvas;
  box: LiveBox;
}

/** A JPEG from the WMS, or an error when it's not an image or it's blank. */
async function fetchJpeg(url: string, signal?: AbortSignal): Promise<ImageBitmap> {
  const r = await fetch(url, { signal });
  if (!r.ok) throw new Error(`${r.status} ${new URL(url).host}`);
  const blob = await r.blob();
  if (!blob.type.startsWith('image/')) throw new Error(`${new URL(url).host}: ${(await blob.text()).slice(0, 120)}`);
  const bmp = await createImageBitmap(blob);
  if (isBlank(bmp)) {
    bmp.close();
    throw new Error(`${new URL(url).host} sent a blank image`);
  }
  return bmp;
}

/** One satellite's picture of a box, in one or two requests, as one image. */
export async function fetchLive(s: LiveSource, time: string, box: LiveBox, width: number, height: number, signal?: AbortSignal): Promise<LiveImage> {
  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext('2d')!;
  const lat0 = box.lat1 - box.latSpan;
  await Promise.all(
    wmsParts(box, width).map(async (p) => {
      const bmp = await fetchJpeg(getMapUrl(s, time, p, lat0, box.lat1, height), signal);
      ctx.drawImage(bmp, p.x, 0, p.width, height);
      bmp.close();
    }),
  );
  return { source: s, time, image: canvas, box };
}

/** A small picture of the middle of the disc: enough to tell a rendered scan from a blank. */
export function probeUrl(s: LiveSource, time: string): string {
  const [part] = wmsParts({ lon0: s.subLon - 40, lat1: 40, lonSpan: 80, latSpan: 80 }, 64);
  return getMapUrl(s, time, part, -40, 40, 64);
}

/**
 * The newest scan the WMS will actually draw: the listed times, newest first, each tried
 * with a 64 px picture until one isn't blank. `known` (a scan already found drawn) ends the
 * search early, since nothing older is wanted.
 */
export async function fetchServedTime(s: LiveSource, now: Date, known?: string, signal?: AbortSignal): Promise<string> {
  const r = await fetch(timesUrl(s, now), { signal, cache: 'no-cache' });
  if (!r.ok) throw new Error(`${r.status} ${s.name} times`);
  const xml = await r.text();
  const times = s.times === 'gibs' ? parseGibsDomain(xml) : parseWmsTimes(xml);
  if (!times.length) throw new Error(`${s.name}: no scan times listed`);
  if (s.dayOnly) return times[0];
  for (const t of times) {
    if (known && t <= known) return known;
    try {
      (await fetchJpeg(probeUrl(s, t), signal)).close();
      return t;
    } catch {
      // not drawn yet (or a passing fault): try the scan before
    }
  }
  if (known) return known;
  throw new Error(`${s.name}: none of the last ${times.length} scans is served yet`);
}

/** For the zoomed-in request: the box of a tile range, as a LiveBox. */
export function rangeBox(r: TileRange): LiveBox {
  return rangeBounds(r);
}

/** Its size in pixels: 512 per tile, as GIBS's own tiles would be. */
export function rangePixels(r: TileRange): { width: number; height: number } {
  return { width: (r.col1 - r.col0 + 1) * TILE_PX, height: (r.row1 - r.row0 + 1) * TILE_PX };
}

/** "00:10" from an ISO time. */
export const hhmm = (iso: string) => iso.slice(11, 16);

/**
 * Keeps each satellite's disc current, and the zoomed-in picture for the view. `check()` looks
 * for new scans (every LIVE_CHECK_MS); `want()` is called every frame with the view's needs
 * and only starts work when they change and the view has settled.
 */
export class LiveImagery {
  /** Newest scan time per source, and the disc now shown. */
  readonly times = new Map<string, string>();
  readonly discs = new Map<string, { time: string; size: number }>();
  detail: { source: LiveSource; time: string; level: number } | null = null;
  private discSize = DISC_SIZES[0] as number;
  private wantedKey: string | undefined;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private busy = new Set<string>();
  static readonly SETTLE_MS = 400;

  constructor(
    private readonly onDisc: (index: number, img: LiveImage) => void,
    private readonly onDetail: (img: LiveImage | null, level: number) => void,
  ) {}

  /** Look for new scans; fetch each disc that has one. Rejects if every source failed. */
  async check(now = new Date()): Promise<void> {
    const results = await Promise.allSettled(
      LIVE_SOURCES.map(async (s, i) => {
        const time = await fetchServedTime(s, now, this.times.get(s.key));
        this.times.set(s.key, time);
        await this.loadDisc(i, s, time);
      }),
    );
    const failed = results.filter((r) => r.status === 'rejected') as PromiseRejectedResult[];
    if (failed.length === results.length) throw failed[0].reason;
    if (failed.length) console.warn('live imagery:', ...failed.map((f) => f.reason));
  }

  /** The globe has grown on screen: fetch the discs again at the size it now needs (only ever larger). */
  needDiscSize(radiusPx: number) {
    const size = discSize(radiusPx);
    if (size <= this.discSize) return;
    this.discSize = size;
    LIVE_SOURCES.forEach((s, i) => {
      const time = this.times.get(s.key);
      if (time) void this.loadDisc(i, s, time).catch((err) => console.warn('live imagery:', err));
    });
  }

  private async loadDisc(i: number, s: LiveSource, time: string) {
    const size = this.discSize;
    const have = this.discs.get(s.key);
    if (have && have.time === time && have.size >= size) return;
    const key = `disc/${s.key}`;
    if (this.busy.has(key)) return;
    this.busy.add(key);
    try {
      const img = await fetchLive(s, time, discBox(s), size, size);
      this.discs.set(s.key, { time, size });
      this.onDisc(i, img);
    } finally {
      this.busy.delete(key);
    }
  }

  /** The zoomed-in picture this view needs (or none). */
  want(range: TileRange | null, centre: { lat: number; lon: number }) {
    const source = range ? bestSource(centre.lat, centre.lon) : undefined;
    const time = source && this.times.get(source.key);
    const key = range && source && time ? `${source.key}/${time}/${range.level}/${range.col0}-${range.col1}/${range.row0}-${range.row1}` : undefined;
    // A newer scan changes the key too, so the picture follows the scans.
    if (key === this.wantedKey) return;
    this.wantedKey = key;
    clearTimeout(this.timer);
    if (!key || !range || !source || !time) {
      if (this.detail) this.onDetail(null, 0);
      this.detail = null;
      return;
    }
    this.timer = setTimeout(() => void this.loadDetail(key, range, source, time), LiveImagery.SETTLE_MS);
  }

  private async loadDetail(key: string, r: TileRange, s: LiveSource, time: string) {
    try {
      const { width, height } = rangePixels(r);
      const img = await fetchLive(s, time, rangeBox(r), width, height);
      if (this.wantedKey !== key) return; // the view moved on while it loaded
      this.detail = { source: s, time, level: r.level };
      this.onDetail(img, r.level);
    } catch (err) {
      console.warn('live imagery (zoomed in):', err);
    }
  }

  /** Forget the zoomed-in picture (another mode took over). */
  clear() {
    clearTimeout(this.timer);
    this.wantedKey = undefined;
    if (this.detail) this.onDetail(null, 0);
    this.detail = null;
  }
}
