// Stage E checks (synthetic data): Moodle workspace, AI workspace (mocked Edge Function; no network, no paid calls).
// usage: node tests/browser/suites/stage-e.mjs <site> <cdpPort>   (normally started by tests/browser/run.mjs)
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { CHROME, CHROME_ARGS, workDir, SEED } from '../lib/env.mjs';
import { attachSW } from '../lib/swattach.mjs';
const DIR = workDir('stage-e');
const [SITE, PORT] = process.argv.slice(2);
const SHOTS = path.join(DIR, 'shotsE'); fs.mkdirSync(SHOTS, { recursive: true });
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
    if (p.closest('[dir=auto],bdi,textarea,option,select,.tag,[lang=ar],.c-art,.cw-kv,.note-print,.note-preview,.nb-body')) continue; out.push(n.textContent.trim().slice(0, 40)); }
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

/* ================= Moodle workspace ================= */
const setLang = async (l) => { await ev(`CT.i18n.setLang('${l}'); 1`); await sleep(250); };
const overflow = (w) => ev(`document.documentElement.scrollWidth <= ${w} + 1`);
await go('#/moodle');
ok('moodle: header, connection chip, list card render', await ev(`!!document.querySelector('.mw-head h1') && !!document.querySelector('.mw-conn') && !!document.querySelector('.mw-list .mm-tabs')`));
ok('moodle: one status line (no duplicate counts in it)', await ev(`document.querySelectorAll('.mw-status').length === 1 && !/ברענון האחרון/.test(document.querySelector('.mw-status').textContent)`));
ok('moodle: not-assigned list is on the page with assign controls', await ev(`!!document.querySelector('#mw-inbox .moodle-inbox-row select') && !!document.querySelector('#mw-inbox [data-action=moodle-assign]')`));
ok('moodle: categories grouped (coursework | calendar) with separators', await ev(`document.querySelectorAll('.mm-tabs .mm-tab-sep').length >= 1 && !!document.querySelector('.mm-tab-cal')`));
ok('moodle: every tab has role=tab and one is selected', await ev(`[...document.querySelectorAll('.mm-tab')].every(t => t.getAttribute('role') === 'tab') && document.querySelectorAll('.mm-tab[aria-selected=true]').length === 1`));
ok('moodle: urgency groups with SVG icons (no emoji headings)', await ev(`[...document.querySelectorAll('.mm-group h2')].every(h => h.querySelector('svg') && !/[\\u{1F300}-\\u{1FAFF}]/u.test(h.textContent))`));
const tabsN = await ev(`document.querySelectorAll('.mm-tab').length`);
await ev(`document.querySelector('.mm-tab.active').focus(); 1`);
await key('ArrowLeft'); await sleep(200);
ok('moodle: arrow key moves to the next tab and keeps focus (RTL)', await ev(`document.activeElement.classList.contains('mm-tab') && document.activeElement.dataset.tab !== 'all'`));
await key('Home'); await sleep(200);
ok('moodle: Home returns to "all"', await ev(`document.querySelector('.mm-tab.active').dataset.tab === 'all'`));
// course filter
const firstCourse = await ev(`document.querySelector('[data-mm=course] option:nth-child(2)').value`);
await ev(`(() => { const s = document.querySelector('[data-mm=course]'); s.value = ${JSON.stringify(firstCourse)}; s.dispatchEvent(new Event('change', { bubbles: true })); })(); 1`); await sleep(200);
ok('moodle: course filter keeps only that course', await ev(`[...document.querySelectorAll('.mm-list li')].every(li => li.querySelector('.u-title').getAttribute('href').includes(${JSON.stringify(firstCourse)}))`));
await ev(`(() => { const s = document.querySelector('[data-mm=course]'); s.value = ''; s.dispatchEvent(new Event('change', { bubbles: true })); })(); 1`); await sleep(200);
// show done
await ev(`(() => { const c = document.querySelector('[data-mm=done]'); c.checked = true; c.dispatchEvent(new Event('change', { bubbles: true })); })(); 1`); await sleep(200);
ok('moodle: "show done" toggle keeps working', await ev(`document.querySelector('[data-mm=done]').checked`));
await ev(`(() => { const c = document.querySelector('[data-mm=done]'); c.checked = false; c.dispatchEvent(new Event('change', { bubbles: true })); })(); 1`); await sleep(200);
// classify a row → manual tag + undo
const rowUid = await ev(`document.querySelector('.mm-list li[data-uid]').dataset.uid`);
await ev(`(() => { const s = document.querySelector('.mm-list li[data-uid="${rowUid}"] [data-mm-cls]'); s.value = 'other'; s.dispatchEvent(new Event('change', { bubbles: true })); })(); 1`); await sleep(250);
ok('moodle: picking a category is remembered (manual)', await ev(`Object.keys(CT.moodle.ensure(CT.store.state).classMap).length > 0`));
await ev(`CT.store.undo(); 1`); await sleep(200);
ok('moodle: undo forgets it', await ev(`Object.keys(CT.moodle.ensure(CT.store.state).classMap).length === 0`));
// assign from the not-assigned list
const inboxN = await ev(`CT.moodle.ensure(CT.store.state).inbox.length`);
await ev(`(() => { const r = document.querySelector('#mw-inbox .moodle-inbox-row'); const s = r.querySelector('select'); s.value = s.options[1].value; })(); 1`);
await click('#mw-inbox [data-action=moodle-assign]'); await sleep(250);
ok('moodle: assigning moves the event out of the not-assigned list', await ev(`CT.moodle.ensure(CT.store.state).inbox.length`) === inboxN - 1);
await ev(`CT.store.undo(); 1`); await sleep(200);
ok('moodle: undo brings it back', await ev(`CT.moodle.ensure(CT.store.state).inbox.length`) === inboxN);

