// 2D layer over the globe: city markers, the status label, and attribution.

import { CITIES } from './cities';
import type { CloudStatus } from './cloudSync';
import { project, type Camera } from './view';
import { fromLatLon } from './vec';

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
  note?: string;
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

  ctx.textBaseline = 'top';
  if (s.label) {
    const d = s.date;
    const lines = [
      `${d.toUTCString().replace('GMT', 'UTC')}`,
      `view ${fmtLat(s.viewer.lat)} ${fmtLon(s.viewer.lon)}`,
      `sun  ${fmtLat(s.sun.lat)} ${fmtLon(s.sun.lon)}`,
      cloudLine(s.cloudStatus, s.clouds, new Date()),
    ];
    if (s.note) lines.push(s.note);
    ctx.fillStyle = 'rgba(220,230,255,0.85)';
    lines.forEach((line, i) => ctx.fillText(line, 12, 12 + i * 16));
  }

  ctx.font = '10px system-ui, sans-serif';
  ctx.textAlign = 'right';
  ctx.textBaseline = 'bottom';
  ctx.fillStyle = 'rgba(200,210,230,0.5)';
  ctx.fillText('Earth: NASA Blue Marble / Black Marble · Clouds: NOAA/NESDIS GMGSI · press H', w - 10, h - 8);
  ctx.textAlign = 'left';
}
