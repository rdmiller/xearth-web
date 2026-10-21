// 2D layer over the globe: city markers, the status label, and attribution.
// Styled as a spacecraft HUD: Chakra Petch (bundled via @fontsource), small
// letter-spaced caps, cyan hairlines with a soft glow.

import { CITIES } from './cities';
import type { CloudStatus } from './cloudSync';
import type { PerfSummary } from './perf';
import type { FeaturedSat, SatState } from './satellites';
import { edgePoint } from './bodies';
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

function drawCities(ctx: CanvasRenderingContext2D, s: OverlayState, w: number, h: number, dpr: number, reserved: Rect[] = []) {
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
  // Reserve every marker first so no label lands on another city's diamond —
  // and anything more important (launch labels) passed in as `reserved`.
  const taken: Rect[] = [...reserved, ...visible.map((c) => ({ x: c.x - 5, y: c.y - 5, w: 10, h: 10 }))];

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
  bodies?: BodyMarker[];
  launches?: LaunchOverlay[];
  /** One-line summary of the focused launch for the status label. */
  launchLine?: string;
  storms?: StormOverlay[];
  quakes?: QuakeOverlay[];
  /** One-line summary of the hazard layers for the status label. */
  hazardLine?: string;
  perf?: PerfOverlay;
  note?: string;
}

export interface BodyMarker {
  kind: 'sun' | 'moon';
  label: string;
  /** Sky-projection position (Earth radii from the disc centre, y up) and disc radius. */
  x: number;
  y: number;
  radius: number;
  ahead: boolean;
  occluded: boolean;
}

export interface LaunchOverlay {
  id: string;
  /** "FALCON 9" */
  rocket: string;
  /** "STARLINK GROUP 15-15" — shown for the focused launch only. */
  mission: string;
  /** "T−04:21:07" */
  clock: string;
  /** Launch Library status: Go, TBC, TBD, Hold, Success… */
  status: string;
  pad: Vec3;
  /** In flight: the vehicle / stack / satellite. */
  vehicle?: Vec3;
  path?: { flown: Vec3[]; ahead: Vec3[]; deploy?: Vec3 };
  /** In flight: one line each, e.g. ["ASCENT (APPROX.)", "182 KM · 6.9 KM/S"]. */
  detail?: string[];
  focus: boolean;
  tracked: boolean;
}

const LAUNCH_COLOR = '#ff9f43';
const STATUS_COLOR: Record<string, string> = { go: '#7dffa8', hold: '#ff5c7a', success: HUD.accent };
const LABEL_ROW = 15;

type Row = { text: string; color: string }[];

/** A stacked label to place beside a point on the globe. */
interface CalloutRequest {
  anchor: Vec3;
  rows: Row[];
  /** Distance from the anchor to the label, px. */
  gap: number;
}

interface Callout {
  /** Text origin of the first row (left, vertical middle). */
  x: number;
  y: number;
  rows: Row[];
  /** Screen box, including the dark backing — reserved before city labels are placed. */
  rect: Rect;
}

/**
 * Place stacked labels for launches, storms and quakes, in priority order:
 * right of the anchor, else left, below, above — whichever doesn't hit one
 * already placed. Measured once, so city placement can avoid exactly these boxes.
 */
function placeCallouts(ctx: CanvasRenderingContext2D, s: OverlayState, w: number, h: number, reqs: CalloutRequest[]): Callout[] {
  const out: Callout[] = [];
  ctx.save();
  ctx.font = `600 11px ${UI_FONT}`;
  ctx.letterSpacing = '0.1em';
  for (const r of reqs) {
    const anchor = project(s.camera, r.anchor);
    if (!anchor.visible) continue;
    const ax = w / 2 + anchor.x * s.radiusPx;
    const ay = h / 2 - anchor.y * s.radiusPx;
    const width = Math.max(...r.rows.map((row) => row.reduce((sum, part) => sum + ctx.measureText(part.text).width, 0)));
    const blockH = (r.rows.length - 1) * LABEL_ROW;
    const candidates = [
      { x: ax + r.gap, y: ay - blockH / 2 },
      { x: ax - r.gap - width, y: ay - blockH / 2 },
      { x: ax - width / 2, y: ay + r.gap + LABEL_ROW / 2 },
      { x: ax - width / 2, y: ay - r.gap - LABEL_ROW / 2 - blockH },
    ];
    const boxAt = (c: { x: number; y: number }): Rect => ({
      x: c.x - 4,
      y: c.y - LABEL_ROW / 2 - 1,
      w: width + 8,
      h: r.rows.length * LABEL_ROW + 2,
    });
    const pick = candidates.find((c) => !out.some((o) => overlaps(o.rect, boxAt(c)))) ?? candidates[0];
    out.push({ x: pick.x, y: pick.y, rows: r.rows, rect: boxAt(pick) });
  }
  ctx.restore();
  return out;
}