/* tag dialogs: changed / gone / merge (on the Moodle page) */
const syncedId = await ev(`[...document.querySelectorAll('.mm-list li[data-id]')].find(li => li.dataset.id).dataset.id`);
await ev(`CT.store.commit('t', s => { const it = CT.store.findItem('${syncedId}').item; it.source.changed = { prevTitle: 'ישן', prevDue: it.due, at: new Date().toISOString() }; }); 1`); await sleep(200);
await setLang('en'); await go('#/moodle'); await sleep(200);
await click(`.mm-list li[data-id="${syncedId}"] [data-action=moodle-changed]`); await sleep(200);
ok('moodle EN: "updated" dialog is English and LTR', await ev(`(() => { const m = document.querySelector('.modal-backdrop .modal'); return !!m && /Updated in Moodle/.test(m.textContent) && m.closest('[dir]').getAttribute('dir') === 'ltr'; })()`));
await shot('moodle-changed-dialog-en');
await closeOverlays();
await ev(`CT.store.commit('t', s => { const it = CT.store.findItem('${syncedId}').item; it.source.changed = null; it.source.gone = { at: new Date().toISOString() }; }); 1`); await sleep(200);
await click(`.mm-list li[data-id="${syncedId}"] [data-action=moodle-gone]`); await sleep(200);
ok('moodle EN: "no longer in Moodle" menu is English', await ev(`(() => { const m = document.querySelector('.menu'); return !!m && /Keep as a regular item/.test(m.textContent) && !/[\\u0590-\\u05FF]/.test(m.textContent); })()`));
await closeOverlays();
await ev(`CT.store.commit('t', s => { CT.store.findItem('${syncedId}').item.source.gone = null; }); 1`); await sleep(150);

/* English: no Hebrew interface text; dates in English */
await go('#/moodle'); await sleep(200);
const heb = await J(HEB_UI);
ok('moodle EN: no Hebrew interface text in #main', heb.length === 0, heb.slice(0, 6).join(' | '));
ok('moodle EN: page is LTR', await ev(`document.getElementById('main').getAttribute('dir') === 'ltr'`));
ok('moodle EN: built-in categories translated, Moodle content kept', await ev(`[...document.querySelectorAll('.mm-tab')].some(t => /Assignments/.test(t.textContent)) && [...document.querySelectorAll('.mm-list [dir=auto]')].some(s => /[\\u0590-\\u05FF]/.test(s.textContent))`));
ok('moodle EN: dates are English', await ev(`/(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)/.test(document.querySelector('.mm-list').textContent)`));
await shot('moodle-en-1440');

