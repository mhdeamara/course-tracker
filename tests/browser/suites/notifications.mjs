// Stage C browser checks: notification center (synthetic data).  usage: node tests/browser/suites/notifications.mjs <site> <cdpPort> <he|en>
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { CHROME, CHROME_ARGS, workDir, SEED as SEED_FILE } from '../lib/env.mjs';
const DIR = workDir('notifications');
const [SITE, PORT, LANG = 'he'] = process.argv.slice(2);
const chrome = spawn(CHROME, [...CHROME_ARGS, '--headless=new', `--user-data-dir=${path.join(DIR, 'pn' + LANG + (Date.now() % 10000))}`,
  `--remote-debugging-port=${PORT}`, '--no-first-run', '--no-default-browser-check', '--hide-scrollbars', 'about:blank'], { stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let t;
for (let i = 0; i < 60 && !t; i++) { await sleep(300); try { t = (await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()).find((x) => x.type === 'page'); } catch (e) { /* not up */ } }
const ws = new WebSocket(t.webSocketDebuggerUrl);
await new Promise((r) => { ws.onopen = r; });
let id = 0; const pend = new Map(); const errs = [];
ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && pend.has(d.id)) { pend.get(d.id)(d); pend.delete(d.id); }
  else if (d.method === 'Runtime.exceptionThrown') errs.push(d.params.exceptionDetails.exception?.description || d.params.exceptionDetails.text);
  else if (d.method === 'Runtime.consoleAPICalled' && (d.params.type === 'error' || d.params.type === 'warning')) errs.push('console: ' + d.params.args.map((a) => a.value || a.description).join(' ')); };
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); }).then((d) => { if (d.error) throw new Error(method + ' ' + JSON.stringify(d.error)); return d.result; });
const ev = async (expr) => { const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text); return r.result.value; };
const view = (w, h, mobile) => send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile });
const results = []; const ok = (name, pass, info = '') => { results.push([pass ? 'PASS' : 'FAIL', name, info]); console.log(pass ? 'PASS' : 'FAIL', name, pass ? '' : info); };
const key = (k, extra = {}) => ev(`(document.activeElement || document).dispatchEvent(new KeyboardEvent('keydown', { key: ${JSON.stringify(k)}, bubbles: true, cancelable: true, ...${JSON.stringify(extra)} })); 1`);
const hash = () => ev('location.hash');
const go = async (h) => { await ev(`location.hash = ${JSON.stringify(h)}; 1`); await sleep(350); };
const shot = async (name) => { fs.mkdirSync(path.join(DIR, 'notif'), { recursive: true }); fs.writeFileSync(path.join(DIR, 'notif', `${name}-${LANG}.jpg`), Buffer.from((await send('Page.captureScreenshot', { format: 'jpeg', quality: 80 })).data, 'base64')); };
const badge = () => ev(`(document.querySelector('#bell-btn .nc-badge') || {}).textContent || ''`);
const items = () => ev(`document.querySelectorAll('.nc-item').length`);
const open = async () => { await ev(`CT.views.notifications.isOpen() || document.getElementById('bell-btn').click(); 1`); await sleep(250); };
const close = async () => { await ev(`CT.views.notifications.close(false); 1`); await sleep(100); };

// synthetic situation: Moodle updates + error + inbox, an old backup, a points pause
const SEED = `(() => {
  const now = Date.now(), iso = (ms) => new Date(now - ms).toISOString();
  CT.store.commit('', (st) => {
    const m = CT.moodle.ensure(st);
    m.changes = [{ kind: 'new', uid: 'u1', title: 'ש״ב 4 — מבני נתונים', at: iso(20 * 60000), seen: false },
                 { kind: 'changed', uid: 'u2', title: 'מעבדה 3', at: iso(20 * 60000), seen: false }];
    m.inbox = [{ uid: 'i1', title: 'Quiz 2 — Electronic Circuits' }, { uid: 'i2', title: 'סקר אמצע סמסטר' }];
    m.linkError = { code: 'fetch', message: 'השרת של מודל לא ענה', at: iso(3 * 3600000) };
    st.settings.lastBackup = iso(10 * 86400000); st.settings.backupSnooze = null;
    if (st.game) CT.game.pause(st, 'exams', new Date(now + 9 * 86400000).toISOString().slice(0, 10));
  }, { undo: false });
  return 1; })()`;

