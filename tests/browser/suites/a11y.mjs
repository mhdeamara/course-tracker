// Accessibility: reduced motion, 200% text, contrast, touch targets, keyboard focus (synthetic data).
// usage: node tests/browser/suites/a11y.mjs <site> <cdpPort>   (normally started by tests/browser/run.mjs)
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { CHROME, CHROME_ARGS, workDir, SEED } from '../lib/env.mjs';
import { attachSW } from '../lib/swattach.mjs';
const DIR = workDir('a11y');
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


// --- accessibility: reduced motion, 200% text, contrast, touch targets, keyboard focus (synthetic data) ---
await send('Runtime.enable'); await send('Page.enable'); await send('Emulation.setFocusEmulationEnabled', { enabled: true });
await view(1440, 900);
await send('Page.navigate', { url: SITE }); await sleep(1500);
await ev(`localStorage.clear(); 1`);
await ev(fs.readFileSync(SEED, 'utf8'));
await reload();
const cid = await ev(`CT.store.state.courses.filter(c=>c.kind!=='record')[0].id`);
const ROUTES = ['#/', '#/courses', '#/course/' + cid, '#/grades', '#/catalog', '#/semesters', '#/stats', '#/schedule', '#/review', '#/archive', '#/xp', '#/adhkar', '#/ai', '#/settings', '#/moodle'];
const setLang = async (l) => { await ev(`CT.i18n.setLang('${l}'); 1`); await sleep(200); };
const setTheme = async (t) => { await ev(`CT.app.setTheme('${t}'); 1`); await sleep(150); };

/* 1) reduced motion: nothing animates or transitions for longer than ~0 */
await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
for (const r of ['#/', '#/courses', '#/xp', '#/ai']) {
  await go(r);
  const moving = await J(`[...document.querySelectorAll('*')].filter((e) => { const s = getComputedStyle(e); const d = (v) => Math.max(...v.split(',').map((x) => parseFloat(x) * (x.includes('ms') ? 1 : 1000))); return (s.animationName !== 'none' && d(s.animationDuration) > 1) || d(s.transitionDuration) > 1; }).slice(0, 5).map((e) => e.className.toString().slice(0, 40))`);
  ok(`reduced motion ${r}: no animation/transition`, moving.length === 0, JSON.stringify(moving));
}
await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }] });

/* 2) text at 200%: no horizontal page overflow (desktop + phone, both languages) */
for (const lang of ['he', 'en']) {
  await setLang(lang);
  for (const [w, h] of [[1280, 800], [390, 844]]) {
    await view(w, h); await ev(`document.documentElement.style.fontSize = '200%'; 1`);
    const bad = [];
    for (const r of ROUTES) { await go(r); await sleep(80); const sw = await ev(`document.documentElement.scrollWidth - innerWidth`); if (sw > 1) bad.push(`${r}+${sw}`); }
    ok(`200% text ${lang} ${w}: no horizontal overflow`, bad.length === 0, bad.join(' '));
    await ev(`document.documentElement.style.fontSize = ''; 1`);
  }
}
await view(1440, 900);

/* 3) contrast: text vs. its effective background, WCAG AA (4.5:1 normal, 3:1 large/bold-large) */
const CONTRAST = `(() => {
  const rgb = (c) => { const m = c.match(/[\\d.]+/g); if (!m) return [0, 0, 0, 0]; const v = m.map(Number); if (c.startsWith('color(srgb')) { const o = v.slice(0, 3).map((x) => x * 255); if (v.length > 3) o.push(v[3]); return o; } return v; };
  const lum = ([r, g, b]) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
  const blend = (fg, bg) => { const a = fg[3] == null ? 1 : fg[3]; return [0, 1, 2].map((i) => fg[i] * a + bg[i] * (1 - a)); };
  const bgOf = (el) => { const stack = []; for (let e = el; e; e = e.parentElement) { const s = getComputedStyle(e); if (s.backgroundImage !== 'none' && !/gradient/.test(s.backgroundImage)) return null; const c = rgb(s.backgroundColor); if (c[3] !== 0 && !(c.length === 4 && c[3] === 0)) { stack.push(c); if (c.length < 4 || c[3] === 1) break; } }
    let base = [255, 255, 255]; const root = rgb(getComputedStyle(document.body).backgroundColor); base = root.slice(0, 3);
    for (let i = stack.length - 1; i >= 0; i--) base = blend(stack[i], base); return base; };
  const out = []; const w = document.createTreeWalker(document.getElementById('main'), NodeFilter.SHOW_TEXT);
  while (w.nextNode()) { const n = w.currentNode; if (!n.textContent.trim()) continue; let el = n.parentElement;
    // a closed <select> paints only its chosen option, in the select's own colours (the open list is drawn by the system)
    if (el.tagName === 'OPTION' && !el.closest('select').multiple) { if (!el.selected) continue; el = el.closest('select'); }
    if (!el.offsetParent && getComputedStyle(el).position !== 'fixed') continue;
    if (el.closest('[disabled],[aria-disabled=true],.c-art,svg')) continue;
    const s = getComputedStyle(el); if (s.visibility === 'hidden' || +s.opacity === 0) continue;
    const bg = bgOf(el); if (!bg) continue;
    let op = 1; for (let e = el; e; e = e.parentElement) op *= +getComputedStyle(e).opacity;
    const fg = blend([...rgb(s.color).slice(0, 3), (rgb(s.color)[3] ?? 1) * op], bg);
    const L1 = lum(fg), L2 = lum(bg); const ratio = (Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05);
    const px = parseFloat(s.fontSize), bold = +s.fontWeight >= 700; const need = px >= 24 || (bold && px >= 18.66) ? 3 : 4.5;
    if (ratio < need) out.push([n.textContent.trim().slice(0, 24), +ratio.toFixed(2), need, el.className.toString().slice(0, 30)]); }
  return out; })()`;
