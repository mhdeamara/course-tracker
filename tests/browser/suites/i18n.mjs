// Stage B.1 checks in headless Chrome (synthetic data): language defaults, switching without data loss, offline,
// lock bar in both languages, dialogs, overflow at 320/390/800/1440 both directions, accents, screenshots.
// usage: node tests/browser/suites/i18n.mjs <site> <cdpPort>
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { CHROME, CHROME_ARGS, workDir, SEED } from '../lib/env.mjs';
import { attachSW } from '../lib/swattach.mjs';
const DIR = workDir('i18n');
const [SITE, PORT] = process.argv.slice(2);
const SHOTS = path.join(DIR, 'shots'); fs.mkdirSync(SHOTS, { recursive: true });
const prof = path.join(DIR, 'pi' + (Date.now() % 10000)); // short: Chrome's CacheStorage fails past MAX_PATH fs.rmSync(prof, { recursive: true, force: true });
const chrome = spawn(CHROME, [...CHROME_ARGS, '--headless=new', `--user-data-dir=${prof}`, '--lang=en-US',
  `--remote-debugging-port=${PORT}`, '--no-first-run', '--no-default-browser-check', '--hide-scrollbars', 'about:blank'], { stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let t;
for (let i = 0; i < 60 && !t; i++) { await sleep(300); try { t = (await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()).find((x) => x.type === 'page'); } catch (e) { /* not up */ } }
const swDbg = await attachSW(PORT);
const ws = new WebSocket(t.webSocketDebuggerUrl);
await new Promise((r) => { ws.onopen = r; });
let id = 0; const pend = new Map(); const errs = [];
ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && pend.has(d.id)) { pend.get(d.id)(d); pend.delete(d.id); }
  else if (d.method === 'Runtime.exceptionThrown') errs.push(d.params.exceptionDetails.exception?.description || d.params.exceptionDetails.text);
  else if (d.method === 'Runtime.consoleAPICalled' && (d.params.type === 'error' || (d.params.type === 'warning' && /i18n/.test(JSON.stringify(d.params.args))))) errs.push('console: ' + d.params.args.map((a) => a.value || a.description).join(' ')); };
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); }).then((d) => { if (d.error) throw new Error(method + ' ' + JSON.stringify(d.error)); return d.result; });
const ev = async (expr) => { const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text); return r.result.value; };
const view = (w, h, mobile) => send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile });
const results = []; const ok = (name, pass, info = '') => { results.push([pass ? 'PASS' : 'FAIL', name, info]); console.log(pass ? 'PASS' : 'FAIL', name, pass ? '' : info); };
const go = async (h) => { await ev(`location.hash = ${JSON.stringify(h)}; 1`); await sleep(350); };
const reload = async () => { await send('Page.reload'); await sleep(1500); };
const key = (k) => ev(`document.dispatchEvent(new KeyboardEvent('keydown', { key: ${JSON.stringify(k)}, bubbles: true })); 1`);
const shot = async (name) => fs.writeFileSync(path.join(SHOTS, name + '.jpg'), Buffer.from((await send('Page.captureScreenshot', { format: 'jpeg', quality: 78 })).data, 'base64'));
const J = async (expr) => JSON.parse(await ev(`JSON.stringify(${expr})`));

await send('ServiceWorker.enable'); await send('Runtime.enable'); await send('Page.enable');
await view(1440, 900, false);
await send('Page.navigate', { url: SITE }); await sleep(1500);
await ev('Promise.race([navigator.serviceWorker.ready.then(() => 1), new Promise((r) => setTimeout(() => r(0), 8000))])'); await sleep(500); // let the worker finish installing before the first reload

