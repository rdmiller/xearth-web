// Real imagery when zoomed in: NASA GIBS daily VIIRS mosaics from NOAA-20, fetched only for
// the part of the globe on screen and only once the view is zoomed past what the Blue and
// Black Marble can show. By day, yesterday's true colour ("corrected reflectance", down to
// 244 m a pixel); by night, the newest night's lights (NASA's Black Marble nightly product,
// cloud-free and moonlight-corrected, down to 488 m), in place of the 2016 Black Marble.
//
// GIBS serves EPSG:4326 tiles — plain latitude/longitude, the same layout as
// the globe's textures — with CORS, so the browser fetches them directly. The
// visible region's tiles are drawn into one canvas, which the globe shader
// samples within its bounds, on the day side, in place of the Blue Marble.
// The mosaic is a photo, clouds and all: where it shows, the live cloud layer
// stands back.
//
// Tile matrices "250m" and "500m" (from GIBS's WMTSCapabilities) share one grid: 512 px tiles
// from the top-left corner (-180°, 90°); level n is 0.5625 / 2^n degrees a pixel, so a tile
// spans 288 / 2^n degrees and the matrix is ceil(360/span) × ceil(180/span). "500m" stops at
// level 7, "250m" at 8.

export const GIBS_BASE = 'https://gibs.earthdata.nasa.gov/wmts/epsg4326/best';

/** A GIBS daily layer to fetch detail from. */
export interface GibsProduct {
  layer: string;
  matrix: '250m' | '500m';
  ext: 'jpg' | 'jpeg' | 'png';
  /** A layer with no dates (a fixed mosaic): its tiles' paths have none. */
  timeless?: boolean;
  /** The finest level its matrix set has. */
  maxLevel: number;
  /** Days back to ask for until GIBS says what its newest is. */
  daysBack: number;
  /** A tile under this many bytes is empty for that day there yet: try the day before (0: never). */
  emptyBytes: number;
}

export const TRUE_COLOR: GibsProduct = {
  layer: 'VIIRS_NOAA20_CorrectedReflectance_TrueColor',
  matrix: '250m',
  ext: 'jpg',
  maxLevel: 8,
  daysBack: 1,
  emptyBytes: 6000,
};

/**
 * Black Marble nightly (VNP46A2-style, from NOAA-20): moonlight- and atmosphere-corrected,
 * cloudy pixels filled from the last clear night. A one-band greyscale palette PNG,
 * transparent where there's no data (polar day). GIBS has it a day or two after the night.
 */
export const NIGHT_LIGHTS: GibsProduct = {
  layer: 'VIIRS_NOAA20_GapFilled_BRDF_Corrected_DayNightBand_Radiance',
  matrix: '500m',
  ext: 'png',
  maxLevel: 7,
  daysBack: 2,
  // Empty means no data at all there (sunlit), not "not yet": no point trying earlier days.
  emptyBytes: 0,
};

/**
 * NASA's Blue Marble Next Generation (MODIS, 500 m): the globe's own base map, ~15× sharper,
 * for the ISS camera's ground. Cloud-free and dateless, so the cloud layers still go on top.
 */
export const BLUE_MARBLE: GibsProduct = {
  layer: 'BlueMarble_NextGeneration',
  matrix: '500m',
  ext: 'jpeg',
  timeless: true,
  maxLevel: 7,
  daysBack: 0,
  emptyBytes: 0,
};

/** GIBS DescribeDomains for a daily layer over the last ten days. */
export function domainUrl(p: GibsProduct, now: Date): string {
  const day = (d: Date) => d.toISOString().slice(0, 10);
  return `${GIBS_BASE}/1.0.0/${p.layer}/default/${p.matrix}/all/${day(new Date(now.getTime() - 10 * 86_400_000))}--${day(now)}.xml`;
}

/** The newest date in `<Domain>start/end/P1D,…</Domain>`. */
export function newestDate(xml: string): string | undefined {
  const last = /<Domain>([^<]*)<\/Domain>/.exec(xml)?.[1].split(',').pop()?.trim().split('/');
  const d = last && (last.length === 3 ? last[1] : last[0]);
  return d && /^\d{4}-\d{2}-\d{2}/.test(d) ? d.slice(0, 10) : undefined;
}
export const TILE_PX = 512;
export const MIN_LEVEL = 3;
export const MAX_LEVEL = 8;
/** Show detail once a screen pixel covers less than this (the Blue Marble is 0.067°/px). */
export const DETAIL_BELOW_DEG_PER_PX = 0.09;
/** At most this many tiles in one view (~48 × 70 KB: a 1920 px screen at the 50× maximum zoom needs 42 at 244 m); coarser levels fit the rest. */
export const MAX_TILES = 48;