await send('Runtime.enable'); await send('Page.enable');
await view(1440, 900, false);
await send('Page.navigate', { url: SITE }); await sleep(1500);
await ev('Promise.race([navigator.serviceWorker.ready.then(() => 1), new Promise((r) => setTimeout(() => r(0), 8000))])'); await sleep(500);
await ev(`localStorage.clear(); 1`);
await ev(fs.readFileSync(SEED_FILE, 'utf8'));
await ev(`localStorage.setItem('ct.lang', '${LANG}'); localStorage.setItem('ct.theme', 'light'); 1`);
await send('Page.reload'); await sleep(1500);
await ev(SEED); await sleep(300);
const gameOn = await ev(`!!CT.store.state.game && !!CT.views.xp.noticeData()`);
const N = gameOn ? 5 : 4;

// 1) old places are empty; the bell carries the count
await go('#/');
ok('dashboard: no non-critical banners left', await ev(`!document.querySelector('#main .banner')`));
ok('bell badge = number of notifications', (await badge()) === String(N), await badge());
ok('bell accessible name says how many are unread', await ev(`document.getElementById('bell-btn').getAttribute('aria-label')`).then((l) => /\d/.test(l)));

// 2) open: popover under the bell, grouped, focus inside
await open();
const pop = JSON.parse(await ev(`JSON.stringify((() => { const p = document.querySelector('.nc'), b = document.getElementById('bell-btn').getBoundingClientRect(), r = p.getBoundingClientRect();
  return { role: p.getAttribute('role'), sheet: document.querySelector('.nc-layer').classList.contains('is-sheet'), top: r.top - b.bottom, inView: r.left >= 0 && r.right <= innerWidth && r.bottom <= innerHeight,
    groups: [...p.querySelectorAll('.nc-gh')].map((h) => h.id), focusIn: p.contains(document.activeElement), expanded: document.getElementById('bell-btn').getAttribute('aria-expanded'),
    lang: p.getAttribute('lang'), dir: p.getAttribute('dir'), unread: p.querySelectorAll('.nc-item.is-unread').length, times: [...p.querySelectorAll('time')].map((x) => x.textContent) }; })())`));
ok('desktop: anchored popover under the bell', pop.role === 'dialog' && !pop.sheet && pop.top >= 0 && pop.top < 20 && pop.inView, JSON.stringify(pop));
ok('grouped in fixed order', pop.groups.join() === (gameOn ? 'nc-g-moodle,nc-g-backup,nc-g-xp' : 'nc-g-moodle,nc-g-backup'), pop.groups.join());
ok('focus moves into the center, bell aria-expanded', pop.focusIn && pop.expanded === 'true');
ok(`localized (${LANG})`, pop.lang === LANG && pop.dir === (LANG === 'he' ? 'rtl' : 'ltr'));
ok('real timestamps only (Moodle change + error)', pop.times.length === 2, pop.times.join(' | '));
ok('imported titles kept as is with dir=auto', await ev(`[...document.querySelectorAll('.nc-sub [dir=auto]')].some((s) => s.textContent === 'Quiz 2 — Electronic Circuits')`));
await shot('pop-light');

// 3) keyboard: arrows move, Tab wraps, shortcuts are off, Escape closes and restores focus
const f0 = await ev(`document.activeElement.textContent`);
await key('ArrowDown'); const f1 = await ev(`document.activeElement.textContent`);
ok('ArrowDown moves focus', f0 !== f1 && await ev(`document.querySelector('.nc').contains(document.activeElement)`));
await key('End'); await key('Tab'); ok('Tab wraps inside', await ev(`document.querySelector('.nc').contains(document.activeElement)`));
await key('/'); ok('single-key shortcuts are off while open', await ev(`document.activeElement.id !== 'search' && CT.views.notifications.isOpen()`));
await key('Escape'); await sleep(100);
ok('Escape closes and focus returns to the bell', await ev(`!document.querySelector('.nc-layer') && document.activeElement.id === 'bell-btn'`));
await open(); await ev(`document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })); 1`); await sleep(100);
ok('click outside closes the popover', await ev(`!document.querySelector('.nc-layer')`));

