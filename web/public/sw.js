// Service worker for the installed web app and the Android TWA: the app opens offline,
// shows the last textures it saw, and never serves stale layer data.
//
//   page (navigation)            network first, cached copy when offline
//   assets/ icons/ fonts         cache first (content-hashed or fixed)
//   stars.json manifest          cache first
//   textures/                    cache first (fixed NASA images, ~1–4 MB each)
//   everything else              straight to the network: every layer's latest.json and
//                                images, and all the third-party feeds
//
// Not registered inside the Capacitor app, whose files are local anyway.

const CACHE = 'xearth-shell-v1';
const SCOPE = new URL(self.registration.scope).pathname;
const CACHE_FIRST = /^(assets\/|icons\/|textures\/|stars\.json$|manifest\.webmanifest$)/;

self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      for (const key of await caches.keys()) if (key !== CACHE) await caches.delete(key);
      await self.clients.claim();
    })(),
  );
});

async function networkFirst(request) {
  const cache = await caches.open(CACHE);
  try {
    const response = await fetch(request);
    if (response.ok) cache.put(request, response.clone());
    return response;
  } catch (err) {
    const cached = await cache.match(request, { ignoreSearch: true });
    if (cached) return cached;
    throw err;
  }
}

async function cacheFirst(request) {
  const cache = await caches.open(CACHE);
  const cached = await cache.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok) cache.put(request, response.clone());
  return response;
}

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin || !url.pathname.startsWith(SCOPE)) return;
  if (request.mode === 'navigate') {
    event.respondWith(networkFirst(request));
    return;
  }
  if (CACHE_FIRST.test(url.pathname.slice(SCOPE.length))) event.respondWith(cacheFirst(request));
});
