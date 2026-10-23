// Live clouds over Asia and the west Pacific from Himawari-9 (140.7°E), which has no colour
// product on GIBS or EUMETView, only single bands. The hourly cloud map (pipeline/xearth_clouds/
// convert.py) turns GMGSI's infrared and visible mosaics into cloud opacity; this is the same
// recipe, ported, run in the browser on Himawari's own bands every 10 minutes:
//
// - infrared (Band 13, 10.4 µm): GIBS colours it, so each colour is read back to a brightness
//   temperature, mapped to the grey level GMGSI would give it, and put through convert.py's
//   to_alpha (cloud is what's colder than the local clear sky);
// - visible (Band 3, 0.64 µm) by day: mapped to GMGSI's visible grey and put through vis_alpha
//   (cloud is what's brighter than clear ground of the same Blue Marble brightness under the
//   same Sun, in this scene), for the low cloud infrared misses. Over Himawari's region at
//   03Z on 2026-10-23 that was half the cloud: 0.18 mean opacity from infrared alone, 0.36
//   with the visible band.
//
// Both grey mappings are medians measured against GMGSI over the same ground and hour
// (Band 13: 1.7M pixels, 2026-10-21 18Z; Band 3: 2026-10-23 03Z). With them, Himawari's cloud
// matched the pipeline's map at 0.79 correlation by night and 0.85 by day (mean opacity 0.19
// vs 0.20, and 0.37 vs 0.35), and it's refreshed every 10 minutes rather than hourly.

/** Himawari-9's sub-satellite longitude. */
export const HIMAWARI_SUB_LON = 140.7;

/**
 * GIBS's colour map for Himawari Band 13 (Clean_Longwave_Infrared_Window_Band.xml, v1.3,
 * fetched 2026-10-23): r, g, b, then the middle of its brightness-temperature bin, °C. It has
 * two grey ramps that overlap (−80…−70 °C runs 230→5, and −19…+57 °C runs 197→1), told apart
 * only by a level or so, which is why Band 13 must come as PNG: JPEG's noise mixes them up.
 */
