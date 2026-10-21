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

/** Blue Marble Next Generation is published per month; pick the simulated month's. */
export function dayTextureUrl(base: string, date: Date): string {
  return `${base}textures/day-${String(date.getUTCMonth() + 1).padStart(2, '0')}.jpg`;
}

export function nightTextureUrl(base: string): string {
  return `${base}textures/night.jpg`;
}
