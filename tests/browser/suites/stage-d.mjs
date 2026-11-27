// Stage D checks in headless Chrome (synthetic data only): Today / Courses / course workspace.
// usage: node tests/browser/suites/stage-d.mjs <site> <cdpPort>
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { CHROME, CHROME_ARGS, workDir, SEED } from '../lib/env.mjs';
import { attachSW } from '../lib/swattach.mjs';
const DIR = workDir('stage-d');
const [SITE, PORT] = process.argv.slice(2);
const SHOTS = path.join(DIR, 'shotsD'); fs.mkdirSync(SHOTS, { recursive: true });
const prof = path.join(DIR, 'pd' + (Date.now() % 10000));
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
    if (p.closest('[dir=auto],textarea,option,select,.tag,[lang=ar],.c-art,.cw-kv,.note-print,.note-preview,.nb-body')) continue; out.push(n.textContent.trim().slice(0, 40)); }
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
const pastSem = await ev(`CT.store.state.semesters[1].id`);

/* ---------- Today ---------- */
// an exam in 3 days plus an item for the same event (same course, same date) → shown once, as the exam
await ev(`(() => { const d = CT.u.addDays(CT.u.today(), 3); CT.store.commit('t', s => { const c = s.courses.find(x => x.id === '${cid}'); c.exams.push({ id: 'exq', label: 'בוחן', date: d }); c.categories[0].items.push(CT.model.newItem('בוחן אמצע', { due: d })); }); })(); 1`);
await go('#/');
ok('same event as item + exam appears once (as the exam)', await ev(`(() => { const a = CT.stats.agenda(CT.store.activeCourses()); return a.some(x => x.kind === 'exam' && x.exam.id === 'exq') && !a.some(x => x.kind === 'item' && x.item.title === 'בוחן אמצע'); })()`));
ok('today renders head, next, agenda', await ev(`!!document.querySelector('.td-head h1') && !!document.querySelector('.td-next') && !!document.querySelector('.td-agenda')`));
const ag = await J(`CT.stats.agenda(CT.store.activeCourses()).map(x => x.kind + ':' + (x.item ? x.item.id : x.exam.id))`);
ok('agenda has no duplicates', new Set(ag).size === ag.length, ag.join(','));
ok('agenda mixes items and exams', ag.some((x) => x.startsWith('exam')) && ag.some((x) => x.startsWith('item')));
ok('no old notices on Today', await ev(`!document.querySelector('#main .banner, #main .notices')`));
ok('daily card has goal or stats, and adhkar row when on', await ev(`!!document.querySelector('.td-daily .td-goal, .td-daily .td-stats')`));
// next-other keeps focus
const n1 = await ev(`document.querySelector('.td-next').dataset.id`);
await click('.td-other'); await sleep(150);
ok('"another" switches suggestion and keeps focus', await ev(`document.querySelector('.td-next').dataset.id !== ${JSON.stringify(n1)} && document.activeElement.classList.contains('td-other')`));
// agenda check → done + undo
const agItem = await ev(`document.querySelector('.ag-row [data-action=toggle]').dataset.id`);
await click('.ag-row [data-action=toggle]'); await sleep(200);
ok('agenda checkbox completes item', await ev(`CT.store.findItem(${JSON.stringify(agItem)}).item.status === 'done'`));
await ev(`CT.store.undo(); 1`); await sleep(200);
ok('undo restores it', await ev(`CT.store.findItem(${JSON.stringify(agItem)}).item.status !== 'done'`));
// Moodle failure stays visible on Today
await ev(`CT.store.commit('t', s => { s.moodle = s.moodle || {}; s.moodle.linkError = { message: 'HTTP 403', at: new Date().toISOString() }; }); 1`); await sleep(200);
ok('Moodle failure alert with retry on Today', await ev(`!!document.querySelector('.td-alert [data-action=moodle-retry]')`));
await shot('today-he-1440-alert');
await ev(`CT.store.commit('t', s => { delete s.moodle.linkError; }); 1`); await sleep(200);

