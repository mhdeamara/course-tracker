/* sw.js — offline support: serve the app's own files from a local cache, one complete release at a time.
 * Requests to other sites (the Supabase cloud) are never cached.
 *
 * Each release has its own cache. A new worker installs only when the whole release is in its cache: index.html,
 * every local file it references, the fonts its style sheets use, the manifest icons and the data files below. If any
 * of them fails to download, nothing is written, the install fails and the previous worker keeps serving its own
 * complete cache; the next visit tries again. Old caches are deleted only after the new one is complete. */
const CACHE = 'course-tracker-v36';
const EXTRA = ['./', './index.html', 'data/adhkar.json']; // needed offline but not referenced from index.html

/** Local files referenced by an HTML page (src/href) or a style sheet (url(...)), resolved against `base`. */
function localRefs(text, base, re) {
  const out = [];
  for (const m of text.matchAll(re)) {
    const ref = m[1].trim();
    if (!ref || ref.startsWith('#') || ref.startsWith('data:') || ref.startsWith('//')) continue;
    const url = new URL(ref, base);
    if (url.origin !== self.location.origin) continue;
    url.hash = '';
    out.push(url.href);
  }
  return out;
}

/** Download the complete release (fresh from the server, not the browser's HTTP cache), then store it in one go. */
async function precache() {
  const get = async (url) => {
    const res = await fetch(new Request(url, { cache: 'no-cache' }));
    if (!res.ok) throw new Error(`precache ${res.status} ${url}`);
    return res;
  };
  const root = new URL('./', self.location.href).href;
  const index = await get(new URL('./index.html', root).href);
  const html = await index.clone().text();
  const urls = new Set([...EXTRA.map((u) => new URL(u, root).href), ...localRefs(html, root, /\s(?:src|href)="([^"]+)"/g)]);
  const got = new Map();
  await Promise.all([...urls].map(async (u) => { got.set(u, await get(u)); }));
  // second level: fonts and images used by the style sheets, icons listed in the manifest
  const more = new Set();
  for (const [u, res] of got) {
    if (/\.css$/.test(new URL(u).pathname)) localRefs(await res.clone().text(), u, /url\(\s*['"]?([^'")]+\.woff2)['"]?\s*\)/g).forEach((x) => more.add(x));
    if (/\.webmanifest$/.test(new URL(u).pathname)) {
      try { (JSON.parse(await res.clone().text()).icons || []).forEach((i) => more.add(new URL(i.src, u).href)); } catch (e) { /* no icons */ }
    }
  }
  await Promise.all([...more].filter((u) => !got.has(u)).map(async (u) => { got.set(u, await get(u)); }));
  // everything downloaded: only now write (nothing is written when a download failed)
  const cache = await caches.open(CACHE);
  await Promise.all([...got].map(([u, res]) => cache.put(u, res)));
}

self.addEventListener('install', (e) => {
  e.waitUntil(caches.has(CACHE).then((existed) => precache().then(() => self.skipWaiting()).catch(async (err) => {
    // never leave half a release behind — but a cache that existed before (sw.js changed without a new CACHE name)
    // belongs to the running worker and is kept
    if (!existed) await caches.delete(CACHE);
    throw err;
  })));
});

self.addEventListener('activate', (e) => {
  // only reached after a complete install, so the caches deleted here are never the last working one
  e.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

// "עדכן עכשיו" (schema-guard.js): a worker that is still waiting takes over now. Each release has its own cache name,
// so the page reloaded after the switch gets every file from the new release, never a mix with the old one.
self.addEventListener('message', (e) => {
  if (e.data && e.data.type === 'SKIP_WAITING') self.skipWaiting();
});

// Same-origin GET requests: cache first. The cache holds one complete release, so a page always runs one release's
// files together. Cached files are not refreshed in the background — a refresh in the middle of a deploy would put the
// next release's files next to this release's index.html. New releases arrive only as a new worker with a new CACHE
// name (the browser compares sw.js byte for byte on every visit), which is why every frontend release bumps CACHE.
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  e.respondWith(caches.open(CACHE).then(async (cache) => {
    const cached = await cache.match(req, { ignoreSearch: true });
    if (cached) return cached;
    // not part of the precached release (e.g. a file loaded on demand, or another page such as the extension's):
    // from the server, kept for offline use. 'no-cache' = past the browser's HTTP cache (GitHub Pages sends max-age=600)
    try {
      const res = await fetch(req, { cache: 'no-cache' });
      if (res.ok) cache.put(req, res.clone());
      return res;
    } catch (err) {
      // offline: a page opened at another address inside the app still gets the cached app
      const shell = req.mode === 'navigate' ? await cache.match('./index.html') : undefined;
      if (shell) return shell;
      throw err;
    }
  }));
});
