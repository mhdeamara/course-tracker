// Release upgrade: production (sw v27) -> working tree, same origin, synthetic data. env: SWSITE (served dir).
// usage: node tests/browser/suites/upgrade.mjs <site> <cdpPort>   (normally started by tests/browser/run.mjs)
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { CHROME, CHROME_ARGS, workDir, SEED } from '../lib/env.mjs';
import { attachSW } from '../lib/swattach.mjs';
const DIR = workDir('upgrade');
const [SITE, PORT] = process.argv.slice(2);
const SHOTS = path.join(DIR, 'shotsG'); fs.mkdirSync(SHOTS, { recursive: true });
const prof = path.join(DIR, 'pe' + (Date.now() % 10000));
const chrome = spawn(CHROME, [...CHROME_ARGS, '--headless=new', `--user-data-dir=${prof}`, '--lang=he-IL',
  `--remote-debugging-port=${PORT}`, '--no-first-run', '--no-default-browser-check', '--hide-scrollbars', 'about:blank'], { stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let tg;
for (let i = 0; i < 60 && !tg; i++) { await sleep(300); try { tg = (await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()).find((x) => x.type === 'page'); } catch (e) { /* not up */ } }
await attachSW(PORT);
const ws = new WebSocket(tg.webSocketDebuggerUrl);
await new Promise((r) => { ws.onopen = r; });
let id = 0; const pend = new Map(); const errs = [];
ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && pend.has(d.id)) { pend.get(d.id)(d); pend.delete(d.id); }
  else if (d.method === 'Runtime.exceptionThrown') errs.push(d.params.exceptionDetails.exception?.description || d.params.exceptionDetails.text);
  else if (d.method === 'Runtime.consoleAPICalled' && (d.params.type === 'error' || (d.params.type === 'warning' && /i18n/.test(JSON.stringify(d.params.args))))) errs.push('console: ' + d.params.args.map((a) => a.value || a.description).join(' ')); };
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); }).then((d) => { if (d.error) throw new Error(method + ' ' + JSON.stringify(d.error)); return d.result; });
const ev = async (expr) => { const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text); return r.result.value; };
const J = async (expr) => JSON.parse(await ev(`JSON.stringify(${expr})`));
const view = (w, h) => send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: w < 768 });
const results = []; const ok = (name, pass, info = '') => { results.push([pass ? 'PASS' : 'FAIL', name, info]); console.log(pass ? 'PASS' : 'FAIL', name, pass ? '' : info); };
const go = async (h) => { await ev(`location.hash = ${JSON.stringify(h)}; 1`); await sleep(300); };
const reload = async () => { await send('Page.reload'); await sleep(1400); };
const key = (k, extra = '') => ev(`(document.activeElement || document).dispatchEvent(new KeyboardEvent('keydown', { key: ${JSON.stringify(k)}, bubbles: true ${extra} })); 1`);
const click = (sel) => ev(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return false; e.click(); return true; })()`);
const shot = async (name) => fs.writeFileSync(path.join(SHOTS, name + '.jpg'), Buffer.from((await send('Page.captureScreenshot', { format: 'jpeg', quality: 80 })).data, 'base64'));
const closeOverlays = () => ev(`document.querySelectorAll('.modal-backdrop').forEach(m => m.remove()); CT.ui.closeMenu && CT.ui.closeMenu(); 1`);
// Hebrew text inside #main that is interface (not user / Moodle content, which is always in dir=auto / inputs / tags)
const USER = `const st = CT.store.state; const user = [...st.semesters.map(x=>x.name), ...st.courses.flatMap(c => [c.name, c.staff, ...(c.exams||[]).map(e=>e.label), ...(c.grade.components||[]).map(x=>x.name), ...(c.schedule||[]).map(x=>x.room), ...c.categories.flatMap(k => [k.name, ...k.items.flatMap(i => [i.title, i.note, ...i.tags])])]), ...(CT.catalog && CT.catalog.ready ? CT.catalog.groups.map(g => g.name) : [])].filter(Boolean).sort((a,b)=>b.length-a.length); const strip = (v) => { v = v.replace(/⁨[^⁩]*⁩/g, ''); user.forEach(x => { v = v.split(x).join(''); }); return v; };`;
const HEB_UI = `(() => { const out = []; ${USER} const w = document.createTreeWalker(document.getElementById('main'), NodeFilter.SHOW_TEXT);
  while (w.nextNode()) { const n = w.currentNode; if (!/[\\u0590-\\u05FF]/.test(strip(n.textContent))) continue; const p = n.parentElement;
    if (p.closest('[dir=auto],bdi,textarea,option,select,.tag,[lang=ar],.lang-opt [lang],[lang=he],.c-art,.cw-kv,.note-print,.note-preview,.nb-body')) continue; out.push(n.textContent.trim().slice(0, 40)); }
  document.querySelectorAll('#main [aria-label],#main [title],#main [placeholder]').forEach((e) => ['aria-label','title','placeholder'].forEach((a) => { const v = e.getAttribute(a); if (v && /[\\u0590-\\u05FF]/.test(strip(v)) &&!e.closest('[data-keep]') ) out.push(a + ':' + v.slice(0, 40)); }));
  return out; })()`;


// --- release audit: production 2e56e02 (sw v27) -> release candidate f151425 (sw v36), same origin, synthetic data ---
import { deploy as deploySite, clear, WORKTREE } from '../lib/site.mjs';
const SWSITE = process.env.SWSITE, PROD = process.env.CT_PROD_REV || '2e56e02', RC = WORKTREE; // production release vs. this working tree
const deploy = (rev, opt) => deploySite(SWSITE, rev, opt);
const caches = () => ev(`caches.keys().then(k => k.filter(x => x.startsWith('course-tracker')).sort().join())`);
// the running worker: each version deletes every other cache on activate, so a single cache name = that version is
// active; two names = the newer one is installed/installing but not active (fetching sw.js would show the server file)
const swScript = async () => { const k = (await caches()).split(',').filter(Boolean); return k.length === 1 ? k[0] : 'not-settled:' + k.join('+'); };
const settle = async () => { // a normal visit: navigation (+ update check), give the new worker time, then one more load
  await reload();
  await ev(`navigator.serviceWorker.getRegistration().then(g => g && g.update()).catch(() => 0).then(() => 1)`);
  await sleep(2500); await reload(); await sleep(500);
};
const snapshotLS = () => J(`Object.fromEntries(Object.keys(localStorage).filter(k => k.startsWith('ct.')).sort().map(k => [k, localStorage.getItem(k)]))`);
const cmp = (a, b) => { // every ct.* key equal; ct.data.v1 equal except meta.updatedAt
  const diff = [];
  Object.keys(a).forEach((k) => { // keys that existed before must survive; keys the new app creates are fine
    if (k === 'ct.data.v1') { const A = JSON.parse(a[k]), B = JSON.parse(b[k] || 'null'); if (!B) return diff.push(k + ' missing'); A.meta.updatedAt = B.meta.updatedAt = 0; if (JSON.stringify(A) !== JSON.stringify(B)) diff.push(k); }
    else if (a[k] !== b[k] && !['ct.update.at', 'ct.lang'].includes(k)) diff.push(k + ': ' + String(a[k]).slice(0, 30) + ' -> ' + String(b[k]).slice(0, 30));
  });
  return diff;
};
// a second tab on the same origin (its own CDP connection)
const tab = async (url) => {
  const t = await (await fetch(`http://127.0.0.1:${PORT}/json/new?${encodeURI(url)}`, { method: 'PUT' })).json();
  const w = new WebSocket(t.webSocketDebuggerUrl); await new Promise((r) => { w.onopen = r; });
  let i = 0; const pd = new Map(); const terrs = [];
  w.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && pd.has(d.id)) { pd.get(d.id)(d); pd.delete(d.id); } else if (d.method === 'Runtime.exceptionThrown') terrs.push(d.params.exceptionDetails.exception?.description || d.params.exceptionDetails.text); };
  const s = (method, params = {}) => new Promise((r) => { const k = ++i; pd.set(k, r); w.send(JSON.stringify({ id: k, method, params })); });
  await s('Runtime.enable');
  return { ev: async (e) => (await s('Runtime.evaluate', { expression: e, awaitPromise: true, returnByValue: true })).result.result?.value, errs: terrs, close: () => fetch(`http://127.0.0.1:${PORT}/json/close/${t.id}`) };
};
// synthetic profile: data + every preference / backup / auth / Moodle-mapping key the production app uses
const seedAll = async () => {
  await ev(`localStorage.clear(); 1`);
  await ev(fs.readFileSync(SEED, 'utf8'));
  await ev(`(() => { const d = JSON.parse(localStorage.getItem('ct.data.v1')); const c = d.courses[0];
    d.moodle = Object.assign(d.moodle || {}, { map: { 'SYN-101 Synthetic': c.id }, uidMap: { 'uid-syn-1@moodle': c.id }, classMap: { 'syn tutorial': 'tutorial' }, ignored: { 'uid-syn-2@moodle': true } });
    localStorage.setItem('ct.data.v1', JSON.stringify(d));
    const set = { 'ct.theme': 'dark', 'ct.motion': 'reduced', 'ct.sound': '1', 'ct.moodle.hasFeed': '1', 'ct.nudge': '{"syn":1}', 'ct.penSeen': '2026-11-01',
      'ct.auth': JSON.stringify({ access_token: 'synthetic', refresh_token: 'synthetic', expires_at: 0, user: { id: '00000000-0000-0000-0000-000000000000', email: 'test@example.invalid' } }),
      'ct.ai.chat': JSON.stringify([{ role: 'user', text: 'synthetic question' }]), 'ct.backup.pre-v3': JSON.stringify({ version: 2, courses: [], semesters: [] }),
      'ct.sync': JSON.stringify({ version: 7, at: '2026-11-20T10:00:00.000Z' }) };
    Object.entries(set).forEach(([k, v]) => localStorage.setItem(k, v)); return 1; })()`);
};

