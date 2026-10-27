const worker = /** @type {ServiceWorkerGlobalScope} */ (/** @type {unknown} */ (globalThis));
const CACHE_NAME = 'achat-shell-v2';
const STATIC_ASSET_PATHS = ["/offline.html","/offline.css","/icon.svg","/manifest.webmanifest"];
const STATIC_ASSET_PREFIXES = ["/_next/static/"];
const OFFLINE_PATH = "/offline.html";

worker.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await worker.caches.open(CACHE_NAME);
    for (const path of STATIC_ASSET_PATHS) {
      const response = await worker.fetch(path, { credentials: 'omit', cache: 'no-store' });
      const storable = response.ok && !response.redirected && response.type === 'basic' && !/no-store|private/i.test(response.headers.get('Cache-Control') ?? '');
      if (!storable) throw new Error('SHELL_CACHE_REJECTED');
      await cache.put(path, response);
    }
    await worker.skipWaiting();
  })());
});

worker.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    for (const key of await worker.caches.keys()) {
      if (key.startsWith('achat-shell-') && key !== CACHE_NAME) await worker.caches.delete(key);
    }
    await worker.clients.claim();
  })());
});

worker.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== worker.location.origin) return;
  if (request.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        return await worker.fetch(request);
      } catch {
        const cache = await worker.caches.open(CACHE_NAME);
        return (await cache.match(OFFLINE_PATH)) ?? Response.error();
      }
    })());
    return;
  }
  if (!STATIC_ASSET_PATHS.includes(url.pathname) && !STATIC_ASSET_PREFIXES.some((prefix) => url.pathname.startsWith(prefix))) return;
  event.respondWith((async () => {
    const cache = await worker.caches.open(CACHE_NAME);
    const cached = await cache.match(request);
    if (cached !== undefined) return cached;
    const response = await worker.fetch(request);
    const storable = response.ok && !response.redirected && response.type === 'basic' && !/no-store|private/i.test(response.headers.get('Cache-Control') ?? '');
    if (storable) await cache.put(request, response.clone());
    return response;
  })());
});
