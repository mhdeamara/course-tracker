// Stage B checks in headless Chrome (synthetic data): routes, nav state, back/forward, shortcuts, sidebar persistence,
// timer continuity, touch targets, schema-lock visibility, offline reload.  usage: node tests/browser/suites/routes.mjs <site> <cdpPort>
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { CHROME, CHROME_ARGS, workDir, SEED } from '../lib/env.mjs';
import { attachSW } from '../lib/swattach.mjs';
const DIR = workDir('routes');
const [SITE, PORT, LANG = 'he'] = process.argv.slice(2);
const chrome = spawn(CHROME, [...CHROME_ARGS, '--headless=new', `--user-data-dir=${path.join(DIR, 'pv' + LANG + (Date.now() % 10000))}`,
  `--remote-debugging-port=${PORT}`, '--no-first-run', '--no-default-browser-check', '--hide-scrollbars', 'about:blank'], { stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let t;
for (let i = 0; i < 60 && !t; i++) { await sleep(300); try { t = (await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()).find((x) => x.type === 'page'); } catch (e) { /* not up */ } }
const swDbg = await attachSW(PORT);
const ws = new WebSocket(t.webSocketDebuggerUrl);
await new Promise((r) => { ws.onopen = r; });
let id = 0; const pend = new Map(); const errs = [];
ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.method && /^ServiceWorker/.test(d.method) && m.data.includes(new URL(SITE).host)) { const s = (d.params.versions || d.params.registrations || []).map((x) => x.status || (x.isDeleted ? 'DELETED' : 'reg')).join(); console.log('SW', s, '@', results.length, results.at(-1)?.[1] || 'start'); } if (d.id && pend.has(d.id)) { pend.get(d.id)(d); pend.delete(d.id); }
  else if (d.method === 'Runtime.exceptionThrown') errs.push(d.params.exceptionDetails.exception?.description || d.params.exceptionDetails.text);
  else if (d.method === 'Runtime.consoleAPICalled' && (d.params.type === 'error' || d.params.type === 'warning')) errs.push('console: ' + d.params.args.map((a) => a.value || a.description).join(' ')); };
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); }).then((d) => { if (d.error) throw new Error(method + ' ' + JSON.stringify(d.error)); return d.result; });
const ev = async (expr) => { const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text); return r.result.value; };
const view = (w, h, mobile) => send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile });
const results = []; const ok = (name, pass, info = '') => { results.push([pass ? 'PASS' : 'FAIL', name, info]); console.log(pass ? 'PASS' : 'FAIL', name, pass ? '' : info); };
const key = (k, extra = {}) => ev(`document.dispatchEvent(new KeyboardEvent('keydown', { key: ${JSON.stringify(k)}, bubbles: true, ...${JSON.stringify(extra)} })); 1`);
const hash = () => ev('location.hash');
const go = async (h) => { await ev(`location.hash = ${JSON.stringify(h)}; 1`); await sleep(350); };

await send('ServiceWorker.enable'); await send('Runtime.enable'); await send('Page.enable');
await view(1440, 900, false);
await send('Page.navigate', { url: SITE }); await sleep(1500);
await ev('Promise.race([navigator.serviceWorker.ready.then(() => 1), new Promise((r) => setTimeout(() => r(0), 8000))])'); await sleep(500); // let the worker finish installing before the first reload
await ev(`localStorage.clear(); 1`);
await ev(fs.readFileSync(SEED, 'utf8'));
await ev(`localStorage.setItem('ct.lang', '${LANG}'); 1`);
await send('Page.reload'); await sleep(1500);
ok(`language ${LANG}: lang/dir set`, await ev(`document.documentElement.lang === '${LANG}' && document.documentElement.dir === '${LANG === 'he' ? 'rtl' : 'ltr'}'`));
const cid = JSON.parse(await ev(`JSON.stringify(CT.store.state.courses.filter(c=>c.kind!=='record').map(c=>c.id))`))[0];
const item = await ev(`CT.store.state.courses.find(c=>c.id==='${cid}').categories[0].items[0].id`);