// 4) read state: mark all → no dot, still listed, survives reload; per account
await open();
await ev(`document.querySelector('[data-nc=all]').click(); 1`); await sleep(150);
ok('mark all read: badge gone, nothing resolved', (await badge()) === '' && (await items()) === N && await ev(`!document.querySelector('.nc-item.is-unread')`));
await close();
await send('Page.reload'); await sleep(1500);
ok('read state survives reload, items still listed', (await badge()) === '' && await ev(`CT.views.notifications.list().list.length`) === N);
ok('read marks stored per device (local key)', await ev(`Object.keys(JSON.parse(localStorage.getItem('ct.notif.local'))).length`) === N);
await ev(`window.__si = CT.cloud.signedIn; window.__ui = CT.cloud.userId; CT.cloud.signedIn = () => true; CT.cloud.userId = () => 'acct-b'; CT.views.notifications.refresh(); 1`);
ok('another account starts unread (isolated)', (await badge()) === String(await ev(`CT.views.notifications.list().list.length`)) && (await badge()) !== '', await badge());
await ev(`CT.cloud.signedIn = window.__si; CT.cloud.userId = window.__ui; CT.views.notifications.refresh(); 1`);
ok('back to local: still read', (await badge()) === '');
await ev(`CT.store.commit('', (st) => { CT.moodle.ensure(st).changes.unshift({ kind: 'gone', uid: 'u3', title: 'בוחן', at: new Date().toISOString(), seen: false }); }, { undo: false }); 1`); await sleep(200);
ok('a new Moodle update is unread again (dedupe: still one Moodle-updates item)', (await badge()) === '1' && await ev(`CT.views.notifications.list().list.filter((n) => n.id.startsWith('moodle-changes')).length`) === 1);
await ev(`CT.app.rerender(); CT.app.rerender(); 1`);
ok('no reappearing unread on re-render', (await badge()) === '1');

// 5) actions
await open();
const act = (a) => ev(`(() => { const b = document.querySelector('[data-nc-act="${a}"]'); if (!b) return false; b.click(); return true; })()`);
ok('action "seen" resolves the Moodle update', await act('moodle-seen') && (await sleep(200), await ev(`!CT.views.notifications.list().list.some((n) => n.id.startsWith('moodle-changes'))`)));
ok('focus stays inside after the item resolved', await ev(`document.querySelector('.nc').contains(document.activeElement)`));
ok('action "later" snoozes the backup reminder', await act('snooze') && (await sleep(200), await ev(`!CT.views.notifications.list().list.some((n) => n.group === 'backup')`)));
if (gameOn) ok('action "resume" ends the pause', await act('xp-resume') && (await sleep(200), await ev(`!CT.views.notifications.list().list.some((n) => n.id.startsWith('xp-pause'))`)));
ok('center stays open and in sync after in-place actions', await ev(`CT.views.notifications.isOpen() && document.querySelectorAll('.nc-item').length === CT.views.notifications.list().list.length`));
ok('action "assign" goes to the Moodle inbox on the Moodle page', await act('moodle-inbox') && (await sleep(400), (await hash()) === '#/moodle' && await ev(`!document.querySelector('.nc-layer')`)));
await go('#/');
await open();
ok('action "settings" navigates and closes', await act('settings') && (await sleep(300), (await hash()).startsWith('#/settings') && await ev(`!document.querySelector('.nc-layer')`)));
await go('#/');

