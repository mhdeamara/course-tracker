/* views/course-notebook.js — "מחברת מושגים" tab: definitions, theorems, formulas with LaTeX (local KaTeX). */
(function (CT) {
  'use strict';
  const { u, ui } = CT;
  const S = CT.store;
  const esc = u.esc, icon = u.icon;
  const V = {};
  CT.views = CT.views || {};
  CT.views.notebook = V;

  const editing = new Set();

  V.render = (panel, c) => {
    panel.innerHTML = `
      <div class="notebook">
        <div class="toolbar no-print">
          <p class="muted small" style="margin:0">נוסחאות: <code dir="ltr">$x^2$</code> בתוך שורה, <code dir="ltr">$$\\int_0^1 f\\,dx$$</code> בשורה נפרדת. הכול נשמר אוטומטית.</p>
          <button class="btn btn-primary" data-action="add">${icon.plus} מושג / נוסחה</button>
        </div>
        <div class="nb-list">
          ${c.notebook.map((n) => cardHTML(n)).join('') || ui.empty('המחברת ריקה. הוסף הגדרות, משפטים ונוסחאות שתרצה למצוא מהר לפני המבחן.')}
        </div>
      </div>`;
    const el = panel.querySelector('.notebook');

    el.addEventListener('click', (e) => {
      const a = e.target.closest('[data-action]');
      if (!a) return;
      const id = a.closest('.nb-card') && a.closest('.nb-card').dataset.id;
      if (a.dataset.action === 'add') {
        const n = { id: u.uid(), title: '', body: '' };
        editing.add(n.id);
        S.commit('מושג חדש', () => S.course(c.id).notebook.unshift(n));
        const t = document.querySelector(`.nb-card[data-id="${n.id}"] [name=title]`);
        if (t) t.focus();
      }
      if (a.dataset.action === 'edit') {
        if (editing.has(id)) editing.delete(id); else editing.add(id);
        CT.app.rerender();
        const t = document.querySelector(`.nb-card[data-id="${id}"] [name=body]`);
        if (t) t.focus();
      }
      if (a.dataset.action === 'del') {
        S.commit('מחיקת מושג', () => { const cc = S.course(c.id); cc.notebook = cc.notebook.filter((x) => x.id !== id); });
        ui.toast('המושג נמחק', { action: { label: 'בטל', fn: S.undo } });
      }
    });
    el.addEventListener('input', (e) => {
      const card = e.target.closest('.nb-card');
      if (!card) return;
      const id = card.dataset.id, t = e.target;
      S.commit('עריכת מחברת', () => { S.course(c.id).notebook.find((x) => x.id === id)[t.name] = t.value; }, { silent: true, coalesce: 'nb:' + id });
      if (t.name === 'body') {
        t.style.height = 'auto'; t.style.height = t.scrollHeight + 2 + 'px';
        preview(card, t.value);
      }
    });
    el.querySelectorAll('textarea').forEach((t) => { t.style.height = t.scrollHeight + 2 + 'px'; });
    ui.sortable(el.querySelector('.nb-list'), {
      item: '.nb-card', handle: '.drag-handle',
      onEnd: (ids) => S.commit('סידור מחברת', () => ui.reorder(S.course(c.id).notebook, ids)),
    });
  };

  const preview = u.debounce((card, text) => { const p = card.querySelector('.nb-body'); if (p) p.innerHTML = u.rich(text); }, 200);

  function cardHTML(n) {
    const ed = editing.has(n.id);
    return `
      <article class="card nb-card" data-id="${n.id}">
        <header class="nb-head">
          <button class="drag-handle no-print" aria-label="גרור לסידור">${icon.grip}</button>
          ${ed ? `<input name="title" dir="auto" value="${esc(n.title)}" placeholder="כותרת (למשל: משפט הדגימה)" aria-label="כותרת">` : `<h3 dir="auto">${esc(n.title) || '<span class="muted">ללא כותרת</span>'}</h3>`}
          <button class="icon-btn no-print" data-action="edit" aria-label="${ed ? 'סיום עריכה' : 'עריכה'}" title="${ed ? 'סיום עריכה' : 'עריכה'}">${ed ? icon.check : icon.edit}</button>
          <button class="icon-btn no-print" data-action="del" aria-label="מחיקה">${icon.trash}</button>
        </header>
        ${ed ? `<textarea name="body" dir="auto" rows="3" placeholder="הגדרה / נוסחה..." aria-label="תוכן">${esc(n.body)}</textarea>` : ''}
        <div class="nb-body" dir="auto">${u.rich(n.body)}</div>
      </article>`;
  }
})(window.CT);
