// Service worker for the installed web app and the Android TWA: the app opens offline,
// shows the last textures it saw, and never serves stale layer data.
//
//   page (navigation)            network first, cached copy when offline
//   assets/                      cache first (content-hashed: a new build asks for new names)
//   icons/ textures/ relief.webp the cached copy, then checked with the server in the
//   stars.json manifest          background (a conditional request: a 304 unless it changed),
//                                so a changed file shows on the next load
//   everything else              straight to the network: every layer's latest.json and
//                                images, and all the third-party feeds
//
// Not registered inside the Capacitor app, whose files are local anyway.

const CACHE = 'xearth-shell-v1';
const SCOPE = new URL(self.registration.scope).pathname;
const HASHED = /^assets\//;
const REVALIDATED = /^(icons\/|textures\/|relief\.webp$|stars\.json$|manifest\.webmanifest$)/;

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

async function fromNetwork(cache, request) {
  const response = await fetch(request);
  if (response.ok) cache.put(request, response.clone());
  return response;
}

async function cacheFirst(request) {
  const cache = await caches.open(CACHE);
  return (await cache.match(request)) ?? fromNetwork(cache, request);
}

// URLs already checked with the server while this worker has been running.
const checked = new Set();

async function revalidate(cache, request, cached) {
  // The cached copy's own validators, rather than the HTTP cache's (which may have let a
  // 4 MB texture go): unchanged costs a 304.
  const headers = new Headers();
  const etag = cached.headers.get('ETag');
  const modified = cached.headers.get('Last-Modified');
  if (etag) headers.set('If-None-Match', etag);
  if (modified) headers.set('If-Modified-Since', modified);
  const response = await fetch(request.url, { headers, cache: 'no-store' });
  if (response.ok) await cache.put(request, response);
}

async function staleWhileRevalidate(event, request) {
  const cache = await caches.open(CACHE);
  const cached = await cache.match(request);
  if (!cached) return fromNetwork(cache, request);
  if (!checked.has(request.url)) {
    checked.add(request.url);
    event.waitUntil(revalidate(cache, request, cached).catch(() => checked.delete(request.url)));
  }
  return cached;
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
  const path = url.pathname.slice(SCOPE.length);
  if (HASHED.test(path)) event.respondWith(cacheFirst(request));
  else if (REVALIDATED.test(path)) event.respondWith(staleWhileRevalidate(event, request));
});
