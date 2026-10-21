// 2D layer over the globe: city markers, the status label, and attribution.
// Styled as a spacecraft HUD: Chakra Petch (bundled via @fontsource), small
// letter-spaced caps, cyan hairlines with a soft glow.

import { CITIES } from './cities';
import type { CloudStatus } from './cloudSync';
import type { PerfSummary } from './perf';
import type { FeaturedSat, SatState } from './satellites';
import { project, type Camera } from './view';
import { dot, fromLatLon, normalize, sub, type Vec3 } from './vec';

export const UI_FONT = '"Chakra Petch", "Segoe UI", system-ui, sans-serif';

const HUD = {
  accent: '#62e6ff',
  line: 'rgba(98, 230, 255, 0.7)',
  glow: 'rgba(0, 200, 255, 0.55)',
  text: 'rgba(230, 246, 255, 0.94)',
  dim: 'rgba(175, 215, 240, 0.72)',
  halo: 'rgba(0, 6, 14, 0.9)',
};

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

const overlaps = (a: Rect, b: Rect) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

/** Callout geometry: a short 45° elbow up from the marker, then an underline the label sits on. */
const ELBOW = 6;
const LABEL_H = 14;
const PAD = 3;

export type CalloutSide = 'right' | 'left';

export function calloutRect(x: number, y: number, textW: number, side: CalloutSide): Rect {
  const w = textW + 2 * PAD;
  const top = y - ELBOW - LABEL_H - 2;
  return side === 'right' ? { x: x + ELBOW + 2, y: top, w, h: LABEL_H } : { x: x - ELBOW - 2 - w, y: top, w, h: LABEL_H };
}

/**
 * Greedy label placement: right of the marker if that's free and on screen,
 * else left, else no label. Placed rectangles are added to `taken`.
 */
export function placeCallout(
  x: number,
  y: number,
  textW: number,
  taken: Rect[],
  bounds: { w: number; h: number },
): CalloutSide | null {
  for (const side of ['right', 'left'] as const) {
    const r = calloutRect(x, y, textW, side);
    const onScreen = r.x >= 4 && r.y >= 4 && r.x + r.w <= bounds.w - 4 && r.y + r.h <= bounds.h - 4;
    if (onScreen && !taken.some((t) => overlaps(r, t))) {
      taken.push(r);
      return side;
    }
  }
  return null;
}

/** How squarely a surface point faces the viewer: 1 at the disc centre, 0 at the limb. */
function facing(cam: Camera, p: Vec3): number {
  if (!cam.dist) return dot(p, cam.dir);
  const eye: Vec3 = [cam.dir[0] * cam.dist, cam.dir[1] * cam.dist, cam.dir[2] * cam.dist];
  return dot(p, normalize(sub(eye, p)));
}