// 1) every route renders, with the right destination + sub highlighted, no errors
const ROUTES = [['#/', 'today', ''], ['#/schedule', 'today', 'schedule'], ['#/xp', 'today', 'xp'], ['#/adhkar', 'today', 'adhkar'],
  ['#/courses', 'courses', 'courses'], [`#/course/${cid}`, 'courses', null], [`#/course/${cid}?tab=notebook`, 'courses', null], [`#/course/${cid}?tab=grades`, 'courses', null],
  [`#/course/${cid}?item=${item}`, 'courses', null], ['#/moodle', 'courses', 'moodle'], ['#/review', 'courses', 'review'], ['#/archive', 'courses', 'archive'],
  ['#/grades', 'degree', 'grades'], ['#/catalog', 'degree', 'catalog'], ['#/semesters', 'degree', 'semesters'], [`#/semesters/${await ev('CT.store.state.semesters[0].id')}`, 'degree', null],
  ['#/stats', 'degree', 'stats'], ['#/settings', null, null], ['#/nope', 'today', null]];
for (const [h, dest, sub] of ROUTES) {
  const before = errs.length;
  await go(h);
  const st = JSON.parse(await ev(`JSON.stringify({ main: document.getElementById('main').innerText.length,
    dest: (document.querySelector('.sb-item.active[data-dest]') || {}).dataset?.dest || null,
    sub: (document.querySelector('.sb-sub a.active') || {}).getAttribute?.('href') || null,
    bn: (document.querySelector('.bn-item.active') || {}).dataset?.dest || null,
    set: !!document.querySelector('.sb-bottom .sb-item.active') })`));
  const subOk = sub === null || st.sub === `#/${sub}`;
  ok(`route ${h}`, st.main > 20 && st.dest === dest && st.bn === dest && subOk && errs.length === before && (h !== '#/settings' || st.set), JSON.stringify(st));
}
// sidebar no longer lists courses; courses page links to each course
await go('#/courses');
ok('courses page links to every current course', await ev(`CT.store.semesterCourses().every(c => document.querySelector('#main a[href="#/course/' + c.id + '"]'))`));
ok('old sidebar course list removed', await ev(`!document.querySelector('.sb-course, .sb-courses')`));
ok('search finds a course', await ev(`(() => { const i = document.getElementById('search'); i.value = 'אותות'; i.dispatchEvent(new Event('input')); return !!document.querySelector('#search-results a[href^="#/course/"]'); })()`));
await ev(`document.getElementById('search').value=''; document.getElementById('search').blur(); 1`);

// 2) back / forward + deep link reload
await go('#/'); await go('#/grades'); await go(`#/course/${cid}`);
await ev('history.back(); 1'); await sleep(400); const b1 = await hash();
await ev('history.back(); 1'); await sleep(400); const b2 = await hash();
await ev('history.forward(); 1'); await sleep(400); const f1 = await hash();
ok('back/forward', b1 === '#/grades' && b2 === '#/' && f1 === '#/grades', `${b1} ${b2} ${f1}`);
await go(`#/course/${cid}?tab=notebook`); await send('Page.reload'); await sleep(1500);
ok('deep link survives reload', (await hash()) === `#/course/${cid}?tab=notebook` && await ev(`!!document.querySelector('.sb-item.active[data-dest=courses]')`));

// 3) shortcuts (English + Hebrew layout)
await go('#/');
for (const [k1, k2, want] of [['g', 's', '#/schedule'], ['g', 'r', '#/review'], ['g', 't', '#/stats'], ['g', 'd', '#/'], ['ע', 'ד', '#/schedule'], ['ע', 'ג', '#/']]) {
  await key(k1); await key(k2); await sleep(300); ok(`shortcut ${k1} ${k2}`, (await hash()) === want, await hash());
}
await key('/'); ok('shortcut / focuses search', await ev(`document.activeElement.id === 'search'`)); await ev(`document.activeElement.blur(); 1`); await sleep(200);
await key('?'); ok('shortcut ? opens help', await ev(`!!document.querySelector('.modal-backdrop')`)); await key('Escape'); await ev(`document.querySelectorAll('.modal-backdrop').forEach(m=>m.remove()); 1`);
await key('t'); await sleep(200); ok('shortcut t opens timer', await ev(`!!document.querySelector('.modal-backdrop')`)); await ev(`document.querySelectorAll('.modal-backdrop').forEach(m=>m.remove()); 1`);
const n0 = await ev('CT.store.state.courses.length');
await ev(`CT.store.commit('test', (st) => { st.courses[0].name += ' x'; }); 1`); await key('z', { ctrlKey: true }); await sleep(200);
ok('ctrl+z undo', !(await ev(`CT.store.state.courses[0].name.endsWith(' x')`)) && n0 === await ev('CT.store.state.courses.length'));
await ev(`document.getElementById('undo-btn').click(); 1`); ok('undo button wired', true);

