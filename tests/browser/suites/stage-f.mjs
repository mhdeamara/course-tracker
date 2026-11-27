// Stage F checks (synthetic data): settings center.
// usage: node tests/browser/suites/stage-f.mjs <site> <cdpPort>   (normally started by tests/browser/run.mjs)
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { CHROME, CHROME_ARGS, workDir, SEED } from '../lib/env.mjs';
import { attachSW } from '../lib/swattach.mjs';
const DIR = workDir('stage-f');
const [SITE, PORT] = process.argv.slice(2);
const SHOTS = path.join(DIR, 'shotsF'); fs.mkdirSync(SHOTS, { recursive: true });
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
const USER = `const st = CT.store.state; const user = [...st.semesters.map(x=>x.name), ...st.courses.flatMap(c => [c.name, c.staff, ...(c.exams||[]).map(e=>e.label), ...(c.grade.components||[]).map(x=>x.name), ...(c.schedule||[]).map(x=>x.room), ...c.categories.flatMap(k => [k.name, ...k.items.flatMap(i => [i.title, i.note, ...i.tags])])])].filter(Boolean).sort((a,b)=>b.length-a.length); const strip = (v) => { user.forEach(x => { v = v.split(x).join(''); }); return v; };`;
const HEB_UI = `(() => { const out = []; ${USER} const w = document.createTreeWalker(document.getElementById('main'), NodeFilter.SHOW_TEXT);
  while (w.nextNode()) { const n = w.currentNode; if (!/[\\u0590-\\u05FF]/.test(strip(n.textContent))) continue; const p = n.parentElement;
    if (p.closest('[dir=auto],bdi,textarea,option,select,.tag,[lang=ar],.lang-opt [lang],.c-art,.cw-kv,.note-print,.note-preview,.nb-body')) continue; out.push(n.textContent.trim().slice(0, 40)); }
  document.querySelectorAll('#main [aria-label],#main [title],#main [placeholder]').forEach((e) => ['aria-label','title','placeholder'].forEach((a) => { const v = e.getAttribute(a); if (v && /[\\u0590-\\u05FF]/.test(strip(v)) &&!e.closest('[data-keep]') ) out.push(a + ':' + v.slice(0, 40)); }));
  return out; })()`;

await send('ServiceWorker.enable'); await send('Runtime.enable'); await send('Page.enable'); await send('Emulation.setFocusEmulationEnabled', { enabled: true });
await view(1440, 900);
await send('Page.navigate', { url: SITE }); await sleep(1500);
await ev('Promise.race([navigator.serviceWorker.ready.then(() => 1), new Promise((r) => setTimeout(() => r(0), 8000))])'); await sleep(500);
await ev(`localStorage.clear(); 1`);
await ev(fs.readFileSync(SEED, 'utf8'));
await ev(`localStorage.setItem('ct.lang', 'he'); 1`);
await reload();
ok('cache name is v36', await ev(`caches.keys().then(k => k.includes('course-tracker-v36'))`));
const ids = await J(`CT.store.state.courses.filter(c=>c.kind!=='record').map(c=>c.id)`);
const cid = ids[0];

/* ================= Stage F: settings center ================= */
const setLang = async (l) => { await ev(`CT.i18n.setLang('${l}'); 1`); await sleep(250); };
const overflow = (w) => ev(`document.documentElement.scrollWidth <= ${w} + 1`);
const CATS = ['appearance', 'language', 'account', 'moodle', 'ai', 'study', 'degree', 'xp', 'adhkar', 'data'];
// cloud + AI mocked (no network, no paid calls): signed out, so the sign-in form shows
const MOCK = `(() => { const C = CT.cloud; window.__signed = false;
  Object.assign(C, { enabled: true, signedIn: () => window.__signed, onLocalChange() {}, syncNow: async () => {}, userId: () => 'u-test', email: () => 'test@example.invalid',
    moodleFeed: async () => null, moodleSnapshot: async () => null, label: () => window.__signed ? ['ok', CT.i18n.tx('sync.synced')] : ['warn', CT.i18n.tx('sync.signedOut')] });
  C.ai = async (b) => b.action === 'usage' ? { ok: true, configured: true, today: { requests: 1, extracts: 0, costUsd: 0.001 }, limits: { perMinute: 10, dailyCostUsd: 0.5, dailyExtracts: 10, maxFileBytes: 10485760, maxPdfPages: 10, maxChatChars: 2000 }, models: [], defaults: {} } : { ok: true };
  CT.views.ai.reset(); return 1; })()`;