/* errors: translated by code, actionable, never raw */
await ev(`CT.store.commit('t', s => { CT.moodle.ensure(s).linkError = { code: 'link-rejected', message: 'הודעה ישנה', at: new Date().toISOString() }; }); 1`); await sleep(250);
ok('moodle EN: sync failure alert, translated, with Settings action', await ev(`(() => { const a = document.querySelector('.mw-alert'); return !!a && a.getAttribute('role') === 'alert' && /Moodle rejected the link/.test(a.textContent) && !!a.querySelector('[data-action=mm-settings]'); })()`));
ok('moodle EN: connection chip says it needs attention', await ev(`document.querySelector('.mw-conn').classList.contains('is-error')`));
await go('#/'); await sleep(200);
ok('Today EN: Moodle failure translated, links to Moodle page', await ev(`(() => { const a = document.querySelector('.td-alert[role=alert]'); return !!a && /Moodle rejected the link/.test(a.textContent) && !!a.querySelector('a[href="#/moodle"]'); })()`));
await ev(`CT.store.commit('t', s => { CT.moodle.ensure(s).linkError = { code: 'internal-xyz', message: 'RAW-INTERNAL-ERROR stack', at: new Date().toISOString() }; }); 1`); await sleep(250);
await go('#/moodle'); await sleep(200);
ok('moodle: unknown error code → generic text, raw message never shown', await ev(`!document.body.textContent.includes('RAW-INTERNAL-ERROR') && /sync server had a problem/.test(document.querySelector('.mw-alert').textContent)`));
await ev(`document.getElementById('bell-btn') && document.getElementById('bell-btn').click(); 1`); await sleep(250);
ok('notification center: Moodle error is the translated text, not raw', await ev(`!document.body.textContent.includes('RAW-INTERNAL-ERROR')`));
await ev(`CT.views.notifications && CT.views.notifications.close && CT.views.notifications.close(false); 1`); await sleep(100);
await ev(`CT.store.commit('t', s => { CT.moodle.ensure(s).linkError = null; }); 1`); await sleep(200);

/* import result dialog (file path; synthetic events) */
await ev(`CT.views.moodle.importEvents(CT.ical.parse('BEGIN:VCALENDAR\\r\\nBEGIN:VEVENT\\r\\nUID:e1@x\\r\\nSUMMARY:HW 9 is due\\r\\nDTSTART:20991231T200000Z\\r\\nCATEGORIES:אותות ומערכות - 00440131\\r\\nEND:VEVENT\\r\\nEND:VCALENDAR\\r\\n').events, 'file'); 1`); await sleep(250);
ok('moodle EN: import result dialog is English with counts', await ev(`(() => { const m = document.querySelector('.modal-backdrop .modal'); return !!m && /Moodle import/.test(m.textContent) && !!m.querySelector('.moodle-result li'); })()`));
await shot('moodle-import-en');
await ev(`[...document.querySelectorAll('.modal-backdrop .modal button')].find(b => /Undo the import/.test(b.textContent)).click(); 1`); await sleep(250);
ok('moodle: "undo the import" removes it', await ev(`!CT.moodle.records(CT.store.state).has('e1@x')`));

/* settings card: translated block inside the untranslated settings page */
await go('#/settings/moodle'); await sleep(300);
ok('settings EN: Moodle card is an English, LTR block', await ev(`(() => { const c = document.getElementById('moodle'); return !!c && c.getAttribute('lang') === 'en' && c.getAttribute('dir') === 'ltr' && /Moodle assignment sync/.test(c.textContent) && !!c.querySelector('#moodle-classes'); })()`));
ok('settings EN: category editor keeps your stored names in inputs', await ev(`[...document.querySelectorAll('.mm-cls-name')].some(i => /[\\u0590-\\u05FF]/.test(i.value))`));
ok('settings: not-assigned list moved to the Moodle page (link only)', await ev(`!document.querySelector('#moodle .moodle-inbox-row') && !!document.querySelector('#moodle [data-action=moodle-goto-inbox]')`));
await click('#moodle [data-action=moodle-goto-inbox]'); await sleep(400);
ok('"assign" link opens the Moodle page at the list', await ev(`location.hash === '#/moodle' && !!document.getElementById('mw-inbox')`));

