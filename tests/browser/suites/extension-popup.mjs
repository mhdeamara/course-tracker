// Extension popup in a real browser (synthetic snapshot, stubbed chrome.* APIs).
// usage: node tests/browser/suites/extension-popup.mjs <site> <cdpPort>   (normally started by tests/browser/run.mjs)
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { CHROME, CHROME_ARGS, workDir, SEED } from '../lib/env.mjs';
import { attachSW } from '../lib/swattach.mjs';
const DIR = workDir('extension-popup');
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


// --- extension popup in a real browser (synthetic snapshot, stubbed chrome.* APIs; nothing leaves the page) ---
await send('Runtime.enable'); await send('Page.enable');
await view(1440, 900);
await send('Page.navigate', { url: SITE }); await sleep(1500);
await ev(`localStorage.clear(); 1`);
await ev(fs.readFileSync(SEED, 'utf8'));
await reload();
const snap = await ev(`JSON.stringify(CT.extSnapshot.build(CT.store.state, new Date()))`);
ok('snapshot built from the app', !!snap && JSON.parse(snap).v === 1);
const stub = `window.chrome = { storage: { local: { get: async () => ({ settings: { mode: 'local' }, snapLocal: { snap: ${snap} } }), set: async () => {}, remove: async () => {} }, onChanged: { addListener: () => {} } },
  runtime: { sendMessage: async () => ({ ok: true }), openOptionsPage: () => {} } };`;
await send('Page.addScriptToEvaluateOnNewDocument', { source: stub });
for (const scheme of ['light', 'dark']) {
  await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: scheme }] });
  await send('Emulation.setDeviceMetricsOverride', { width: 370, height: 600, deviceScaleFactor: 2, mobile: false });
  await send('Page.navigate', { url: SITE + 'extension/popup.html' }); await sleep(1200);
  ok(`popup ${scheme}: rendered rows`, (await ev(`document.querySelectorAll('#main .row, main .row, .row').length`)) > 0);
  ok(`popup ${scheme}: header icons are inline SVG (no glyph text)`, await ev(`[...document.querySelectorAll('header button, .top button')].every(b => !/[⟳⚙⏱]/.test(b.textContent))`) && (await ev(`document.querySelectorAll('svg.ic').length`)) >= 3);
  const small = await J(`[...document.querySelectorAll('button')].filter(b => b.offsetParent).map(b => { const r = b.getBoundingClientRect(); return [b.id || b.className, Math.round(r.width), Math.round(r.height)]; }).filter(([, w, h]) => w < 24 || h < 24)`);
  ok(`popup ${scheme}: every button at least 24px`, small.length === 0, JSON.stringify(small));
  ok(`popup ${scheme}: no horizontal overflow`, await ev(`document.documentElement.scrollWidth <= innerWidth`));
  ok(`popup ${scheme}: hostile text inert`, await ev(`!document.querySelector('img[onerror], [onerror]')`));
  const bg = await ev(`getComputedStyle(document.body).backgroundColor`);
  ok(`popup ${scheme}: theme background applied`, scheme === 'dark' ? /rgb\(9, 11, 15\)/.test(bg) : /rgb\(245, 246, 248\)/.test(bg), bg);
  await shot('ext-popup-' + scheme);
}
ok('no runtime errors', errs.length === 0, errs.join(' | '));
const fails = results.filter((r) => r[0] === 'FAIL').length;
console.log(`\n${results.length - fails}/${results.length} passed`);
ws.close(); chrome.kill(); process.exit(fails ? 1 : 0);
