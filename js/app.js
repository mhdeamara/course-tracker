/* app.js — bootstrap: hash router, header/nav, global search, theme, keyboard shortcuts, help. */
(function (CT) {
  'use strict';
  const { u, ui } = CT;
  const S = CT.store;
  const esc = u.esc, icon = u.icon;
  const app = {};
  CT.app = app;

  const NAV = [
    ['', 'דשבורד', 'home'],
    ['moodle', 'המודל שלי', 'download'],
    ['schedule', 'מערכת שעות', 'calendar'],
    ['review', 'חזרה למבחן', 'star'],
    ['catalog', 'תכנית לימודים', 'book'],
    ['semesters', 'סמסטרים', 'layers'],
    ['grades', 'ממוצע וציונים', 'award'],
    ['stats', 'סטטיסטיקות', 'chart'],
    ['archive', 'ארכיון', 'archive'],
    ['settings', 'הגדרות', 'gear'],
  ];

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
      settings: () => views.settings.render(main, params),
      moodle: () => views.moodle.render(main, params),
    };
    const routeKey = route === 'grades' ? 'gpa' : route;
    const fn = map[route] && (route === '' || route === 'course' || views[routeKey]) ? map[route] : map[''];
    const pathNow = location.hash.split('?')[0];
    const entering = app.lastPath !== pathNow; // a new page (not a re-render after an edit) fades in
    app.lastPath = pathNow;
    fn();
    if (entering) {
      main.classList.remove('route-in'); void main.offsetWidth; main.classList.add('route-in');
      clearTimeout(app.routeTimer); app.routeTimer = setTimeout(() => main.classList.remove('route-in'), 600);
    }
    // nav state
    document.querySelectorAll('.nav a').forEach((a) => {
      const on = a.dataset.route === route;
      a.classList.toggle('active', on);
      if (on) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
    });
    renderSidebar(route, id);
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

  /** Desktop sidebar: navigation, quick course list with progress, backup status. */
  function renderSidebar(route, id) {
    const sb = document.getElementById('sidebar');
    const b = CT.backup;
    const days = b.daysSinceBackup();
    const backupLine = b.status === 'granted'
      ? '<span class="sb-dot ok"></span>שמירה אוטומטית פעילה'
      : b.status === 'needs-permission'
        ? '<span class="sb-dot warn"></span>שמירה אוטומטית ממתינה לאישור'
        : days == null ? '<span class="sb-dot warn"></span>עוד לא גובה'
          : `<span class="sb-dot ${days > 7 ? 'warn' : 'ok'}"></span>גיבוי אחרון ${days === 0 ? 'היום' : days === 1 ? 'אתמול' : `לפני ${days} ימים`}`;
    sb.innerHTML = `
      <a href="#/" class="sb-brand"><span class="sb-logo" aria-hidden="true">📚</span><span>הקורסים שלי</span></a>
      <nav class="sb-nav">
        ${NAV.filter(([r]) => r === '' || CT.views[viewKey(r)]).map(([r, l, ic]) => `<a href="#/${r}" class="${route === r ? 'active' : ''}" ${route === r ? 'aria-current="page"' : ''}>${icon[ic]}<span>${l}</span></a>`).join('')}
      </nav>
      <div class="sb-section">
        <div class="sb-title"><span>קורסים${S.semester(S.state.settings.activeSemesterId) ? ` · ${esc(S.semester(S.state.settings.activeSemesterId).name)}` : ''}</span><button class="icon-btn sb-add" data-sb="new" aria-label="קורס חדש" title="קורס חדש">${icon.plus}</button></div>
        <div class="sb-courses">
          ${S.semesterCourses().map((c) => {
            const p = CT.stats.courseProgress(c);
            const on = route === 'course' && id === c.id;
            const fin = CT.model.isFinished(c);
            return `<a href="#/course/${c.id}" class="sb-course${on ? ' active' : ''}${fin ? ' finished' : ''}" style="--c:${esc(c.color)}" ${on ? 'aria-current="page"' : ''}>
              <span class="dot"></span><span class="sb-name" dir="auto">${esc(c.name)}</span><span class="sb-pct">${fin ? '✓' : `${p.pct}%`}</span></a>`;
          }).join('')}
        </div>
      </div>
      <a href="#/settings" class="sb-foot" id="sb-foot">${CT.cloud && CT.cloud.enabled ? syncLine() : backupLine}</a>`;
    sb.querySelector('[data-sb=new]').onclick = () => CT.views.course.courseForm();
  }

  function renderHeader() {
    const h = document.getElementById('app-header');
    h.innerHTML = `
      <div class="header-inner">
        <a href="#/" class="brand" aria-label="דשבורד">📚 <span>הקורסים שלי</span></a>
        <div class="search" role="search">
          ${icon.search}
          <input id="search" type="search" dir="auto" placeholder="חיפוש בקורסים, פריטים והערות…" aria-label="חיפוש גלובלי (קיצור: /)" autocomplete="off">
          <kbd class="search-kbd">/</kbd>
          <div class="search-results" id="search-results" role="listbox" hidden></div>
        </div>
        <div class="header-actions">
          ${CT.cloud && CT.cloud.enabled ? '<a href="#/settings" id="sync-dot" class="sync-dot warn" aria-label="סנכרון"></a>' : ''}
          <span id="timer-slot"></span>
          <button class="icon-btn" id="undo-btn" aria-label="ביטול פעולה אחרונה (Ctrl+Z)" title="ביטול (Ctrl+Z)">${icon.undo}</button>
          <button class="icon-btn" id="help-btn" aria-label="קיצורי מקלדת (?)" title="קיצורי מקלדת (?)">${icon.keyboard}</button>
          <button class="icon-btn" id="theme-btn"></button>
        </div>
      </div>
      <nav class="nav" aria-label="ניווט ראשי">
        ${NAV.filter(([r]) => r === '' || CT.views[viewKey(r)]).map(([r, l, ic]) => `<a href="#/${r}" data-route="${r}">${icon[ic]}<span>${l}</span></a>`).join('')}
      </nav>`;
    document.getElementById('theme-btn').onclick = () => app.setTheme(isDark() ? 'light' : 'dark');
    document.getElementById('undo-btn').onclick = S.undo;
    document.getElementById('help-btn').onclick = app.showHelp;
    bindSearch();
    applyTheme();
  }

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
    inp.addEventListener('blur', () => setTimeout(() => { box.hidden = true; }, 150));
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
    if (typing || e.ctrlKey || e.metaKey || document.querySelector('.modal-backdrop')) return;
    const { route } = parseHash();
    if (Date.now() - gPending < 1200) {
      const dest = { d: '', 'ג': '', s: 'schedule', 'ד': 'schedule', r: 'review', 'ר': 'review', t: 'stats', 'א': 'stats' }[e.key];
      gPending = 0;
      if (dest !== undefined) { e.preventDefault(); location.hash = `#/${dest}`; return; }
    }
    if (route === 'course' && CT.views.course.onKey(e)) { e.preventDefault(); return; }
    if (e.key === '/' || e.key === '.') { e.preventDefault(); document.getElementById('search').focus(); return; }
    if (e.key === '?') { e.preventDefault(); app.showHelp(); return; }
    if ((e.key === 'g' || e.key === 'ע') && !e.altKey) { gPending = Date.now(); return; }
    if ((e.key === 'n' || e.key === 'מ') && route === '') { e.preventDefault(); CT.views.course.courseForm(); return; }
    if ((e.key === 't' || e.key === 'א') && CT.timer) { e.preventDefault(); CT.timer.open(); return; }
    if ((e.key === 'a' || e.key === 'ש') && CT.views.ai) { e.preventDefault(); CT.views.ai.open(); }
  });

  /* ---------- boot ---------- */
  app.start = async () => {
    const result = S.load();
    await CT.backup.init();
    renderHeader();
    S.subscribe(() => app.rerender());
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', applyTheme);
    if (CT.timer) CT.timer.init();
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