/** Labels on a dark backing: readable over bright cloud without a (costly) glow. */
function drawCallouts(ctx: CanvasRenderingContext2D, callouts: Callout[]) {
  ctx.save();
  ctx.font = `600 11px ${UI_FONT}`;
  ctx.letterSpacing = '0.1em';
  ctx.textBaseline = 'middle';
  for (const c of callouts) {
    ctx.fillStyle = 'rgba(4, 10, 20, 0.72)';
    ctx.beginPath();
    ctx.roundRect(c.rect.x, c.rect.y, c.rect.w, c.rect.h, 3);
    ctx.fill();
    c.rows.forEach((row, i) => {
      let x = c.x;
      for (const part of row) {
        ctx.fillStyle = part.color;
        ctx.fillText(part.text, x, c.y + i * LABEL_ROW);
        x += ctx.measureText(part.text).width;
      }
    });
  }
  ctx.restore();
  ctx.letterSpacing = '0px';
}

/**
 * Launch labels: on the pad before liftoff, beside the vehicle after. Stacked
 * short lines: rocket, mission (focus only), then the clock with status (on
 * the pad) or phase and numbers (in flight). Focused launch first.
 */
function launchRequests(s: OverlayState): CalloutRequest[] {
  return [...(s.launches ?? [])]
    .sort((a, b) => Number(b.focus) - Number(a.focus))
    .map((l) => {
      const rows: Row[] = [[{ text: l.rocket, color: LAUNCH_COLOR }]];
      if (l.focus) rows.push([{ text: l.mission, color: HUD.text }]);
      if (l.vehicle) {
        rows.push([{ text: l.clock, color: LAUNCH_COLOR }]);
        for (const d of l.detail ?? []) rows.push([{ text: d, color: HUD.dim }]);
      } else {
        rows.push([
          { text: l.clock, color: HUD.text },
          { text: ` · ${l.status.toUpperCase()}`, color: STATUS_COLOR[l.status.toLowerCase()] ?? '#ffc857' },
        ]);
      }
      return { anchor: l.vehicle ?? l.pad, rows, gap: l.vehicle && l.tracked ? 16 : 11 };
    });
}

// ---- tropical cyclones ---------------------------------------------------------------

export interface StormOverlay {
  title: string;
  detail: string;
  color: string;
  pos: Vec3;
  southern: boolean;
  /** Track segments; forecast ones are dashed. */
  segments: { a: Vec3; b: Vec3; color: string; forecast: boolean }[];
}

/** The cyclone symbol: a filled eye with two curved arms (mirrored south of the equator). */
function stormSprite(color: string, southern: boolean, dpr: number): Sprite {
  return sprite(`storm|${color}|${southern}`, dpr, { x: -11, y: -11, w: 22, h: 22 }, (c) => {
    if (southern) c.scale(-1, 1);
    c.shadowColor = color;
    c.shadowBlur = 6;
    c.strokeStyle = color;
    c.fillStyle = color;
    c.lineWidth = 2.4;
    c.lineCap = 'round';
    c.beginPath();
    c.arc(0, 0, 3.6, 0, Math.PI * 2);
    c.fill();
    for (const start of [0, Math.PI]) {
      c.beginPath();
      c.arc(0, 0, 8, start - Math.PI * 0.15, start + Math.PI * 0.45);
      c.stroke();
    }
  });
}

function drawStorms(ctx: CanvasRenderingContext2D, s: OverlayState, w: number, h: number, dpr: number) {
  if (!s.storms?.length) return;
  const toScreen = (p: Vec3) => {
    const q = project(s.camera, p);
    return { x: w / 2 + q.x * s.radiusPx, y: h / 2 - q.y * s.radiusPx, visible: q.visible };
  };
  ctx.save();
  ctx.lineCap = 'round';
  // One path per (colour, observed/forecast): a handful of strokes, not one per segment.
  const paths = new Map<string, Path2D>();
  for (const st of s.storms) {
    for (const seg of st.segments) {
      const a = toScreen(seg.a);
      const b = toScreen(seg.b);
      if (!a.visible || !b.visible) continue;
      const key = `${seg.color}|${seg.forecast ? 1 : 0}`;
      let path = paths.get(key);
      if (!path) paths.set(key, (path = new Path2D()));
      path.moveTo(a.x, a.y);
      path.lineTo(b.x, b.y);
    }
  }
  for (const [key, path] of paths) {
    const [color, forecast] = key.split('|');
    ctx.strokeStyle = color;
    ctx.globalAlpha = forecast === '1' ? 0.6 : 0.85;
    ctx.lineWidth = forecast === '1' ? 1.4 : 2;
    ctx.setLineDash(forecast === '1' ? [4, 4] : []);
    ctx.stroke(path);
  }
  ctx.setLineDash([]);
  ctx.globalAlpha = 1;
  for (const st of s.storms) {
    const here = toScreen(st.pos);
    if (here.visible) stamp(ctx, stormSprite(st.color, st.southern, dpr), here.x, here.y, dpr);
  }
  ctx.restore();
}