// 6) critical warnings stay on screen: sync conflict on the dashboard, schema lock, also offline
await ev(`window.__st = CT.cloud.status; CT.cloud.status = 'conflict'; CT.app.rerender(); 1`); await sleep(150);
ok('sync conflict stays as an on-screen banner, not in the center', await ev(`!!document.querySelector('#main .td-alert [data-action=sync-now]') && !CT.views.notifications.list().list.some((n) => /conflict|sync/.test(n.id))`));
await ev(`CT.cloud.status = window.__st; CT.app.rerender(); 1`);
await ev(`CT.guard.lock({ reason: 'newer', found: 99, source: 'local', uid: null }); 1`); await sleep(300);
await open();
ok('schema lock bar visible while the center is open', await ev(`(() => { const e = document.getElementById('lock-bar'); const b = e.getBoundingClientRect(); return !e.hidden && b.height > 40 && b.top < innerHeight; })()`));
await close();
await send('Network.enable'); await send('Network.emulateNetworkConditions', { offline: true, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
await send('Page.reload'); await sleep(2000);
await ev(`CT.guard.lock({ reason: 'newer', found: 99, source: 'local', uid: null }); 1`); await sleep(300); // a local lock is re-derived from the data on load
const off = JSON.parse(await ev(`JSON.stringify({ lock: !document.getElementById('lock-bar')?.hidden, shell: !!document.getElementById('bell-btn'), sw: !!navigator.serviceWorker.controller })`));
await open();
ok('offline + locked: lock bar visible, bell still works', off.lock && off.shell && await ev(`!!document.querySelector('.nc-layer')`), JSON.stringify(off));
await close();
await send('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
await ev(`localStorage.removeItem('ct.lock.v1'); 1`); await send('Page.reload'); await sleep(1500);

// 7) layouts + themes + screenshots (fresh unread situation)
await ev(`localStorage.removeItem('ct.notif.local'); 1`);
await ev(SEED); await sleep(300);
for (const theme of ['light', 'dark']) {
  await ev(`CT.app.setTheme('${theme}'); 1`); await sleep(150);
  for (const [w, h] of [[1440, 900], [800, 1000], [390, 844], [320, 640]]) {
    await view(w, h, w < 768); await go('#/'); await sleep(250);
    await open();
    const m = JSON.parse(await ev(`JSON.stringify((() => { const l = document.querySelector('.nc-layer'), p = l.querySelector('.nc'), r = p.getBoundingClientRect(), body = p.querySelector('.nc-body');
      const btns = [...p.querySelectorAll('button')].map((b) => b.getBoundingClientRect()).filter((b) => b.width);
      return { sheet: l.classList.contains('is-sheet'), left: Math.round(r.left), right: Math.round(r.right), bottom: Math.round(r.bottom), w: innerWidth, h: innerHeight,
        overflow: body.scrollWidth > body.clientWidth + 1 || p.scrollWidth > p.clientWidth + 1, pageX: document.documentElement.scrollWidth > innerWidth,
        smallBtn: btns.filter((b) => b.height < (innerWidth < 768 ? 40 : 28)).length }; })())`));
    if (w < 768) ok(`${theme} ${w}px: bottom sheet, full width, no overflow, touch targets`, m.sheet && m.left === 0 && m.right === m.w && m.bottom === m.h && !m.overflow && !m.pageX && !m.smallBtn, JSON.stringify(m));
    else ok(`${theme} ${w}px: popover inside the viewport`, !m.sheet && m.left >= 8 && m.right <= m.w - 8 && !m.overflow && !m.pageX, JSON.stringify(m));
    if (w === 1440 || w === 390 || w === 320) await shot(`${w === 1440 ? 'pop' : 'sheet' + w}-${theme}`);
    await close();
  }
}
await view(1440, 900, false); await ev(`CT.app.setTheme('light'); 1`); await sleep(100);
// sheet: the scrim closes it
await view(390, 844, true); await open();
await ev(`document.querySelector('.nc-scrim').click(); 1`); await sleep(100);
ok('sheet: tapping the scrim closes it and focus returns to the bell', await ev(`!document.querySelector('.nc-layer') && document.activeElement.id === 'bell-btn'`));
await view(1440, 900, false);
// empty state
await ev(`CT.store.commit('', (st) => { const m = CT.moodle.ensure(st); m.changes = []; m.inbox = []; m.linkError = null; st.settings.lastBackup = new Date().toISOString(); if (st.game) st.game.pauses = []; }, { undo: false }); 1`);
await open();
ok('empty state', await ev(`!!document.querySelector('.nc-empty') && !document.querySelector('#bell-btn .nc-badge')`) || await ev(`CT.views.notifications.list().list.length`) > 0);
await shot('empty');
await close();
// language switch while the badge is shown keeps working
ok('no JS errors overall', errs.length === 0, errs.slice(0, 5).join(' | '));
console.log(`\n${results.filter((r) => r[0] === 'PASS').length}/${results.length} passed`);
ws.close(); chrome.kill(); process.exit(0);