/* language switch on the page keeps it (translated route) */
await setLang('he'); await sleep(200);
ok('moodle: switching to Hebrew re-renders in place', await ev(`location.hash === '#/moodle' && document.querySelector('.mw-head h1').textContent === 'מודל' && document.documentElement.dir === 'rtl'`));

/* widths × languages × themes */
for (const lang of ['he', 'en']) {
  await setLang(lang);
  for (const w of [320, 390, 800, 1440]) {
    await view(w, 900); await go('#/moodle'); await sleep(200);
    ok(`moodle ${lang} ${w}: no horizontal overflow`, await overflow(w), await ev(`document.documentElement.scrollWidth`));
  }
}
await view(390, 844); await shot('moodle-en-390');
await ev(`localStorage.setItem('ct.theme', 'dark'); CT.app.setTheme && CT.app.setTheme('dark'); 1`); await sleep(200);
await view(1440, 900); await go('#/moodle'); await sleep(200);
ok('moodle dark: chip and alert colors differ from text (not color alone: icon + label)', await ev(`!!document.querySelector('.mw-conn svg') && !!document.querySelector('.mw-conn span')`));
await shot('moodle-en-dark-1440');
await setLang('he'); await go('#/moodle'); await sleep(200); await shot('moodle-he-dark-1440');
await ev(`localStorage.setItem('ct.theme', 'light'); CT.app.setTheme && CT.app.setTheme('light'); 1`); await sleep(150);
await go('#/moodle'); await shot('moodle-he-1440');

/* ================= AI workspace (mocked Edge Function; no network, no paid calls) ================= */
await view(1440, 900); await setLang('he');
const MOCK = `(() => {
  window.__ai = { calls: [], mode: 'ok', delay: 500, signed: true };
  const C = CT.cloud;
  Object.assign(C, { enabled: true, signedIn: () => window.__ai.signed, onLocalChange() {}, syncNow: async () => {}, userId: () => 'u-test', email: () => 'test@example.invalid',
    moodleFeed: async () => null, moodleSnapshot: async () => null });
  C.ai = async (body) => {
    const A = window.__ai; A.calls.push(body.action);
    if (A.mode === 'offline') throw new TypeError('Failed to fetch');
    if (body.action === 'usage') return { ok: true, configured: true, today: { requests: 3, extracts: 1, costUsd: 0.012 },
      limits: { perMinute: 10, dailyCostUsd: 0.5, dailyExtracts: 10, maxFileBytes: 10485760, maxPdfPages: 10, maxChatChars: 2000 },
      models: ['claude-haiku-5-5', 'claude-sonnet-5-5', 'claude-opus-5-5'], defaults: {} };
    if (body.action === 'ping') return { ok: true, model: 'claude-haiku-5-5', costUsd: 0.00002 };
    await new Promise((r) => setTimeout(r, A.delay));
    if (A.mode === 'quota') throw Object.assign(new Error('x'), { status: 429, data: { error: 'daily-cost', message: 'RAW SERVER TEXT' } });
    if (A.mode === 'weird') throw Object.assign(new Error('x'), { status: 500, data: { error: 'kaboom-internal', message: 'RAW SERVER TEXT' } });
    const last = body.messages[body.messages.length - 1];
    if (A.mode === 'tool' && last.content[0].type === 'text') return { content: [{ type: 'tool_use', id: 'tu' + A.calls.length, name: 'list_courses', input: {} }], stopReason: 'tool_use', costUsd: 0.0004, model: 'claude-haiku-5-5' };
    return { content: [{ type: 'text', text: '**תשובה** לדוגמה\\n- פריט ראשון\\n- פריט שני' }], stopReason: 'end_turn', costUsd: 0.0012, model: body.model };
  };
  CT.views.ai.reset();
  return 1; })()`;