const B13_COLOURS = [
  255,255,255,-91.6, 127,0,127,-90.6, 140,13,135,-89.6, 153,25,142,-88.6, 165,38,150,-87.6,
  178,51,157,-86.6, 191,64,165,-85.6, 204,76,173,-84.6, 217,89,180,-83.6, 229,102,188,-82.6,
  242,114,195,-81.6, 255,127,203,-80.6, 230,230,230,-79.6, 204,204,204,-78.6, 177,177,177,-77.6,
  155,155,155,-76.6, 129,129,129,-75.6, 102,102,102,-74.6, 76,76,76,-73.6, 54,54,54,-72.6,
  27,27,27,-71.6, 5,5,5,-70.6, 26,0,0,-69.6, 51,0,0,-68.6, 77,0,0,-67.6, 102,0,0,-66.6,
  128,0,0,-65.6, 153,0,0,-64.6, 179,0,0,-63.6, 204,0,0,-62.6, 230,0,0,-61.6, 255,0,0,-60.6,
  255,26,0,-59.6, 255,51,0,-58.6, 255,77,0,-57.6, 255,102,0,-56.6, 255,128,0,-55.6,
  255,153,0,-54.6, 255,179,0,-53.6, 255,204,0,-52.6, 255,230,0,-51.6, 255,255,0,-50.6,
  230,255,0,-49.6, 204,255,0,-48.6, 179,255,0,-47.6, 153,255,0,-46.6, 128,255,0,-45.6,
  102,255,0,-44.6, 77,255,0,-43.6, 51,255,0,-42.6, 26,255,0,-41.6, 0,255,0,-40.6, 0,234,10,-39.6,
  0,212,19,-38.6, 0,191,29,-37.6, 0,170,38,-36.6, 0,149,48,-35.6, 0,128,58,-34.6, 0,106,67,-33.6,
  0,85,77,-32.6, 0,64,86,-31.6, 0,42,96,-30.85, 0,21,105,-30.35, 0,0,115,-29.85, 0,0,125,-29.35,
  0,13,122,-28.85, 0,26,129,-28.35, 0,38,136,-27.85, 0,51,143,-27.35, 0,64,150,-26.85,
  0,76,157,-26.35, 0,89,164,-25.85, 0,102,171,-25.35, 0,115,178,-24.85, 0,128,185,-24.35,
  0,140,192,-23.85, 0,153,199,-23.35, 0,166,206,-22.85, 0,178,213,-22.35, 0,191,220,-21.85,
  0,204,227,-21.35, 0,217,234,-20.85, 0,230,241,-20.35, 0,242,248,-19.85, 0,255,255,-19.35,
  197,197,197,-18.85, 196,196,196,-18.35, 194,194,194,-17.85, 193,193,193,-17.35,
  192,192,192,-16.85, 191,191,191,-16.35, 189,189,189,-15.85, 188,188,188,-15.35,
  187,187,187,-14.85, 185,185,185,-14.35, 184,184,184,-13.85, 183,183,183,-13.35,
  181,181,181,-12.85, 180,180,180,-12.35, 179,179,179,-11.85, 178,178,178,-11.35,
  176,176,176,-10.85, 175,175,175,-10.35, 174,174,174,-9.85, 172,172,172,-9.35, 171,171,171,-8.85,
  170,170,170,-8.35, 169,169,169,-7.85, 167,167,167,-7.35, 166,166,166,-6.85, 165,165,165,-6.35,
  163,163,163,-5.85, 162,162,162,-5.35, 161,161,161,-4.85, 159,159,159,-4.35, 158,158,158,-3.85,
  157,157,157,-3.35, 156,156,156,-2.85, 154,154,154,-2.35, 153,153,153,-1.85, 152,152,152,-1.35,
  150,150,150,-0.85, 149,149,149,-0.35, 148,148,148,0.15, 147,147,147,0.65, 145,145,145,1.15,
  144,144,144,1.65, 143,143,143,2.15, 141,141,141,2.65, 140,140,140,3.15, 139,139,139,3.65,
  138,138,138,4.15, 136,136,136,4.65, 135,135,135,5.15, 134,134,134,5.65, 132,132,132,6.15,
  131,131,131,6.65, 130,130,130,7.15, 128,128,128,7.65, 127,127,127,8.15, 126,126,126,8.65,
  125,125,125,9.15, 123,123,123,9.65, 122,122,122,10.15, 121,121,121,10.65, 119,119,119,11.15,
  118,118,118,11.65, 117,117,117,12.15, 116,116,116,12.65, 114,114,114,13.15, 113,113,113,13.65,
  112,112,112,14.15, 110,110,110,14.65, 109,109,109,15.15, 108,108,108,15.65, 106,106,106,16.15,
  105,105,105,16.65, 104,104,104,17.15, 103,103,103,17.65, 101,101,101,18.15, 100,100,100,18.65,
  99,99,99,19.15, 97,97,97,19.65, 96,96,96,20.15, 95,95,95,20.65, 94,94,94,21.15, 92,92,92,21.65,
  91,91,91,22.15, 90,90,90,22.65, 88,88,88,23.15, 87,87,87,23.65, 86,86,86,24.15, 84,84,84,24.65,
  83,83,83,25.15, 82,82,82,25.65, 81,81,81,26.15, 79,79,79,26.65, 78,78,78,27.15, 77,77,77,27.65,
  75,75,75,28.15, 74,74,74,28.65, 73,73,73,29.15, 72,72,72,29.65, 70,70,70,30.15, 69,69,69,30.65,
  68,68,68,31.15, 66,66,66,31.65, 65,65,65,32.15, 64,64,64,32.65, 62,62,62,33.15, 61,61,61,33.65,
  60,60,60,34.15, 59,59,59,34.65, 57,57,57,35.15, 56,56,56,35.65, 55,55,55,36.15, 53,53,53,36.65,
  52,52,52,37.15, 51,51,51,37.65, 50,50,50,38.15, 48,48,48,38.65, 47,47,47,39.15, 46,46,46,39.65,
  44,44,44,40.15, 43,43,43,40.65, 42,42,42,41.15, 41,41,41,41.65, 39,39,39,42.15, 38,38,38,42.65,
  37,37,37,43.15, 35,35,35,43.65, 34,34,34,44.15, 33,33,33,44.65, 31,31,31,45.15, 30,30,30,45.65,
  29,29,29,46.15, 28,28,28,46.65, 26,26,26,47.15, 25,25,25,47.65, 24,24,24,48.15, 22,22,22,48.65,
  21,21,21,49.15, 20,20,20,49.65, 19,19,19,50.15, 17,17,17,50.65, 16,16,16,51.15, 15,15,15,51.65,
  13,13,13,52.15, 12,12,12,52.65, 11,11,11,53.15, 9,9,9,53.65, 8,8,8,54.15, 7,7,7,54.65,
  6,6,6,55.15, 4,4,4,55.65, 3,3,3,56.15, 2,2,2,56.65, 1,1,1,57.15,
];

