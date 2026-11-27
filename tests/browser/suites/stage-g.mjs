// Stage G checks (synthetic data): degree screens and every remaining screen in both languages, offline.
// usage: node tests/browser/suites/stage-g.mjs <site> <cdpPort>   (normally started by tests/browser/run.mjs)
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { CHROME, CHROME_ARGS, workDir, SEED } from '../lib/env.mjs';
import { attachSW } from '../lib/swattach.mjs';
const DIR = workDir('stage-g');
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

/* ================= Stage G.1: degree screens ================= */
const setLang = async (l) => { await ev(`CT.i18n.setLang('${l}'); 1`); await sleep(250); };
const overflow = (w) => ev(`document.documentElement.scrollWidth <= ${w} + 1`);
const sems = await J(`CT.store.state.semesters.map(s => s.id)`);
const G1 = ['#/grades', '#/catalog', '#/semesters', `#/semesters/${sems[1]}`, '#/stats'];
const tabsOf = () => J(`[...document.querySelectorAll('.catalog [role=tab]')].map(b => b.dataset.tab)`);

await view(1440, 900); await setLang('en');
for (const r of G1) {
  await go(r); await sleep(200);
  const heb = await J(HEB_UI);
  ok(`G.1 en ${r}: no Hebrew interface text`, heb.length === 0, heb.slice(0, 6).join(' | '));
  ok(`G.1 en ${r}: page is English LTR`, await ev(`document.getElementById('main').dir === 'ltr' && document.getElementById('main').lang === 'en'`));
}
await go('#/catalog'); await sleep(200);
for (const tb of await tabsOf()) {
  await click(`[data-tab=${tb}]`); await sleep(150);
  const heb = await J(HEB_UI);
  ok(`G.1 en catalog tab ${tb}: no Hebrew interface text`, heb.length === 0, heb.slice(0, 6).join(' | '));
}
await click('[data-tab=mandatory]'); await sleep(150);
await shot('g1-en-1440-catalog');
await go('#/grades'); await sleep(200); await shot('g1-en-1440-grades');

/* calculations are the same in both languages and match js/gpa.js */
const kpi = () => J(`[...document.querySelectorAll('.gpa-kpi .kpi-v')].map(b => b.textContent.trim())`);
const calc = await J(`(() => { const st = CT.store.state; const r = CT.gpa.compute(st.courses, st.semesters, st.settings.gpa); const d = st.settings.gpa.decimals ?? 2; return [String(+r.avg.toFixed(d)), String(+r.earned.toFixed(d))]; })()`);
const en = await kpi(); await setLang('he'); const he = await kpi(); await setLang('en');
ok('GPA: the shown average / credits equal js/gpa.js, same in both languages', en[0] === calc[0] && en[1] === calc[1] && JSON.stringify(en) === JSON.stringify(he), JSON.stringify({ calc, en, he }));
ok('GPA: trend chart reads oldest-first left-to-right in English', await ev(`(() => { const c = [...document.querySelectorAll('.trend .pt-cum')].map(x => +x.getAttribute('cx')); return c.length >= 2 && c[0] < c[c.length - 1]; })()`));
await setLang('he'); await sleep(100);
ok('GPA: trend chart reads oldest-first right-to-left in Hebrew', await ev(`(() => { const c = [...document.querySelectorAll('.trend .pt-cum')].map(x => +x.getAttribute('cx')); return c.length >= 2 && c[0] > c[c.length - 1]; })()`));
// what-if: typing keeps focus and value; switching the language keeps the typed value
await setLang('en');
await ev(`(() => { const i = document.querySelector('[data-hyp]'); i.focus(); i.value = '95'; i.dispatchEvent(new Event('input', { bubbles: true })); })(); 1`); await sleep(500);
ok('GPA what-if: recalculates, focus stays in the field', await ev(`document.activeElement.matches('[data-hyp]') && document.activeElement.value === '95' && /95|Expected/.test(document.querySelector('.whatif-result').textContent)`));
await setLang('he'); await sleep(200);
ok('GPA what-if: language switch keeps the typed value', await ev(`document.querySelector('[data-hyp]').value === '95'`));
await ev(`document.querySelector('[data-action=clear-hyp]').click(); 1`); await sleep(150);
await setLang('en');
// category filter keeps focus on the checkbox
await ev(`(() => { const c = document.querySelector('[data-cat=lab]'); c.focus(); c.click(); })(); 1`); await sleep(200);
ok('GPA: filter checkbox keeps focus after redraw', await ev(`document.activeElement && document.activeElement.dataset.cat === 'lab'`));
await ev(`document.querySelector('[data-cat=lab]').click(); 1`); await sleep(150);

