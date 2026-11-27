// Target size (WCAG 2.5.8) and focus not obscured (2.4.11) on phone and desktop, both languages and themes. env: ONLYFOCUS.
// usage: node tests/browser/suites/targets-focus.mjs <site> <cdpPort>   (normally started by tests/browser/run.mjs)
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { CHROME, CHROME_ARGS, workDir, SEED } from '../lib/env.mjs';
import { attachSW } from '../lib/swattach.mjs';
const DIR = workDir('targets-focus');
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


// --- usability audit: WCAG 2.5.8 spacing exception for small targets; overlays obstructing controls/focus ---
await send('Runtime.enable'); await send('Page.enable'); await send('Emulation.setFocusEmulationEnabled', { enabled: true });
await view(1440, 900);
await send('Page.navigate', { url: SITE }); await sleep(1500);
await ev(`localStorage.clear(); 1`);
await ev(fs.readFileSync(SEED, 'utf8'));
await reload();
const cid = await ev(`CT.store.state.courses.filter(c=>c.kind!=='record')[0].id`);
const ROUTES = ['#/', '#/courses', '#/course/' + cid, '#/grades', '#/catalog', '#/semesters', '#/stats', '#/schedule', '#/review', '#/archive', '#/xp', '#/adhkar', '#/ai', '#/settings', '#/moodle'];
const SEL = `#main a[href], #main button, #main input:not([type=hidden]), #main select, #main [role=button], #main summary, #main textarea`;
/* 2.5.8: an undersized target passes if a 24px circle centred on it does not intersect another target or the circle of another undersized target */
const SPACING = `(() => { const els = [...document.querySelectorAll('${SEL}')].filter((e) => e.offsetParent && getComputedStyle(e).visibility !== 'hidden');
  const box = (e) => { const r = e.getBoundingClientRect(); const l = e.closest('label'); if (l && (e.type === 'checkbox' || e.type === 'radio')) { const q = l.getBoundingClientRect(); return q; } return r; };
  const items = els.map((e) => ({ e, r: box(e) })).filter((x) => x.r.width > 0 && x.r.height > 0);
  const small = items.filter((x) => x.r.width < 24 || x.r.height < 24);
  const circ = (r) => ({ x: r.left + r.width / 2, y: r.top + r.height / 2, R: 12 });
  const hitsRect = (c, r) => { const dx = Math.max(r.left - c.x, 0, c.x - r.right), dy = Math.max(r.top - c.y, 0, c.y - r.bottom); return dx * dx + dy * dy < c.R * c.R; };
  const out = [];
  small.forEach((s) => { const c = circ(s.r);
    // inline exception: a link inside a sentence/paragraph of text
    const inline = s.e.tagName === 'A' && getComputedStyle(s.e).display === 'inline' && /\\S/.test((s.e.parentElement.textContent || '').replace(s.e.textContent, ''));
    // the course card link is stretched over the whole card (::after), so its real target is the card
    const stretched = s.e.matches('.cc-link');
    const clash = items.find((o) => o !== s && !o.e.contains(s.e) && !s.e.contains(o.e) && (hitsRect(c, o.r) || (small.includes(o) && Math.hypot(circ(o.r).x - c.x, circ(o.r).y - c.y) < 24)));
    out.push({ t: s.e.tagName + '.' + (s.e.className.toString().split(' ')[0] || '') + (s.e.type ? '[' + s.e.type + ']' : ''), w: Math.round(s.r.width), h: Math.round(s.r.height), pass: inline ? 'inline' : stretched ? 'stretched' : clash ? 'FAIL' : 'spacing', near: clash ? clash.e.tagName + '.' + clash.e.className.toString().split(' ')[0] : '' }); });
  return out; })()`;
/* overlays: is any essential control hidden under the adhkar card / AI button / bottom bar when scrolled to the end? */
const OBSTRUCT = `(() => { window.scrollTo(0, document.documentElement.scrollHeight); return new Promise((res) => setTimeout(() => {
  const ov = [...document.querySelectorAll('.adk-toast, #adk-toasts > *, .ai-fab, .fab, .bottom-nav, nav.bottom, .toast')].filter((o) => o.offsetParent || getComputedStyle(o).position === 'fixed');
  const hidden = [];
  [...document.querySelectorAll('${SEL}')].filter((e) => e.offsetParent).forEach((e) => { const r = e.getBoundingClientRect(); if (r.bottom < 0 || r.top > innerHeight || !r.width) return;
    const pts = [[r.left + r.width / 2, r.top + r.height / 2]]; const top = document.elementFromPoint(pts[0][0], pts[0][1]);
    if (top && !e.contains(top) && !top.contains(e) && ov.some((o) => o.contains(top))) hidden.push(e.tagName + '.' + e.className.toString().split(' ')[0] + ':' + (e.getAttribute('aria-label') || e.textContent).trim().slice(0, 18)); });
  // can the last control of the page be scrolled clear of the overlays?
  const all = [...document.querySelectorAll('${SEL}')].filter((e) => e.offsetParent); const last = all[all.length - 1];
  let lastHidden = false; if (last) { const r = last.getBoundingClientRect(); const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); lastHidden = !!top && !last.contains(top) && ov.some((o) => o.contains(top)); }
  res({ hidden, lastHidden, overlays: ov.map((o) => o.className.toString().split(' ')[0] || o.tagName).join(',') }); }, 250)); })()`;
