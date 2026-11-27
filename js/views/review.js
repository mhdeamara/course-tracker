/* views/review.js — exam review list: every item flagged (star) or marked "revisit", with its notes. Printable. */
(function (CT) {
  'use strict';
  const { u, ui } = CT;
  const S = CT.store, M = CT.model, I = CT.i18n;
  const esc = u.esc, icon = u.icon;
  const t = (k, p) => I.t(k, p), tx = (k, p) => I.tx(k, p);
  const V = {};
  CT.views = CT.views || {};
  CT.views.review = V;

  let withNotebook = false;

  V.render = (root, params = {}) => {
    const courses = S.activeCourses();
    const sel = params.course && S.course(params.course) ? params.course : '';
    const list = (sel ? [S.course(sel)] : courses).map((c) => ({
      c,
      cats: c.categories.map((cat) => ({ cat, items: cat.items.filter((i) => i.flag || i.status === 'review') })).filter((x) => x.items.length),
    })).filter((x) => x.cats.length || (withNotebook && x.c.notebook.length));
    const total = u.sum(list, (x) => u.sum(x.cats, (y) => y.items.length));

    root.innerHTML = `
      <div class="review page-wide">
        <div class="section-head" style="margin-top:0">
          <h1><span class="rv-h-ic" aria-hidden="true">${icon.star}</span> ${t('rv.title')}</h1>
          <div class="toolbar-actions no-print">
            <select data-action="course" aria-label="${t('rv.pickCourse')}" class="chip-select">
              <option value="">${t('rv.allCourses')}</option>
              ${courses.map((c) => `<option value="${esc(c.id)}" ${c.id === sel ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}
            </select>
            <label class="check-field"><input type="checkbox" data-action="nb" ${withNotebook ? 'checked' : ''}> ${t('rv.withNb')}</label>
            <button class="btn" data-action="print">${icon.print} ${t('rv.print')}</button>
          </div>
        </div>
        <p class="muted no-print">${t('rv.intro')}</p>
        <p class="print-only">${sel ? `<span dir="auto">${esc(S.course(sel).name)}</span>` : t('rv.allCourses')} · ${esc(ui.date(u.today(), 'full'))} · ${t('rv.count', { n: total })}</p>
        ${list.map(({ c, cats }) => `
          <section class="card rv-course" style="--c:${esc(c.color)}">
            <h2>${ui.courseDot(c)} <a href="#/course/${esc(c.id)}" dir="auto">${esc(c.name)}</a></h2>
            ${cats.map(({ cat, items }) => `
              <h3 class="muted" dir="auto">${esc(cat.name)}</h3>
              <ul class="rv-list">${items.map((it) => `
                <li data-id="${esc(it.id)}">
                  <div class="rv-head">
                    <span class="rv-title">${it.flag ? `<span class="rv-star" role="img" aria-label="${t('rv.flagged')}">${icon.star}</span> ` : ''}<span dir="auto">${esc(it.title)}</span></span>
                    ${ui.statusPill(it.status)}
                    <span class="rv-actions no-print">
                      <button class="btn btn-small" data-action="done" title="${t('rv.doneTitle')}">${icon.check} ${t('rv.done')}</button>
                      <a class="btn btn-small btn-ghost" href="#/course/${esc(c.id)}?item=${esc(it.id)}">${t('rv.open')}</a>
                    </span>
                  </div>
                  ${it.note ? `<div class="rv-note" dir="auto">${u.rich(it.note)}</div>` : ''}
                </li>`).join('')}</ul>`).join('')}
            ${withNotebook && c.notebook.length ? `<h3 class="muted">${t('rv.nb')}</h3>
              <div class="rv-nb">${c.notebook.map((n) => `<div class="rv-nb-item"><b dir="auto">${esc(n.title)}</b><div dir="auto">${u.rich(n.body)}</div></div>`).join('')}</div>` : ''}
          </section>`).join('') || ui.empty(`${t('rv.empty')}<br>${t('rv.emptyHint')}`)}
      </div>`;

    const el = root.querySelector('.review');
    el.addEventListener('change', (e) => {
      if (e.target.dataset.action === 'course') location.hash = e.target.value ? `#/review?course=${e.target.value}` : '#/review';
      if (e.target.dataset.action === 'nb') { withNotebook = e.target.checked; CT.app.rerender(); const b = root.querySelector('[data-action=nb]'); if (b) b.focus(); }
    });
    el.addEventListener('click', (e) => {
      const a = e.target.closest('[data-action]');
      if (!a) return;
      if (a.dataset.action === 'print') window.print();
      if (a.dataset.action === 'done') {
        const id = a.closest('li').dataset.id;
        S.commit(tx('rv.u.done'), () => {
          const it = S.findItem(id).item;
          it.flag = false;
          it.status = 'done';
          it.completedAt = it.completedAt || new Date().toISOString();
        });
        ui.toast(tx('rv.removed'), { action: { label: tx('common.undo'), fn: S.undo } });
      }
    });
  };
  V.statuses = M.STATUSES;
})(window.CT);