/* catalog: tabs by keyboard */
await go('#/catalog'); await sleep(200);
await ev(`document.querySelector('[role=tab][aria-selected=true]').focus(); 1`);
await key('ArrowRight'); await sleep(200);
ok('catalog: ArrowRight (English) moves to the next tab and keeps focus on it', await ev(`document.activeElement.getAttribute('role') === 'tab' && document.activeElement.getAttribute('aria-selected') === 'true' && document.activeElement.dataset.tab !== 'mandatory'`));
await key('Home'); await sleep(200);
ok('catalog: Home returns to the first tab', await ev(`document.activeElement.dataset.tab === 'mandatory'`));

/* semesters: edit dialog is a translated dialog; quick-entry draft survives a language switch */
await go(`#/semesters/${sems[1]}`); await sleep(200);
await click('[data-action=edit-sem]'); await sleep(200);
ok('semester edit dialog: English, LTR', await ev(`(() => { const m = document.querySelector('.modal-backdrop'); return !!m && m.lang === 'en' && m.dir === 'ltr' && /Edit semester/.test(m.textContent); })()`));
await key('Escape'); await sleep(200); await closeOverlays();
await click('[data-action=manual]'); await sleep(200);
await ev(`(() => { const i = document.querySelector('.draft-table [data-d=name]'); i.value = 'Draft course'; i.dispatchEvent(new Event('input', { bubbles: true })); })(); 1`);
await setLang('he'); await sleep(200);
ok('semester quick entry: draft row kept across a language switch', await ev(`document.querySelector('.draft-table [data-d=name]') && document.querySelector('.draft-table [data-d=name]').value === 'Draft course'`));
await click('[data-action=draft-clear]'); await sleep(150);
await setLang('en');

/* security: hostile names render as text (rendered DOM), bidi controls isolated in plain-text places */
const PAY = '<img src=x onerror="window.__pwn=1">';
await ev(`CT.store.commit('t', (st) => { st.courses.forEach((c, i) => { if (i < 2) c.name = ${JSON.stringify(PAY)} + ' \\u202Eevil'; }); st.semesters[1].name = ${JSON.stringify(PAY)}; }); 1`); await sleep(200);
for (const r of [...G1, '#/', '#/courses']) {
  await go(r); await sleep(200);
  ok(`security ${r}: hostile names are inert text`, await ev(`!window.__pwn && !document.querySelector('#main img[src="x"]') && !document.querySelector('#main [onerror]')`));
}
await go('#/grades'); await sleep(200);
ok('security: user text in aria-label is isolated (FSI…PDI) and its own bidi controls are not shown', await ev(`(() => { const a = [...document.querySelectorAll('[aria-label]')].map(e => e.getAttribute('aria-label')).find(v => v.includes('evil')); return !!a && a.includes('\\u2068') && !a.includes('\\u202E'); })()`));
ok('security: stored names are unchanged (bidi characters kept in the data)', await ev(`CT.store.state.courses.some(c => c.name.includes('\\u202E'))`));
await ev(`CT.store.undo(); 1`); await sleep(200);

/* widths × languages × themes */
for (const lang of ['he', 'en']) {
  await setLang(lang);
  for (const w of [320, 390, 800, 1440]) {
    await view(w, 900);
    let bad = [];
    for (const r of G1) { await go(r); await sleep(120); if (!(await overflow(w))) bad.push(r); }
    ok(`G.1 ${lang} ${w}: no horizontal overflow`, bad.length === 0, bad.join(' '));
  }
}
await view(390, 844); await setLang('he'); await ev(`CT.app.setTheme('dark'); 1`);
await go('#/grades'); await sleep(200); await shot('g1-he-dark-390-grades');
await go('#/semesters'); await sleep(200); await shot('g1-he-dark-390-semesters');
await view(800, 900); await setLang('en'); await go('#/stats'); await sleep(200); await shot('g1-en-dark-800-stats');
await ev(`CT.app.setTheme('light'); 1`);
await view(1440, 900); await setLang('he'); await go('#/semesters'); await sleep(200); await shot('g1-he-1440-semesters');
await go('#/catalog'); await sleep(200); await shot('g1-he-1440-catalog');

