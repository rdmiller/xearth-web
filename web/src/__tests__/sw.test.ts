/// <reference types="node" />
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { describe, expect, it, vi } from 'vitest';

// public/sw.js as the browser runs it, with Cache Storage and the network faked.
const source = readFileSync(new URL('../../public/sw.js', import.meta.url), 'utf8');
const ORIGIN = 'https://xearth.example';
const SCOPE = `${ORIGIN}/app/`;

type Handler = (event: FakeEvent) => void;
interface FakeEvent {
  request: Request;
  respondWith(p: Promise<Response>): void;
  waitUntil(p: Promise<unknown>): void;
}

function worker(network: (url: string, headers: Headers) => Response) {
  const store = new Map<string, Response>();
  const cache = {
    match: async (req: Request | string) => store.get(typeof req === 'string' ? req : req.url)?.clone(),
    put: async (req: Request | string, res: Response) => void store.set(typeof req === 'string' ? req : req.url, res.clone()),
  };
  const fetch = vi.fn(async (req: Request | string, init?: RequestInit) => {
    const url = typeof req === 'string' ? req : req.url;
    return network(url, new Headers(init?.headers ?? (typeof req === 'string' ? undefined : req.headers)));
  });
  const handlers: Record<string, Handler> = {};
  const self = {
    registration: { scope: SCOPE },
    location: new URL(SCOPE),
    addEventListener: (type: string, h: Handler) => (handlers[type] = h),
    skipWaiting: () => {},
    clients: { claim: async () => {} },
  };
  const caches = { open: async () => cache, keys: async () => [], delete: async () => true };
  runInNewContext(source, { self, caches, fetch, URL, Headers, Response, Request, Set, console });

  /** A page's GET: what the worker answered with (undefined: left to the browser), once its background work is done. */
  async function get(path: string): Promise<string | undefined> {
    let response: Promise<Response> | undefined;
    const pending: Promise<unknown>[] = [];
    handlers.fetch({ request: new Request(SCOPE + path), respondWith: (p) => (response = p), waitUntil: (p) => pending.push(p) });
    const body = response && (await (await response).text());
    await Promise.all(pending);
    return body;
  }
  return { get, fetch, store };
}

const ok = (body: string, etag: string) => new Response(body, { status: 200, headers: { ETag: etag } });
const notModified = () => new Response(null, { status: 304 });

describe('service worker', () => {
  it('serves content-hashed assets from the cache without asking the network again', async () => {
    const w = worker(() => ok('bundle', '"a"'));
    expect(await w.get('assets/index-abc123.js')).toBe('bundle');
    expect(await w.get('assets/index-abc123.js')).toBe('bundle');
    expect(w.fetch).toHaveBeenCalledTimes(1);
  });

  it('picks up a rebuilt stars.json on the next load, though its name stays the same', async () => {
    let version = 1;
    const w = worker((_url, headers) => (headers.get('If-None-Match') === `"v${version}"` ? notModified() : ok(`stars v${version}`, `"v${version}"`)));
    expect(await w.get('stars.json')).toBe('stars v1');
    version = 2; // a new deploy
    expect(await w.get('stars.json')).toBe('stars v1'); // the cached copy at once, checked behind it
    expect(w.fetch).toHaveBeenCalledTimes(2);
    expect(new Headers(w.fetch.mock.calls[1][1]?.headers).get('If-None-Match')).toBe('"v1"');
    expect(await w.store.get(`${SCOPE}stars.json`)?.clone().text()).toBe('stars v2');
  });

  it('keeps the cached copy when the server says it has not changed, and checks each URL once', async () => {
    const w = worker((_url, headers) => (headers.get('If-None-Match') === '"t1"' ? notModified() : ok('texture', '"t1"')));
    expect(await w.get('textures/blue-marble.jpg')).toBe('texture');
    expect(await w.get('textures/blue-marble.jpg')).toBe('texture');
    expect(await w.get('textures/blue-marble.jpg')).toBe('texture');
    expect(w.fetch).toHaveBeenCalledTimes(2); // the first load, then one 304
    expect(await w.store.get(`${SCOPE}textures/blue-marble.jpg`)?.clone().text()).toBe('texture');
  });

  it('serves the cached copy offline', async () => {
    let online = true;
    const w = worker(() => {
      if (!online) throw new TypeError('Failed to fetch');
      return ok('icon', '"i"');
    });
    expect(await w.get('icons/icon-192.png')).toBe('icon');
    online = false;
    expect(await w.get('icons/icon-192.png')).toBe('icon');
  });

  it('leaves layer data to the network', async () => {
    const w = worker(() => ok('{}', '"x"'));
    expect(await w.get('clouds/latest.json')).toBeUndefined();
    expect(await w.get('satellites/latest.json')).toBeUndefined();
    expect(w.fetch).not.toHaveBeenCalled();
  });
});
