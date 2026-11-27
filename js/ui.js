/* ui.js — reusable UI pieces: toast, modal, confirm/prompt, popup menu, drag-sort, small HTML snippets. */
(function (CT) {
  'use strict';
  const u = CT.u;
  const I18N = CT.i18n, tt = I18N.t, tx = I18N.tx;
  const ui = { justChecked: null };

  /* ---------- toast ---------- */
  ui.toast = (msg, opts = {}) => {
    const box = document.getElementById('toasts');
    const t = document.createElement('div');
    t.className = 'toast' + (opts.error ? ' toast-error' : '');
    t.setAttribute('role', opts.error ? 'alert' : 'status');
    t.innerHTML = `<span dir="auto">${u.esc(msg)}</span>`;
    if (opts.action) {
      const btn = document.createElement('button');
      btn.className = 'toast-action';
      btn.textContent = opts.action.label;
      btn.onclick = () => { t.remove(); opts.action.fn(); };
      t.appendChild(btn);
    }
    box.appendChild(t);
    setTimeout(() => t.classList.add('out'), opts.ms || 4500);
    setTimeout(() => t.remove(), (opts.ms || 4500) + 400);
  };

  /* ---------- modal ---------- */
  /** `localized`: the caller's texts are translated (CT.i18n). Otherwise the dialog is not-yet-translated content
   * and stays Hebrew/RTL in English mode, like the page it came from. */
  ui.modal = ({ title, body, actions = [], wide = false, onClose, localized = false }) => {
    const prevFocus = document.activeElement;
    // if the page is redrawn while the dialog is open, give the focus to the same control in the new page
    const prevSel = prevFocus && prevFocus !== document.body
      ? (prevFocus.id ? `#${CSS.escape(prevFocus.id)}` : prevFocus.dataset && prevFocus.dataset.action ? `[data-action="${CSS.escape(prevFocus.dataset.action)}"]` : null) : null;
    const wrap = document.createElement('div');
    wrap.className = 'modal-backdrop';
    wrap.innerHTML = `
      <div class="modal${wide ? ' modal-wide' : ''}" role="dialog" aria-modal="true" aria-labelledby="modal-title">
        <header class="modal-head">
          <h2 id="modal-title">${u.esc(title)}</h2>
          <button class="icon-btn" data-close aria-label="${tt('common.close')}">${u.icon.close}</button>
        </header>
        <div class="modal-body"></div>
        <footer class="modal-foot"></footer>
      </div>`;
    const bodyEl = wrap.querySelector('.modal-body');
    if (typeof body === 'string') bodyEl.innerHTML = body; else if (body) bodyEl.appendChild(body);
    const foot = wrap.querySelector('.modal-foot');
    const close = () => {
      wrap.remove();
      document.removeEventListener('keydown', onKey, true);
      if (onClose) onClose();
      if (prevFocus && document.contains(prevFocus)) prevFocus.focus();
      else if (prevSel) { const x = document.querySelector(prevSel); if (x) x.focus(); }
    };
    actions.forEach((a) => {
      const btn = document.createElement('button');
      btn.className = 'btn ' + (a.primary ? 'btn-primary' : a.danger ? 'btn-danger' : '');
      btn.textContent = a.label;
      btn.onclick = () => { if (a.fn && a.fn(api) === false) return; close(); };
      foot.appendChild(btn);
    });
    if (!actions.length) foot.remove();
    const onKey = (e) => {
      if (e.key === 'Escape') { e.stopPropagation(); close(); }
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
        const primary = foot.querySelector('.btn-primary');
        if (primary) { e.preventDefault(); primary.click(); }
      }
      if (e.key === 'Tab') { // simple focus trap
        const f = [...wrap.querySelectorAll('button,input,select,textarea,a[href],[tabindex="0"]')].filter((x) => !x.disabled);
        if (!f.length) return;
        if (e.shiftKey && document.activeElement === f[0]) { e.preventDefault(); f[f.length - 1].focus(); }
        else if (!e.shiftKey && document.activeElement === f[f.length - 1]) { e.preventDefault(); f[0].focus(); }
      }
    };
    document.addEventListener('keydown', onKey, true);
    wrap.addEventListener('mousedown', (e) => { if (e.target === wrap) close(); });
    wrap.querySelector('[data-close]').onclick = close;
    if (localized) I18N.localized(wrap); else I18N.content(wrap);
    document.body.appendChild(wrap);
    const first = bodyEl.querySelector('input:not([type=hidden]),select,textarea') || foot.querySelector('.btn-primary') || wrap.querySelector('[data-close]');
    setTimeout(() => first && first.focus(), 0);
    const api = { el: wrap, body: bodyEl, close };
    return api;
  };

  /** `opts.localized`: the message is translated UI (see ui.modal). */
  ui.confirm = (msg, okLabel = tx('common.ok'), danger = false, opts = {}) => new Promise((res) => {
    let answered = false;
    ui.modal({
      localized: !!opts.localized,
      title: tx('common.confirm'),
      body: `<p class="pre" dir="auto">${u.esc(msg)}</p>`,
      actions: [
        { label: tx('common.cancel'), fn: () => { answered = true; res(false); } },
        { label: okLabel, primary: !danger, danger, fn: () => { answered = true; res(true); } },
      ],
      onClose: () => { if (!answered) res(false); },
    });
  });

  ui.prompt = (title, value = '', label = '', opts = {}) => new Promise((res) => {
    let answered = false;
    const m = ui.modal({
      localized: !!opts.localized,
      title,
      body: `<label class="field"><span>${u.esc(label || title)}</span><input type="text" dir="auto" value="${u.esc(value)}"></label>`,
      actions: [
        { label: tx('common.cancel'), fn: () => { answered = true; res(null); } },
        { label: tx('common.save'), primary: true, fn: (api) => { answered = true; res(api.body.querySelector('input').value.trim()); } },
      ],
      onClose: () => { if (!answered) res(null); },
    });
    const inp = m.body.querySelector('input');
    inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); m.el.querySelector('.btn-primary').click(); } });
    setTimeout(() => inp.select(), 0);
  });

  /* ---------- popup menu ---------- */
  let openMenu = null;
  ui.closeMenu = () => { if (openMenu) { openMenu.remove(); openMenu = null; } };
  ui.menu = (anchor, items, { localized = false } = {}) => {
    ui.closeMenu();
    const m = document.createElement('div');
    m.className = 'menu';
    m.setAttribute('role', 'menu');
    if (localized) I18N.localized(m); else I18N.content(m);
    items.filter(Boolean).forEach((it) => {
      if (it === '-') { m.insertAdjacentHTML('beforeend', '<hr>'); return; }
      const b = document.createElement('button');
      b.setAttribute('role', 'menuitem');
      b.className = 'menu-item' + (it.danger ? ' danger' : '') + (it.active ? ' active' : '');
      b.innerHTML = `${it.dot ? `<span class="dot" style="background:${it.dot}"></span>` : ''}${it.icon ? u.icon[it.icon] : ''}<span>${u.esc(it.label)}</span>${it.hint ? `<kbd>${u.esc(it.hint)}</kbd>` : ''}`;
      b.onclick = (e) => { e.stopPropagation(); ui.closeMenu(); it.fn(); };
      m.appendChild(b);
    });
    document.body.appendChild(m);
    const r = anchor.getBoundingClientRect();
    const mw = m.offsetWidth, mh = m.offsetHeight;
    // align to the anchor's inline-start edge (right in RTL, left in LTR), flipping when it would leave the screen
    let left;
    if (getComputedStyle(m).direction === 'rtl') {
      left = r.right - mw;
      if (left < 8) left = Math.min(r.left, window.innerWidth - mw - 8);
    } else {
      left = r.left;
      if (left + mw > window.innerWidth - 8) left = Math.max(8, r.right - mw);
    }
    let top = r.bottom + 4;
    if (top + mh > window.innerHeight - 8) top = Math.max(8, r.top - mh - 4);
    m.style.left = `${Math.max(8, left) + window.scrollX}px`;
    m.style.top = `${top + window.scrollY}px`;
    openMenu = m;
    const btns = [...m.querySelectorAll('button')];
    btns[0] && btns[0].focus();
    m.addEventListener('keydown', (e) => {
      const i = btns.indexOf(document.activeElement);
      if (e.key === 'ArrowDown') { e.preventDefault(); btns[(i + 1) % btns.length].focus(); }
      if (e.key === 'ArrowUp') { e.preventDefault(); btns[(i - 1 + btns.length) % btns.length].focus(); }
      if (e.key === 'Escape' || e.key === 'Tab') { e.preventDefault(); ui.closeMenu(); anchor.focus(); }
    });
  };
  document.addEventListener('mousedown', (e) => { if (openMenu && !openMenu.contains(e.target)) ui.closeMenu(); });
  window.addEventListener('resize', ui.closeMenu);

  /* ---------- drag to reorder (pointer events → works with mouse and touch) ---------- */
  ui.sortable = (container, { item, handle, onEnd }) => {
    container.addEventListener('pointerdown', (e) => {
      const h = e.target.closest(handle);
      if (!h || e.button > 0) return;
      const el = h.closest(item);
      if (!el || el.parentElement !== container) return;
      e.preventDefault();
      const startOrder = [...container.children].map((c) => c.dataset.id).join();
      el.classList.add('dragging');
      document.body.classList.add('is-dragging');
      const move = (ev) => {
        const y = ev.clientY;
        if (y < 70) window.scrollBy(0, -12); else if (y > window.innerHeight - 50) window.scrollBy(0, 12);
        const sibs = [...container.children].filter((c) => c !== el && c.matches(item));
        const before = sibs.find((s) => { const r = s.getBoundingClientRect(); return y < r.top + r.height / 2; });
        if (before) { if (el.nextElementSibling !== before) container.insertBefore(el, before); }
        else if (sibs.length && container.lastElementChild !== el) sibs[sibs.length - 1].after(el);
      };
      const up = () => {
        document.removeEventListener('pointermove', move);
        document.removeEventListener('pointerup', up);
        document.removeEventListener('pointercancel', up);
        el.classList.remove('dragging');
        document.body.classList.remove('is-dragging');
        const ids = [...container.children].filter((c) => c.matches(item)).map((c) => c.dataset.id);
        if (ids.join() !== startOrder) onEnd(ids);
      };
      document.addEventListener('pointermove', move);
      document.addEventListener('pointerup', up);
      document.addEventListener('pointercancel', up);
    });
  };
  /** Reorders `arr` (objects with id) to match `ids`. */
  ui.reorder = (arr, ids) => { arr.sort((a, b) => ids.indexOf(a.id) - ids.indexOf(b.id)); };
  /** Reorder only the items in `ids` (e.g. the open rows while the done rows are collapsed): they keep the slots they
   * had in `arr`, in the new order; every other item stays exactly where it was. */
  ui.reorderSome = (arr, ids) => {
    const set = new Set(ids), byId = new Map(arr.map((x) => [x.id, x]));
    const slots = [];
    arr.forEach((x, i) => { if (set.has(x.id)) slots.push(i); });
    ids.filter((id) => byId.has(id)).forEach((id, k) => { arr[slots[k]] = byId.get(id); });
  };

  /* ---------- HTML snippets ---------- */
  ui.bar = (pct, label = '', small = false) => `
    <div class="progress${small ? ' progress-sm' : ''}" role="progressbar" aria-valuenow="${pct}" aria-valuemin="0" aria-valuemax="100" aria-label="${label ? u.esc(label) : tt('common.progress')}">
      <div class="progress-fill" style="width:${pct}%"></div>
    </div>`;
  /** Donut progress ring (SVG) with the percentage in the middle. */
  ui.ring = (pct, size = 58, stroke = 6) => {
    const r = (size - stroke) / 2, c = 2 * Math.PI * r, h = size / 2;
    return `<svg class="ring" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" role="img" aria-label="${tt('common.ringDone', { pct })}">
      <circle class="ring-bg" cx="${h}" cy="${h}" r="${r}" stroke-width="${stroke}"/>
      <circle class="ring-fg" cx="${h}" cy="${h}" r="${r}" stroke-width="${stroke}" stroke-dasharray="${c.toFixed(2)}" stroke-dashoffset="${(c * (1 - pct / 100)).toFixed(2)}" transform="rotate(-90 ${h} ${h})"/>
      <text x="50%" y="50%" text-anchor="middle" dominant-baseline="central">${pct}<tspan class="ring-unit">%</tspan></text>
    </svg>`;
  };
  /** Item status / course outcome labels in the interface language (the stored values never change). */
  ui.statusLabel = (status) => tx('status.' + (CT.model.STATUSES[status] ? status : 'todo'));
  ui.outcomeLabel = (type, short = false) => (CT.model.OUTCOMES[type] ? tx(`outcome.${type}${short ? '.short' : ''}`) : String(type || ''));
  ui.statusPill = (status) => `<span class="pill st-${status}">${u.esc(ui.statusLabel(status))}</span>`;
  /** Locale-aware display dates for stored YYYY-MM-DD values: 'short' 4 Dec · 'full' 4 December 2026 · 'wd' Fri, 4 Dec. */
  const DATE_OPTS = { short: { day: 'numeric', month: 'short' }, full: { day: 'numeric', month: 'long', year: 'numeric' }, wd: { weekday: 'short', day: 'numeric', month: 'short' }, long: { weekday: 'long', day: 'numeric', month: 'long' } };
  ui.date = (iso, style = 'short') => {
    if (!iso) return '';
    const d = /^\d{4}-\d{2}-\d{2}$/.test(iso) ? u.parseDate(iso) : new Date(iso);
    if (isNaN(d)) return '';
    try { return new Intl.DateTimeFormat(I18N.locale(), DATE_OPTS[style] || DATE_OPTS.short).format(d); } catch (e) { return u.fmtDateFull(u.isoDate(d)); }
  };
  ui.num = (n, digits) => { try { return Number(n).toLocaleString(I18N.locale(), digits == null ? undefined : { maximumFractionDigits: digits }); } catch (e) { return String(n); } };
  /** Weekday name for a schedule day index (0 = Sunday), in the interface language. */
  ui.dayName = (i, style = 'long') => { try { return new Intl.DateTimeFormat(I18N.locale(), { weekday: style }).format(new Date(2026, 10, 29 + Number(i))); } catch (e) { return u.DAYS[i] || ''; } };
  /** "today" / "tomorrow" / "in 3 days" / "2 days overdue" for a due date, translated. */
  ui.rel = (iso) => {
    if (!iso) return '';
    const n = u.daysUntil(iso);
    if (n === 0) return tx('rel.today');
    if (n === 1) return tx('rel.tomorrow');
    if (n === -1) return tx('rel.yesterday');
    return n < 0 ? tx('rel.late', { n: -n }) : tx('rel.in', { n });
  };
  /** Study time for display: "45 min" / "1 h 20 min", in the interface language (stored minutes never change). */
  ui.minutes = (m) => {
    m = Math.round(Number(m) || 0);
    if (m < 60) return tx('fmt.min', { n: m });
    const h = Math.floor(m / 60), r = m % 60;
    return r ? tx('fmt.hm', { h, m: r }) : tx('fmt.h', { h });
  };
  ui.courseDot = (c) => `<span class="dot" style="background:${u.esc(c.color)}"></span>`;
  ui.empty = (msg) => `<div class="empty">${msg}</div>`;
  /** "הושלם · 87" style badge for a finished course ('' while in progress). */
  ui.outcomeBadge = (c) => {
    const o = c && c.outcome;
    if (!o || !o.type) return '';
    const g = u.isNum(o.grade) ? ` · ${ui.num(+o.grade.toFixed(2))}` : '';
    const passMark = (CT.store && CT.store.state && CT.store.state.settings.gpa.passGrade) || 55;
    const bad = o.type === 'failed' || o.type === 'withdrawn' || (o.type === 'graded' && u.isNum(o.grade) && o.grade < passMark);
    return `<span class="pill outcome ${bad ? 'outcome-bad' : 'outcome-ok'}" title="${u.esc(ui.outcomeLabel(o.type))}${o.note ? ' — ' + u.esc(o.note) : ''}">${u.esc(ui.outcomeLabel(o.type, true))}${g}</span>`;
  };

  /** Status choice menu for an item. */
  ui.statusMenu = (anchor, itemId) => {
    const f = CT.store.findItem(itemId);
    if (!f) return;
    ui.menu(anchor, CT.model.STATUS_ORDER.map((s) => ({
      label: ui.statusLabel(s), active: f.item.status === s,
      dot: `var(--st-${s})`, fn: () => CT.store.setStatus(itemId, s),
    })), { localized: true });
  };

  CT.ui = ui;
})(window.CT);