/* ================= Stage G.2: remaining screens ================= */
const HEB_IN = (sel) => `(() => { const out = []; ${USER} const root = document.querySelector(${JSON.stringify(sel)}); if (!root) return ['<missing ' + ${JSON.stringify(sel)} + '>'];
  const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  while (w.nextNode()) { const n = w.currentNode; if (!/[\\u0590-\\u05FF]/.test(strip(n.textContent))) continue; const p = n.parentElement;
    if (p.closest('[dir=auto],bdi,textarea,option,select,.tag,[lang=ar],[lang=he]')) continue; out.push(n.textContent.trim().slice(0, 40)); }
  root.querySelectorAll('[aria-label],[title],[placeholder]').forEach((e) => ['aria-label','title','placeholder'].forEach((a) => { const v = e.getAttribute(a); if (v && /[\\u0590-\\u05FF]/.test(strip(v))) out.push(a + ':' + v.slice(0, 40)); }));
  return out; })()`;
const G2 = ['#/schedule', '#/review', '#/archive', '#/xp', '#/xp?tab=badges', '#/xp?tab=prizes', '#/xp?tab=log', '#/adhkar'];
// data the G.2 screens show: flagged items, an archived course, a prize, subtasks, a study log entry, points
await ev(`CT.store.commit('seed g2', (st) => {
  const c0 = st.courses.filter(c => c.kind !== 'record')[0];
  c0.categories[0].items.slice(0, 2).forEach((it, i) => { it.flag = true; it.note = i ? '' : 'note **bold**'; });
  c0.categories[0].items[0].subs = [{ id: 's1', t: 'step one', done: true }, { id: 's2', t: 'step two', done: false }];
  const last = st.courses.filter(c => c.kind !== 'record').slice(-1)[0]; last.archived = true;
  CT.game.ensure(st).prizes.push({ id: 'pz1', name: 'Pizza night', cost: 100 });
  st.studyLog.push({ id: 'sl1', courseId: c0.id, date: CT.u.today(), minutes: 45 });
}); 1`); await sleep(300);
await ev(`CT.store.toggleDone(CT.store.state.courses.filter(c => c.kind !== 'record')[0].categories[0].items[3].id); 1`); await sleep(300);
const g2item = await ev(`CT.store.state.courses.filter(c => c.kind !== 'record')[0].categories[0].items[0].id`);
const ledgerBefore = await ev(`JSON.stringify(CT.store.state.game.ledger.map(e => [e.k, e.label, e.why]))`);

await view(1440, 900); await setLang('en');
for (const r of G2) {
  await go(r); await sleep(250);
  const heb = await J(HEB_UI);
  ok(`G.2 en ${r}: no Hebrew interface text`, heb.length === 0, heb.slice(0, 6).join(' | '));
  ok(`G.2 en ${r}: page is English LTR`, await ev(`document.getElementById('main').dir === 'ltr' && document.getElementById('main').lang === 'en' && !document.getElementById('main').hasAttribute('data-ct-content')`));
}
ok('XP: stored ledger labels/reasons unchanged by the language', ledgerBefore === await ev(`JSON.stringify(CT.store.state.game.ledger.map(e => [e.k, e.label, e.why]))`));
await go('#/xp'); await sleep(200);
ok('XP: daily challenge shown by id in English', await ev(`(() => { const ch = CT.game.challenge(CT.game.dayKey()); return document.querySelector('.chal-name').textContent.includes(CT.i18n.tx('game.ch.' + ch.id)) && !/[\\u0590-\\u05FF]/.test(document.querySelector('.chal-name').textContent); })()`));
await shot('g2-en-1440-xp');
await go('#/xp?tab=badges'); await sleep(200);
ok('XP deep link ?tab=badges selects the tab; badge names are English', await ev(`document.querySelector('.xp-tabs [aria-current=page]').getAttribute('href') === '#/xp?tab=badges' && document.querySelector('.badges li b').textContent === CT.i18n.tx('game.ach.first.name')`));
await go('#/xp?tab=log'); await sleep(200);
ok('XP log: built-in reasons are translated (e.g. Easy/Normal/Hard)', await ev(`[...document.querySelectorAll('.xp-why .tag')].some(t => /^(Easy|Normal|Hard|On time|Early)$/.test(t.textContent))`));
await go('#/xp?tab=prizes'); await sleep(200);
ok('XP title picker keeps stored Hebrew values, shows English labels', await ev(`(() => { const o = [...document.querySelectorAll('[data-title] option')].filter(x => x.value); return o.length >= 1 && o.every(x => /[\\u0590-\\u05FF]/.test(x.value) && !/[\\u0590-\\u05FF]/.test(x.textContent)); })()`));
await click('[data-pdel=pz1]'); await sleep(250);
ok('XP delete-prize confirm is an English dialog', await ev(`(() => { const m = document.querySelector('.modal-backdrop'); return !!m && m.lang === 'en' && m.dir === 'ltr' && /Delete the prize/.test(m.textContent); })()`));
await key('Escape'); await sleep(200); await closeOverlays();

