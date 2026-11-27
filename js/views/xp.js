/* views/xp.js — points UI: instant feedback (+XP pop, new badge, goal, level-up), the home-screen card
 * (level + today's goal + daily challenge), the sidebar chip, and the "נקודות" page with four tabs:
 * overview (goals, challenge, season), badges, prizes, and the full log. All numbers come from CT.game. */
(function (CT) {
  'use strict';
  const { u, store: S, game: G } = CT;
  const esc = u.esc;
  const V = {};
  const HIST_PAGE = 60;
  let histShown = HIST_PAGE;

  const L = (k, p) => CT.i18n.t(k, p), LX = (k, p) => CT.i18n.tx(k, p);
  const fmt = (n) => (CT.ui && CT.ui.num ? CT.ui.num(Math.round(n)) : String(Math.round(n)));
  const signed = (n) => (n > 0 ? `+${fmt(n)}` : n < 0 ? `−${fmt(-n)}` : '0');
  const motionOk = () => !(CT.app && CT.app.reducedMotion && CT.app.reducedMotion());
  const look = () => (S.state.game && S.state.game.look) || {};
  const on = () => G.cfg(S.state).enabled !== false;

  /* ---------- built-in game content in the interface language ----------
   * Stored ids, labels, reasons and chosen titles never change. A known built-in Hebrew string (stored by game.js)
   * is shown through its key; anything else (item titles, course names, prize names) is shown as it is. */
  let KNOWN = null;
  const known = () => {
    if (KNOWN) return KNOWN;
    KNOWN = new Map();
    G.CHALLENGES.forEach((c) => KNOWN.set(c.name, 'game.ch.' + c.id));
    G.BADGES.forEach((b) => KNOWN.set(b.name, 'game.ach.' + b.id + '.name'));
    // stored reasons/labels written by game.js
    Object.entries({ 'בזמן': 'onTime', 'מוקדם': 'early', 'תקרה יומית': 'cap', 'בוטל': 'undone', 'סיום קורס': 'course', 'סגרת "צריך לחזור"': 'review',
      'הערה': 'note', 'תת-משימה': 'sub', 'רק 5 דקות': 'start', 'יעד יומי': 'goalDay', 'יעד שבועי': 'goalWeek', 'אתגר יומי': 'chal', 'הישג חדש': 'badge',
      'זמן לימוד': 'study', 'אזכרות בוקר': 'adkM', 'אזכרות ערב': 'adkE', 'מתחת למינימום היומי': 'belowMin', 'מינימום יומי': 'dailyMin', 'מימוש פרס': 'redeem' })
      .forEach(([he, k]) => KNOWN.set(he, 'game.w.' + k));
    Object.entries(G.DIFF_LABELS).forEach(([n, he]) => KNOWN.set(he, 'game.w.diff' + n));
    return KNOWN;
  };
  /** A stored ledger label or reason, translated when it is built-in text. */
  V.gameText = (s) => {
    s = String(s == null ? '' : s);
    const k = known().get(s);
    if (k) return LX(k);
    let m = /^רצף ×([\d.]+)$/.exec(s); // stored streak reason
    if (m) return LX('game.w.streak', { x: m[1] });
    m = /^(?:(\d+) ש׳)?\s*(?:(\d+) דק׳)?$/.exec(s); // stored study-minutes reason (u.fmtMinutes)
    if (m && (m[1] || m[2])) return CT.ui.minutes((Number(m[1]) || 0) * 60 + (Number(m[2]) || 0));
    return s;
  };
  V.challengeName = (ch) => (ch ? LX('game.ch.' + ch.id) : '');
  V.badgeName = (b) => LX('game.ach.' + b.id + '.name');
  const unlockName = (x) => LX('xpp.unk.' + x.kind, { name: LX('game.un.' + x.id) });

  /* ---------- look: accent color, level frame, title, sound (in-site rewards) ---------- */
  V.applyLook = () => {
    const lk = look();
    const lvl = G.levelOf(G.levelXP(S.state)).n;
    const ok = (kind, value) => G.UNLOCKS.some((x) => x.kind === kind && x.value === value && x.level <= lvl);
    const acc = lk.accent && ok('accent', lk.accent) ? lk.accent : '';
    if (acc) document.documentElement.dataset.accent = acc; else delete document.documentElement.dataset.accent;
  };
  const frameCls = () => { const f = look().frame; return f && G.UNLOCKS.some((x) => x.kind === 'frame' && x.value === f && x.level <= G.levelOf(G.levelXP(S.state)).n) ? ` frame-${f}` : ''; };
  const title = (L) => { const t = look().title; return t && G.titles(S.state).includes(t) ? t : L.name; };

  /* ---------- feedback ---------- */
  let popTimer = null;
  function pop(text, sub, kind = '') {
    let el = document.getElementById('xp-pop');
    if (!el) {
      el = document.createElement('div');
      el.id = 'xp-pop';
      el.setAttribute('role', 'status');
      CT.i18n.localized(el);
      document.body.appendChild(el);
    }
    el.className = 'xp-pop' + (kind ? ` xp-pop-${kind}` : '');
    el.innerHTML = `<b>${esc(text)}</b>${sub ? `<span>${esc(sub)}</span>` : ''}`;
    void el.offsetWidth; el.classList.add('show'); el.classList.toggle('still', !motionOk());
    clearTimeout(popTimer);
    popTimer = setTimeout(() => el.classList.remove('show'), 2600);
  }

  const SOUNDS = {
    '': { up: [523.25, 659.25, 783.99, 1046.5], small: [659.25, 880], type: 'sine', gap: 0.09 },
    bell: { up: [880, 1108.73, 1318.51, 1760], small: [1318.51, 1760], type: 'triangle', gap: 0.12 },
    xylo: { up: [392, 523.25, 659.25, 783.99, 1046.5], small: [783.99, 1046.5], type: 'square', gap: 0.07, soft: 0.04 },
  };
  function chime(up) {
    if (!(CT.app && CT.app.sound && CT.app.sound())) return;
    const sd = SOUNDS[look().sound] || SOUNDS[''];
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      (up ? sd.up : sd.small).forEach((f, i) => {
        const o = ctx.createOscillator(), gn = ctx.createGain();
        o.type = sd.type; o.frequency.value = f;
        const t = ctx.currentTime + i * sd.gap;
        gn.gain.setValueAtTime(0.0001, t);
        gn.gain.exponentialRampToValueAtTime(sd.soft || 0.12, t + 0.02);
        gn.gain.exponentialRampToValueAtTime(0.0001, t + 0.28);
        o.connect(gn).connect(ctx.destination);
        o.start(t); o.stop(t + 0.3);
      });
      setTimeout(() => ctx.close(), 1500);
    } catch (e) { /* no audio: fine */ }
  }

  function celebrate({ big, kicker, heading, text, button }) {
    chime(true);
    const wrap = document.createElement('div');
    wrap.className = 'lvl-up';
    wrap.setAttribute('role', 'alertdialog');
    wrap.setAttribute('aria-label', `${kicker} ${CT.i18n.iso(heading)}`);
    CT.i18n.localized(wrap);
    wrap.innerHTML = `
      <div class="lvl-card">
        ${motionOk() ? '<div class="lvl-burst" aria-hidden="true">' + Array.from({ length: 14 }, (_, i) => `<i style="--a:${i * (360 / 14)}deg;--d:${i % 3}"></i>`).join('') + '</div>' : ''}
        <div class="lvl-badge" aria-hidden="true">${big}</div>
        <p class="lvl-kicker">${esc(kicker)}</p>
        <h2 dir="auto">${esc(heading)}</h2>
        <p class="muted">${esc(text)}</p>
        <button class="btn btn-primary btn-lg" data-close>${esc(button)}</button>
      </div>`;
    const close = () => { wrap.classList.add('out'); setTimeout(() => wrap.remove(), 250); document.removeEventListener('keydown', onKey); };
    const onKey = (e) => { if (e.key === 'Escape' || e.key === 'Enter') { e.preventDefault(); close(); } };
    wrap.addEventListener('click', (e) => { if (e.target === wrap || e.target.closest('[data-close]')) close(); });
    document.addEventListener('keydown', onKey);
    document.body.appendChild(wrap);
    wrap.querySelector('[data-close]').focus();
  }

  /** Called by the store after every change that touched the ledger. */
  G.notify = (r) => {
    if (!r || typeof document === 'undefined') return;
    const gained = r.added.filter((e) => e.p > 0);
    const g = u.sum(gained, (e) => e.p), l = -u.sum(r.added.filter((e) => e.p < 0), (e) => e.p);
    const badges = r.added.filter((e) => e.t === 'badge');
    const goal = r.added.find((e) => e.t === 'goal' && e.p > 0);
    const chal = r.added.find((e) => e.t === 'chal' && e.p > 0);
    if (badges.length) pop(`${badges[0].icon ? badges[0].icon + ' ' : ''}${LX('xpp.pop.badge', { name: V.gameText(badges[0].label) })}`, `${signed(g)} XP${badges.length > 1 ? ` · ${LX('xpp.pop.more', { n: badges.length - 1 })}` : ''}`, 'badge');
    else if (goal) pop(LX('xpp.pop.goal', { name: V.gameText(goal.label) }), `${signed(g)} XP`, 'goal');
    else if (chal) pop(LX('xpp.pop.chal'), `${signed(g)} XP`, 'goal');
    else if (g > 0) {
      const top = gained.slice().sort((a, b) => b.p - a.p)[0];
      pop(`${signed(g)} XP`, (top.why || []).map(V.gameText).join(' · '));
    } else if (l > 0) {
      pop(`${signed(-l)} XP`, LX('xpp.pop.back'));
    }
    if (g > 0) chime(false);
    if (r.added.some((e) => e.t === 'pen') && CT.app) CT.app.rerender(); // shows the gentle notice on the home screen
    if (r.level.n > r.levelBefore) {
      const unlocked = G.UNLOCKS.filter((x) => x.level > r.levelBefore && x.level <= r.level.n).map(unlockName);
      setTimeout(() => celebrate({
        big: r.level.n, kicker: LX('xpp.up.kicker'), heading: V.levelLabel(r.level.name),
        text: [LX('xpp.up.level', { n: r.level.n }), unlocked.length ? LX('xpp.up.unlocked', { list: unlocked.join(', ') }) : '', LX('xpp.up.next', { n: fmt(r.level.need) })].filter(Boolean).join(' '),
        button: LX('xpp.up.btn'),
      }), g > 0 ? 600 : 0);
    }
    paintChip();
  };

  /* ---------- small pieces ---------- */
  function bar(pct, label) {
    return `<div class="xp-bar" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${pct}"${label ? ` aria-label="${esc(label)}"` : ''}><div class="xp-fill" style="width:${Math.min(100, pct)}%"></div></div>`;
  }
  /** Two concentric rings: outer = items, inner = minutes, each toward its goal. */
  function goalRings(s, goal, size = 64, label) {
    const ring = (r, pct, cls) => {
      const c = 2 * Math.PI * r;
      return `<circle class="gr-bg" cx="${size / 2}" cy="${size / 2}" r="${r}"/><circle class="gr-fg ${cls}" cx="${size / 2}" cy="${size / 2}" r="${r}" stroke-dasharray="${c.toFixed(2)}" stroke-dashoffset="${(c * (1 - Math.min(1, pct))).toFixed(2)}" transform="rotate(-90 ${size / 2} ${size / 2})"/>`;
    };
    const pi = s.items / goal.items, pm = s.minutes / goal.minutes;
    return `<svg class="goal-rings${G.goalMet(s, goal) ? ' met' : ''}" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" role="img"
        aria-label="${esc(label || LX('xpp.ringsLabel', { i: s.items, ni: goal.items, m: Math.round(s.minutes), nm: goal.minutes }))}">${ring(size / 2 - 5, pi, 'gr-items')}${ring(size / 2 - 14, pm, 'gr-min')}</svg>`;
  }
  const goalLine = (s, goal) => `<span class="gl-i">${L('xpp.lineItems', { n: fmt(Math.min(s.items, 99)), m: fmt(goal.items) })}</span> · <span class="gl-m">${L('xpp.lineMin', { n: fmt(s.minutes), m: fmt(goal.minutes) })}</span>`;

  /* ---------- sidebar chip (the home screen uses V.dailyHTML below) ---------- */
  /** A level name in the interface language. Names are stored (chosen titles) in Hebrew; a built-in one is shown
   *  translated ("מיקוד" → "Focus", "אגדה 2" → "Legend 2"), anything else as it is. */
  V.levelLabel = (name) => {
    const m = /^(.*?)(?: (\d+))?$/.exec(String(name || ''));
    const i = G.LEVEL_NAMES.indexOf(m[1]);
    if (i < 0) return String(name || '');
    const base = CT.i18n.tx('xp.lvl.' + (i + 1));
    return m[2] ? `${base} ${m[2]}` : base;
  };
  V.chipHTML = () => {
    if (!on()) return '';
    V.applyLook();
    const L = G.summary(S.state).level;
    const name = V.levelLabel(title(L));
    return `<a href="#/xp" class="sb-xp" id="sb-xp" aria-label="${CT.i18n.t('xp.chip', { n: L.n, title: name })}"><span class="sb-xp-n${frameCls()}">${L.n}</span><span class="sb-xp-t"><b dir="auto">${esc(name)}</b>${bar(L.pct)}</span></a>`;
  };
  function paintChip() {
    const el = document.getElementById('sb-xp');
    if (el) el.outerHTML = V.chipHTML();
  }

  /** Compact, translated daily goal for the "היום" screen (inside its daily-progress card). */
  V.dailyHTML = () => {
    if (!on() || !S.state.game) return '';
    V.applyLook();
    const I = CT.i18n, ui = CT.ui;
    const st = S.state, cfg = G.cfg(st), day = G.dayKey();
    const s = G.summary(st), L = s.level;
    const extras = cfg.extras !== false;
    const meta = `<span class="muted small">${I.t('xpd.level', { n: L.n })} · ${I.t('xpd.today', { pts: (s.today > 0 ? '+' : '') + ui.num(Math.round(s.today)) })}</span>`;
    if (!extras) return `<a href="#/xp" class="td-goal">${bar(L.pct, I.tx('xpd.levelBar', { n: L.n }))}<span class="td-goal-t">${meta}</span></a>`;
    const ds = G.dayStats(st.game.ledger, day), goal = cfg.goals.day;
    const met = G.goalMet(ds, goal);
    const ch = G.challenge(day);
    const chDone = st.game.ledger.some((e) => e.k === `chal:${day}` && e.t === 'chal') && ch.test(ds);
    const line = I.tx('xpd.goalLine', { i: ui.num(Math.min(ds.items, 99)), ni: ui.num(goal.items), m: ui.num(Math.round(ds.minutes)), nm: ui.num(goal.minutes) });
    return `<a href="#/xp" class="td-goal${met ? ' is-met' : ''}">
        ${goalRings(ds, goal, 52, line)}
        <span class="td-goal-t"><b>${met ? I.t('xpd.goalMet') : I.t('xpd.goal')}</b><span class="muted small">${esc(line)}</span>${meta}</span>
      </a>
      <p class="td-chal${chDone ? ' is-done' : ''}">${chDone ? u.icon.check : u.icon.spark}<span class="muted small">${I.t('xpd.challenge')}</span><span class="small">${esc(V.challengeName(ch))}</span></p>`;
  };
  if (CT.views.dashboard) CT.views.dashboard.slots.daily.push(V.dailyHTML);

  /* ---------- page: overview ---------- */
  const TYPES = ['item', 'review', 'study', 'note', 'course', 'start', 'sub', 'goal', 'chal', 'badge', 'redeem', 'pen', 'rev', 'adk'];
  const typeLabel = (t) => (TYPES.includes(t) ? LX('xpp.type.' + t) : t);

  function rulesHTML(cfg) {
    const p = cfg.pts, n = (x) => fmt(x);
    const rows = [
      ['xpp.r.items', `${n(p.easy)} / ${n(p.normal)} / ${n(p.hard)}`, L('xpp.r.itemsHint')],
      ['xpp.r.onTime', `+${n(p.onTime)}`, L('xpp.r.onTimeHint')],
      ['xpp.r.early', `+${n(p.early)}`, L('xpp.r.earlyHint', { n: p.earlyDays })],
      ['xpp.r.study', esc(LX('xpp.r.per10', { n: p.per10min })), L('xpp.r.capDay', { n: cfg.caps.study })],
      ['xpp.r.note', `+${n(p.note)}`, L('xpp.r.noteHint', { chars: p.noteMinChars, n: cfg.caps.note })],
      ['xpp.r.review', `+${n(p.review)}`, ''],
      ['xpp.r.course', `+${n(p.course)}`, L('xpp.r.courseHint')],
      ['xpp.r.start', `+${n(p.start)}`, L('xpp.r.startHint', { n: cfg.caps.start })],
      ['xpp.r.sub', `+${n(p.sub)}`, L('xpp.r.subHint', { n: cfg.caps.sub })],
      ['xpp.r.goals', `+${n(p.goalDay)} / +${n(p.goalWeek)}`, L('xpp.r.goalsHint', { di: cfg.goals.day.items, dm: cfg.goals.day.minutes, wi: cfg.goals.week.items, wm: cfg.goals.week.minutes })],
      ['xpp.r.chal', `+${n(p.challenge)}`, L('xpp.r.chalHint')],
      ['xpp.r.badge', `+${n(p.badge)}`, L('xpp.r.badgeHint')],
      ['xpp.r.streak', cfg.streak.map(([d, x]) => `<span class="nw">${esc(LX('xpp.r.streakStep', { d, x }))}</span>`).join(' '), L('xpp.r.streakHint')],
    ];
    return `<table class="xp-rules"><tbody>${rows.map(([a, b, c]) => `<tr><th scope="row">${L(a)}</th><td class="num">${b}</td><td class="muted small">${c}</td></tr>`).join('')}</tbody></table>
      <p class="muted small">${L('xpp.r.footer', { n: cfg.caps.item })}</p>`;
  }

  function overviewHTML(st, cfg, s) {
    const gm = st.game, day = G.dayKey();
    const extras = cfg.extras !== false;
    const ds = G.dayStats(gm.ledger, day), ws = G.weekStats(gm.ledger, day);
    const ch = G.challenge(day);
    const chDone = gm.ledger.some((e) => e.k === `chal:${day}` && e.t === 'chal') && ch.test(ds);
    const sem = S.semester(st.settings.activeSemesterId);
    const seasons = (st.semesters || []).map((x) => ({ x, xp: G.seasonXP(st, x.id) })).filter((r) => r.xp > 0 || (sem && r.x.id === sem.id));
    const week = u.sum(gm.ledger.filter((e) => e.d > u.addDays(day, -7) && G.EARN_TYPES.has(e.t)), (e) => e.p);
    const goalRow = (stats, goal, key, perfect) => `<div class="goal-row">${goalRings(stats, goal)}<div><b>${L(key)}${G.goalMet(stats, goal) ? ` · ${L('xpp.met')}` : ''}</b><p class="muted small">${goalLine(stats, goal)}${perfect && G.goalPerfect(stats, goal) ? ` · ${L('xpp.perfectDay')}` : ''}</p></div></div>`;
    return `
      <div class="stat-cards">
        <div class="card stat"><b>${fmt(s.earned)}</b><span>${L('xpp.total')}</span></div>
        <div class="card stat"><b dir="ltr">${signed(s.today)}</b><span>${L('rel.today')}</span></div>
        <div class="card stat"><b dir="ltr">${signed(week)}</b><span>${L('xpp.last7')}</span></div>
        <div class="card stat"><b>${fmt(s.streak.days)}</b><span>${L('xpp.streakDays', { n: s.streak.days })}${s.streak.days && !s.streak.today ? ` — ${L('xpp.keepToday')}` : ''}</span></div>
      </div>
      ${extras ? `<div class="xp-two">
        <section class="card goals-card" aria-labelledby="goals-h">
          <div class="card-head"><h2 id="goals-h">${L('xpp.goals')}</h2><span class="muted small">${L('xpp.goalsHint')}</span></div>
          ${goalRow(ds, cfg.goals.day, 'rel.today', true)}
          ${goalRow(ws, cfg.goals.week, 'xpp.thisWeek', false)}
          <p class="muted small gr-legend"><span class="gl-i" aria-hidden="true">●</span> ${L('xpp.items')} · <span class="gl-m" aria-hidden="true">●</span> ${L('xpp.minutes')}</p>
        </section>
        <section class="card chal-card${chDone ? ' done' : ''}" aria-labelledby="chal-h">
          <div class="card-head"><h2 id="chal-h">${L('xpp.chalToday')}</h2><span class="muted small num-ltr">+${fmt(cfg.pts.challenge)}</span></div>
          <p class="chal-name">${chDone ? u.icon.check : u.icon.spark} ${esc(V.challengeName(ch))}</p>
          <p class="muted small">${L(chDone ? 'xpp.chalDone' : 'xpp.chalHint')}</p>
          <h3>${L('xpp.season')}${sem ? `: <span dir="auto">${esc(sem.name)}</span>` : ''}</h3>
          <p class="muted small">${L('xpp.seasonHint')}</p>
          ${seasons.length ? `<ul class="season-list">${seasons.map((r) => `<li${sem && r.x.id === sem.id ? ' class="cur"' : ''}><span dir="auto">${esc(r.x.name)}</span><b>${fmt(r.xp)}</b></li>`).join('')}</ul>` : ''}
        </section>
      </div>` : ''}
      <details class="card dash-more"${gm.ledger.length ? '' : ' open'}>
        <summary><span class="dm-title">${L('xpp.how')}</span><span class="muted small dm-hint">${L('xpp.howHint')}</span><span class="dm-chev" aria-hidden="true">${u.icon.chev}</span></summary>
        <div class="dm-body">${rulesHTML(cfg)}</div>
      </details>`;
  }

  /* ---------- page: badges ---------- */
  function badgesHTML(st) {
    const got = G.badgesEarned(st);
    const secret = G.BADGES.filter((b) => b.secret).length;
    return `<p class="muted">${L('xpp.badgesCount', { n: got.size, m: G.BADGES.length, s: secret })}</p>
      <ul class="badges">${G.BADGES.map((b) => {
        const e = got.get(b.id);
        const hidden = b.secret && !e;
        return `<li class="badge${e ? ' got' : ''}${hidden ? ' secret' : ''}">
          <span class="b-ic" aria-hidden="true">${hidden ? u.icon.info : b.icon}</span>
          <b>${hidden ? L('xpp.secret') : esc(V.badgeName(b))}</b>
          <span class="muted small">${hidden ? L('xpp.secretHint') : esc(LX('game.ach.' + b.id + '.desc'))}</span>
          ${e ? `<span class="b-date small">${esc(CT.ui.date(e.d, 'full'))}</span>` : ''}
        </li>`;
      }).join('')}</ul>`;
  }

  /* ---------- page: prizes ---------- */
  function prizesHTML(st) {
    const gm = st.game;
    const bal = G.balance(st);
    const lvl = G.levelOf(G.levelXP(st)).n;
    const lk = look();
    const redeemed = gm.ledger.filter((e) => e.t === 'redeem').slice().reverse();
    const unlock = (kind) => G.UNLOCKS.filter((x) => x.kind === kind);
    const pick = (kind, labelKey, opts) => `<div class="pick"><h3>${L(labelKey)}</h3><div class="pick-row" role="group" aria-label="${L(labelKey)}">
        <button class="pick-btn${!lk[kind] ? ' on' : ''}" data-look="${kind}" data-v="" aria-pressed="${!lk[kind]}">${L('xpp.plain')}</button>
        ${opts.map((x) => {
          const open = x.level <= lvl;
          return `<button class="pick-btn${lk[kind] === x.value ? ' on' : ''}${open ? '' : ' locked'}" data-look="${kind}" data-v="${esc(x.value)}" ${open ? '' : 'disabled'} aria-pressed="${lk[kind] === x.value}"
            >${kind === 'accent' ? `<span class="sw sw-${esc(x.value)}" aria-hidden="true"></span>` : ''}${kind === 'frame' ? `<span class="xp-lvl mini frame-${esc(x.value)}" aria-hidden="true">${lvl}</span>` : ''}${esc(LX('game.un.' + x.id))}${open ? '' : ` <span class="small">· ${L('xpd.level', { n: x.level })}</span>`}</button>`;
        }).join('')}</div></div>`;
    return `
      <section class="card prize-card" aria-labelledby="pp-h">
        <div class="card-head"><h2 id="pp-h">${L('xpp.myPrizes')}</h2><span class="balance">${L('xpp.balance', { n: fmt(bal) })}</span></div>
        <p class="muted small">${L('xpp.prizesHint')}</p>
        ${gm.prizes.length ? `<ul class="prizes">${gm.prizes.map((p) => `<li>
            <span class="pz-name" dir="auto">${esc(p.name)}</span>
            <span class="pz-cost">${fmt(p.cost)}</span>
            ${bar(Math.round(Math.min(1, bal / p.cost) * 100), LX('xpp.progressTo', { name: CT.i18n.iso(p.name) }))}
            <button class="btn btn-small ${bal >= p.cost ? 'btn-primary' : ''}" data-redeem="${esc(p.id)}" ${bal >= p.cost ? '' : 'disabled'}>${bal >= p.cost ? L('xpp.redeem') : L('xpp.more', { n: fmt(p.cost - bal) })}</button>
            <button class="icon-btn" data-pdel="${esc(p.id)}" aria-label="${L('xpp.delPrize', { name: CT.i18n.iso(p.name) })}">${u.icon.trash}</button></li>`).join('')}</ul>` : `<p class="muted">${L('xpp.noPrizes')}</p>`}
        <form class="prize-add" data-padd>
          <input name="name" dir="auto" maxlength="60" placeholder="${L('xpp.prizePh')}" aria-label="${L('xpp.prizeName')}" required>
          <input name="cost" type="number" min="10" max="100000" step="10" placeholder="${L('xpp.points')}" aria-label="${L('xpp.prizeCost')}" required>
          <button class="btn">${u.icon.plus}<span>${L('tmr.add')}</span></button>
        </form>
        ${redeemed.length ? `<h3>${L('xpp.redeemed')}</h3><ul class="redeemed">${redeemed.map((e) => `<li><span dir="auto">${esc(e.label)}</span><span class="muted small">${esc(CT.ui.date(e.d, 'full'))}</span><b dir="ltr">${signed(e.p)}</b></li>`).join('')}</ul>` : ''}
      </section>
      <section class="card" aria-labelledby="site-h">
        <div class="card-head"><h2 id="site-h">${L('xpp.sitePrizes')}</h2><span class="muted small">${L('xpp.sitePrizesHint')}</span></div>
        ${pick('accent', 'xpp.accent', unlock('accent'))}
        ${pick('frame', 'xpp.frame', unlock('frame'))}
        <div class="pick"><h3>${L('xpp.title')}</h3><label class="field inline"><span class="muted small">${L('xpp.titleHint')}</span>
          <select data-title><option value="">${L('xpp.titleNone')}</option>${G.titles(st).map((t) => `<option value="${esc(t)}" ${lk.title === t ? 'selected' : ''}>${esc(V.levelLabel(t))}</option>`).join('')}</select></label></div>
        ${pick('sound', 'xpp.sound', unlock('sound'))}
        <p class="muted small">${L('xpp.soundHint')} <a href="#/settings/appearance">${L('adkp.settings')}</a></p>
      </section>`;
  }

  /* ---------- page: log ---------- */
  const CAP = 'תקרה יומית'; // stored reason (game.js) for a capped entry worth 0
  function historyHTML(ledger) {
    const list = ledger.slice().reverse().filter((e) => e.p !== 0 || (e.why || []).includes(CAP));
    if (!list.length) return CT.ui.empty(L('xpp.logEmpty'));
    const shown = list.slice(0, histShown);
    let day = '';
    const rows = shown.map((e) => {
      const head = e.d !== day ? `<li class="xp-day">${esc(dayTitle(e.d))}<span dir="ltr">${signed(u.sum(list.filter((x) => x.d === e.d), (x) => x.p))}</span></li>` : '';
      day = e.d;
      return `${head}<li class="xp-row${e.p < 0 ? ' neg' : ''}">
          <span class="xp-type">${esc(typeLabel(e.t))}</span>
          <span class="xp-label" dir="auto">${esc(V.gameText(e.label || ''))}</span>
          <span class="xp-why">${(e.why || []).map((w) => `<span class="tag" dir="auto">${esc(V.gameText(w))}</span>`).join('')}</span>
          <b class="xp-p" dir="ltr">${signed(e.p)}</b></li>`;
    }).join('');
    return `<ul class="xp-hist">${rows}</ul>${list.length > histShown ? `<button class="btn btn-ghost btn-small more-btn" data-action="more">${L('xpp.showMore')}</button>` : ''}`;
  }
  function dayTitle(d) {
    const t = G.dayKey();
    if (d === t) return LX('rel.today');
    if (d === u.addDays(t, -1)) return LX('rel.yesterday');
    return CT.ui.date(d, 'long');
  }

  /* ---------- page ---------- */
  const TABS = [['', 'xpp.tab.overview'], ['badges', 'xpp.tab.badges'], ['prizes', 'xpp.tab.prizes'], ['log', 'xpp.tab.log']];

  V.render = (root, params = {}) => {
    const st = S.state;
    if (!st.game) G.ensure(st);
    const cfg = G.cfg(st);
    const s = G.summary(st);
    const Lv = s.level;
    const tab = TABS.some(([k]) => k === params.tab) ? params.tab : '';
    const body = tab === 'badges' ? badgesHTML(st) : tab === 'prizes' ? prizesHTML(st)
      : tab === 'log' ? `<section class="card"><div class="card-head"><h2>${L('xpp.log')}</h2><span class="muted small">${L('xpp.entries', { n: st.game.ledger.length })}</span></div>${historyHTML(st.game.ledger)}</section>`
        : overviewHTML(st, cfg, s);
    const ttl = V.levelLabel(title(Lv)), base = V.levelLabel(Lv.name);
    V.applyLook();
    root.innerHTML = `
      <div class="xp-page">
        <header class="pg-head"><h1>${L('xpp.h1')}</h1>
        <p class="muted xp-intro">${L('xpp.intro')}</p></header>
        ${cfg.enabled === false ? `<div class="banner banner-info">${L('xpp.off')} <a href="#/settings/xp">${L('adkp.toSettings')}</a></div>` : ''}
        <section class="card xp-hero">
          <span class="xp-lvl xp-lvl-lg${frameCls()}" aria-hidden="true">${Lv.n}</span>
          <div class="xp-hero-main">
            <p class="muted small">${L('xpd.level', { n: Lv.n })}${ttl !== base ? ` · ${esc(base)}` : ''}</p>
            <h2 dir="auto">${esc(ttl)}</h2>
            ${bar(Lv.pct, LX('xpp.toNext'))}
            <p class="muted small">${L('xpp.heroLine', { into: fmt(Lv.into), need: fmt(Lv.need), left: fmt(Lv.need - Lv.into), n: Lv.n + 1, name: V.levelLabel(G.levelName(Lv.n + 1)) })}</p>
          </div>
        </section>
        <nav class="tabs xp-tabs" aria-label="${L('xpp.sections')}">${TABS.map(([k, l]) => `<a class="tab${k === tab ? ' active' : ''}" href="#/xp${k ? `?tab=${k}` : ''}"${k === tab ? ' aria-current="page"' : ''}>${L(l)}</a>`).join('')}</nav>
        ${body}
      </div>`;
    bind(root, params);
  };

  function bind(root, params) {
    const rerender = () => V.render(root, params);
    const more = root.querySelector('[data-action=more]');
    if (more) more.onclick = () => { histShown += HIST_PAGE; rerender(); };
    root.querySelectorAll('[data-look]').forEach((b) => {
      b.onclick = () => {
        const kind = b.dataset.look, v = b.dataset.v;
        S.commit(LX('xpp.u.look'), (st) => { G.ensure(st).look[kind] = v || undefined; });
        V.applyLook(); paintChip(); rerender();
        if (kind === 'sound' && v) chime(false);
        const back = root.querySelector(`[data-look="${kind}"][data-v="${CSS.escape(v)}"]`);
        if (back) back.focus();
      };
    });
    const ttl = root.querySelector('[data-title]');
    if (ttl) ttl.onchange = () => { S.commit(LX('xpp.u.title'), (st) => { G.ensure(st).look.title = ttl.value || undefined; }); paintChip(); rerender(); const x = root.querySelector('[data-title]'); if (x) x.focus(); };
    const add = root.querySelector('[data-padd]');
    if (add) add.onsubmit = (e) => {
      e.preventDefault();
      const name = add.name.value.trim(), cost = Math.round(Number(add.cost.value));
      if (!name || !(cost >= 10)) return;
      S.commit(LX('xpp.u.addPrize'), (st) => { G.ensure(st).prizes.push({ id: u.uid(), name, cost }); });
      rerender();
      const x = root.querySelector('[data-padd] [name=name]'); if (x) x.focus();
    };
    root.querySelectorAll('[data-pdel]').forEach((b) => {
      b.onclick = async () => {
        const p = S.state.game.prizes.find((x) => x.id === b.dataset.pdel);
        if (!p || !(await CT.ui.confirm(LX('xpp.delPrizeQ', { name: CT.i18n.iso(p.name) }), LX('cp.deleteOk'), true, { localized: true }))) return;
        S.commit(LX('xpp.u.delPrize'), (st) => { st.game.prizes = st.game.prizes.filter((x) => x.id !== p.id); });
        rerender();
      };
    });
    root.querySelectorAll('[data-redeem]').forEach((b) => {
      b.onclick = async () => {
        const p = S.state.game.prizes.find((x) => x.id === b.dataset.redeem);
        if (!p) return;
        if (!(await CT.ui.confirm(LX('xpp.redeemQ', { name: CT.i18n.iso(p.name), n: fmt(p.cost) }), LX('xpp.redeem'), false, { localized: true }))) return;
        let ok = null;
        // no undo snapshot: a redemption is final
        S.commit(LX('xpp.u.redeem'), (st) => { ok = G.redeem(st, p.id); }, { undo: false });
        if (ok) celebrate({ big: u.icon.award, kicker: LX('xpp.cel.kicker'), heading: p.name, text: LX('xpp.cel.text', { n: fmt(p.cost) }), button: LX('xpp.cel.btn') });
        else CT.ui.toast(LX('xpp.noBalance'));
        rerender();
      };
    });
  }

  /* ---------- notices for the notification center (js/notify.js): pause, "at risk", deductions (always gentle) ---------- */
  const SEEN_KEY = 'ct.penSeen';
  const seenPen = () => { try { return localStorage.getItem(SEEN_KEY) || ''; } catch (e) { return ''; } };
  const nextItem = () => { const a = CT.stats.nextActions(S.activeCourses())[0]; return a ? a.item : null; };

  /** Data only (the center renders and translates it): null | pause | pen | risk. Same rules as the old home banner. */
  V.noticeData = (now = new Date()) => {
    if (!on() || !S.state.game) return null;
    const st = S.state, gm = st.game;
    const pause = G.activePause(gm);
    if (pause) return { type: 'pause', reason: pause.reason || '', from: pause.from || '', to: pause.to || '' };
    const pens = gm.ledger.filter((e) => e.t === 'pen');
    const unseen = pens.slice(pens.findIndex((x) => x.id === seenPen()) + 1).filter((e) => e.d >= u.addDays(G.dayKey(), -7));
    const lastPen = unseen[unseen.length - 1];
    if (lastPen) return { type: 'pen', count: unseen.length, points: fmt(-u.sum(unseen, (e) => e.p)), lastId: lastPen.id, day: lastPen.d };
    const risk = now.getHours() >= 16 || now.getHours() < G.DAY_START_HOUR ? G.atRisk(st, now) : null;
    if (risk) {
      const it = nextItem();
      return { type: 'risk', penOn: !!risk.penOn, minItems: risk.need ? risk.need.minItems : 0, minMinutes: risk.need ? risk.need.minMinutes : 0,
        freezesLeft: risk.freezesLeft || 0, streak: risk.streak || 0, day: G.dayKey(now), itemId: it && CT.focus ? it.id : '' };
    }
    return null;
  };
  /** "הבנתי" on a deduction notice: device-local, like before. */
  V.penSeen = (id) => { try { localStorage.setItem(SEEN_KEY, id); } catch (_) { /* ignore */ } };
  document.addEventListener('click', (e) => {
    const a = e.target.closest('[data-game-act]');
    if (!a) return;
    const act = a.dataset.gameAct;
    if (act === 'pen-seen') { V.penSeen(a.dataset.id); CT.app.rerender(); }
    if (act === 'resume') S.commit(CT.i18n.tx('xps.u.resume'), (st) => G.resume(st));
    if (act === 'five' && CT.focus) CT.focus.start(a.dataset.id, 5);
    if (act === 'pause') {
      const box = a.closest('.game-settings');
      const reason = box.querySelector('[name=pause-reason]').value;
      const until = box.querySelector('[name=pause-until]').value;
      S.commit(CT.i18n.tx('xps.u.pause'), (st) => G.pause(st, reason, until));
      CT.ui.toast(CT.i18n.tx('xps.pauseToast'));
    }
    if (act === 'defaults') {
      CT.ui.confirm(CT.i18n.tx('xps.defaultsQ'), CT.i18n.tx('xps.defaultsOk'), false, { localized: true }).then((ok) => {
        if (ok) S.commit(CT.i18n.tx('xps.u.defaults'), (st) => { G.ensure(st).cfg = {}; delete st.game.penaltyFrom; });
      });
    }
  });

  /* ---------- settings section (rendered inside the settings center; translated) ---------- */
  const SEVERITY = { gentle: { amount: 5, capDay: 5, capWeek: 15 }, normal: { amount: 15, capDay: 15, capWeek: 45 }, firm: { amount: 25, capDay: 25, capWeek: 75 } };
  const sevOf = (pen) => Object.keys(SEVERITY).find((k) => ['amount', 'capDay', 'capWeek'].every((f) => SEVERITY[k][f] === pen[f])) || 'custom';
  const num = (path, key, v, min, max) => `<label class="field"><span>${CT.i18n.t(key)}</span><input type="number" inputmode="numeric" min="${min}" max="${max}" data-game="${path}" value="${esc(v)}"></label>`;

  V.settingsHTML = () => {
    const I = CT.i18n, t = I.t;
    const st = S.state;
    const gm = G.ensure(st);
    const cfg = G.cfg(st), p = cfg.pts, pen = cfg.penalty;
    const pause = G.activePause(gm);
    const sev = sevOf(pen);
    const reason = (k) => t('xp.reason.' + k);
    return `<section class="card game-settings">
      <h2>${t('xps.title')}</h2>
      <div class="form-grid">
        <label class="check-field"><input type="checkbox" data-game="enabled"${cfg.enabled !== false ? ' checked' : ''}> ${t('xps.on')}</label>
        <label class="check-field"><input type="checkbox" data-game="extras"${cfg.extras !== false ? ' checked' : ''}> ${t('xps.extras')}</label>
      </div>
      <h3>${t('xps.worth')}</h3>
      <div class="form-grid game-grid">
        ${num('pts.easy', 'xps.easy', p.easy, 0, 200)}${num('pts.normal', 'xps.normal', p.normal, 0, 200)}${num('pts.hard', 'xps.hard', p.hard, 0, 300)}
        ${num('pts.per10min', 'xps.per10', p.per10min, 0, 50)}${num('pts.adk', 'xps.adk', p.adk, 0, 50)}
      </div>
      <h3>${t('xps.goals')}</h3>
      <div class="form-grid game-grid">
        ${num('goals.day.items', 'xps.dayItems', cfg.goals.day.items, 1, 50)}${num('goals.day.minutes', 'xps.dayMin', cfg.goals.day.minutes, 5, 600)}
        ${num('goals.week.items', 'xps.weekItems', cfg.goals.week.items, 1, 200)}${num('goals.week.minutes', 'xps.weekMin', cfg.goals.week.minutes, 30, 4000)}
      </div>
      <label class="field"><span>${t('xps.nudges')}</span><select data-game="reminders">
        ${['off', 'low', 'normal'].map((k) => `<option value="${k}" ${cfg.reminders === k ? 'selected' : ''}>${t('xps.nudge.' + k)}</option>`).join('')}
      </select></label>

      <h3>${t('xps.pen')}</h3>
      <p class="muted small">${t('xps.penHint', { n: pen.graceDays })}</p>
      <div class="form-grid">
        <label class="check-field"><input type="checkbox" data-game="penalty.enabled"${pen.enabled ? ' checked' : ''}> ${t('xps.penOn')}</label>
        <label class="field"><span>${t('xps.sev')}</span><select data-game="severity" ${pen.enabled ? '' : 'disabled'}>
          ${Object.entries(SEVERITY).map(([k, v]) => `<option value="${k}" ${sev === k ? 'selected' : ''}>${t('xps.sev.' + k, { day: v.capDay, week: v.capWeek })}</option>`).join('')}
          ${sev === 'custom' ? `<option value="custom" selected>${t('xps.sev.custom', { day: pen.amount, week: pen.capWeek })}</option>` : ''}
        </select></label>
      </div>
      <div class="form-grid game-grid">
        ${num('penalty.minItems', 'xps.minItems', pen.minItems, 1, 20)}${num('penalty.minMinutes', 'xps.minMin', pen.minMinutes, 5, 300)}
        ${num('penalty.freezesPerMonth', 'xps.freezes', pen.freezesPerMonth, 0, 10)}
      </div>
      <p class="muted small">${t('xps.freezeHint')}</p>

      <h3>${t('xps.pause')}</h3>
      ${pause ? `<p>${t(pause.to ? 'xps.pausedTo' : 'xps.paused', { from: CT.ui.date(pause.from, 'full'), to: pause.to ? CT.ui.date(pause.to, 'full') : '', reason: G.PAUSE_REASONS[pause.reason] ? CT.i18n.tx('xp.reason.' + pause.reason) : '' })}</p><button class="btn" data-game-act="resume">${t('xps.resume')}</button>`
        : `<p class="muted small">${t('xps.pauseHint')}</p>
        <div class="form-grid game-grid">
          <label class="field"><span>${t('xps.reason')}</span><select name="pause-reason">${Object.keys(G.PAUSE_REASONS).map((k) => `<option value="${k}">${reason(k)}</option>`).join('')}</select></label>
          <label class="field"><span>${t('xps.until')}</span><input type="date" name="pause-until" data-keep="xp-pause-until" min="${G.dayKey()}"></label>
        </div>
        <button class="btn" data-game-act="pause">${t('xps.pauseBtn')}</button>`}
      <div class="btn-row"><button class="btn btn-ghost" data-game-act="defaults">${t('xps.defaults')}</button></div>
    </section>`;
  };

  const setPath = (obj, path, v) => {
    const ks = path.split('.');
    let o = obj;
    ks.slice(0, -1).forEach((k) => { if (typeof o[k] !== 'object' || !o[k]) o[k] = {}; o = o[k]; });
    o[ks[ks.length - 1]] = v;
  };
  V.onSettingsChange = (t) => {
    const path = t.dataset.game;
    if (path === 'penalty.enabled') {
      S.commit(CT.i18n.tx(t.checked ? 'xps.u.penOn' : 'xps.u.penOff'), (st) => G.setPenalties(st, t.checked));
      CT.ui.toast(CT.i18n.tx(t.checked ? 'xps.penOnToast' : 'xps.penOffToast'));
      return;
    }
    if (path === 'severity') {
      const sv = SEVERITY[t.value];
      if (sv) S.commit(CT.i18n.tx('xps.u.sev'), (st) => { const c = G.ensure(st).cfg; c.penalty = Object.assign({}, c.penalty, { amount: sv.amount, capDay: sv.capDay, capWeek: sv.capWeek }); });
      return;
    }
    let v;
    if (t.type === 'checkbox') v = t.checked;
    else if (t.type === 'number') {
      const n = Math.round(Number(t.value));
      if (!isFinite(n) || t.value === '') return;
      v = u.clamp(n, Number(t.min), Number(t.max));
    } else v = t.value;
    S.commit(CT.i18n.tx('xps.u.cfg'), (st) => setPath(G.ensure(st).cfg, path, v));
  };

  /* ---------- gentle in-site reminders ---------- */
  const NUDGE_KEY = 'ct.nudge';
  function nudgeTick() {
    const st = S.state;
    if (!st || !st.game || !on() || document.visibilityState !== 'visible') return;
    if (CT.focus && CT.focus.active && CT.focus.active()) return;
    if (document.querySelector('.modal-backdrop, .lvl-up')) return;
    const cfg = G.cfg(st), mode = cfg.reminders;
    if (mode === 'off' || G.activePause(st.game)) return;
    const now = new Date(), day = G.dayKey(now), h = now.getHours();
    if (h < 10 && h >= G.DAY_START_HOUR) return; // no nudges in the morning
    let n = {};
    try { n = JSON.parse(localStorage.getItem(NUDGE_KEY)) || {}; } catch (e) { n = {}; }
    if (n.day !== day) n = { day, count: 0, last: 0 };
    const recentXP = st.game.ledger.some((e) => e.p > 0 && Date.now() - Date.parse(e.at) < 2 * 3600e3);
    const ok = mode === 'low'
      ? n.count < 1 && (h >= 16 || h < G.DAY_START_HOUR) && !G.minimumMet(G.dayStats(st.game.ledger, day), cfg.penalty)
      : n.count < 3 && Date.now() - n.last > 2 * 3600e3 && !recentXP;
    if (!ok) return;
    const it = nextItem();
    if (!it) return;
    n.count++; n.last = Date.now();
    try { localStorage.setItem(NUDGE_KEY, JSON.stringify(n)); } catch (e) { /* ignore */ }
    CT.ui.toast(LX('xpp.nudge', { name: CT.i18n.iso(it.title) }), { ms: 12000, action: CT.focus ? { label: LX('xpp.just5'), fn: () => CT.focus.start(it.id, 5) } : null });
  }
  setTimeout(() => { nudgeTick(); setInterval(nudgeTick, 60000); }, 20000);

  CT.views.xp = V;
})(window.CT);