for (const theme of ['light', 'dark']) {
  await setTheme(theme);
  for (const lang of ['he', 'en']) {
    await setLang(lang);
    const bad = [];
    for (const r of ROUTES) { await go(r); await sleep(80); (await J(CONTRAST)).forEach((x) => bad.push(r + ' ' + JSON.stringify(x))); }
    ok(`contrast ${theme} ${lang}: all text meets WCAG AA`, bad.length === 0, `${bad.length}: ` + [...new Set(bad.map((x) => x.replace(/#\/course\/\w+/, '#/course/:id')))].join(' ; '));
  }
}
await setTheme('auto');

/* 4) touch targets on a phone: interactive controls at least 24x24 (WCAG 2.2 AA); inline links in running text exempt */
await view(390, 844); await setLang('he');
const TT = `[...document.querySelectorAll('#main a[href], #main button, #main input:not([type=hidden]), #main select, #main [role=button], #main summary, #app-header button, #app-header a, nav button, nav a')]
  .filter((e) => e.offsetParent && !e.closest('p, li > span, .prose') && getComputedStyle(e).visibility !== 'hidden')
  .map((e) => { const b = e.getBoundingClientRect(); const t = e.type === 'checkbox' || e.type === 'radio' ? e.closest('label') || e : e; const lb = t.getBoundingClientRect(); return [e.tagName + '.' + e.className.toString().split(' ')[0] + (e.getAttribute('aria-label') ? '[' + e.getAttribute('aria-label').slice(0, 14) + ']' : ''), Math.round(Math.max(b.width, lb.width)), Math.round(Math.max(b.height, lb.height))]; })
  .filter(([, w, h]) => w > 0 && (w < 24 || h < 24))`;
for (const lang of ['he', 'en']) {
  await setLang(lang);
  const bad = [];
  for (const r of ROUTES) { await go(r); await sleep(80); (await J(TT)).forEach((x) => bad.push(r + ' ' + x.join('/'))); }
  // under 24px is allowed by WCAG 2.5.8 when spaced (or inline / stretched): that rule is asserted in targets-focus.mjs
  console.log(`INFO touch targets ${lang} 390: controls under 24x24 (see targets-focus for 2.5.8): ` + `${bad.length}: ` + [...new Set(bad.map((x) => x.replace(/#\/course\/\w+/, '#/course/:id')))].join(' ; '));
}
await view(1440, 900);

/* 5) keyboard: skip link first, every Tab stop shows a visible focus ring, nothing focusable is hidden */
for (const r of ['#/', '#/courses', '#/grades', '#/settings', '#/xp']) {
  await go(r); await ev(`document.activeElement && document.activeElement.blur(); window.scrollTo(0, 0); 1`);
  const stops = [];
  for (let i = 0; i < 30; i++) {
    await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 });
    await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 });
    stops.push(await J(`(() => { const e = document.activeElement; if (!e || e === document.body) return null; const s = getComputedStyle(e); const b = e.getBoundingClientRect();
      const card = e.matches('.cc-link') && e.closest('.cc'); /* the course card draws the ring for its link */
      const ring = (s.outlineStyle !== 'none' && parseFloat(s.outlineWidth) > 0) || (s.boxShadow && s.boxShadow !== 'none') || (!!card && card.matches(':has(.cc-link:focus-visible)') && getComputedStyle(card).boxShadow.includes('px'));
      return { n: e.tagName + '.' + e.className.toString().split(' ')[0], ring, vis: b.width > 0 && b.height > 0, skip: e.classList.contains('skip-link') }; })()`));
  }
  const real = stops.filter(Boolean);
  if (r === '#/') ok('keyboard: first Tab stop is the skip link', real[0] && real[0].skip, JSON.stringify(real[0]));
  const noRing = real.filter((s) => !s.ring || !s.vis);
  ok(`keyboard ${r}: every Tab stop has a visible focus ring`, noRing.length === 0, JSON.stringify(noRing.slice(0, 5)));
}
ok('no runtime errors', errs.length === 0, errs.join(' | '));
const fails = results.filter((r) => r[0] === 'FAIL').length;
console.log(`\n${results.length - fails}/${results.length} passed`);
ws.close(); chrome.kill(); process.exit(fails ? 1 : 0);
