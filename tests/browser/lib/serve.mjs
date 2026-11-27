// Minimal static server for a site copy (localhost only). 'no-cache' like a fresh GitHub Pages response, so every
// release a test deploys is seen at once. A missing file is a 404, as on a partial upload.
// Test hook: GET /__test/delay?ms=N makes every later response N ms slow (a slow network for page and service worker).
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css', '.json': 'application/json',
  '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.svg': 'image/svg+xml', '.woff2': 'font/woff2' };

/** Serve `root` on 127.0.0.1:`port`; resolves to the server once it listens. */
export function serve(root, port) {
  let delay = 0;
  const server = http.createServer((q, r) => {
    const url = new URL(q.url, 'http://127.0.0.1');
    if (url.pathname === '/__test/delay') { delay = Math.max(0, +url.searchParams.get('ms') || 0); r.writeHead(204); r.end(); return; }
    let p = decodeURIComponent(url.pathname);
    if (p.endsWith('/')) p += 'index.html';
    const f = path.join(root, p);
    if (!path.resolve(f).startsWith(path.resolve(root))) { r.writeHead(403); r.end(); return; }
    setTimeout(() => fs.readFile(f, (e, d) => {
      if (e) { r.writeHead(404); r.end(); return; }
      r.writeHead(200, { 'Content-Type': TYPES[path.extname(f)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
      r.end(d);
    }), delay);
  });
  return new Promise((res) => server.listen(port, '127.0.0.1', () => res(server)));
}