/* schedule: add dialog; review: deep link + print line + undo toast; archive */
await go('#/schedule'); await sleep(200);
await click('[data-action=add]'); await sleep(200);
const schDlg = await J(HEB_IN('.modal-backdrop'));
ok('schedule: add-class dialog in English', schDlg.length === 0 && await ev(`document.querySelector('.modal-backdrop').lang === 'en'`), schDlg.join(' | '));
await key('Escape'); await sleep(200); await closeOverlays();
await shot('g2-en-1440-schedule');
await go(`#/review?course=${cid}`); await sleep(200);
ok('review deep link ?course= selects the course', await ev(`document.querySelector('[data-action=course]').value === ${JSON.stringify(cid)}`));
ok('review: print-only summary line has a localized date and count', await ev(`(() => { const p = document.querySelector('.print-only'); return !!p && /item/.test(p.textContent) && /20\\d\\d/.test(p.textContent); })()`));
await ev(`document.querySelector('.rv-list [data-action=done]').click(); 1`); await sleep(300);
ok('review: "Reviewed" toast is English with an Undo button', await ev(`(() => { const t = [...document.querySelectorAll('.toast')].pop(); return !!t && /Removed from the review list/.test(t.textContent) && /Undo/.test(t.textContent); })()`));
await ev(`CT.store.undo(); 1`); await sleep(300);
await go('#/archive'); await sleep(200);
ok('archive: restore and delete controls are English', await ev(`/Restore to dashboard/.test(document.querySelector('.archive').textContent) && /Delete .* permanently/.test(document.querySelector('.arch-list [data-action=delete]').getAttribute('aria-label'))`));

/* timer panel, focus screen, subtasks window, adhkar reader */
await go('#/'); await sleep(200);
await ev(`CT.timer.open(); 1`); await sleep(300);
const tmrH = await J(HEB_IN('.modal-backdrop'));
ok('timer panel in English (incl. today log, manual add)', tmrH.length === 0 && /Study timer/.test(await ev(`document.querySelector('.modal-backdrop').textContent`)), tmrH.join(' | '));
await shot('g2-en-1440-timer');
await key('Escape'); await sleep(200); await closeOverlays();
await ev(`CT.focus.start(${JSON.stringify(g2item)}, 5); 1`); await sleep(400);
const fxH = await J(HEB_IN('.focus-screen'));
ok('focus screen in English, dialog semantics kept', fxH.length === 0 && await ev(`document.querySelector('.focus-screen').getAttribute('role') === 'dialog' && /Just 5 minutes/.test(document.querySelector('.focus-screen').textContent)`), fxH.join(' | '));
await shot('g2-en-1440-focus');
ok('focus screen follows the interface language (lang=en, LTR)', await ev(`(() => { const f = document.querySelector('.focus-screen'); return f.lang === 'en' && f.dir === 'ltr'; })()`));
await ev(`document.querySelector('[data-fx=exit]').click(); 1`); await sleep(400);
ok('focus: Exit closes the screen', await ev(`!document.querySelector('.focus-screen:not(.out)')`));
await ev(`CT.focus.openSubs(${JSON.stringify(g2item)}); 1`); await sleep(300);
const subH = await J(HEB_IN('.modal-backdrop'));
ok('subtasks window in English', subH.length === 0 && /Subtasks/.test(await ev(`document.querySelector('.modal-backdrop').textContent`)), subH.join(' | '));
await key('Escape'); await sleep(200); await closeOverlays();
await ev(`CT.views.adhkar.open('m'); 1`); await sleep(800);
const adkH = await J(HEB_IN('.adk'));
ok('adhkar reader: interface in English, the adhkar stay Arabic', adkH.length === 0 && await ev(`!!document.querySelector('.adk .adk-text[lang=ar]') && /Previous/.test(document.querySelector('.adk-foot').textContent)`), adkH.join(' | '));
await shot('g2-en-1440-adhkar-reader');
ok('adhkar reader frame is LTR in English: Previous sits left of Next', await ev(`(() => { const r = document.querySelector('.adk'); const p = r.querySelector('[data-adk=prev]').getBoundingClientRect(), n = r.querySelector('[data-adk=next]').getBoundingClientRect(); return r.dir === 'ltr' && p.left < n.left; })()`));
await ev(`CT.views.adhkar.close(); 1`); await sleep(300);