/* ---------- Courses ---------- */
await go('#/courses');
ok('courses page (not the semester page) renders cards', await ev(`!!document.querySelector('.courses-pg .cc') && !document.querySelector('.sem-page, .semester-page')`));
ok('every card has an emblem svg', await ev(`[...document.querySelectorAll('.cc')].every(c => c.querySelector('.cc-art svg.c-art'))`));
ok('card meter has one segment per non-empty category', await ev(`(() => { const c = document.querySelector('.cc'); const co = CT.store.course(c.dataset.id); return c.querySelectorAll('.cc-meter > span').length === co.categories.filter(k => k.items.length).length; })()`));
await go(`#/courses?sem=${pastSem}`);
ok('previous semester shows records list', await ev(`!!document.querySelector('.cp-records .rec-list li') && document.querySelector('.cp-sem.is-on') !== null`));
ok('make-active link on a non-active semester', await ev(`!!document.querySelector('[data-act=activate]')`));
await go('#/courses');
await click('.cc [data-act=menu]'); await sleep(150);
ok('card menu has open/edit/color/archive/delete', await ev(`document.querySelectorAll('.menu .menu-item').length >= 5`));
await closeOverlays();
await ev(`CT.views.courses.archive(CT.store.course(${JSON.stringify(ids[1])})); 1`); await sleep(200);
ok('archive hides the card', await ev(`!document.querySelector('.cc[data-id="${ids[1]}"]')`));
await ev(`CT.store.undo(); 1`); await sleep(200);
ok('undo archive brings it back', await ev(`!!document.querySelector('.cc[data-id="${ids[1]}"]')`));
await click('.cp-head [data-act=new]'); await sleep(200);
ok('new course dialog opens with the semester preset', await ev(`(() => { const s = document.querySelector('.modal [name=semester]'); return !!s && s.value === CT.store.state.settings.activeSemesterId; })()`));
await closeOverlays();
await ev(`CT.views.courses.colorDialog(CT.store.course(${JSON.stringify(cid)})); 1`); await sleep(200);
ok('color dialog is a radio group', await ev(`!!document.querySelector('.modal [role=radiogroup] [role=radio][aria-checked=true]')`));
await closeOverlays();

