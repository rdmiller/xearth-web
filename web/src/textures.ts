// Image loading, downscaled when the GPU can't hold the full size.

export async function loadImage(url: string, maxSize: number, signal?: AbortSignal): Promise<ImageBitmap> {
  const resp = await fetch(url, { signal });
  if (!resp.ok) throw new Error(`${resp.status} ${resp.statusText} — ${url}`);
  const bitmap = await createImageBitmap(await resp.blob());
  const factor = Math.min(1, maxSize / Math.max(bitmap.width, bitmap.height));
  if (factor >= 1) return bitmap;
  const scaled = await createImageBitmap(bitmap, {
    resizeWidth: Math.floor(bitmap.width * factor),
    resizeHeight: Math.floor(bitmap.height * factor),
    resizeQuality: 'high',
  });
  bitmap.close();
  return scaled;
}

/**
 * Blue Marble Next Generation is published per month; pick the simulated month's. With
 * `plain`, the version without NASA's shaded relief — for lighting the terrain by the real
 * Sun instead (otherwise mountains would be shaded twice, once from a fixed light).
 */
export function dayTextureUrl(base: string, date: Date, plain = false): string {
  return `${base}textures/${plain ? 'surface' : 'day'}-${String(date.getUTCMonth() + 1).padStart(2, '0')}.jpg`;
}

/**
 * The Sun-lit globe's day texture: land from NASA's plain Blue Marble (no painted-on
 * shading, so the real Sun can light the terrain), water from the shaded version (the plain
 * one paints the open ocean a flat navy where the shaded one shows shelves and trenches in
 * blue). `mask` is the relief map: its blue channel is ETOPO's land, 0–255, soft at the coast.
 * Written into `plain`.
 */
export function blendLand(plain: Uint8ClampedArray, shaded: Uint8ClampedArray, mask: Uint8ClampedArray): void {
  for (let i = 0; i < plain.length; i += 4) {
    const land = mask[i + 2];
    if (land === 255) continue;
    const k = land / 255;
    plain[i] = shaded[i] + (plain[i] - shaded[i]) * k;
    plain[i + 1] = shaded[i + 1] + (plain[i + 1] - shaded[i + 1]) * k;
    plain[i + 2] = shaded[i + 2] + (plain[i + 2] - shaded[i + 2]) * k;
  }
}

/** Terrain slopes for the Sun-lit relief (ETOPO 2022; see scripts/make-relief.py). Ships with the app. */
export function reliefUrl(base: string): string {
  return `${base}relief.webp`;
}

export function nightTextureUrl(base: string): string {
  return `${base}textures/night.jpg`;
}
