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

  const fmt = (n) => Math.round(n).toLocaleString('he-IL');
  const signed = (n) => (n > 0 ? `+${fmt(n)}` : n < 0 ? `−${fmt(-n)}` : '0');
  const motionOk = () => !(CT.app && CT.app.reducedMotion && CT.app.reducedMotion());
  const look = () => (S.state.game && S.state.game.look) || {};
  const on = () => G.cfg(S.state).enabled !== false;

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
    wrap.setAttribute('aria-label', `${kicker} ${heading}`);
    wrap.innerHTML = `
      <div class="lvl-card">
        ${motionOk() ? '<div class="lvl-burst" aria-hidden="true">' + Array.from({ length: 14 }, (_, i) => `<i style="--a:${i * (360 / 14)}deg;--d:${i % 3}"></i>`).join('') + '</div>' : ''}
        <div class="lvl-badge" aria-hidden="true">${big}</div>
        <p class="lvl-kicker">${esc(kicker)}</p>
        <h2>${esc(heading)}</h2>
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
    if (badges.length) pop(`${badges[0].icon || '🏅'} הישג חדש: ${badges[0].label}`, `${signed(g)} XP${badges.length > 1 ? ` · ועוד ${badges.length - 1}` : ''}`, 'badge');
    else if (goal) pop(`🎯 ${goal.label} הושג!`, `${signed(g)} XP`, 'goal');
    else if (chal) pop('⚡ האתגר היומי הושלם!', `${signed(g)} XP`, 'goal');
    else if (g > 0) {
      const top = gained.slice().sort((a, b) => b.p - a.p)[0];
      pop(`${signed(g)} XP`, (top.why || []).join(' · '));
    } else if (l > 0) {
      pop(`${signed(-l)} XP`, 'הנקודות על זה הוחזרו — אפשר לצבור שוב כשמסיימים');
    }
    if (g > 0) chime(false);
    if (r.added.some((e) => e.t === 'pen') && CT.app) CT.app.rerender(); // shows the gentle notice on the home screen
    if (r.level.n > r.levelBefore) {
      const unlocked = G.UNLOCKS.filter((x) => x.level > r.levelBefore && x.level <= r.level.n).map((x) => x.name);
      setTimeout(() => celebrate({
        big: r.level.n, kicker: 'עלית רמה!', heading: r.level.name,
        text: `רמה ${r.level.n}. ${unlocked.length ? `נפתח: ${unlocked.join(', ')}. ` : ''}עוד ${fmt(r.level.need)} נקודות לרמה הבאה. כל הכבוד על ההתמדה.`,
        button: 'יאללה, ממשיכים',
      }), g > 0 ? 600 : 0);
    }
    paintChip();
  };

  /* ---------- small pieces ---------- */
  function bar(pct, label) {
    return `<div class="xp-bar" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${pct}"${label ? ` aria-label="${esc(label)}"` : ''}><div class="xp-fill" style="width:${Math.min(100, pct)}%"></div></div>`;
  }
  /** Two concentric rings: outer = items, inner = minutes, each toward its goal. */
  function goalRings(s, goal, size = 64) {
    const ring = (r, pct, cls) => {
      const c = 2 * Math.PI * r;
      return `<circle class="gr-bg" cx="${size / 2}" cy="${size / 2}" r="${r}"/><circle class="gr-fg ${cls}" cx="${size / 2}" cy="${size / 2}" r="${r}" stroke-dasharray="${c.toFixed(2)}" stroke-dashoffset="${(c * (1 - Math.min(1, pct))).toFixed(2)}" transform="rotate(-90 ${size / 2} ${size / 2})"/>`;
    };
    const pi = s.items / goal.items, pm = s.minutes / goal.minutes;
    return `<svg class="goal-rings${G.goalMet(s, goal) ? ' met' : ''}" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" role="img"
        aria-label="${s.items} מתוך ${goal.items} פריטים, ${s.minutes} מתוך ${goal.minutes} דקות">${ring(size / 2 - 5, pi, 'gr-items')}${ring(size / 2 - 14, pm, 'gr-min')}</svg>`;
  }
  const goalLine = (s, goal) => `<span class="gl-i">${Math.min(s.items, 99)}/${goal.items} פריטים</span> · <span class="gl-m">${fmt(s.minutes)}/${goal.minutes} דק׳</span>`;

  /* ---------- home screen card + sidebar chip ---------- */
  V.cardHTML = () => {
    if (!on()) return '';
    V.applyLook();
    const st = S.state, cfg = G.cfg(st), day = G.dayKey();
    const s = G.summary(st);
    const L = s.level;
    const mult = G.multiplier(cfg, s.streak.today ? s.streak.days : s.streak.days + 1);
    const extras = cfg.extras !== false;
    const ds = extras ? G.dayStats(st.game.ledger, day) : null;
    const ch = extras ? G.challenge(day) : null;
    const chDone = extras && st.game.ledger.some((e) => e.k === `chal:${day}` && e.t === 'chal') && ch.test(ds);
    return `<a href="#/xp" class="card xp-card lift" aria-label="רמה ${L.n}, ${esc(L.name)}. ${fmt(L.into)} מתוך ${fmt(L.need)} נקודות לרמה הבאה. לפרטים">
        <div class="xp-top">
          <span class="xp-lvl${frameCls()}" aria-hidden="true">${L.n}</span>
          <span class="xp-name"><span class="muted small">רמה ${L.n}</span><b>${esc(title(L))}</b></span>
          <span class="xp-today"><b>${signed(s.today)}</b><span class="muted small">היום</span></span>
        </div>
        ${bar(L.pct)}
        <div class="xp-foot muted small"><span>${fmt(L.into)} / ${fmt(L.need)} לרמה ${L.n + 1}</span>${mult > 1 ? `<span class="xp-mult">רצף ×${mult}</span>` : ''}</div>
        ${extras ? `<div class="xp-goal">
          ${goalRings(ds, cfg.goals.day, 44)}
          <div class="xp-goal-t"><b>${G.goalMet(ds, cfg.goals.day) ? '🎯 יעד היום הושג' : 'יעד היום'}</b><span class="muted small">${goalLine(ds, cfg.goals.day)}</span></div>
        </div>
        <div class="xp-chal${chDone ? ' done' : ''}"><span aria-hidden="true">${chDone ? '✓' : '⚡'}</span><span><span class="muted small">אתגר היום:</span> ${esc(ch.name)}</span></div>` : ''}
      </a>`;
  };

  V.chipHTML = () => {
    if (!on()) return '';
    V.applyLook();
    const L = G.summary(S.state).level;
    return `<a href="#/xp" class="sb-xp" id="sb-xp" aria-label="${CT.i18n.t('xp.chip', { n: L.n, title: title(L) })}"><span class="sb-xp-n${frameCls()}">${L.n}</span><span class="sb-xp-t"><b dir="auto">${esc(title(L))}</b>${bar(L.pct)}</span></a>`;
  };
  function paintChip() {
    const el = document.getElementById('sb-xp');
    if (el) el.outerHTML = V.chipHTML();
  }

  if (CT.views.dashboard) CT.views.dashboard.slots.side.push(V.cardHTML);

  /* ---------- page: overview ---------- */
  const TYPE_LABEL = { item: 'סיום פריט', review: 'צריך לחזור', study: 'זמן לימוד', note: 'הערה', course: 'סיום קורס', start: 'התחלה', sub: 'תת-משימה', goal: 'יעד', chal: 'אתגר', badge: 'הישג', redeem: 'פרס', pen: 'ניכוי', rev: 'ביטול' };

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
      ['"רק 5 דקות"', `+${p.start}`, `על עצם ההתחלה. פעם ביום לכל פריט, עד ${cfg.caps.start} ביום.`],
      ['תת-משימה', `+${p.sub}`, `לכל צעד שמסמנים. עד ${cfg.caps.sub} ביום.`],
      ['יעד יומי / שבועי', `+${p.goalDay} / +${p.goalWeek}`, `${cfg.goals.day.items} פריטים או ${cfg.goals.day.minutes} דק׳ ביום; ${cfg.goals.week.items} פריטים או ${cfg.goals.week.minutes} דק׳ בשבוע (מיום ראשון).`],
      ['אתגר יומי', `+${p.challenge}`, 'אתגר קטן אחד ביום, מתחלף כל יום.'],
      ['הישג חדש', `+${p.badge}`, 'הישגים נשארים לתמיד.'],
      ['מכפיל רצף', cfg.streak.map(([d, x]) => `<span class="nw">${d}+ ימים ×${x}</span>`).join(' '), 'על סיום פריטים. רצף = ימים רצופים עם נקודות.'],
    ];
    return `<table class="xp-rules"><tbody>${rows.map(([a, b, c]) => `<tr><th scope="row">${a}</th><td class="num">${b}</td><td class="muted small">${c}</td></tr>`).join('')}</tbody></table>
      <p class="muted small">ביטול סימון מחזיר בדיוק את מה שניתן, וסימון מחדש מחזיר אותו — אף פעם לא כפול. תקרה יומית לסיום פריטים: ${cfg.caps.item}. היום מתחלף ב-04:00, כך שעבודה בלילה נספרת ליום שלה. יעד של יום שעבר כבר לא משתנה. מה שהיה מסומן לפני שהופעלו הנקודות לא נספר.</p>`;
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
    return `
      <div class="stat-cards">
        <div class="card stat"><b>${fmt(s.earned)}</b><span>סה״כ נקודות</span></div>
        <div class="card stat"><b>${signed(s.today)}</b><span>היום</span></div>
        <div class="card stat"><b>${signed(week)}</b><span>7 ימים אחרונים</span></div>
        <div class="card stat"><b>${s.streak.days}</b><span>${s.streak.days === 1 ? 'יום רצף' : 'ימי רצף'}${s.streak.days && !s.streak.today ? ' — אפשר להמשיך היום' : ''}</span></div>
      </div>
      ${extras ? `<div class="xp-two">
        <section class="card goals-card" aria-labelledby="goals-h">
          <div class="card-head"><h2 id="goals-h">יעדים</h2><span class="muted small">פריטים או דקות — מה שמגיע קודם</span></div>
          <div class="goal-row">${goalRings(ds, cfg.goals.day)}<div><b>היום${G.goalMet(ds, cfg.goals.day) ? ' · הושג 🎯' : ''}</b><p class="muted small">${goalLine(ds, cfg.goals.day)}${G.goalPerfect(ds, cfg.goals.day) ? ' · יום מושלם ☀️' : ''}</p></div></div>
          <div class="goal-row">${goalRings(ws, cfg.goals.week)}<div><b>השבוע${G.goalMet(ws, cfg.goals.week) ? ' · הושג 🎯' : ''}</b><p class="muted small">${goalLine(ws, cfg.goals.week)}</p></div></div>
          <p class="muted small gr-legend"><span class="gl-i">●</span> פריטים · <span class="gl-m">●</span> דקות</p>
        </section>
        <section class="card chal-card${chDone ? ' done' : ''}" aria-labelledby="chal-h">
          <div class="card-head"><h2 id="chal-h">אתגר היום</h2><span class="muted small num-ltr">+${cfg.pts.challenge}</span></div>
          <p class="chal-name">${chDone ? '✓ ' : '⚡ '}${esc(ch.name)}</p>
          <p class="muted small">${chDone ? 'הושלם. מחר יש אתגר חדש.' : 'אתגר קטן אחד, מתחלף כל יום. לא חובה — רק כיף.'}</p>
          <h3>עונה${sem ? `: ${esc(sem.name)}` : ''}</h3>
          <p class="muted small">כל סמסטר הוא עונה: הניקוד שלה מתחיל מאפס, והרמה וההישגים נשארים.</p>
          ${seasons.length ? `<ul class="season-list">${seasons.map((r) => `<li${sem && r.x.id === sem.id ? ' class="cur"' : ''}><span>${esc(r.x.name)}</span><b>${fmt(r.xp)}</b></li>`).join('')}</ul>` : ''}
        </section>
      </div>` : ''}
      <details class="card dash-more"${gm.ledger.length ? '' : ' open'}>
        <summary><span class="dm-title">איך צוברים נקודות</span><span class="muted small dm-hint">כל הערכים והכללים</span><span class="dm-chev" aria-hidden="true">${u.icon.chev}</span></summary>
        <div class="dm-body">${rulesHTML(cfg)}</div>
      </details>`;
  }

  /* ---------- page: badges ---------- */
  function badgesHTML(st) {
    const got = G.badgesEarned(st);
    return `<p class="muted">${got.size} מתוך ${G.BADGES.length} הישגים. הישג שהושג נשאר לתמיד. שלושה מהם סודיים.</p>
      <ul class="badges">${G.BADGES.map((b) => {
        const e = got.get(b.id);
        const hidden = b.secret && !e;
        return `<li class="badge${e ? ' got' : ''}${hidden ? ' secret' : ''}">
          <span class="b-ic" aria-hidden="true">${hidden ? '🔒' : b.icon}</span>
          <b>${hidden ? 'הישג סודי' : esc(b.name)}</b>
          <span class="muted small">${hidden ? 'יתגלה כשיושג' : esc(b.desc)}</span>
          ${e ? `<span class="b-date small">${u.fmtDateFull(e.d)}</span>` : ''}
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
    const pick = (kind, label, opts) => `<div class="pick"><h3>${label}</h3><div class="pick-row" role="group" aria-label="${label}">
        <button class="pick-btn${!lk[kind] ? ' on' : ''}" data-look="${kind}" data-v="" aria-pressed="${!lk[kind]}">רגיל</button>
        ${opts.map((x) => {
          const open = x.level <= lvl;
          return `<button class="pick-btn${lk[kind] === x.value ? ' on' : ''}${open ? '' : ' locked'}" data-look="${kind}" data-v="${esc(x.value)}" ${open ? '' : 'disabled'} aria-pressed="${lk[kind] === x.value}"
            >${kind === 'accent' ? `<span class="sw sw-${esc(x.value)}" aria-hidden="true"></span>` : ''}${kind === 'frame' ? `<span class="xp-lvl mini frame-${esc(x.value)}" aria-hidden="true">${lvl}</span>` : ''}${esc(x.name.split(': ')[1] || x.name)}${open ? '' : ` <span class="small">· רמה ${x.level}</span>`}</button>`;
        }).join('')}</div></div>`;
    return `
      <section class="card prize-card" aria-labelledby="pp-h">
        <div class="card-head"><h2 id="pp-h">פרסים אישיים</h2><span class="balance">יתרה: <b>${fmt(bal)}</b> נקודות</span></div>
        <p class="muted small">קבעו לעצמכם פרסים אמיתיים (פיצה, ערב סרט, משחק…) ומחיר בנקודות. "ממש" מוריד מהיתרה — לא מהרמה — ונרשם ביומן. מימוש לא מתבטל.</p>
        ${gm.prizes.length ? `<ul class="prizes">${gm.prizes.map((p) => `<li>
            <span class="pz-name" dir="auto">${esc(p.name)}</span>
            <span class="pz-cost">${fmt(p.cost)}</span>
            ${bar(Math.round(Math.min(1, bal / p.cost) * 100), `התקדמות ל${p.name}`)}
            <button class="btn btn-small ${bal >= p.cost ? 'btn-primary' : ''}" data-redeem="${esc(p.id)}" ${bal >= p.cost ? '' : 'disabled'}>${bal >= p.cost ? 'ממש' : `עוד ${fmt(p.cost - bal)}`}</button>
            <button class="icon-btn" data-pdel="${esc(p.id)}" aria-label="מחק פרס: ${esc(p.name)}">${u.icon.trash}</button></li>`).join('')}</ul>` : '<p class="muted">עוד אין פרסים. הוסיפו אחד למטה.</p>'}
        <form class="prize-add" data-padd>
          <input name="name" dir="auto" maxlength="60" placeholder="פרס (למשל: ערב סרט)" aria-label="שם הפרס" required>
          <input name="cost" type="number" min="10" max="100000" step="10" placeholder="נקודות" aria-label="מחיר בנקודות" required>
          <button class="btn">${u.icon.plus}<span>הוסף</span></button>
        </form>
        ${redeemed.length ? `<h3>מומשו</h3><ul class="redeemed">${redeemed.map((e) => `<li><span dir="auto">${esc(e.label)}</span><span class="muted small">${u.fmtDateFull(e.d)}</span><b>${signed(e.p)}</b></li>`).join('')}</ul>` : ''}
      </section>
      <section class="card" aria-labelledby="site-h">
        <div class="card-head"><h2 id="site-h">פרסים באתר</h2><span class="muted small">נפתחים לפי רמה, בלי להוריד נקודות</span></div>
        ${pick('accent', 'צבע ראשי', unlock('accent'))}
        ${pick('frame', 'מסגרת לרמה', unlock('frame'))}
        <div class="pick"><h3>תואר</h3><label class="field inline"><span class="muted small">מוצג במקום שם הרמה</span>
          <select data-title><option value="">שם הרמה הנוכחית</option>${G.titles(st).map((t) => `<option ${lk.title === t ? 'selected' : ''}>${esc(t)}</option>`).join('')}</select></label></div>
        ${pick('sound', 'צליל משוב', unlock('sound'))}
        <p class="muted small">הצלילים נשמעים רק אם "צלילי משוב" מופעל ב<a href="#/settings">הגדרות</a>.</p>
      </section>`;
  }

  /* ---------- page: log ---------- */
  function historyHTML(ledger) {
    const list = ledger.slice().reverse().filter((e) => e.p !== 0 || (e.why || []).includes('תקרה יומית'));
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
    return `<ul class="xp-hist">${rows}</ul>${list.length > histShown ? '<button class="btn btn-ghost btn-small more-btn" data-action="more">הצג עוד</button>' : ''}`;
  }
  function dayTitle(d) {
    const t = G.dayKey();
    if (d === t) return 'היום';
    if (d === u.addDays(t, -1)) return 'אתמול';
    return `${u.DAYS[u.parseDate(d).getDay()]} ${u.fmtDateFull(d)}`;
  }

  /* ---------- page ---------- */
  const TABS = [['', 'סקירה'], ['badges', 'הישגים'], ['prizes', 'פרסים'], ['log', 'יומן']];

  V.render = (root, params = {}) => {
    const st = S.state;
    if (!st.game) G.ensure(st);
    const cfg = G.cfg(st);
    const s = G.summary(st);
    const L = s.level;
    const tab = TABS.some(([k]) => k === params.tab) ? params.tab : '';
    const body = tab === 'badges' ? badgesHTML(st) : tab === 'prizes' ? prizesHTML(st)
      : tab === 'log' ? `<section class="card"><div class="card-head"><h2>יומן נקודות</h2><span class="muted small">${st.game.ledger.length} רשומות</span></div>${historyHTML(st.game.ledger)}</section>`
        : overviewHTML(st, cfg, s);
    V.applyLook();
    root.innerHTML = `
      <div class="xp-page">
        <h1>נקודות ורמות</h1>
        <p class="muted xp-intro">נקודות על התקדמות אמיתית: סיום פריטים, זמן לימוד, הערות ויעדים. כל נקודה נרשמת ביומן, עם הסיבה.</p>
        ${cfg.enabled === false ? '<div class="banner banner-info">הנקודות כבויות. אפשר להפעיל אותן ב<a href="#/settings">הגדרות</a>.</div>' : ''}
        <section class="card xp-hero">
          <span class="xp-lvl xp-lvl-lg${frameCls()}" aria-hidden="true">${L.n}</span>
          <div class="xp-hero-main">
            <p class="muted small">רמה ${L.n}${title(L) !== L.name ? ` · ${esc(L.name)}` : ''}</p>
            <h2>${esc(title(L))}</h2>
            ${bar(L.pct, 'התקדמות לרמה הבאה')}
            <p class="muted small">${fmt(L.into)} / ${fmt(L.need)} — עוד ${fmt(L.need - L.into)} לרמה ${L.n + 1} (${esc(G.levelName(L.n + 1))})</p>
          </div>
        </section>
        <nav class="tabs xp-tabs" aria-label="חלקי הדף">${TABS.map(([k, l]) => `<a class="tab${k === tab ? ' active' : ''}" href="#/xp${k ? `?tab=${k}` : ''}"${k === tab ? ' aria-current="page"' : ''}>${l}</a>`).join('')}</nav>
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
        S.commit('בחירת פרס באתר', (st) => { G.ensure(st).look[b.dataset.look] = b.dataset.v || undefined; });
        V.applyLook(); paintChip(); rerender();
        if (b.dataset.look === 'sound' && b.dataset.v) chime(false);
      };
    });
    const ttl = root.querySelector('[data-title]');
    if (ttl) ttl.onchange = () => { S.commit('בחירת תואר', (st) => { G.ensure(st).look.title = ttl.value || undefined; }); paintChip(); rerender(); };
    const add = root.querySelector('[data-padd]');
    if (add) add.onsubmit = (e) => {
      e.preventDefault();
      const name = add.name.value.trim(), cost = Math.round(Number(add.cost.value));
      if (!name || !(cost >= 10)) return;
      S.commit('הוספת פרס', (st) => { G.ensure(st).prizes.push({ id: u.uid(), name, cost }); });
      rerender();
    };
    root.querySelectorAll('[data-pdel]').forEach((b) => {
      b.onclick = async () => {
        const p = S.state.game.prizes.find((x) => x.id === b.dataset.pdel);
        if (!p || !(await CT.ui.confirm(`למחוק את הפרס "${p.name}" מהרשימה? (מימושים קודמים נשארים ביומן)`, 'מחק', true))) return;
        S.commit('מחיקת פרס', (st) => { st.game.prizes = st.game.prizes.filter((x) => x.id !== p.id); });
        rerender();
      };
    });
    root.querySelectorAll('[data-redeem]').forEach((b) => {
      b.onclick = async () => {
        const p = S.state.game.prizes.find((x) => x.id === b.dataset.redeem);
        if (!p) return;
        if (!(await CT.ui.confirm(`לממש את "${p.name}" ב-${fmt(p.cost)} נקודות?\nהיתרה תרד, הרמה לא. מימוש לא מתבטל.`, 'ממש'))) return;
        let ok = null;
        // no undo snapshot: a redemption is final
        S.commit('מימוש פרס', (st) => { ok = G.redeem(st, p.id); }, { undo: false });
        if (ok) celebrate({ big: '🎁', kicker: 'מגיע לך!', heading: p.name, text: `מימשת ב-${fmt(p.cost)} נקודות. שיהיה כיף — הרווחת את זה.`, button: 'תודה!' });
        else CT.ui.toast('אין מספיק נקודות ביתרה');
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
    if (act === 'resume') S.commit('חזרה מהשהיה', (st) => G.resume(st));
    if (act === 'five' && CT.focus) CT.focus.start(a.dataset.id, 5);
    if (act === 'pause') {
      const box = a.closest('.game-settings');
      const reason = box.querySelector('[name=pause-reason]').value;
      const until = box.querySelector('[name=pause-until]').value;
      S.commit('השהיה', (st) => G.pause(st, reason, until));
      CT.ui.toast('⏸️ מצב השהיה פעיל — בלי ניכויים, והרצף מחכה.');
    }
    if (act === 'defaults') {
      CT.ui.confirm('להחזיר את כל ערכי הנקודות, היעדים והניכויים לברירת המחדל? (הנקודות שכבר נצברו לא משתנות; ניכויים יכובו)', 'החזר').then((ok) => {
        if (ok) S.commit('ברירת מחדל לנקודות', (st) => { G.ensure(st).cfg = {}; delete st.game.penaltyFrom; });
      });
    }
  });

  /* ---------- settings section (rendered inside the settings page) ---------- */
  const SEVERITY = { gentle: { amount: 5, capDay: 5, capWeek: 15, label: 'עדין — 5 ביום, עד 15 בשבוע' }, normal: { amount: 15, capDay: 15, capWeek: 45, label: 'רגיל — 15 ביום, עד 45 בשבוע' }, firm: { amount: 25, capDay: 25, capWeek: 75, label: 'משמעותי — 25 ביום, עד 75 בשבוע' } };
  const sevOf = (pen) => Object.keys(SEVERITY).find((k) => ['amount', 'capDay', 'capWeek'].every((f) => SEVERITY[k][f] === pen[f])) || 'custom';
  const num = (path, label, v, min, max) => `<label class="field"><span>${label}</span><input type="number" inputmode="numeric" min="${min}" max="${max}" data-game="${path}" value="${v}"></label>`;

  V.settingsHTML = () => {
    const st = S.state;
    const gm = G.ensure(st);
    const cfg = G.cfg(st), p = cfg.pts, pen = cfg.penalty;
    const pause = G.activePause(gm);
    const sev = sevOf(pen);
    return `<section class="card game-settings">
      <h2>🎮 נקודות, יעדים וניכויים</h2>
      <div class="form-grid">
        <label class="check-field"><input type="checkbox" data-game="enabled"${cfg.enabled !== false ? ' checked' : ''}> נקודות ורמות פעילות</label>
        <label class="check-field"><input type="checkbox" data-game="extras"${cfg.extras !== false ? ' checked' : ''}> יעדים, אתגר יומי והישגים</label>
      </div>
      <h3>כמה שווה כל דבר</h3>
      <div class="form-grid game-grid">
        ${num('pts.easy', 'פריט קל', p.easy, 0, 200)}${num('pts.normal', 'פריט רגיל', p.normal, 0, 200)}${num('pts.hard', 'פריט קשה', p.hard, 0, 300)}
        ${num('pts.per10min', 'כל 10 דק׳ לימוד', p.per10min, 0, 50)}${num('pts.adk', 'אזכרות בוקר/ערב (השלמה)', p.adk, 0, 50)}
      </div>
      <h3>יעדים (פריטים <b>או</b> דקות)</h3>
      <div class="form-grid game-grid">
        ${num('goals.day.items', 'ביום — פריטים', cfg.goals.day.items, 1, 50)}${num('goals.day.minutes', 'ביום — דקות', cfg.goals.day.minutes, 5, 600)}
        ${num('goals.week.items', 'בשבוע — פריטים', cfg.goals.week.items, 1, 200)}${num('goals.week.minutes', 'בשבוע — דקות', cfg.goals.week.minutes, 30, 4000)}
      </div>
      <label class="field"><span>תזכורות עדינות באתר</span><select data-game="reminders">
        ${[['off', 'כבויות'], ['low', 'פעם ביום, אחה״צ, אם עוד לא התחלת'], ['normal', 'כל שעתיים בערך, עד 3 ביום']].map(([k, l]) => `<option value="${k}" ${cfg.reminders === k ? 'selected' : ''}>${l}</option>`).join('')}
      </select></label>

      <h3>ניכויים על יום מתחת למינימום</h3>
      <p class="muted small">כבויים עד שמפעילים. יורדים רק מה<b>יתרה</b> (שממנה מממשים פרסים) — לא מהרמה, לא מההישגים, ואף פעם לא מתחת ל-0. אף פעם לא רטרואקטיבי: נספר רק מהיום שבו הופעלו, אחרי ${pen.graceDays} ימי חסד מתחילת השימוש, ורק 7 הימים האחרונים נבדקים. כל ניכוי מופיע ביומן עם הסיבה.</p>
      <div class="form-grid">
        <label class="check-field"><input type="checkbox" data-game="penalty.enabled"${pen.enabled ? ' checked' : ''}> להפעיל ניכויים</label>
        <label class="field"><span>חומרה</span><select data-game="severity" ${pen.enabled ? '' : 'disabled'}>
          ${Object.entries(SEVERITY).map(([k, v]) => `<option value="${k}" ${sev === k ? 'selected' : ''}>${v.label}</option>`).join('')}
          ${sev === 'custom' ? `<option value="custom" selected>מותאם: ${pen.amount} ביום, עד ${pen.capWeek} בשבוע</option>` : ''}
        </select></label>
      </div>
      <div class="form-grid game-grid">
        ${num('penalty.minItems', 'מינימום — פריטים', pen.minItems, 1, 20)}${num('penalty.minMinutes', 'או דקות', pen.minMinutes, 5, 300)}
        ${num('penalty.freezesPerMonth', 'הקפאות רצף בחודש', pen.freezesPerMonth, 0, 10)}
      </div>
      <p class="muted small">הקפאה מכסה אוטומטית יום שהוחמץ — בלי ניכוי ובלי לשבור את הרצף.</p>

      <h3>מצב השהיה (מבחנים / מחלה / חופשה)</h3>
      ${pause ? `<p>⏸️ מושהה מ-${u.fmtDateFull(pause.from)}${pause.to ? ` עד ${u.fmtDateFull(pause.to)}` : ''} · ${esc(G.PAUSE_REASONS[pause.reason] || '')}</p><button class="btn" data-game-act="resume">חזרה לשגרה</button>`
        : `<p class="muted small">בזמן השהיה אין ניכויים, אין תזכורות, והרצף לא נשבר. הנקודות ממשיכות להיצבר כרגיל.</p>
        <div class="form-grid game-grid">
          <label class="field"><span>סיבה</span><select name="pause-reason">${Object.entries(G.PAUSE_REASONS).map(([k, l]) => `<option value="${k}">${l}</option>`).join('')}</select></label>
          <label class="field"><span>עד (לא חובה)</span><input type="date" name="pause-until" min="${G.dayKey()}"></label>
        </div>
        <button class="btn" data-game-act="pause">⏸️ השהה מהיום</button>`}
      <div class="btn-row"><button class="btn btn-ghost" data-game-act="defaults">החזר את כל הערכים לברירת המחדל</button></div>
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
      S.commit(t.checked ? 'הפעלת ניכויים' : 'כיבוי ניכויים', (st) => G.setPenalties(st, t.checked));
      CT.ui.toast(t.checked ? 'הניכויים פעילים מהיום. ימים קודמים לא נספרים.' : 'הניכויים כבויים.');
      return;
    }
    if (path === 'severity') {
      const sv = SEVERITY[t.value];
      if (sv) S.commit('חומרת ניכויים', (st) => { const c = G.ensure(st).cfg; c.penalty = Object.assign({}, c.penalty, { amount: sv.amount, capDay: sv.capDay, capWeek: sv.capWeek }); });
      return;
    }
    let v;
    if (t.type === 'checkbox') v = t.checked;
    else if (t.type === 'number') {
      const n = Math.round(Number(t.value));
      if (!isFinite(n) || t.value === '') return;
      v = u.clamp(n, Number(t.min), Number(t.max));
    } else v = t.value;
    S.commit('הגדרות נקודות', (st) => setPath(G.ensure(st).cfg, path, v));
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
    CT.ui.toast(`⏰ אולי ${it.title}? חמש דקות, ואז מחליטים.`, { ms: 12000, action: CT.focus ? { label: 'רק 5 דקות', fn: () => CT.focus.start(it.id, 5) } : null });
  }
  setTimeout(() => { nudgeTick(); setInterval(nudgeTick, 60000); }, 20000);

  CT.views.xp = V;
})(window.CT);
