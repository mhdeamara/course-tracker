/* views/course-notebook.js — Notebook tab (translated): definitions, theorems, formulas with LaTeX (local KaTeX). */
(function (CT) {
  'use strict';
  const { u, ui } = CT;
  const S = CT.store;
  const esc = u.esc, icon = u.icon;
  const t = CT.i18n.t, tx = CT.i18n.tx;
  const V = {};
  CT.views = CT.views || {};
  CT.views.notebook = V;

  const editing = new Set();

  V.render = (panel, c) => {
    panel.innerHTML = `
      <div class="notebook">
        <div class="toolbar no-print">
          <p class="muted small nb-hint">${t('nb.hint')} <code dir="ltr">$x^2$</code> · <code dir="ltr">$$\\int_0^1 f\\,dx$$</code></p>
          <button class="btn btn-primary" data-action="add">${icon.plus} ${t('nb.add')}</button>
        </div>
        <div class="nb-list">
          ${c.notebook.map((n) => cardHTML(n)).join('') || ui.empty(t('nb.empty'))}
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
        S.commit(tx('nb.u.add'), () => S.course(c.id).notebook.unshift(n));
        const ti = document.querySelector(`.nb-card[data-id="${n.id}"] [name=title]`);
        if (ti) ti.focus();
      }
      if (a.dataset.action === 'edit') {
        if (editing.has(id)) editing.delete(id); else editing.add(id);
        CT.app.rerender();
        const tb = document.querySelector(`.nb-card[data-id="${id}"] [name=body]`);
        if (tb) tb.focus();
      }
      if (a.dataset.action === 'del') {
        S.commit(tx('nb.u.del'), () => { const cc = S.course(c.id); cc.notebook = cc.notebook.filter((x) => x.id !== id); });
        ui.toast(tx('nb.deleted'), { action: { label: tx('common.undo'), fn: S.undo } });
      }
    });
    el.addEventListener('input', (e) => {
      const card = e.target.closest('.nb-card');
      if (!card) return;
      const id = card.dataset.id, f = e.target;
      S.commit(tx('nb.u.edit'), () => { S.course(c.id).notebook.find((x) => x.id === id)[f.name] = f.value; }, { silent: true, coalesce: 'nb:' + id });
      if (f.name === 'body') {
        f.style.height = 'auto'; f.style.height = f.scrollHeight + 2 + 'px';
        preview(card, f.value);
      }
    });
    el.querySelectorAll('textarea').forEach((ta) => { ta.style.height = ta.scrollHeight + 2 + 'px'; });
    ui.sortable(el.querySelector('.nb-list'), {
      item: '.nb-card', handle: '.drag-handle',
      onEnd: (ids) => S.commit(tx('nb.u.order'), () => ui.reorder(S.course(c.id).notebook, ids)),
    });
  };

  const preview = u.debounce((card, text) => { const p = card.querySelector('.nb-body'); if (p) p.innerHTML = u.rich(text); }, 200);

  function cardHTML(n) {
    const ed = editing.has(n.id);
    return `
      <article class="card nb-card" data-id="${n.id}">
        <header class="nb-head">
          <button class="drag-handle no-print" aria-label="${t('nb.drag')}">${icon.grip}</button>
          ${ed ? `<input name="title" dir="auto" value="${esc(n.title)}" placeholder="${t('nb.titlePh')}" aria-label="${t('nb.titleLabel')}">` : `<h3 dir="auto">${esc(n.title) || `<span class="muted">${t('nb.untitled')}</span>`}</h3>`}
          <button class="icon-btn no-print" data-action="edit" aria-label="${t(ed ? 'nb.doneEdit' : 'nb.edit')}" title="${t(ed ? 'nb.doneEdit' : 'nb.edit')}">${ed ? icon.check : icon.edit}</button>
          <button class="icon-btn no-print" data-action="del" aria-label="${t('nb.del')}">${icon.trash}</button>
        </header>
        ${ed ? `<textarea name="body" dir="auto" rows="3" placeholder="${t('nb.bodyPh')}" aria-label="${t('nb.bodyLabel')}">${esc(n.body)}</textarea>` : ''}
        <div class="nb-body" dir="auto">${u.rich(n.body)}</div>
      </article>`;
  }
})(window.CT);