export const degPerTexel = (level: number) => 0.5625 / 2 ** level;
export const tileSpanDeg = (level: number) => 288 / 2 ** level;
export const matrixSize = (level: number) => ({
  cols: Math.ceil(360 / tileSpanDeg(level)),
  rows: Math.ceil(180 / tileSpanDeg(level)),
});

/** A lat/lon box. lon0 < lon1 always; lon1 may pass 180 when the box crosses the date line. */
export interface Box {
  lat0: number;
  lat1: number;
  lon0: number;
  lon1: number;
}

/**
 * The box around what's on screen: everything within `radiusDeg` of the view centre. A
 * box touching a pole spans all longitudes.
 */
export function visibleBox(lat: number, lon: number, radiusDeg: number): Box {
  const lat0 = Math.max(-90, lat - radiusDeg);
  const lat1 = Math.min(90, lat + radiusDeg);
  if (lat0 <= -89.9 || lat1 >= 89.9) return { lat0, lat1, lon0: -180, lon1: 180 };
  const widest = Math.max(Math.abs(lat0), Math.abs(lat1));
  const half = Math.min(180, radiusDeg / Math.cos((widest * Math.PI) / 180));
  return { lat0, lat1, lon0: lon - half, lon1: lon + half };
}

export interface TileRange {
  level: number;
  /** Columns may run past the matrix (wrapping round the date line); rows don't. */
  col0: number;
  col1: number;
  row0: number;
  row1: number;
}

export function tileRange(box: Box, level: number): TileRange {
  const span = tileSpanDeg(level);
  const { cols, rows } = matrixSize(level);
  const lonSpan = Math.min(360, box.lon1 - box.lon0);
  let col0 = Math.floor((box.lon0 + 180) / span);
  let col1 = Math.floor((box.lon0 + lonSpan + 180 - 1e-9) / span);
  if (lonSpan >= 360) [col0, col1] = [0, cols - 1];
  return {
    level,
    col0,
    col1: Math.min(col1, col0 + cols - 1),
    row0: Math.max(0, Math.floor((90 - box.lat1) / span)),
    row1: Math.min(rows - 1, Math.floor((90 - box.lat0 - 1e-9) / span)),
  };
}

export const tileCount = (r: TileRange) => (r.col1 - r.col0 + 1) * (r.row1 - r.row0 + 1);

/**
 * The finest level that's still no finer than a screen pixel, then coarser until the
 * visible box needs at most MAX_TILES. Null when zoomed out past where detail helps.
 */
export function chooseRange(box: Box, degPerPx: number, maxLevel = MAX_LEVEL): TileRange | null {
  if (degPerPx >= DETAIL_BELOW_DEG_PER_PX) return null;
  let level = MIN_LEVEL;
  while (level < maxLevel && degPerTexel(level + 1) >= degPerPx * 0.75) level++;
  let r = tileRange(box, level);
  while (tileCount(r) > MAX_TILES && level > MIN_LEVEL) r = tileRange(box, --level);
  return tileCount(r) <= MAX_TILES ? r : null;
}

/** The range's bounds in degrees: west/north corner and size. */
export function rangeBounds(r: TileRange): { lon0: number; lat1: number; lonSpan: number; latSpan: number } {
  const span = tileSpanDeg(r.level);
  return {
    lon0: -180 + r.col0 * span,
    lat1: 90 - r.row0 * span,
    lonSpan: (r.col1 - r.col0 + 1) * span,
    latSpan: (r.row1 - r.row0 + 1) * span,
  };
}

export const rangeKey = (r: TileRange, date: string) => `${date}/${r.level}/${r.col0}-${r.col1}/${r.row0}-${r.row1}`;

export function tileUrl(date: string, level: number, row: number, col: number, p: GibsProduct = TRUE_COLOR): string {
  const { cols } = matrixSize(level);
  const c = ((col % cols) + cols) % cols;
  const day = p.timeless ? '' : `${date}/`;
  return `${GIBS_BASE}/${p.layer}/default/${day}${p.matrix}/${level}/${row}/${c}.${p.ext}`;
}

