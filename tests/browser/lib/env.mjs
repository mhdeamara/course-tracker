// Shared settings for the browser suites: where Chrome is, where temporary files go, the synthetic data fixture,
// and the Chrome flags that keep every test on this machine.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const REPO = path.resolve(HERE, '..', '..', '..');
export const SEED = path.join(HERE, '..', 'fixtures', 'seed.js');

/** Chrome / Chromium binary: $CHROME, else the usual install path for this platform. */
export const CHROME = process.env.CHROME || ({
  win32: path.join(process.env.PROGRAMFILES || 'C:\\Program Files', 'Google', 'Chrome', 'Application', 'chrome.exe'),
  darwin: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
}[process.platform] || 'google-chrome');

/** Root for profiles, served site copies, screenshots and result files ($CT_BROWSER_TMP, else the OS temp dir).
 * Kept short on purpose: Chrome's cache storage fails on Windows when the profile path passes MAX_PATH. */
export const TMP = process.env.CT_BROWSER_TMP || path.join(os.tmpdir(), 'ct-browser');

/** A per-suite folder under TMP (created if needed). */
export const workDir = (name) => { const d = path.join(TMP, name); fs.mkdirSync(d, { recursive: true }); return d; };

/* No network beyond this machine: every host name except localhost/127.0.0.1 resolves to "not found", for pages and
 * service workers alike. Together with the empty CT_CONFIG of the served copy (lib/site.mjs), the app cannot reach
 * Supabase, the AI function or any other production service. */
export const CHROME_ARGS = [
  '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE localhost, EXCLUDE 127.0.0.1',
  '--disable-background-networking', '--disable-component-update', '--disable-sync', '--no-pings',
];

/** Refuse to run against anything but a local server. */
export function assertLocal(site) {
  const u = new URL(site);
  if (!['localhost', '127.0.0.1'].includes(u.hostname)) throw new Error(`browser tests only run against localhost, not ${u.hostname}`);
}
