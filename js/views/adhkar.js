/* views/adhkar.js — أذكار: the reading screen (tap counter with a ring, auto-advance), the home card, the
 * "אזכרות" page, gentle in-site reminders and the settings section. Logic and storage are in js/adhkar.js;
 * the texts are loaded from data/adhkar.json. Reminders never interrupt focus: they wait while the focus screen,
 * the timer or pause mode is on, and while the reading screen itself is open. */
(function (CT) {
  'use strict';
  const { u, ui, store: S } = CT;
  const A = CT.adhkar;
  const esc = u.esc, icon = u.icon;
  const L = (k, p) => CT.i18n.t(k, p), LX = (k, p) => CT.i18n.tx(k, p);
  const V = {};
  CT.views.adhkar = V;

  const MEM_KEY = 'ct.adhkar'; // per device: { seen: {m, e}, lastGen, lastGenId, muted, notify }
  const NAMES = { m: 'أذكار الصباح', e: 'أذكار المساء', g: 'أذكار عامة' };
  const st = () => S.state;
  const cfg = () => A.cfg(st());
  const ptsAdk = () => { try { return CT.game.cfg(st()).pts.adk; } catch (e) { return 5; } };
  const motionOk = () => !(CT.app && CT.app.reducedMotion && CT.app.reducedMotion());
  const tm = (min) => `<span class="num-ltr">${A.fmt(min)}</span>`;
  // a time range; built from formatted numbers only (trusted markup for th())
  const rng = (a, b) => CT.i18n.html(`<span class="num-ltr">${u.esc(A.fmt(a))}–${u.esc(A.fmt(b))}</span>`);
  const arDigits = (n) => String(n).replace(/\d/g, (d) => '٠١٢٣٤٥٦٧٨٩'[d]);

  /* ---------- content ---------- */
  let doc = null, loading = null, loadErr = false;
  V.load = () => {
    if (doc) return Promise.resolve(doc);
    if (!loading) {
      loading = fetch('data/adhkar.json').then((r) => { if (!r.ok) throw new Error(r.status); return r.json(); })
        .then((d) => { doc = d; loadErr = false; return d; })
        .catch((e) => { loading = null; loadErr = true; throw e; });
    }
    return loading;
  };
  V.doc = () => doc;
  const whenLoaded = (fn) => { if (doc) fn(); else V.load().then(fn).catch(() => ui.toast(LX('adkp.loadErr'), { error: true })); };

  /* ---------- per-device memory ---------- */
  const mem = () => { try { return Object.assign({ seen: {} }, JSON.parse(localStorage.getItem(MEM_KEY)) || {}); } catch (e) { return { seen: {} }; } };
  const saveMem = (m) => { try { localStorage.setItem(MEM_KEY, JSON.stringify(m)); } catch (e) { /* ignore */ } };
  const updMem = (fn) => { const m = mem(); fn(m); saveMem(m); return m; };

  /* ---------- small effects (all optional) ---------- */
  const buzz = (p) => { try { if (cfg().vibrate && navigator.vibrate) navigator.vibrate(p); } catch (e) { /* ignore */ } };
  let actx = null;
  const chime = () => {
    if (!cfg().sound) return;
    try {
      actx = actx || new (window.AudioContext || window.webkitAudioContext)();
      const o = actx.createOscillator(), g = actx.createGain();
      o.type = 'sine'; o.frequency.value = 660;
      g.gain.setValueAtTime(0.0001, actx.currentTime);
      g.gain.exponentialRampToValueAtTime(0.08, actx.currentTime + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, actx.currentTime + 0.6);
      o.connect(g).connect(actx.destination); o.start(); o.stop(actx.currentTime + 0.65);
    } catch (e) { /* ignore */ }
  };

  /* ---------- the reading screen ---------- */
  let R = null; // { p, i, el, prevFocus, advanceT }
  V.isOpen = () => !!R;

  const textHTML = (it) => {
    const parts = [];
    if (it.pre) parts.push(`<p class="adk-pre">${esc(it.pre)}</p>`);
    if (it.quran) {
      it.quran.forEach((q) => {
        if (it.quran.length > 1) parts.push(`<p class="adk-sura">سورة ${esc(q.name)}</p>`);
        parts.push(`<p class="adk-q">${q.verses.map((v, k) => `${esc(v)} <span class="adk-ayah">﴿${arDigits(q.from + k)}﴾</span>`).join(' ')}</p>`);
      });
    }
    if (it.text) parts.push(`<p>${esc(it.text)}</p>`);
    return parts.join('');
  };
  const sourceHTML = (it) => {
    const tz = doc.sources.tanzil;
    return `<div class="adk-src">
        <p><span class="adk-src-k">${L('adkp.source')}</span> <span lang="ar" dir="rtl">${esc(it.source)}</span></p>
        <p><span class="adk-src-k">${L('adkp.grade')}</span> <span lang="ar" dir="rtl">${esc(it.grade)}</span></p>
        ${it.hisn ? `<p><a href="${esc(u.safeUrl(it.url))}" target="_blank" rel="noopener"><span lang="ar" dir="rtl">حصن المسلم</span> <span class="num-ltr">${esc(it.hisn)}</span></a></p>` : ''}
        ${it.quran ? `<p>${L('adkp.quranText')} <a href="${esc(u.safeUrl(tz.url))}" target="_blank" rel="noopener">Tanzil Project</a> · ${esc(tz.license)}</p>` : ''}
        ${it.note ? `<p class="adk-note" lang="he" dir="rtl">${esc(it.note)}</p>` : ''}
      </div>`;
  };
  const ring = (n, total) => {
    const r = 52, c = 2 * Math.PI * r, frac = total ? Math.min(1, n / total) : 0;
    return `<svg class="adk-ring" viewBox="0 0 120 120" aria-hidden="true"><circle class="bg" cx="60" cy="60" r="${r}"/>
      <circle class="fg" cx="60" cy="60" r="${r}" stroke-dasharray="${c.toFixed(1)}" stroke-dashoffset="${(c * (1 - frac)).toFixed(1)}"/></svg>`;
  };

  const paint = () => {
    if (!R) return;
    const items = A.group(doc, R.p);
    const prog = A.progress(st(), doc, R.p);
    const el = R.el;
    const font = Math.max(0.8, Math.min(2, Number(cfg().font) || 1));
    el.style.setProperty('--adk-scale', font);
    if (R.i >= items.length) { // finished
      const streak = R.p === 'g' ? 0 : A.streak(st(), R.p);
      el.querySelector('.adk-main').innerHTML = `<div class="adk-done">
          <div class="adk-done-ic" aria-hidden="true">${icon.check}</div>
          <h3><span lang="ar" dir="rtl">${NAMES[R.p]}</span> — ${L(R.p === 'g' ? 'adkp.listDone' : 'adkd.done')}</h3>
          ${streak > 1 ? `<p class="muted">${L('adkd.streak', { n: streak })}</p>` : ''}
          <button class="btn btn-primary" data-adk="close">${L('adks.close')}</button>
        </div>`;
      el.querySelector('.adk-foot').hidden = true;
      el.querySelector('.adk-pos').textContent = `${prog.full} / ${prog.total}`;
      el.querySelector('[data-adk=close]').focus();
      return;
    }
    el.querySelector('.adk-foot').hidden = false;
    const it = items[R.i];
    const n = Math.min(it.count, prog.counts[it.id] || 0);
    el.querySelector('.adk-pos').textContent = `${R.i + 1} / ${items.length}`;
    el.querySelector('.adk-bar i').style.width = `${Math.round((prog.full / Math.max(1, items.length)) * 100)}%`;
    el.querySelector('.adk-main').innerHTML = `<article class="adk-card${n >= it.count ? ' full' : ''}">
        <div class="adk-text" lang="ar" dir="rtl">${textHTML(it)}</div>
        ${sourceHTML(it)}
      </article>`;
    const btn = el.querySelector('.adk-count');
    btn.innerHTML = `${ring(n, it.count)}<span class="adk-n"><b>${n}</b><small>/ ${it.count}</small></span>`;
    btn.classList.toggle('full', n >= it.count);
    btn.setAttribute('aria-label', LX('adkp.countLabel', { n, m: it.count }));
    el.querySelector('[data-adk=prev]').disabled = R.i === 0;
    el.querySelector('.adk-main').scrollTop = 0;
  };

  const go = (i) => { if (!R) return; clearTimeout(R.advanceT); R.i = Math.max(0, i); paint(); };
  const tap = () => {
    if (!R) return;
    const items = A.group(doc, R.p), it = items[R.i];
    if (!it) return;
    const before = (A.progress(st(), doc, R.p).counts[it.id] || 0);
    if (before >= it.count) { go(R.i + 1); return; } // already full: a tap moves on
    // the tap that finishes the morning/evening is an undo step (Ctrl+Z takes the completion — and its points — back)
    const fin = A.wouldFinish(st(), doc, R.p, it.id);
    const res = S.commit(LX(fin ? (R.p === 'm' ? 'adkp.u.doneM' : 'adkp.u.doneE') : 'adkp.u.tap'), (s) => A.tap(s, doc, R.p, it.id), { undo: fin, silent: true });
    if (!res) return;
    buzz(res.full ? [18, 40, 18] : 10);
    paint();
    if (res.groupDone) chime();
    if (res.full) {
      clearTimeout(R.advanceT);
      // the next unfinished one; at the end → the "done" view
      const prog = A.progress(st(), doc, R.p);
      let next = items.findIndex((x, k) => k > R.i && (prog.counts[x.id] || 0) < x.count);
      if (next < 0) next = items.findIndex((x) => (prog.counts[x.id] || 0) < x.count);
      if (next < 0) next = items.length;
      R.advanceT = setTimeout(() => go(next), motionOk() ? 550 : 250);
    }
  };

  V.open = (p = 'm', startId) => whenLoaded(() => {
    if (R) V.close();
    const items = A.group(doc, p);
    const prog = A.progress(st(), doc, p);
    let i = startId ? items.findIndex((x) => x.id === startId) : items.findIndex((x) => (prog.counts[x.id] || 0) < x.count);
    if (i < 0) i = startId ? 0 : (prog.done || p === 'g' ? 0 : items.length);
    const el = document.createElement('div');
    el.className = 'adk' + (motionOk() ? '' : ' still');
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-modal', 'true');
    el.setAttribute('aria-labelledby', 'adk-title');
    CT.i18n.localized(el); // the frame follows the interface language; the adhkar keep lang=ar dir=rtl
    el.innerHTML = `
      <header class="adk-head">
        <button class="icon-btn" data-adk="close" aria-label="${L('adks.close')}">${icon.close}</button>
        <div class="adk-titles"><h2 id="adk-title" lang="ar" dir="rtl">${NAMES[p]}</h2><span class="adk-pos muted small"></span></div>
        <div class="adk-font" role="group" aria-label="${L('adkp.textSize')}">
          <button class="icon-btn" data-adk="smaller" aria-label="${L('adkp.smaller')}"><span lang="ar" aria-hidden="true">ع−</span></button>
          <button class="icon-btn" data-adk="bigger" aria-label="${L('adkp.bigger')}"><span lang="ar" aria-hidden="true">ع+</span></button>
        </div>
      </header>
      <div class="adk-bar" aria-hidden="true"><i></i></div>
      <div class="adk-main"></div>
      <footer class="adk-foot">
        <button class="btn adk-nav" data-adk="prev"><span class="ic-back" aria-hidden="true">${icon.chevSide}</span> ${L('adkp.prev')}</button>
        <button class="adk-count" data-adk="tap"></button>
        <button class="btn adk-nav" data-adk="next">${L('adkp.next')} <span class="ic-fwd" aria-hidden="true">${icon.chevSide}</span></button>
      </footer>`;
    document.body.appendChild(el);
    document.body.classList.add('adk-open');
    R = { p, i, el, prevFocus: document.activeElement };
    el.addEventListener('click', (e) => {
      const b = e.target.closest('[data-adk]');
      if (!b) return;
      const a = b.dataset.adk;
      if (a === 'close') V.close();
      else if (a === 'tap') tap();
      else if (a === 'prev') go(R.i - 1);
      else if (a === 'next') go(Math.min(A.group(doc, R.p).length, R.i + 1));
      else if (a === 'smaller' || a === 'bigger') {
        const f = Math.round(Math.max(0.8, Math.min(2, (Number(cfg().font) || 1) + (a === 'bigger' ? 0.1 : -0.1))) * 10) / 10;
        S.commit(LX('adkp.u.font'), (s) => A.set(s, 'font', f), { undo: false, silent: true });
        paint();
      }
    });
    el.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { e.preventDefault(); V.close(); return; }
      const onBtn = e.target.closest && e.target.closest('button, a, input, select');
      if ((e.key === ' ' || e.key === 'Enter') && !onBtn) { e.preventDefault(); tap(); return; }
      if (e.key === 'ArrowLeft' && !onBtn) { e.preventDefault(); go(Math.min(A.group(doc, R.p).length, R.i + 1)); return; } // RTL: left = forward
      if (e.key === 'ArrowRight' && !onBtn) { e.preventDefault(); go(R.i - 1); return; }
      if (e.key === 'Tab') { // keep focus inside
        const f = [...el.querySelectorAll('button:not([disabled]):not([hidden]), a[href]')].filter((x) => x.offsetParent !== null);
        if (!f.length) return;
        if (e.shiftKey && document.activeElement === f[0]) { e.preventDefault(); f[f.length - 1].focus(); }
        else if (!e.shiftKey && document.activeElement === f[f.length - 1]) { e.preventDefault(); f[0].focus(); }
      }
    });
    paint();
    const t = el.querySelector('.adk-count');
    if (t && !el.querySelector('.adk-foot').hidden) t.focus();
  });

  V.close = () => {
    if (!R) return;
    clearTimeout(R.advanceT);
    const pf = R.prevFocus;
    R.el.remove();
    R = null;
    document.body.classList.remove('adk-open');
    S.emit(); // the taps were saved quietly; refresh the page behind
    if (pf && pf.focus && document.contains(pf)) pf.focus();
    setTimeout(check, 400); // anything that waited while reading
  };

  /* ---------- home card (dashboard top slot) ---------- */
  /** Compact, translated row for the daily-progress card on "היום". The adhkar names stay in Arabic. */
  V.homeHTML = () => {
    if (!A.on(st())) return '';
    const p = A.period(cfg());
    if (!p) return '';
    if (!doc) { if (!loadErr) V.load().then(() => CT.app && CT.app.rerender()).catch(() => {}); return ''; }
    const I = CT.i18n;
    const prog = A.progress(st(), doc, p);
    const win = A.windows(cfg());
    if (prog.done) {
      return `<div class="adk-row is-done" role="status"><span class="adk-row-t"><b lang="ar" dir="rtl">${NAMES[p]}</b><span class="muted small">${I.t('adkd.done')}</span></span>
        <button class="btn btn-ghost btn-small" data-adk-home="open" data-p="${p}">${I.t('adkd.reopen')}</button></div>`;
    }
    const streak = A.streak(st(), p);
    const sub = [prog.full ? I.t('adkd.progress', { n: prog.full, m: prog.total }) : I.t('adkd.count', { n: prog.total }),
      I.t('adkd.until', { time: A.fmt(win[p][1]) }), streak > 1 ? I.t('adkd.streak', { n: streak }) : ''].filter(Boolean).join(' · ');
    return `<div class="adk-row" role="group" aria-label="${I.t('adkd.label.' + p)}">
        <span class="adk-row-t"><b lang="ar" dir="rtl">${NAMES[p]}</b><span class="muted small">${sub}</span></span>
        <span class="adk-row-a">
          <button class="btn btn-small btn-primary" data-adk-home="open" data-p="${p}">${prog.full ? I.t('adkd.continue') : I.t('adkd.start')}</button>
          <button class="btn btn-small btn-ghost" data-adk-home="mark" data-p="${p}" title="${I.t('adkd.markTitle')}">${I.t('adkd.mark')}</button>
        </span>
      </div>`;
  };
  document.addEventListener('click', (e) => {
    const b = e.target.closest && e.target.closest('[data-adk-home]');
    if (!b) return;
    const p = b.dataset.p;
    if (b.dataset.adkHome === 'open') V.open(p);
    else if (b.dataset.adkHome === 'mark') S.commit(LX('adkp.u.mark'), (s) => A.markDone(s, p));
  });

  /* ---------- the "אזכרות" page ---------- */
  V.render = (main) => {
    if (!A.on(st())) {
      main.innerHTML = `<div class="adk-page-head"><h1>${L('adks.title')}</h1></div>
        <section class="card">${ui.empty(`${L('adkp.off')} <a href="#/settings/adhkar">${L('adkp.toSettings')}</a>`)}</section>`;
      return;
    }
    if (!doc) {
      main.innerHTML = `<div class="adk-page-head"><h1>${L('adks.title')}</h1></div><section class="card"><p class="muted" role="status">${L(loadErr ? 'adkp.loadErr' : 'adkp.loading')}</p></section>`;
      if (!loadErr) V.load().then(() => CT.app.rerender()).catch(() => CT.app.rerender());
      return;
    }
    const c = cfg(), w = A.windows(c), now = A.period(c);
    const row = (p) => {
      const prog = A.progress(st(), doc, p);
      const streak = p === 'g' ? 0 : A.streak(st(), p);
      const when = p === 'g' ? L('adkp.allDay') : String(rng(w[p][0], w[p][1]));
      return `<li class="adk-row${now === p ? ' now' : ''}">
          <div><b lang="ar" dir="rtl">${NAMES[p]}</b> <span class="muted small adk-sub">${L(p === 'g' ? 'adkp.general' : 'adkd.label.' + p)} · ${when}</span>
            <p class="small muted">${prog.done ? L('adkp.doneToday') : L('adkd.progress', { n: prog.full, m: prog.total })}${streak > 1 ? ` · ${L('adkd.streak', { n: streak })}` : ''}</p></div>
          <button class="btn${now === p && !prog.done ? ' btn-primary' : ''}" data-adk-home="open" data-p="${p}">${L(prog.done ? 'adkp.open' : prog.full ? 'adkd.continue' : 'adkd.start')}</button>
        </li>`;
    };
    const t = w.times;
    main.innerHTML = `<div class="adk-page-head"><h1>${L('adks.title')}</h1><a class="btn" href="#/settings/adhkar">${icon.gear} ${L('adkp.settings')}</a></div>
      <section class="card"><ul class="adk-rows">${row('m')}${row('e')}${row('g')}</ul>
        ${w.auto && t ? `<p class="small muted adk-times">${L('adkp.times', { city: c.city === 'custom' ? LX('adkp.customLoc') : LX('adks.city.' + (A.CITIES[c.city] ? c.city : 'haifa')) })} ${L('adkp.fajr')} ${tm(t.fajr)} · ${L('adkp.sunrise')} ${tm(t.sunrise)} · ${L('adkp.dhuhr')} ${tm(t.dhuhr)} · ${L('adks.asr')} ${tm(t.asr)} · ${L('adkp.maghrib')} ${tm(t.maghrib)} · ${L('adkp.isha')} ${tm(t.isha)}</p>` : ''}
      </section>
      <section class="card small muted adk-about">
        <p lang="he" dir="rtl">${esc(doc.rules)}</p>
        <p>${L('adkp.sources')} <a href="${esc(doc.sources.hisn.url)}" target="_blank" rel="noopener" lang="ar">${esc(doc.sources.hisn.name)}</a> ·
          <a href="${esc(doc.sources.sunnah.url)}" target="_blank" rel="noopener">sunnah.com</a> ·
          <a href="${esc(doc.sources.dorar.url)}" target="_blank" rel="noopener" lang="ar">${esc(doc.sources.dorar.name)}</a> ·
          ${L('adkp.quranText')} <a href="${esc(doc.sources.tanzil.url)}" target="_blank" rel="noopener">Tanzil Project</a> (${esc(doc.sources.tanzil.license)})</p>
      </section>`;
  };

  /* ---------- gentle reminders ---------- */
  const busy = () => !!(R
    || (CT.focus && CT.focus.active && CT.focus.active())
    || (CT.timer && CT.timer.busy && CT.timer.busy())
    || (CT.game && st().game && CT.game.activePause(st().game))
    || document.querySelector('.modal-backdrop')
    || V.covering());
  /**
   * Places a reminder card must not cover: a field you are typing in, the AI conversation (its page or the quick panel)
   * and an open menu. The cards wait there (hidden, not dismissed — nothing is marked seen, the schedule, quiet hours
   * and points are unchanged) and come back as soon as you leave.
   */
  V.covering = () => {
    const a = document.activeElement;
    if (a && a.closest && !a.closest('#adk-toasts')
      && (a.isContentEditable || a.matches('textarea, select, input:not([type=checkbox]):not([type=radio]):not([type=range]):not([type=button]):not([type=submit])'))) return true;
    if (document.querySelector('.chat-panel, .menu[role=menu], .nc-layer')) return true;
    return /^#\/ai(\/|\?|$)/.test(location.hash);
  };
  const toastBox = () => {
    let box = document.getElementById('adk-toasts');
    if (!box) { box = document.createElement('div'); box.id = 'adk-toasts'; box.setAttribute('aria-live', 'polite'); CT.i18n.localized(box); document.body.appendChild(box); }
    return box;
  };
  /**
   * A small card in the corner: never blocks the page. By default it hides by itself (pauses while hovered/focused);
   * `sticky` cards stay until a button or × is pressed (onX runs for ×).
   */
  const note = ({ title, body, actions = [], ms = 15000, sticky = false, onX }) => {
    const t = document.createElement('div');
    t.className = 'adk-toast' + (motionOk() ? '' : ' still');
    t.setAttribute('role', 'status');
    t.setAttribute('lang', CT.i18n.lang());
    t.setAttribute('dir', CT.i18n.dir());
    t.innerHTML = `<button class="icon-btn adk-toast-x" aria-label="${CT.i18n.t('adks.close')}">${icon.close}</button>
      <p class="adk-toast-t">${title}</p>${body ? `<div class="adk-toast-b">${body}</div>` : ''}
      <div class="adk-toast-a">${actions.map((a, k) => `<button class="btn${k === 0 ? ' btn-primary' : ''} btn-small" data-k="${k}">${esc(a.label)}</button>`).join('')}</div>`;
    let timer = null;
    const close = () => { clearTimeout(timer); t.classList.add('out'); setTimeout(() => t.remove(), motionOk() ? 300 : 0); };
    const arm = () => { clearTimeout(timer); timer = setTimeout(close, ms); };
    t.querySelector('.adk-toast-x').onclick = () => { close(); if (onX) onX(); };
    t.querySelectorAll('[data-k]').forEach((b) => { b.onclick = () => { close(); actions[Number(b.dataset.k)].fn(); }; });
    if (!sticky) {
      t.addEventListener('mouseenter', () => clearTimeout(timer));
      t.addEventListener('mouseleave', arm);
      t.addEventListener('focusin', () => clearTimeout(timer));
      t.addEventListener('focusout', arm);
    }
    toastBox().appendChild(t);
    if (!sticky) arm();
    if (cfg().sound) chime();
    return t;
  };
  const sysNotify = (title, body) => {
    try {
      if (!mem().notify || !('Notification' in window) || Notification.permission !== 'granted') return false;
      const n = new Notification(title, { body, lang: 'ar', dir: 'rtl', tag: 'ct-adhkar', silent: !cfg().sound });
      n.onclick = () => { window.focus(); n.close(); };
      return true;
    } catch (e) { return false; }
  };

  /*
   * The "start now?" card stays until a button or × is pressed; only then is the window marked as seen (on this device),
   * so a refresh shows it again. It is hidden (not dismissed) while busy, and removed when the window ends or it's done.
   */
  let perCard = null; // { p, day, el }
  const markSeen = (p, day) => updMem((m) => { m.seen = m.seen || {}; m.seen[p] = day; });
  const showPeriod = (p) => {
    const day = A.dayKey();
    if (document.hidden) { markSeen(p, day); sysNotify(NAMES[p], CT.i18n.tx('adks.whenReady', { name: CT.i18n.tx('adkd.label.' + p) })); return; }
    if (perCard && document.contains(perCard.el)) return;
    const seen = () => { markSeen(p, day); perCard = null; };
    const el = note({
      title: `<span lang="ar" dir="rtl">${NAMES[p]}</span>`,
      body: `<p class="small muted">${CT.i18n.t('adks.startQ', { name: CT.i18n.tx('adkd.label.' + p) })}</p>`,
      actions: [{ label: CT.i18n.tx('adks.start'), fn: () => { seen(); V.open(p); } }, { label: CT.i18n.tx('adks.later'), fn: seen }],
      sticky: true,
      onX: seen,
    });
    perCard = { p, day, el };
  };
  /** Hide the cards while busy (they wait, not dismissed); drop a "start now?" card whose moment has passed. */
  const tidy = () => {
    const box = document.getElementById('adk-toasts');
    if (box) box.hidden = busy();
    const room = box && !box.hidden && box.children.length ? Math.ceil(box.getBoundingClientRect().height) : 0;
    document.documentElement.style.setProperty('--adk-room', room ? room + 'px' : '0px');
    if (!perCard) return;
    const s = st();
    if (!document.contains(perCard.el)) { perCard = null; return; }
    if (!s || !A.on(s) || A.dayKey() !== perCard.day || A.period(cfg()) !== perCard.p || A.isDone(s, perCard.p, perCard.day)) {
      perCard.el.remove(); perCard = null;
    }
  };
  const showGeneral = () => {
    const m = mem();
    const it = A.pickGeneral(doc, m.lastGenId);
    updMem((x) => { x.lastGen = Date.now(); x.lastGenId = it && it.id; });
    if (!it) return;
    if (document.hidden) { sysNotify(NAMES.g, it.text); return; }
    note({
      title: `<span class="adk-toast-ar" lang="ar" dir="rtl">${esc(it.text)}</span>`,
      body: `<p class="small muted" lang="ar" dir="rtl">${esc(it.source)}${it.count > 1 ? ` · ${it.count} ×` : ''}</p>`,
      actions: [{ label: CT.i18n.tx('adks.count'), fn: () => V.open('g', it.id) }, { label: CT.i18n.tx('adks.mute'), fn: () => { updMem((x) => { x.muted = A.dayKey(); }); ui.toast(CT.i18n.tx('adks.mutedToast')); } }],
      ms: 20000,
    });
  };

  function check() {
    tidy();
    const s = st();
    if (!s || !A.on(s)) return;
    if (busy()) return; // waits: the same reminder is still due when the focus time ends
    let m = mem();
    if (!m.lastGen) m = updMem((x) => { x.lastGen = Date.now(); }); // first visit: general reminders count from now
    const due = A.due(s, m);
    if (!due.length) return;
    if (document.hidden && !(m.notify && 'Notification' in window && Notification.permission === 'granted')) return; // shown when back
    whenLoaded(() => {
      if (busy()) return;
      const per = due.find((x) => x.type === 'period' && !(perCard && perCard.p === x.p));
      if (per) showPeriod(per.p);
      else if (due.some((x) => x.type === 'general')) showGeneral();
    });
  }
  V.check = check;

  V.init = () => {
    if (A.on(st())) V.load().catch(() => {});
    setTimeout(check, 1500); // after the page has settled: the "start now?" card when opened inside a window
    setInterval(check, 30000);
    setInterval(tidy, 1000); // a focus screen / timer / pause hides the cards within a second (CSS hides them at once over the focus screen)
    document.addEventListener('visibilitychange', () => { if (!document.hidden) setTimeout(check, 800); });
  };

  /* ---------- settings (rendered inside the settings center; translated) ---------- */
  const opt = (v, cur, label) => `<option value="${esc(v)}" ${String(v) === String(cur) ? 'selected' : ''}>${esc(label)}</option>`;
  const freqLabel = (f) => CT.i18n.tx(f === 30 ? 'adks.freq.30' : f === 60 ? 'adks.freq.60' : f ? 'adks.freq.hours' : 'adks.freq.off', { n: f / 60 });
  V.settingsHTML = () => {
    const I = CT.i18n, t = I.t, tx = I.tx, th = I.th;
    const c = cfg();
    const on = c.enabled !== false;
    const m = mem();
    const perm = 'Notification' in window ? Notification.permission : 'unsupported';
    const w = A.windows(c);
    const tt = w.times;
    return `<section class="card adk-settings" id="adhkar-settings">
      <h2>${t('adks.title')}</h2>
      <label class="check-field"><input type="checkbox" data-adk-set="enabled" ${on ? 'checked' : ''}> <span>${t('adks.on')}</span></label>
      ${on ? `
      <h3>${t('adks.windows')}</h3>
      <label class="field inline"><span>${t('adks.mode')}</span>
        <select data-adk-set="mode">${opt('manual', c.mode, tx('adks.mode.manual'))}${opt('auto', c.mode, tx('adks.mode.auto'))}</select></label>
      ${c.mode === 'auto' ? `
        <div class="form-grid adk-grid">
          <label class="field"><span>${t('adks.city')}</span><select data-adk-set="city">${Object.keys(A.CITIES).map((k) => opt(k, c.city, tx('adks.city.' + k))).join('')}</select></label>
          ${c.city === 'custom' ? `<label class="field"><span>${t('adks.lat')}</span><input type="number" step="0.001" min="-66" max="66" data-adk-set="lat" value="${c.lat ?? ''}" dir="ltr"></label>
          <label class="field"><span>${t('adks.lng')}</span><input type="number" step="0.001" min="-180" max="180" data-adk-set="lng" value="${c.lng ?? ''}" dir="ltr"></label>` : ''}
          <label class="field"><span>${t('adks.method')}</span><select data-adk-set="method">${Object.keys(A.METHODS).map((k) => opt(k, c.method, tx('adks.method.' + k))).join('')}</select></label>
          <label class="field"><span>${t('adks.asr')}</span><select data-adk-set="asr">${Object.keys(A.ASR).map((k) => opt(k, c.asr, tx('adks.asr.' + k))).join('')}</select></label>
        </div>
        <p class="small muted">${t('adks.autoHint')} ${w.auto && tt ? th('adks.today', { m: rng(w.m[0], w.m[1]), e: rng(w.e[0], w.e[1]) }) : t('adks.noData')} ${t('adks.clock')}</p>`
      : `<div class="form-grid adk-grid">
          <label class="field"><span>${t('adks.mFrom')}</span><input type="time" data-adk-set="morning.from" value="${esc(c.morning.from)}"></label>
          <label class="field"><span>${t('adks.to')}</span><input type="time" data-adk-set="morning.to" value="${esc(c.morning.to)}"></label>
          <label class="field"><span>${t('adks.eFrom')}</span><input type="time" data-adk-set="evening.from" value="${esc(c.evening.from)}"></label>
          <label class="field"><span>${t('adks.to')}</span><input type="time" data-adk-set="evening.to" value="${esc(c.evening.to)}"></label>
        </div>`}
      <label class="check-field"><input type="checkbox" data-adk-set="startToast" ${c.startToast ? 'checked' : ''}> <span>${t('adks.startToast')}</span></label>

      <h3>${t('adks.general')}</h3>
      <div class="form-grid adk-grid">
        <label class="field"><span>${t('adks.freq')}</span><select data-adk-set="general.every">${A.FREQS.map((f) => opt(f, c.general.every, freqLabel(f))).join('')}</select></label>
        <label class="field"><span>${t('adks.quietFrom')}</span><input type="time" data-adk-set="general.quietFrom" value="${esc(c.general.quietFrom)}"></label>
        <label class="field"><span>${t('adks.to')}</span><input type="time" data-adk-set="general.quietTo" value="${esc(c.general.quietTo)}"></label>
      </div>
      ${m.muted === A.dayKey() ? `<p class="small muted">${t('adks.muted')} <button class="btn btn-ghost btn-small" data-adk-act="unmute">${t('adks.unmute')}</button></p>` : (Number(c.general.every) ? `<p class="small"><button class="btn btn-ghost btn-small" data-adk-act="mute">${t('adks.mute')}</button></p>` : '')}
      <p class="small muted">${t('adks.waits')}</p>

      <h3>${t('adks.alerts')}</h3>
      <label class="check-field"><input type="checkbox" data-adk-dev="notify" ${m.notify && perm === 'granted' ? 'checked' : ''} ${perm === 'unsupported' || perm === 'denied' ? 'disabled' : ''}>
        <span>${t('adks.notify')}${perm === 'denied' ? ' — ' + t('adks.blocked') : perm === 'unsupported' ? ' — ' + t('adks.unsupported') : ''}</span></label>
      <label class="check-field"><input type="checkbox" data-adk-set="sound" ${c.sound ? 'checked' : ''}> <span>${t('adks.sound')}</span></label>
      <label class="check-field"><input type="checkbox" data-adk-set="vibrate" ${c.vibrate ? 'checked' : ''}> <span>${t('adks.vibrate')}</span></label>

      <h3>${t('adks.reading')}</h3>
      <label class="field inline"><span>${t('adks.font')}</span>
        <input type="range" min="0.8" max="2" step="0.1" data-adk-set="font" value="${Number(c.font) || 1}" aria-valuetext="${Math.round((Number(c.font) || 1) * 100)}%"></label>
      <p class="adk-sample" lang="ar" dir="rtl" style="--adk-scale:${Number(c.font) || 1}">سُبْحَانَ اللَّهِ وَبِحَمْدِهِ</p>

      <h3>${t('adks.points')}</h3>
      <label class="check-field"><input type="checkbox" data-adk-set="points" ${c.points ? 'checked' : ''}> <span>${t('adks.pointsOn', { n: ptsAdk() })}</span></label>
      <p class="small muted">${t('adks.pointsHint')}</p>
      <p><button class="btn btn-small" data-adk-act="reset">${t('adks.reset')}</button></p>
      ` : ''}
    </section>`;
  };

  const valueOf = (inp) => {
    const k = inp.dataset.adkSet;
    if (inp.type === 'checkbox') return inp.checked;
    if (k === 'general.every') return Number(inp.value) || 0;
    if (k === 'font') return Math.max(0.8, Math.min(2, Number(inp.value) || 1));
    if (k === 'lat' || k === 'lng') return inp.value === '' ? null : Number(inp.value);
    return inp.value;
  };
  document.addEventListener('change', (e) => {
    const inp = e.target;
    if (!inp.closest || !inp.closest('.adk-settings')) return;
    if (inp.dataset.adkSet) {
      const k = inp.dataset.adkSet;
      const v = valueOf(inp);
      if ((k === 'morning.from' || k === 'morning.to' || k === 'evening.from' || k === 'evening.to' || k.startsWith('general.quiet')) && A.toMin(v) == null) return;
      S.commit(CT.i18n.tx('adks.u.cfg'), (s) => A.set(s, k, v));
      if (k === 'general.every') updMem((m) => { m.lastGen = Date.now(); });
      if (k === 'enabled') { if (v) V.load().catch(() => {}); if (CT.app && CT.app.renderHeader) CT.app.renderHeader(); }
    } else if (inp.dataset.adkDev === 'notify') {
      if (!inp.checked) { updMem((m) => { m.notify = false; }); return; }
      if (!('Notification' in window)) return;
      Notification.requestPermission().then((r) => {
        updMem((m) => { m.notify = r === 'granted'; });
        if (r !== 'granted') ui.toast(CT.i18n.tx('adks.denied'));
        CT.app.rerender();
      });
    }
  });
  document.addEventListener('input', (e) => {
    const inp = e.target;
    if (inp.dataset && inp.dataset.adkSet === 'font') {
      const s = document.querySelector('.adk-sample');
      if (s) s.style.setProperty('--adk-scale', inp.value);
    }
  });
  document.addEventListener('click', (e) => {
    const b = e.target.closest && e.target.closest('[data-adk-act]');
    if (!b) return;
    const a = b.dataset.adkAct;
    if (a === 'mute') { updMem((m) => { m.muted = A.dayKey(); }); CT.app.rerender(); }
    else if (a === 'unmute') { updMem((m) => { delete m.muted; }); CT.app.rerender(); }
    else if (a === 'reset') ui.confirm(CT.i18n.tx('adks.resetQ'), CT.i18n.tx('adks.resetOk'), false, { localized: true })
      .then((ok) => { if (ok) S.commit(CT.i18n.tx('adks.u.reset'), (s) => A.reset(s)); });
  });

  // the home row sits in the daily-progress card of the "היום" screen
  if (CT.views.dashboard && CT.views.dashboard.slots) CT.views.dashboard.slots.daily.push(V.homeHTML);
})(window.CT);