const B13_N = B13_COLOURS.length / 4;
const exact = new Map<number, number>();
for (let i = 0; i < B13_N; i++) exact.set((B13_COLOURS[i * 4] << 16) | (B13_COLOURS[i * 4 + 1] << 8) | B13_COLOURS[i * 4 + 2], B13_COLOURS[i * 4 + 3]);

/**
 * Band 13 temperature (°C) for a colour. GIBS blends colours where it resamples (~30% of
 * pixels aren't a colour-map colour), so those take the nearest entry; validated against
 * GMGSI with the blends included.
 */
export function b13Temperature(r: number, g: number, b: number): number {
  const key = (r << 16) | (g << 8) | b;
  let t = exact.get(key);
  if (t === undefined) {
    let best = Infinity;
    t = NaN;
    for (let i = 0; i < B13_N; i++) {
      const d = (r - B13_COLOURS[i * 4]) ** 2 + (g - B13_COLOURS[i * 4 + 1]) ** 2 + (b - B13_COLOURS[i * 4 + 2]) ** 2;
      if (d < best) [best, t] = [d, B13_COLOURS[i * 4 + 3]];
    }
    exact.set(key, t);
  }
  return t;
}

/** Band 13 temperature → GMGSI longwave grey (higher = colder): medians, 2026-10-21 18Z. */
export const IR_KNOTS: readonly (readonly [number, number])[] = [
  [-78, 219], [-68, 219], [-66, 218], [-64, 216], [-62, 214], [-60, 213], [-58, 211], [-56, 210],
  [-54, 208], [-52, 206], [-50, 205], [-48, 203], [-46, 202], [-44, 200], [-42, 198], [-40, 197],
  [-38, 196], [-36, 194], [-34, 193], [-32, 191], [-30, 189], [-28, 186], [-26, 183], [-24, 180],
  [-22, 176], [-20, 172], [-18, 165], [-16, 161], [-14, 155], [-12, 150], [-10, 143], [-8, 138],
  [-6, 132], [-4, 127], [-2, 122], [0, 116], [2, 111], [4, 106], [6, 101], [8, 96], [10, 91],
  [12, 86], [14, 81], [16, 76], [18, 72], [20, 68], [22, 64],
];

/** Band 3 grey → GMGSI visible grey: medians, 2026-10-23 03Z. */
export const VIS_KNOTS: readonly (readonly [number, number])[] = [
  [8, 46], [12, 54], [16, 62], [20, 69], [24, 76], [28, 83], [32, 89], [36, 94], [40, 99],
  [44, 104], [48, 109], [52, 113], [56, 118], [60, 122], [64, 126], [68, 129], [72, 133],
  [76, 137], [80, 141], [84, 144], [88, 148], [92, 151], [96, 155], [100, 158], [104, 161],
  [108, 164], [112, 167], [116, 170], [120, 173], [124, 175], [128, 178], [132, 181], [136, 184],
  [140, 186], [144, 189], [148, 192], [152, 194], [156, 196], [160, 199], [164, 202], [168, 204],
  [172, 206], [176, 209], [180, 212], [184, 214], [188, 215], [192, 217], [196, 219], [200, 221],
  [204, 225], [208, 227],
];

