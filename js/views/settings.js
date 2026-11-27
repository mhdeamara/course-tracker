/* views/settings.js — the settings center: categories (desktop: navigation + content; phone: list → category view),
 * a local search over every setting (Hebrew and English), and each setting's own controls. Fully translated; user
 * content (semester names, template rows, course and catalog names) is shown as typed. Every write goes through the
 * store (S.commit / S.replace), so the read-only lock (schema-guard) applies to all of them. */
(function (CT) {
  'use strict';
  const { u, ui } = CT;
  const S = CT.store, M = CT.model, I = CT.i18n;
  const esc = u.esc, icon = u.icon;
  const t = (k, p) => I.t(k, p), tx = (k, p) => I.tx(k, p);
  const th = (k, p) => I.th(k, p); // markup parameters only through I.html / I.bdi / I.ltr
  const V = {};
  CT.views = CT.views || {};
  CT.views.settings = V;

  // icons the shared set does not have (same 24px stroke style)
  const svg = (d) => `<svg class="ic" viewBox="0 0 24 24" aria-hidden="true" focusable="false">${d}</svg>`;
  const IC = {
    globe: svg('<circle cx="12" cy="12" r="9"></circle><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"></path>'),
    palette: svg('<path d="M12 3a9 9 0 1 0 0 18c1.1 0 1.6-.9 1.2-1.8-.5-1-.2-2.2 1-2.2H17a4 4 0 0 0 4-4c0-5.5-4-10-9-10z"></path><circle cx="7.5" cy="11" r="1"></circle><circle cx="10" cy="7" r="1"></circle><circle cx="15" cy="7.5" r="1"></circle>'),
    db: svg('<ellipse cx="12" cy="5.5" rx="7.5" ry="2.5"></ellipse><path d="M4.5 5.5v13c0 1.4 3.4 2.5 7.5 2.5s7.5-1.1 7.5-2.5v-13M4.5 12c0 1.4 3.4 2.5 7.5 2.5s7.5-1.1 7.5-2.5"></path>'),
    moon: icon.moon,
  };

  /** Categories, in order. `ic` is the icon HTML. */
  const CATS = [
    { id: 'appearance', ic: IC.palette },
    { id: 'language', ic: IC.globe },
    { id: 'account', ic: icon.cloud },
    { id: 'moodle', ic: icon.inbox },
    { id: 'ai', ic: icon.spark },
    { id: 'study', ic: icon.timer },
    { id: 'degree', ic: icon.cap },
    { id: 'xp', ic: icon.trophy },
    { id: 'adhkar', ic: icon.bell },
    { id: 'data', ic: IC.db },
  ];
  V.CATS = CATS.map((c) => c.id);
  const catOf = (id) => CATS.find((c) => c.id === id) || null;

  /** Older links pointed at a card on the long page; each one now opens its category. */
  const ANCHORS = { 'lang-card': 'language', moodle: 'moodle', 'moodle-classes': 'moodle', 'moodle-link': 'moodle', ai: 'ai',
    'adhkar-settings': 'adhkar', 'set-sync': 'account', 'set-backup': 'data', 'set-gpa': 'degree', 'set-catalog': 'degree' };

  /**
   * The search index: one entry per setting. `k` is its label key (searched in both languages, so a Hebrew query finds
   * it in English and the other way round), `cat` its category, `sel` the control to show, `kw` extra words (both
   * languages). `when` hides entries whose control is not there (e.g. a module that is off).
   */
  const ENTRIES = [
    { id: 'theme', cat: 'appearance', sel: '[data-action=theme]', kw: 'dark light mode כהה בהיר מצב לילה' },
    { id: 'motion', cat: 'appearance', sel: '[data-action=motion]', kw: 'animation animations אנימציה' },
    { id: 'sound', cat: 'appearance', sel: '[data-action=sound]', kw: 'sound audio צליל צלילים' },
    { id: 'accent', cat: 'appearance', sel: '[data-sid=accent]', kw: 'color colour צבע', when: () => !!CT.views.xp },
    { id: 'lang', cat: 'language', sel: 'input[name=ct-lang]:checked', kw: 'english hebrew עברית אנגלית שפה language' },
    { id: 'sync', cat: 'account', sel: '#set-sync', kw: 'cloud account login sign in ענן חשבון התחברות כניסה' },
    { id: 'signout', cat: 'account', sel: '[data-action=sign-out]', kw: 'logout sign out התנתקות', when: () => cloudOn() && CT.cloud.signedIn() },
    { id: 'moodleLink', cat: 'moodle', sel: '#moodle', kw: 'moodle calendar link ical מודל קישור לוח שנה' },
    { id: 'moodleFile', cat: 'moodle', sel: '#moodle .moodle-steps', kw: 'ics file import קובץ ייבוא' },
    { id: 'moodleClasses', cat: 'moodle', sel: '#moodle-classes', kw: 'categories classify קטגוריות סיווג' },
    { id: 'ai', cat: 'ai', sel: '#ai', kw: 'ai assistant chat עוזר צ׳אט בינה' },
    { id: 'aiModel', cat: 'ai', sel: '[data-ai-pref]', kw: 'model מודל' },
    { id: 'semesters', cat: 'study', sel: '#set-sem', kw: 'semester dates סמסטר תאריכים' },
    { id: 'template', cat: 'study', sel: '#set-tpl', kw: 'template new course תבנית קורס חדש' },
    { id: 'pomodoro', cat: 'study', sel: '[name=work]', kw: 'pomodoro timer break פומודורו טיימר הפסקה' },
    { id: 'shortcuts', cat: 'study', sel: '[data-action=help]', kw: 'keyboard shortcuts קיצורים מקלדת' },
    { id: 'catalog', cat: 'degree', sel: '#set-catalog', kw: 'catalog faculty year track קטלוג פקולטה שנה מסלול' },
    { id: 'gpa', cat: 'degree', sel: '#set-gpa', kw: 'gpa average grade pass ממוצע ציון עובר' },
    { id: 'xpOn', cat: 'xp', sel: '[data-game=enabled]', kw: 'points levels xp נקודות רמות', when: () => !!CT.views.xp },
    { id: 'goals', cat: 'xp', sel: '[data-game="goals.day.items"]', kw: 'goal goals daily weekly יעד יעדים', when: () => !!CT.views.xp },
    { id: 'penalty', cat: 'xp', sel: '[data-game="penalty.enabled"]', kw: 'penalty deductions minimum ניכוי ניכויים מינימום', when: () => !!CT.views.xp },
    { id: 'pause', cat: 'xp', sel: '[data-game-act=pause],[data-game-act=resume]', kw: 'pause exams vacation השהיה מבחנים חופשה', when: () => !!CT.views.xp },
    { id: 'nudges', cat: 'xp', sel: '[data-game=reminders]', kw: 'reminders nudges תזכורות', when: () => !!CT.views.xp },
    { id: 'adhkar', cat: 'adhkar', sel: '[data-adk-set=enabled]', kw: 'adhkar dhikr أذكار אזכרות', when: () => !!CT.views.adhkar },
    { id: 'adkTimes', cat: 'adhkar', sel: '[data-adk-set=mode]', kw: 'prayer times windows זמני תפילה חלונות', when: () => adkOn() },
    { id: 'adkGeneral', cat: 'adhkar', sel: '[data-adk-set="general.every"]', kw: 'quiet hours frequency שעות שקט תדירות', when: () => adkOn() },
    { id: 'adkNotify', cat: 'adhkar', sel: '[data-adk-dev=notify]', kw: 'notifications browser vibrate התראות דפדפן רטט', when: () => adkOn() },
    { id: 'export', cat: 'data', sel: '[data-action=export]', kw: 'backup export json download גיבוי ייצוא הורדה' },
    { id: 'import', cat: 'data', sel: '[data-action=import]', kw: 'restore import שחזור ייבוא' },
    { id: 'autosave', cat: 'data', sel: '#set-auto', kw: 'auto save file onedrive שמירה אוטומטית קובץ' },
    { id: 'reset', cat: 'data', sel: '[data-action=reset]', kw: 'delete everything reset erase מחיקה איפוס' },
  ];
  const cloudOn = () => !!(CT.cloud && CT.cloud.enabled);
  const adkOn = () => !!(CT.views.adhkar && CT.adhkar && CT.adhkar.on && CT.adhkar.on(S.state));

  const words = (s) => u.norm(s).replace(/['"\u05F3\u05F4]/g, '').split(/\s+/).filter(Boolean);
  const hay = (e) => {
    const D = I._dicts;
    return u.norm([D.he['set.s.' + e.id], D.en['set.s.' + e.id], D.he['set.c.' + e.cat], D.en['set.c.' + e.cat], e.kw].join(' ')).replace(/['"\u05F3\u05F4]/g, '');
  };
  /** Settings matching the query (every word must appear), in index order. */
  V.search = (q) => {
    const ws = words(q);
    if (!ws.length) return [];
    return ENTRIES.filter((e) => (!e.when || e.when()) && ws.every((w) => hay(e).includes(w)));
  };
  V.entries = () => ENTRIES.slice();

  /* ---------- page state ---------- */
  const page = { q: '', pending: null, lastCat: null };

  /** Open a category (and optionally show one setting): used by older links (anchors) and the search. */
  V.goTo = (target) => {
    const e = ENTRIES.find((x) => x.id === target);
    const cat = catOf(target) ? target : e ? e.cat : ANCHORS[target] || null;
    if (!cat) { location.hash = '#/settings'; return; }
    page.pending = e ? e.sel : (!catOf(target) && target ? `#${CSS.escape(target)}` : null);
    const hash = `#/settings/${cat}`;
    if (location.hash !== hash) location.hash = hash;
    else CT.app.rerender();
  };

  /* ---------- small builders ---------- */
  const row = (label, control, { id, desc, sid, forId } = {}) => `
    <div class="set-row"${id ? ` id="${id}"` : ''}${sid ? ` data-sid="${sid}"` : ''}>
      <div class="set-row-t">${forId ? `<label for="${forId}">${label}</label>` : `<span>${label}</span>`}${desc ? `<p class="set-desc">${desc}</p>` : ''}</div>
      <div class="set-row-c">${control}</div>
    </div>`;
  const select = (attrs, opts, cur) => `<select ${attrs}>${opts.map(([k, l]) => `<option value="${esc(k)}"${String(cur) === String(k) ? ' selected' : ''}>${l}</option>`).join('')}</select>`;
  const group = (id, title, body, extra = '') => `<section class="set-group"${id ? ` id="${id}"` : ''}${extra}>${title ? `<h3 class="set-group-h">${title}</h3>` : ''}${body}</section>`;

  /* ---------- categories ---------- */
  function appearanceHTML() {
    const xpOn = CT.views.xp && CT.game && CT.game.cfg && CT.game.cfg(S.state).enabled !== false;
    return group('', '', `
      ${row(t('set.theme'), select('id="set-theme" data-action="theme"', [['auto', t('set.theme.auto')], ['light', t('set.theme.light')], ['dark', t('set.theme.dark')]], CT.app.theme()), { forId: 'set-theme' })}
      ${row(t('set.motion'), select('id="set-motion" data-action="motion"', [['auto', t('set.motion.auto')], ['reduce', t('set.motion.reduce')], ['full', t('set.motion.full')]], CT.app.motion()), { forId: 'set-motion', desc: t('set.motionHint') })}
      ${row(t('set.sound'), `<input type="checkbox" class="switch" id="set-sound" data-action="sound"${CT.app.sound() ? ' checked' : ''}>`, { forId: 'set-sound', desc: t('set.soundHint') })}
      ${xpOn ? row(t('set.accent'), `<a class="btn btn-small" href="#/xp">${t('set.accentOpen')}</a>`, { sid: 'accent', desc: t('set.accentHint') }) : ''}`);
  }

  function languageHTML() {
    const cur = I.lang();
    return group('lang-card', '', `
      <div class="lang-options" role="radiogroup" aria-label="${t('lang.title')}">
        ${I.LANGS.map((l) => `<label class="lang-opt"><input type="radio" name="ct-lang" value="${l}"${l === cur ? ' checked' : ''}>
          <span lang="${l}" dir="${l === 'he' ? 'rtl' : 'ltr'}">${I.t('lang.' + l)}</span></label>`).join('')}
      </div>
      <p class="set-desc">${t('lang.hint')}</p>
      ${cur === 'he' ? '' : `<p class="set-desc">${t('lang.partial')}</p>`}`);
  }

  /** Auth errors → a code (never the server's own text). */
  V.authCode = (e) => {
    const m = String((e && e.message) || '');
    if (/invalid login credentials/i.test(m)) return 'bad-login';
    if (/email not confirmed/i.test(m)) return 'unconfirmed';
    if (/already registered|already exists/i.test(m)) return 'exists';
    if (/signups not allowed|signup.*disabled/i.test(m)) return 'signup-closed';
    if (/password/i.test(m) && /6|short|weak/i.test(m)) return 'weak';
    if (e instanceof TypeError || (typeof navigator !== 'undefined' && navigator.onLine === false)) return 'offline';
    return 'server';
  };

  function accountHTML() {
    const C = CT.cloud;
    if (!cloudOn()) {
      return group('set-sync', '', `<p class="set-state"><span class="sync-dot"></span><b>${t('sync.off')}</b></p>
        <p class="set-desc">${t('set.acc.localOnly')} <code dir="ltr">js/config.js</code></p>`);
    }
    const [cls, text] = C.label();
    if (!C.signedIn()) {
      return group('set-sync', '', `
        <p class="set-state"><span class="sync-dot ${cls || 'warn'}"></span><b>${esc(text)}</b></p>
        <p class="set-desc">${t('set.acc.why')}</p>
        <form class="login-form" autocomplete="on" novalidate>
          <label class="field"><span>${t('set.acc.email')}</span><input type="email" name="email" dir="ltr" autocomplete="email" required data-keep="set-email"></label>
          <label class="field"><span>${t('set.acc.password')}</span><input type="password" name="password" dir="ltr" autocomplete="current-password" minlength="6" required data-keep="set-pass"></label>
          <div class="btn-row">
            <button class="btn btn-primary" type="submit">${t('set.acc.signIn')}</button>
            <button class="btn" type="button" data-action="signup">${t('set.acc.signUp')}</button>
          </div>
          <p class="login-msg set-desc" aria-live="polite"></p>
        </form>`);
    }
    const time = C.lastSync ? new Intl.DateTimeFormat(I.locale(), { hour: '2-digit', minute: '2-digit' }).format(C.lastSync) : '';
    return group('set-sync', '', `
      <p class="set-state"><span class="sync-dot ${cls || 'warn'}"></span><b>${esc(text)}</b>${time ? ` <span class="set-desc">· ${t('set.acc.last', { time })}</span>` : ''}</p>
      ${C.status === 'error' ? `<p class="set-warn" role="alert">${icon.alert}<span>${t('set.acc.syncErr')}</span></p>` : ''}
      ${row(t('set.acc.signedAs'), `<bdi dir="ltr" class="set-email">${esc(C.email())}</bdi>`)}
      <p class="set-desc">${t('set.acc.how')}</p>
      <div class="btn-row">
        <button class="btn" data-action="sync-now">${icon.refresh}<span>${t('set.acc.syncNow')}</span></button>
        <button class="btn btn-ghost" data-action="sign-out">${t('set.acc.signOut')}</button>
      </div>`);
  }

  function studyHTML() {
    const st = S.state;
    const counts = st.courses.reduce((a, c) => { a[c.semesterId] = (a[c.semesterId] || 0) + 1; return a; }, {});
    const sems = group('set-sem', t('set.sem.title'), `
      <p class="set-desc">${t('set.sem.hint')} <a href="#/semesters">${t('set.sem.page')}</a></p>
      <div class="sem-list">
        ${st.semesters.map((s) => `
          <div class="sem-row" data-id="${esc(s.id)}">
            <label class="radio" title="${t('set.sem.active')}"><input type="radio" name="active" ${s.id === st.settings.activeSemesterId ? 'checked' : ''} aria-label="${t('set.sem.activeOf', { name: s.name })}"></label>
            <input name="name" dir="auto" value="${esc(s.name)}" aria-label="${t('set.sem.name')}">
            <label class="field-inline">${t('set.sem.start')} <input type="date" name="start" value="${esc(s.start)}"></label>
            <label class="field-inline">${t('set.sem.end')} <input type="date" name="end" value="${esc(s.end)}"></label>
            <label class="field-inline">${t('set.sem.exams')} <input type="date" name="examStart" value="${esc(s.examStart || '')}"></label>
            <span class="set-desc">${t('set.sem.courses', { n: counts[s.id] || 0 })}</span>
            <button class="icon-btn" data-action="del-sem" aria-label="${t('set.sem.delete', { name: s.name })}" ${counts[s.id] ? `disabled title="${t('set.sem.hasCourses')}"` : `title="${t('set.sem.deleteShort')}"`}>${icon.trash}</button>
          </div>`).join('')}
      </div>
      <button class="btn btn-ghost" data-action="add-sem">${icon.plus}<span>${t('set.sem.add')}</span></button>`);
    const tpl = group('set-tpl', t('set.tpl.title'), `
      <p class="set-desc">${t('set.tpl.hint', { n: '{n}' })}</p>
      <div class="tpl-head set-desc" aria-hidden="true"><span>${t('set.tpl.name')}</span><span>${t('set.tpl.count')}</span><span>${t('set.tpl.pattern')}</span><span></span></div>
      <div class="tpl-rows">${st.settings.template.map((r, i) => `
        <div class="tpl-row" data-i="${i}">
          <input name="name" dir="auto" value="${esc(r.name)}" aria-label="${t('set.tpl.name')}">
          <input name="count" type="number" min="0" value="${esc(r.count)}" aria-label="${t('set.tpl.count')}">
          <input name="pattern" dir="auto" value="${esc(r.pattern)}" aria-label="${t('set.tpl.pattern')}">
          <button class="icon-btn" data-action="del-tpl" aria-label="${t('set.tpl.remove')}" title="${t('set.tpl.remove')}">${icon.trash}</button>
        </div>`).join('')}</div>
      <div class="btn-row">
        <button class="btn btn-ghost" data-action="add-tpl">${icon.plus}<span>${t('set.tpl.add')}</span></button>
        <button class="btn btn-ghost" data-action="reset-tpl">${t('set.tpl.reset')}</button>
      </div>`);
    const p = st.settings.pomodoro;
    const focus = group('set-pomo', t('set.pomo.title'), `
      ${row(t('set.pomo.work'), `<input type="number" id="set-work" inputmode="numeric" min="5" max="120" name="work" value="${esc(p.work)}">`, { forId: 'set-work' })}
      ${row(t('set.pomo.brk'), `<input type="number" id="set-brk" inputmode="numeric" min="1" max="60" name="brk" value="${esc(p.brk)}">`, { forId: 'set-brk' })}
      ${row(t('set.keys'), `<button class="btn btn-small" data-action="help">${icon.keyboard}<span>${t('set.keysOpen')}</span></button>`, { desc: t('set.keysHint') })}`);
    return sems + tpl + focus;
  }

  function catalogHTML() {
    const C = CT.views.catalog, K = CT.catalog;
    C.load();
    const cs = S.state.settings.catalog || {};
    const fac = cs.faculty || 'ee';
    const have = new Set(K.available(fac));
    const facSel = `<select id="set-fac" data-action="cat-fac">${K.faculties().map((f) => `<option value="${esc(f.id)}"${f.id === fac ? ' selected' : ''}>${esc(f.name)}</option>`).join('')}</select>`;
    const yearSel = `<select id="set-year" data-action="cat-year"><option value=""${cs.year ? '' : ' selected'}>${t('set.cat.yearNone')}</option>
      ${K.pickerYears(fac).map((y) => `<option value="${y}"${Number(cs.year) === y ? ' selected' : ''}>${esc(K.yearLabel(y))}${have.has(y) ? '' : ' ' + t('set.cat.yearMissing')}</option>`).join('')}</select>`;
    let picks = '';
    if (K.ready) {
      const p = { groups: Array.isArray(cs.groups) ? cs.groups : [], spec: cs.spec || '' };
      if (K.groups.length) {
        picks += `<fieldset class="set-fieldset"><legend>${K.groupsTitle ? `<bdi>${esc(K.groupsTitle)}</bdi>` : t('set.cat.groups')}</legend>
          <p class="set-desc">${t('set.cat.groupsHint')}</p>
          <div class="set-checks">${K.groups.map((x) => {
            const g = C.groupStatus ? C.groupStatus(x) : null;
            return `<label class="check-field"><input type="checkbox" data-action="cat-group" value="${esc(x.id)}"${p.groups.includes(x.id) ? ' checked' : ''}>
              <span><bdi>${x.n}. ${esc(x.name)}</bdi>${g ? ` <span class="set-desc">${t('set.cat.groupCount', { n: g.taken.length, m: x.need })}${g.done ? ' ✓' : ''}</span>` : ''}</span></label>`;
          }).join('')}</div></fieldset>`;
      }
      if (K.specializations.length) {
        picks += row(K.specializationsTitle ? `<bdi>${esc(K.specializationsTitle)}</bdi>` : t('set.cat.spec'),
          `<select id="set-spec" data-action="cat-spec"><option value="">${t('set.cat.specNone')}</option>${K.specializations.map((x) => `<option value="${esc(x.id)}"${x.id === p.spec ? ' selected' : ''}>${esc(x.name)}</option>`).join('')}</select>`, { forId: 'set-spec' });
      }
    }
    const si = K.sourceInfo ? K.sourceInfo() : null;
    const issues = K.ready ? (K.knownIssues || []).map((k) => k.text).concat(K.verify || []) : [];
    const fb = K.ready && K.fallback ? (K.fallback === 'none-chosen' ? th('set.cat.fbNone', { label: I.bdi(K.label) }) : th('set.cat.fbOther', { want: I.bdi(K.yearLabel(K.wantedYear)), label: I.bdi(K.label) })) : '';
    return group('set-catalog', t('set.cat.title'), `
      <p class="set-desc">${t('set.cat.hint')}</p>
      ${row(t('set.cat.faculty'), facSel, { forId: 'set-fac' })}
      ${row(t('set.cat.year'), yearSel, { forId: 'set-year' })}
      ${fb ? `<p class="set-warn" role="alert">${icon.alert}<span>${fb}</span></p>` : ''}
      ${K.ready ? `<p class="set-desc">${th('set.cat.track', { name: I.bdi(K.trackName), id: I.ltr(K.track) })}</p>` : ''}
      ${picks}
      ${si ? `<p class="set-desc cat-source">${th('set.cat.source', { text: I.bdi(si.text), updated: I.ltr(si.updated) })} · <a href="${esc(u.safeUrl ? u.safeUrl(si.url) : si.url)}" target="_blank" rel="noopener"><bdi>${esc(si.title)}</bdi></a></p>` : ''}
      ${issues.length ? `<details class="cat-issues"><summary>${t('set.cat.issues', { n: issues.length })}</summary><ul>${issues.map((x) => `<li dir="auto">${esc(x)}</li>`).join('')}</ul></details>` : ''}
      <a class="btn btn-small btn-ghost" href="#/catalog">${t('set.cat.open')}</a>`);
  }

  function gpaHTML() {
    const r = S.state.settings.gpa;
    return group('set-gpa', t('set.gpa.title'), `
      <p class="set-desc">${t('set.gpa.hint')}</p>
      ${row(t('set.gpa.repeat'), select('id="set-repeat" data-gpa="repeat"', [['last', t('set.gpa.repeat.last')], ['best', t('set.gpa.repeat.best')], ['all', t('set.gpa.repeat.all')]], r.repeat), { forId: 'set-repeat', desc: t('set.gpa.repeatHint') })}
      ${row(t('set.gpa.failed'), `<input type="checkbox" class="switch" id="set-failed" data-gpa="failedInAvg"${r.failedInAvg ? ' checked' : ''}>`, { forId: 'set-failed', desc: t('set.gpa.failedHint') })}
      ${row(t('set.gpa.pass'), `<input type="number" id="set-pass" inputmode="numeric" min="0" max="100" data-gpa="passGrade" value="${esc(r.passGrade)}">`, { forId: 'set-pass', desc: t('set.gpa.passHint') })}
      ${row(t('set.gpa.exempt'), `<input type="checkbox" class="switch" id="set-exempt" data-gpa="exemptCredits"${r.exemptCredits ? ' checked' : ''}>`, { forId: 'set-exempt', desc: t('set.gpa.exemptHint') })}
      ${row(t('set.gpa.decimals'), select('id="set-dec" data-gpa="decimals"', [0, 1, 2, 3].map((d) => [d, String(d)]), Number(r.decimals)), { forId: 'set-dec', desc: t('set.gpa.decimalsHint') })}
      <p class="set-desc">${t('set.gpa.always')}</p>
      <button class="btn btn-ghost btn-small" data-action="gpa-defaults">${t('set.gpa.defaults')}</button>`);
  }

  function dataHTML() {
    const st = S.state, b = CT.backup;
    const last = st.settings.lastBackup;
    const lastIso = last ? u.isoDate(new Date(last)) : null;
    const lastText = lastIso ? t('set.bk.last', { date: ui.date(lastIso, 'full'), rel: relPast(lastIso) }) : t('set.bk.never');
    const name = b.handle && b.handle.name ? I.bdi(b.handle.name, 'ltr') : '';
    const auto = !b.supported
      ? `<p class="set-desc">${t('set.bk.autoUnsupported')}</p>`
      : b.status === 'granted'
        ? `<p class="set-state"><span class="sync-dot ok"></span><span>${th('set.bk.autoOn', { file: name })}</span></p>
           <button class="btn" data-action="disconnect">${t('set.bk.autoStop')}</button>`
        : b.status === 'needs-permission'
          ? `<p class="set-state"><span class="sync-dot warn"></span><span>${th('set.bk.autoWait', { file: name })}</span></p>
             <div class="btn-row"><button class="btn btn-primary" data-action="regrant">${t('set.bk.autoGrant')}</button> <button class="btn" data-action="disconnect">${t('set.bk.autoDisconnect')}</button></div>`
          : `<p class="set-desc">${t('set.bk.autoHint')}</p>
             <button class="btn btn-primary" data-action="connect">${icon.download}<span>${t('set.bk.autoPick')}</span></button>`;
    return group('set-backup', t('set.bk.title'), `
      <p class="set-desc">${t('set.bk.where')} <b>${lastText}</b></p>
      <div class="btn-row">
        <button class="btn btn-primary" data-action="export">${icon.download}<span>${t('set.bk.export')}</span></button>
        <button class="btn" data-action="import">${icon.upload}<span>${t('set.bk.import')}</span></button>
      </div>
      ${b.preUpgradeRaw() ? `<p class="set-desc">${t('set.bk.preUpgrade')}</p>
        <button class="btn btn-small" data-action="pre-upgrade">${icon.download}<span>${t('set.bk.preUpgradeBtn')}</span></button>` : ''}`)
      + group('set-auto', t('set.bk.autoTitle'), auto)
      + `<section class="set-danger" aria-labelledby="set-danger-h">
          <h3 class="set-group-h" id="set-danger-h">${icon.alert}<span>${t('set.danger.title')}</span></h3>
          ${row(t('set.danger.reset'), `<button class="btn btn-danger" data-action="reset">${icon.trash}<span>${t('set.danger.resetBtn')}</span></button>`, { desc: t('set.danger.resetHint') })}
        </section>`;
  }
  /** "3 days ago"-style text for a past date. */
  const relPast = (iso) => {
    const n = -u.daysUntil(iso);
    return n <= 0 ? tx('rel.today') : n === 1 ? tx('rel.yesterday') : tx('set.daysAgo', { n });
  };

  const BODY = {
    appearance: appearanceHTML,
    language: languageHTML,
    account: accountHTML,
    moodle: () => CT.views.moodle.section(),
    ai: () => CT.views.ai.section(),
    study: studyHTML,
    degree: () => catalogHTML() + gpaHTML(),
    xp: () => (CT.views.xp ? CT.views.xp.settingsHTML() : ''),
    adhkar: () => (CT.views.adhkar ? CT.views.adhkar.settingsHTML() : ''),
    data: dataHTML,
  };
  /** One short line under each category in the phone list (only where it says something useful at a glance). */
  function summary(id) {
    if (id === 'appearance') return tx('set.theme.' + CT.app.theme());
    if (id === 'language') return tx('lang.' + I.lang());
    if (id === 'account') return cloudOn() ? CT.cloud.label()[1] : tx('sync.off');
    if (id === 'data') {
      const last = S.state.settings.lastBackup;
      return last ? tx('set.bk.lastShort', { rel: relPast(u.isoDate(new Date(last))) }) : tx('set.bk.never');
    }
    return '';
  }

  /* ---------- page ---------- */
  function navHTML(cur) {
    return `<ul class="set-cats" role="list">${CATS.map((c) => {
      const s = summary(c.id);
      return `<li><a class="set-cat${c.id === cur ? ' active' : ''}" href="#/settings/${c.id}" data-cat="${c.id}"${c.id === cur ? ' aria-current="page"' : ''}>
        <span class="set-cat-ic">${c.ic}</span><span class="set-cat-t"><b>${t('set.c.' + c.id)}</b>${s ? `<small>${esc(s)}</small>` : ''}</span>
        <span class="set-cat-go">${icon.chevSide || icon.chev}</span></a></li>`;
    }).join('')}</ul>`;
  }
  function resultsHTML(q) {
    const hits = V.search(q);
    if (!hits.length) return `<p class="set-empty" role="status">${t('set.search.none')}</p>`;
    return `<p class="nc-sr" role="status">${t('set.search.count', { n: hits.length })}</p>
      <ul class="set-results" role="list">${hits.map((e) => `<li><button type="button" class="set-hit-btn" data-hit="${e.id}">
        <span class="set-cat-ic">${catOf(e.cat).ic}</span><span class="set-cat-t"><b>${t('set.s.' + e.id)}</b><small>${t('set.c.' + e.cat)}</small></span></button></li>`).join('')}</ul>`;
  }

  /** A key for the focused control, so a re-render (store change, language switch) can give the focus back. */
  const FOCUS_ATTRS = ['data-action', 'data-game', 'data-game-act', 'data-adk-set', 'data-adk-dev', 'data-adk-act', 'data-gpa', 'data-moodle-pref', 'data-ai-pref', 'data-cat', 'data-hit', 'name', 'id'];
  function focusSel(el, root) {
    if (!el || !root.contains(el) || el === root) return null;
    const a = FOCUS_ATTRS.find((x) => el.hasAttribute(x));
    if (!a) return null;
    let sel = `${el.tagName.toLowerCase()}[${a}="${CSS.escape(el.getAttribute(a))}"]`;
    if (el.type === 'radio' || el.type === 'checkbox') sel += `[value="${CSS.escape(el.value)}"]`;
    const r = el.closest('[data-id],[data-i],[data-key]');
    if (r && r !== el) {
      const ra = ['data-id', 'data-i', 'data-key'].find((x) => r.hasAttribute(x));
      sel = `[${ra}="${CSS.escape(r.getAttribute(ra))}"] ${sel}`;
    }
    return sel;
  }

  V.render = (root, params = {}) => {
    const cur = catOf(params.id) ? params.id : null;
    const shown = cur || CATS[0].id; // the wide layout always shows a category; the phone list shows none
    const old = root.querySelector('.set');
    const fsel = old ? focusSel(document.activeElement, root) : null;
    const caret = fsel && typeof document.activeElement.selectionStart === 'number' ? [document.activeElement.selectionStart, document.activeElement.selectionEnd] : null;
    const locked = !!(CT.guard && CT.guard.locked && CT.guard.locked());
    const c = catOf(shown);
    root.innerHTML = `
      <div class="set" data-mode="${cur ? 'detail' : 'list'}">
        <aside class="set-side" aria-label="${t('set.c.label')}">
          <h1 class="set-h1">${t('nav.settings')}</h1>
          <div class="search set-search" role="search">${icon.search}
            <input type="search" id="set-q" data-keep="set-q" dir="auto" autocomplete="off" placeholder="${t('set.search.ph')}" aria-label="${t('set.search.label')}" aria-controls="set-nav" value="${esc(page.q)}">
          </div>
          <nav class="set-nav" id="set-nav" aria-label="${t('set.c.label')}">${page.q.trim() ? resultsHTML(page.q) : navHTML(cur ? shown : (matchMedia('(min-width: 1024px)').matches ? shown : null))}</nav>
        </aside>
        <section class="set-main" aria-labelledby="set-cat-h">
          <div class="set-main-head">
            <a class="btn btn-ghost btn-small set-back" href="#/settings" data-back="1">${icon.chevSide || icon.chev}<span>${t('nav.settings')}</span></a>
            <h2 id="set-cat-h" tabindex="-1"><span class="set-cat-ic">${c.ic}</span><span>${t('set.c.' + shown)}</span></h2>
          </div>
          ${locked ? `<p class="set-warn" role="alert">${icon.alert}<span>${t('lock.readonly')}</span></p>` : ''}
          <div class="set-body set-${shown}">${BODY[shown]()}</div>
        </section>
      </div>`;

    const el = root.querySelector('.set');
    // while the site is read-only the store refuses every write (and shows why); nothing else to do here
    const quiet = (err) => { if (!(err && err.locked)) throw err; };
    el.addEventListener('click', (e) => { onClick(e).catch(quiet); });
    el.addEventListener('change', (e) => { try { onChange(e); } catch (err) { quiet(err); } });
    el.addEventListener('keydown', onKey);
    const q = el.querySelector('#set-q');
    q.addEventListener('input', () => {
      page.q = q.value;
      const nav = el.querySelector('#set-nav');
      nav.innerHTML = page.q.trim() ? resultsHTML(page.q) : navHTML(cur ? shown : null);
    });
    const form = el.querySelector('.login-form');
    if (form) form.addEventListener('submit', (e) => { e.preventDefault(); login('in', form); });

    // focus: a search hit or an older link → that setting; a new category → its heading; a re-render → the same control
    const entering = page.lastCat !== (cur || '');
    if (page.pending) {
      const target = el.querySelector(page.pending);
      page.pending = null;
      if (target) {
        const row = target.closest('.set-row, .set-group, section') || target;
        row.classList.add('set-flash');
        setTimeout(() => row.classList.remove('set-flash'), 1600);
        requestAnimationFrame(() => {
          row.scrollIntoView({ block: 'center' });
          const f = target.matches('input,select,textarea,button,a,summary') ? target : target.querySelector('input,select,textarea,button,a,summary');
          if (f) f.focus({ preventScroll: true });
        });
      }
    } else {
      const visible = (x) => x && x.getClientRects().length > 0;
      const navShown = visible(el.querySelector('.set-side'));
      const back = entering && !cur && page.lastCat ? el.querySelector(`.set-cat[data-cat="${page.lastCat}"]`) : null;
      const f = fsel ? el.querySelector(fsel) : null;
      if (entering && cur && !navShown) el.querySelector('#set-cat-h').focus({ preventScroll: true }); // phone: the new view
      else if (visible(back)) back.focus({ preventScroll: true }); // phone: back to the list, on the category you left
      else if (visible(f)) { // a redraw (store change, language): the same control, same caret
        f.focus({ preventScroll: true });
        if (caret) { try { f.setSelectionRange(caret[0], caret[1]); } catch (e) { /* ignore */ } }
      }
    }
    if (cur) page.lastCat = cur;
    else if (entering) page.lastCat = '';
  };

  /** Arrow keys move between the categories (and search results); Escape in the search clears it. */
  function onKey(e) {
    if (e.target.id === 'set-q') {
      if (e.key === 'Escape' && e.target.value) { e.preventDefault(); e.stopPropagation(); e.target.value = ''; e.target.dispatchEvent(new Event('input')); return; }
      if (e.key === 'ArrowDown') { const f = document.querySelector('#set-nav a, #set-nav button'); if (f) { e.preventDefault(); f.focus(); } return; }
      if (e.key === 'Enter') { const f = document.querySelector('#set-nav [data-hit]'); if (f) { e.preventDefault(); f.click(); } return; }
      return;
    }
    if (!e.target.closest('#set-nav')) return;
    const list = [...document.querySelectorAll('#set-nav a, #set-nav button')];
    const i = list.indexOf(e.target);
    if (i < 0) return;
    const next = { ArrowDown: i + 1, ArrowUp: i - 1, Home: 0, End: list.length - 1 }[e.key];
    if (next === undefined) return;
    e.preventDefault();
    if (next < 0) { document.getElementById('set-q').focus(); return; }
    list[Math.min(next, list.length - 1)].focus();
  }

  async function login(mode, form) {
    const email = form.querySelector('[name=email]').value.trim();
    const pass = form.querySelector('[name=password]').value;
    const msg = form.querySelector('.login-msg');
    if (!email || !/^\S+@\S+\.\S+$/.test(email) || pass.length < 6) { msg.textContent = tx('set.acc.need'); return; }
    msg.textContent = tx(mode === 'up' ? 'set.acc.signingUp' : 'set.acc.signingIn');
    form.querySelectorAll('button').forEach((b) => { b.disabled = true; });
    try {
      if (mode === 'up') {
        const r = await CT.cloud.signUp(email, pass);
        if (r === 'confirm-email') {
          msg.textContent = tx('set.acc.confirm');
          form.querySelectorAll('button').forEach((b) => { b.disabled = false; });
          return;
        }
      } else {
        await CT.cloud.signIn(email, pass);
      }
      CT.views.moodle.resetFeed();
      CT.views.ai.reset();
      ui.toast(tx('set.acc.signedIn'));
      CT.app.rerender();
    } catch (e) {
      msg.textContent = tx('set.acc.err.' + V.authCode(e));
      form.querySelectorAll('button').forEach((b) => { b.disabled = false; });
    }
  }

  async function onClick(e) {
    const hit = e.target.closest('[data-hit]');
    if (hit) { page.q = ''; V.goTo(hit.dataset.hit); return; }
    const a = e.target.closest('[data-action]');
    if (!a) return;
    if (a.dataset.action.startsWith('moodle-')) { CT.views.moodle.onClick(a); return; }
    if (a.dataset.action.startsWith('ai-')) { CT.views.ai.onClick(a); return; }
    const semId = a.closest('.sem-row') && a.closest('.sem-row').dataset.id;
    switch (a.dataset.action) {
      case 'signup': login('up', a.closest('form')); break;
      case 'sync-now': CT.cloud.syncNow(); break;
      case 'sign-out':
        if (!(await ui.confirm(tx('set.acc.signOutQ'), tx('set.acc.signOut'), false, { localized: true }))) return;
        await CT.cloud.signOut();
        CT.views.moodle.resetFeed();
        CT.views.ai.reset();
        CT.app.rerender();
        break;
      case 'export': CT.backup.exportFile(); break;
      case 'pre-upgrade': CT.backup.exportPreUpgrade(); break;
      case 'gpa-defaults': S.commit(tx('set.u.gpa'), (st) => { st.settings.gpa = Object.assign({}, M.DEFAULT_GPA); }); break;
      case 'import': CT.backup.pickImport(); break;
      case 'connect': CT.backup.connect(); break;
      case 'regrant': CT.backup.regrant(); break;
      case 'disconnect': CT.backup.disconnect(); break;
      case 'add-sem': S.commit(tx('set.u.semAdd'), (st) => st.semesters.push(M.newSemester())); break;
      case 'del-sem': {
        const s = S.state.semesters.find((x) => x.id === semId);
        if (!s || S.state.courses.some((c) => c.semesterId === semId)) return;
        S.commit(tx('set.u.semDel'), (st) => { st.semesters = st.semesters.filter((x) => x.id !== semId); });
        ui.toast(tx('set.sem.deleted'), { action: { label: tx('set.undo'), fn: S.undo } });
        break;
      }
      case 'add-tpl': S.commit(tx('set.u.tpl'), (st) => st.settings.template.push({ name: '', count: 13, pattern: '{n}' })); break;
      case 'del-tpl': S.commit(tx('set.u.tpl'), (st) => st.settings.template.splice(Number(a.closest('.tpl-row').dataset.i), 1)); break;
      case 'reset-tpl':
        if (!(await ui.confirm(tx('set.tpl.resetQ'), tx('set.tpl.reset'), false, { localized: true }))) return;
        S.commit(tx('set.u.tplReset'), (st) => { st.settings.template = JSON.parse(JSON.stringify(M.DEFAULT_TEMPLATE)); });
        break;
      case 'help': CT.app.showHelp(); break;
      case 'reset':
        if (!(await ui.confirm(tx('set.danger.resetQ'), tx('set.danger.resetBtn'), true, { localized: true }))) return;
        S.replace(M.emptyState(), tx('set.u.reset'));
        S.commit('', (st) => { const sem = M.newSemester({ name: tx('set.sem.default') }); st.semesters.push(sem); st.settings.activeSemesterId = sem.id; }, { undo: false });
        break;
      default: break;
    }
  }

  function onChange(e) {
    const el = e.target;
    if (el.id === 'set-q') return;
    if (el.name === 'ct-lang') { I.setLang(el.value); return; } // the app redraws this (translated) page and keeps the focus
    if (el.matches('[data-action=cat-year]')) { CT.views.catalog.setYear(el.value); return; }
    if (el.matches('[data-action=cat-fac]')) { CT.views.catalog.setFaculty(el.value); return; }
    if (el.matches('[data-action=cat-group]')) { CT.views.catalog.toggleGroup(el.value); return; }
    if (el.matches('[data-action=cat-spec]')) { CT.views.catalog.setSpec(el.value); return; }
    if (el.dataset.moodlePref) { CT.views.moodle.onChange(el); return; }
    if (el.dataset.aiPref) { CT.views.ai.onChange(el); return; }
    if (el.dataset.game) { CT.views.xp.onSettingsChange(el); return; }
    if (el.dataset.gpa) {
      const k = el.dataset.gpa;
      const v = el.type === 'checkbox' ? el.checked : (k === 'passGrade' || k === 'decimals') ? u.clamp(Number(el.value) || 0, 0, 100) : el.value;
      S.commit(tx('set.u.gpa'), (st) => { st.settings.gpa[k] = v; });
      return;
    }
    const sem = el.closest('.sem-row');
    if (sem) {
      const id = sem.dataset.id;
      if (el.type === 'radio') S.commit(tx('set.u.semActive'), (st) => { st.settings.activeSemesterId = id; });
      else S.commit(tx('set.u.sem'), (st) => { st.semesters.find((s) => s.id === id)[el.name] = el.value.trim(); });
      return;
    }
    const tpl = el.closest('.tpl-row');
    if (tpl) {
      S.commit(tx('set.u.tpl'), (st) => {
        const r = st.settings.template[Number(tpl.dataset.i)];
        r[el.name] = el.name === 'count' ? Math.max(0, parseInt(el.value, 10) || 0) : el.value;
      });
      return;
    }
    // device preferences (not part of the synced data): theme, motion, sound
    if (el.matches('[data-action=theme]')) { CT.app.setTheme(el.value); CT.app.rerender(); }
    if (el.matches('[data-action=motion]')) CT.app.setMotion(el.value);
    if (el.matches('[data-action=sound]')) CT.app.setSound(el.checked);
    if (el.name === 'work' || el.name === 'brk') {
      S.commit(tx('set.u.pomo'), (st) => { st.settings.pomodoro[el.name] = Math.max(1, parseInt(el.value, 10) || 1); });
    }
  }
})(window.CT);
