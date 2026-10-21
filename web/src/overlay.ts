// 2D layer over the globe: city markers, the status label, and attribution.
// Styled as a spacecraft HUD: Chakra Petch (bundled via @fontsource), small
// letter-spaced caps, cyan hairlines with a soft glow.

import { CITIES } from './cities';
import type { CloudStatus } from './cloudSync';
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

function drawCities(ctx: CanvasRenderingContext2D, s: OverlayState, w: number, h: number) {
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
    ctx.save();
    ctx.globalAlpha = c.alpha;

    // Marker: a hollow diamond with a pinpoint centre, glowing faintly.
    ctx.shadowColor = HUD.glow;
    ctx.shadowBlur = 6;
    ctx.strokeStyle = HUD.accent;
    ctx.lineWidth = 1.3;
    ctx.beginPath();
    ctx.moveTo(c.x, c.y - 3.5);
    ctx.lineTo(c.x + 3.5, c.y);
    ctx.lineTo(c.x, c.y + 3.5);
    ctx.lineTo(c.x - 3.5, c.y);
    ctx.closePath();
    ctx.stroke();
    ctx.fillStyle = HUD.accent;
    ctx.fillRect(c.x - 0.75, c.y - 0.75, 1.5, 1.5);

    if (side) {
      const r = calloutRect(c.x, c.y, textW, side);
      const dir = side === 'right' ? 1 : -1;
      const elbowX = c.x + dir * (ELBOW + 2);
      const lineY = c.y - ELBOW - 2;
      ctx.shadowBlur = 3;
      ctx.lineWidth = 1;
      ctx.strokeStyle = HUD.line;
      ctx.beginPath();
      ctx.moveTo(c.x + dir * 3, c.y - 3);
      ctx.lineTo(elbowX, lineY);
      ctx.lineTo(side === 'right' ? r.x + r.w : r.x, lineY);
      ctx.stroke();

      ctx.shadowColor = HUD.halo;
      ctx.shadowBlur = 4;
      ctx.fillStyle = HUD.text;
      ctx.fillText(c.name, r.x + PAD, lineY - 3);
    }
    ctx.restore();
  }
  ctx.letterSpacing = '0px';
}

/** Corner brackets around the tracked satellite, like a targeting reticle. */
function drawReticle(ctx: CanvasRenderingContext2D, x: number, y: number, color: string) {
  const r = 11;
  const arm = 4;
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.2;
  ctx.shadowColor = color;
  ctx.shadowBlur = 6;
  for (const [sx, sy] of [
    [-1, -1],
    [1, -1],
    [1, 1],
    [-1, 1],
  ]) {
    ctx.beginPath();
    ctx.moveTo(x + sx * r, y + sy * (r - arm));
    ctx.lineTo(x + sx * r, y + sy * r);
    ctx.lineTo(x + sx * (r - arm), y + sy * r);
    ctx.stroke();
  }
  ctx.restore();
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
  note?: string;
}

export function describeSat(f: FeaturedOverlay): string {
  const s = f.state;
  return `${f.sat.name} · ${Math.round(s.altKm)} km · ${s.speed.toFixed(2)} km/s · ${s.sunlit ? 'sunlit' : 'in shadow'}`;
}

function drawSatellites(ctx: CanvasRenderingContext2D, s: OverlayState, w: number, h: number) {
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
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1];
      const b = pts[i];
      if (!a.p || !b.p || !a.p.visible || !b.p.visible) continue;
      const past = b.t <= 0;
      ctx.globalAlpha = past ? 0.15 + 0.7 * (1 + b.t / before) : 0.35;
      ctx.setLineDash(past ? [] : [4, 5]);
      ctx.lineWidth = past ? 1.6 : 1.1;
      ctx.strokeStyle = f.sat.color;
      ctx.beginPath();
      ctx.moveTo(a.p.x, a.p.y);
      ctx.lineTo(b.p.x, b.p.y);
      ctx.stroke();
    }
    ctx.setLineDash([]);
    ctx.globalAlpha = 1;

    const here = toScreen(f.state.pos);
    if (!here.visible) continue;
    const tracked = sats.tracking === f.sat.key;
    ctx.save();
    ctx.shadowColor = f.sat.color;
    ctx.shadowBlur = 8;
    ctx.beginPath();
    ctx.arc(here.x, here.y, 4, 0, Math.PI * 2);
    if (f.state.sunlit) {
      ctx.fillStyle = f.sat.color;
      ctx.fill();
    } else {
      // In Earth's shadow: hollow, like the dimmed Starlink dots.
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = f.sat.color;
      ctx.stroke();
    }
    ctx.restore();
    if (tracked) drawReticle(ctx, here.x, here.y, f.sat.color);

    ctx.save();
    ctx.font = `600 11px ${UI_FONT}`;
    ctx.letterSpacing = '0.12em';
    ctx.textBaseline = 'middle';
    ctx.shadowColor = HUD.halo;
    ctx.shadowBlur = 4;
    ctx.fillStyle = f.sat.color;
    ctx.fillText(f.sat.name.toUpperCase(), here.x + (tracked ? 16 : 9), here.y);
    ctx.restore();
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
  if (s.markers) drawCities(ctx, s, w, h);
  drawSatellites(ctx, s, w, h);

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
    ctx.save();
    ctx.shadowColor = HUD.halo;
    ctx.shadowBlur = 4;
    lines.forEach((line, i) => {
      ctx.fillStyle = i === 0 ? HUD.text : HUD.dim;
      ctx.fillText(line, 24, 14 + i * 17);
    });
    ctx.restore();
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
