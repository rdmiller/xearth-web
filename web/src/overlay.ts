// 2D layer over the globe: city markers, the status label, and attribution.
// Styled as a spacecraft HUD: Chakra Petch (bundled via @fontsource), small
// letter-spaced caps, cyan hairlines with a soft glow.

import { CITIES } from './cities';
import type { CloudStatus } from './cloudSync';
import type { PerfSummary } from './perf';
import type { IssPanel } from './isslive';
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

/** How a city-style label looks: the app's cities in cyan, places the viewer went to in pink
 * (a colour no layer uses — GPS has the gold). */
interface LabelLook {
  key: string;
  accent: string;
  line: string;
  glow: string;
  text: string;
}

const CITY_LOOK: LabelLook = { key: 'city', accent: HUD.accent, line: HUD.line, glow: HUD.glow, text: HUD.text };
export const PLACE_COLOR = '#ff7ad9';
const PLACE_LOOK: LabelLook = {
  key: 'place',
  accent: PLACE_COLOR,
  line: 'rgba(255, 122, 217, 0.75)',
  glow: 'rgba(255, 60, 200, 0.6)',
  text: 'rgba(255, 196, 238, 0.97)',
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
  const at = (name: string, lat: number, lon: number, look: LabelLook) => {
    const p = fromLatLon(lat, lon);
    const q = project(s.camera, p);
    // Fade out toward the limb, where labels would crowd a foreshortened sliver.
    const alpha = q.visible ? smoothstep(0.08, 0.35, facing(s.camera, p)) : 0;
    return alpha > 0.02 ? [{ name: name.toUpperCase(), x: w / 2 + q.x * s.radiusPx, y: h / 2 - q.y * s.radiusPx, alpha, look }] : [];
  };
  // The viewer's own places first, so they get the first pick of label room; a city they
  // went to is drawn as their place, not twice.
  const places = s.places ?? [];
  const mine = places.flatMap((p) => at(p.name, p.lat, p.lon, PLACE_LOOK));
  const cities = s.markers
    ? CITIES.filter(([, lat, lon]) => !places.some((p) => Math.abs(p.lat - lat) < 0.3 && Math.abs(p.lon - lon) < 0.3)).flatMap(([name, lat, lon]) => at(name, lat, lon, CITY_LOOK))
    : [];
  const visible = [...mine, ...cities];

  ctx.font = `500 11px ${UI_FONT}`;
  ctx.letterSpacing = '0.1em';
  ctx.textBaseline = 'alphabetic';
  // Reserve every marker first so no label lands on another city's diamond —
  // and anything more important (launch labels) passed in as `reserved`.
  const taken: Rect[] = [...reserved, ...visible.map((c) => ({ x: c.x - 5, y: c.y - 5, w: 10, h: 10 }))];

  for (const c of visible) {
    const textW = ctx.measureText(c.name).width;
    const side = placeCallout(c.x, c.y, textW, taken, { w, h });
    const sp = citySprite(c.name, textW, side, dpr, c.look);
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

function citySprite(name: string, textW: number, side: CalloutSide | null, dpr: number, look: LabelLook = CITY_LOOK): Sprite {
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
  return sprite(`${look.key}|${name}|${side ?? 'none'}`, dpr, bounds, (c) => {
    // Marker: a hollow diamond with a pinpoint centre, glowing faintly.
    c.shadowColor = look.glow;
    c.shadowBlur = 6;
    c.strokeStyle = look.accent;
    c.lineWidth = 1.3;
    c.beginPath();
    c.moveTo(0, -3.5);
    c.lineTo(3.5, 0);
    c.lineTo(0, 3.5);
    c.lineTo(-3.5, 0);
    c.closePath();
    c.stroke();
    c.fillStyle = look.accent;
    c.fillRect(-0.75, -0.75, 1.5, 1.5);
    if (!r || !side) return;

    const dir = side === 'right' ? 1 : -1;
    const elbowX = dir * (ELBOW + 2);
    const lineY = -ELBOW - 2;
    c.shadowBlur = 3;
    c.lineWidth = 1;
    c.strokeStyle = look.line;
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
    c.fillStyle = look.text;
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
  /** Placed from NASA's live telemetry rather than SGP4. */
  live?: boolean;
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
  /** GDACS floods, wildfires and eruptions. */
  events?: EventOverlay[];
  /** Tsunami bulletins (epicentres) and live NWS alerts (sampled coastal zones). */
  tsunami?: TsunamiOverlay[];
  tsunamiZones?: ZoneOverlay[];
  /** NASA ISS live telemetry panel. */
  issPanel?: IssPanel;
  /** Names beside the satellites in the categories ticked for labels (the GL layer draws the points). */
  satLabels?: SatLabelOverlay[];
  /** CSS px the pinned layer dock covers at the bottom: labels keep out of it. */
  bottomInset?: number;
  /** Page panels over the globe (the feeds dashboard): labels keep out of these too. */
  panels?: Rect[];
  /** Where the view just went (search or double-click): a reticle and the name, for a while. */
  target?: { pos: Vec3; name: string };
  /** Places gone to from the search: labelled like cities, in pink, even with cities off. */
  places?: { name: string; lat: number; lon: number }[];
  /** One-line summary of the hazard layers for the status label. */
  hazardLine?: string;
  /** Lightning and GDACS summary. */
  surfaceLine?: string;
  /** Radar, smoke, snow and ice. */
  weatherLine?: string;
  /** Kp, X-ray class, solar wind. */
  spaceLine?: string;
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

/** A run of text in one colour — or, with `meter`, the impact meter (that many of 3 bars lit). */
type Part = { text: string; color: string; meter?: number };
type Row = Part[];

/** The impact meter: three rising bars after a small gap, sized to sit in a label row. */
const METER_GAP = 6;
const METER_W = METER_GAP + 13;
const METER_OFF = 'rgba(175, 215, 240, 0.22)';

const partWidth = (ctx: CanvasRenderingContext2D, p: Part) => (p.meter ? METER_W : ctx.measureText(p.text).width);

/** Bars 3 px wide, 2 px apart, 4/7/10 px tall, bottoms on the row's lower edge. `y`: row middle. */
function drawMeter(ctx: CanvasRenderingContext2D, x: number, y: number, level: number, color: string) {
  for (let i = 0; i < 3; i++) {
    const bh = 4 + i * 3;
    ctx.fillStyle = i < level ? color : METER_OFF;
    ctx.fillRect(x + METER_GAP + i * 5, y + 5 - bh, 3, bh);
  }
}

/** The meter for an impact level, as a label part (nothing for an unknown level). */
const impactPart = (level: number | undefined, color: string | undefined): Part[] =>
  level && color ? [{ text: '', color, meter: level }] : [];

/** A stacked label to place beside a point on the globe. */
interface CalloutRequest {
  anchor: Vec3;
  rows: Row[];
  /** Distance from the anchor to the label, px. */
  gap: number;
  /** Drop the label (the marker still shows) when every spot is taken, rather than overlap. */
  optional?: boolean;
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
function placeCallouts(
  ctx: CanvasRenderingContext2D,
  s: OverlayState,
  w: number,
  h: number,
  reqs: CalloutRequest[],
  reserved: Rect[] = [],
): Callout[] {
  const out: Callout[] = [];
  ctx.save();
  ctx.font = `600 11px ${UI_FONT}`;
  ctx.letterSpacing = '0.1em';
  for (const r of reqs) {
    const anchor = project(s.camera, r.anchor);
    if (!anchor.visible) continue;
    const ax = w / 2 + anchor.x * s.radiusPx;
    const ay = h / 2 - anchor.y * s.radiusPx;
    const width = Math.max(...r.rows.map((row) => row.reduce((sum, part) => sum + partWidth(ctx, part), 0)));
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
    // On screen and clear of the status readout and of labels already placed.
    const onScreen = (b: Rect) => b.x >= 0 && b.y >= 0 && b.x + b.w <= w && b.y + b.h <= h;
    const clear = (b: Rect) => !reserved.some((t) => overlaps(t, b)) && !out.some((o) => overlaps(o.rect, b));
    const free = candidates.find((c) => onScreen(boxAt(c)) && clear(boxAt(c)));
    if (!free && r.optional) continue;
    // No free side: overlapping another label beats covering the readout or the drawer.
    const clearOfReserved = (b: Rect) => onScreen(b) && !reserved.some((t) => overlaps(t, b));
    const pick = free ?? candidates.find((c) => clearOfReserved(boxAt(c))) ?? candidates.find((c) => onScreen(boxAt(c))) ?? candidates[0];
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
        if (part.meter) drawMeter(ctx, x, c.y + i * LABEL_ROW, part.meter, part.color);
        else {
          ctx.fillStyle = part.color;
          ctx.fillText(part.text, x, c.y + i * LABEL_ROW);
        }
        x += partWidth(ctx, part);
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
  /** GDACS impact level 1–3 and its colour, drawn as a meter after the detail. */
  impact?: number;
  impactColor?: string;
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
    rows: [
      [{ text: st.title, color: st.color }],
      ...(st.detail || st.impact ? [[{ text: st.detail, color: HUD.dim }, ...impactPart(st.impact, st.impactColor)]] : []),
    ],
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

// ---- go-to target --------------------------------------------------------------------------

function drawTarget(ctx: CanvasRenderingContext2D, s: OverlayState, w: number, h: number, dpr: number) {
  if (!s.target) return;
  const p = project(s.camera, s.target.pos);
  if (p.visible) stamp(ctx, reticleSprite(HUD.accent, dpr), w / 2 + p.x * s.radiusPx, h / 2 - p.y * s.radiusPx, dpr);
}

function targetRequests(s: OverlayState): CalloutRequest[] {
  // A labelled place already shows its name; the reticle alone marks it.
  return s.target?.name ? [{ anchor: s.target.pos, rows: [[{ text: s.target.name, color: HUD.accent }]], gap: 14 }] : [];
}

// ---- tsunami ---------------------------------------------------------------------------

export interface TsunamiOverlay {
  pos: Vec3;
  color: string;
  /** Warning / threat / advisory / watch: drawn larger, with an outer ring. */
  alert: boolean;
  rows?: string[];
}

export interface ZoneOverlay {
  /** Sampled zone centroids along the coast. */
  points: Vec3[];
  /** Where the label goes (the sample nearest their middle). */
  anchor: Vec3;
  color: string;
  rows: string[];
}

/** A dot with waves radiating left and right; alerts add a ring. Cached per look. */
function tsunamiSprite(color: string, alert: boolean, dpr: number): Sprite {
  const r = alert ? 12 : 8;
  return sprite(`tsunami|${color}|${alert}`, dpr, { x: -r - 3, y: -r - 3, w: 2 * r + 6, h: 2 * r + 6 }, (c) => {
    c.strokeStyle = color;
    c.fillStyle = color;
    c.lineWidth = 1.5;
    c.lineCap = 'round';
    c.shadowColor = 'rgba(0, 0, 0, 0.8)';
    c.shadowBlur = 3;
    c.beginPath();
    c.arc(0, 0, 2, 0, Math.PI * 2);
    c.fill();
    for (const k of [0.55, 1]) {
      for (const side of [0, Math.PI]) {
        c.beginPath();
        c.arc(0, 0, r * k, side - 0.6, side + 0.6);
        c.stroke();
      }
    }
    if (alert) {
      c.globalAlpha = 0.45;
      c.beginPath();
      c.arc(0, 0, r + 2, 0, Math.PI * 2);
      c.stroke();
    }
  });
}

function drawTsunami(ctx: CanvasRenderingContext2D, s: OverlayState, w: number, h: number, dpr: number) {
  ctx.save();
  for (const z of s.tsunamiZones ?? []) {
    ctx.fillStyle = z.color;
    for (const p of z.points) {
      const q = project(s.camera, p);
      if (!q.visible) continue;
      ctx.beginPath();
      ctx.arc(w / 2 + q.x * s.radiusPx, h / 2 - q.y * s.radiusPx, 3, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  for (const t of s.tsunami ?? []) {
    const q = project(s.camera, t.pos);
    if (q.visible) stamp(ctx, tsunamiSprite(t.color, t.alert, dpr), w / 2 + q.x * s.radiusPx, h / 2 - q.y * s.radiusPx, dpr);
  }
  ctx.restore();
}

function tsunamiRequests(s: OverlayState): CalloutRequest[] {
  const zones = (s.tsunamiZones ?? []).map((z) => ({
    anchor: z.anchor,
    rows: z.rows.map((text, i) => [{ text, color: i === 0 ? z.color : HUD.dim }]),
    gap: 8,
  }));
  const bulletins = (s.tsunami ?? [])
    .filter((t) => t.rows)
    .map((t) => ({
      anchor: t.pos,
      rows: t.rows!.map((text, i) => [{ text, color: i === 0 ? t.color : HUD.dim }]),
      gap: t.alert ? 16 : 11,
      // Statements give way to other labels; alerts never do.
      optional: !t.alert,
    }));
  return [...zones, ...bulletins];
}

// ---- satellite name labels ----------------------------------------------------------------

export interface SatLabelOverlay {
  pos: Vec3;
  name: string;
  color: string;
}

export type LabelSide = 'right' | 'left' | 'below' | 'above';
const LABEL_SIDES: readonly LabelSide[] = ['right', 'left', 'below', 'above'];
/** Points closer than this on screen share one label. */
const LABEL_CLUSTER_PX = 9;

/** The label's box for a side, relative to the point (text height 14 px, 7 px clear of the point). */
function labelBox(side: LabelSide, textW: number): Rect {
  const w = textW + 4;
  switch (side) {
    case 'right':
      return { x: 5, y: -7, w, h: 14 };
    case 'left':
      return { x: -w - 5, y: -7, w, h: 14 };
    case 'below':
      return { x: -w / 2, y: 5, w, h: 14 };
    case 'above':
      return { x: -w / 2, y: -19, w, h: 14 };
  }
}

export interface PlacedLabel {
  /** The point (first of its cluster), screen px. */
  x: number;
  y: number;
  text: string;
  color: string;
  side: LabelSide;
}

/**
 * Lay out satellite names: points within a few pixels of each other share one
 * label ("MTG-I2 · MTG-S1", or "A +2" for more), and each label takes the first
 * side — right, left, below, above — that stays on screen and clear of the
 * reserved boxes and the labels already placed. Only a label with no free side
 * is left out.
 */
export function layoutSatLabels(
  points: { x: number; y: number; name: string; color: string }[],
  reserved: Rect[],
  w: number,
  h: number,
  textWidth: (text: string) => number,
): PlacedLabel[] {
  const clusters: { x: number; y: number; names: string[]; color: string }[] = [];
  for (const p of points) {
    const near = clusters.find((c) => Math.hypot(c.x - p.x, c.y - p.y) < LABEL_CLUSTER_PX);
    if (near) near.names.push(p.name);
    else clusters.push({ x: p.x, y: p.y, names: [p.name], color: p.color });
  }
  const taken = [...reserved];
  const out: PlacedLabel[] = [];
  for (const c of clusters) {
    const text = c.names.length <= 2 ? c.names.join(' · ') : `${c.names[0]} +${c.names.length - 1}`;
    const tw = textWidth(text);
    for (const side of LABEL_SIDES) {
      const b = labelBox(side, tw);
      const box = { x: c.x + b.x, y: c.y + b.y, w: b.w, h: b.h };
      const onScreen = box.x >= 0 && box.y >= 0 && box.x + box.w <= w && box.y + box.h <= h;
      if (!onScreen || taken.some((t) => overlaps(t, box))) continue;
      taken.push(box);
      out.push({ x: c.x, y: c.y, text, color: c.color, side });
      break;
    }
  }
  return out;
}

/** A small name in the category's colour, on one side of the point. Cached per text, colour and side. */
function satLabelSprite(text: string, color: string, side: LabelSide, textW: number, dpr: number): Sprite {
  return sprite(`satlabel|${text}|${color}|${side}`, dpr, labelBox(side, textW), (c) => {
    c.font = `500 10px ${UI_FONT}`;
    c.letterSpacing = '0.06em';
    c.textBaseline = 'middle';
    c.shadowColor = 'rgba(0, 0, 0, 0.9)';
    c.shadowBlur = 3;
    c.fillStyle = color;
    c.textAlign = side === 'right' ? 'left' : side === 'left' ? 'right' : 'center';
    const [tx, ty] = side === 'right' ? [7, 0] : side === 'left' ? [-7, 0] : side === 'below' ? [0, 12] : [0, -12];
    c.fillText(text, tx, ty);
  });
}

const labelWidths = new Map<string, number>();

function drawSatLabels(ctx: CanvasRenderingContext2D, s: OverlayState, w: number, h: number, dpr: number, reserved: Rect[]) {
  if (!s.satLabels?.length) return;
  const points = s.satLabels.flatMap((l) => {
    const p = project(s.camera, l.pos);
    const x = w / 2 + p.x * s.radiusPx;
    const y = h / 2 - p.y * s.radiusPx;
    return p.visible && x >= 0 && y >= 0 && x <= w && y <= h ? [{ x, y, name: l.name, color: l.color }] : [];
  });
  ctx.save();
  ctx.font = `500 10px ${UI_FONT}`;
  ctx.letterSpacing = '0.06em';
  const width = (text: string) => {
    let tw = labelWidths.get(text);
    if (tw === undefined) labelWidths.set(text, (tw = Math.ceil(ctx.measureText(text).width)));
    return tw;
  };
  const placed = layoutSatLabels(points, reserved, w, h, width);
  ctx.restore();
  ctx.letterSpacing = '0px';
  for (const l of placed) stamp(ctx, satLabelSprite(l.text, l.color, l.side, width(l.text), dpr), l.x, l.y, dpr);
}

// ---- ISS live telemetry -----------------------------------------------------------------

/** Top right (below the frame-rate panel when that's shown): title, signal chip, rows. Returns its bottom edge. */
function drawIssPanel(ctx: CanvasRenderingContext2D, p: IssPanel, w: number, top: number): number {
  ctx.save();
  ctx.font = `500 11px ${UI_FONT}`;
  ctx.letterSpacing = '0.06em';
  ctx.textBaseline = 'top';
  const title = 'ISS · NASA LIVE TELEMETRY';
  const width = Math.max(ctx.measureText(title).width + 90, ...p.rows.map((r) => ctx.measureText(r).width)) + 20;
  const x = w - width - 14;
  const height = 26 + p.rows.length * 15 + 6;
  ctx.fillStyle = 'rgba(4, 10, 20, 0.72)';
  ctx.strokeStyle = 'rgba(98, 230, 255, 0.28)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.roundRect(x, top, width, height, 6);
  ctx.fill();
  ctx.stroke();
  ctx.font = `600 11px ${UI_FONT}`;
  ctx.fillStyle = HUD.accent;
  ctx.fillText(title, x + 10, top + 8);
  // Signal chip: green while the stream is live, amber with the age when it isn't.
  ctx.textAlign = 'right';
  ctx.fillStyle = p.aos ? '#7dffa8' : '#ffc857';
  ctx.fillText(`${p.aos ? '●' : '○'} ${p.status}`, x + width - 10, top + 8);
  ctx.textAlign = 'left';
  ctx.font = `500 11px ${UI_FONT}`;
  p.rows.forEach((row, i) => {
    ctx.fillStyle = HUD.dim;
    ctx.fillText(row, x + 10, top + 26 + i * 15);
  });
  ctx.restore();
  ctx.letterSpacing = '0px';
  return top + height;
}

// ---- GDACS floods, wildfires, eruptions ------------------------------------------------

export interface EventOverlay {
  kind: 'FL' | 'WF' | 'VO';
  pos: Vec3;
  color: string;
  /** Marker half-size, px (grows with the alert level). */
  size: number;
  /** Wildfires: burned area as a circle, km (drawn once it outgrows the marker). */
  areaRadiusKm?: number;
  /** Labelled ones: title, detail, and the GDACS impact level 1–3 (a meter in its colour). */
  rows?: { title: string; detail: string; impact: number; impactColor: string };
}

/** Flood: two waves; wildfire: a flame; eruption: a cone with a plume dot. Cached per look. */
function eventSprite(kind: EventOverlay['kind'], color: string, size: number, dpr: number): Sprite {
  const s = Math.round(size * 2) / 2;
  const pad = s + 3;
  return sprite(`event|${kind}|${color}|${s}`, dpr, { x: -pad, y: -pad, w: 2 * pad, h: 2 * pad }, (c) => {
    c.strokeStyle = color;
    c.fillStyle = color;
    c.lineWidth = 1.4;
    c.lineJoin = 'round';
    c.lineCap = 'round';
    c.shadowColor = 'rgba(0, 0, 0, 0.8)';
    c.shadowBlur = 3;
    if (kind === 'FL') {
      for (const dy of [-s * 0.35, s * 0.35]) {
        c.beginPath();
        c.moveTo(-s, dy);
        c.bezierCurveTo(-s / 2, dy - s * 0.5, 0, dy + s * 0.5, s / 2, dy);
        c.quadraticCurveTo(s * 0.75, dy - s * 0.25, s, dy);
        c.stroke();
      }
    } else if (kind === 'WF') {
      c.beginPath();
      c.moveTo(0, -s);
      c.bezierCurveTo(s * 0.9, -s * 0.2, s * 0.8, s, 0, s);
      c.bezierCurveTo(-s * 0.8, s, -s * 0.9, -s * 0.2, 0, -s);
      c.globalAlpha = 0.35;
      c.fill();
      c.globalAlpha = 1;
      c.stroke();
    } else {
      c.beginPath();
      c.moveTo(-s, s * 0.8);
      c.lineTo(-s * 0.25, -s * 0.35);
      c.lineTo(s * 0.25, -s * 0.35);
      c.lineTo(s, s * 0.8);
      c.closePath();
      c.globalAlpha = 0.35;
      c.fill();
      c.globalAlpha = 1;
      c.stroke();
      c.beginPath();
      c.arc(0, -s * 0.8, s * 0.22, 0, Math.PI * 2);
      c.fill();
    }
  });
}

function drawEvents(ctx: CanvasRenderingContext2D, s: OverlayState, w: number, h: number, dpr: number) {
  if (!s.events?.length) return;
  ctx.save();
  for (const e of s.events) {
    const p = project(s.camera, e.pos);
    if (!p.visible) continue;
    const x = w / 2 + p.x * s.radiusPx;
    const y = h / 2 - p.y * s.radiusPx;
    // The burned area to scale, once it's bigger than the marker.
    const r = e.areaRadiusKm ? (e.areaRadiusKm * s.radiusPx) / 6371 : 0;
    if (r > e.size) {
      ctx.strokeStyle = e.color;
      ctx.globalAlpha = 0.7;
      ctx.lineWidth = 1;
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.globalAlpha = 1;
    }
    stamp(ctx, eventSprite(e.kind, e.color, e.size, dpr), x, y, dpr);
  }
  ctx.restore();
}

function eventRequests(s: OverlayState): CalloutRequest[] {
  return (s.events ?? [])
    .filter((e) => e.rows)
    .map((e) => ({
      anchor: e.pos,
      rows: [
        [{ text: e.rows!.title, color: e.color }],
        [{ text: e.rows!.detail, color: HUD.dim }, ...impactPart(e.rows!.impact, e.rows!.impactColor)],
      ],
      gap: e.size + 6,
      optional: true,
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
      const text = b.occluded ? `${b.label} · BEHIND EARTH` : b.label;
      const gap = Math.max(r, 4) + (b.kind === 'sun' ? 14 : 8);
      // Right of the disc, unless that would run off the screen.
      const right = px + gap + ctx.measureText(text).width <= w - 8;
      ctx.textAlign = right ? 'left' : 'right';
      ctx.fillText(text, right ? px + gap : px - gap, py);
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

/** Bottom edge of the frame-rate panel (it's a fixed size). */
const PERF_BOTTOM = 148;

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
  ctx.roundRect(x - 10, y - 8, panelW + 20, PERF_BOTTOM - (y - 8), 6);
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
    const name = f.live ? `${f.sat.name} · LIVE` : f.sat.name;
    stamp(ctx, satSprite(name, f.sat.color, f.state.sunlit, tracked ? 16 : 9, dpr), here.x, here.y, dpr);
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

/** The status readout, top left: time, viewpoint, then one line per active layer group. */
function readoutLines(s: OverlayState): string[] {
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
  if (s.surfaceLine) lines.push(s.surfaceLine);
  if (s.weatherLine) lines.push(s.weatherLine);
  if (s.spaceLine) lines.push(s.spaceLine);
  if (s.note) lines.push(s.note);
  return lines;
}

/**
 * Draws the HUD. Returns how far down (CSS px) its top-right panels reach, 0 when there are
 * none, so page panels on that side can start below them.
 */
export function drawOverlay(canvas: HTMLCanvasElement, s: OverlayState): { rightTop: number } {
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
  // The status readout is laid out first so callouts can keep clear of it.
  ctx.font = `500 12px ${UI_FONT}`;
  ctx.letterSpacing = '0.05em';
  const lines = s.label ? readoutLines(s) : [];
  const readout: Rect | null = lines.length
    ? { x: 8, y: 8, w: Math.max(...lines.map((line) => ctx.measureText(line).width)) + 26, h: lines.length * 17 + 6 }
    : null;
  ctx.letterSpacing = '0px';
  // Labels keep clear of the status readout and, while it's pinned, the layer dock.
  // (Its band starts above the attribution line, which the dock floats over.)
  const inset = s.bottomInset ?? 0;
  const reserved: Rect[] = [...(readout ? [readout] : []), ...(inset ? [{ x: 0, y: h - inset, w, h: inset }] : []), ...(s.panels ?? [])];
  // Priority for label space: tsunami alerts, launches, storms, quakes, GDACS events, then cities.
  const callouts = placeCallouts(
    ctx,
    s,
    w,
    h,
    [...targetRequests(s), ...tsunamiRequests(s), ...launchRequests(s), ...stormRequests(s), ...quakeRequests(s), ...eventRequests(s)],
    reserved,
  );
  drawEvents(ctx, s, w, h, dpr);
  drawQuakes(ctx, s, w, h, dpr);
  drawTsunami(ctx, s, w, h, dpr);
  drawTarget(ctx, s, w, h, dpr);
  drawStorms(ctx, s, w, h, dpr);
  if (s.markers || s.places?.length) drawCities(ctx, s, w, h, dpr, [...callouts.map((c) => c.rect), ...reserved]);
  drawSatellites(ctx, s, w, h, dpr);
  drawSatLabels(ctx, s, w, h, dpr, [...callouts.map((c) => c.rect), ...reserved]);
  drawLaunches(ctx, s, w, h, dpr);
  drawCallouts(ctx, callouts);
  drawBodies(ctx, s, w, h);
  if (s.perf) drawPerf(ctx, s.perf, w);
  let rightTop = s.perf ? PERF_BOTTOM : 0;
  if (s.issPanel) rightTop = drawIssPanel(ctx, s.issPanel, w, s.perf ? 170 : 8);

  ctx.font = `500 12px ${UI_FONT}`;
  ctx.letterSpacing = '0.05em';
  ctx.textBaseline = 'top';
  if (readout) {
    // A dark backing so the readout stays legible over bright cloud, then a thin
    // accent rule down the left, like an instrument readout.
    ctx.fillStyle = 'rgba(4, 10, 20, 0.6)';
    ctx.beginPath();
    ctx.roundRect(readout.x, readout.y, readout.w, readout.h, 4);
    ctx.fill();
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
    'Earth: NASA Blue Marble / Black Marble, GIBS (VIIRS) · Moon: NASA SVS / LRO · Clouds: NOAA/NESDIS GMGSI · Satellites: CelesTrak · Launches: The Space Devs, SpaceX via CelesTrak · Aurora, Sun image, space weather: NOAA SWPC · Storms, floods, wildfires, eruptions: GDACS, NHC · Fires: NASA FIRMS · Quakes: USGS · Lightning: NOAA GOES GLM · Snow & ice: NOAA IMS, NSIDC · Smoke: NOAA HMS · Tsunami: NOAA NTWC/PTWC, NWS · ISS telemetry: NASA ISSLive · Places: GeoNames via Open-Meteo · press H',
    w - 10,
    h - 8,
  );
  ctx.textAlign = 'left';
  ctx.letterSpacing = '0px';
  return { rightTop };
}