await send('ServiceWorker.enable'); await send('Runtime.enable'); await send('Page.enable'); await send('Network.enable');
await view(1280, 860);

/* ===== A) normal upgrade, one tab ===== */
deploy(PROD);
await send('Page.navigate', { url: SITE }); await sleep(1500);
await ev('Promise.race([navigator.serviceWorker.ready.then(() => 1), new Promise((r) => setTimeout(() => r(0), 8000))])'); await sleep(400);
await seedAll(); await reload();
ok('A prod: v27 worker + cache', (await swScript()) === 'course-tracker-v27' && (await caches()) === 'course-tracker-v27', await caches());
const xp0 = await ev(`JSON.stringify([CT.game.levelXP(CT.store.state), CT.store.state.game.ledger.length])`).catch(() => null);
const before = await snapshotLS();
deploy(RC);
await settle();
ok('A rc: v36 worker active', (await swScript()) === 'course-tracker-v36', await swScript());
ok('A rc: only the v36 cache remains', (await caches()) === 'course-tracker-v36', await caches());
const after = await snapshotLS();
const dA = cmp(before, after);
ok('A rc: academic data, XP ledger, Moodle mappings, preferences, backups, auth and chat preserved', dA.length === 0, dA.join(' ; '));
ok('A rc: XP total unchanged', (await ev(`JSON.stringify([CT.game.levelXP(CT.store.state), CT.store.state.game.ledger.length])`).catch(() => null)) === xp0);
ok('A rc: Moodle mappings still applied', await ev(`CT.store.state.moodle.map['SYN-101 Synthetic'] === CT.store.state.courses[0].id && CT.store.state.moodle.classMap['syn tutorial'] === 'tutorial'`));
ok('A rc: theme preference honoured (dark)', await ev(`document.documentElement.dataset.theme === 'dark'`));
{ const L = await J(`[CT.i18n.lang(), localStorage.getItem('ct.lang'), document.documentElement.lang]`); ok('A rc: existing user stays in Hebrew', L[0] === 'he' && L[2] === 'he' && (L[1] === null || L[1] === 'he'), JSON.stringify(L)); }
ok('A rc: not read-only locked', await ev(`!(CT.guard && CT.guard.locked())`));
for (const r of ['#/', '#/courses', '#/grades', '#/moodle', '#/xp', '#/settings']) { await go(r); }
ok('A rc: no runtime errors after upgrade', errs.length === 0, errs.join(' | '));
errs.length = 0;