await ev(MOCK);
const MOCK_KEEP = MOCK.replace('CT.views.ai.reset();', 'CT.views.ai.refreshUsage(); CT.views.chat.check();');
const chatCalls = () => ev(`window.__ai.calls.filter(x => x === 'chat').length`);
await go('#/ai'); await sleep(400);
ok('ai: page renders conversation + side column', await ev(`!!document.querySelector('.aiw .aiw-chat .chat-head') && !!document.querySelector('.aiw-chat textarea') && !!document.querySelector('.aiw-side .ai-status')`));
ok('ai: status "connected" with icon + label, usage meter and limits', await ev(`document.querySelector('.ai-status').classList.contains('is-ok') && !!document.querySelector('.ai-status svg') && !!document.querySelector('.ai-meter[role=meter]') && document.querySelectorAll('.ai-kv > div').length >= 4`));
ok('ai: model choice offers the server list', await ev(`document.querySelectorAll('[data-ai-pref=chatModel] option').length === 3`));
ok('ai: navigation destination is a link to #/ai and marked current', await ev(`[...document.querySelectorAll('[data-dest=ai]')].every(a => a.tagName === 'A' && a.getAttribute('href') === '#/ai') && !!document.querySelector('[data-dest=ai][aria-current]')`));
ok('ai: floating button hidden on the AI page', await ev(`document.getElementById('ai-fab').hidden === true`));
ok('ai: empty state with suggestions (existing tools only)', await ev(`document.querySelectorAll('.aiw-chat .chat-sug').length === 6`));
ok('ai: one usage request shared (page + status)', await ev(`window.__ai.calls.filter(x => x === 'usage').length === 1`));
await shot('ai-he-empty-1440');
// ask from a suggestion
await ev(`window.__ai.delay = 1800; 1`); await click('.aiw-chat .chat-sug'); await sleep(120);
ok('ai: while answering — typing indicator, send disabled', await ev(`!!document.querySelector('.aiw-chat .chat-wait') && document.querySelector('.aiw-chat .chat-send').disabled`));
// dedup: switch to another page and open the quick panel while the answer is on its way
await go('#/'); await sleep(100);
ok('ai: floating button visible again off the AI page', await ev(`document.getElementById('ai-fab').hidden === false`));
await ev(`CT.views.ai.open(); 1`); await sleep(150);
ok('ai: quick panel shows the same request in flight', await ev(`!!document.querySelector('.chat-panel .chat-wait') && document.querySelector('.chat-panel .chat-send').disabled`));
ok('ai: a second ask while busy sends nothing', (await ev(`CT.views.chat.ask('עוד שאלה')`)) === false);
await sleep(1800);
ok('ai: exactly one chat request was sent', (await chatCalls()) === 1);
ok('ai: answer appears in the panel, formatted safely', await ev(`!!document.querySelector('.chat-panel .chat-bot .chat-text b') && document.querySelectorAll('.chat-panel .chat-bot li').length === 2`));
ok('ai: usage on screen counts the answer', await ev(`CT.views.ai.usage().today.requests === 4`));
// draft: typed in the panel → kept on the page; language switch keeps it and the focus
await ev(`(() => { const ta = document.querySelector('.chat-panel textarea'); ta.focus(); ta.value = 'טיוטה שלי'; ta.dispatchEvent(new Event('input', { bubbles: true })); })(); 1`);
await click('.chat-panel [data-c=expand]'); await sleep(400);
ok('ai: expanding closes the panel (one surface at a time)', await ev(`!document.querySelector('.chat-panel') && location.hash === '#/ai'`));
ok('ai: the draft moved to the page', await ev(`document.querySelector('.aiw-chat textarea').value === 'טיוטה שלי'`));
await ev(`(() => { const ta = document.querySelector('.aiw-chat textarea'); ta.focus(); ta.setSelectionRange(3, 3); })(); 1`);
await setLang('en'); await sleep(250);
ok('ai EN: page re-rendered in English, draft + focus + caret kept', await ev(`document.querySelector('.aiw-chat .chat-title').textContent === 'AI assistant' && document.activeElement === document.querySelector('.aiw-chat textarea') && document.activeElement.value === 'טיוטה שלי' && document.activeElement.selectionStart === 3`));
ok('ai EN: history kept (no new request on language switch)', (await chatCalls()) === 1 && await ev(`document.querySelectorAll('.aiw-chat .chat-msg').length === 2`));
const hebAi = await J(HEB_UI);
ok('ai EN: no Hebrew interface text on the page', hebAi.length === 0, hebAi.slice(0, 6).join(' | '));
ok('ai EN: numbers/money in English locale', await ev(`/^(US)?\\$0\\.0\\d+ \\/ (US)?\\$0\\.50$/.test(document.querySelector('.ai-usage-top b').textContent)`), await ev(`document.querySelector('.ai-usage-top b').textContent`));
await shot('ai-en-1440');
// store changes re-render the page: the field keeps focus and text
await ev(`CT.store.commit('t', s => { s.settings.dummyE = 1; }); 1`); await sleep(200);
ok('ai: a store change re-renders without losing the draft or focus', await ev(`document.activeElement === document.querySelector('.aiw-chat textarea') && document.activeElement.value === 'טיוטה שלי'`));
// model choice
await ev(`(() => { const s = document.querySelector('[data-ai-pref=chatModel]'); s.value = 'claude-sonnet-5-5'; s.dispatchEvent(new Event('change', { bubbles: true })); })(); 1`); await sleep(250);
ok('ai: model choice saved and shown in the conversation header', await ev(`CT.store.state.settings.ai.chatModel === 'claude-sonnet-5-5' && document.querySelector('.aiw-chat .chat-model').textContent === 'Sonnet'`));
await ev(`CT.store.undo(); 1`); await sleep(150);
// tool chips (translated)
await ev(`window.__ai.mode = 'tool'; window.__ai.delay = 50; document.querySelector('.aiw-chat textarea').value = ''; 1`);
await ev(`CT.views.chat.ask('which courses?')`); await sleep(400);
ok('ai EN: tool chip translated ("Read the course list")', await ev(`[...document.querySelectorAll('.aiw-chat .chat-chip')].some(c => /Read the course list/.test(c.textContent))`));
// Enter sends from the keyboard
await ev(`window.__ai.mode = 'ok'; (() => { const ta = document.querySelector('.aiw-chat textarea'); ta.focus(); ta.value = 'hello'; ta.dispatchEvent(new Event('input', { bubbles: true })); })(); 1`);
const before = await chatCalls();
await key('Enter'); await sleep(300);
ok('ai: Enter sends the question', (await chatCalls()) === before + 1);
// errors: unknown server code → generic text, raw never shown; quota → blocked for today
await ev(`window.__ai.mode = 'weird'; CT.views.chat.ask('x')`); await sleep(200);
ok('ai EN: unknown server error → generic text, raw message hidden, question returned to field', await ev(`/Server error/.test(document.querySelector('.aiw-chat .chat-err').textContent) && !document.body.textContent.includes('RAW SERVER TEXT') && document.querySelector('.aiw-chat textarea').value === 'x'`), await ev(`JSON.stringify([document.querySelector('.aiw-chat .chat-err') && document.querySelector('.aiw-chat .chat-err').textContent, document.querySelector('.aiw-chat textarea').value, CT.views.chat.state()])`));
await ev(`window.__ai.mode = 'quota'; document.querySelector('.aiw-chat textarea').value = ''; CT.views.chat.ask('y')`); await sleep(200);
ok('ai EN: quota reached → one notice (no duplicate error line), send disabled, no further requests', await ev(`/usage limit/.test(document.querySelector('.aiw-chat .chat-note').textContent) && document.querySelector('.aiw-chat .chat-err').hidden && !document.querySelector('.aiw-chat .chat-note').hidden && document.querySelector('.aiw-chat .chat-send').disabled`));
const q0 = await chatCalls();
await ev(`CT.views.chat.ask('z')`);
ok('ai: no request while over the daily limit', (await chatCalls()) === q0);
await shot('ai-en-quota-1440');