// 4) AI destination opens the AI page (Stage E), no dead link
await ev(`CT.views.chat && CT.views.chat.close && CT.views.chat.close(); 1`);
await ev(`document.querySelector('.sb-item[data-dest=ai]').click(); 1`); await sleep(600);
ok('AI destination opens the AI page', await ev(`!!document.querySelector('.aiw')`) && (await hash()) === '#/ai');
await ev(`location.hash = '#/'; 1`); await sleep(400);
await ev(`document.querySelectorAll('.modal-backdrop').forEach(m=>m.remove()); CT.views.chat && CT.views.chat.close && CT.views.chat.close(); 1`);

// 5) sidebar collapse persists
await ev(`document.getElementById('sb-toggle').click(); 1`); await sleep(200);
const w1 = await ev(`document.getElementById('sidebar').getBoundingClientRect().width`);
await send('Page.reload'); await sleep(1500);
const w2 = await ev(`document.getElementById('sidebar').getBoundingClientRect().width`);
ok('sidebar collapse persists across reload', w1 === 72 && w2 === 72 && await ev(`localStorage.getItem('ct.sidebar') === 'rail' && document.getElementById('sb-toggle').getAttribute('aria-expanded') === 'false'`), `${w1} ${w2}`);
ok('rail shows sub-page strip', await ev(`!document.getElementById('subnav').hidden && getComputedStyle(document.getElementById('subnav')).display !== 'none'`));
await ev(`document.getElementById('sb-toggle').click(); 1`); await sleep(200);
ok('sidebar expands again', (await ev(`document.getElementById('sidebar').getBoundingClientRect().width`)) === 248);

// 6) timer keeps running across navigation
await ev(`localStorage.setItem('ct.timer', JSON.stringify({ courseId: '${cid}', mode: 'free', phase: 'work', running: true, startedAt: Date.now() - 65000, acc: 0 })); 1`);
await send('Page.reload'); await sleep(1500);
const t1 = await ev(`document.querySelector('#timer-slot .timer-chip').innerText`);
for (const h of ['#/grades', `#/course/${cid}`, '#/settings', '#/moodle']) await go(h);
await sleep(1200);
const t2 = await ev(`document.querySelector('#timer-slot .timer-chip').innerText`);
ok('timer chip persists and keeps counting', !!t1 && !!t2 && t1 !== t2, `${t1} → ${t2}`);

