// 2D layer over the globe: city markers, the status label, and attribution.

import { CITIES } from './cities';
import type { CloudStatus } from './cloudSync';
import type { FeaturedSat, SatState } from './satellites';
import { project, type Camera } from './view';
import { fromLatLon, type Vec3 } from './vec';

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
    ctx.beginPath();
    ctx.arc(here.x, here.y, tracked ? 5.5 : 4.5, 0, Math.PI * 2);
    ctx.lineWidth = 2;
    ctx.strokeStyle = 'rgba(0,0,0,0.8)';
    ctx.stroke();
    if (f.state.sunlit) {
      ctx.fillStyle = f.sat.color;
      ctx.fill();
    } else {
      // In Earth's shadow: hollow, like the dimmed Starlink dots.
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = f.sat.color;
      ctx.stroke();
    }
    ctx.font = `${tracked ? 'bold ' : ''}12px system-ui, sans-serif`;
    ctx.textBaseline = 'middle';
    ctx.lineWidth = 3;
    ctx.strokeStyle = 'rgba(0,0,0,0.75)';
    ctx.strokeText(f.sat.name, here.x + 9, here.y - 1);
    ctx.fillStyle = f.sat.color;
    ctx.fillText(f.sat.name, here.x + 9, here.y - 1);
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
  ctx.font = '12px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';
  ctx.textBaseline = 'middle';

  if (s.markers) {
    for (const [name, lat, lon] of CITIES) {
      const p = project(s.camera, fromLatLon(lat, lon));
      if (!p.visible) continue;
      const x = w / 2 + p.x * s.radiusPx;
      const y = h / 2 - p.y * s.radiusPx;
      ctx.beginPath();
      ctx.arc(x, y, 2.5, 0, Math.PI * 2);
      ctx.fillStyle = '#ff5050';
      ctx.fill();
      ctx.lineWidth = 3;
      ctx.strokeStyle = 'rgba(0,0,0,0.7)';
      ctx.strokeText(name, x + 6, y);
      ctx.fillStyle = '#ffd0d0';
      ctx.fillText(name, x + 6, y);
    }
  }

  drawSatellites(ctx, s, w, h);

  ctx.font = '12px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';
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
    ctx.fillStyle = 'rgba(220,230,255,0.85)';
    lines.forEach((line, i) => ctx.fillText(line, 12, 12 + i * 16));
  }

  ctx.font = '10px system-ui, sans-serif';
  ctx.textAlign = 'right';
  ctx.textBaseline = 'bottom';
  ctx.fillStyle = 'rgba(200,210,230,0.5)';
  ctx.fillText(
    'Earth: NASA Blue Marble / Black Marble · Clouds: NOAA/NESDIS GMGSI · Satellites: CelesTrak · press H',
    w - 10,
    h - 8,
  );
  ctx.textAlign = 'left';
}