function stormRequests(s: OverlayState): CalloutRequest[] {
  return (s.storms ?? []).map((st) => ({
    anchor: st.pos,
    rows: [[{ text: st.title, color: st.color }], ...(st.detail ? [[{ text: st.detail, color: HUD.dim }]] : [])],
    gap: 14,
  }));
}

// ---- earthquakes ---------------------------------------------------------------------

export interface QuakeOverlay {
  pos: Vec3;
  radius: number;
  color: string;
  alpha: number;
  /** Within the last hour: drawn with a second ring. */
  fresh: boolean;
  /** Only the biggest / notable ones carry a label. */
  rows?: string[];
}

/** A quake ring (tinted disc + outline, plus an outer ring when fresh), cached per look. */
function quakeSprite(color: string, radius: number, fresh: boolean, dpr: number): Sprite {
  const r = Math.round(radius * 2) / 2;
  const outer = r + (fresh ? 5 : 1);
  return sprite(`quake|${color}|${r}|${fresh}`, dpr, { x: -outer, y: -outer, w: 2 * outer, h: 2 * outer }, (c) => {
    c.strokeStyle = color;
    c.fillStyle = color;
    c.lineWidth = 1.4;
    c.globalAlpha = 0.25;
    c.beginPath();
    c.arc(0, 0, r, 0, Math.PI * 2);
    c.fill();
    c.globalAlpha = 1;
    c.stroke();
    if (fresh) {
      c.globalAlpha = 0.5;
      c.beginPath();
      c.arc(0, 0, r + 4, 0, Math.PI * 2);
      c.stroke();
    }
  });
}

function drawQuakes(ctx: CanvasRenderingContext2D, s: OverlayState, w: number, h: number, dpr: number) {
  if (!s.quakes?.length) return;
  ctx.save();
  for (const q of s.quakes) {
    const p = project(s.camera, q.pos);
    if (!p.visible) continue;
    ctx.globalAlpha = q.alpha;
    stamp(ctx, quakeSprite(q.color, q.radius, q.fresh, dpr), w / 2 + p.x * s.radiusPx, h / 2 - p.y * s.radiusPx, dpr);
  }
  ctx.restore();
}

function quakeRequests(s: OverlayState): CalloutRequest[] {
  return (s.quakes ?? [])
    .filter((q) => q.rows)
    .map((q) => ({
      anchor: q.pos,
      rows: q.rows!.map((text, i) => [{ text, color: i === 0 ? q.color : HUD.dim }]),
      gap: q.radius + 7,
    }));
}