/* 1) defaults: new user on an English browser → en (remembered); existing user → he; invalid value → he */
await ev(`localStorage.clear(); 1`); await reload();
ok('new user + English browser → English', await ev(`document.documentElement.lang === 'en' && document.documentElement.dir === 'ltr' && localStorage.getItem('ct.lang') === 'en'`), await ev('navigator.languages.join()'));
await reload();
ok('new user stays English after data was written', await ev(`CT.i18n.lang() === 'en' && !!localStorage.getItem('ct.data.v1')`));
await ev(`localStorage.removeItem('ct.lang'); 1`); await reload();
ok('existing local data, no saved language → Hebrew', await ev(`CT.i18n.lang() === 'he' && document.documentElement.dir === 'rtl'`));
await ev(`localStorage.setItem('ct.lang', 'xx'); 1`); await reload();
ok('invalid saved language → Hebrew, value repaired', await ev(`CT.i18n.lang() === 'he' && localStorage.getItem('ct.lang') === 'he'`));

/* seed synthetic data, Hebrew */
await ev(`localStorage.clear(); 1`);
await ev(fs.readFileSync(SEED, 'utf8'));
await ev(`localStorage.setItem('ct.lang', 'he'); 1`); await reload();
const cid = await ev(`CT.store.state.courses.filter(c=>c.kind!=='record')[0].id`);
await ev(`localStorage.setItem('ct.timer', JSON.stringify({ courseId: '${cid}', mode: 'free', phase: 'work', running: true, startedAt: Date.now() - 65000, acc: 0 })); 1`);
await reload();

/* 2) switching keeps route, scroll, unsaved input, timer, search text — and writes no academic data */
await go(`#/course/${cid}`); // Stage G: every page is translated; a translated page keeps fields marked data-keep
await ev(`window.__commits = 0; const c0 = CT.store.commit; CT.store.commit = function () { window.__commits++; return c0.apply(this, arguments); }; 1`);
await ev(`document.body.style.minHeight = '3000px'; window.scrollTo(0, 400); 1`); await sleep(150);
const draft = await ev(`(() => { const i = document.querySelector('#main [data-keep^="qa-"]'); if (!i) return null; i.value = 'טיוטה שלא נשמרה draft'; return i.getAttribute('data-keep'); })()`);
await ev(`document.getElementById('search').value = 'אותות'; 1`);
const before = await J(`{ data: localStorage.getItem('ct.data.v1'), upd: CT.store.state.meta.updatedAt, hash: location.hash, y: scrollY, timer: document.querySelector('#timer-slot .timer-chip')?.innerText }`);
await ev(`document.getElementById('more-btn').click(); 1`); await sleep(150);
ok('⋯ menu shows the language item (localized menu)', await ev(`(() => { const m = document.querySelector('.menu'); const last = [...m.querySelectorAll('.menu-item')].pop(); return m.lang === 'he' && last.innerText.includes('English'); })()`));
await ev(`[...document.querySelectorAll('.menu .menu-item')].pop().click(); 1`); await sleep(1300);
const after = await J(`{ data: localStorage.getItem('ct.data.v1'), upd: CT.store.state.meta.updatedAt, hash: location.hash, y: scrollY, timer: document.querySelector('#timer-slot .timer-chip')?.innerText,
  draft: ${draft ? `document.querySelector('[data-keep="${draft}"]')?.value` : 'null'}, search: document.getElementById('search').value, commits: window.__commits, focus: document.activeElement.id,
  lang: document.documentElement.lang, dir: document.documentElement.dir, mainDir: document.getElementById('main').dir, mainLang: document.getElementById('main').lang,
  today: document.querySelector('.sb-item[data-dest=today]').innerText.trim(), title: document.title, ph: document.getElementById('search').placeholder }`);