/* ===== B) stale client: two tabs on production, RC deployed, one tab reloads ===== */
deploy(PROD);
await send('Network.clearBrowserCache');
await ev(`navigator.serviceWorker.getRegistrations().then(rs => Promise.all(rs.map(r => r.unregister()))).then(() => caches.keys()).then(k => Promise.all(k.map(x => caches.delete(x)))).then(() => 1)`);
await reload(); await sleep(1200); await reload();
await seedAll(); await reload();
ok('B prod: tab 1 on v27', (await swScript()) === 'course-tracker-v27');
const t2 = await tab(SITE + '#/courses'); await sleep(2000);
ok('B prod: tab 2 runs the old app', await t2.ev(`typeof CT === 'object' && !CT.i18n`));
deploy(RC);
await settle(); // tab 1 gets the new worker; skipWaiting + claim also takes over tab 2
ok('B rc: tab 1 on v36', (await swScript()) === 'course-tracker-v36');
await sleep(800);
ok('B: stale tab 2 now controlled by the new worker, still running old code', await t2.ev(`!!navigator.serviceWorker.controller && !CT.i18n`));
// the stale tab edits something (same schema 4): the new tab must see it, nothing lost or locked
await t2.ev(`(() => { const it = CT.store.state.courses.flatMap(c => c.categories.flatMap(k => k.items))[0]; CT.store.setStatus(it.id, 'doing'); return it.id; })()`);
await sleep(300); await reload();
ok('B: edit from the stale tab is visible in the new app', await ev(`CT.store.state.courses.flatMap(c => c.categories.flatMap(k => k.items))[0].status === 'doing'`));
ok('B: new app not locked by data from the old tab', await ev(`!(CT.guard && CT.guard.locked())`));
await ev(`CT.store.commit('probe', (s) => { s.courses.flatMap(c => c.categories.flatMap(k => k.items))[0].status = 'review'; }); 1`).catch(() => null);
await sleep(300);
await t2.ev(`location.hash = '#/grades'; 1`); await sleep(600);
ok('B: stale tab keeps working (route render, no exceptions)', t2.errs.length === 0, t2.errs.join(' | '));
ok('B: stale tab does not overwrite the newer edit on its own', await ev(`JSON.parse(localStorage.getItem('ct.data.v1')).courses.flatMap(c => c.categories.flatMap(k => k.items))[0].status === 'review'`));
await t2.close();
errs.length = 0;