/* keyboard shortcuts and deep links still work */
await go('#/'); await sleep(200); await ev(`document.body.focus(); 1`);
await key('g'); await key('s'); await sleep(300);
ok('shortcut g then s opens the timetable', await ev(`location.hash === '#/schedule'`));

/* Hebrew stays Hebrew */
await setLang('he');
for (const r of ['#/schedule', '#/xp', '#/adhkar']) {
  await go(r); await sleep(200);
  ok(`G.2 he ${r}: Hebrew RTL`, await ev(`document.getElementById('main').dir === 'rtl' && /[\\u0590-\\u05FF]/.test(document.querySelector('#main h1').textContent)`));
}
await go('#/xp'); await sleep(200);
ok('XP Hebrew: challenge name equals the stored game.js text', await ev(`document.querySelector('.chal-name').textContent.includes(CT.game.challenge(CT.game.dayKey()).name)`));
await setLang('en');

/* security on G.2 screens */
const PAY2 = '<img src=x onerror="window.__pwn=1">';
await ev(`CT.store.commit('t2', (st) => { st.courses.forEach((c) => { c.name = ${JSON.stringify(PAY2)} + ' \\u202Eevil'; c.categories.forEach(k => k.items.forEach(i => { i.title = ${JSON.stringify(PAY2)}; })); }); st.game.prizes.forEach(p => { p.name = ${JSON.stringify(PAY2)}; }); }); 1`); await sleep(200);
for (const r of G2) {
  await go(r); await sleep(200);
  ok(`security ${r}: hostile names are inert text`, await ev(`!window.__pwn && !document.querySelector('#main img[src="x"]') && !document.querySelector('#main [onerror]')`));
}
await ev(`CT.timer.open(); 1`); await sleep(300);
ok('security: timer panel renders hostile course names as text', await ev(`!window.__pwn && !document.querySelector('.modal-backdrop img[src="x"]')`));
await key('Escape'); await sleep(200); await closeOverlays();
await ev(`CT.focus.start(${JSON.stringify(g2item)}, 5); 1`); await sleep(300);
ok('security: focus screen renders hostile titles as text', await ev(`!window.__pwn && !document.querySelector('.focus-screen img[src="x"]')`));
await ev(`document.querySelector('[data-fx=exit]').click(); 1`); await sleep(300);
await go('#/archive'); await sleep(200);
ok('security: archive delete label isolates the name (FSI…PDI, no RLO)', await ev(`(() => { const a = document.querySelector('.arch-list [data-action=delete]').getAttribute('aria-label'); return a.includes('\\u2068') && !a.includes('\\u202E'); })()`));
await ev(`CT.store.undo(); 1`); await sleep(200);

/* widths × languages */
for (const lang of ['he', 'en']) {
  await setLang(lang);
  for (const w of [320, 390, 800, 1440]) {
    await view(w, 900);
    let bad = [];
    for (const r of G2) { await go(r); await sleep(120); if (!(await overflow(w))) bad.push(r); }
    ok(`G.2 ${lang} ${w}: no horizontal overflow (long hostile names)`, bad.length === 0, bad.join(' '));
  }
}
// the widths above ran with long hostile names (a stress case); restore the real data for the screenshots
await ev(`(() => { for (let i = 0; i < 6 && CT.store.state.courses.some(c => c.name.includes('__pwn')); i++) CT.store.undo(); return 1; })()`); await sleep(200);
ok('test data restored after the hostile-name pass', await ev(`!CT.store.state.courses.some(c => c.name.includes('__pwn'))`));
await view(390, 844); await setLang('he'); await ev(`CT.app.setTheme('dark'); 1`);
await go('#/xp'); await sleep(200); await shot('g2-he-dark-390-xp');
await go('#/schedule'); await sleep(200); await shot('g2-he-dark-390-schedule');
await setLang('en'); await go('#/review'); await sleep(200); await shot('g2-en-dark-390-review');
await ev(`CT.app.setTheme('light'); 1`);
await view(1440, 900); await setLang('he'); await go('#/adhkar'); await sleep(300); await shot('g2-he-1440-adhkar');
await go('#/archive'); await sleep(200); await shot('g2-he-1440-archive');

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
fs.writeFileSync(path.join(DIR, 'g-results.txt'), results.map((r) => r.join('\t')).join('\n'));
ws.close(); chrome.kill();
process.exit(fails.length ? 1 : 0);