const smoothstep = (a: number, b: number, v: number) => {
  const t = Math.max(0, Math.min(1, (v - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

function drawCities(ctx: CanvasRenderingContext2D, s: OverlayState, w: number, h: number, dpr: number) {
  const visible = CITIES.flatMap(([name, lat, lon]) => {
    const p = fromLatLon(lat, lon);
    const q = project(s.camera, p);
    // Fade out toward the limb, where labels would crowd a foreshortened sliver.
    const alpha = q.visible ? smoothstep(0.08, 0.35, facing(s.camera, p)) : 0;
    return alpha > 0.02 ? [{ name: name.toUpperCase(), x: w / 2 + q.x * s.radiusPx, y: h / 2 - q.y * s.radiusPx, alpha }] : [];
  });

  ctx.font = `500 11px ${UI_FONT}`;
  ctx.letterSpacing = '0.1em';
  ctx.textBaseline = 'alphabetic';
  // Reserve every marker first so no label lands on another city's diamond.
  const taken: Rect[] = visible.map((c) => ({ x: c.x - 5, y: c.y - 5, w: 10, h: 10 }));

  for (const c of visible) {
    const textW = ctx.measureText(c.name).width;
    const side = placeCallout(c.x, c.y, textW, taken, { w, h });
    const sp = citySprite(c.name, textW, side, dpr);
    ctx.globalAlpha = c.alpha;
    stamp(ctx, sp, c.x, c.y, dpr);
  }
  ctx.globalAlpha = 1;
  ctx.letterSpacing = '0px';
}

// ---- sprite cache -------------------------------------------------------------
// Canvas shadowBlur is rasterised by the browser after our code returns, so it
// never shows in our own timings — but ~40 glowing city labels cost ~15 ms a
// frame (frame-rate display: 32 fps with markers, a locked 60 without). Glows
// that don't change between frames are drawn once into small offscreen
// canvases and stamped with drawImage instead.

interface Sprite {
  canvas: HTMLCanvasElement;
  /** Where the anchor point sits inside the sprite, CSS px. */
  ax: number;
  ay: number;
  w: number;
  h: number;
}

const GLOW_MARGIN = 10;
const sprites = new Map<string, Sprite>();
let spriteDpr = 0;

/** Drop cached sprites (e.g. once the web font has loaded and text should re-render). */
export function clearOverlaySprites() {
  sprites.clear();
}

/** A cached drawing; `bounds` is relative to the anchor, which `draw` sees at (0, 0). */
function sprite(key: string, dpr: number, bounds: Rect, draw: (c: CanvasRenderingContext2D) => void): Sprite {
  if (dpr !== spriteDpr) {
    sprites.clear();
    spriteDpr = dpr;
  }
  let s = sprites.get(key);
  if (!s) {
    const w = Math.ceil(bounds.w + 2 * GLOW_MARGIN);
    const h = Math.ceil(bounds.h + 2 * GLOW_MARGIN);
    const canvas = document.createElement('canvas');
    canvas.width = Math.ceil(w * dpr);
    canvas.height = Math.ceil(h * dpr);
    const c = canvas.getContext('2d')!;
    const ax = GLOW_MARGIN - bounds.x;
    const ay = GLOW_MARGIN - bounds.y;
    c.scale(dpr, dpr);
    c.translate(ax, ay);
    draw(c);
    s = { canvas, ax, ay, w, h };
    sprites.set(key, s);
  }
  return s;
}

/** Draw a sprite with its anchor at (x, y), snapped to device pixels so text stays crisp. */
function stamp(ctx: CanvasRenderingContext2D, s: Sprite, x: number, y: number, dpr: number) {
  const px = Math.round((x - s.ax) * dpr) / dpr;
  const py = Math.round((y - s.ay) * dpr) / dpr;
  ctx.drawImage(s.canvas, px, py, s.w, s.h);
}

function citySprite(name: string, textW: number, side: CalloutSide | null, dpr: number): Sprite {
  const marker: Rect = { x: -5, y: -5, w: 10, h: 10 };
  const r = side ? calloutRect(0, 0, textW, side) : null;
  const bounds = r
    ? {
        x: Math.min(marker.x, r.x),
        y: Math.min(marker.y, r.y),
        w: Math.max(marker.x + marker.w, r.x + r.w) - Math.min(marker.x, r.x),
        h: Math.max(marker.y + marker.h, r.y + r.h) - Math.min(marker.y, r.y),
      }
    : marker;
  return sprite(`city|${name}|${side ?? 'none'}`, dpr, bounds, (c) => {
    // Marker: a hollow diamond with a pinpoint centre, glowing faintly.
    c.shadowColor = HUD.glow;
    c.shadowBlur = 6;
    c.strokeStyle = HUD.accent;
    c.lineWidth = 1.3;
    c.beginPath();
    c.moveTo(0, -3.5);
    c.lineTo(3.5, 0);
    c.lineTo(0, 3.5);
    c.lineTo(-3.5, 0);
    c.closePath();
    c.stroke();
    c.fillStyle = HUD.accent;
    c.fillRect(-0.75, -0.75, 1.5, 1.5);
    if (!r || !side) return;

    const dir = side === 'right' ? 1 : -1;
    const elbowX = dir * (ELBOW + 2);
    const lineY = -ELBOW - 2;
    c.shadowBlur = 3;
    c.lineWidth = 1;
    c.strokeStyle = HUD.line;
    c.beginPath();
    c.moveTo(dir * 3, -3);
    c.lineTo(elbowX, lineY);
    c.lineTo(side === 'right' ? r.x + r.w : r.x, lineY);
    c.stroke();

    c.font = `500 11px ${UI_FONT}`;
    c.letterSpacing = '0.1em';
    c.textBaseline = 'alphabetic';
    c.shadowColor = HUD.halo;
    c.shadowBlur = 4;
    c.fillStyle = HUD.text;
    c.fillText(name, r.x + PAD, lineY - 3);
  });
}

/** Corner brackets around the tracked satellite, like a targeting reticle. */
function reticleSprite(color: string, dpr: number): Sprite {
  const r = 11;
  const arm = 4;
  return sprite(`reticle|${color}`, dpr, { x: -r - 1, y: -r - 1, w: 2 * r + 2, h: 2 * r + 2 }, (c) => {
    c.strokeStyle = color;
    c.lineWidth = 1.2;
    c.shadowColor = color;
    c.shadowBlur = 6;
    for (const [sx, sy] of [
      [-1, -1],
      [1, -1],
      [1, 1],
      [-1, 1],
    ]) {
      c.beginPath();
      c.moveTo(sx * r, sy * (r - arm));
      c.lineTo(sx * r, sy * r);
      c.lineTo(sx * (r - arm), sy * r);
      c.stroke();
    }
  });
}

/** Satellite marker (filled when sunlit, hollow in Earth's shadow) plus its label. */
function satSprite(name: string, color: string, sunlit: boolean, labelX: number, dpr: number): Sprite {
  const label = name.toUpperCase();
  const textW = label.length * 9 + 10; // generous; the sprite is trimmed by its margin anyway
  return sprite(`sat|${name}|${color}|${sunlit}|${labelX}`, dpr, { x: -6, y: -8, w: labelX + textW + 6, h: 16 }, (c) => {
    c.shadowColor = color;
    c.shadowBlur = 8;
    c.beginPath();
    c.arc(0, 0, 4, 0, Math.PI * 2);
    if (sunlit) {
      c.fillStyle = color;
      c.fill();
    } else {
      c.lineWidth = 1.5;
      c.strokeStyle = color;
      c.stroke();
    }
    c.font = `600 11px ${UI_FONT}`;
    c.letterSpacing = '0.12em';
    c.textBaseline = 'middle';
    c.shadowColor = HUD.halo;
    c.shadowBlur = 4;
    c.fillStyle = color;
    c.fillText(label, labelX, 0);
  });
}

export interface FeaturedOverlay {
  sat: FeaturedSat;
  state: SatState;
  /** Path over the ground: t in minutes from now (negative = past). */
  track: { t: number; pos: Vec3 | null }[];
}

export interface SatelliteOverlay {
  featured: FeaturedOverlay[];
  /** Key of the satellite being followed (view=track), if any. */
  tracking?: string;
  summary: string;
}

export interface OverlayState {
  camera: Camera;
  radiusPx: number; // CSS pixels per Earth radius
  date: Date;
  viewer: { lat: number; lon: number };
  sun: { lat: number; lon: number };
  markers: boolean;
  label: boolean;
  clouds: boolean;
  cloudStatus: CloudStatus;
  /** Shown beside the time when the clock isn't live (e.g. "paused"). */
  clock?: string;
  satellites?: SatelliteOverlay;
  perf?: PerfOverlay;
  note?: string;
}

export interface PerfOverlay {
  summary: PerfSummary;
  /** Recent frame intervals, ms, oldest first. */
  intervals: number[];
  /** How redraws are being scheduled ("continuous" or "on demand · every 1 s"). */
  mode: string;
  gpuAvailable: boolean;
}

const FRAME_60 = 1000 / 60;

function drawPerf(ctx: CanvasRenderingContext2D, p: PerfOverlay, w: number) {
  const panelW = 236;
  const x = w - panelW - 14;
  let y = 14;
  const s = p.summary;
  const continuous = p.mode === 'continuous';

  ctx.save();
  ctx.fillStyle = 'rgba(4, 10, 20, 0.72)';
  ctx.strokeStyle = 'rgba(98, 230, 255, 0.28)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.roundRect(x - 10, y - 8, panelW + 20, 142, 6);
  ctx.fill();
  ctx.stroke();

  // Headline: frames per second and the mean frame time.
  ctx.textBaseline = 'top';
  ctx.letterSpacing = '0.06em';
  ctx.font = `600 20px ${UI_FONT}`;
  ctx.fillStyle = HUD.text;
  ctx.fillText(`${s.fps < 10 ? s.fps.toFixed(1) : Math.round(s.fps)} FPS`, x, y);
  ctx.font = `500 12px ${UI_FONT}`;
  ctx.textAlign = 'right';
  ctx.fillStyle = HUD.dim;
  ctx.fillText(s.frameMs ? `${s.frameMs.toFixed(1)} ms` : '—', x + panelW, y + 6);
  ctx.textAlign = 'left';
  y += 28;

  // Sparkline of frame intervals, 0–50 ms, with 60 and 30 fps guides.
  const gh = 34;
  const scaleY = (ms: number) => y + gh - (Math.min(ms, 50) / 50) * gh;
  ctx.strokeStyle = 'rgba(98, 230, 255, 0.18)';
  ctx.setLineDash([2, 3]);
  for (const ms of [FRAME_60, FRAME_60 * 2]) {
    ctx.beginPath();
    ctx.moveTo(x, scaleY(ms));
    ctx.lineTo(x + panelW, scaleY(ms));
    ctx.stroke();
  }
  ctx.setLineDash([]);
  const bars = p.intervals.slice(-120);
  const bw = panelW / 120;
  bars.forEach((ms, i) => {
    // Long gaps are deliberate when redrawing on demand, so don't colour them as hitches.
    ctx.fillStyle = !continuous
      ? 'rgba(175, 215, 240, 0.35)'
      : ms <= FRAME_60 * 1.25
        ? HUD.accent
        : ms <= FRAME_60 * 2.1
          ? '#ffc857'
          : '#ff5c7a';
    const top = scaleY(ms);
    ctx.fillRect(x + panelW - (bars.length - i) * bw, top, Math.max(bw - 0.4, 0.6), y + gh - top);
  });
  y += gh + 8;

  ctx.font = `500 11px ${UI_FONT}`;
  ctx.letterSpacing = '0.04em';
  const lines: [string, string][] = [
    ['worst', continuous ? `${s.worstMs.toFixed(1)} ms · ${s.slow} slow` : '— (not animating)'],
    [
      'cpu',
      `${s.cpuMs.toFixed(1)} ms  ` +
        Object.entries(s.sections)
          .map(([k, v]) => `${k} ${v.toFixed(1)}`)
          .join(' · '),
    ],
    ['gpu', s.gpuMs !== null ? `${s.gpuMs.toFixed(1)} ms` : p.gpuAvailable ? 'measuring…' : 'n/a (no timer queries)'],
    ['redraw', p.mode],
  ];
  for (const [k, v] of lines) {
    ctx.fillStyle = HUD.accent;
    ctx.fillText(k.toUpperCase(), x, y);
    ctx.fillStyle = HUD.dim;
    ctx.fillText(v, x + 52, y);
    y += 15;
  }
  ctx.restore();
}

export function describeSat(f: FeaturedOverlay): string {
  const s = f.state;
  return `${f.sat.name} · ${Math.round(s.altKm)} km · ${s.speed.toFixed(2)} km/s · ${s.sunlit ? 'sunlit' : 'in shadow'}`;
}

/** Past-trail fade bands: segments are batched into this many paths of one alpha each. */
const TRAIL_BANDS = 8;

function drawSatellites(ctx: CanvasRenderingContext2D, s: OverlayState, w: number, h: number, dpr: number) {
  const sats = s.satellites;
  if (!sats) return;
  const toScreen = (p: Vec3) => {
    const q = project(s.camera, p);
    return { x: w / 2 + q.x * s.radiusPx, y: h / 2 - q.y * s.radiusPx, visible: q.visible };
  };

  ctx.lineCap = 'round';
  for (const f of sats.featured) {
    const pts = f.track.map((k) => ({ t: k.t, p: k.pos ? toScreen(k.pos) : null }));
    const before = -pts[0].t || 1;
    // One path for the dashed future half, and TRAIL_BANDS paths for the fading
    // past (one alpha each) — ~10 strokes instead of one per segment.
    const future = new Path2D();
    const bands = Array.from({ length: TRAIL_BANDS }, () => new Path2D());
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1].p;
      const b = pts[i].p;
      if (!a || !b || !a.visible || !b.visible) continue;
      const t = pts[i].t;
      const path = t <= 0 ? bands[Math.min(TRAIL_BANDS - 1, Math.floor((1 + t / before) * TRAIL_BANDS))] : future;
      path.moveTo(a.x, a.y);
      path.lineTo(b.x, b.y);
    }
    ctx.strokeStyle = f.sat.color;
    ctx.lineWidth = 1.6;
    bands.forEach((path, k) => {
      ctx.globalAlpha = 0.15 + 0.7 * ((k + 0.5) / TRAIL_BANDS);
      ctx.stroke(path);
    });
    ctx.globalAlpha = 0.35;
    ctx.lineWidth = 1.1;
    ctx.setLineDash([4, 5]);
    ctx.stroke(future);
    ctx.setLineDash([]);
    ctx.globalAlpha = 1;

    const here = toScreen(f.state.pos);
    if (!here.visible) continue;
    const tracked = sats.tracking === f.sat.key;
    if (tracked) stamp(ctx, reticleSprite(f.sat.color, dpr), here.x, here.y, dpr);
    stamp(ctx, satSprite(f.sat.name, f.sat.color, f.state.sunlit, tracked ? 16 : 9, dpr), here.x, here.y, dpr);
  }
}

const fmtLat = (v: number) => `${Math.abs(v).toFixed(1)}°${v >= 0 ? 'N' : 'S'}`;
const fmtLon = (v: number) => `${Math.abs(v).toFixed(1)}°${v >= 0 ? 'E' : 'W'}`;

export function formatAge(from: Date, to: Date): string {
  const min = Math.round((to.getTime() - from.getTime()) / 60_000);
  if (min < 1) return 'just now';
  if (min < 90) return `${min} min ago`;
  const h = Math.round(min / 60);
  return h < 48 ? `${h} h ago` : `${Math.round(h / 24)} days ago`;
}

export function cloudLine(status: CloudStatus, enabled: boolean, now: Date): string {
  if (!enabled) return 'clouds off';
  switch (status.state) {
    case 'idle':
      return 'clouds loading…';
    case 'ok': {
      const t = new Date(status.manifest.t);
      return `clouds ${t.toISOString().slice(11, 16)}Z (${formatAge(t, now)})`;
    }
    case 'error':
      return status.manifest ? `clouds ${status.manifest.t.slice(11, 16)}Z (update failed)` : 'clouds unavailable';
  }
}

export function drawOverlay(canvas: HTMLCanvasElement, s: OverlayState) {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
  }
  const ctx = canvas.getContext('2d')!;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  if (s.markers) drawCities(ctx, s, w, h, dpr);
  drawSatellites(ctx, s, w, h, dpr);
  if (s.perf) drawPerf(ctx, s.perf, w);

  ctx.font = `500 12px ${UI_FONT}`;
  ctx.letterSpacing = '0.05em';
  ctx.textBaseline = 'top';
  if (s.label) {
    const d = s.date;
    const lines = [
      `${d.toUTCString().replace('GMT', 'UTC')}${s.clock ? ` — ${s.clock}` : ''}`,
      `view ${fmtLat(s.viewer.lat)} ${fmtLon(s.viewer.lon)}`,
      `sun  ${fmtLat(s.sun.lat)} ${fmtLon(s.sun.lon)}`,
      cloudLine(s.cloudStatus, s.clouds, new Date()),
    ];
    if (s.satellites) {
      lines.push(s.satellites.summary);
      const tracked = s.satellites.featured.find((f) => f.sat.key === s.satellites?.tracking);
      if (tracked) lines.push(`tracking ${describeSat(tracked)}`);
    }
    if (s.note) lines.push(s.note);
    // A thin accent rule down the left, like an instrument readout.
    ctx.fillStyle = HUD.line;
    ctx.fillRect(14, 14, 1.5, lines.length * 17 - 4);
    // No glow: this text changes every frame (so can't be cached) and sits on black sky.
    lines.forEach((line, i) => {
      ctx.fillStyle = i === 0 ? HUD.text : HUD.dim;
      ctx.fillText(line, 24, 14 + i * 17);
    });
  }

  ctx.font = `500 10px ${UI_FONT}`;
  ctx.letterSpacing = '0.06em';
  ctx.textAlign = 'right';
  ctx.textBaseline = 'bottom';
  ctx.fillStyle = 'rgba(170, 205, 235, 0.5)';
  ctx.fillText(
    'Earth: NASA Blue Marble / Black Marble · Clouds: NOAA/NESDIS GMGSI · Satellites: CelesTrak · press H',
    w - 10,
    h - 8,
  );
  ctx.textAlign = 'left';
  ctx.letterSpacing = '0px';
}