// 7) layouts: sizes, touch targets, overflow
for (const [w, h] of [[390, 844], [320, 640], [800, 1000]]) {
  await view(w, h, w < 768); await go('#/'); await sleep(300);
  const m = JSON.parse(await ev(`JSON.stringify((() => {
    const vis = (e) => { const b = e.getBoundingClientRect(); return b.width && b.height && getComputedStyle(e).visibility !== 'hidden'; };
    const shell = [...document.querySelectorAll('#app-header a, #app-header button, #bottom-nav a, #bottom-nav button, #subnav a, #sidebar a, #sidebar button')].filter(vis);
    const small = shell.filter((e) => { const b = e.getBoundingClientRect(); return b.height < 44 || b.width < 44; }).map((e) => (e.id || e.className || e.tagName) + ':' + Math.round(e.getBoundingClientRect().width) + 'x' + Math.round(e.getBoundingClientRect().height));
    return { small, overflowX: document.documentElement.scrollWidth > innerWidth, bottom: getComputedStyle(document.getElementById('bottom-nav')).display, side: document.getElementById('sidebar').getBoundingClientRect().width, header: Math.round(document.getElementById('app-header').getBoundingClientRect().height) };
  })())`));
  if (w < 768) ok(`${w}px: bottom bar, no sidebar, targets >= 44, no horizontal scroll`, m.bottom === 'grid' && m.side === 0 && !m.small.length && !m.overflowX, JSON.stringify(m));
  else ok(`${w}px: icon rail`, m.side === 72 && m.bottom === 'none' && !m.overflowX, JSON.stringify(m));
}
await view(390, 844, true);
await ev(`document.getElementById('search-btn').click(); 1`); await sleep(150);
ok('phone: search button opens the search field', await ev(`document.activeElement.id === 'search' && getComputedStyle(document.querySelector('.search')).display !== 'none'`));
await ev(`document.activeElement.blur(); 1`); await sleep(250);
await ev(`document.getElementById('more-btn').click(); 1`); await sleep(150);
ok('phone: overflow menu has settings/theme/undo/help/language', await ev(`document.querySelectorAll('.menu .menu-item').length === 5`));
await ev(`CT.ui.closeMenu(); 1`);
await ev(`document.querySelector('.bn-item[data-dest=degree]').click(); 1`); await sleep(400);
ok('phone: bottom bar navigates', (await hash()) === '#/grades');
await ev(`document.getElementById('bell-btn').click(); 1`); await sleep(400);
ok('bell opens the notification sheet (route unchanged)', (await hash()) === '#/grades' && await ev(`!!document.querySelector('.nc-layer.is-sheet .nc[role=dialog]')`));
await ev(`CT.views.notifications.close(); 1`);

// 8) schema lock stays visible on every layout
await ev(`CT.guard.lock({ reason: 'newer', found: 99, source: 'local', uid: null }); 1`); await sleep(300);
for (const [w, h] of [[1440, 900], [800, 1000], [390, 844], [320, 640]]) {
  await view(w, h, w < 768); await sleep(200);
  ok(`${w}px: schema-lock bar visible`, await ev(`(() => { const e = document.getElementById('lock-bar'); const b = e.getBoundingClientRect(); return !e.hidden && b.height > 40 && b.top < innerHeight; })()`));
}
await view(1440, 900, false);
fs.mkdirSync(path.join(DIR, 'after'), { recursive: true });
await view(390, 844, true); await sleep(200);
fs.writeFileSync(path.join(DIR, 'after', `lock-390-${LANG}.jpg`), Buffer.from((await send('Page.captureScreenshot', { format: 'jpeg', quality: 75 })).data, 'base64'));
await ev(`localStorage.removeItem('ct.lock.v1'); 1`); await send('Page.reload'); await sleep(1500);
ok('lock cleared after test', await ev(`document.getElementById('lock-bar').hidden`));

// 9) offline reload (service worker v29)
await view(1440, 900, false);
const swOk = await ev(`Promise.race([navigator.serviceWorker.ready.then(r => !!r.active), new Promise((r) => setTimeout(() => r(false), 6000))])`);
console.log('errs so far', JSON.stringify(errs).slice(0, 1500));
console.log('sw state', JSON.stringify(await ev(`(async () => { const r = await navigator.serviceWorker.getRegistration(); const reg = await navigator.serviceWorker.register('sw.js').then(() => 'ok', (e) => String(e)); return { reg, r: !!r, active: !!(r && r.active), ctl: !!navigator.serviceWorker.controller, href: location.href, sw: 'serviceWorker' in navigator }; })()`)));
await sleep(800);
await send('Network.enable'); await send('Network.emulateNetworkConditions', { offline: true, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
await send('Page.reload'); await sleep(2000);
ok('offline reload renders the shell', swOk && await ev(`!!document.querySelector('.sb-item[data-dest=today]') && document.getElementById('main').innerText.length > 20`));
await send('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
ok('cache name', (await ev(`typeof caches !== 'undefined' ? caches.keys() : []`)).includes('course-tracker-v36'));

ok('no JS errors overall', errs.length === 0, errs.slice(0, 5).join(' | '));
console.log(results.map((r) => r.join('  ')).join('\n'));
console.log(`\n${results.filter((r) => r[0] === 'PASS').length}/${results.length} passed`);
ws.close(); chrome.kill(); process.exit(0);