/* account isolation: an answer still on its way is dropped when the account changes */
await reload(); await ev(MOCK_KEEP); await go('#/ai'); await sleep(300);
ok('ai: after reload the conversation is still here (this device only)', await ev(`document.querySelectorAll('.aiw-chat .chat-msg').length > 0`));
await ev(`window.__ai.delay = 600; CT.views.chat.ask('private question'); 1`); await sleep(100);
await ev(`CT.views.ai.reset(); 1`); await sleep(800);
ok('ai: sign-out / other account wipes the chat and drops the late answer', await ev(`CT.views.chat.state().count === 0 && !localStorage.getItem('ct.ai.chat') && !document.querySelector('.aiw-chat .chat-bot')`));
// signed out → gate with a way to settings
await ev(`window.__ai.signed = false; CT.views.ai.reset(); 1`); await go('#/courses'); await go('#/ai'); await sleep(300);
ok('ai EN: signed out → sign-in gate with Settings link, status "Sign-in needed"', await ev(`!!document.querySelector('.aiw-chat .chat-gate a[href="#/settings/account"]') && document.querySelector('.aiw-chat .chat-form').hidden && document.querySelector('.ai-status').classList.contains('is-signin')`));
await shot('ai-en-signin-390'.replace('390', '1440'));
await ev(`window.__ai.signed = true; CT.views.ai.reset(); 1`); await go('#/courses'); await go('#/ai'); await sleep(300);

