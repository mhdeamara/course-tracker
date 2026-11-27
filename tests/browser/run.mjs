// Runs the browser suites in headless Chrome against local copies of the app (synthetic data, no network).
//   node tests/browser/run.mjs                 every suite
//   node tests/browser/run.mjs upgrade a11y    only these
// env: CHROME (browser binary), CT_BROWSER_TMP (work folder, default <os temp>/ct-browser), CT_BROWSER_PORT (first
// local port, default 8790), CT_PROD_REV (the release the upgrade suites start from, default 2e56e02 = sw v27),
// CT_BROWSER_KEEP=1 (keep the previous run's work folder). See README → "בדיקות דפדפן".
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CHROME, TMP, assertLocal } from './lib/env.mjs';
import { deploy, WORKTREE } from './lib/site.mjs';
import { serve } from './lib/serve.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
// suite → runs (one per language argument; [] = one run without); own: needs a site folder it may redeploy
const SUITES = {
  routes: { langs: ['he', 'en'] },
  notifications: { langs: ['he', 'en'] },
  'stage-d': {}, 'stage-e': {}, 'stage-f': {}, 'stage-g': {}, i18n: {},
  a11y: {}, 'targets-focus': {}, 'extension-popup': {},
  upgrade: { own: true },
  'first-load': { own: true, env: { N: process.env.N || '3', OFF: '1' } },
};
const pick = process.argv.slice(2);
const unknown = pick.filter((s) => !SUITES[s]);
if (unknown.length) { console.error('unknown suite(s): ' + unknown.join(', ') + '\nknown: ' + Object.keys(SUITES).join(', ')); process.exit(2); }
if (!fs.existsSync(CHROME)) { console.error(`Chrome not found at ${CHROME} — set CHROME to the browser binary`); process.exit(2); }

if (!process.env.CT_BROWSER_KEEP) fs.rmSync(TMP, { recursive: true, force: true });
fs.mkdirSync(TMP, { recursive: true });
let port = +(process.env.CT_BROWSER_PORT || 8790);
const servers = [];
const site = async (name) => {
  const dir = path.join(TMP, name);
  deploy(dir, WORKTREE);
  const p = port++; servers.push(await serve(dir, p));
  const url = `http://127.0.0.1:${p}/`; assertLocal(url);
  return { dir, url };
};

const shared = await site('site');
const rows = [];
let cdp = 9400;
for (const name of (pick.length ? pick : Object.keys(SUITES))) {
  const s = SUITES[name];
  const target = s.own ? await site(name + '-site') : shared;
  for (const lang of (s.langs || [null])) {
    const label = name + (lang ? ' ' + lang : '');
    const args = [path.join(HERE, 'suites', name + '.mjs'), target.url, String(cdp++), ...(lang ? [lang] : [])];
    const out = path.join(TMP, name, `output${lang ? '-' + lang : ''}.txt`);
    fs.mkdirSync(path.dirname(out), { recursive: true });
    const log = fs.createWriteStream(out);
    console.log(`\n=== ${label}`);
    const t0 = Date.now();
    const code = await new Promise((res) => {
      const ch = spawn(process.execPath, args, { env: { ...process.env, SWSITE: target.dir, ...(s.env || {}) }, stdio: ['ignore', 'pipe', 'pipe'] });
      const kill = setTimeout(() => { log.write('\nTIMEOUT\n'); ch.kill(); }, 15 * 60e3);
      ch.stdout.on('data', (d) => { process.stdout.write(d); log.write(d); });
      ch.stderr.on('data', (d) => { process.stderr.write(d); log.write(d); });
      ch.on('close', (c) => { clearTimeout(kill); log.end(); res(c); });
    });
    const text = fs.readFileSync(out, 'utf8');
    const fails = (text.match(/^FAIL /gm) || []).length, passes = (text.match(/^PASS /gm) || []).length;
    rows.push({ label, code, passes, fails, secs: Math.round((Date.now() - t0) / 1000) });
  }
}
servers.forEach((s) => s.close());
console.log('\n=== summary (work folder: ' + TMP + ')');
rows.forEach((r) => console.log(`${r.code === 0 && !r.fails ? 'ok  ' : 'FAIL'}  ${r.label.padEnd(22)} ${String(r.passes).padStart(4)} pass ${String(r.fails).padStart(3)} fail  exit ${r.code}  ${r.secs}s`));
process.exit(rows.some((r) => r.code !== 0 || r.fails) ? 1 : 0);
