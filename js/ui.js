/* ui.js — reusable UI pieces: toast, modal, confirm/prompt, popup menu, drag-sort, small HTML snippets. */
(function (CT) {
  'use strict';
  const u = CT.u;
  const ui = { justChecked: null };

  /* ---------- toast ---------- */
  ui.toast = (msg, opts = {}) => {
    const box = document.getElementById('toasts');
    const t = document.createElement('div');
    t.className = 'toast' + (opts.error ? ' toast-error' : '');
    t.setAttribute('role', opts.error ? 'alert' : 'status');
    t.innerHTML = `<span>${u.esc(msg)}</span>`;
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
  ui.modal = ({ title, body, actions = [], wide = false, onClose }) => {
    const prevFocus = document.activeElement;
    const wrap = document.createElement('div');
    wrap.className = 'modal-backdrop';
    wrap.innerHTML = `
      <div class="modal${wide ? ' modal-wide' : ''}" role="dialog" aria-modal="true" aria-labelledby="modal-title">
        <header class="modal-head">
          <h2 id="modal-title">${u.esc(title)}</h2>
          <button class="icon-btn" data-close aria-label="סגור">${u.icon.close}</button>
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
    document.body.appendChild(wrap);
    const first = bodyEl.querySelector('input:not([type=hidden]),select,textarea') || foot.querySelector('.btn-primary') || wrap.querySelector('[data-close]');
    setTimeout(() => first && first.focus(), 0);
    const api = { el: wrap, body: bodyEl, close };
    return api;
  };

  ui.confirm = (msg, okLabel = 'אישור', danger = false) => new Promise((res) => {
    let answered = false;
    ui.modal({
      title: 'אישור',
      body: `<p class="pre">${u.esc(msg)}</p>`,
      actions: [
        { label: 'ביטול', fn: () => { answered = true; res(false); } },
        { label: okLabel, primary: !danger, danger, fn: () => { answered = true; res(true); } },
      ],
      onClose: () => { if (!answered) res(false); },
    });
  });

  ui.prompt = (title, value = '', label = '') => new Promise((res) => {
    let answered = false;
    const m = ui.modal({
      title,
      body: `<label class="field"><span>${u.esc(label || title)}</span><input type="text" dir="auto" value="${u.esc(value)}"></label>`,
      actions: [
        { label: 'ביטול', fn: () => { answered = true; res(null); } },
        { label: 'שמור', primary: true, fn: (api) => { answered = true; res(api.body.querySelector('input').value.trim()); } },
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
  ui.menu = (anchor, items) => {
    ui.closeMenu();
    const m = document.createElement('div');
    m.className = 'menu';
    m.setAttribute('role', 'menu');
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
    let left = r.right - mw; // RTL: align to the anchor's right edge
    if (left < 8) left = Math.min(r.left, window.innerWidth - mw - 8);
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

  /* ---------- HTML snippets ---------- */
  ui.bar = (pct, label = '', small = false) => `
    <div class="progress${small ? ' progress-sm' : ''}" role="progressbar" aria-valuenow="${pct}" aria-valuemin="0" aria-valuemax="100" aria-label="${u.esc(label || 'התקדמות')}">
      <div class="progress-fill" style="width:${pct}%"></div>
    </div>`;
  ui.statusPill = (status) => `<span class="pill st-${status}">${u.esc(CT.model.STATUSES[status].label)}</span>`;
  ui.courseDot = (c) => `<span class="dot" style="background:${u.esc(c.color)}"></span>`;
  ui.empty = (msg) => `<div class="empty">${msg}</div>`;

  /** Status choice menu for an item. */
  ui.statusMenu = (anchor, itemId) => {
    const f = CT.store.findItem(itemId);
    if (!f) return;
    ui.menu(anchor, CT.model.STATUS_ORDER.map((s) => ({
      label: CT.model.STATUSES[s].label, active: f.item.status === s,
      dot: `var(--st-${s})`, fn: () => CT.store.setStatus(itemId, s),
    })));
  };

  CT.ui = ui;
})(window.CT);