/** np.interp: piecewise linear through the knots, held flat past either end. */
export function interpKnots(x: number, knots: readonly (readonly [number, number])[]): number {
  if (x <= knots[0][0]) return knots[0][1];
  for (let i = 1; i < knots.length; i++) {
    const [x1, y1] = knots[i];
    if (x <= x1) {
      const [x0, y0] = knots[i - 1];
      return y0 + ((y1 - y0) * (x - x0)) / (x1 - x0);
    }
  }
  return knots[knots.length - 1][1];
}

/** Band 13 RGBA → GMGSI-equivalent infrared grey; NaN where transparent (no data). */
export function infraredGrey(rgba: Uint8ClampedArray, n: number): Float32Array {
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const o = i * 4;
    out[i] = rgba[o + 3] < 128 ? NaN : interpKnots(b13Temperature(rgba[o], rgba[o + 1], rgba[o + 2]), IR_KNOTS);
  }
  return out;
}

/** Band 3 RGBA (grey) → GMGSI-equivalent visible grey; NaN where GIBS draws no data (black). */
export function visibleGrey(rgba: Uint8ClampedArray, n: number): Float32Array {
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const v = rgba[i * 4];
    out[i] = rgba[i * 4 + 3] < 128 || v < 2 ? NaN : interpKnots(v, VIS_KNOTS);
  }
  return out;
}

// ---- convert.py, ported: infrared ---------------------------------------------------------

/** numpy's default ("linear") percentile of the finite values, NaN if there are none. */
export function percentile(values: ArrayLike<number>, q: number): number {
  const a: number[] = [];
  for (let i = 0; i < values.length; i++) if (Number.isFinite(values[i])) a.push(values[i]);
  if (!a.length) return NaN;
  a.sort((x, y) => x - y);
  const pos = (q / 100) * (a.length - 1);
  const lo = Math.floor(pos);
  return lo + 1 < a.length ? a[lo] + (a[lo + 1] - a[lo]) * (pos - lo) : a[lo];
}

/** _smooth_1d: a box filter `width` wide, edges extended (or wrapped). */
export function smooth1d(a: Float64Array, width: number, wrap = false): Float64Array {
  if (width <= 1) return a;
  const n = a.length;
  const half = Math.floor(width / 2);
  const out = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    let s = 0;
    for (let k = -half; k < width - half; k++) {
      const j = i + k;
      s += wrap ? a[((j % n) + n) % n] : a[Math.min(n - 1, Math.max(0, j))];
    }
    out[i] = s / width;
  }
  return out;
}

/** row_baseline: each row's clear-sky grey (5th percentile), smoothed across ~2° of latitude. */
export function rowBaseline(grey: Float32Array, w: number, h: number): Float64Array {
  const base = new Float64Array(h);
  for (let y = 0; y < h; y++) base[y] = percentile(grey.subarray(y * w, (y + 1) * w), 5);
  const finite = Array.from(base).filter(Number.isFinite);
  const fill = finite.length ? percentile(finite, 50) : 0;
  for (let y = 0; y < h; y++) if (!Number.isFinite(base[y])) base[y] = fill;
  return smooth1d(base, Math.max(1, Math.floor(h / 75)) | 1);
}

/** np.interp at x over xp = 0, 1, … n−1 (clamped). */
function interpIndex(fp: ArrayLike<number>, x: number): number {
  const n = fp.length;
  if (x <= 0) return fp[0];
  if (x >= n - 1) return fp[n - 1];
  const i = Math.floor(x);
  return fp[i] + (fp[i + 1] - fp[i]) * (x - i);
}