await ev(MOCK);

await view(1440, 900); await setLang('he');
await go('#/settings'); await sleep(250);
ok('settings: 10 categories in the navigation, first one shown on a wide screen', await ev(`document.querySelectorAll('.set-cat').length === 10 && !!document.querySelector('.set-cat.active[aria-current=page][data-cat=appearance]') && getComputedStyle(document.querySelector('.set-main')).display !== 'none'`));
ok('settings: each category has an SVG icon', await ev(`[...document.querySelectorAll('.set-cat')].every(a => a.querySelector('.set-cat-ic svg'))`));
for (const c of CATS) {
  await go('#/settings/' + c); await sleep(150);
  ok(`settings he: category "${c}" renders with its heading`, await ev(`location.hash === '#/settings/${c}' && document.querySelector('#set-cat-h').textContent.trim() === CT.i18n.tx('set.c.${c}') && document.querySelector('.set-body').children.length > 0`));
}
await shot('set-he-1440-appearance'.replace('appearance', 'data'));

// every category in English: no Hebrew interface text
await setLang('en');
for (const c of CATS) {
  await go('#/settings/' + c); await sleep(200);
  const heb = await J(HEB_UI);
  ok(`settings en: "${c}" has no Hebrew interface text`, heb.length === 0, heb.slice(0, 5).join(' | '));
}
await go('#/settings/xp'); await sleep(150); await shot('set-en-1440-xp');
await go('#/settings/degree'); await sleep(150); await shot('set-en-1440-degree');