/* ===== C) offline: production cached, the network gone (no server files at all), then back with the release ===== */
deploy(PROD);
await ev(`navigator.serviceWorker.getRegistrations().then(rs => Promise.all(rs.map(r => r.unregister()))).then(() => caches.keys()).then(k => Promise.all(k.map(x => caches.delete(x)))).then(() => 1)`);
await reload(); await sleep(1200); await reload(); await sleep(1500); await reload();
await seedAll(); await reload();
const cBefore = await snapshotLS();
clear(SWSITE); // offline: only the service worker cache can answer
await reload(); await sleep(800);
{ const c = await J(`({ main: !!document.querySelector('#main *'), n: window.CT && CT.store && CT.store.state ? CT.store.state.courses.length : -1 })`); ok('C offline: production opens from its cache with the data', c.main && c.n > 0, JSON.stringify(c) + ' ' + await caches()); }
deploy(RC); // back online, the release is live
await settle();
ok('C back online: upgrades to v36', (await swScript()) === 'course-tracker-v36' && (await caches()) === 'course-tracker-v36', await caches());
const dC = cmp(cBefore, await snapshotLS());
ok('C: data preserved through the offline period and the upgrade', dC.length === 0, dC.join(' ; '));
clear(SWSITE);
await reload();
ok('C: offline after the upgrade opens the new app from v36', await ev(`!!CT.i18n.localized && CT.store.state.courses.length > 0`));
deploy(RC);
errs.length = 0;

/* ===== D) incomplete upload (index.html missing) while production is active ===== */
deploy(PROD);
await ev(`navigator.serviceWorker.getRegistrations().then(rs => Promise.all(rs.map(r => r.unregister()))).then(() => caches.keys()).then(k => Promise.all(k.map(x => caches.delete(x)))).then(() => 1)`);
await reload(); await sleep(1200); await reload();
await seedAll(); await reload();
const dBefore = await snapshotLS();
deploy(RC, { without: ['index.html'] });
await reload(); await ev(`navigator.serviceWorker.getRegistration().then(g => g && g.update()).catch(() => 0).then(() => 1)`); await sleep(2500); await reload();
ok('D partial deploy: v36 install fails, v27 stays active, no partial v36 cache', (await caches()) === 'course-tracker-v27', await caches());
// what the page runs here is decided by the production worker already installed on users' devices (v27 refreshes its
// cache file by file), so this load is reported, not asserted; from v36 on, scenario G covers the same case
{ const c = await J(`({ main: !!document.querySelector('#main *'), n: window.CT && CT.store && CT.store.state ? CT.store.state.courses.length : -1 })`); console.log('INFO D load under the v27 worker during the partial upload:', JSON.stringify(c), errs.length + ' errors'); }
const dD = cmp(dBefore, await snapshotLS()); ok('D partial deploy: localStorage unchanged', dD.length === 0, dD.join(' ; '));
deploy(RC);
await settle();
ok('D complete deploy: recovers to v36', (await swScript()) === 'course-tracker-v36' && (await caches()) === 'course-tracker-v36', await caches());
errs.length = 0;