/** _upsample_linear: block-centre values to every pixel, separably, x optionally wrapping. */
function upsample(grid: Float64Array, gh: number, gw: number, w: number, h: number, wrapX: boolean): Float32Array {
  const cols = new Float64Array(h * gw);
  const col = new Float64Array(gh);
  for (let j = 0; j < gw; j++) {
    for (let i = 0; i < gh; i++) col[i] = grid[i * gw + j];
    for (let y = 0; y < h; y++) cols[y * gw + j] = interpIndex(col, ((y + 0.5) * gh) / h - 0.5);
  }
  const out = new Float32Array(w * h);
  const ext = new Float64Array(gw + 2);
  for (let y = 0; y < h; y++) {
    const row = cols.subarray(y * gw, (y + 1) * gw);
    for (let x = 0; x < w; x++) {
      const t = ((x + 0.5) * gw) / w - 0.5;
      if (!wrapX) out[y * w + x] = interpIndex(row, t);
      else {
        ext[0] = row[gw - 1];
        ext.set(row, 1);
        ext[gw + 1] = row[0];
        out[y * w + x] = interpIndex(ext, t + 1);
      }
    }
  }
  return out;
}

export interface BlockOptions {
  /** Blocks down and across: convert.py uses 50 × 24 on GMGSI's global grid, ~3° × 15°. */
  blockRows: number;
  blockCols: number;
  /** Longitude wraps (a global grid); a disc doesn't. */
  wrapX: boolean;
}

export const BLOCK_LIFT = 25;

/** clear_sky_baseline: a local clear-sky grey for every pixel (see convert.py's docstring). */
export function clearSkyBaseline(grey: Float32Array, w: number, h: number, o: BlockOptions): Float32Array {
  const gh = Math.min(o.blockRows, h);
  const gw = Math.min(o.blockCols, w);
  const row = rowBaseline(grey, w, h);
  // np.linspace(0, n, k + 1).astype(int): steps of n / k, the last exactly n.
  const edges = (n: number, k: number) => Array.from({ length: k + 1 }, (_, i) => (i === k ? n : Math.trunc(i * (n / k))));
  const ry = edges(h, gh);
  const rx = edges(w, gw);
  const block = new Float64Array(gh * gw);
  for (let i = 0; i < gh; i++) {
    let floor = 0;
    for (let y = ry[i]; y < ry[i + 1]; y++) floor += row[y];
    floor /= ry[i + 1] - ry[i];
    for (let j = 0; j < gw; j++) {
      const vals: number[] = [];
      for (let y = ry[i]; y < ry[i + 1]; y++) for (let x = rx[j]; x < rx[j + 1]; x++) vals.push(grey[y * w + x]);
      const p = percentile(vals, 10);
      block[i * gw + j] = Math.min(floor + BLOCK_LIFT, Math.max(floor, Number.isFinite(p) ? p : floor));
    }
  }
  // 3×3 box smoothing, rows edge-extended, columns wrapped (or edge-extended for a disc).
  const smooth = new Float64Array(gh * gw);
  for (let i = 0; i < gh; i++) {
    for (let j = 0; j < gw; j++) {
      let s = 0;
      for (let dy = -1; dy <= 1; dy++) {
        const ii = Math.min(gh - 1, Math.max(0, i + dy));
        for (let dx = -1; dx <= 1; dx++) {
          const jj = o.wrapX ? (j + dx + gw) % gw : Math.min(gw - 1, Math.max(0, j + dx));
          s += block[ii * gw + jj];
        }
      }
      smooth[i * gw + j] = s / 9;
    }
  }
  return upsample(smooth, gh, gw, w, h, o.wrapX);
}

/**
 * to_alpha: cloud opacity 0…1 from infrared grey (higher = colder). Past `offset` above the
 * local clear sky it ramps to opaque over `span`; very cold tops are opaque whatever the
 * baseline. NaN (no data) stays NaN.
 */