for (const lang of (process.env.ONLYFOCUS ? [] : ['he', 'en'])) {
  await ev(`CT.i18n.setLang('${lang}'); 1`); await reload(); await sleep(800);
  for (const [w, h] of [[390, 844], [1440, 900]]) {
    await view(w, h);
    const fails = [], counts = {}; const obstruct = [];
    for (const r of ROUTES) {
      await go(r); await sleep(150); await ev(`window.scrollTo(0, 0); 1`);
      (await J(SPACING)).forEach((x) => { counts[x.pass] = (counts[x.pass] || 0) + 1; if (x.pass === 'FAIL') fails.push(r.replace(cid, ':id') + ' ' + x.t + ' ' + x.w + 'x' + x.h + ' near ' + x.near); });
      const o = await J(OBSTRUCT); if (o.lastHidden) obstruct.push(r.replace(cid, ':id') + ' LAST:' + o.hidden.join('|'));
    }
    ok(`targets ${lang} ${w}: every target is 24px or passes a 2.5.8 exception ` + JSON.stringify(counts), !fails.length, [...new Set(fails)].join(' ; '));
    ok(`targets ${lang} ${w}: the last control of every page can be scrolled clear of the overlays`, !obstruct.length, obstruct.join(' ; '));
  }
}
/* focus not obscured (WCAG 2.4.11): Tab through pages with an adhkar reminder card open, on a phone (bottom bar) and
 * a desktop, both languages and both themes. A stop counts as hidden when no corner and not its centre is visible:
 * every point is under the sticky header, the bottom bar, the reminder cards or the AI button. Also checked: the
 * focused element (or the card it stretches over) shows a focus indicator, and the reminder card keeps working. */
const REMIND = `(() => { const A = CT.adhkar; document.querySelectorAll('#adk-toasts .adk-toast').forEach((t) => t.remove()); // one fresh card, as in real use
  CT.store.commit('test: reminders due', (s) => { A.set(s, 'general.quietFrom', '00:00'); A.set(s, 'general.quietTo', '00:00'); A.set(s, 'general.every', 1); });
  const m = JSON.parse(localStorage.getItem('ct.adhkar') || '{}'); m.lastGen = 1; m.muted = ''; localStorage.setItem('ct.adhkar', JSON.stringify(m)); CT.views.adhkar.check(); return 1; })()`;
const COVER = `(() => { const e = document.activeElement; if (!e || e === document.body) return null;
  const ov = [...document.querySelectorAll('.app-header, .adk-toast, .bottom-nav, .ai-fab')].filter((o) => o.getClientRects().length);
  if (ov.some((o) => o.contains(e))) return { skip: true };
  const b = e.getBoundingClientRect(); if (!b.width && !b.height) return { skip: true };
  const pts = [[b.left + 2, b.top + 2], [b.right - 2, b.top + 2], [b.left + 2, b.bottom - 2], [b.right - 2, b.bottom - 2], [(b.left + b.right) / 2, (b.top + b.bottom) / 2]];
  const seen = pts.filter(([x, y]) => { if (x < 0 || y < 0 || x >= innerWidth || y >= innerHeight) return false; const t = document.elementFromPoint(x, y); return !!t && !ov.some((o) => o.contains(t) && !o.contains(e)); }).length;
  const by = (() => { const t = document.elementFromPoint((b.left + b.right) / 2, Math.min(innerHeight - 1, Math.max(0, (b.top + b.bottom) / 2))); const o = t && ov.find((x) => x.contains(t)); return o ? o.className.toString().split(' ')[0] : ''; })();
  const ring = (x) => { const c = getComputedStyle(x); return (c.outlineStyle !== 'none' && parseFloat(c.outlineWidth) > 0) || (c.boxShadow && c.boxShadow !== 'none'); };
  const card = e.closest('.course-card, .cc, [class*=card]');
  return { n: e.tagName + '.' + e.className.toString().split(' ')[0] + (by ? '@' + by : '') + ' y=' + Math.round(b.top), seen, ring: ring(e) || (!!card && ring(card)) }; })()`;