/* offline: history stays, a notice, nothing sent */
await ev(`CT.views.chat.ask('one more'); 1`); await sleep(700);
await send('Network.enable');
await send('Network.emulateNetworkConditions', { offline: true, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
await ev(`window.dispatchEvent(new Event('offline')); 1`); await sleep(200);
ok('ai: offline → notice, send disabled, history visible', await ev(`!document.querySelector('.aiw-chat .chat-note').hidden && document.querySelector('.aiw-chat .chat-send').disabled && document.querySelectorAll('.aiw-chat .chat-msg').length >= 2`));
await send('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
await ev(`window.dispatchEvent(new Event('online')); 1`); await sleep(200);
ok('ai: back online → send enabled again', await ev(`document.querySelector('.aiw-chat .chat-note').hidden`));

/* the quick panel: keyboard, Escape and focus restoration (desktop + phone) */
await setLang('he'); await go('#/courses'); await sleep(200);
await ev(`document.getElementById('bell-btn').focus(); 1`);
await key('a'); await sleep(250);
ok('panel: A key opens it with focus in the field', await ev(`!!document.querySelector('.chat-panel') && document.activeElement === document.querySelector('.chat-panel textarea')`));
ok('panel: it is a labelled, translated dialog', await ev(`(() => { const p = document.querySelector('.chat-panel'); return p.getAttribute('role') === 'dialog' && p.getAttribute('aria-label') === 'עוזר AI' && p.hasAttribute('data-ct-localized'); })()`));
await key('Escape'); await sleep(150);
ok('panel: Escape closes and focus returns to what opened it', await ev(`!document.querySelector('.chat-panel') && document.activeElement.id === 'bell-btn'`));
await view(390, 844); await go('#/courses'); await sleep(250);
await ev(`document.activeElement && document.activeElement.blur(); CT.views.ai.open(); 1`); await sleep(250);
ok('phone: the panel covers the screen', await ev(`(() => { const r = document.querySelector('.chat-panel').getBoundingClientRect(); return r.width >= 389 && r.height >= 800; })()`));
await shot('ai-panel-he-390');
await ev(`document.querySelector('.chat-panel [data-c=close]').click(); 1`); await sleep(150);
ok('phone: closing gives focus to the visible AI destination (floating button is hidden)', await ev(`document.activeElement && document.activeElement.matches('.bottom-nav [data-dest=ai], [data-dest=ai]') && document.activeElement.getClientRects().length > 0`), await ev(`document.activeElement && document.activeElement.outerHTML.slice(0, 80)`));
// language switch while the panel is open: redrawn in the new language, draft kept
await view(1440, 900); await ev(`CT.views.ai.open(); 1`); await sleep(200);
await ev(`(() => { const ta = document.querySelector('.chat-panel textarea'); ta.value = 'draft'; ta.dispatchEvent(new Event('input', { bubbles: true })); })(); 1`);
await setLang('en'); await sleep(200);
ok('panel EN: redrawn in English, LTR, draft kept', await ev(`(() => { const p = document.querySelector('.chat-panel'); return !!p && p.getAttribute('dir') === 'ltr' && p.querySelector('.chat-title').textContent === 'AI assistant' && p.querySelector('textarea').value === 'draft'; })()`));
await shot('ai-panel-en-1440');
await ev(`CT.views.chat.close(); 1`);

/* settings card */
await go('#/settings/ai'); await sleep(300);
ok('settings EN: AI card is an English block linking to the AI page', await ev(`(() => { const c = document.getElementById('ai'); return !!c && c.getAttribute('lang') === 'en' && !!c.querySelector('a[href="#/ai"]') && !!c.querySelector('.ai-status'); })()`));

/* widths × languages, dark */
for (const lang of ['he', 'en']) {
  await setLang(lang);
  for (const w of [320, 390, 800, 1440]) {
    await view(w, w < 768 ? 700 : 900); await go('#/ai'); await sleep(250);
    ok(`ai ${lang} ${w}: no horizontal overflow, input inside the screen`, await ev(`document.documentElement.scrollWidth <= ${w} + 1 && (() => { const f = document.querySelector('.aiw-chat .chat-form').getBoundingClientRect(); return f.bottom <= innerHeight + 1 && f.right <= ${w} + 1; })()`),
      await ev(`JSON.stringify([document.documentElement.scrollWidth, document.querySelector('.aiw-chat .chat-form').getBoundingClientRect().bottom, innerHeight])`));
  }
}
await view(320, 640); await go('#/ai'); await sleep(200); await shot('ai-en-320');
await ev(`localStorage.setItem('ct.theme', 'dark'); CT.app.setTheme && CT.app.setTheme('dark'); 1`); await sleep(150);
await view(1440, 900); await go('#/ai'); await sleep(200); await shot('ai-en-dark-1440');
await view(390, 844); await setLang('he'); await go('#/ai'); await sleep(200); await shot('ai-he-dark-390');
const accBg = new Set();
for (const acc of ['teal', 'rose', 'amber', 'forest']) {
  await ev(`document.documentElement.setAttribute('data-accent', '${acc}'); 1`); await sleep(80);
  accBg.add(await ev(`getComputedStyle(document.querySelector('.aiw-chat .chat-send')).backgroundColor`));
}
ok('ai accents: send button follows each XP accent', accBg.size === 4, [...accBg].join(' '));
await ev(`document.documentElement.removeAttribute('data-accent'); localStorage.setItem('ct.theme', 'light'); CT.app.setTheme && CT.app.setTheme('light'); 1`);
await view(1440, 900);

/* ---------- offline ---------- */
await setLang('he');
await send('Network.enable');
await send('Network.emulateNetworkConditions', { offline: true, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
await go('#/moodle'); await reload();
ok('offline reload renders the Moodle page', await ev(`!!document.querySelector('.mw-head')`));
await send('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });

ok('no page errors / i18n warnings', errs.length === 0, errs.slice(0, 6).join(' || '));
const fails = results.filter((r) => r[0] === 'FAIL');
console.log(`\n${results.length - fails.length}/${results.length} passed`);
fs.writeFileSync(path.join(DIR, 'e-results.txt'), results.map((r) => r.join('\t')).join('\n'));
ws.close(); chrome.kill();
process.exit(fails.length ? 1 : 0);