export function toAlpha(grey: Float32Array, w: number, h: number, o: BlockOptions): Float32Array {
  const base = clearSkyBaseline(grey, w, h, o);
  const out = new Float32Array(w * h);
  for (let i = 0; i < out.length; i++) {
    const g = grey[i];
    const rel = Math.min(1, Math.max(0, (g - base[i] - 14) / 75)) ** 0.9;
    const cold = Math.min(1, Math.max(0, (g - 180) / 45));
    out[i] = Number.isFinite(g) ? Math.max(rel, cold) : NaN;
  }
  return out;
}

// ---- convert.py, ported: visible ----------------------------------------------------------

const VIS_OFFSET = 14;
const VIS_SPAN = 70;
const DARK_SURFACE = [0.22, 0.32];
const GEO_RADIUS = 6.61;
const L_BINS = 16;
const MU_BINS = 12;
const MU_MIN = 0.08;
const RAD = Math.PI / 180;

/** subsolar: the subsolar latitude and longitude (degrees) at Unix time `t` (s), NOAA's approximation. */
export function subsolar(t: number): [number, number] {
  const d = new Date(t * 1000);
  const y = d.getUTCFullYear();
  const yearDays = y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0) ? 366 : 365;
  const yday = Math.floor((Date.UTC(y, d.getUTCMonth(), d.getUTCDate()) - Date.UTC(y, 0, 1)) / 86_400_000) + 1;
  const hours = d.getUTCHours() + d.getUTCMinutes() / 60 + d.getUTCSeconds() / 3600;
  const g = ((2 * Math.PI) / yearDays) * (yday - 1 + (hours - 12) / 24);
  const eqtime = 229.18 * (0.000075 + 0.001868 * Math.cos(g) - 0.032077 * Math.sin(g) - 0.014615 * Math.cos(2 * g) - 0.040849 * Math.sin(2 * g));
  const decl =
    0.006918 - 0.399912 * Math.cos(g) + 0.070257 * Math.sin(g) - 0.006758 * Math.cos(2 * g) + 0.000907 * Math.sin(2 * g) - 0.002697 * Math.cos(3 * g) + 0.00148 * Math.sin(3 * g);
  const lon = -15 * (hours - 12) - eqtime / 4;
  return [decl / RAD, ((((lon + 180) % 360) + 360) % 360) - 180];
}

const unit = (latDeg: number, lonDeg: number): [number, number, number] => {
  const la = latDeg * RAD;
  const lo = lonDeg * RAD;
  return [Math.cos(la) * Math.cos(lo), Math.cos(la) * Math.sin(lo), Math.sin(la)];
};

/** A lat/lon grid: the latitude of each row, the longitude of each column, the scan time (s). */
export interface Grid {
  lat: ArrayLike<number>;
  lon: ArrayLike<number>;
  time: number;
}

/** glint_cos: cos of the angle between the Sun and the mirror reflection of the satellite's view. */
function glintCos(lat: number, lon: number, satLon: number, sun: [number, number, number]): number {
  const n = unit(lat, lon);
  const s = unit(0, satLon);
  let v = [GEO_RADIUS * s[0] - n[0], GEO_RADIUS * s[1] - n[1], GEO_RADIUS * s[2] - n[2]];
  const len = Math.hypot(v[0], v[1], v[2]);
  v = v.map((c) => c / len);
  const nv = n[0] * v[0] + n[1] * v[1] + n[2] * v[2];
  const r = [2 * nv * n[0] - v[0], 2 * nv * n[1] - v[1], 2 * nv * n[2] - v[2]];
  return r[0] * sun[0] + r[1] * sun[1] + r[2] * sun[2];
}

const smoothstep01 = (x: number) => x * x * (3 - 2 * x);
const clamp01 = (x: number) => Math.min(1, Math.max(0, x));

/**
 * vis_alpha, for one satellite: cloud opacity from visible grey, given the infrared opacity
 * (its clear pixels set the scene's clear-sky brightness) and the Blue Marble's luminance `L`
 * (0–1) at each pixel. 0 where dark, glinting, over bright ground, or no data.
 */