/* persistence of every kind of setting (device prefs and synced data) */
const change = (sel, val) => ev(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return false; if (e.type === 'checkbox' || e.type === 'radio') e.checked = ${JSON.stringify(val)}; else e.value = ${JSON.stringify(val)}; e.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`);
await go('#/settings/appearance'); await sleep(150);
await change('[data-action=motion]', 'reduce'); await change('[data-action=sound]', false); await sleep(150);
await go('#/settings/study'); await sleep(150);
await change('[name=work]', '33'); await sleep(150); await change('.tpl-row [name=count]', '9'); await sleep(150);
await go('#/settings/degree'); await sleep(150);
await change('[data-gpa=passGrade]', '56'); await sleep(150); await change('[data-gpa=repeat]', 'best'); await sleep(150);
await go('#/settings/xp'); await sleep(150);
await change('[data-game="goals.day.items"]', '7'); await sleep(150);
await go('#/settings/adhkar'); await sleep(150);
const adkOn = await ev(`!!document.querySelector('[data-adk-set="general.every"]')`);
if (adkOn) { await change('[data-adk-set="general.every"]', '120'); await sleep(150); }
await reload(); await ev(MOCK); await sleep(200);
const P = await J(`(() => { const s = CT.store.state; return { motion: CT.app.motion(), sound: CT.app.sound(), work: s.settings.pomodoro.work, tpl: s.settings.template[0].count, pass: s.settings.gpa.passGrade, rep: s.settings.gpa.repeat, goal: CT.game.cfg(s).goals.day.items, adk: CT.adhkar.cfg(s).general.every, lang: CT.i18n.lang() }; })()`);
ok('settings: every changed setting persists after reload', P.motion === 'reduce' && P.sound === false && P.work === 33 && P.tpl === 9 && P.pass === 56 && P.rep === 'best' && P.goal === 7 && (!adkOn || P.adk === 120) && P.lang === 'en', JSON.stringify(P));
await ev(`CT.app.setMotion('auto'); CT.app.setSound(true); 1`);
for (let i = 0; i < 6; i++) await ev(`CT.store.undo(); 1`);
await sleep(200);

/* search (both languages), keyboard, result → the setting */
await view(1440, 900); await go('#/settings/appearance'); await sleep(200);
await ev(`(() => { const q = document.getElementById('set-q'); q.focus(); q.value = 'גיבוי'; q.dispatchEvent(new Event('input', { bubbles: true })); })(); 1`); await sleep(100);
ok('search en UI: a Hebrew query finds "Export a backup"', await ev(`[...document.querySelectorAll('.set-hit-btn')].some(b => b.dataset.hit === 'export' && /Export a backup/.test(b.textContent))`));
await ev(`(() => { const q = document.getElementById('set-q'); q.value = 'pomodoro'; q.dispatchEvent(new Event('input', { bubbles: true })); })(); 1`); await sleep(100);
await key('Enter'); await sleep(450);
ok('search: Enter opens the category and focuses the setting', await ev(`location.hash === '#/settings/study' && document.activeElement && document.activeElement.name === 'work'`), await ev(`location.hash + ' ' + (document.activeElement && document.activeElement.outerHTML.slice(0, 60))`));
ok('search: cleared after choosing a result', await ev(`document.getElementById('set-q').value === '' && document.querySelectorAll('.set-cat').length === 10`));
await ev(`(() => { const q = document.getElementById('set-q'); q.focus(); q.value = 'nothing-like-this'; q.dispatchEvent(new Event('input', { bubbles: true })); })(); 1`); await sleep(100);
ok('search: no match → a clear empty state', await ev(`!!document.querySelector('.set-empty') && document.querySelector('.set-empty').textContent === 'No matching setting.'`));
await key('Escape'); await sleep(100);
ok('search: Escape clears it and the categories return', await ev(`document.getElementById('set-q').value === '' && document.querySelectorAll('.set-cat').length === 10`));
await ev(`document.querySelector('.set-cat[data-cat=appearance]').focus(); 1`);
await key('ArrowDown'); await key('ArrowDown');
ok('keyboard: arrow keys move between categories', await ev(`document.activeElement.dataset.cat === 'account'`));
await key('End');
ok('keyboard: End goes to the last category', await ev(`document.activeElement.dataset.cat === 'data'`));

/* deep links and older links */
await ev(`CT.views.moodle.showSettings('moodle-classes'); 1`); await sleep(500);
ok('link: Moodle "categories" opens Moodle settings at the categories block', await ev(`location.hash === '#/settings/moodle' && !!document.getElementById('moodle-classes')`));
await ev(`CT.views.settings.goTo('lang-card'); 1`); await sleep(400);
ok('link: an old card id (lang-card) opens its category', await ev(`location.hash === '#/settings/language'`));
await go('#/settings/no-such'); await sleep(200);
ok('link: unknown category → settings home, no error', await ev(`!!document.querySelector('.set-cat.active[data-cat=appearance]')`));
await go('#/ai'); await sleep(300);
ok('link: AI page sign-in → account settings', await ev(`!!document.querySelector('a[href="#/settings/account"]')`));
await go('#/settings/account'); await sleep(250);
ok('account: signed out → translated sign-in form', await ev(`!!document.querySelector('.login-form [name=email]') && document.querySelector('.login-form button[type=submit]').textContent === 'Sign in'`));
// validation and errors are translated; a raw server message is never shown
await ev(`(() => { const f = document.querySelector('.login-form'); f.querySelector('[name=email]').value = 'nope'; f.querySelector('[name=password]').value = '123'; f.requestSubmit(); })(); 1`); await sleep(100);
ok('account: validation message in English', await ev(`document.querySelector('.login-msg').textContent === CT.i18n.tx('set.acc.need')`));
await ev(`CT.cloud.signIn = async () => { throw new Error('PGRST301 internal: relation auth.x does not exist'); }; (() => { const f = document.querySelector('.login-form'); f.querySelector('[name=email]').value = 'a@b.co'; f.querySelector('[name=password]').value = '1234567'; f.requestSubmit(); })(); 1`); await sleep(200);
ok('account: unknown server error → generic text, raw message hidden', await ev(`document.querySelector('.login-msg').textContent === CT.i18n.tx('set.acc.err.server') && !document.body.textContent.includes('PGRST301')`));
// unsaved input survives a language switch, focus kept
await ev(`(() => { const e = document.querySelector('.login-form [name=email]'); e.value = 'draft@example.invalid'; e.focus(); })(); 1`);
await setLang('he'); await sleep(250);
ok('language switch: typed email kept, focus kept, page in Hebrew', await ev(`document.querySelector('.login-form [name=email]').value === 'draft@example.invalid' && document.activeElement === document.querySelector('.login-form [name=email]') && document.querySelector('#set-cat-h').textContent.trim() === 'חשבון וסנכרון'`));
await ev(`document.querySelector('.login-form [name=email]').value = ''; document.activeElement.blur(); 1`);
await shot('set-he-1440-account');

/* language radio: focus stays on the chosen language */
await go('#/settings/language'); await sleep(200);
await ev(`(() => { const r = document.querySelector('input[name=ct-lang][value=en]'); r.focus(); r.checked = true; r.dispatchEvent(new Event('change', { bubbles: true })); })(); 1`); await sleep(300);
ok('language: switching from settings keeps focus on the radio, page in English', await ev(`document.activeElement && document.activeElement.name === 'ct-lang' && document.activeElement.value === 'en' && document.querySelector('#set-cat-h').textContent.trim() === 'Language' && document.documentElement.dir === 'ltr'`));

/* read-only lock: no setting can write */
await go('#/settings/study'); await sleep(200);
const before = await ev(`CT.store.state.settings.pomodoro.work`);
await ev(`window.__lk = CT.guard.locked; CT.guard.locked = () => true; CT.app.rerender(); 1`); await sleep(150);
ok('read-only: a warning shows in settings', await ev(`!!document.querySelector('.set-main .set-warn')`));
await change('[name=work]', '44'); await sleep(150);
await go('#/settings/data'); await sleep(150);
await ev(`document.querySelector('[data-action=reset]').click(); 1`); await sleep(250);
await ev(`(() => { const b = [...document.querySelectorAll('.modal-backdrop button')].find(b => b.classList.contains('btn-danger')); if (b) b.click(); })(); 1`); await sleep(250);
ok('read-only: changing a setting and "delete everything" do not write', await ev(`CT.store.state.settings.pomodoro.work === ${before} && CT.store.state.courses.length > 0`));
await ev(`CT.guard.locked = window.__lk; document.querySelectorAll('.modal-backdrop').forEach(m => m.remove()); CT.app.rerender(); 1`); await sleep(150);

/* danger zone: separate, confirmation (cancel keeps the data) */
await go('#/settings/data'); await sleep(200);
ok('danger: delete-all lives in its own marked area, apart from backup', await ev(`!!document.querySelector('.set-danger [data-action=reset]') && !document.querySelector('#set-backup [data-action=reset]')`));
const nCourses = await ev(`CT.store.state.courses.length`);
await ev(`document.querySelector('[data-action=reset]').focus(); document.querySelector('[data-action=reset]').click(); 1`); await sleep(250);
ok('danger: confirmation dialog is translated and labelled', await ev(`(() => { const m = document.querySelector('.modal-backdrop'); return !!m && /Delete all data/.test(m.textContent); })()`));
await key('Escape'); await sleep(200);
ok('danger: cancelling keeps all data, focus back on the button', await ev(`CT.store.state.courses.length === ${nCourses} && document.activeElement && document.activeElement.dataset.action === 'reset'`));
await shot('set-en-1440-data');

/* Moodle and AI settings still work */
await go('#/settings/moodle'); await sleep(200);
ok('moodle settings: link field, file import and categories present', await ev(`!!document.querySelector('#moodle') && !!document.querySelector('#moodle-classes') && !!document.querySelector('#moodle [data-action^=moodle-]')`));
await go('#/settings/ai'); await sleep(400);
ok('AI settings: status card with a link to the AI page', await ev(`!!document.querySelector('#ai .ai-status') && !!document.querySelector('#ai a[href="#/ai"]')`));

/* phones: list → category → back */
await view(390, 844); await go('#/settings'); await sleep(250);
ok('phone: the category list shows, no category content', await ev(`getComputedStyle(document.querySelector('.set-main')).display === 'none' && document.querySelectorAll('.set-cat').length === 10 && !document.querySelector('.set-cat.active')`));
ok('phone: list rows show a one-line summary where useful', await ev(`!!document.querySelector('.set-cat[data-cat=appearance] small') && !!document.querySelector('.set-cat[data-cat=data] small')`));
await shot('set-en-390-list');
await ev(`document.querySelector('.set-cat[data-cat=degree]').click(); 1`); await sleep(400);
ok('phone: a category opens on its own view, heading focused', await ev(`location.hash === '#/settings/degree' && getComputedStyle(document.querySelector('.set-side')).display === 'none' && document.activeElement.id === 'set-cat-h'`));
ok('phone: a visible way back', await ev(`document.querySelector('.set-back').getClientRects().length > 0`));
await shot('set-en-390-degree');
await ev(`document.querySelector('.set-back').click(); 1`); await sleep(400);
ok('phone: back returns to the list with focus on the category you left', await ev(`location.hash === '#/settings' && document.activeElement && document.activeElement.dataset.cat === 'degree'`));

/* header: no duplicated menu actions, every function reachable */
const menuLabels = async () => { await ev(`document.getElementById('more-btn').click(); 1`); await sleep(150); const l = await J(`[...document.querySelectorAll('.menu[role=menu] .menu-item')].map(b => b.textContent.trim())`); await ev(`CT.ui.closeMenu(); 1`); return l; };
const phoneMenu = await menuLabels();
ok('header (phone): the menu has the hidden header actions + settings', ['Settings', 'Undo last action', 'Keyboard shortcuts'].every((x) => phoneMenu.includes(x)) && phoneMenu.some((x) => /mode$/.test(x)), phoneMenu.join(' | '));
await view(1440, 900); await go('#/settings'); await sleep(200);
const wideMenu = await menuLabels();
ok('header (wide): the menu repeats nothing that is visible (only the language switch)', wideMenu.length === 1 && /Hebrew/.test(wideMenu[0]), wideMenu.join(' | '));
ok('header: the level chip is translated in English (no Hebrew)', await ev(`(() => { const c = document.getElementById('sb-xp'); return !c || (!/[\\u0590-\\u05FF]/.test(c.textContent) && !/[\\u0590-\\u05FF]/.test(c.getAttribute('aria-label'))); })()`), await ev(`(document.getElementById('sb-xp') || {}).textContent`));
ok('xp: level names translate; others stay as typed', await ev(`CT.views.xp.levelLabel('מיקוד') === 'Focus' && CT.views.xp.levelLabel('אגדה 2') === 'Legend 2' && CT.views.xp.levelLabel('My title') === 'My title'`));

/* adhkar reminders never cover the AI input or a field you type in; they wait, then come back */
await ev(`(() => { let b = document.getElementById('adk-toasts'); if (!b) { b = document.createElement('div'); b.id = 'adk-toasts'; document.body.appendChild(b); } const t = document.createElement('div'); t.className = 'adk-toast test-toast'; t.innerHTML = '<p class="adk-toast-t">x</p><div class="adk-toast-a"><button class="btn btn-small">a</button></div>'; b.appendChild(t); })(); 1`);
await view(390, 844); await go('#/courses'); await sleep(1300);
ok('adhkar: a reminder shows on an ordinary page', await ev(`!document.getElementById('adk-toasts').hidden && document.querySelector('.test-toast').getClientRects().length > 0`));
ok('adhkar (phone): the page keeps room for it at the bottom', await ev(`parseInt(getComputedStyle(document.documentElement).getPropertyValue('--adk-room')) > 0`));
await go('#/ai'); await sleep(1300);
ok('adhkar: on the AI page the reminder waits (hidden, not dismissed)', await ev(`document.getElementById('adk-toasts').hidden && !!document.querySelector('.test-toast')`));
await go('#/settings/study'); await sleep(300);
await ev(`document.querySelector('[name=work]').focus(); 1`); await sleep(1300);
ok('adhkar: while typing in a field the reminder waits', await ev(`document.getElementById('adk-toasts').hidden`));
await ev(`document.activeElement.blur(); 1`); await sleep(1300);
ok('adhkar: after leaving the field it comes back', await ev(`!document.getElementById('adk-toasts').hidden && !!document.querySelector('.test-toast')`));
await ev(`CT.views.ai.open(); 1`); await sleep(1300);
ok('adhkar: over the quick AI panel it waits', await ev(`document.getElementById('adk-toasts').hidden`));
await ev(`CT.views.chat.close(); document.querySelector('.test-toast').remove(); 1`); await sleep(1200);

/* widths × languages × all categories: no horizontal overflow */
for (const lang of ['he', 'en']) {
  await setLang(lang);
  for (const w of [320, 390, 800, 1440]) {
    await view(w, w < 768 ? 740 : 900);
    let bad = [];
    for (const c of ['', ...CATS]) { await go('#/settings' + (c ? '/' + c : '')); await sleep(90); if (!(await overflow(w))) bad.push(c || 'home'); }
    ok(`settings ${lang} ${w}: no horizontal overflow in any category`, bad.length === 0, bad.join(','));
  }
}
await setLang('he'); await view(320, 640); await go('#/settings/xp'); await sleep(150); await shot('set-he-320-xp');
await view(800, 900); await go('#/settings'); await sleep(150); await shot('set-he-800-list');
// dark + accents
await ev(`CT.app.setTheme('dark'); 1`); await sleep(150);
await view(1440, 900); await go('#/settings/appearance'); await sleep(150); await shot('set-he-dark-1440');
await setLang('en'); await go('#/settings/data'); await sleep(150); await shot('set-en-dark-1440-data');
const accBg = new Set();
for (const acc of ['teal', 'rose', 'amber', 'forest']) { await ev(`document.documentElement.dataset.accent = '${acc}'; 1`); await sleep(60); accBg.add(await ev(`getComputedStyle(document.querySelector('.set-cat.active')).color`)); }
ok('accents: the active category follows each XP accent', accBg.size === 4, [...accBg].join(' '));
await view(390, 844); await go('#/settings/appearance'); await sleep(150); await shot('set-en-dark-390-appearance');
await ev(`delete document.documentElement.dataset.accent; CT.app.setTheme('light'); 1`);
await view(1440, 900); await setLang('he');

/* ---------- offline ---------- */
await setLang('he');
await send('Network.enable');
await send('Network.emulateNetworkConditions', { offline: true, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
await go('#/settings/data'); await reload();
ok('offline reload renders the settings (data)', await ev(`!!document.querySelector('.set-main')`));
await send('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });

ok('no page errors / i18n warnings', errs.length === 0, errs.slice(0, 6).join(' || '));
const fails = results.filter((r) => r[0] === 'FAIL');
console.log(`\n${results.length - fails.length}/${results.length} passed`);
fs.writeFileSync(path.join(DIR, 'f-results.txt'), results.map((r) => r.join('\t')).join('\n'));
ws.close(); chrome.kill();
process.exit(fails.length ? 1 : 0);