/* ===== E) rollback: RC live, production files redeployed ===== */
const eBefore = await snapshotLS();
deploy(PROD);
await settle();
ok('E rollback: the old worker takes over (v27), v36 cache removed', (await swScript()) === 'course-tracker-v27' && (await caches()) === 'course-tracker-v27', await caches());
const dE = cmp(eBefore, await snapshotLS());
ok('E rollback: data written by the RC opens in production unchanged', dE.length === 0, dE.join(' ; '));
ok('E rollback: production app is not read-only locked by RC data', await ev(`!(CT.guard && CT.guard.locked())`));
ok('E rollback: production app runs (routes render, no errors)', (await (async () => { for (const r of ['#/', '#/courses', '#/grades', '#/xp']) await go(r); return errs.length === 0; })()), errs.join(' | '));
// roll forward again
deploy(RC); await settle();
ok('E roll forward: back on v36', (await swScript()) === 'course-tracker-v36');

/* ===== F) offline immediately after the first online visit with the new release ===== */
deploy(PROD);
await ev(`navigator.serviceWorker.getRegistrations().then(rs => Promise.all(rs.map(r => r.unregister()))).then(() => caches.keys()).then(k => Promise.all(k.map(x => caches.delete(x)))).then(() => 1)`);
await reload(); await sleep(1200); await reload(); await sleep(1500); await reload();
await seedAll(); await reload();
const fBefore = await snapshotLS();
deploy(RC);
await reload(); await sleep(4000); // one online visit: the browser finds the new sw.js and installs it in the background
const fCaches = await caches();
const fEntries = await ev(`caches.open('course-tracker-v36').then(c => c.keys()).then(r => r.length)`);
ok('F one online visit: v36 installed completely', fCaches === 'course-tracker-v36' && fEntries >= 50, fCaches + ' ' + fEntries + ' entries');
clear(SWSITE); errs.length = 0; // the user closes the app and opens it later without a network
await reload(); await sleep(800);
{ const c = await J(`({ main: !!document.querySelector('#main *'), n: window.CT && CT.store && CT.store.state ? CT.store.state.courses.length : -1, i18n: !!(window.CT && CT.i18n) })`); ok('F offline right after: the new app starts with the data', c.main && c.n > 0 && c.i18n, JSON.stringify(c)); }
for (const r of ['#/courses', '#/grades', '#/catalog', '#/xp', '#/adhkar', '#/settings']) await go(r);
ok('F offline right after: every route renders, no errors (fonts, catalog, adhkar data cached)', errs.length === 0, errs.slice(0, 2).join(' | '));
const dF = cmp(fBefore, await snapshotLS()); ok('F: data preserved', dF.length === 0, dF.join(' ; '));
deploy(RC); errs.length = 0;

/* ===== from here on the active worker is v36: the next release meets the new install/fetch logic ===== */
// a synthetic "next release" = this working tree with another cache name and markers in index.html and js/app.js, so a
// page can tell whether its HTML and its scripts come from the same release
const next = (tag, opt = {}) => {
  deploy(RC, opt);
  const p = (f, fn) => { const x = path.join(SWSITE, f); if (fs.existsSync(x)) fs.writeFileSync(x, fn(fs.readFileSync(x, 'utf8'))); };
  p('sw.js', (t) => t.replace("'course-tracker-v36'", `'course-tracker-v36-${tag}'`));
  p('index.html', (t) => t.replace('</head>', `<meta name="ct-test-release" content="${tag}">\n</head>`));
  p('js/app.js', (t) => t + `\nwindow.__ctRelease = '${tag}';\n`);
};
const release = () => J(`({ html: (document.querySelector('meta[name=ct-test-release]') || {}).content || 'v36', js: window.__ctRelease || 'v36', started: !!document.querySelector('#main *'), i18n: !!(window.CT && CT.i18n) })`);
const delay = (ms) => fetch(new URL(`__test/delay?ms=${ms}`, SITE));
const waitCaches = async (want, ms = 60000) => { const t = Date.now(); while (Date.now() - t < ms) { if ((await caches()) === want) return true; await sleep(500); } return false; };