export function visAlpha(vis: Float32Array, irAlpha: Float32Array, L: Float32Array, w: number, h: number, grid: Grid, satLon: number): Float32Array {
  const [sLat, sLon] = subsolar(grid.time);
  const sun = unit(sLat, sLon);
  const sinS = Math.sin(sLat * RAD);
  const cosS = Math.cos(sLat * RAD);
  const mu = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    const la = grid.lat[y] * RAD;
    for (let x = 0; x < w; x++) mu[y * w + x] = Math.sin(la) * sinS + Math.cos(la) * cosS * Math.cos((grid.lon[x] - sLon) * RAD);
  }
  const lBin = (l: number) => Math.min(L_BINS - 1, Math.max(0, Math.trunc(l * L_BINS)));
  const muBin = (m: number) => Math.min(MU_BINS - 1, Math.max(0, Math.trunc(((m - MU_MIN) / (1 - MU_MIN)) * MU_BINS)));

  // clear_sky_table: the 20th-percentile visible grey among infrared-clear pixels (every 4th
  // row and column), per surface brightness × Sun height; gaps filled across the Sun bins, then
  // with the median of the rest.
  const bins: number[][] = Array.from({ length: L_BINS * MU_BINS }, () => []);
  for (let y = 0; y < h; y += 4) {
    for (let x = 0; x < w; x += 4) {
      const i = y * w + x;
      const ir = Number.isFinite(irAlpha[i]) ? irAlpha[i] : 1;
      if (ir < 0.05 && Number.isFinite(vis[i]) && mu[i] > MU_MIN) bins[lBin(L[i]) * MU_BINS + muBin(mu[i])].push(vis[i]);
    }
  }
  const table = new Float64Array(L_BINS * MU_BINS).fill(NaN);
  bins.forEach((b, k) => {
    if (b.length >= 200) table[k] = percentile(b, 20);
  });
  for (let a = 0; a < L_BINS; a++) {
    const row = table.subarray(a * MU_BINS, (a + 1) * MU_BINS);
    const idx = [...row.keys()].filter((k) => Number.isFinite(row[k]));
    if (!idx.length) continue;
    const vals = idx.map((k) => row[k]);
    for (let b = 0; b < MU_BINS; b++) {
      if (b <= idx[0]) row[b] = vals[0];
      else if (b >= idx[idx.length - 1]) row[b] = vals[vals.length - 1];
      else {
        const k = idx.findIndex((v) => v >= b);
        row[b] = vals[k - 1] + ((vals[k] - vals[k - 1]) * (b - idx[k - 1])) / (idx[k] - idx[k - 1]);
      }
    }
  }
  const median = percentile(table, 50);
  for (let k = 0; k < table.length; k++) if (!Number.isFinite(table[k])) table[k] = Number.isFinite(median) ? median : 60;

  const cos30 = Math.cos(30 * RAD);
  const cos12 = Math.cos(12 * RAD);
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const l = L[i];
      const clear = table[lBin(l) * MU_BINS + muBin(mu[i])];
      const a = clamp01((vis[i] - clear - VIS_OFFSET) / VIS_SPAN) ** 0.9;
      const sunF = smoothstep01(clamp01((mu[i] - MU_MIN) / (0.3 - MU_MIN)));
      let glint = 1;
      if (l < 0.18) glint = 1 - smoothstep01(clamp01((glintCos(grid.lat[y], grid.lon[x], satLon, sun) - cos30) / (cos12 - cos30)));
      const dark = 1 - smoothstep01(clamp01((l - DARK_SURFACE[0]) / (DARK_SURFACE[1] - DARK_SURFACE[0])));
      const v = a * sunF * glint * dark;
      out[i] = Number.isFinite(v) ? v : 0;
    }
  }
  return out;
}

/** cloud_alpha: infrared everywhere, raised to the visible band's by day where that's higher. */
export function cloudAlpha(ir: Float32Array, vis: Float32Array | null): Float32Array {
  if (!vis) return ir;
  const out = new Float32Array(ir.length);
  for (let i = 0; i < ir.length; i++) out[i] = Number.isFinite(ir[i]) ? Math.max(ir[i], vis[i]) : NaN;
  return out;
}