/* ---------- Course workspace ---------- */
await go(`#/course/${cid}`);
ok('workspace header, tabs, categories', await ev(`!!document.querySelector('.cw-head') && document.querySelectorAll('.cw-tab').length === 3 && document.querySelectorAll('.cat').length > 0`));
ok('done items folded by default', await ev(`[...document.querySelectorAll('.rows-done')].every(r => r.hidden) && document.querySelectorAll('.done-toggle').length > 0`));
await click('.done-toggle'); await sleep(150);
ok('fold toggle expands and keeps focus', await ev(`document.activeElement.classList.contains('done-toggle') && document.activeElement.getAttribute('aria-expanded') === 'true' && !document.querySelector('.rows-done').hidden`));
await click('.cw-tab[data-tab=grades]'); await sleep(200);
ok('grades tab updates the address', await ev(`location.hash.endsWith('?tab=grades') && !!document.querySelector('.grades')`));
await reload();
ok('reload keeps the selected tab', await ev(`document.querySelector('.cw-tab.is-on').dataset.tab === 'grades'`));
await ev(`document.querySelector('.cw-tab.is-on').focus(); 1`);
await key('ArrowLeft'); await sleep(200);
ok('arrow keys move between tabs (RTL: left = next)', await ev(`document.querySelector('.cw-tab.is-on').dataset.tab === 'notebook' && document.activeElement.dataset.tab === 'notebook'`));
await go(`#/course/${cid}`);
// deep link to a completed item
const doneId = await ev(`CT.store.course(${JSON.stringify(cid)}).categories[0].items.find(i => i.status === 'done').id`);
await go(`#/course/${cid}?item=${doneId}`); await sleep(200);
ok('deep link to a completed item unfolds and focuses it', await ev(`document.activeElement && document.activeElement.dataset.id === ${JSON.stringify(doneId)}`));
// filters
await go(`#/course/${cid}`);
await click('.cw-f[data-filter=open]'); await sleep(150);
ok('filter "open" shows no done rows', await ev(`document.querySelectorAll('.row.st-done').length === 0 && document.querySelector('.cw-f.is-on').dataset.filter === 'open'`));
await click('.cw-f[data-filter=all]'); await sleep(150);
// quick-add draft survives re-render and language switch
const cat0 = await ev(`document.querySelector('.cat').dataset.id`);
await ev(`(() => { const i = document.querySelector('.quick-add[data-cat="${cat0}"] input'); i.focus(); i.value = 'טיוטה חדשה'; i.dispatchEvent(new Event('input', { bubbles: true })); i.setSelectionRange(2, 2); })(); 1`);
await ev(`CT.store.commit('x', s => { s.settings.x_test = 1; }); 1`); await sleep(200);
ok('quick-add draft survives a re-render', await ev(`document.querySelector('.quick-add[data-cat="${cat0}"] input').value === 'טיוטה חדשה'`));
await ev(`document.querySelector('.quick-add[data-cat="${cat0}"] input').focus(); document.querySelector('.quick-add[data-cat="${cat0}"] input').setSelectionRange(2, 2); 1`);
const y0 = await ev(`window.scrollTo(0, 120); scrollY`);
await ev(`CT.i18n.setLang('en'); 1`); await sleep(300);
ok('language switch re-renders the page in English', await ev(`document.getElementById('main').getAttribute('lang') === 'en' && document.getElementById('main').dir === 'ltr' && document.querySelector('.cw-tab').textContent.trim() === 'Items'`));
ok('language switch keeps draft, focus and caret', await ev(`(() => { const i = document.activeElement; return i && i.matches('.quick-add input') && i.value === 'טיוטה חדשה' && i.selectionStart === 2; })()`));
ok('language switch keeps scroll position', Math.abs((await ev('scrollY')) - y0) < 5, `${y0}`);
ok('language switch keeps the route', await ev(`location.hash === '#/course/${cid}'`));
await ev(`document.querySelector('.quick-add[data-cat="${cat0}"]').requestSubmit(); 1`); await sleep(200);
ok('quick-add submits the draft', await ev(`CT.store.findCat('${cat0}').cat.items.some(i => i.title === 'טיוטה חדשה')`));
// keyboard on rows
const r1 = await ev(`document.querySelector('.rows:not(.rows-done) .row').dataset.id`);
await ev(`document.querySelector('.row[data-id="${r1}"]').focus(); 1`);
await key('f'); await sleep(150);
ok('F stars the focused row and focus stays', await ev(`CT.store.findItem('${r1}').item.flag === true && document.activeElement.dataset.id === '${r1}'`));
await key('f'); await sleep(150);
await key('m'); await sleep(150);
ok('M opens the row menu (keyboard reach for secondary actions)', await ev(`!!document.querySelector('.menu .menu-item')`));
await closeOverlays(); await ev(`document.querySelector('.row[data-id="${r1}"]').focus(); 1`);
await key(' '); await sleep(150);
ok('Space completes the focused row', await ev(`CT.store.findItem('${r1}').item.status === 'done'`));
await ev(`CT.store.undo(); 1`); await sleep(150);
await ev(`document.querySelector('.row[data-id="${r1}"]').focus(); 1`);
await key('Enter'); await sleep(150);
ok('Enter opens the note editor', await ev(`document.activeElement.matches('.note-input')`));
await ev(`(() => { const t = document.activeElement; t.value = 'note x'; t.dispatchEvent(new Event('input', { bubbles: true })); })(); 1`); await sleep(100);
ok('note autosaves', await ev(`CT.store.findItem('${r1}').item.note === 'note x'`));
await key('Escape'); await sleep(150);
ok('Escape closes the note and returns focus to the row', await ev(`document.activeElement.dataset && document.activeElement.dataset.id === '${r1}'`));
// bulk add
await ev(`CT.views.course.bulkAdd(CT.store.course('${cid}'), '${cat0}'); 1`); await sleep(150);
ok('bulk add preview is translated', await ev(`/Will create/.test(document.querySelector('.modal .preview-line').textContent)`));
const before = await ev(`CT.store.findCat('${cat0}').cat.items.length`);
await ev(`(() => { const m = document.querySelector('.modal'); m.querySelector('[name=count]').value = 3; [...m.querySelectorAll('button')].find(b => b.classList.contains('btn-primary')).click(); })(); 1`); await sleep(200);
ok('bulk add creates items', (await ev(`CT.store.findCat('${cat0}').cat.items.length`)) === before + 3);
await ev(`CT.store.undo(); 1`); await sleep(150);
// drag reorder helper keeps done items in their slots
ok('reorderSome reorders only the listed ids', await ev(`(() => { const a = [{id:'a'},{id:'b'},{id:'c'},{id:'d'}]; CT.ui.reorderSome(a, ['c','a']); return a.map(x=>x.id).join('') === 'cbad'; })()`));
// finish course + undo
await ev(`CT.views.course.finishDialog(CT.store.course('${cid}')); 1`); await sleep(150);
ok('finish dialog translated', await ev(`/Finish course/.test(document.querySelector('.modal').textContent)`));
await ev(`(() => { const m = document.querySelector('.modal'); m.querySelector('[name=grade]').value = 90; [...m.querySelectorAll('button')].find(b => b.classList.contains('btn-primary')).click(); })(); 1`); await sleep(200);
ok('finishing records the outcome', await ev(`CT.store.course('${cid}').outcome && CT.store.course('${cid}').outcome.grade === 90`));
await ev(`CT.store.undo(); 1`); await sleep(150);
ok('undo finish', await ev(`!CT.store.course('${cid}').outcome`));
// course switch menu
await click('.cw-switch'); await sleep(150);
ok('course switcher lists the semester courses', await ev(`document.querySelectorAll('.menu .menu-item').length >= ${ids.length}`));
await closeOverlays();
// Stage G: every page is translated, including the XP page, so English is LTR there too
await go('#/xp');
ok('XP page in English is LTR (translated)', await ev(`!document.getElementById('main').hasAttribute('data-ct-content') && document.getElementById('main').dir === 'ltr'`));
await go('#/courses');
ok('translated page in English is LTR', await ev(`document.getElementById('main').dir === 'ltr' && !document.getElementById('main').hasAttribute('data-ct-content')`));

