/* app.js — bootstrap: hash router, header/nav, global search, theme, keyboard shortcuts, help. */
(function (CT) {
  'use strict';
  const { u, ui } = CT;
  const S = CT.store;
  const esc = u.esc, icon = u.icon;
  const app = {};
  CT.app = app;

  /* Four primary destinations (sidebar / icon rail / bottom bar). Every old route belongs to one of them;
   * `subs` is the secondary navigation shown under the destination (sidebar) or as a strip (rail, phone).
   * "קורסים" opens the active semester's course list (#/courses) and "AI" opens the existing chat panel
   * until their dedicated pages arrive (stages D, E). */
  const DESTS = [
    { id: 'today', label: 'היום', icon: 'sun', href: '#/', routes: ['', 'schedule', 'xp', 'adhkar'],
      subs: [['', 'סקירה'], ['schedule', 'מערכת שעות'], ['xp', 'נקודות ויעדים'], ['adhkar', 'אזכרות']] },
    { id: 'courses', label: 'קורסים', icon: 'book', href: '#/courses', routes: ['courses', 'course', 'moodle', 'review', 'archive'],
      subs: [['courses', 'הקורסים שלי'], ['moodle', 'המודל שלי'], ['review', 'חזרה למבחן'], ['archive', 'ארכיון']] },
    { id: 'degree', label: 'התואר', icon: 'cap', href: '#/grades', routes: ['grades', 'catalog', 'semesters', 'stats'],
      subs: [['grades', 'ממוצע וציונים'], ['catalog', 'תכנית לימודים'], ['semesters', 'סמסטרים'], ['stats', 'סטטיסטיקות']] },
    { id: 'ai', label: 'AI', icon: 'spark', action: 'ai', routes: [], subs: [] },
  ];
  const destOf = (route) => DESTS.find((d) => d.routes.includes(route)) || null;
  const subShown = ([r]) => r === '' || r === 'courses' || (r === 'xp' ? !!(CT.views.xp && CT.views.xp.chipHTML()) : navShown([r]));

  /* sidebar: full (default) or icon rail — a per-device preference, like the theme */
  app.sidebar = () => { try { return localStorage.getItem('ct.sidebar') === 'rail' ? 'rail' : 'full'; } catch (e) { return 'full'; } };
  app.setSidebar = (m) => {
    try { localStorage.setItem('ct.sidebar', m); } catch (e) { /* ignore */ }
    applySidebar();
    app.rerender();
  };
  function applySidebar() { document.documentElement.dataset.sb = app.sidebar(); }
  applySidebar();

  /* ---------- theme ---------- */
  app.theme = () => { try { return localStorage.getItem('ct.theme') || 'auto'; } catch (e) { return 'auto'; } };
  app.setTheme = (t) => {
    try { localStorage.setItem('ct.theme', t); } catch (e) { /* ignore */ }
    applyTheme();
  };
  const isDark = () => {
    const t = app.theme();
    return t === 'dark' || (t === 'auto' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  };
  function applyTheme() {
    document.documentElement.dataset.theme = isDark() ? 'dark' : 'light';
    const meta = document.querySelector('meta[name="theme-color"]'); // browser/OS bar follows the in-app theme (= --bg)
    if (meta) meta.setAttribute('content', isDark() ? '#090b0f' : '#f5f6f8');
    const btn = document.getElementById('theme-btn');
    if (btn) { btn.innerHTML = isDark() ? icon.sun : icon.moon; btn.setAttribute('aria-label', isDark() ? 'מעבר למצב בהיר' : 'מעבר למצב כהה'); }
  }

  /* ---------- motion and sound (per device, like the theme) ---------- */
  // motion: 'auto' = follow the system "reduce motion" setting · 'reduce' = almost no animation · 'full' = always animate
  const pref = (k, d) => { try { return localStorage.getItem(k) || d; } catch (e) { return d; } };
  const setPref = (k, v) => { try { localStorage.setItem(k, v); } catch (e) { /* ignore */ } };
  app.motion = () => pref('ct.motion', 'auto');
  app.setMotion = (m) => { setPref('ct.motion', m); applyMotion(); };
  app.reducedMotion = () => app.motion() === 'reduce' || (app.motion() === 'auto' && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  app.sound = () => pref('ct.sound', 'off') === 'on';
  app.setSound = (on) => setPref('ct.sound', on ? 'on' : 'off');
  function applyMotion() {
    const m = app.motion();
    if (m === 'auto') delete document.documentElement.dataset.motion; else document.documentElement.dataset.motion = m;
  }
  applyMotion();

  /* ---------- router ---------- */
  const viewKey = (route) => (route === 'grades' ? 'gpa' : route); // route name → CT.views key
  const navShown = ([r]) => r === '' || (CT.views[viewKey(r)] && (r !== 'adhkar' || (CT.adhkar && CT.adhkar.on(S.state))));
  const parseHash = () => {
    const h = location.hash.replace(/^#\/?/, '');
    const [path, query] = h.split('?');
    const parts = path.split('/').filter(Boolean);
    const params = Object.fromEntries(new URLSearchParams(query || ''));
    return { route: parts[0] || '', id: parts[1], params };
  };

  app.rerender = () => {
    const { route, id, params } = parseHash();
    const main = document.getElementById('main');
    const views = CT.views;
    const scrollY = window.scrollY;
    const map = {
      '': () => views.dashboard.render(main),
      course: () => views.course.render(main, { id, ...params }),
      schedule: () => views.schedule.render(main, params),
      review: () => views.review.render(main, params),
      stats: () => views.stats.render(main, params),
      archive: () => views.archive.render(main, params),
      catalog: () => views.catalog.render(main, params),
      semesters: () => views.semesters.render(main, { id, ...params }),
      grades: () => views.gpa.render(main, params),
      // course list of the active semester (the semester page) until the dedicated courses page (stage D)
      courses: () => views.semesters.render(main, { ...params, id: S.state.settings.activeSemesterId }),
      settings: () => views.settings.render(main, params),
      moodle: () => views.moodle.render(main, params),
      xp: () => views.xp.render(main, params),
      adhkar: () => views.adhkar.render(main, params),
    };
    const routeKey = route === 'grades' ? 'gpa' : route;
    const fn = map[route] && (route === '' || route === 'course' || (route === 'courses' ? views.semesters : views[routeKey])) ? map[route] : map[''];
    const pathNow = location.hash.split('?')[0];
    const entering = app.lastPath !== pathNow; // a new page (not a re-render after an edit) fades in
    app.lastPath = pathNow;
    fn();
    if (entering) {
      main.classList.remove('route-in'); void main.offsetWidth; main.classList.add('route-in');
      clearTimeout(app.routeTimer); app.routeTimer = setTimeout(() => main.classList.remove('route-in'), 600);
    }
    const navRoute = fn === map[''] ? '' : route; // unknown routes show the home page, so "היום" is current
    renderNav(navRoute);
    renderSidebar(navRoute);
    paintSyncDot();
    if (app.lastRoute === location.hash && !params.item) window.scrollTo(0, scrollY);
    app.lastRoute = location.hash;
    if (CT.timer) CT.timer.renderChip();
  };

  window.addEventListener('hashchange', () => {
    ui.closeMenu();
    app.lastRoute = null;
    app.rerender();
    window.scrollTo(0, 0);
    const { params } = parseHash();
    if (params.item) setTimeout(app.rerender, 0);
  });

  /* ---------- header ---------- */
  /* ---------- cloud sync status (sidebar footer + small header dot) ---------- */
  const syncLine = () => {
    const [cls, text] = CT.cloud.label();
    const email = CT.cloud.email();
    return `<span class="sb-dot ${cls === 'ok' ? 'ok' : cls === 'bad' ? 'bad' : cls === 'busy' ? 'busy' : 'warn'}"></span>
      <span class="sb-sync"><b>☁️ ${esc(text)}</b>${email ? `<span dir="ltr">${esc(email)}</span>` : ''}</span>`;
  };
  const paintSyncDot = () => {
    const dot = document.getElementById('sync-dot');
    if (!dot || !CT.cloud) return;
    const [cls, text] = CT.cloud.label();
    dot.className = `sync-dot ${cls || 'warn'}`;
    dot.title = `סנכרון: ${text}`;
    dot.setAttribute('aria-label', dot.title);
  };
  /** Called by cloud.js whenever the sync status changes. */
  app.updateSyncBadge = () => {
    if (!CT.cloud || !CT.cloud.enabled) return;
    const foot = document.getElementById('sb-foot');
    if (foot) foot.innerHTML = syncLine();
    paintSyncDot();
    // keep the settings page's sync panel current (but never while the user is typing there)
    if (parseHash().route === 'settings' && !document.querySelector('.settings :focus')) app.rerender();
  };

  const backupLine = () => {
    const b = CT.backup;
    const days = b.daysSinceBackup();
    const [cls, text] = b.status === 'granted' ? ['ok', 'שמירה אוטומטית פעילה']
      : b.status === 'needs-permission' ? ['warn', 'שמירה אוטומטית ממתינה לאישור']
        : days == null ? ['warn', 'עוד לא גובה']
          : [days > 7 ? 'warn' : 'ok', `גיבוי אחרון ${days === 0 ? 'היום' : days === 1 ? 'אתמול' : `לפני ${days} ימים`}`];
    return `<span class="sb-dot ${cls}"></span><span class="sb-label">${text}</span>`;
  };
  const destLink = (d, cur, cls) => {
    const on = cur === d;
    const inner = `${icon[d.icon]}<span class="${cls}-label">${d.label}</span>`;
    return d.action
      ? `<button type="button" class="${cls}-item" data-dest="${d.id}" aria-haspopup="dialog" title="${d.label}">${inner}</button>`
      : `<a href="${d.href}" class="${cls}-item${on ? ' active' : ''}" data-dest="${d.id}" title="${d.label}"${on ? ' aria-current="true"' : ''}>${inner}</a>`;
  };
  const onDest = (e) => {
    const b = e.target.closest('[data-dest="ai"]');
    if (b && CT.views.ai) { e.preventDefault(); CT.views.ai.open(); }
  };

  /** Sidebar: brand + collapse toggle, the four destinations (subs under the current one), settings and backup/sync status. */
  function renderSidebar(route) {
    const sb = document.getElementById('sidebar');
    const cur = destOf(route);
    const rail = app.sidebar() === 'rail';
    sb.innerHTML = `
      <div class="sb-top">
        <a href="#/" class="sb-brand" title="הקורסים שלי"><span class="sb-logo" aria-hidden="true">${icon.check}</span><span class="sb-label">הקורסים שלי</span></a>
        <button type="button" class="icon-btn sb-toggle" id="sb-toggle" aria-controls="sidebar" aria-expanded="${!rail}" aria-label="${rail ? 'הרחבת התפריט' : 'כיווץ התפריט'}" title="${rail ? 'הרחבת התפריט' : 'כיווץ התפריט'}">${icon.sidebar}</button>
      </div>
      <nav class="sb-nav" aria-label="ניווט ראשי">
        ${DESTS.map((d) => destLink(d, cur, 'sb') + (cur === d && d.subs.length ? `<div class="sb-sub">${d.subs.filter(subShown).map(([r, l]) => `<a href="#/${r}" class="${route === r ? 'active' : ''}"${route === r ? ' aria-current="page"' : ''}>${l}</a>`).join('')}</div>` : '')).join('')}
      </nav>
      <div class="sb-bottom">
        <a href="#/settings" class="sb-item${route === 'settings' ? ' active' : ''}" title="הגדרות"${route === 'settings' ? ' aria-current="page"' : ''}>${icon.gear}<span class="sb-label">הגדרות</span></a>
        <a href="#/settings" class="sb-foot" id="sb-foot">${CT.cloud && CT.cloud.enabled ? syncLine() : backupLine()}</a>
      </div>`;
    sb.querySelector('#sb-toggle').onclick = () => app.setSidebar(rail ? 'full' : 'rail');
    sb.querySelector('.sb-nav').onclick = onDest;
  }

  /** Secondary strip (rail and phone) + bottom bar (phone) + header XP chip — refreshed on every route change. */
  function renderNav(route) {
    const cur = destOf(route);
    const sub = document.getElementById('subnav');
    if (sub) {
      const list = cur ? cur.subs.filter(subShown) : [];
      sub.hidden = list.length < 2;
      sub.innerHTML = list.map(([r, l]) => `<a href="#/${r}" data-route="${r}" class="${route === r ? 'active' : ''}"${route === r ? ' aria-current="page"' : ''}>${l}</a>`).join('');
    }
    const bn = document.getElementById('bottom-nav');
    if (bn) { bn.innerHTML = DESTS.map((d) => destLink(d, cur, 'bn')).join(''); bn.onclick = onDest; }
    const t = document.getElementById('hd-title');
    if (t) t.textContent = route === 'settings' ? 'הגדרות' : cur ? cur.label : '';
    const xp = document.getElementById('xp-slot');
    if (xp) xp.innerHTML = CT.views.xp ? CT.views.xp.chipHTML() : '';
  }

  app.openSearch = () => {
    document.getElementById('app-header').classList.add('search-open');
    document.getElementById('search').focus();
  };

  function renderHeader() {
    const h = document.getElementById('app-header');
    h.innerHTML = `
      <div class="header-inner">
        <span class="hd-title" id="hd-title"></span>
        <div class="search" role="search">
          ${icon.search}
          <input id="search" type="search" dir="auto" placeholder="חיפוש בקורסים, פריטים והערות…" aria-label="חיפוש גלובלי (קיצור: /)" autocomplete="off">
          <kbd class="search-kbd">/</kbd>
          <div class="search-results" id="search-results" role="listbox" hidden></div>
        </div>
        <div class="header-actions">
          ${CT.cloud && CT.cloud.enabled ? '<a href="#/settings" id="sync-dot" class="sync-dot warn" aria-label="סנכרון"></a>' : ''}
          <button type="button" class="icon-btn hd-search" id="search-btn" aria-label="חיפוש (/)">${icon.search}</button>
          <span id="timer-slot"></span>
          <span id="xp-slot" class="xp-slot"></span>
          <button type="button" class="icon-btn" id="bell-btn" aria-label="התראות והודעות (בדף היום)" title="התראות והודעות">${icon.bell}</button>
          <button type="button" class="icon-btn hd-wide" id="undo-btn" aria-label="ביטול פעולה אחרונה (Ctrl+Z)" title="ביטול (Ctrl+Z)">${icon.undo}</button>
          <button type="button" class="icon-btn hd-wide" id="help-btn" aria-label="קיצורי מקלדת (?)" title="קיצורי מקלדת (?)">${icon.keyboard}</button>
          <button type="button" class="icon-btn hd-wide" id="theme-btn"></button>
          <button type="button" class="icon-btn hd-more" id="more-btn" aria-label="עוד פעולות" aria-haspopup="menu">${icon.more}</button>
        </div>
      </div>
      <nav class="nav subnav" id="subnav" aria-label="ניווט משני" hidden></nav>`;
    document.getElementById('theme-btn').onclick = () => app.setTheme(isDark() ? 'light' : 'dark');
    document.getElementById('undo-btn').onclick = S.undo;
    document.getElementById('help-btn').onclick = app.showHelp;
    document.getElementById('search-btn').onclick = app.openSearch;
    // notices still live on the "היום" page until the notification center (stage C)
    document.getElementById('bell-btn').onclick = () => {
      if (parseHash().route !== '') { location.hash = '#/'; return; }
      const n = document.querySelector('#main .banner');
      if (n) n.scrollIntoView({ block: 'center', behavior: app.reducedMotion() ? 'auto' : 'smooth' });
      else ui.toast('אין התראות חדשות');
    };
    const more = document.getElementById('more-btn');
    more.onclick = () => ui.menu(more, [
      { label: 'הגדרות', icon: 'gear', fn: () => { location.hash = '#/settings'; } },
      { label: isDark() ? 'מצב בהיר' : 'מצב כהה', icon: isDark() ? 'sun' : 'moon', fn: () => app.setTheme(isDark() ? 'light' : 'dark') },
      { label: 'ביטול פעולה אחרונה', icon: 'undo', fn: S.undo },
      { label: 'קיצורי מקלדת', icon: 'keyboard', fn: app.showHelp },
    ]);
    bindSearch();
    applyTheme();
  }
  app.renderHeader = () => { renderHeader(); app.rerender(); };

  /* ---------- global search ---------- */
  function searchAll(q) {
    const nq = u.norm(q);
    const out = [];
    S.state.courses.forEach((c) => {
      const tag = c.archived ? ' (ארכיון)' : '';
      if (u.norm(`${c.name} ${c.number} ${c.staff} ${c.description}`).includes(nq)) {
        out.push({ kind: 'קורס', title: c.name + tag, sub: c.number, href: `#/course/${c.id}`, color: c.color });
      }
      c.categories.forEach((cat) => cat.items.forEach((it) => {
        const inTitle = u.norm(it.title).includes(nq);
        const inNote = u.norm(it.note).includes(nq);
        const inTags = it.tags.some((t) => u.norm(t).includes(nq));
        if (inTitle || inNote || inTags) {
          let sub = `${c.name} · ${cat.name}`;
          if (inNote && !inTitle) {
            const i = u.norm(it.note).indexOf(nq);
            sub = '…' + it.note.slice(Math.max(0, i - 25), i + 45).replace(/\n/g, ' ') + '…';
          }
          out.push({ kind: 'פריט', title: it.title, sub, href: `#/course/${c.id}?item=${it.id}`, color: c.color });
        }
      }));
      (c.notebook || []).forEach((n) => {
        if (u.norm(`${n.title} ${n.body}`).includes(nq)) {
          out.push({ kind: 'מושג', title: n.title, sub: c.name, href: `#/course/${c.id}?tab=notebook`, color: c.color });
        }
      });
    });
    return out.slice(0, 40);
  }

  function bindSearch() {
    const inp = document.getElementById('search');
    const box = document.getElementById('search-results');
    let results = [], sel = 0;
    const draw = () => {
      const q = inp.value.trim();
      if (!q) { box.hidden = true; return; }
      results = searchAll(q);
      sel = 0;
      box.innerHTML = results.length ? results.map((r, i) => `
        <a href="${r.href}" class="sr${i === sel ? ' sel' : ''}" role="option" aria-selected="${i === sel}" data-i="${i}">
          <span class="dot" style="background:${esc(r.color)}"></span>
          <span class="sr-main"><span class="sr-title" dir="auto">${u.highlight(r.title, q)}</span><span class="sr-sub muted small" dir="auto">${u.highlight(r.sub || '', q)}</span></span>
          <span class="sr-kind">${r.kind}</span>
        </a>`).join('') : '<div class="sr-empty muted">לא נמצאו תוצאות</div>';
      box.hidden = false;
    };
    const mark = () => box.querySelectorAll('.sr').forEach((el, i) => {
      el.classList.toggle('sel', i === sel); el.setAttribute('aria-selected', i === sel);
      if (i === sel) el.scrollIntoView({ block: 'nearest' });
    });
    inp.addEventListener('input', draw);
    inp.addEventListener('focus', draw);
    inp.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown') { e.preventDefault(); sel = Math.min(results.length - 1, sel + 1); mark(); }
      if (e.key === 'ArrowUp') { e.preventDefault(); sel = Math.max(0, sel - 1); mark(); }
      if (e.key === 'Enter' && results[sel]) { e.preventDefault(); go(results[sel].href); }
      if (e.key === 'Escape') { inp.value = ''; box.hidden = true; inp.blur(); }
    });
    const go = (href) => { box.hidden = true; inp.blur(); location.hash = href; };
    box.addEventListener('mousedown', (e) => { const a = e.target.closest('.sr'); if (a) { e.preventDefault(); go(a.getAttribute('href')); } });
    inp.addEventListener('blur', () => setTimeout(() => { box.hidden = true; document.getElementById('app-header').classList.remove('search-open'); }, 150));
  }

  /* ---------- keyboard shortcuts ---------- */
  const SHORTCUTS = [
    ['/', 'חיפוש'],
    ['n', 'פריט חדש (בדף קורס) / קורס חדש (בדשבורד)'],
    ['Space', 'סימון V על השורה הנבחרת'],
    ['↑ ↓  או  j k', 'מעבר בין שורות'],
    ['Enter', 'פתיחת/סגירת הערה'],
    ['f', 'סימון ⭐ לחזרה לפני המבחן'],
    ['s', 'בחירת סטטוס'],
    ['e', 'פרטי פריט ועריכה'],
    ['Alt + ↑ ↓', 'הזזת שורה'],
    ['Delete', 'מחיקת שורה'],
    ['Ctrl + Z', 'ביטול פעולה אחרונה'],
    ['t', 'טיימר לימוד'],
    ['a', 'עוזר AI (גם כפתור 🤖 בפינה)'],
    ['g ואז d / s / r / t', 'מעבר לדשבורד / מערכת / חזרה / סטטיסטיקות'],
    ['?', 'החלון הזה'],
    ['Esc', 'סגירת חלון / ביטול עריכה'],
  ];
  app.showHelp = () => ui.modal({
    title: 'קיצורי מקלדת',
    body: `<table class="kbd-table">${SHORTCUTS.map(([k, d]) => `<tr><td><kbd>${esc(k)}</kbd></td><td>${esc(d)}</td></tr>`).join('')}</table>
      <p class="muted small">הקיצורים עובדים גם כשהמקלדת על עברית.</p>`,
  });

  let gPending = 0;
  document.addEventListener('keydown', (e) => {
    const t = e.target;
    const typing = t.matches && t.matches('input, textarea, select, [contenteditable="true"]');
    if ((e.ctrlKey || e.metaKey) && !e.shiftKey && (e.key === 'z' || e.key === 'ז')) {
      if (typing) return; // native undo inside text fields
      e.preventDefault(); S.undo(); return;
    }
    if (typing || e.ctrlKey || e.metaKey || document.querySelector('.modal-backdrop') || document.body.classList.contains('adk-open')) return;
    const { route } = parseHash();
    if (Date.now() - gPending < 1200) {
      const dest = { d: '', 'ג': '', s: 'schedule', 'ד': 'schedule', r: 'review', 'ר': 'review', t: 'stats', 'א': 'stats' }[e.key];
      gPending = 0;
      if (dest !== undefined) { e.preventDefault(); location.hash = `#/${dest}`; return; }
    }
    if (route === 'course' && CT.views.course.onKey(e)) { e.preventDefault(); return; }
    if (e.key === '/' || e.key === '.') { e.preventDefault(); app.openSearch(); return; }
    if (e.key === '?') { e.preventDefault(); app.showHelp(); return; }
    if ((e.key === 'g' || e.key === 'ע') && !e.altKey) { gPending = Date.now(); return; }
    if ((e.key === 'n' || e.key === 'מ') && route === '') { e.preventDefault(); CT.views.course.courseForm(); return; }
    if ((e.key === 't' || e.key === 'א') && CT.timer) { e.preventDefault(); CT.timer.open(); return; }
    if ((e.key === 'a' || e.key === 'ש') && CT.views.ai) { e.preventDefault(); CT.views.ai.open(); }
  });

  /* ---------- read-only lock: one global warning (schema-guard.js) ---------- */
  function renderLockBar() {
    const el = document.getElementById('lock-bar');
    const G = CT.guard;
    if (!el || !G) return;
    const i = G.info;
    el.hidden = !i;
    if (!i) { el.innerHTML = ''; return; }
    const bad = i.reason === 'malformed';
    const note = G.storeFailed ? 'לא הצלחתי לשמור עותק בדפדפן. כדאי להוריד גיבוי עכשיו.' : '';
    el.innerHTML = `
      <div class="lock-text">
        <b class="lock-title" tabindex="-1">${bad ? 'גרסת הנתונים לא תקינה' : 'נדרש עדכון גרסה'}</b>
        <span>האתר במצב קריאה בלבד כדי להגן על הנתונים שלך.</span>
        ${G.msg || note ? `<span class="lock-msg">${esc(G.msg || note)}</span>` : ''}
      </div>
      <div class="lock-actions">
        ${bad ? '' : '<button class="btn btn-primary" type="button" data-lock="update">עדכן עכשיו</button>'}
        <button class="btn" type="button" data-lock="download">הורד גיבוי</button>
      </div>`;
  }
  function initLockBar() {
    const G = CT.guard;
    const el = document.getElementById('lock-bar');
    if (!G || !el) return;
    G.onChange(() => { renderLockBar(); if (CT.cloud && CT.cloud.enabled) app.updateSyncBadge(); });
    G.onNudge = () => {
      el.classList.remove('flash');
      void el.offsetWidth; // restart the animation
      el.classList.add('flash');
      const t = el.querySelector('.lock-title');
      if (t) t.focus();
    };
    el.addEventListener('click', (e) => {
      const b = e.target.closest('[data-lock]');
      if (!b) return;
      if (b.dataset.lock === 'download') G.download();
      else if (b.dataset.lock === 'update') { b.disabled = true; G.update().finally(() => { b.disabled = false; }); }
    });
    G.watch();
    renderLockBar();
  }

  /* ---------- boot ---------- */
  app.start = async () => {
    const result = S.load();
    initLockBar();
    await CT.backup.init();
    renderHeader();
    S.subscribe(() => app.rerender());
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', applyTheme);
    if (CT.timer) CT.timer.init();
    if (CT.focus) CT.focus.init();
    if (CT.views.adhkar) CT.views.adhkar.init();
    if (CT.views.ai) CT.views.ai.mountFab();
    app.rerender();
    // runs in the background; replaces data if the cloud is newer. Moodle auto-sync starts after it, on the final data.
    if (CT.cloud) Promise.resolve(CT.cloud.init()).catch(() => {}).then(() => CT.views.moodle.startAuto());
    // installable app + offline cache (only works over https / localhost, not file://)
    if ('serviceWorker' in navigator && /^https:|^http:\/\/(localhost|127\.0\.0\.1)/.test(location.href)) {
      navigator.serviceWorker.register('sw.js').catch((e) => console.warn('service worker', e));
    }
    if (result === 'new') {
      ui.toast('ברוך הבא! נטענו הקורסים של סמסטר ו. לחץ ? לקיצורי מקלדת.', { ms: 9000 });
    }
  };

  document.addEventListener('DOMContentLoaded', app.start);
})(window.CT);