/** Yesterday (UTC): the newest day whose mosaic is complete everywhere. */
export function mosaicDate(now: Date, daysBack = 1): string {
  return new Date(now.getTime() - daysBack * 86_400_000).toISOString().slice(0, 10);
}

export interface Detail {
  image: OffscreenCanvas;
  bounds: ReturnType<typeof rangeBounds>;
  date: string;
  level: number;
}

/**
 * Keeps one assembled detail image for the current view. `want()` is called every frame;
 * it only starts work when the needed tile range changes, and only once the view has
 * settled (no new range for SETTLE_MS), so a drag or a glide doesn't fetch tiles for
 * every place it passes over.
 */
export class GibsDetail {
  private readonly tiles = new Map<string, Promise<ImageBitmap | null>>();
  private wanted: string | undefined;
  private shown: string | undefined;
  private timer: ReturnType<typeof setTimeout> | undefined;
  /** GIBS's newest date for the product, and when that was last asked. */
  private newest: string | undefined;
  private newestAt = 0;
  static readonly SETTLE_MS = 400;
  static readonly CACHE_TILES = 160;
  static readonly NEWEST_EVERY_MS = 6 * 3_600_000;

  constructor(
    private readonly onReady: (d: Detail | null) => void,
    readonly product: GibsProduct = TRUE_COLOR,
  ) {}

  /** The date to show: GIBS's newest once known (asked every few hours), else `daysBack`. */
  private dateFor(now: Date): string {
    if (this.product.timeless) return 'fixed';
    if (Date.now() - this.newestAt > GibsDetail.NEWEST_EVERY_MS) {
      this.newestAt = Date.now();
      void fetch(domainUrl(this.product, now))
        .then((r) => (r.ok ? r.text() : ''))
        .then((xml) => (this.newest = newestDate(xml) ?? this.newest))
        .catch(() => undefined);
    }
    return this.newest ?? mosaicDate(now, this.product.daysBack);
  }

  want(range: TileRange | null, now: Date) {
    const date = this.dateFor(now);
    const key = range ? rangeKey(range, date) : undefined;
    if (key === this.wanted) return;
    this.wanted = key;
    clearTimeout(this.timer);
    if (!range || !key) {
      if (this.shown) this.onReady(null);
      this.shown = undefined;
      return;
    }
    this.timer = setTimeout(() => void this.assemble(range, date, key), GibsDetail.SETTLE_MS);
  }

  private async tile(date: string, level: number, row: number, col: number): Promise<ImageBitmap | null> {
    const url = tileUrl(date, level, row, col, this.product);
    let p = this.tiles.get(url);
    if (!p) {
      p = (async () => {
        const r = await fetch(url);
        if (!r.ok) return null;
        const blob = await r.blob();
        // An empty day there: try the day before.
        if (blob.size < this.product.emptyBytes) {
          const earlier = mosaicDate(new Date(`${date}T12:00:00Z`), 1);
          return earlier < mosaicDate(new Date(), 3) ? null : this.tile(earlier, level, row, col);
        }
        return createImageBitmap(blob);
      })().catch(() => null);
      this.tiles.set(url, p);
      while (this.tiles.size > GibsDetail.CACHE_TILES) this.tiles.delete(this.tiles.keys().next().value!);
    }
    return p;
  }

  private async assemble(r: TileRange, date: string, key: string) {
    const cols = r.col1 - r.col0 + 1;
    const rows = r.row1 - r.row0 + 1;
    const canvas = new OffscreenCanvas(cols * TILE_PX, rows * TILE_PX);
    const ctx = canvas.getContext('2d')!;
    const jobs: Promise<void>[] = [];
    for (let row = r.row0; row <= r.row1; row++) {
      for (let col = r.col0; col <= r.col1; col++) {
        jobs.push(
          this.tile(date, r.level, row, col).then((bmp) => {
            if (bmp) ctx.drawImage(bmp, (col - r.col0) * TILE_PX, (row - r.row0) * TILE_PX);
          }),
        );
      }
    }
    await Promise.all(jobs);
    if (this.wanted !== key) return; // the view moved on while these loaded
    this.shown = key;
    this.onReady({ image: canvas, bounds: rangeBounds(r), date, level: r.level });
  }
}