const FOCUS_ROUTES = ['#/course/' + cid, '#/courses', '#/settings', '#/grades', '#/'];
for (const [w, h] of [[390, 844], [1440, 900]]) {
  await view(w, h);
  const hd = await J(`(() => { const h = document.querySelector('.app-header'); return { h: Math.ceil(h.getBoundingClientRect().height), pad: (() => { const x = document.querySelector('#main a, #main button'); return x ? parseFloat(getComputedStyle(x).scrollMarginBlockStart) || 0 : 0; })() }; })()`);
  ok(`focus ${w}: scroll margin clears the sticky header (${hd.h}px <= ${hd.pad}px)`, hd.h <= hd.pad, JSON.stringify(hd));
  ok(`focus ${w}: focusing a header control does not move the page`, await ev(`(() => { document.body.style.minHeight = '3000px'; window.scrollTo(0, 400); const b = document.getElementById('more-btn'); b.focus(); const y = scrollY; b.blur(); document.body.style.minHeight = ''; return y === 400; })()`));
  for (const lang of ['he', 'en']) for (const theme of ['light', 'dark']) {
    await ev(`CT.i18n.setLang('${lang}'); CT.app.setTheme('${theme}'); 1`); await reload(); await sleep(400);
    let stops = 0, hidden = 0, noRing = 0, cards = 0; const which = [], plain = [];
    for (const r of FOCUS_ROUTES) {
      await go(r); await ev(`window.scrollTo(0, 0); document.activeElement && document.activeElement.blur(); 1`);
      await ev(REMIND); await sleep(500);
      if (await ev(`!!document.querySelector('#adk-toasts:not([hidden]) .adk-toast')`)) cards++;
      for (let i = 0; i < 40; i++) {
        await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 }); await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 });
        await sleep(30);
        const c = await J(COVER); if (!c || c.skip) continue;
        stops++; if (!c.seen) { hidden++; which.push(r.replace(cid, ':id') + ' ' + c.n); } if (!c.ring) { noRing++; plain.push(r.replace(cid, ':id') + ' ' + c.n); }
      }
    }
    const tag = `${w} ${lang} ${theme}`;
    ok(`focus ${tag}: reminder card shown on every page`, cards === FOCUS_ROUTES.length, cards + '/' + FOCUS_ROUTES.length);
    ok(`focus ${tag}: no keyboard focus stop hidden behind the header, bottom bar or reminder (${stops} stops)`, hidden === 0, hidden + ' hidden: ' + which.slice(0, 6).join(', '));
    ok(`focus ${tag}: every focus stop shows a focus indicator`, noRing === 0, noRing + ': ' + [...new Set(plain)].slice(0, 6).join(', '));
  }
}
/* the reminder still behaves as before: it can be focused and closed with the keyboard, and it hides while typing */
await view(390, 844); await ev(`CT.i18n.setLang('he'); 1`); await reload(); await go('#/courses'); await ev(REMIND); await sleep(500);
ok('reminder: close button reachable and works', await ev(`(() => { const x = document.querySelector('.adk-toast .adk-toast-x'); if (!x) return false; x.focus(); const f = document.activeElement === x; x.click(); return f; })()`));
await sleep(500);
ok('reminder: closing it releases the reserved space', await ev(`getComputedStyle(document.documentElement).getPropertyValue('--ct-adk-h').trim() === '0px' || !document.querySelector('#adk-toasts .adk-toast')`));
await ev(REMIND); await sleep(500);
await go('#/settings'); await ev(REMIND); await sleep(500);
const typed = await ev(`(() => { const i = document.querySelector('#main input[type=search], #main input[type=text], #main input:not([type]), #main textarea'); if (!i) return ''; i.focus(); CT.views.adhkar.check(); return i.outerHTML.slice(0, 60); })()`); await sleep(200);
ok('reminder: hidden (not dismissed) while typing in a field', !!typed && await ev(`(() => { const b = document.getElementById('adk-toasts'); return !!b && b.hidden && !!b.querySelector('.adk-toast'); })()`), typed || 'no text field on the settings page');
ok('no runtime errors', errs.length === 0, errs.slice(0, 3).join(' | '));
const fails = results.filter((r) => r[0] === 'FAIL').length;
console.log(`\n${results.length - fails}/${results.length} passed`);
ws.close(); chrome.kill(); process.exit(fails ? 1 : 0);