/** Pads, flight paths and vehicles. Countdown text changes every second, so it's drawn plain (no glow). */
function drawLaunches(ctx: CanvasRenderingContext2D, s: OverlayState, w: number, h: number, dpr: number) {
  const list = s.launches;
  if (!list?.length) return;
  const toScreen = (p: Vec3) => {
    const q = project(s.camera, p);
    return { x: w / 2 + q.x * s.radiusPx, y: h / 2 - q.y * s.radiusPx, visible: q.visible };
  };
  const polyline = (pts: Vec3[]) => {
    const path = new Path2D();
    let prev: { x: number; y: number; visible: boolean } | null = null;
    for (const p of pts) {
      const q = toScreen(p);
      if (prev?.visible && q.visible) path.lineTo(q.x, q.y);
      else if (q.visible) path.moveTo(q.x, q.y);
      prev = q;
    }
    return path;
  };

  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  for (const l of list) {
    if (!l.path) continue;
    ctx.strokeStyle = LAUNCH_COLOR;
    ctx.globalAlpha = 0.9;
    ctx.lineWidth = 2;
    ctx.stroke(polyline(l.path.flown));
    ctx.globalAlpha = 0.5;
    ctx.lineWidth = 1.2;
    ctx.setLineDash([5, 5]);
    ctx.stroke(polyline(l.path.ahead));
    ctx.setLineDash([]);
    if (l.path.deploy) {
      const d = toScreen(l.path.deploy);
      if (d.visible) {
        ctx.globalAlpha = 0.85;
        ctx.strokeRect(d.x - 3, d.y - 3, 6, 6);
        ctx.font = `600 10px ${UI_FONT}`;
        ctx.letterSpacing = '0.12em';
        ctx.fillStyle = LAUNCH_COLOR;
        ctx.textBaseline = 'middle';
        ctx.fillText('DEPLOY', d.x + 7, d.y);
      }
    }
  }
  ctx.globalAlpha = 1;

  ctx.font = `600 11px ${UI_FONT}`;
  ctx.letterSpacing = '0.1em';
  ctx.textBaseline = 'middle';
  for (const l of list) {
    const pad = toScreen(l.pad);
    if (pad.visible) {
      ctx.strokeStyle = LAUNCH_COLOR;
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.arc(pad.x, pad.y, l.focus ? 6 : 4.5, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = LAUNCH_COLOR;
      ctx.fillRect(pad.x - 1, pad.y - 1, 2, 2);
    }
    if (l.vehicle) {
      const v = toScreen(l.vehicle);
      if (!v.visible) continue;
      if (l.tracked) stamp(ctx, reticleSprite(LAUNCH_COLOR, dpr), v.x, v.y, dpr);
      stamp(ctx, satSprite('', LAUNCH_COLOR, true, 9, dpr), v.x, v.y, dpr);
    }
  }
  ctx.restore();
  ctx.letterSpacing = '0px';
}

const BODY_COLOR = { sun: '#ffd27a', moon: '#d8dde6' };
const EDGE_INSET = 26;

/**
 * A label beside each body on screen; for one out of frame (or behind the
 * camera), a chevron at the screen edge pointing the way to it.
 */
function drawBodies(ctx: CanvasRenderingContext2D, s: OverlayState, w: number, h: number) {
  ctx.save();
  ctx.font = `600 11px ${UI_FONT}`;
  ctx.letterSpacing = '0.12em';
  ctx.textBaseline = 'middle';
  ctx.shadowColor = HUD.halo;
  ctx.shadowBlur = 4;
  for (const b of s.bodies ?? []) {
    const color = BODY_COLOR[b.kind];
    const px = w / 2 + b.x * s.radiusPx;
    const py = h / 2 - b.y * s.radiusPx;
    const r = b.radius * s.radiusPx;
    const onScreen = b.ahead && px > -r && px < w + r && py > -r && py < h + r;
    if (onScreen) {
      ctx.globalAlpha = b.occluded ? 0.45 : 0.95;
      ctx.fillStyle = color;
      ctx.textAlign = 'left';
      const text = b.occluded ? `${b.label} · BEHIND EARTH` : b.label;
      ctx.fillText(text, px + Math.max(r, 4) + (b.kind === 'sun' ? 14 : 8), py);
      continue;
    }
    // Off screen: chevron on the edge, label on the inward side.
    const e = edgePoint(b.x, b.y, w, h, EDGE_INSET);
    ctx.globalAlpha = 0.9;
    ctx.fillStyle = color;
    ctx.beginPath();
    const c = Math.cos(-e.angle);
    const sn = Math.sin(-e.angle);
    const tip = (dx: number, dy: number) => [e.x + dx * c - dy * sn, e.y + dx * sn + dy * c] as const;
    ctx.moveTo(...tip(9, 0));
    ctx.lineTo(...tip(-3, -6));
    ctx.lineTo(...tip(0, 0));
    ctx.lineTo(...tip(-3, 6));
    ctx.closePath();
    ctx.fill();
    const inward = Math.cos(e.angle) > 0;
    ctx.textAlign = inward ? 'right' : 'left';
    ctx.fillText(b.label, e.x + (inward ? -10 : 10), e.y + (Math.abs(Math.sin(e.angle)) > 0.7 ? (Math.sin(e.angle) > 0 ? 14 : -14) : 0));
  }
  ctx.restore();
  ctx.textAlign = 'left';
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
  // Priority for label space: launches, then storms, then quakes, then cities.
  const callouts = placeCallouts(ctx, s, w, h, [...launchRequests(s), ...stormRequests(s), ...quakeRequests(s)]);
  drawQuakes(ctx, s, w, h, dpr);
  drawStorms(ctx, s, w, h, dpr);
  if (s.markers) drawCities(ctx, s, w, h, dpr, callouts.map((c) => c.rect));
  drawSatellites(ctx, s, w, h, dpr);
  drawLaunches(ctx, s, w, h, dpr);
  drawCallouts(ctx, callouts);
  drawBodies(ctx, s, w, h);
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
    if (s.launchLine) lines.push(s.launchLine);
    if (s.hazardLine) lines.push(s.hazardLine);
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
    'Earth: NASA Blue Marble / Black Marble · Moon: NASA SVS / LRO · Clouds: NOAA/NESDIS GMGSI · Satellites: CelesTrak · Launches: The Space Devs, SpaceX via CelesTrak · Aurora: NOAA SWPC · Storms: GDACS, NHC · Fires: NASA FIRMS · Quakes: USGS · press H',
    w - 10,
    h - 8,
  );
  ctx.textAlign = 'left';
  ctx.letterSpacing = '0px';
}
