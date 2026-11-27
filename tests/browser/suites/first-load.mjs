// First load after a release (production -> working tree): mixed old/new files, data writes, offline. env: SWSITE (served dir), N, SLOW, RACE, UPD, OFF, OFF2.
// usage: node tests/browser/suites/first-load.mjs <site> <cdpPort>   (normally started by tests/browser/run.mjs)
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { CHROME, CHROME_ARGS, workDir, SEED } from '../lib/env.mjs';
import { attachSW } from '../lib/swattach.mjs';
const DIR = workDir('first-load');
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


// --- how often does the first load after a release run mixed old/new files, and can such a load write data? ---
import { deploy as deploySite, clear, WORKTREE } from '../lib/site.mjs';
const SWSITE = process.env.SWSITE, PROD = process.env.CT_PROD_REV || '2e56e02', RC = WORKTREE; // production release vs. this working tree
const N = +(process.env.N || 8), SLOW = +(process.env.SLOW || 0);
const deploy = (rev, opt) => deploySite(SWSITE, rev, opt);
const caches = () => ev(`caches.keys().then(k => k.filter(x => x.startsWith('course-tracker')).sort().join())`);
await send('ServiceWorker.enable'); await send('Runtime.enable'); await send('Page.enable'); await send('Network.enable');
await view(1280, 860);
const rows = [], offline = [];
for (let i = 0; i < N; i++) {
  deploy(PROD);
  await send('Page.navigate', { url: SITE }); await sleep(1200);
  await ev(`navigator.serviceWorker.getRegistrations().then(rs => Promise.all(rs.map(r => r.unregister()))).then(() => caches.keys()).then(k => Promise.all(k.map(x => caches.delete(x)))).then(() => 1)`);
  await send('Network.clearBrowserCache');
  await reload(); await sleep(1500); await reload(); await sleep(800);
  await ev(`localStorage.clear(); 1`);
  await ev(fs.readFileSync(SEED, 'utf8'));
  await reload(); await sleep(600);
  const ok27 = (await caches()) === 'course-tracker-v27';
  const data0 = await ev(`localStorage.getItem('ct.data.v1')`);
  if (SLOW) await send('Network.emulateNetworkConditions', { offline: false, latency: SLOW, downloadThroughput: 200000, uploadThroughput: 100000 });
  if (process.env.RACE) { await send('Page.reload'); await sleep(+process.env.RACE); } // the deploy lands while this load is revalidating files
  deploy(RC);
  if (process.env.RACE) await sleep(2500);
  errs.length = 0;
  await reload(); if (process.env.UPD) { await ev(`navigator.serviceWorker.getRegistration().then(g => g && g.update()).catch(() => 0).then(() => 1)`); await sleep(2500); await reload(); } await sleep(SLOW ? 6000 : 2500); // first visit after the release (the update check runs during this load)
  const first = await J(`({ i18n: !!(window.CT && CT.i18n), started: !!document.querySelector('#main *'), ctl: !!navigator.serviceWorker.controller })`);
  const firstErrs = errs.length;
  if (process.env.OFF) { // the user closes the app after that one online visit and opens it later without a network
    const k1 = await caches();
    const files = await ev(`caches.open('course-tracker-v36').then(c => c.keys()).then(r => r.length)`);
    clear(SWSITE); // no server files: only the service worker cache can answer
    errs.length = 0; await reload(); await sleep(1500);
    const off = await J(`({ started: !!document.querySelector('#main *'), courses: window.CT && CT.store && CT.store.state ? CT.store.state.courses.length : -1 })`);
    offline.push(off.started && off.courses > 0); console.log('OFFLINE', JSON.stringify({ i, cachesAfterFirstVisit: k1, newEntries: files, offlineStarted: off.started, courses: off.courses, errors: errs.length }));
    deploy(RC);
  }
  const data1 = await ev(`localStorage.getItem('ct.data.v1')`);
  errs.length = 0;
  await reload(); await sleep(SLOW ? 6000 : 1500);
  const second = await J(`({ i18n: !!(window.CT && CT.i18n), started: !!document.querySelector('#main *') })`);
  if (process.env.OFF2) {
    const files = await ev(`caches.open('course-tracker-v36').then(c => c.keys()).then(r => r.length)`);
    clear(SWSITE);
    errs.length = 0; await reload(); await sleep(1500);
    const off = await J(`({ started: !!document.querySelector('#main *'), courses: window.CT && CT.store && CT.store.state ? CT.store.state.courses.length : -1, i18n: !!(window.CT && CT.i18n) })`);
    for (const r of ['#/courses', '#/grades', '#/xp', '#/settings']) { await go(r); }
    console.log('OFFLINE2', JSON.stringify({ i, newEntries: files, offlineStarted: off.started, newApp: off.i18n, courses: off.courses, errorsAcrossRoutes: errs.length, e: errs.slice(0, 1).join('').slice(0, 160) }));
    deploy(RC); errs.length = 0;
  }
  rows.push({ i, ok27, firstLoad: first.i18n ? 'new' : 'old', firstErrors: firstErrs, firstRendered: first.started, dataChangedOnFirst: data0 !== data1 && JSON.stringify(Object.assign(JSON.parse(data0).meta, { updatedAt: 0 })) !== 'x' ? (() => { const A = JSON.parse(data0), B = JSON.parse(data1); A.meta.updatedAt = B.meta.updatedAt = 0; return JSON.stringify(A) !== JSON.stringify(B); })() : false, secondLoad: second.i18n ? 'new' : 'old', secondErrors: errs.length, secondRendered: second.started, caches: await caches() });
  if (SLOW) await send('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
  console.log('ROW', JSON.stringify(rows[rows.length - 1]));
}
const mixed = rows.filter((r) => r.firstErrors > 0);
console.log(`SUMMARY runs=${rows.length} mixedFirstLoads=${mixed.length} dataChanged=${rows.filter((r) => r.dataChangedOnFirst).length} secondLoadErrors=${rows.filter((r) => r.secondErrors > 0).length} secondNotRendered=${rows.filter((r) => !r.secondRendered).length}`);
// whether a first load mixes files is decided by the production (v27) worker already on users' devices: reported above
ok(`first load: data never changed by the first load after the release (${rows.length} runs)`, rows.every((r) => !r.dataChangedOnFirst));
ok('second load: the new release, rendered, no errors', rows.every((r) => r.secondLoad === 'new' && r.secondRendered && !r.secondErrors));
if (process.env.OFF) ok('offline right after the first online visit: the app starts with the data', offline.length === rows.length && offline.every(Boolean), JSON.stringify(offline));
const fails = results.filter((r) => r[0] === 'FAIL').length;
console.log(`\n${results.length - fails}/${results.length} passed`);
ws.close(); chrome.kill(); process.exit(fails ? 1 : 0);
