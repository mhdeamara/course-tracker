/* views/notifications.js — the notification center behind the header bell.
 *
 * Desktop: a popover anchored under the bell. Phones (< 768px): a bottom sheet over a scrim, clear of the safe areas.
 * The list comes from CT.notify.derive() over the current state on every refresh (nothing is stored as history); only
 * the read marks are stored (CT.notify, per device and per account). Marking read clears the dot, it never resolves.
 * Critical warnings (version lock, sync conflict, sync errors, privacy, destructive confirmations) stay where they are.
 * All texts go through CT.i18n; imported content (Moodle titles, server messages) is shown as is with dir="auto". */
(function (CT) {
  'use strict';
  const { u, store: S, notify: N } = CT;
  const I18N = CT.i18n;
  const t = I18N.t, tx = I18N.tx;
  const esc = u.esc;
  const V = {};
  const SHEET_MAX = 767;
  let layer = null;     // the open center (.nc-layer) or null
  let lastList = [];

  /* ---------- state → notifications ---------- */
  const account = () => (CT.cloud && CT.cloud.signedIn() && CT.cloud.userId ? CT.cloud.userId() || null : null);
  const store = () => { try { return window.localStorage; } catch (e) { return null; } };
  const noStore = { getItem: () => null, setItem: () => {} };
  const ls = () => store() || noStore;

  function context() {
    const st = S.state;
    const Mo = CT.moodle;
    const m = st.moodle || {};
    const changes = (m.changes || []).filter((c) => !c.seen);
    const lastChangeAt = changes.reduce((a, c) => (c.at && c.at > a ? c.at : a), '') || null;
    const b = CT.backup;
    const C = CT.cloud;
    const remind = !!(b && b.needsReminder && b.needsReminder());
    return {
      moodle: { unseen: Mo ? Mo.unseen(st) : {}, lastChangeAt, error: m.linkError ? Object.assign({}, m.linkError, { message: CT.views.moodle.errorText(m.linkError) }) : null, inbox: m.inbox || [] },
      backup: { status: b ? b.status : 'none', remind, days: remind ? b.daysSinceBackup() : null, lastKey: (st.settings.lastBackup || '').slice(0, 10) },
      cloud: { enabled: !!(C && C.enabled), signedIn: !!(C && C.signedIn()), status: C ? C.status : 'off' },
      xp: CT.views.xp && CT.views.xp.noticeData ? CT.views.xp.noticeData() : null,
    };
  }

  /** Current list + unread ids. Read marks of items that no longer exist are dropped, so a recurrence is new again. */
  V.list = () => {
    let list = [];
    try { list = N.derive(context()); } catch (e) { console.error(e); }
    const acct = account();
    let map = N.readMap(ls(), acct);
    const live = new Set(list.map((n) => n.id));
    if (Object.keys(map).some((id) => !live.has(id))) map = N.markRead(ls(), acct, [], list);
    lastList = list;
    return { list, unread: N.unread(list, map) };
  };
  const markRead = (ids) => N.markRead(ls(), account(), ids, lastList);

  /* ---------- rendering ---------- */
  const fmtDate = (d) => {
    const x = new Date(/^\d{4}-\d{2}-\d{2}$/.test(d) ? d + 'T12:00:00' : d);
    if (isNaN(x)) return String(d);
    try { return x.toLocaleDateString(I18N.locale(), { day: 'numeric', month: 'short' }); } catch (e) { return String(d); }
  };
  const params = (p) => (p && p.date ? Object.assign({}, p, { date: fmtDate(p.date) }) : p);
  const text = (s) => (s.raw != null ? `<span dir="auto">${esc(s.raw)}</span>` : t(s.k, params(s.p)));

  function itemHTML(n, unread) {
    const when = N.when(n.at, I18N.locale());
    const acts = n.actions.map((a, i) => `<button type="button" class="nc-act${a.primary ? ' is-primary' : ''}" data-nc-act="${esc(a.act)}" data-nc-id="${esc(n.id)}" data-nc-i="${i}">${t(a.k)}</button>`).join('');
    return `<li class="nc-item sev-${n.sev}${unread ? ' is-unread' : ''}" data-id="${esc(n.id)}">
      <span class="nc-ico" aria-hidden="true">${u.icon[n.icon] || u.icon.bell}</span>
      <div class="nc-main">
        <p class="nc-title">${unread ? `<span class="nc-dot"><span class="nc-sr">${t('notif.new')}: </span></span>` : ''}<span>${text(n.title)}</span></p>
        ${n.sub.length ? `<p class="nc-sub">${n.sub.map(text).join('<span class="nc-sep" aria-hidden="true"> · </span>')}</p>` : ''}
        ${acts || when ? `<div class="nc-meta">${acts ? `<span class="nc-acts">${acts}</span>` : ''}${when ? `<time class="nc-time" datetime="${esc(n.at)}">${esc(when)}</time>` : ''}</div>` : ''}
      </div>
    </li>`;
  }

  function panelHTML() {
    const { list, unread } = V.list();
    const un = new Set(unread.map((n) => n.id));
    const groups = N.GROUPS.map((g) => [g, list.filter((n) => n.group === g)]).filter(([, l]) => l.length);
    const body = list.length
      ? groups.map(([g, l]) => `<section class="nc-group" aria-labelledby="nc-g-${g}">
          <h3 class="nc-gh" id="nc-g-${g}">${t('notif.group.' + g)}</h3>
          <ul class="nc-list">${l.map((n) => itemHTML(n, un.has(n.id))).join('')}</ul>
        </section>`).join('')
      : `<div class="nc-empty"><span class="nc-empty-ico" aria-hidden="true">${u.icon.check}</span><p>${t('notif.empty')}</p></div>`;
    return `
      <span class="nc-grab" aria-hidden="true"></span>
      <header class="nc-head">
        <h2 id="nc-title">${t('notif.title')}${unread.length ? ` <span class="nc-count">${unread.length.toLocaleString(I18N.locale())}</span>` : ''}</h2>
        ${unread.length ? `<button type="button" class="nc-all" data-nc="all" aria-label="${t('notif.markAll')}">${u.icon.check}<span>${t('notif.markAll')}</span></button>` : ''}
        <button type="button" class="icon-btn nc-x" data-nc="close" aria-label="${t('common.close')}">${u.icon.close}</button>
      </header>
      <div class="nc-body">${body}</div>
      <footer class="nc-foot">${u.icon.info}<span>${t('notif.critNote')}</span></footer>`;
  }

  /* ---------- the bell ---------- */
  /** Badge + accessible name on the header bell. Called after every render and after the header is rebuilt. */
  V.refresh = () => {
    const bell = document.getElementById('bell-btn');
    const { unread } = V.list();
    if (bell) {
      const n = unread.length;
      let badge = bell.querySelector('.nc-badge');
      if (n) {
        if (!badge) { badge = document.createElement('span'); badge.className = 'nc-badge'; badge.setAttribute('aria-hidden', 'true'); bell.appendChild(badge); }
        badge.textContent = n > 9 ? '9+' : n.toLocaleString(I18N.locale());
      } else if (badge) badge.remove();
      bell.setAttribute('aria-label', n ? tx('notif.bellUnread', { n }) : tx('notif.bell'));
      bell.setAttribute('aria-haspopup', 'dialog');
      bell.setAttribute('aria-expanded', layer ? 'true' : 'false');
    }
    if (layer) paint();
  };

  /* ---------- open / close ---------- */
  const isSheet = () => window.innerWidth <= SHEET_MAX;
  const focusables = () => (layer ? [...layer.querySelectorAll('.nc button:not([disabled])')] : []);

  function place() {
    if (!layer) return;
    const panel = layer.querySelector('.nc');
    const sheet = isSheet();
    layer.classList.toggle('is-sheet', sheet);
    panel.setAttribute('aria-modal', sheet ? 'true' : 'false');
    if (sheet) { panel.style.left = panel.style.top = panel.style.maxHeight = ''; return; }
    const bell = document.getElementById('bell-btn');
    const r = bell ? bell.getBoundingClientRect() : { left: window.innerWidth - 60, width: 40, bottom: 56 };
    const w = panel.offsetWidth;
    const left = Math.min(Math.max(8, r.left + r.width / 2 - w / 2), window.innerWidth - w - 8);
    panel.style.left = `${left}px`;
    panel.style.top = `${r.bottom + 8}px`;
    panel.style.maxHeight = `${Math.max(240, window.innerHeight - r.bottom - 24)}px`;
  }

  function paint() {
    const panel = layer.querySelector('.nc');
    const f = document.activeElement;
    const key = f && panel.contains(f) ? (f.dataset.ncAct ? `[data-nc-id="${CSS.escape(f.dataset.ncId)}"][data-nc-i="${f.dataset.ncI}"]` : f.dataset.nc ? `[data-nc="${f.dataset.nc}"]` : '') : '';
    const scroll = panel.querySelector('.nc-body') ? panel.querySelector('.nc-body').scrollTop : 0;
    I18N.localized(layer); I18N.localized(panel);
    panel.innerHTML = panelHTML();
    panel.querySelector('.nc-body').scrollTop = scroll;
    if (key || (f && !document.contains(f))) {
      const back = (key && panel.querySelector(key)) || panel.querySelector('.nc-act, [data-nc]');
      if (back) back.focus();
    }
    place();
  }

  V.isOpen = () => !!layer;
  V.toggle = () => (layer ? V.close() : V.open());

  V.open = () => {
    if (layer) return;
    if (CT.ui.closeMenu) CT.ui.closeMenu();
    layer = document.createElement('div');
    layer.className = 'nc-layer';
    layer.innerHTML = '<div class="nc-scrim" data-nc="scrim"></div><div class="nc" role="dialog" aria-labelledby="nc-title"></div>';
    I18N.localized(layer);
    document.body.appendChild(layer);
    paint();
    layer.addEventListener('click', onClick);
    layer.addEventListener('keydown', onKey);
    window.addEventListener('resize', place);
    document.addEventListener('mousedown', onOutside, true);
    V.refresh();
    const first = layer.querySelector('.nc-act.is-primary, .nc-act, [data-nc="all"], [data-nc="close"]');
    if (first) first.focus();
  };

  /** `restore`: put focus back on the bell (not when an action navigates or opens its own dialog afterwards). */
  V.close = (restore = true) => {
    if (!layer) return;
    layer.remove();
    layer = null;
    window.removeEventListener('resize', place);
    document.removeEventListener('mousedown', onOutside, true);
    const bell = document.getElementById('bell-btn');
    if (bell) bell.setAttribute('aria-expanded', 'false');
    if (restore && bell) bell.focus();
  };

  function onOutside(e) {
    if (!layer || isSheet()) return; // the sheet's scrim handles its own clicks
    const bell = document.getElementById('bell-btn');
    if (layer.querySelector('.nc').contains(e.target) || (bell && bell.contains(e.target))) return;
    V.close(false);
  }

  function onKey(e) {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); V.close(); return; }
    const f = focusables();
    if (!f.length) return;
    const i = f.indexOf(document.activeElement);
    if (e.key === 'Tab') { // keep focus inside while open
      if (e.shiftKey && i <= 0) { e.preventDefault(); f[f.length - 1].focus(); }
      else if (!e.shiftKey && i === f.length - 1) { e.preventDefault(); f[0].focus(); }
      return;
    }
    const next = { ArrowDown: i + 1, ArrowUp: i - 1, Home: 0, End: f.length - 1 }[e.key];
    if (next !== undefined) { e.preventDefault(); f[(next + f.length) % f.length].focus(); }
    e.stopPropagation(); // the app's single-key shortcuts stay off while the center is open
  }

  /* ---------- actions ---------- */
  const go = (hash) => { V.close(false); location.hash = hash; };
  const ACTIONS = {
    'moodle-open': () => go('#/moodle'),
    'moodle-seen': () => CT.views.moodle.markSeen(),
    'moodle-inbox': () => { V.close(false); CT.views.moodle.showInbox(); }, // the not-assigned list on the Moodle page
    settings: (arg) => go(arg ? `#/settings/${arg}` : '#/settings'), // arg: the settings category (moodle, account)
    export: () => CT.backup.exportFile(),
    snooze: () => CT.backup.snooze(),
    regrant: () => CT.backup.regrant(),
    'xp-resume': () => S.commit('חזרה מהשהיה', (st) => CT.game.resume(st)),
    'xp-log': () => go('#/xp?tab=log'),
    'xp-pen-seen': (arg) => { CT.views.xp.penSeen(arg); CT.app.rerender(); },
    'xp-five': (arg) => { V.close(); if (CT.focus) CT.focus.start(arg, 5); },
  };

  function onClick(e) {
    const b = e.target.closest('button, [data-nc]');
    if (!b || !layer) return;
    const which = b.dataset.nc;
    if (which === 'close' || which === 'scrim') { V.close(); return; }
    if (which === 'all') { markRead(lastList.map((n) => n.id)); V.refresh(); return; }
    const act = b.dataset.ncAct;
    if (!act || !ACTIONS[act]) return;
    const n = lastList.find((x) => x.id === b.dataset.ncId);
    if (n) markRead([n.id]); // using an item reads it (resolving it is up to the action itself)
    const a = n && n.actions[+b.dataset.ncI];
    try { ACTIONS[act](a && a.arg); } catch (err) { console.error(err); }
    V.refresh();
    // the item may be gone (resolved): keep keyboard focus inside the center
    if (layer && !layer.contains(document.activeElement)) { const f = focusables(); if (f.length) f[0].focus(); }
  }

  CT.views = CT.views || {};
  CT.views.notifications = V;
})(window.CT);