/* ---------- no Hebrew UI left in English ---------- */
for (const h of ['#/', '#/courses', `#/courses?sem=${pastSem}`, `#/course/${cid}`, `#/course/${cid}?tab=grades`, `#/course/${cid}?tab=notebook`]) {
  await go(h); await sleep(100);
  if (h === `#/course/${cid}`) { await ev(`document.querySelectorAll('.done-toggle[aria-expanded=false]').forEach(b => b.click()); 1`); await sleep(150); }
  const heb = await J(HEB_UI);
  ok(`EN: no Hebrew interface text on ${h}`, heb.length === 0, heb.slice(0, 8).join(' | '));
}
// dialogs in English
for (const [nm, ex] of [['details', `CT.views.course.itemDetails('${r1}')`], ['course form', `CT.views.course.courseForm(CT.store.course('${cid}'))`], ['template', `CT.views.course.templateDialog(CT.store.course('${cid}'))`], ['due', `CT.views.course.editDue('${r1}')`]]) {
  await ev(`${ex}; 1`); await sleep(150);
  const heb = await J(`(() => { const m = document.querySelector('.modal'); const out = []; ${USER} const w = document.createTreeWalker(m, NodeFilter.SHOW_TEXT); while (w.nextNode()) { const n = w.currentNode; if (/[\\u0590-\\u05FF]/.test(strip(n.textContent)) &&!n.parentElement.closest('[dir=auto],textarea,option')) out.push(n.textContent.trim()); } return out; })()`);
  ok(`EN dialog "${nm}" has no Hebrew UI`, heb.length === 0, heb.join(' | '));
  ok(`EN dialog "${nm}" is LTR`, await ev(`document.querySelector('.modal-backdrop').getAttribute('dir') === 'ltr' || document.querySelector('.modal').closest('[dir=ltr]') !== null`));
  await closeOverlays();
}
// dates/numbers locale-aware
await go('#/');
ok('EN date line uses English month/day names', await ev(`/[A-Za-z]/.test(document.querySelector('.td-date').textContent)`));