/* ===== G) incomplete next release: a script is missing on the server ===== */
errs.length = 0;
const gBefore = await snapshotLS();
next('g', { without: ['js/views/xp.js'] });
await reload(); await ev(`navigator.serviceWorker.getRegistration().then(g => g && g.update()).catch(() => 0).then(() => 1)`); await sleep(3000);
ok('G incomplete release: install fails, v36 stays the only cache (nothing half-written)', (await caches()) === 'course-tracker-v36', await caches());
let gMixed = 0;
for (let i = 0; i < 3; i++) { await reload(); const r = await release(); if (r.html !== 'v36' || r.js !== 'v36' || !r.started) gMixed++; }
ok('G incomplete release: every load runs the complete v36 release (no new HTML with old scripts or the reverse)', gMixed === 0, gMixed + ' mixed loads');
for (const r of ['#/xp', '#/courses', '#/grades']) await go(r);
ok('G incomplete release: the app keeps working, no errors', errs.length === 0, errs.slice(0, 2).join(' | '));
next('g'); // the upload completes
await settle();
{ const r = await release(); ok('G complete release: upgrades, HTML and scripts from the same release', (await caches()) === 'course-tracker-v36-g' && r.html === 'g' && r.js === 'g' && r.started, JSON.stringify(r) + ' ' + await caches()); }
const dG = cmp(gBefore, await snapshotLS()); ok('G: data preserved', dG.length === 0, dG.join(' ; '));
errs.length = 0;

/* ===== H) slow network: the next release downloads slowly while the app is in use ===== */
await delay(800); // every request 0.8 s
next('h');
await reload(); // served from the cache at once, the update check starts
await ev(`navigator.serviceWorker.getRegistration().then(g => { if (g) g.update().catch(() => 0); return 1; })`);
for (let i = 0; i < 40 && !(await ev(`navigator.serviceWorker.getRegistration().then(g => !!(g && g.installing))`)); i++) await sleep(250);
await go('#/courses'); await go('#/grades'); // the app in use while the new release downloads
{ const r = await release(); ok('H slow install in progress: the page runs one complete release', r.html === 'g' && r.js === 'g' && r.started && (await ev(`navigator.serviceWorker.getRegistration().then(g => !!g.installing)`)), JSON.stringify(r) + ' ' + await caches()); }
ok('H slow install: completes', await waitCaches('course-tracker-v36-h'), await caches());
await delay(0); await reload();
{ const r = await release(); ok('H after the slow install: the new release, consistent', r.html === 'h' && r.js === 'h' && r.started, JSON.stringify(r)); }
ok('H: no errors', errs.length === 0, errs.slice(0, 2).join(' | '));
errs.length = 0;

/* ===== I) interrupted update: the network drops in the middle of the install ===== */
await delay(1500); // each request 1.5 s: the install (index.html, its files, fonts/icons) takes several seconds
next('i');
await reload();
await ev(`navigator.serviceWorker.getRegistration().then(g => { if (g) g.update().catch(() => 0); return 1; })`); // not awaited: update() settles only after the install
for (let i = 0; i < 40 && !(await ev(`navigator.serviceWorker.getRegistration().then(g => !!(g && g.installing))`)); i++) await sleep(250);
ok('I: the new worker was still installing when the network dropped', await ev(`navigator.serviceWorker.getRegistration().then(g => !!(g && g.installing))`), await caches());
clear(SWSITE); await delay(0); // connection lost mid-download
await sleep(4000);
ok('I interrupted: install fails, the previous release stays the only cache', (await caches()) === 'course-tracker-v36-h', await caches());
await reload(); await sleep(500);
{ const r = await release(); ok('I interrupted, offline: the previous release opens complete', r.html === 'h' && r.js === 'h' && r.started, JSON.stringify(r)); }
next('i'); // back online
await settle();
{ const r = await release(); ok('I recovery: the next visit installs the release', (await caches()) === 'course-tracker-v36-i' && r.html === 'i' && r.js === 'i', JSON.stringify(r) + ' ' + await caches()); }
ok('I: no errors', errs.length === 0, errs.slice(0, 2).join(' | '));
deploy(RC); await settle();
ok('no request leaves this machine (test browser blocks every other host)', await ev(`fetch('https://example.com/', { mode: 'no-cors' }).then(() => false, () => true)`));
await shot('rel-final');
const fails = results.filter((r) => r[0] === 'FAIL').length;
console.log(`\n${results.length - fails}/${results.length} passed`);
ws.close(); chrome.kill(); process.exit(fails ? 1 : 0);