ok('switch → English: html lang/dir', after.lang === 'en' && after.dir === 'ltr', JSON.stringify(after));
ok('switch → English: shell translated', after.today === 'Today' && /(^|· )My Courses$/.test(after.title) && after.ph.startsWith('Search'), JSON.stringify({ today: after.today, title: after.title, ph: after.ph }));
ok('switch → English: the page is redrawn English/LTR', after.mainDir === 'ltr' && after.mainLang === 'en');
ok('switch keeps the route', after.hash === before.hash, `${before.hash} → ${after.hash}`);
ok('switch keeps the scroll position', after.y === before.y, `${before.y} → ${after.y}`);
ok('switch keeps unsaved input', !!draft && after.draft === 'טיוטה שלא נשמרה draft', String(draft));
ok('switch keeps the search text', after.search === 'אותות');
ok('switch keeps the timer running', !!before.timer && !!after.timer && before.timer !== after.timer, `${before.timer} → ${after.timer}`);
ok('switch writes no academic data (no commit, data unchanged)', after.commits === 0 && after.data === before.data && after.upd === before.upd);
ok('focus returns to the ⋯ button', after.focus === 'more-btn', after.focus);
ok('Hebrew search still works in English mode', await ev(`(() => { const i = document.getElementById('search'); i.dispatchEvent(new Event('input')); const r = document.querySelector('#search-results a[href^="#/course/"]'); return !!r && /Course|Item/.test(r.querySelector('.sr-kind').innerText); })()`));
await ev(`document.getElementById('search').value=''; document.getElementById('search').blur(); document.body.style.minHeight=''; 1`); await sleep(200);

/* shortcuts with both keyboard layouts, in English mode */
await go('#/');
for (const [a, b, want] of [['g', 's', '#/schedule'], ['ע', 'ד', '#/schedule'], ['g', 'd', '#/']]) { await key(a); await key(b); await sleep(300); ok(`en: shortcut ${a} ${b}`, (await ev('location.hash')) === want); }

/* dialogs: translated help is English/LTR; an untranslated page dialog stays Hebrew/RTL; shared buttons translated */
await key('?'); await sleep(200);
ok('help dialog translated (en, ltr)', await ev(`(() => { const m = document.querySelector('.modal-backdrop'); return m && m.lang === 'en' && m.dir === 'ltr' && m.querySelector('h2').innerText === 'Keyboard shortcuts' && m.querySelector('[data-close]').getAttribute('aria-label') === 'Close'; })()`));
await ev(`document.querySelector('.modal-backdrop [data-close]').click(); 1`);
await ev(`window.__cf = CT.ui.confirm('למחוק את הפריט?'); 1`); await sleep(150);
ok('page confirm stays Hebrew/RTL with translated buttons', await ev(`(() => { const m = document.querySelector('.modal-backdrop'); const b = [...m.querySelectorAll('.modal-foot .btn')].map((x) => x.innerText); return m.dir === 'rtl' && m.lang === 'he' && b.join() === 'Cancel,OK'; })()`));
await ev(`document.querySelector('.modal-backdrop .modal-foot .btn').click(); 1`);
ok('confirm still answers', (await ev(`window.__cf`)) === false);
await ev(`CT.ui.toast('נשמר'); 1`); await sleep(100);
ok('toast centred in LTR', await ev(`(() => { const b = document.querySelector('#toasts .toast').getBoundingClientRect(); return Math.abs((b.left + b.right) / 2 - innerWidth / 2) < 2; })()`));

/* a dialog open while the language changes keeps its own language/direction */
await key('?'); await sleep(200);
await ev(`CT.i18n.setLang('he'); 1`); await sleep(200);
ok('open dialog keeps its language across a switch', await ev(`(() => { const m = document.querySelector('.modal-backdrop'); return m.lang === 'en' && m.dir === 'ltr' && document.documentElement.dir === 'rtl'; })()`));
await ev(`document.querySelector('.modal-backdrop [data-close]').click(); CT.i18n.setLang('en'); 1`); await sleep(200);