/* ---------- overflow: both languages × both themes × 4 widths ---------- */
const routes = ['#/', '#/courses', `#/course/${cid}`, `#/course/${cid}?tab=grades`, `#/course/${cid}?tab=notebook`];
for (const lang of ['he', 'en']) {
  await ev(`CT.i18n.setLang('${lang}'); 1`); await sleep(200);
  for (const theme of ['light', 'dark']) {
    await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: theme }] });
    for (const w of [320, 390, 800, 1440]) {
      await view(w, w < 768 ? 800 : 900); await sleep(150);
      const bad = [];
      for (const h of routes) {
        await go(h);
        if (h === `#/course/${cid}`) { await ev(`document.querySelectorAll('.done-toggle[aria-expanded=false]').forEach(b => b.click()); 1`); await sleep(150); }
        // measured against the device width (w): on mobile emulation an overflow widens innerWidth along with the page
        const o = await J(`({ sw: document.documentElement.scrollWidth, iw: innerWidth, sx: scrollX, wide: [...document.querySelectorAll('body *')].filter(e => { const r = e.getBoundingClientRect(); return r.width && (r.right > ${w} + 1 || r.left < -1) && !(e.parentElement && e.parentElement.closest('.cw-tabs,.cw-filters,.math-block,.note-preview,#subnav,.note-snippet,.ag-sub,.cc-fact-t,.cp-sem')) && !e.closest('.skip-link,.toast,.toasts,.td-chip-sub') && getComputedStyle(e).position !== 'fixed'; }).slice(0, 3).map(e => (e.id || e.className.toString().slice(0, 30) || e.tagName) + ' ' + Math.round(e.getBoundingClientRect().left) + '/' + Math.round(e.getBoundingClientRect().right)) })`);
        if (o.sw > w ||o.iw > w || o.sx !== 0 || o.wide.length) bad.push(`${h} sw${o.sw}/iw${o.iw}/sx${o.sx} ${o.wide.join(';')}`);
      }
      ok(`no horizontal overflow ${lang}/${theme}/${w}`, !bad.length, bad.join(' || '));
      if ((w === 390 || w === 1440) && (theme === 'light' || w === 1440)) {
        for (const [nm, h] of [['today', '#/'], ['courses', '#/courses'], ['course', `#/course/${cid}`]]) { await go(h); await ev('scrollTo(0,0); 1'); await sleep(120); await shot(`${nm}-${lang}-${theme}-${w}`); }
      }
    }
  }
}
await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'light' }] });
await view(1440, 900);
// accents
for (const acc of ['teal', 'violet', 'rose']) {
  await ev(`document.documentElement.setAttribute('data-accent', '${acc}'); 1`); await go('#/courses'); await sleep(150);
  ok(`accent ${acc} applies to the active semester pill`, await ev(`getComputedStyle(document.querySelector('.cp-sem.is-on')).color !== getComputedStyle(document.body).color`));
}
await shot('courses-en-accent-rose-1440');
await ev(`document.documentElement.removeAttribute('data-accent'); 1`);

/* ---------- offline ---------- */
await send('Network.enable');
await send('Network.emulateNetworkConditions', { offline: true, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
await go(`#/course/${cid}?tab=notebook`); await reload();
ok('offline reload renders the course workspace (deep link + tab)', await ev(`!!document.querySelector('.cw-head') && document.querySelector('.cw-tab.is-on').dataset.tab === 'notebook'`));
await go('#/courses'); await sleep(200);
ok('offline courses page renders with emblems (no network images)', await ev(`!!document.querySelector('.cc .c-art')`));
await send('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
ok('no external image requests', await ev(`performance.getEntriesByType('resource').every(r => !/\\.(png|jpe?g|webp|gif)(\\?|$)/.test(r.name) || r.name.startsWith(location.origin))`));

ok('no page errors / i18n warnings', errs.length === 0, errs.slice(0, 6).join(' || '));
const fails = results.filter((r) => r[0] === 'FAIL');
console.log(`\n${results.length - fails.length}/${results.length} passed`);
fs.writeFileSync(path.join(DIR, 'd-results.txt'), results.map((r) => r.join('\t')).join('\n'));
ws.close(); chrome.kill();
process.exit(fails.length ? 1 : 0);
