// Earth-fixed frame used everywhere: +x → (0°N, 0°E), +y → (0°N, 90°E), +z → North Pole.

export type Vec3 = readonly [number, number, number];

export const DEG = Math.PI / 180;

export const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

export const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];

export const scale = (a: Vec3, s: number): Vec3 => [a[0] * s, a[1] * s, a[2] * s];

export const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];

export const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];

export function normalize(a: Vec3): Vec3 {
  const len = Math.hypot(a[0], a[1], a[2]);
  return len > 0 ? scale(a, 1 / len) : [0, 0, 0];
}

/** Wrap a longitude into [-180, 180). */
export function wrapLon(lon: number): number {
  return ((((lon + 180) % 360) + 360) % 360) - 180;
}

export function fromLatLon(latDeg: number, lonDeg: number): Vec3 {
  const la = latDeg * DEG;
  const lo = lonDeg * DEG;
  return [Math.cos(la) * Math.cos(lo), Math.cos(la) * Math.sin(lo), Math.sin(la)];
}

export function toLatLon(v: Vec3): { lat: number; lon: number } {
  const n = normalize(v);
  return {
    lat: Math.asin(Math.max(-1, Math.min(1, n[2]))) / DEG,
    lon: Math.atan2(n[1], n[0]) / DEG,
  };
}
