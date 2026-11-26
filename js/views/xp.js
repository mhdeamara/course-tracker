/* views/xp.js — points UI: instant feedback (+XP pop, level-up), the home-screen level card, the sidebar chip
 * and the "נקודות" page (level, how points are earned, full history). All numbers come from CT.game. */
(function (CT) {
  'use strict';
  const { u, store: S, game: G } = CT;
  const esc = u.esc;
  const V = {};
  const HIST_PAGE = 60;
  let histShown = HIST_PAGE;

  const fmt = (n) => Math.round(n).toLocaleString('he-IL');
  const signed = (n) => (n > 0 ? `+${fmt(n)}` : n < 0 ? `−${fmt(-n)}` : '0');
  const motionOk = () => !(CT.app && CT.app.reducedMotion && CT.app.reducedMotion());

  /* ---------- feedback ---------- */
  let popTimer = null;
  function pop(text, sub) {
    let el = document.getElementById('xp-pop');
    if (!el) {
      el = document.createElement('div');
      el.id = 'xp-pop';
      el.className = 'xp-pop';
      el.setAttribute('role', 'status');
      document.body.appendChild(el);
    }
    el.innerHTML = `<b>${esc(text)}</b>${sub ? `<span>${esc(sub)}</span>` : ''}`;
    el.classList.remove('show'); void el.offsetWidth; el.classList.add('show'); el.classList.toggle('still', !motionOk());
    clearTimeout(popTimer);
    popTimer = setTimeout(() => el.classList.remove('show'), 2200);
  }

  function chime(up) {
    if (!(CT.app && CT.app.sound && CT.app.sound())) return;
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const notes = up ? [523.25, 659.25, 783.99, 1046.5] : [659.25, 880];
      notes.forEach((f, i) => {
        const o = ctx.createOscillator(), gn = ctx.createGain();
        o.type = 'sine'; o.frequency.value = f;
        const t = ctx.currentTime + i * 0.09;
        gn.gain.setValueAtTime(0.0001, t);
        gn.gain.exponentialRampToValueAtTime(0.12, t + 0.02);
        gn.gain.exponentialRampToValueAtTime(0.0001, t + 0.28);
        o.connect(gn).connect(ctx.destination);
        o.start(t); o.stop(t + 0.3);
      });
      setTimeout(() => ctx.close(), 1200);
    } catch (e) { /* no audio: fine */ }
  }

  function levelUp(level) {
    chime(true);
    const wrap = document.createElement('div');
    wrap.className = 'lvl-up';
    wrap.setAttribute('role', 'alertdialog');
    wrap.setAttribute('aria-label', `עלית לרמה ${level.n}`);
    wrap.innerHTML = `
      <div class="lvl-card">
        ${motionOk() ? '<div class="lvl-burst" aria-hidden="true">' + Array.from({ length: 14 }, (_, i) => `<i style="--a:${i * (360 / 14)}deg;--d:${i % 3}"></i>`).join('') + '</div>' : ''}
        <div class="lvl-badge" aria-hidden="true">${level.n}</div>
        <p class="lvl-kicker">עלית רמה!</p>
        <h2>${esc(level.name)}</h2>
        <p class="muted">רמה ${level.n}. עוד ${fmt(level.need)} נקודות לרמה הבאה. כל הכבוד על ההתמדה.</p>
        <button class="btn btn-primary btn-lg" data-close>יאללה, ממשיכים</button>
      </div>`;
    const close = () => { wrap.classList.add('out'); setTimeout(() => wrap.remove(), 250); document.removeEventListener('keydown', onKey); };
    const onKey = (e) => { if (e.key === 'Escape' || e.key === 'Enter') close(); };
    wrap.addEventListener('click', (e) => { if (e.target === wrap || e.target.closest('[data-close]')) close(); });
    document.addEventListener('keydown', onKey);
    document.body.appendChild(wrap);
    wrap.querySelector('[data-close]').focus();
  }

  /** Called by the store after every change that touched the ledger. */
  G.notify = (r) => {
    if (!r || typeof document === 'undefined') return;
    const gained = r.added.filter((e) => e.p > 0);
    const lost = r.added.filter((e) => e.p < 0);
    const g = u.sum(gained, (e) => e.p), l = -u.sum(lost, (e) => e.p);
    if (g > 0) {
      const top = gained.slice().sort((a, b) => b.p - a.p)[0];
      pop(`${signed(g)} XP`, (top.why || []).join(' · '));
      chime(false);
    } else if (l > 0) {
      pop(`${signed(-l)} XP`, 'הנקודות על זה הוחזרו — אפשר לצבור שוב כשמסיימים');
    }
    if (r.level.n > r.levelBefore) setTimeout(() => levelUp(r.level), g > 0 ? 500 : 0);
    paintChip();
  };

  /* ---------- home screen card + sidebar chip ---------- */
  function bar(pct) {
    return `<div class="xp-bar" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${pct}"><div class="xp-fill" style="width:${pct}%"></div></div>`;
  }

  V.cardHTML = () => {
    if (G.cfg(S.state).enabled === false) return '';
    const s = G.summary(S.state);
    const L = s.level;
    const mult = G.multiplier(G.cfg(S.state), s.streak.today ? s.streak.days : s.streak.days + 1);
    return `<a href="#/xp" class="card xp-card lift" aria-label="רמה ${L.n}, ${esc(L.name)}. ${fmt(L.into)} מתוך ${fmt(L.need)} נקודות לרמה הבאה. לפרטים">
        <div class="xp-top">
          <span class="xp-lvl" aria-hidden="true">${L.n}</span>
          <span class="xp-name"><span class="muted small">רמה ${L.n}</span><b>${esc(L.name)}</b></span>
          <span class="xp-today"><b>${signed(s.today)}</b><span class="muted small">היום</span></span>
        </div>
        ${bar(L.pct)}
        <div class="xp-foot muted small"><span>${fmt(L.into)} / ${fmt(L.need)} לרמה ${L.n + 1}</span>${mult > 1 ? `<span class="xp-mult">רצף ×${mult}</span>` : ''}</div>
      </a>`;
  };

  V.chipHTML = () => {
    if (G.cfg(S.state).enabled === false) return '';
    const L = G.summary(S.state).level;
    return `<a href="#/xp" class="sb-xp" id="sb-xp" aria-label="רמה ${L.n}, ${esc(L.name)}"><span class="sb-xp-n">${L.n}</span><span class="sb-xp-t"><b>${esc(L.name)}</b>${bar(L.pct)}</span></a>`;
  };
  function paintChip() {
    const el = document.getElementById('sb-xp');
    if (el) el.outerHTML = V.chipHTML();
  }

  if (CT.views.dashboard) CT.views.dashboard.slots.side.push(V.cardHTML);

  /* ---------- "נקודות" page ---------- */
  const TYPE_LABEL = { item: 'סיום פריט', review: 'צריך לחזור', study: 'זמן לימוד', note: 'הערה', course: 'סיום קורס', rev: 'ביטול' };

  function rulesHTML(cfg) {
    const p = cfg.pts;
    const rows = [
      ['סיום פריט קל / רגיל / קשה', `${p.easy} / ${p.normal} / ${p.hard}`, 'ש״ב, מעבדות ופרויקטים נחשבים קשים אוטומטית. אפשר לשנות לכל פריט ב"פרטים ועריכה".'],
      ['בונוס בזמן', `+${p.onTime}`, 'סיום עד תאריך היעד.'],
      ['בונוס מוקדם', `+${p.early}`, `סיום ${p.earlyDays} ימים או יותר לפני תאריך היעד.`],
      ['זמן לימוד', `${p.per10min} לכל 10 דק׳`, `עד ${cfg.caps.study} ביום.`],
      ['הערה ראשונה על פריט', `+${p.note}`, `מ-${p.noteMinChars} תווים. עד ${cfg.caps.note} ביום. לא נלקח בחזרה.`],
      ['סגירת "צריך לחזור"', `+${p.review}`, ''],
      ['סיום קורס', `+${p.course}`, 'עם ציון, עובר או פטור.'],
      ['מכפיל רצף', cfg.streak.map(([d, x]) => `<span class="nw">${d}+ ימים ×${x}</span>`).join(' '), 'על סיום פריטים. רצף = ימים רצופים עם נקודות.'],
    ];
    return `<table class="xp-rules"><tbody>${rows.map(([a, b, c]) => `<tr><th scope="row">${a}</th><td class="num">${b}</td><td class="muted small">${c}</td></tr>`).join('')}</tbody></table>
      <p class="muted small">ביטול סימון מחזיר בדיוק את מה שניתן, וסימון מחדש מחזיר אותו — אף פעם לא כפול. תקרה יומית לסיום פריטים: ${cfg.caps.item}. היום מתחלף ב-04:00, כך שעבודה בלילה נספרת ליום שלה. מה שהיה מסומן לפני שהופעלו הנקודות לא נספר.</p>`;
  }

  function historyHTML(ledger) {
    const list = ledger.slice().reverse().filter((e) => e.p !== 0 || e.why.includes('תקרה יומית'));
    if (!list.length) return CT.ui.empty('עוד אין נקודות. סמנו V על פריט, הפעילו טיימר או כתבו הערה — והן יופיעו כאן.');
    const shown = list.slice(0, histShown);
    let day = '';
    const rows = shown.map((e) => {
      const head = e.d !== day ? `<li class="xp-day">${esc(dayTitle(e.d))}<span>${signed(u.sum(list.filter((x) => x.d === e.d), (x) => x.p))}</span></li>` : '';
      day = e.d;
      return `${head}<li class="xp-row${e.p < 0 ? ' neg' : ''}">
          <span class="xp-type">${TYPE_LABEL[e.t] || e.t}</span>
          <span class="xp-label" dir="auto">${esc(e.label || '')}</span>
          <span class="xp-why">${(e.why || []).map((w) => `<span class="tag">${esc(w)}</span>`).join('')}</span>
          <b class="xp-p">${signed(e.p)}</b></li>`;
    }).join('');
    return `<ul class="xp-hist">${rows}</ul>${list.length > histShown ? `<button class="btn btn-ghost btn-small more-btn" data-action="more">הצג עוד</button>` : ''}`;
  }
  function dayTitle(d) {
    const t = G.dayKey();
    if (d === t) return 'היום';
    if (d === u.addDays(t, -1)) return 'אתמול';
    return `${u.DAYS[u.parseDate(d).getDay()]} ${u.fmtDateFull(d)}`;
  }

  V.render = (root) => {
    const st = S.state;
    const gm = st.game || { ledger: [] };
    const cfg = G.cfg(st);
    const s = G.summary(st);
    const L = s.level;
    const week = u.sum(gm.ledger.filter((e) => e.d > u.addDays(G.dayKey(), -7) && G.EARN_TYPES.has(e.t)), (e) => e.p);
    root.innerHTML = `
      <div class="xp-page">
        <h1>נקודות ורמות</h1>
        <p class="muted xp-intro">נקודות על התקדמות אמיתית: סיום פריטים, זמן לימוד והערות. הכל נרשם ביומן למטה, עם הסיבה.</p>
        ${cfg.enabled === false ? `<div class="banner">הנקודות כבויות. אפשר להפעיל אותן ב<a href="#/settings">הגדרות</a>.</div>` : ''}
        <section class="card xp-hero">
          <span class="xp-lvl xp-lvl-lg" aria-hidden="true">${L.n}</span>
          <div class="xp-hero-main">
            <p class="muted small">רמה ${L.n}</p>
            <h2>${esc(L.name)}</h2>
            ${bar(L.pct)}
            <p class="muted small">${fmt(L.into)} / ${fmt(L.need)} — עוד ${fmt(L.need - L.into)} לרמה ${L.n + 1} (${esc(G.levelName(L.n + 1))})</p>
          </div>
        </section>
        <div class="stat-cards">
          <div class="card stat"><b>${fmt(s.earned)}</b><span>סה״כ נקודות</span></div>
          <div class="card stat"><b>${signed(s.today)}</b><span>היום</span></div>
          <div class="card stat"><b>${signed(week)}</b><span>7 ימים אחרונים</span></div>
          <div class="card stat"><b>${s.streak.days}</b><span>${s.streak.days === 1 ? 'יום רצף' : 'ימי רצף'}${s.streak.days && !s.streak.today ? ' — אפשר להמשיך היום' : ''}</span></div>
        </div>
        <details class="card dash-more"${gm.ledger.length ? '' : ' open'}>
          <summary><span class="dm-title">איך צוברים נקודות</span><span class="muted small dm-hint">כל הערכים והכללים</span><span class="dm-chev" aria-hidden="true">${u.icon.chev}</span></summary>
          <div class="dm-body">${rulesHTML(cfg)}</div>
        </details>
        <section class="card">
          <div class="card-head"><h2>יומן נקודות</h2><span class="muted small">${gm.ledger.length} רשומות</span></div>
          ${historyHTML(gm.ledger)}
        </section>
      </div>`;
    const more = root.querySelector('[data-action=more]');
    if (more) more.onclick = () => { histShown += HIST_PAGE; V.render(root); };
  };

  CT.views.xp = V;
})(window.CT);
