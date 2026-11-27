/* sw.js — offline support: serve the app's own files from a local cache, refresh them in the background.
 * Requests to other sites (the Supabase cloud) are never cached. */
const CACHE = 'course-tracker-v32';

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(['./', './index.html'].map((u) => new Request(u, { cache: 'no-cache' })))));
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))));
  self.clients.claim();
});

// "עדכן עכשיו" (schema-guard.js): a worker that is still waiting takes over now. Each release has its own cache name,
// so the page reloaded after the switch gets every file from the new release, never a mix with the old one.
self.addEventListener('message', (e) => {
  if (e.data && e.data.type === 'SKIP_WAITING') self.skipWaiting();
});

// stale-while-revalidate for same-origin GET requests
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  e.respondWith(caches.open(CACHE).then(async (cache) => {
    const cached = await cache.match(req, { ignoreSearch: true });
    // 'no-cache' = always ask the server (a cheap 304 when nothing changed), so a new release isn't hidden
    // behind the browser's HTTP cache (GitHub Pages sends max-age=600)
    const network = fetch(req, { cache: 'no-cache' }).then((res) => {
      if (res.ok) cache.put(req, res.clone());
      return res;
    }).catch(() => cached);
    return cached || network;
  }));
});