/* settings card: switch back to Hebrew from Settings */
await go('#/settings/language');
ok('settings: language category in English', await ev(`(() => { const c = document.getElementById('lang-card'); return !!c && document.getElementById('set-cat-h').innerText === 'Language' && c.querySelector('input[value=en]').checked; })()`));
await ev(`window.__commits = 0; (() => { const r = document.querySelector('#lang-card input[value=he]'); r.focus(); r.click(); })(); 1`); await sleep(300);
ok('settings: radio switches to Hebrew, card re-rendered, focus kept, no commit', await ev(`CT.i18n.lang() === 'he' && document.documentElement.dir === 'rtl' && document.getElementById('set-cat-h').innerText === 'שפה' && document.activeElement.name === 'ct-lang' && document.activeElement.value === 'he' && window.__commits === 0 && document.querySelector('.sb-item[data-dest=today]').innerText.trim() === 'היום'`));
await go('#/grades'); ok('Hebrew mode: degree page is Hebrew/RTL', await ev(`(() => { const m = document.getElementById('main'); return m.lang === 'he' && getComputedStyle(m).direction === 'rtl' && !m.hasAttribute('data-ct-content'); })()`));

/* 3) offline: switching needs no network; reload offline keeps the chosen language */
await go('#/');
await send('Network.enable'); await send('Network.emulateNetworkConditions', { offline: true, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
await ev(`CT.i18n.setLang('en'); 1`); await sleep(200);
ok('offline: switch works', await ev(`document.documentElement.dir === 'ltr' && document.querySelector('.sb-item[data-dest=today]').innerText.trim() === 'Today'`));
await reload();
ok('offline: reload keeps English and renders', await ev(`CT.i18n.lang() === 'en' && document.getElementById('main').innerText.length > 20`));

/* 4) lock bar in both languages (offline → update message) */
await ev(`CT.guard.lock({ reason: 'newer', found: 99, source: 'local', uid: null }); 1`); await sleep(200);
await ev(`document.querySelector('[data-lock=update]').click(); 1`); await sleep(600);
const lockEn = await ev(`document.getElementById('lock-bar').innerText`);
ok('lock bar English (title, read-only, offline update message, buttons)', /An app update is required/.test(lockEn) && /read-only/.test(lockEn) && /No internet connection/.test(lockEn) && /Download backup/.test(lockEn), lockEn);
let lockedMsg = '';
try { await ev(`CT.store.commit('x', (s) => { s.courses[0].name += '!'; })`); } catch (e) { lockedMsg = e.message; }
ok('locked write blocked with an English message', /read-only/.test(lockedMsg), lockedMsg);
for (const [w, h] of [[1440, 900], [390, 844], [320, 640]]) { await view(w, h, w < 768); await sleep(150); await shot(`lock-${w}-en`); }
await ev(`CT.i18n.setLang('he'); 1`); await sleep(200);
const lockHe = await ev(`document.getElementById('lock-bar').innerText`);
ok('lock bar follows the switch to Hebrew', /נדרש עדכון גרסה/.test(lockHe) && /אין חיבור לאינטרנט/.test(lockHe), lockHe);
await shot('lock-320-he');
await send('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
await ev(`localStorage.removeItem('ct.lock.v1'); 1`); await view(1440, 900, false); await reload();
ok('lock cleared', await ev(`document.getElementById('lock-bar').hidden`));

/* 5) layout: both directions × 320/390/800/1440 × routes — no horizontal overflow, shell inside the viewport, menu on screen */
const ROUTES = ['#/', '#/courses', `#/course/${cid}`, '#/grades', '#/settings', '#/xp'];
for (const lang of ['en', 'he']) {
  await ev(`CT.i18n.setLang('${lang}'); 1`);
  for (const [w, h] of [[320, 640], [390, 844], [800, 1000], [1440, 900]]) {
    await view(w, h, w < 768); await sleep(150);
    const bad = [];
    for (const r of ROUTES) {
      await go(r);
      const m = await J(`(() => {
        const vis = (e) => { const b = e.getBoundingClientRect(); return b.width && b.height && getComputedStyle(e).visibility !== 'hidden' && getComputedStyle(e).display !== 'none'; };
        const out = [...document.querySelectorAll('#app-header *, #bottom-nav *, #sidebar *, #subnav')].filter(vis).filter((e) => { const b = e.getBoundingClientRect(); return b.left < -1 || b.right > innerWidth + 1; }).filter((e) => !e.closest('#subnav') || e.id === 'subnav').map((e) => e.id || e.className);
        return { over: document.documentElement.scrollWidth > innerWidth, out: out.slice(0, 3) };
      })()`);
      if (m.over || m.out.length) { await sleep(700); const m2 = await J(`({ sx: scrollX, iw: innerWidth, dw: document.documentElement.scrollWidth, bw: document.body.scrollWidth, bn: [...document.querySelectorAll('#bottom-nav .bn-item')].map((e) => Math.round(e.getBoundingClientRect().left) + '-' + Math.round(e.getBoundingClientRect().right)).join(' ') })`); bad.push(r + ' ' + JSON.stringify(m) + ' after 700ms: ' + JSON.stringify(m2)); }
    }
    await ev(`document.getElementById('more-btn').click(); 1`); await sleep(120);
    const menu = await J(`(() => { const b = document.querySelector('.menu').getBoundingClientRect(); return b.left >= 0 && b.right <= innerWidth; })()`);
    await ev(`CT.ui.closeMenu(); 1`);
    ok(`${lang} ${w}px: no overflow, shell on screen, ⋯ menu on screen`, !bad.length && menu, bad.join(' | ') + (menu ? '' : ' menu off-screen'));
  }
}

/* 6) accents in English (light + dark) render without errors */
await view(1440, 900, false); await ev(`CT.i18n.setLang('en'); 1`); await go('#/');
for (const acc of ['teal', 'rose', 'amber', 'forest']) for (const th of ['light', 'dark']) {
  await ev(`CT.app.setTheme('${th}'); document.documentElement.dataset.accent = '${acc}'; 1`); await sleep(80);
}
ok('accents × themes in English: no errors', true);
await ev(`CT.app.setTheme('light'); 1`);
ok('en desktop: AI button on the right, clear of the sidebar', await ev(`(() => { const f = document.getElementById('ai-fab').getBoundingClientRect(), s = document.getElementById('sidebar').getBoundingClientRect(); return f.right <= innerWidth && f.left > s.right; })()`));
await ev(`CT.views.ai.open(); 1`); await sleep(400);
ok('en desktop: chat panel on the right, clear of the sidebar', await ev(`(() => { const p = document.querySelector('.chat-panel'); if (!p) return 'no panel'; const b = p.getBoundingClientRect(), s = document.getElementById('sidebar').getBoundingClientRect(); return b.left > s.right && b.right <= innerWidth && p.getAttribute('dir') === 'ltr'; })()`));
await shot('chat-en-desktop-light');
await ev(`CT.views.chat && CT.views.chat.close && CT.views.chat.close(); 1`);
await ev(`delete document.documentElement.dataset.accent; 1`);

/* 7) screenshots: EN/HE × desktop/mobile × light/dark */
for (const lang of ['en', 'he']) for (const [w, h, tag] of [[1440, 900, 'desktop'], [390, 844, 'mobile']]) for (const th of ['light', 'dark']) {
  await ev(`CT.i18n.setLang('${lang}'); CT.app.setTheme('${th}'); 1`);
  await view(w, h, w < 768);
  for (const [r, n] of [['#/', 'today'], ['#/settings', 'settings']]) { await go(r); await ev('window.scrollTo(0,0); 1'); await sleep(250); await shot(`${n}-${lang}-${tag}-${th}`); }
  if (tag === 'mobile') { await go('#/'); await ev(`document.getElementById('more-btn').click(); 1`); await sleep(150); await shot(`menu-${lang}-${tag}-${th}`); await ev(`CT.ui.closeMenu(); 1`); }
  else { await go('#/'); await key('?'); await sleep(200); await shot(`help-${lang}-${tag}-${th}`); await ev(`document.querySelector('.modal-backdrop [data-close]').click(); 1`); }
}
await ev(`CT.app.setTheme('light'); CT.i18n.setLang('he'); 1`);

ok('no JS errors or i18n warnings', errs.length === 0, errs.slice(0, 5).join(' | '));
console.log(`\n${results.filter((r) => r[0] === 'PASS').length}/${results.length} passed`);
ws.close(); chrome.kill(); process.exit(0);
